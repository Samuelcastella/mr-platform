import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

const ACTIONS: Record<string, { permission: string; from: string; to: string }> = {
  START_REVIEW: { permission: "payments.exceptions.review", from: "PENDING_REVIEW", to: "IN_REVIEW" },
  REQUEST_REVALIDATION: { permission: "payments.exceptions.review", from: "IN_REVIEW", to: "REVALIDATION_REQUESTED" },
  REQUEST_REFUND: { permission: "payments.refund", from: "IN_REVIEW", to: "REFUND_REQUESTED" }
};

export async function ensurePaymentExceptionReviewSchema(db: DB) {
  await db`ALTER TABLE payment_webhook_exceptions ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT REFERENCES staff_users(id)`;
  await db`ALTER TABLE payment_webhook_exceptions ADD COLUMN IF NOT EXISTS last_action_by_user_id BIGINT REFERENCES staff_users(id)`;
  await db`ALTER TABLE payment_webhook_exceptions ADD COLUMN IF NOT EXISTS resolution_reason TEXT`;
  await db`ALTER TABLE payment_webhook_exceptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await db`CREATE TABLE IF NOT EXISTS payment_webhook_exception_review_actions (
    id BIGSERIAL PRIMARY KEY,
    exception_id BIGINT NOT NULL REFERENCES payment_webhook_exceptions(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    actor_user_id BIGINT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('START_REVIEW','REQUEST_REVALIDATION','REQUEST_REFUND')),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_webhook_exception_reviews ON payment_webhook_exception_review_actions(exception_id, created_at DESC)`;
}

export async function handlePaymentExceptionReview(req: Request, url: URL, db: DB) {
  const route = url.pathname.match(/^\/v1\/internal\/payments\/webhook-exceptions\/(\d+)\/review$/);
  if (!route) return null;
  if (req.method !== "PATCH") return reply({ error: "method_not_allowed" }, 405);
  const id = Number(route[1]);
  if (!Number.isSafeInteger(id) || id < 1) return reply({ error: "invalid_exception" }, 400);

  const key = (req.headers.get("idempotency-key") || "").trim();
  if (key.length < 8 || key.length > 128) return reply({ error: "idempotency_key_required" }, 400);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 8192) return reply({ error: "payload_too_large" }, 413);
  let payload: any;
  try { payload = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const action = typeof payload?.action === "string" ? payload.action : "";
  const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
  const transition = ACTIONS[action];
  if (!transition) return reply({ error: "invalid_action" }, 400);
  if (reason.length < 12 || reason.length > 500) return reply({ error: "reason_required" }, 400);

  const scope = await db`
    SELECT o.location_id FROM payment_webhook_exceptions e
    JOIN orders o ON o.id = e.order_id WHERE e.id = ${id}`;
  if (!scope.length) return reply({ error: "not_found" }, 404);
  const auth = await authorizeInternal(req, db, transition.permission, {
    locationId: Number(scope[0].location_id), mutation: true
  });
  if (!auth.ok) return auth.response;
  // Human approval only. The legacy x-internal-key must never request refunds.
  if (auth.actor.type !== "USER") return reply({ error: "staff_approval_required" }, 403);
  const actorId = Number(auth.actor.userId);
  const requestHash = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify({ exceptionId: id, action, reason, actorId })).digest("hex");

  const result = await db.begin(async (tx: DB) => {
    const rows = await tx`
      SELECT id, payment_id, order_id, code, resolution_status, reviewed_by_user_id
      FROM payment_webhook_exceptions WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) return { error: "not_found", status: 404 };
    const current = rows[0];
    const previous = await tx`
      SELECT exception_id, request_hash, to_status
      FROM payment_webhook_exception_review_actions WHERE idempotency_key = ${key}`;
    if (previous.length) {
      if (Number(previous[0].exception_id) !== id || previous[0].request_hash !== requestHash)
        return { error: "idempotency_conflict", status: 409 };
      return { ok: true, replayed: true, status: previous[0].to_status };
    }
    if (current.resolution_status !== transition.from)
      return { error: "invalid_transition", status: 409, current: current.resolution_status };
    if (action === "REQUEST_REFUND" && Number(current.reviewed_by_user_id) === actorId)
      return { error: "separate_refund_approver_required", status: 403 };

    await tx`
      UPDATE payment_webhook_exceptions
      SET resolution_status = ${transition.to},
          reviewed_by_user_id = CASE WHEN ${action} = 'START_REVIEW' THEN ${actorId} ELSE reviewed_by_user_id END,
          last_action_by_user_id = ${actorId},
          resolution_reason = ${reason}, updated_at = NOW()
      WHERE id = ${id}`;
    await tx`
      INSERT INTO payment_webhook_exception_review_actions(
        exception_id, idempotency_key, request_hash, actor_user_id, action, from_status, to_status, reason
      )
      VALUES(${id}, ${key}, ${requestHash}, ${actorId}, ${action},
             ${current.resolution_status}, ${transition.to}, ${reason})`;
    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "payment.webhook_exception_reviewed",
      resourceType: "PaymentWebhookException",
      resourceId: id,
      locationId: Number(scope[0].location_id),
      outcome: "SUCCESS",
      reason,
      correlationId: key,
      metadata: {
        eventCode: current.code, paymentId: Number(current.payment_id),
        orderId: Number(current.order_id), action,
        fromStatus: current.resolution_status, toStatus: transition.to,
        externalRefundExecuted: false
      }
    });
    return { ok: true, replayed: false, status: transition.to };
  });

  if (result.error) return reply(result, result.status);
  return reply(result);
}
