import { transitionOrderInTx } from "./orders";

type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

export const HONDURAS_DEPARTMENTS = [
  "Atlántida",
  "Choluteca",
  "Colón",
  "Comayagua",
  "Copán",
  "Cortés",
  "El Paraíso",
  "Francisco Morazán",
  "Gracias a Dios",
  "Intibucá",
  "Islas de la Bahía",
  "La Paz",
  "Lempira",
  "Ocotepeque",
  "Olancho",
  "Santa Bárbara",
  "Valle",
  "Yoro"
] as const;

const DEPARTMENTS = new Set<string>(HONDURAS_DEPARTMENTS);
const TYPES = new Set(["STORE_PICKUP", "LOCAL_DELIVERY", "COURIER"]);
const STATUSES = new Set([
  "PENDING",
  "PREPARING",
  "READY",
  "DISPATCHED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RETURNING",
  "RETURNED",
  "CANCELLED"
]);

const ALLOWED: Record<string, Set<string>> = {
  PENDING: new Set(["PREPARING", "CANCELLED"]),
  PREPARING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["DISPATCHED", "DELIVERED", "CANCELLED"]),
  DISPATCHED: new Set(["OUT_FOR_DELIVERY", "FAILED"]),
  OUT_FOR_DELIVERY: new Set(["DELIVERED", "FAILED"]),
  DELIVERED: new Set(),
  FAILED: new Set(["OUT_FOR_DELIVERY", "RETURNING"]),
  RETURNING: new Set(["RETURNED"]),
  RETURNED: new Set(),
  CANCELLED: new Set()
};

function authorized(req: Request) {
  const expected = Bun.env.INTERNAL_API_TOKEN || "";
  const supplied = req.headers.get("x-internal-key") || "";
  return Boolean(expected) && supplied === expected;
}

function requestHash(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeDepartment(value: unknown, clean: (v: unknown, max: number) => string) {
  const wanted = clean(value, 80);
  const canonical = HONDURAS_DEPARTMENTS.find(x => x.toLocaleLowerCase("es") === wanted.toLocaleLowerCase("es"));
  return canonical || null;
}

function normalizeProof(raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const text = JSON.stringify(raw);
  if (text.length > 4000) throw new Error("proof_too_large");
  return raw;
}

function trackingReference() {
  return "MRF-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
}

async function ensureCodCollection(tx: DB, fulfillmentId: number, orderId: number) {
  const payments = await tx`
    SELECT id, amount_minor, currency
    FROM payments
    WHERE order_id = ${orderId}
      AND method = 'CASH_ON_DELIVERY'
    LIMIT 1`;
  if (!payments.length) return null;

  const payment = payments[0];
  const rows = await tx`
    INSERT INTO cod_collections(
      fulfillment_id, payment_id, status, expected_amount_minor, currency
    )
    VALUES(
      ${fulfillmentId}, ${Number(payment.id)}, 'PENDING',
      ${Number(payment.amount_minor)}, ${payment.currency}
    )
    ON CONFLICT (fulfillment_id)
    DO UPDATE SET updated_at = NOW()
    RETURNING id`;

  return Number(rows[0].id);
}

async function loadFulfillment(db: DB, id: number) {
  const rows = await db`
    SELECT
      f.id, f.public_token, f.order_id, o.order_number, o.status AS order_status,
      f.type, f.status, f.provider, f.tracking_reference,
      f.department, f.municipality, f.address_line, f.address_reference,
      f.recipient_name, f.recipient_phone,
      f.quoted_shipping_minor, f.currency, f.eta_min_days, f.eta_max_days,
      f.proof_of_delivery, f.created_at, f.updated_at,
      c.id AS cod_id, c.status AS cod_status, c.expected_amount_minor,
      c.collected_amount_minor, c.currency AS cod_currency
    FROM fulfillments f
    JOIN orders o ON o.id = f.order_id
    LEFT JOIN cod_collections c ON c.fulfillment_id = f.id
    WHERE f.id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;

  const events = await db`
    SELECT id, event_type, status, description, location_text, occurred_at
    FROM fulfillment_tracking_events
    WHERE fulfillment_id = ${id}
    ORDER BY occurred_at, id`;

  const attempts = await db`
    SELECT id, attempt_number, status, reason, occurred_at
    FROM delivery_attempts
    WHERE fulfillment_id = ${id}
    ORDER BY attempt_number`;

  const row = rows[0];
  return {
    id: Number(row.id),
    token: row.public_token,
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    type: row.type,
    status: row.status,
    provider: row.provider,
    trackingReference: row.tracking_reference || null,
    destination: {
      department: row.department || null,
      municipality: row.municipality || null,
      addressLine: row.address_line || null,
      addressReference: row.address_reference || null,
      recipientName: row.recipient_name || null,
      recipientPhone: row.recipient_phone || null
    },
    quote: {
      shippingMinor: row.quoted_shipping_minor == null ? null : Number(row.quoted_shipping_minor),
      currency: row.currency,
      etaMinDays: row.eta_min_days == null ? null : Number(row.eta_min_days),
      etaMaxDays: row.eta_max_days == null ? null : Number(row.eta_max_days)
    },
    proofOfDelivery: row.proof_of_delivery || {},
    codCollection: row.cod_id ? {
      id: Number(row.cod_id),
      status: row.cod_status,
      expectedAmountMinor: Number(row.expected_amount_minor),
      collectedAmountMinor: row.collected_amount_minor == null ? null : Number(row.collected_amount_minor),
      currency: row.cod_currency
    } : null,
    events: events.map((x: any) => ({
      id: Number(x.id),
      eventType: x.event_type,
      status: x.status,
      description: x.description,
      locationText: x.location_text || null,
      occurredAt: x.occurred_at
    })),
    attempts: attempts.map((x: any) => ({
      id: Number(x.id),
      attemptNumber: Number(x.attempt_number),
      status: x.status,
      reason: x.reason || null,
      occurredAt: x.occurred_at
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureFulfillmentSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS delivery_zones (
      id BIGSERIAL PRIMARY KEY,
      department TEXT NOT NULL,
      service_type TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      shipping_minor BIGINT,
      currency CHAR(3) NOT NULL DEFAULT 'HNL',
      eta_min_days INTEGER,
      eta_max_days INTEGER,
      provider TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(department, service_type),
      CHECK (service_type IN ('LOCAL_DELIVERY','COURIER')),
      CHECK (shipping_minor IS NULL OR shipping_minor >= 0),
      CHECK (eta_min_days IS NULL OR eta_min_days >= 0),
      CHECK (eta_max_days IS NULL OR eta_max_days >= 0)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS fulfillments (
      id BIGSERIAL PRIMARY KEY,
      public_token TEXT UNIQUE NOT NULL,
      order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      provider TEXT NOT NULL,
      tracking_reference TEXT UNIQUE NOT NULL,
      department TEXT,
      municipality TEXT,
      address_line TEXT,
      address_reference TEXT,
      recipient_name TEXT,
      recipient_phone TEXT,
      quoted_shipping_minor BIGINT,
      currency CHAR(3) NOT NULL DEFAULT 'HNL',
      eta_min_days INTEGER,
      eta_max_days INTEGER,
      proof_of_delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (type IN ('STORE_PICKUP','LOCAL_DELIVERY','COURIER')),
      CHECK (status IN ('PENDING','PREPARING','READY','DISPATCHED','OUT_FOR_DELIVERY','DELIVERED','FAILED','RETURNING','RETURNED','CANCELLED')),
      CHECK (quoted_shipping_minor IS NULL OR quoted_shipping_minor >= 0)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS fulfillment_status_history (
      id BIGSERIAL PRIMARY KEY,
      fulfillment_id BIGINT NOT NULL REFERENCES fulfillments(id) ON DELETE RESTRICT,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS fulfillment_tracking_events (
      id BIGSERIAL PRIMARY KEY,
      fulfillment_id BIGINT NOT NULL REFERENCES fulfillments(id) ON DELETE RESTRICT,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL,
      provider_event_id TEXT,
      location_text TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_provider_event
    ON fulfillment_tracking_events(fulfillment_id, provider_event_id)
    WHERE provider_event_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id BIGSERIAL PRIMARY KEY,
      fulfillment_id BIGINT NOT NULL REFERENCES fulfillments(id) ON DELETE RESTRICT,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      proof JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(fulfillment_id, attempt_number),
      CHECK (status IN ('SUCCESS','FAILED','REJECTED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS cod_collections (
      id BIGSERIAL PRIMARY KEY,
      fulfillment_id BIGINT UNIQUE NOT NULL REFERENCES fulfillments(id) ON DELETE RESTRICT,
      payment_id BIGINT UNIQUE NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      expected_amount_minor BIGINT NOT NULL CHECK (expected_amount_minor >= 0),
      collected_amount_minor BIGINT,
      currency CHAR(3) NOT NULL,
      collector_reference TEXT,
      collected_at TIMESTAMPTZ,
      reconciled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PENDING','COLLECTED','FAILED','RECONCILED')),
      CHECK (collected_amount_minor IS NULL OR collected_amount_minor >= 0)
    )`;


  await db`
    CREATE TABLE IF NOT EXISTS cod_collection_history (
      id BIGSERIAL PRIMARY KEY,
      cod_collection_id BIGINT NOT NULL REFERENCES cod_collections(id) ON DELETE RESTRICT,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS return_inspections (
      id BIGSERIAL PRIMARY KEY,
      fulfillment_id BIGINT UNIQUE NOT NULL REFERENCES fulfillments(id) ON DELETE RESTRICT,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      disposition TEXT,
      notes TEXT,
      inspected_by TEXT,
      inspected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PENDING','COMPLETED')),
      CHECK (disposition IS NULL OR disposition IN ('RESTOCK','DAMAGED','QUARANTINE','RETURN_TO_SUPPLIER'))
    )`;

  await db`CREATE INDEX IF NOT EXISTS idx_fulfillments_status_created ON fulfillments(status, created_at DESC)`;
}

async function getOptions(url: URL, db: DB, clean: (v: unknown, max: number) => string) {
  const department = normalizeDepartment(url.searchParams.get("department"), clean);
  if (!department) return json({ error: "invalid_department", departments: HONDURAS_DEPARTMENTS }, 400);

  const rows = await db`
    SELECT department, service_type, shipping_minor, currency,
           eta_min_days, eta_max_days, provider
    FROM delivery_zones
    WHERE department = ${department} AND active
    ORDER BY service_type`;

  if (!rows.length) {
    return json({
      department,
      options: [{
        type: "COURIER",
        provider: null,
        shippingMinor: null,
        currency: "HNL",
        etaMinDays: null,
        etaMaxDays: null,
        quoteRequired: true
      }]
    });
  }

  return json({
    department,
    options: rows.map((r: any) => ({
      type: r.service_type,
      provider: r.provider || null,
      shippingMinor: r.shipping_minor == null ? null : Number(r.shipping_minor),
      currency: r.currency,
      etaMinDays: r.eta_min_days == null ? null : Number(r.eta_min_days),
      etaMaxDays: r.eta_max_days == null ? null : Number(r.eta_max_days),
      quoteRequired: r.shipping_minor == null || r.eta_min_days == null || r.eta_max_days == null
    }))
  });
}

async function createFulfillment(req: Request, db: DB, clean: (v: unknown, max: number) => string) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) return json({ error: "idempotency_key_required" }, 400);

  const length = Number(req.headers.get("content-length") || 0);
  if (length > 32768) return json({ error: "payload_too_large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  if (
    body?.shippingMinor != null ||
    body?.quotedShippingMinor != null ||
    body?.etaMinDays != null ||
    body?.etaMaxDays != null ||
    body?.currency != null
  ) {
    return json({ error: "client_delivery_quote_not_allowed" }, 400);
  }

  const orderId = Number(body?.orderId);
  const orderToken = clean(body?.orderToken, 80);
  const type = clean(body?.type, 32).toUpperCase();
  const department = type === "STORE_PICKUP" ? null : normalizeDepartment(body?.department, clean);
  const municipality = clean(body?.municipality, 120) || null;
  const addressLine = clean(body?.addressLine, 500) || null;
  const addressReference = clean(body?.addressReference, 500) || null;
  const recipientName = clean(body?.recipientName, 120) || null;
  const recipientPhone = clean(body?.recipientPhone, 80) || null;

  if (!Number.isSafeInteger(orderId) || orderId < 1) return json({ error: "invalid_order" }, 400);
  if (!orderToken) return json({ error: "order_token_required" }, 401);
  if (!TYPES.has(type)) return json({ error: "invalid_fulfillment_type" }, 400);
  if (type !== "STORE_PICKUP" && (!department || !municipality || !addressLine)) {
    return json({ error: "delivery_address_required" }, 400);
  }

  const normalized = {
    orderId,
    orderToken,
    type,
    department,
    municipality,
    addressLine,
    addressReference,
    recipientName,
    recipientPhone
  };
  const hash = requestHash(normalized);

  const existing = await db`
    SELECT id, idempotency_hash
    FROM fulfillments
    WHERE idempotency_key = ${key}
    LIMIT 1`;
  if (existing.length) {
    if (existing[0].idempotency_hash !== hash) return json({ error: "idempotency_conflict" }, 409);
    return json({ fulfillment: await loadFulfillment(db, Number(existing[0].id)), replayed: true }, 200);
  }

  let quote: any = {
    shippingMinor: 0,
    currency: "HNL",
    etaMinDays: 0,
    etaMaxDays: 0,
    provider: "MR"
  };

  if (type !== "STORE_PICKUP") {
    const zones = await db`
      SELECT shipping_minor, currency, eta_min_days, eta_max_days, provider
      FROM delivery_zones
      WHERE department = ${department}
        AND service_type = ${type}
        AND active
      LIMIT 1`;
    if (!zones.length) return json({ error: "delivery_quote_required", department, type }, 409);
    const z = zones[0];
    if (z.shipping_minor == null || z.eta_min_days == null || z.eta_max_days == null) {
      return json({ error: "delivery_quote_required", department, type }, 409);
    }
    quote = {
      shippingMinor: Number(z.shipping_minor),
      currency: z.currency,
      etaMinDays: Number(z.eta_min_days),
      etaMaxDays: Number(z.eta_max_days),
      provider: z.provider || "INTERNAL"
    };
  }

  try {
    const created: any = await db.begin(async (tx: DB) => {
      const orders = await tx`
        SELECT id, public_token, status, currency, subtotal_minor, discount_total_minor,
               tax_total_minor, shipping_total_minor, grand_total_minor
        FROM orders
        WHERE id = ${orderId}
        FOR UPDATE`;
      if (!orders.length || orders[0].public_token !== orderToken) return { error: "order_not_found", status: 404 };
      const order = orders[0];

      if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(order.status)) {
        return { error: "order_not_fulfillable", status: 409, orderStatus: order.status };
      }

      const checkout = await tx`SELECT id FROM checkout_sessions WHERE order_id = ${orderId} LIMIT 1`;
      if (checkout.length) return { error: "fulfillment_must_precede_checkout", status: 409 };

      const prior = await tx`SELECT id FROM fulfillments WHERE order_id = ${orderId} LIMIT 1`;
      if (prior.length) return { error: "fulfillment_exists", status: 409, fulfillmentId: Number(prior[0].id) };

      if (String(order.currency) !== quote.currency) {
        return { error: "delivery_currency_mismatch", status: 409 };
      }

      const grandTotalMinor =
        Number(order.subtotal_minor) -
        Number(order.discount_total_minor) +
        Number(order.tax_total_minor) +
        quote.shippingMinor;

      await tx`
        UPDATE orders
        SET shipping_total_minor = ${quote.shippingMinor},
            grand_total_minor = ${grandTotalMinor},
            updated_at = NOW()
        WHERE id = ${orderId}`;

      const token = crypto.randomUUID();
      const tracking = trackingReference();
      const rows = await tx`
        INSERT INTO fulfillments(
          public_token, order_id, type, status, provider, tracking_reference,
          department, municipality, address_line, address_reference,
          recipient_name, recipient_phone, quoted_shipping_minor, currency,
          eta_min_days, eta_max_days, idempotency_key, idempotency_hash
        )
        VALUES(
          ${token}, ${orderId}, ${type}, 'PENDING', ${quote.provider}, ${tracking},
          ${department}, ${municipality}, ${addressLine}, ${addressReference},
          ${recipientName}, ${recipientPhone}, ${quote.shippingMinor}, ${quote.currency},
          ${quote.etaMinDays}, ${quote.etaMaxDays}, ${key}, ${hash}
        )
        RETURNING id`;
      const fulfillmentId = Number(rows[0].id);

      await tx`
        INSERT INTO fulfillment_status_history(fulfillment_id, from_status, to_status, actor, reason)
        VALUES(${fulfillmentId}, NULL, 'PENDING', 'public', 'fulfillment_created')`;

      await tx`
        INSERT INTO fulfillment_tracking_events(
          fulfillment_id, event_type, status, description, location_text
        )
        VALUES(
          ${fulfillmentId}, 'FULFILLMENT_CREATED', 'PENDING',
          'Fulfillment created', ${department || "Store pickup"}
        )`;

      return { fulfillmentId };
    });

    if (created.error) return json(created, created.status || 409);
    return json({ fulfillment: await loadFulfillment(db, Number(created.fulfillmentId)), replayed: false }, 201);
  } catch (error: any) {
    if (error?.code === "23505") {
      const rows = await db`
        SELECT id, idempotency_hash
        FROM fulfillments
        WHERE idempotency_key = ${key}
        LIMIT 1`;
      if (rows.length && rows[0].idempotency_hash === hash) {
        return json({ fulfillment: await loadFulfillment(db, Number(rows[0].id)), replayed: true }, 200);
      }
      return json({ error: "idempotency_conflict" }, 409);
    }
    console.error("create_fulfillment_failed", error);
    return json({ error: "fulfillment_creation_failed" }, 500);
  }
}


async function transitionFulfillmentInTx(
  tx: DB,
  id: number,
  target: string,
  actor: string,
  reason: string | null,
  proof: any
) {
  if (!STATUSES.has(target)) return { error: "invalid_status", status: 400 };

  const rows = await tx`
    SELECT f.id, f.order_id, f.type, f.status, o.status AS order_status
    FROM fulfillments f
    JOIN orders o ON o.id = f.order_id
    WHERE f.id = ${id}
    FOR UPDATE OF f, o`;
  if (!rows.length) return { error: "not_found", status: 404 };

  const f = rows[0];
  const current = f.status;
  if (!ALLOWED[current]?.has(target)) {
    return { error: "invalid_transition", status: 409, current, target };
  }

  let orderTarget: string | null = null;
  if (target === "PREPARING" && f.order_status === "CONFIRMED") orderTarget = "PROCESSING";
  if (target === "READY" && f.order_status === "PROCESSING") orderTarget = "READY";
  if (target === "DISPATCHED" && f.order_status === "READY") orderTarget = "SHIPPED";
  if (target === "DELIVERED") {
    if (f.type === "STORE_PICKUP" && f.order_status === "READY") orderTarget = "COMPLETED";
    else if (f.order_status === "SHIPPED") orderTarget = "DELIVERED";
  }
  if (
    target === "CANCELLED" &&
    ["PENDING_CONFIRMATION", "CONFIRMED", "PROCESSING", "READY"].includes(f.order_status)
  ) {
    orderTarget = "CANCELLED";
  }

  if (["PREPARING", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"].includes(target) && !orderTarget) {
    return {
      error: "order_state_mismatch",
      status: 409,
      orderStatus: f.order_status,
      fulfillmentTarget: target
    };
  }

  if (orderTarget) {
    const orderResult: any = await transitionOrderInTx(
      tx,
      Number(f.order_id),
      orderTarget,
      "fulfillment",
      reason || ("fulfillment:" + target)
    );
    if (orderResult.error) return orderResult;
  }

  const proofObject = target === "DELIVERED" ? normalizeProof(proof) : {};
  await tx`
    UPDATE fulfillments
    SET status = ${target},
        proof_of_delivery = CASE
          WHEN ${target} = 'DELIVERED' THEN ${JSON.stringify(proofObject)}::jsonb
          ELSE proof_of_delivery
        END,
        updated_at = NOW()
    WHERE id = ${id}`;

  await tx`
    INSERT INTO fulfillment_status_history(fulfillment_id, from_status, to_status, actor, reason)
    VALUES(${id}, ${current}, ${target}, ${actor}, ${reason})`;

  await tx`
    INSERT INTO fulfillment_tracking_events(
      fulfillment_id, event_type, status, description
    )
    VALUES(
      ${id}, 'STATUS_CHANGED', ${target}, ${"Fulfillment status changed to " + target}
    )`;

  if (target === "DISPATCHED") {
    await ensureCodCollection(tx, id, Number(f.order_id));
  }

  if (target === "RETURNED") {
    await tx`
      INSERT INTO return_inspections(fulfillment_id, order_id, status)
      VALUES(${id}, ${Number(f.order_id)}, 'PENDING')
      ON CONFLICT (fulfillment_id) DO NOTHING`;
  }

  return { ok: true, orderTarget };
}

async function transitionFulfillment(
  db: DB,
  id: number,
  target: string,
  actor: string,
  reason: string | null,
  proof: any
) {
  if (!STATUSES.has(target)) return { error: "invalid_status", status: 400 };

  try {
    return await db.begin((tx: DB) =>
      transitionFulfillmentInTx(tx, id, target, actor, reason, proof)
    );
  } catch (error: any) {
    if (String(error?.message || "").includes("proof_too_large")) {
      return { error: "proof_too_large", status: 413 };
    }
    return { error: error?.message || "fulfillment_transition_failed", status: 409 };
  }
}


async function completeReturnInspection(
  req: Request,
  id: number,
  db: DB,
  clean: (v: unknown, max: number) => string
) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const disposition = clean(body?.disposition, 40).toUpperCase();
  const notes = clean(body?.notes, 1000) || null;
  if (!["RESTOCK", "DAMAGED", "QUARANTINE", "RETURN_TO_SUPPLIER"].includes(disposition)) {
    return json({ error: "invalid_disposition" }, 400);
  }

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`
      SELECT i.id, i.order_id, i.status, f.status AS fulfillment_status
      FROM return_inspections i
      JOIN fulfillments f ON f.id = i.fulfillment_id
      WHERE i.id = ${id}
      FOR UPDATE OF i`;
    if (!rows.length) return { error: "not_found", status: 404 };
    if (rows[0].status !== "PENDING") return { error: "inspection_already_completed", status: 409 };
    if (rows[0].fulfillment_status !== "RETURNED") {
      return { error: "parcel_not_returned", status: 409 };
    }

    if (disposition === "RESTOCK") {
      const reservations = await tx`
        SELECT variant_id, location_id, quantity
        FROM inventory_reservations
        WHERE order_id = ${Number(rows[0].order_id)}
          AND status = 'CONSUMED'
        ORDER BY variant_id
        FOR UPDATE`;

      for (const reservation of reservations) {
        const variantId = Number(reservation.variant_id);
        const locationId = Number(reservation.location_id);
        const quantity = Number(reservation.quantity);

        await tx`
          UPDATE inventory
          SET quantity = quantity + ${quantity}, updated_at = NOW()
          WHERE variant_id = ${variantId}
            AND location_id = ${locationId}`;

        await tx`
          INSERT INTO inventory_movements(
            variant_id, location_id, movement_type, quantity, reference, notes
          )
          VALUES(
            ${variantId}, ${locationId}, 'CUSTOMER_RETURN', ${quantity},
            ${"return_inspection:" + id}, 'Returned parcel inspected and approved for restock'
          )`;
      }
    }

    await tx`
      UPDATE return_inspections
      SET status = 'COMPLETED',
          disposition = ${disposition},
          notes = ${notes},
          inspected_by = 'internal',
          inspected_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}`;

    return { ok: true };
  });

  if (result.error) return json(result, result.status || 409);
  const rows = await db`SELECT * FROM return_inspections WHERE id = ${id}`;
  return json({ returnInspection: rows[0] });
}

export async function handleFulfillment(
  req: Request,
  url: URL,
  db: DB,
  clean: (v: unknown, max: number) => string
) {
  if (url.pathname === "/v1/fulfillment/options" && req.method === "GET") {
    return getOptions(url, db, clean);
  }

  if (url.pathname === "/v1/fulfillments" && req.method === "POST") {
    return createFulfillment(req, db, clean);
  }

  const publicFulfillment = url.pathname.match(/^\/v1\/fulfillments\/(\d+)$/);
  if (publicFulfillment && req.method === "GET") {
    const id = Number(publicFulfillment[1]);
    const token = clean(url.searchParams.get("token"), 80);
    if (!token) return json({ error: "token_required" }, 401);
    const rows = await db`SELECT public_token FROM fulfillments WHERE id = ${id} LIMIT 1`;
    if (!rows.length || rows[0].public_token !== token) return json({ error: "not_found" }, 404);
    return json({ fulfillment: await loadFulfillment(db, id) });
  }

  if (url.pathname === "/v1/internal/delivery-zones" && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const rows = await db`
      SELECT department, service_type, active, shipping_minor, currency,
             eta_min_days, eta_max_days, provider, notes, updated_at
      FROM delivery_zones
      ORDER BY department, service_type`;
    return json({ data: rows, departments: HONDURAS_DEPARTMENTS });
  }

  const zoneRoute = url.pathname.match(/^\/v1\/internal\/delivery-zones\/(.+)$/);
  if (zoneRoute && req.method === "PUT") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

    const rawDepartment = decodeURIComponent(zoneRoute[1]);
    const department = normalizeDepartment(rawDepartment, clean);
    const serviceType = clean(body?.serviceType, 32).toUpperCase();
    const shippingMinor = body?.shippingMinor == null ? null : Number(body.shippingMinor);
    const etaMinDays = body?.etaMinDays == null ? null : Number(body.etaMinDays);
    const etaMaxDays = body?.etaMaxDays == null ? null : Number(body.etaMaxDays);
    const currency = clean(body?.currency, 3).toUpperCase() || "HNL";
    const provider = clean(body?.provider, 120) || null;
    const notes = clean(body?.notes, 500) || null;
    const active = body?.active !== false;

    if (!department) return json({ error: "invalid_department" }, 400);
    if (!["LOCAL_DELIVERY", "COURIER"].includes(serviceType)) return json({ error: "invalid_service_type" }, 400);
    if (shippingMinor != null && (!Number.isSafeInteger(shippingMinor) || shippingMinor < 0)) return json({ error: "invalid_shipping" }, 400);
    if (etaMinDays != null && (!Number.isSafeInteger(etaMinDays) || etaMinDays < 0)) return json({ error: "invalid_eta" }, 400);
    if (etaMaxDays != null && (!Number.isSafeInteger(etaMaxDays) || etaMaxDays < 0)) return json({ error: "invalid_eta" }, 400);
    if (etaMinDays != null && etaMaxDays != null && etaMaxDays < etaMinDays) return json({ error: "invalid_eta_range" }, 400);

    const rows = await db`
      INSERT INTO delivery_zones(
        department, service_type, active, shipping_minor, currency,
        eta_min_days, eta_max_days, provider, notes
      )
      VALUES(
        ${department}, ${serviceType}, ${active}, ${shippingMinor}, ${currency},
        ${etaMinDays}, ${etaMaxDays}, ${provider}, ${notes}
      )
      ON CONFLICT(department, service_type)
      DO UPDATE SET
        active = EXCLUDED.active,
        shipping_minor = EXCLUDED.shipping_minor,
        currency = EXCLUDED.currency,
        eta_min_days = EXCLUDED.eta_min_days,
        eta_max_days = EXCLUDED.eta_max_days,
        provider = EXCLUDED.provider,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *`;
    return json({ zone: rows[0] });
  }

  if (url.pathname === "/v1/internal/fulfillments" && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const status = clean(url.searchParams.get("status"), 32).toUpperCase();
    const rows = await db`
      SELECT f.id, f.order_id, o.order_number, f.type, f.status, f.provider,
             f.department, f.municipality, f.quoted_shipping_minor, f.currency,
             f.eta_min_days, f.eta_max_days, f.created_at, f.updated_at
      FROM fulfillments f
      JOIN orders o ON o.id = f.order_id
      WHERE (${status || null}::text IS NULL OR f.status = ${status || null}::text)
      ORDER BY f.created_at DESC
      LIMIT 100`;
    return json({ data: rows });
  }

  const internalFulfillment = url.pathname.match(/^\/v1\/internal\/fulfillments\/(\d+)$/);
  if (internalFulfillment && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const fulfillment = await loadFulfillment(db, Number(internalFulfillment[1]));
    return fulfillment ? json({ fulfillment }) : json({ error: "not_found" }, 404);
  }

  const statusRoute = url.pathname.match(/^\/v1\/internal\/fulfillments\/(\d+)\/status$/);
  if (statusRoute && req.method === "PATCH") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
    const target = clean(body?.status, 32).toUpperCase();
    const reason = clean(body?.reason, 300) || null;
    const result: any = await transitionFulfillment(
      db,
      Number(statusRoute[1]),
      target,
      "internal",
      reason,
      body?.proof
    );
    if (result.error) return json(result, result.status || 409);
    return json({ fulfillment: await loadFulfillment(db, Number(statusRoute[1])) });
  }

  const attemptRoute = url.pathname.match(/^\/v1\/internal\/fulfillments\/(\d+)\/attempts$/);
  if (attemptRoute && req.method === "POST") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

    const fulfillmentId = Number(attemptRoute[1]);
    const attemptStatus = clean(body?.status, 24).toUpperCase();
    const reason = clean(body?.reason, 500) || null;
    const actor = clean(body?.actor, 120) || "internal";
    const collectorReference = clean(body?.collectorReference, 160) || null;
    const codCollected = body?.codCollected === true;
    let proof: any = {};
    try { proof = normalizeProof(body?.proof); } catch { return json({ error: "proof_too_large" }, 413); }

    if (!["SUCCESS", "FAILED", "REJECTED"].includes(attemptStatus)) {
      return json({ error: "invalid_attempt_status" }, 400);
    }

    const outcome: any = await db.begin(async (tx: DB) => {
      const currentRows = await tx`
        SELECT id, status
        FROM fulfillments
        WHERE id = ${fulfillmentId}
        FOR UPDATE`;
      if (!currentRows.length) return { error: "not_found", status: 404 };
      if (currentRows[0].status !== "OUT_FOR_DELIVERY") {
        return {
          error: "attempt_not_allowed",
          status: 409,
          fulfillmentStatus: currentRows[0].status
        };
      }

      const seq = await tx`
        SELECT COALESCE(MAX(attempt_number), 0)::int + 1 AS next
        FROM delivery_attempts
        WHERE fulfillment_id = ${fulfillmentId}`;
      const attemptNumber = Number(seq[0]?.next || 1);

      await tx`
        INSERT INTO delivery_attempts(
          fulfillment_id, attempt_number, status, reason, proof, actor
        )
        VALUES(
          ${fulfillmentId}, ${attemptNumber}, ${attemptStatus}, ${reason},
          ${JSON.stringify(proof)}::jsonb, ${actor}
        )`;

      const target = attemptStatus === "SUCCESS" ? "DELIVERED" : "FAILED";
      const transition: any = await transitionFulfillmentInTx(
        tx,
        fulfillmentId,
        target,
        actor,
        reason || ("delivery_attempt:" + attemptStatus),
        proof
      );
      if (transition.error) return transition;

      if (attemptStatus === "SUCCESS" && codCollected) {
        const collections = await tx`
          SELECT id, status, expected_amount_minor
          FROM cod_collections
          WHERE fulfillment_id = ${fulfillmentId}
          FOR UPDATE`;
        if (collections.length && collections[0].status === "PENDING") {
          const collectionId = Number(collections[0].id);
          await tx`
            UPDATE cod_collections
            SET status = 'COLLECTED',
                collected_amount_minor = expected_amount_minor,
                collector_reference = ${collectorReference},
                collected_at = NOW(),
                updated_at = NOW()
            WHERE id = ${collectionId}`;
          await tx`
            INSERT INTO cod_collection_history(
              cod_collection_id, from_status, to_status, actor, reason
            )
            VALUES(
              ${collectionId}, 'PENDING', 'COLLECTED', ${actor}, 'collected_at_delivery'
            )`;
        }
      }

      return { ok: true, attemptNumber };
    });

    if (outcome.error) return json(outcome, outcome.status || 409);
    return json({
      fulfillment: await loadFulfillment(db, fulfillmentId),
      attemptNumber: outcome.attemptNumber
    }, 201);
  }

  const eventRoute = url.pathname.match(/^\/v1\/internal\/fulfillments\/(\d+)\/tracking-events$/);
  if (eventRoute && req.method === "POST") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
    const fulfillmentId = Number(eventRoute[1]);
    const eventType = clean(body?.eventType, 80).toUpperCase();
    const status = clean(body?.status, 40).toUpperCase();
    const description = clean(body?.description, 500);
    const providerEventId = clean(body?.providerEventId, 160) || null;
    const locationText = clean(body?.locationText, 220) || null;
    if (!eventType || !status || !description) return json({ error: "tracking_event_required" }, 400);

    if (providerEventId) {
      const inserted = await db`
        INSERT INTO fulfillment_tracking_events(
          fulfillment_id, event_type, status, description, provider_event_id, location_text
        )
        VALUES(
          ${fulfillmentId}, ${eventType}, ${status}, ${description}, ${providerEventId}, ${locationText}
        )
        ON CONFLICT (fulfillment_id, provider_event_id)
          WHERE provider_event_id IS NOT NULL
        DO NOTHING
        RETURNING id, event_type, status, description, location_text, occurred_at`;
      if (inserted.length) return json({ event: inserted[0] }, 201);

      const rows = await db`
        SELECT id, event_type, status, description, location_text, occurred_at
        FROM fulfillment_tracking_events
        WHERE fulfillment_id = ${fulfillmentId}
          AND provider_event_id = ${providerEventId}
        LIMIT 1`;
      return json({ event: rows[0], replayed: true }, 200);
    }

    const rows = await db`
      INSERT INTO fulfillment_tracking_events(
        fulfillment_id, event_type, status, description, location_text
      )
      VALUES(
        ${fulfillmentId}, ${eventType}, ${status}, ${description}, ${locationText}
      )
      RETURNING id, event_type, status, description, location_text, occurred_at`;
    return json({ event: rows[0] }, 201);
  }

  const codRoute = url.pathname.match(/^\/v1\/internal\/cod-collections\/(\d+)\/status$/);
  if (codRoute && req.method === "PATCH") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

    const id = Number(codRoute[1]);
    const target = clean(body?.status, 32).toUpperCase();
    const collectedAmountMinor = body?.collectedAmountMinor == null ? null : Number(body.collectedAmountMinor);
    const collectorReference = clean(body?.collectorReference, 160) || null;
    const reason = clean(body?.reason, 300) || null;

    if (!["COLLECTED", "FAILED", "RECONCILED"].includes(target)) {
      return json({ error: "invalid_status" }, 400);
    }
    if (
      collectedAmountMinor != null &&
      (!Number.isSafeInteger(collectedAmountMinor) || collectedAmountMinor < 0)
    ) {
      return json({ error: "invalid_collected_amount" }, 400);
    }

    const result: any = await db.begin(async (tx: DB) => {
      const rows = await tx`
        SELECT id, payment_id, status, expected_amount_minor, collected_amount_minor
        FROM cod_collections
        WHERE id = ${id}
        FOR UPDATE`;
      if (!rows.length) return { error: "not_found", status: 404 };

      const row = rows[0];
      const current = row.status;
      const allowed =
        (current === "PENDING" && ["COLLECTED", "FAILED"].includes(target)) ||
        (current === "COLLECTED" && target === "RECONCILED");
      if (!allowed) return { error: "invalid_transition", status: 409, current, target };

      if (target === "COLLECTED") {
        const amount = collectedAmountMinor ?? Number(row.expected_amount_minor);
        await tx`
          UPDATE cod_collections
          SET status = 'COLLECTED',
              collected_amount_minor = ${amount},
              collector_reference = ${collectorReference},
              collected_at = NOW(),
              updated_at = NOW()
          WHERE id = ${id}`;
      } else if (target === "FAILED") {
        await tx`
          UPDATE cod_collections
          SET status = 'FAILED',
              collector_reference = ${collectorReference},
              updated_at = NOW()
          WHERE id = ${id}`;
      } else {
        const expected = Number(row.expected_amount_minor);
        const collected = Number(row.collected_amount_minor ?? 0);
        if (expected !== collected) {
          return { error: "cod_amount_mismatch", status: 409, expected, collected };
        }

        const payments = await tx`
          SELECT id, status
          FROM payments
          WHERE id = ${Number(row.payment_id)}
          FOR UPDATE`;
        if (!payments.length) return { error: "payment_not_found", status: 409 };
        if (!["PENDING", "PAID"].includes(payments[0].status)) {
          return {
            error: "payment_not_reconcilable",
            status: 409,
            paymentStatus: payments[0].status
          };
        }

        if (payments[0].status === "PENDING") {
          await tx`
            UPDATE payments
            SET status = 'PAID', updated_at = NOW()
            WHERE id = ${Number(row.payment_id)}`;
          await tx`
            INSERT INTO payment_status_history(
              payment_id, from_status, to_status, actor, reason
            )
            VALUES(
              ${Number(row.payment_id)}, 'PENDING', 'PAID',
              'cod_reconciliation', ${reason || "cod_reconciled"}
            )`;
        }

        await tx`
          UPDATE cod_collections
          SET status = 'RECONCILED',
              reconciled_at = NOW(),
              updated_at = NOW()
          WHERE id = ${id}`;
      }

      await tx`
        INSERT INTO cod_collection_history(
          cod_collection_id, from_status, to_status, actor, reason
        )
        VALUES(${id}, ${current}, ${target}, 'internal', ${reason})`;

      return { ok: true };
    });

    if (result.error) return json(result, result.status || 409);
    const rows = await db`SELECT * FROM cod_collections WHERE id = ${id}`;
    return json({ collection: rows[0] });
  }

  if (url.pathname === "/v1/internal/return-inspections" && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const rows = await db`
      SELECT i.*, f.tracking_reference, o.order_number
      FROM return_inspections i
      JOIN fulfillments f ON f.id = i.fulfillment_id
      JOIN orders o ON o.id = i.order_id
      ORDER BY i.created_at DESC
      LIMIT 100`;
    return json({ data: rows });
  }

  const inspectionRoute = url.pathname.match(/^\/v1\/internal\/return-inspections\/(\d+)$/);
  if (inspectionRoute && req.method === "PATCH") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    return completeReturnInspection(req, Number(inspectionRoute[1]), db, clean);
  }

  if (
    url.pathname.startsWith("/v1/fulfillment") ||
    url.pathname.startsWith("/v1/fulfillments") ||
    url.pathname.startsWith("/v1/internal/fulfillments") ||
    url.pathname.startsWith("/v1/internal/delivery-zones") ||
    url.pathname.startsWith("/v1/internal/cod-collections") ||
    url.pathname.startsWith("/v1/internal/return-inspections")
  ) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
