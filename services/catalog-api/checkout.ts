type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const METHODS = new Set(["CASH", "BANK_TRANSFER", "CASH_ON_DELIVERY"]);
const PAYMENT_STATUSES = new Set(["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]);
const MANUAL_TARGETS = new Set(["PAID", "FAILED", "CANCELLED"]);

export interface PaymentProviderRequest {
  paymentId: number;
  orderId: number;
  amountMinor: number;
  currency: string;
  method: string;
  idempotencyKey: string;
}

export interface PaymentProviderResult {
  provider: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  providerReference?: string | null;
  response?: Record<string, unknown>;
}

export interface PaymentProvider {
  authorize(request: PaymentProviderRequest): Promise<PaymentProviderResult>;
}

export const OfflinePaymentProvider: PaymentProvider = {
  async authorize() {
    return {
      provider: "OFFLINE",
      status: "PENDING",
      providerReference: null,
      response: { mode: "manual_confirmation_required" }
    };
  }
};

function authorized(req: Request) {
  const expected = Bun.env.INTERNAL_API_TOKEN || "";
  const supplied = req.headers.get("x-internal-key") || "";
  return Boolean(expected) && supplied === expected;
}

function requestHash(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeEvidence(raw: any, clean: (v: unknown, max: number) => string) {
  const reference = clean(raw?.reference, 160);
  const note = clean(raw?.note, 500);
  return {
    reference: reference || null,
    note: note || null
  };
}

async function loadCheckout(db: DB, id: number) {
  const rows = await db`
    SELECT
      c.id, c.public_token, c.order_id, c.status, c.payment_method,
      c.currency, c.amount_minor, c.created_at, c.updated_at,
      p.id AS payment_id, p.provider, p.method, p.status AS payment_status,
      p.amount_minor AS payment_amount_minor, p.currency AS payment_currency,
      p.external_reference,
      o.order_number, o.status AS order_status
    FROM checkout_sessions c
    JOIN payments p ON p.checkout_session_id = c.id
    JOIN orders o ON o.id = c.order_id
    WHERE c.id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    token: row.public_token,
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    status: row.status,
    paymentMethod: row.payment_method,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    payment: {
      id: Number(row.payment_id),
      provider: row.provider,
      method: row.method,
      status: row.payment_status,
      amountMinor: Number(row.payment_amount_minor),
      currency: row.payment_currency,
      externalReference: row.external_reference || null
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureCheckoutSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS checkout_sessions (
      id BIGSERIAL PRIMARY KEY,
      public_token TEXT UNIQUE NOT NULL,
      order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      payment_method TEXT NOT NULL,
      currency CHAR(3) NOT NULL,
      amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('OPEN','COMPLETED','CANCELLED','EXPIRED')),
      CHECK (payment_method IN ('CASH','BANK_TRANSFER','CASH_ON_DELIVERY'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      checkout_session_id BIGINT UNIQUE NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
      order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
      currency CHAR(3) NOT NULL,
      external_reference TEXT,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (method IN ('CASH','BANK_TRANSFER','CASH_ON_DELIVERY')),
      CHECK (status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id BIGSERIAL PRIMARY KEY,
      payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_reference TEXT,
      response JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PENDING','SUCCEEDED','FAILED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS payment_status_history (
      id BIGSERIAL PRIMARY KEY,
      payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at DESC)`;
}

async function createCheckout(req: Request, db: DB, clean: (v: unknown, max: number) => string) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) return json({ error: "idempotency_key_required" }, 400);

  const length = Number(req.headers.get("content-length") || 0);
  if (length > 32768) return json({ error: "payload_too_large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  if (body?.amountMinor != null || body?.amount != null || body?.currency != null || body?.total != null) {
    return json({ error: "client_amount_not_allowed" }, 400);
  }

  const orderId = Number(body?.orderId);
  const orderToken = clean(body?.orderToken, 80);
  const paymentMethod = clean(body?.paymentMethod, 40).toUpperCase();
  const evidence = normalizeEvidence(body?.evidence, clean);

  if (!Number.isSafeInteger(orderId) || orderId < 1) return json({ error: "invalid_order" }, 400);
  if (!orderToken) return json({ error: "order_token_required" }, 401);
  if (!METHODS.has(paymentMethod)) return json({ error: "invalid_payment_method" }, 400);

  const normalized = { orderId, orderToken, paymentMethod, evidence };
  const hash = requestHash(normalized);

  const existing = await db`
    SELECT id, idempotency_hash
    FROM checkout_sessions
    WHERE idempotency_key = ${key}
    LIMIT 1`;
  if (existing.length) {
    if (existing[0].idempotency_hash !== hash) return json({ error: "idempotency_conflict" }, 409);
    return json({ checkout: await loadCheckout(db, Number(existing[0].id)), replayed: true }, 200);
  }

  try {
    const created: any = await db.begin(async (tx: DB) => {
      const orders = await tx`
        SELECT id, public_token, order_number, status, currency, grand_total_minor
        FROM orders
        WHERE id = ${orderId}
        FOR UPDATE`;
      if (!orders.length || orders[0].public_token !== orderToken) return { error: "order_not_found", status: 404 };

      const order = orders[0];
      if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(order.status)) {
        return { error: "order_not_checkoutable", status: 409, orderStatus: order.status };
      }

      const prior = await tx`
        SELECT id, idempotency_key
        FROM checkout_sessions
        WHERE order_id = ${orderId}
        LIMIT 1`;
      if (prior.length) {
        return { error: "checkout_exists", status: 409, checkoutId: Number(prior[0].id) };
      }

      const token = crypto.randomUUID();
      const inserted = await tx`
        INSERT INTO checkout_sessions(
          public_token, order_id, status, payment_method, currency, amount_minor,
          idempotency_key, idempotency_hash, metadata
        )
        VALUES(
          ${token}, ${orderId}, 'COMPLETED', ${paymentMethod}, ${order.currency},
          ${Number(order.grand_total_minor)}, ${key}, ${hash}, ${JSON.stringify({ source: "storefront" })}::jsonb
        )
        RETURNING id`;
      const checkoutId = Number(inserted[0].id);

      const fulfillmentRows = await tx`
        SELECT id, type
        FROM fulfillments
        WHERE order_id = ${orderId}
        LIMIT 1`;

      if (paymentMethod === "CASH_ON_DELIVERY") {
        if (!fulfillmentRows.length || fulfillmentRows[0].type === "STORE_PICKUP") {
          return { error: "cod_requires_delivery", status: 409 };
        }
      }

      const paymentRows = await tx`
        INSERT INTO payments(
          checkout_session_id, order_id, provider, method, status, amount_minor, currency,
          external_reference, evidence
        )
        VALUES(
          ${checkoutId}, ${orderId}, 'OFFLINE', ${paymentMethod}, 'PENDING',
          ${Number(order.grand_total_minor)}, ${order.currency},
          ${evidence.reference}, ${JSON.stringify(evidence)}::jsonb
        )
        RETURNING id`;
      const paymentId = Number(paymentRows[0].id);

      if (paymentMethod === "CASH_ON_DELIVERY" && fulfillmentRows.length) {
        await tx`
          INSERT INTO cod_collections(
            fulfillment_id, payment_id, status, expected_amount_minor, currency
          )
          VALUES(
            ${Number(fulfillmentRows[0].id)}, ${paymentId}, 'PENDING',
            ${Number(order.grand_total_minor)}, ${order.currency}
          )
          ON CONFLICT(fulfillment_id) DO NOTHING`;
      }

      const providerResult = await OfflinePaymentProvider.authorize({
        paymentId,
        orderId,
        amountMinor: Number(order.grand_total_minor),
        currency: String(order.currency),
        method: paymentMethod,
        idempotencyKey: key
      });

      await tx`
        INSERT INTO payment_attempts(
          payment_id, provider, idempotency_key, idempotency_hash, status,
          provider_reference, response
        )
        VALUES(
          ${paymentId}, ${providerResult.provider}, ${"checkout:" + key}, ${hash},
          ${providerResult.status}, ${providerResult.providerReference || null},
          ${JSON.stringify(providerResult.response || {})}::jsonb
        )`;

      await tx`
        INSERT INTO payment_status_history(payment_id, from_status, to_status, actor, reason)
        VALUES(${paymentId}, NULL, 'PENDING', 'system', 'checkout_created')`;

      if (order.status === "PENDING_CONFIRMATION") {
        const activeReservations = await tx`
          SELECT COUNT(*)::int AS count
          FROM inventory_reservations
          WHERE order_id = ${orderId}
            AND status = 'ACTIVE'
            AND (expires_at IS NULL OR expires_at > NOW())`;
        if (Number(activeReservations[0]?.count || 0) < 1) {
          throw new Error("reservation_not_active");
        }

        await tx`
          UPDATE inventory_reservations
          SET expires_at = NULL, updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'ACTIVE'`;

        await tx`
          UPDATE orders
          SET status = 'CONFIRMED', updated_at = NOW()
          WHERE id = ${orderId}`;

        await tx`
          INSERT INTO order_status_history(order_id, from_status, to_status, actor, reason)
          VALUES(${orderId}, 'PENDING_CONFIRMATION', 'CONFIRMED', 'checkout', ${"payment_method:" + paymentMethod})`;
      }

      return { checkoutId };
    });

    if (created.error) return json(created, created.status || 409);
    return json({ checkout: await loadCheckout(db, Number(created.checkoutId)), replayed: false }, 201);
  } catch (error: any) {
    if (error?.code === "23505") {
      const rows = await db`
        SELECT id, idempotency_hash
        FROM checkout_sessions
        WHERE idempotency_key = ${key}
        LIMIT 1`;
      if (rows.length && rows[0].idempotency_hash === hash) {
        return json({ checkout: await loadCheckout(db, Number(rows[0].id)), replayed: true }, 200);
      }
      return json({ error: "idempotency_conflict" }, 409);
    }
    if (String(error?.message || "").includes("reservation_not_active")) {
      return json({ error: "reservation_not_active" }, 409);
    }
    console.error("create_checkout_failed", error);
    return json({ error: "checkout_creation_failed" }, 500);
  }
}

export async function handleCheckout(req: Request, url: URL, db: DB, clean: (v: unknown, max: number) => string) {
  if (url.pathname === "/v1/checkouts" && req.method === "POST") {
    return createCheckout(req, db, clean);
  }

  const publicCheckout = url.pathname.match(/^\/v1\/checkouts\/(\d+)$/);
  if (publicCheckout && req.method === "GET") {
    const id = Number(publicCheckout[1]);
    const token = clean(url.searchParams.get("token"), 80);
    if (!token) return json({ error: "token_required" }, 401);
    const rows = await db`SELECT public_token FROM checkout_sessions WHERE id = ${id} LIMIT 1`;
    if (!rows.length || rows[0].public_token !== token) return json({ error: "not_found" }, 404);
    return json({ checkout: await loadCheckout(db, id) });
  }

  if (url.pathname === "/v1/internal/payments" && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const status = clean(url.searchParams.get("status"), 32).toUpperCase();
    const rows = await db`
      SELECT p.id, p.order_id, o.order_number, p.provider, p.method, p.status,
             p.amount_minor, p.currency, p.external_reference, p.created_at, p.updated_at
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE (${status || null}::text IS NULL OR p.status = ${status || null}::text)
      ORDER BY p.created_at DESC
      LIMIT 100`;
    return json({ data: rows });
  }

  const internalPayment = url.pathname.match(/^\/v1\/internal\/payments\/(\d+)$/);
  if (internalPayment && req.method === "GET") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    const id = Number(internalPayment[1]);
    const rows = await db`
      SELECT p.id, p.order_id, o.order_number, p.checkout_session_id, p.provider,
             p.method, p.status, p.amount_minor, p.currency, p.external_reference,
             p.evidence, p.created_at, p.updated_at
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.id = ${id}
      LIMIT 1`;
    return rows.length ? json({ payment: rows[0] }) : json({ error: "not_found" }, 404);
  }

  const internalStatus = url.pathname.match(/^\/v1\/internal\/payments\/(\d+)\/status$/);
  if (internalStatus && req.method === "PATCH") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

    const target = clean(body?.status, 32).toUpperCase();
    const reason = clean(body?.reason, 240) || null;
    if (!PAYMENT_STATUSES.has(target) || !MANUAL_TARGETS.has(target)) return json({ error: "invalid_status" }, 400);

    const id = Number(internalStatus[1]);
    const result: any = await db.begin(async (tx: DB) => {
      const rows = await tx`
        SELECT id, status
        FROM payments
        WHERE id = ${id}
        FOR UPDATE`;
      if (!rows.length) return { error: "not_found", status: 404 };
      const current = rows[0].status;
      if (current !== "PENDING") return { error: "invalid_transition", status: 409, current, target };

      await tx`
        UPDATE payments
        SET status = ${target}, updated_at = NOW()
        WHERE id = ${id}`;

      await tx`
        INSERT INTO payment_status_history(payment_id, from_status, to_status, actor, reason)
        VALUES(${id}, ${current}, ${target}, 'internal', ${reason})`;

      return { ok: true };
    });

    if (result.error) return json(result, result.status || 409);
    const rows = await db`
      SELECT id, order_id, provider, method, status, amount_minor, currency,
             external_reference, updated_at
      FROM payments
      WHERE id = ${id}`;
    return json({ payment: rows[0] });
  }

  if (url.pathname.startsWith("/v1/checkouts") || url.pathname.startsWith("/v1/internal/payments")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
