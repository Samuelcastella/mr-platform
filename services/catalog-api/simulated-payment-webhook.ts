import { authorizeInternal, writeAuditEvent } from "./auth";

// Provider-neutral sandbox receiver. Not homologated with an external gateway.
type DB = any;
const reply = (body: unknown, status = 200) => Response.json(body, { status });
const encoder = new TextEncoder();
export async function signSimulatedWebhook(secret: string, raw: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeHexEqual(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function ensureSimulatedWebhookSchema(db: DB) {
  await db`CREATE TABLE IF NOT EXISTS simulated_payment_events (
    event_id TEXT PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    payload_hash TEXT NOT NULL,
    provider_reference TEXT,
    captured_amount_minor BIGINT,
    captured_currency CHAR(3),
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  // Existing sandbox environments may have the earlier event table without capture evidence.
  await db`ALTER TABLE simulated_payment_events ADD COLUMN IF NOT EXISTS provider_reference TEXT`;
  await db`ALTER TABLE simulated_payment_events ADD COLUMN IF NOT EXISTS captured_amount_minor BIGINT`;
  await db`ALTER TABLE simulated_payment_events ADD COLUMN IF NOT EXISTS captured_currency CHAR(3)`;
  await db`CREATE TABLE IF NOT EXISTS payment_webhook_exceptions (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE REFERENCES simulated_payment_events(event_id),
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    order_id BIGINT NOT NULL REFERENCES orders(id),
    code TEXT NOT NULL,
    resolution_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
export async function handleSimulatedWebhook(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/payments/webhook-exceptions") {
    if (req.method !== "GET") return reply({ error: "method_not_allowed" }, 405);
    const auth = await authorizeInternal(req, db, "payments.read");
    if (!auth.ok) return auth.response;
    const status = url.searchParams.get("status") || "PENDING_REVIEW";
    if (!["PENDING_REVIEW", "ALL"].includes(status))
      return reply({ error: "invalid_status" }, 400);
    const filter = status === "ALL" ? null : status;
    const rows = await db`
      SELECT e.id, e.event_id, e.payment_id, e.order_id, e.code, e.resolution_status,
             e.created_at, s.provider_reference, s.captured_amount_minor, s.captured_currency,
             p.amount_minor AS expected_amount_minor, p.currency AS expected_currency,
             p.status AS payment_status, o.order_number, o.status AS order_status
      FROM payment_webhook_exceptions e
      JOIN simulated_payment_events s ON s.event_id = e.event_id
      JOIN payments p ON p.id = e.payment_id
      JOIN orders o ON o.id = e.order_id
      WHERE (${filter}::text IS NULL OR e.resolution_status = ${filter}::text)
      ORDER BY e.created_at DESC, e.id DESC LIMIT 100`;
    return reply({ data: rows });
  }
  if (url.pathname !== "/v1/webhooks/payments/simulated") return null;
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const secret = Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) return reply({ error: "webhook_not_configured" }, 503);
  const raw = await req.text();
  if (raw.length > 16384) return reply({ error: "payload_too_large" }, 413);
  const signature = req.headers.get("x-simulated-signature") || "";
  const expected = await signSimulatedWebhook(secret, raw);
  if (!constantTimeHexEqual(signature, expected)) return reply({ error: "invalid_signature" }, 401);
  let event: any;
  try { event = JSON.parse(raw); } catch { return reply({ error: "invalid_json" }, 400); }
  if (!event || typeof event.eventId !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(event.eventId)
      || !Number.isSafeInteger(event.paymentId) || event.paymentId < 1
      || !Number.isSafeInteger(event.amountMinor) || event.amountMinor < 0
      || typeof event.currency !== "string" || !/^[A-Z]{3}$/.test(event.currency)
      || typeof event.providerReference !== "string"
      || !/^[A-Za-z0-9_.:-]{8,160}$/.test(event.providerReference)
      || event.type !== "payment.succeeded") return reply({ error: "invalid_event" }, 400);
  const hash = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
  const result = await db.begin(async (tx: DB) => {
    // Verify the referenced payment exists before claiming an event with a payment FK.
    // This read does not lock: the subsequent FOR UPDATE is the authoritative check.
    const paymentLookup = await tx`
      SELECT provider FROM payments WHERE id = ${event.paymentId}`;
    if (!paymentLookup.length || paymentLookup[0].provider !== "SIMULATED")
      return { error: "payment_not_found", status: 404 };
    // Serialize identical event IDs before locking payment/order rows.
    // ON CONFLICT waits for the winning transaction and avoids a unique-key race.
    const claimed = await tx`
      INSERT INTO simulated_payment_events(
        event_id, payment_id, payload_hash, outcome, provider_reference, captured_amount_minor, captured_currency
      )
      VALUES(${event.eventId}, ${event.paymentId}, ${hash}, 'PROCESSING',
             ${event.providerReference}, ${event.amountMinor}, ${event.currency})
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
    const prior = claimed.length ? [] : await tx`SELECT payload_hash, outcome FROM simulated_payment_events WHERE event_id = ${event.eventId}`;
    if (prior.length) return prior[0].payload_hash === hash
      ? { replayed: true, outcome: prior[0].outcome }
      : { error: "event_id_conflict", status: 409 };
    const payments = await tx`
      SELECT p.id, p.order_id, p.status, p.provider, p.amount_minor, p.currency, o.status AS order_status
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ${event.paymentId} FOR UPDATE OF p, o`;
    if (!payments.length || payments[0].provider !== "SIMULATED") {
      // Do not commit a stranded PROCESSING event for unknown/non-sandbox payments.
      await tx`DELETE FROM simulated_payment_events WHERE event_id = ${event.eventId}`;
      return { error: "payment_not_found", status: 404 };
    }
    const payment = payments[0];
    const reservations = await tx`
      SELECT status, expires_at FROM inventory_reservations
      WHERE order_id = ${payment.order_id} FOR UPDATE`;
    const eligible = payment.order_status === "CONFIRMED" &&
      reservations.length > 0 && reservations.every((r: any) =>
        r.status === "ACTIVE" && (r.expires_at == null || new Date(r.expires_at).getTime() > Date.now()));
    const amountMatches = Number(payment.amount_minor) === event.amountMinor &&
      String(payment.currency).trim() === event.currency;
    const outcome = !amountMatches ? "PAYMENT_AMOUNT_MISMATCH" :
      eligible && payment.status === "PENDING" ? "PAID" :
      payment.status === "PAID" ? "ALREADY_PAID" : "LATE_PAYMENT_EXPIRED_RESERVATION";
    await tx`
      UPDATE simulated_payment_events SET outcome = ${outcome} WHERE event_id = ${event.eventId}`;
    if (outcome === "PAID") {
      await tx`UPDATE payments SET status = 'PAID', updated_at = NOW() WHERE id = ${event.paymentId}`;
      await tx`
        INSERT INTO payment_status_history(payment_id, from_status, to_status, actor, reason)
        VALUES(${event.paymentId}, 'PENDING', 'PAID', 'webhook:simulated', ${event.eventId})`;
      await writeAuditEvent(tx, {
        actorType: "SERVICE", actorService: "simulated-payment-webhook",
        action: "payment.webhook_confirmed", resourceType: "Payment",
        resourceId: event.paymentId, outcome: "SUCCESS",
        correlationId: event.eventId,
        metadata: { eventId: event.eventId, orderId: Number(payment.order_id), providerReference: event.providerReference, amountMinor: event.amountMinor, currency: event.currency, fromStatus: "PENDING", toStatus: "PAID" }
      });
    } else if (outcome === "LATE_PAYMENT_EXPIRED_RESERVATION" || outcome === "PAYMENT_AMOUNT_MISMATCH") {
      await tx`
        INSERT INTO payment_webhook_exceptions(event_id, payment_id, order_id, code)
        VALUES(${event.eventId}, ${event.paymentId}, ${payment.order_id}, ${outcome})`;
      await writeAuditEvent(tx, {
        actorType: "SERVICE", actorService: "simulated-payment-webhook",
        action: "payment.webhook_exception", resourceType: "Payment",
        resourceId: event.paymentId, outcome: "SUCCESS",
        reason: outcome, correlationId: event.eventId,
        metadata: { eventId: event.eventId, orderId: Number(payment.order_id), paymentStatus: payment.status, orderStatus: payment.order_status, providerReference: event.providerReference, amountMinor: event.amountMinor, currency: event.currency }
      });
    }
    return { replayed: false, outcome };
  });
  if (result.error) return reply(result, result.status);
  return reply(result, 200);
}
