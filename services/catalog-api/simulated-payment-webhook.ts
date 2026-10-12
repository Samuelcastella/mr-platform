import { authorizeInternal, writeAuditEvent } from "./auth";
import { createPaymentGatewayAdapter } from "./payment-gateway-adapter";
export { signSimulatedWebhook } from "./payment-gateway-adapter";

// Provider-neutral sandbox receiver. Not homologated with an external gateway.
type DB = any;
const reply = (body: unknown, status = 200) => Response.json(body, { status });
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
  // Verify raw UTF-8 bytes before parsing; never authenticate re-serialized JSON.
  const rawBytes = new Uint8Array(await req.arrayBuffer());
  if (rawBytes.byteLength > 16384) return reply({ error: "payload_too_large" }, 413);
  const gateway = createPaymentGatewayAdapter("SIMULATED", secret);
  if (!(await gateway.verifyWebhookSignature(req.headers, rawBytes)))
    return reply({ error: "invalid_signature" }, 401);
  const normalized = gateway.parseWebhookEvent(rawBytes);
  if (!normalized || normalized.kind !== "PAYMENT_CAPTURED" ||
      !Number.isSafeInteger(Number(normalized.paymentReference)))
    return reply({ error: "invalid_event" }, 400);
  const event = {
    eventId: normalized.eventId,
    paymentId: Number(normalized.paymentReference),
    providerReference: normalized.providerEventId!,
    amountMinor: normalized.amountMinor,
    currency: normalized.currency
  };
  const hash = new Bun.CryptoHasher("sha256").update(rawBytes).digest("hex");
  const result = await db.begin(async (tx: DB) => {
    // Lock the payment/order BEFORE inserting a referencing event.
    // The FK's KEY SHARE lock acquired by INSERT otherwise causes lock upgrade
    // deadlocks when different event IDs arrive for the same payment concurrently.
    const payments = await tx`
      SELECT p.id, p.order_id, p.status, p.provider, p.amount_minor, p.currency, o.status AS order_status
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ${event.paymentId} FOR UPDATE OF p, o`;
    if (!payments.length || payments[0].provider !== "SIMULATED")
      return { error: "payment_not_found", status: 404 };
    const payment = payments[0];
    // Serialize identical event IDs after securing the payment lock.
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
