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
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
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
      || event.type !== "payment.succeeded") return reply({ error: "invalid_event" }, 400);
  const hash = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
  const result = await db.begin(async (tx: DB) => {
    // Serialize identical event IDs before locking payment/order rows.
    // ON CONFLICT waits for the winning transaction and avoids a unique-key race.
    const claimed = await tx`
      INSERT INTO simulated_payment_events(event_id, payment_id, payload_hash, outcome)
      VALUES(${event.eventId}, ${event.paymentId}, ${hash}, 'PROCESSING')
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
    const prior = claimed.length ? [] : await tx`SELECT payload_hash, outcome FROM simulated_payment_events WHERE event_id = ${event.eventId}`;
    if (prior.length) return prior[0].payload_hash === hash
      ? { replayed: true, outcome: prior[0].outcome }
      : { error: "event_id_conflict", status: 409 };
    const payments = await tx`
      SELECT p.id, p.order_id, p.status, p.provider, o.status AS order_status
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ${event.paymentId} FOR UPDATE OF p, o`;
    if (!payments.length || payments[0].provider !== "SIMULATED")
      return { error: "payment_not_found", status: 404 };
    const payment = payments[0];
    const reservations = await tx`
      SELECT status, expires_at FROM inventory_reservations
      WHERE order_id = ${payment.order_id} FOR UPDATE`;
    const eligible = payment.order_status === "CONFIRMED" &&
      reservations.length > 0 && reservations.every((r: any) =>
        r.status === "ACTIVE" && (r.expires_at == null || new Date(r.expires_at).getTime() > Date.now()));
    const outcome = eligible && payment.status === "PENDING" ? "PAID" :
      payment.status === "PAID" ? "ALREADY_PAID" : "LATE_PAYMENT_EXPIRED_RESERVATION";
    await tx`
      UPDATE simulated_payment_events SET outcome = ${outcome} WHERE event_id = ${event.eventId}`;
    if (outcome === "PAID") {
      await tx`UPDATE payments SET status = 'PAID', updated_at = NOW() WHERE id = ${event.paymentId}`;
      await tx`
        INSERT INTO payment_status_history(payment_id, from_status, to_status, actor, reason)
        VALUES(${event.paymentId}, 'PENDING', 'PAID', 'webhook:simulated', ${event.eventId})`;
    } else if (outcome === "LATE_PAYMENT_EXPIRED_RESERVATION") {
      await tx`
        INSERT INTO payment_webhook_exceptions(event_id, payment_id, order_id, code)
        VALUES(${event.eventId}, ${event.paymentId}, ${payment.order_id}, 'LATE_PAYMENT_EXPIRED_RESERVATION')`;
    }
    return { replayed: false, outcome };
  });
  if (result.error) return reply(result, result.status);
  return reply(result, 200);
}
