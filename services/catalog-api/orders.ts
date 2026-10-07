type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const ORDER_STATUSES = new Set([
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED"
]);

const CHANNELS = new Set(["STORE", "PHONE", "WHATSAPP", "WEB", "APP", "MARKETPLACE"]);

const ALLOWED: Record<string, Set<string>> = {
  PENDING_CONFIRMATION: new Set(["CONFIRMED", "CANCELLED"]),
  CONFIRMED: new Set(["PROCESSING", "CANCELLED"]),
  PROCESSING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["SHIPPED", "COMPLETED", "CANCELLED"]),
  SHIPPED: new Set(["DELIVERED"]),
  DELIVERED: new Set(["COMPLETED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set()
};

function authorized(req: Request) {
  const expected = Bun.env.INTERNAL_API_TOKEN || "";
  const supplied = req.headers.get("x-internal-key") || "";
  return Boolean(expected) && supplied === expected;
}

function orderNumber() {
  return "MR-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
}

function canonicalize(body: any, clean: (v: unknown, max: number) => string) {
  const channel = clean(body?.channel, 24).toUpperCase() || "WEB";
  const locationId = Number(body?.locationId);
  const customerName = clean(body?.customer?.name, 120);
  const customerPhone = clean(body?.customer?.phone, 80);
  const aggregated = new Map<number, number>();

  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 30) {
    return { error: "items_required" as const };
  }

  for (const raw of body.items) {
    const variantId = Number(raw?.variantId);
    const quantity = Number(raw?.quantity);
    if (!Number.isSafeInteger(variantId) || variantId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      return { error: "invalid_item" as const };
    }
    aggregated.set(variantId, (aggregated.get(variantId) || 0) + quantity);
  }

  const items = [...aggregated.entries()]
    .map(([variantId, quantity]) => ({ variantId, quantity }))
    .sort((a, b) => a.variantId - b.variantId);

  return {
    value: {
      channel,
      locationId: Number.isSafeInteger(locationId) && locationId > 0 ? locationId : null,
      customer: {
        name: customerName || null,
        phone: customerPhone || null
      },
      items
    }
  };
}

function requestHash(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapOrder(row: any, items: any[] = [], reservations: any[] = []) {
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    token: row.public_token,
    channel: row.channel,
    status: row.status,
    currency: row.currency,
    subtotalMinor: Number(row.subtotal_minor),
    discountTotalMinor: Number(row.discount_total_minor),
    taxTotalMinor: Number(row.tax_total_minor),
    shippingTotalMinor: Number(row.shipping_total_minor),
    grandTotalMinor: Number(row.grand_total_minor),
    locationId: Number(row.location_id),
    customer: {
      name: row.customer_name || null,
      phone: row.customer_phone || null
    },
    cancellationReason: row.cancellation_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item: any) => ({
      id: Number(item.id),
      variantId: item.variant_id == null ? null : Number(item.variant_id),
      sku: item.sku_snapshot,
      productName: item.product_name_snapshot,
      variant: item.variant_snapshot || {},
      quantity: Number(item.quantity),
      unitPriceMinor: Number(item.unit_price_minor),
      currency: item.currency,
      lineTotalMinor: Number(item.line_total_minor)
    })),
    reservations: reservations.map((r: any) => ({
      id: Number(r.id),
      variantId: Number(r.variant_id),
      locationId: Number(r.location_id),
      quantity: Number(r.quantity),
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  };
}

async function loadOrder(db: DB, id: number) {
  const rows = await db`
    SELECT id, order_number, public_token, channel, status, currency,
           subtotal_minor, discount_total_minor, tax_total_minor, shipping_total_minor, grand_total_minor,
           location_id, customer_name, customer_phone, cancellation_reason, created_at, updated_at
    FROM orders
    WHERE id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;

  const items = await db`
    SELECT id, variant_id, sku_snapshot, product_name_snapshot, variant_snapshot,
           quantity, unit_price_minor, currency, line_total_minor
    FROM order_items
    WHERE order_id = ${id}
    ORDER BY id`;

  const reservations = await db`
    SELECT id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at
    FROM inventory_reservations
    WHERE order_id = ${id}
    ORDER BY id`;

  return mapOrder(rows[0], items, reservations);
}

async function releaseReservations(tx: DB, orderId: number, status: "RELEASED" | "EXPIRED") {
  const reservations = await tx`
    SELECT id, variant_id, location_id, quantity
    FROM inventory_reservations
    WHERE order_id = ${orderId} AND status = 'ACTIVE'
    ORDER BY variant_id
    FOR UPDATE`;

  for (const r of reservations) {
    const updated = await tx`
      UPDATE inventory
      SET reserved = reserved - ${Number(r.quantity)}, updated_at = NOW()
      WHERE variant_id = ${Number(r.variant_id)}
        AND location_id = ${Number(r.location_id)}
        AND reserved >= ${Number(r.quantity)}
      RETURNING variant_id`;
    if (!updated.length) throw new Error("reservation_invariant_failed");
  }

  if (reservations.length) {
    await tx`
      UPDATE inventory_reservations
      SET status = ${status}, updated_at = NOW()
      WHERE order_id = ${orderId} AND status = 'ACTIVE'`;
  }
}

async function consumeReservations(tx: DB, orderId: number) {
  const reservations = await tx`
    SELECT id, variant_id, location_id, quantity
    FROM inventory_reservations
    WHERE order_id = ${orderId} AND status = 'ACTIVE'
    ORDER BY variant_id
    FOR UPDATE`;

  for (const r of reservations) {
    const quantity = Number(r.quantity);
    const variantId = Number(r.variant_id);
    const locationId = Number(r.location_id);
    const updated = await tx`
      UPDATE inventory
      SET quantity = quantity - ${quantity},
          reserved = reserved - ${quantity},
          updated_at = NOW()
      WHERE variant_id = ${variantId}
        AND location_id = ${locationId}
        AND quantity >= ${quantity}
        AND reserved >= ${quantity}
      RETURNING variant_id`;
    if (!updated.length) throw new Error("inventory_consume_failed");

    await tx`
      INSERT INTO inventory_movements
        (variant_id, location_id, movement_type, quantity, reference, notes)
      VALUES
        (${variantId}, ${locationId}, 'SALE', ${-quantity}, ${"order:" + orderId}, 'Order inventory consumption')`;
  }

  if (reservations.length) {
    await tx`
      UPDATE inventory_reservations
      SET status = 'CONSUMED', updated_at = NOW()
      WHERE order_id = ${orderId} AND status = 'ACTIVE'`;
  }
}

async function transitionOrder(db: DB, orderId: number, target: string, actor: string, reason?: string | null) {
  if (!ORDER_STATUSES.has(target)) return { error: "invalid_status", status: 400 };

  try {
    const result = await db.begin(async (tx: DB) => {
      const rows = await tx`
        SELECT id, status
        FROM orders
        WHERE id = ${orderId}
        FOR UPDATE`;
      if (!rows.length) return { error: "not_found", status: 404 };

      const current = rows[0].status;
      if (!ALLOWED[current]?.has(target)) {
        return { error: "invalid_transition", status: 409, current, target };
      }

      if (target === "CONFIRMED") {
        await tx`
          UPDATE inventory_reservations
          SET expires_at = NULL, updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'ACTIVE'`;
      }

      if (target === "CANCELLED") {
        await releaseReservations(tx, orderId, "RELEASED");
      }

      if (current === "READY" && (target === "SHIPPED" || target === "COMPLETED")) {
        await consumeReservations(tx, orderId);
      }

      await tx`
        UPDATE orders
        SET status = ${target},
            cancellation_reason = CASE WHEN ${target} = 'CANCELLED' THEN ${reason || null} ELSE cancellation_reason END,
            updated_at = NOW()
        WHERE id = ${orderId}`;

      await tx`
        INSERT INTO order_status_history(order_id, from_status, to_status, actor, reason)
        VALUES(${orderId}, ${current}, ${target}, ${actor}, ${reason || null})`;

      return { ok: true };
    });
    return result;
  } catch (error: any) {
    return { error: error?.message || "transition_failed", status: 409 };
  }
}

export async function expirePendingReservations(db: DB) {
  return db.begin(async (tx: DB) => {
    const expired = await tx`
      SELECT o.id AS order_id
      FROM orders o
      WHERE o.status = 'PENDING_CONFIRMATION'
        AND EXISTS (
          SELECT 1
          FROM inventory_reservations r
          WHERE r.order_id = o.id
            AND r.status = 'ACTIVE'
            AND r.expires_at IS NOT NULL
            AND r.expires_at <= NOW()
        )
      ORDER BY o.id
      FOR UPDATE OF o SKIP LOCKED`;

    let count = 0;
    for (const row of expired) {
      const orderId = Number(row.order_id);
      await releaseReservations(tx, orderId, "EXPIRED");
      await tx`
        UPDATE orders
        SET status = 'CANCELLED', cancellation_reason = 'reservation_expired', updated_at = NOW()
        WHERE id = ${orderId} AND status = 'PENDING_CONFIRMATION'`;
      await tx`
        INSERT INTO order_status_history(order_id, from_status, to_status, actor, reason)
        VALUES(${orderId}, 'PENDING_CONFIRMATION', 'CANCELLED', 'system', 'reservation_expired')`;
      count++;
    }
    return count;
  });
}

export async function ensureOrdersSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      public_token TEXT UNIQUE NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
      currency CHAR(3) NOT NULL,
      subtotal_minor BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
      discount_total_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_total_minor >= 0),
      tax_total_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_total_minor >= 0),
      shipping_total_minor BIGINT NOT NULL DEFAULT 0 CHECK (shipping_total_minor >= 0),
      grand_total_minor BIGINT NOT NULL DEFAULT 0 CHECK (grand_total_minor >= 0),
      location_id BIGINT NOT NULL REFERENCES locations(id),
      customer_name TEXT,
      customer_phone TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      cancellation_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (channel IN ('STORE','PHONE','WHATSAPP','WEB','APP','MARKETPLACE')),
      CHECK (status IN ('PENDING_CONFIRMATION','CONFIRMED','PROCESSING','READY','SHIPPED','DELIVERED','COMPLETED','CANCELLED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
      sku_snapshot TEXT NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      variant_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      currency CHAR(3) NOT NULL,
      line_total_minor BIGINT NOT NULL CHECK (line_total_minor >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id, variant_id, location_id),
      CHECK (status IN ('ACTIVE','RELEASED','CONSUMED','EXPIRED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON inventory_reservations(status, expires_at) WHERE status = 'ACTIVE'`;

  await db.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_reserved_lte_quantity'
      ) THEN
        ALTER TABLE inventory
          ADD CONSTRAINT inventory_reserved_lte_quantity CHECK (reserved <= quantity);
      END IF;
    END $$;
  `);
}

async function createOrder(req: Request, db: DB, clean: (v: unknown, max: number) => string) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) return json({ error: "idempotency_key_required" }, 400);

  const length = Number(req.headers.get("content-length") || 0);
  if (length > 32768) return json({ error: "payload_too_large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const normalized = canonicalize(body, clean);
  if ("error" in normalized) return json({ error: normalized.error }, 400);
  if (!CHANNELS.has(normalized.value.channel)) return json({ error: "invalid_channel" }, 400);

  const hash = requestHash(normalized.value);

  const existing = await db`
    SELECT id, idempotency_hash
    FROM orders
    WHERE idempotency_key = ${key}
    LIMIT 1`;
  if (existing.length) {
    if (existing[0].idempotency_hash !== hash) return json({ error: "idempotency_conflict" }, 409);
    const order = await loadOrder(db, Number(existing[0].id));
    return json({ order, replayed: true }, 200);
  }

  await expirePendingReservations(db).catch(() => 0);

  try {
    const created = await db.begin(async (tx: DB) => {
      let locationId = normalized.value.locationId;
      if (locationId) {
        const locations = await tx`SELECT id FROM locations WHERE id = ${locationId} AND active LIMIT 1`;
        if (!locations.length) return { error: "invalid_location", status: 400 };
      } else {
        const locations = await tx`SELECT id FROM locations WHERE active ORDER BY id LIMIT 1`;
        if (!locations.length) return { error: "no_active_location", status: 409 };
        locationId = Number(locations[0].id);
      }

      const lineSnapshots: any[] = [];
      let currency: string | null = null;
      let subtotalMinor = 0;

      for (const item of normalized.value.items) {
        const rows = await tx`
          SELECT pv.id, pv.sku, pv.size, pv.color,
                 ROUND(pv.price * 100)::bigint AS price_minor,
                 pv.currency, p.name AS product_name,
                 i.quantity, i.reserved
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          JOIN inventory i ON i.variant_id = pv.id AND i.location_id = ${locationId}
          WHERE pv.id = ${item.variantId}
            AND pv.active
            AND p.status = 'active'
          FOR UPDATE OF i`;

        if (!rows.length) return { error: "variant_not_available", status: 409, variantId: item.variantId };
        const row = rows[0];
        const available = Number(row.quantity) - Number(row.reserved);
        if (available < item.quantity) return { error: "insufficient_stock", status: 409, variantId: item.variantId, available };

        const lineCurrency = String(row.currency);
        if (currency && currency !== lineCurrency) return { error: "mixed_currency_not_supported", status: 409 };
        currency = lineCurrency;

        const unitPriceMinor = Number(row.price_minor);
        const lineTotalMinor = unitPriceMinor * item.quantity;
        if (!Number.isSafeInteger(lineTotalMinor)) return { error: "amount_too_large", status: 400 };

        lineSnapshots.push({
          variantId: item.variantId,
          quantity: item.quantity,
          sku: row.sku,
          productName: row.product_name,
          variant: { size: row.size || null, color: row.color || null },
          unitPriceMinor,
          currency: lineCurrency,
          lineTotalMinor
        });
        subtotalMinor += lineTotalMinor;
      }

      const number = orderNumber();
      const token = crypto.randomUUID();
      const configuredTtl = Number(Bun.env.ORDER_RESERVATION_TTL_MINUTES || 30);
      const ttlMinutes = Number.isFinite(configuredTtl) ? Math.min(1440, Math.max(1, Math.trunc(configuredTtl))) : 30;

      const inserted = await tx`
        INSERT INTO orders (
          order_number, public_token, channel, status, currency,
          subtotal_minor, discount_total_minor, tax_total_minor, shipping_total_minor, grand_total_minor,
          location_id, customer_name, customer_phone, idempotency_key, idempotency_hash
        )
        VALUES (
          ${number}, ${token}, ${normalized.value.channel}, 'PENDING_CONFIRMATION', ${currency || "HNL"},
          ${subtotalMinor}, 0, 0, 0, ${subtotalMinor},
          ${locationId}, ${normalized.value.customer.name}, ${normalized.value.customer.phone}, ${key}, ${hash}
        )
        RETURNING id`;
      const orderId = Number(inserted[0].id);

      for (const line of lineSnapshots) {
        await tx`
          INSERT INTO order_items (
            order_id, variant_id, sku_snapshot, product_name_snapshot, variant_snapshot,
            quantity, unit_price_minor, currency, line_total_minor
          )
          VALUES (
            ${orderId}, ${line.variantId}, ${line.sku}, ${line.productName}, ${JSON.stringify(line.variant)}::jsonb,
            ${line.quantity}, ${line.unitPriceMinor}, ${line.currency}, ${line.lineTotalMinor}
          )`;

        const inv = await tx`
          UPDATE inventory
          SET reserved = reserved + ${line.quantity}, updated_at = NOW()
          WHERE variant_id = ${line.variantId}
            AND location_id = ${locationId}
            AND quantity - reserved >= ${line.quantity}
          RETURNING variant_id`;
        if (!inv.length) throw new Error("insufficient_stock");

        await tx`
          INSERT INTO inventory_reservations(order_id, variant_id, location_id, quantity, status, expires_at)
          VALUES(
            ${orderId}, ${line.variantId}, ${locationId}, ${line.quantity}, 'ACTIVE',
            NOW() + (${ttlMinutes} * INTERVAL '1 minute')
          )`;
      }

      await tx`
        INSERT INTO order_status_history(order_id, from_status, to_status, actor, reason)
        VALUES(${orderId}, NULL, 'PENDING_CONFIRMATION', 'public', 'order_created')`;

      return { orderId };
    });

    if ((created as any).error) {
      const e: any = created;
      return json({ error: e.error, variantId: e.variantId, available: e.available }, e.status || 400);
    }

    const order = await loadOrder(db, Number((created as any).orderId));
    return json({ order, replayed: false }, 201);
  } catch (error: any) {
    if (error?.code === "23505") {
      const rows = await db`SELECT id, idempotency_hash FROM orders WHERE idempotency_key = ${key} LIMIT 1`;
      if (rows.length && rows[0].idempotency_hash === hash) {
        const order = await loadOrder(db, Number(rows[0].id));
        return json({ order, replayed: true }, 200);
      }
      return json({ error: "idempotency_conflict" }, 409);
    }
    if (String(error?.message || "").includes("insufficient_stock")) return json({ error: "insufficient_stock" }, 409);
    console.error("create_order_failed", error);
    return json({ error: "order_creation_failed" }, 500);
  }
}

export async function handleOrders(req: Request, url: URL, db: DB, clean: (v: unknown, max: number) => string) {
  if (url.pathname === "/v1/orders" && req.method === "POST") {
    return createOrder(req, db, clean);
  }

  const publicOrder = url.pathname.match(/^\/v1\/orders\/(\d+)$/);
  if (publicOrder && req.method === "GET") {
    await expirePendingReservations(db).catch(() => 0);
    const id = Number(publicOrder[1]);
    const token = clean(url.searchParams.get("token"), 80);
    if (!token) return json({ error: "token_required" }, 401);
    const rows = await db`SELECT public_token FROM orders WHERE id = ${id} LIMIT 1`;
    if (!rows.length || rows[0].public_token !== token) return json({ error: "not_found" }, 404);
    return json({ order: await loadOrder(db, id) });
  }

  const publicAction = url.pathname.match(/^\/v1\/orders\/(\d+)\/(confirm|cancel)$/);
  if (publicAction && req.method === "POST") {
    const id = Number(publicAction[1]);
    const action = publicAction[2];
    const token = clean(url.searchParams.get("token"), 80);
    if (!token) return json({ error: "token_required" }, 401);
    const rows = await db`SELECT public_token FROM orders WHERE id = ${id} LIMIT 1`;
    if (!rows.length || rows[0].public_token !== token) return json({ error: "not_found" }, 404);
    const result: any = await transitionOrder(db, id, action === "confirm" ? "CONFIRMED" : "CANCELLED", "public", action === "cancel" ? "customer_cancelled" : null);
    if (result.error) return json(result, result.status || 409);
    return json({ order: await loadOrder(db, id) });
  }

  if (url.pathname === "/v1/internal/orders" && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const status = clean(url.searchParams.get("status"), 32).toUpperCase();
    const rows = await db`
      SELECT id, order_number, channel, status, currency, grand_total_minor, location_id,
             customer_name, customer_phone, created_at, updated_at
      FROM orders
      WHERE (${status || null}::text IS NULL OR status = ${status || null}::text)
      ORDER BY created_at DESC
      LIMIT 100`;
    return json({ data: rows });
  }

  const internalOrder = url.pathname.match(/^\/v1\/internal\/orders\/(\d+)$/);
  if (internalOrder && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const order = await loadOrder(db, Number(internalOrder[1]));
    return order ? json({ order }) : json({ error: "not_found" }, 404);
  }

  const internalStatus = url.pathname.match(/^\/v1\/internal\/orders\/(\d+)\/status$/);
  if (internalStatus && req.method === "PATCH") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
    const target = clean(body?.status, 32).toUpperCase();
    const reason = clean(body?.reason, 240) || null;
    const result: any = await transitionOrder(db, Number(internalStatus[1]), target, "internal", reason);
    if (result.error) return json(result, result.status || 409);
    return json({ order: await loadOrder(db, Number(internalStatus[1])) });
  }

  if (url.pathname === "/v1/internal/reservations/expire" && req.method === "POST") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const expired = await expirePendingReservations(db);
    return json({ expired });
  }

  if (url.pathname.startsWith("/v1/orders") || url.pathname.startsWith("/v1/internal/orders") || url.pathname.startsWith("/v1/internal/reservations")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
