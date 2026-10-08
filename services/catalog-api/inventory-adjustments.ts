import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const STATUSES = new Set(["DRAFT","SUBMITTED","APPROVED","REJECTED","POSTED","CANCELLED"]);
const REASONS = new Set([
  "COUNT_VARIANCE_NEGATIVE","COUNT_VARIANCE_POSITIVE","DAMAGE",
  "THEFT_SUSPECTED","THEFT_CONFIRMED","LOSS_IN_TRANSIT","LOST_IN_STORE",
  "EXPIRED","CONTAMINATED","DESTRUCTION","ADMIN_CORRECTION","RECOVERY_FOUND","OTHER"
]);
const EVIDENCE_REQUIRED = new Set([
  "THEFT_SUSPECTED","THEFT_CONFIRMED","LOSS_IN_TRANSIT","DESTRUCTION"
]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });

async function readBody(req: Request) {
  try { return await req.json(); } catch { return null; }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function signedInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n !== 0 && Math.abs(n) <= 1000000 ? n : null;
}

function sha256(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function requestNumber() {
  return "ADJ-" + new Date().toISOString().slice(0, 10).replaceAll("-", "") + "-" +
    crypto.randomUUID().slice(0, 8).toUpperCase();
}

function movementType(reason: string) {
  if (["DAMAGE","EXPIRED","CONTAMINATED"].includes(reason)) return "DAMAGE";
  if (["THEFT_SUSPECTED","THEFT_CONFIRMED","LOSS_IN_TRANSIT","LOST_IN_STORE","DESTRUCTION"].includes(reason)) return "LOSS";
  return "ADJUSTMENT";
}

function actorUserId(actor: any) {
  return actor.type === "USER" ? actor.userId : null;
}

function actorService(actor: any) {
  return actor.type === "SERVICE" ? actor.service : null;
}

function humanActionAllowed(actor: any) {
  return actor.type === "USER" || Bun.env.ALLOW_SERVICE_WORKFLOW_ACTIONS === "true";
}

export async function ensureInventoryAdjustmentsSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS inventory_adjustment_requests (
      id BIGSERIAL PRIMARY KEY,
      request_number TEXT UNIQUE NOT NULL,
      location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      reason_code TEXT NOT NULL,
      reason_text TEXT,
      risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
      evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
      requested_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      requested_by_service TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,
      approved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      approved_by_service TEXT,
      approved_at TIMESTAMPTZ,
      rejected_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      rejected_by_service TEXT,
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      posted_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      posted_by_service TEXT,
      posted_at TIMESTAMPTZ,
      post_idempotency_key TEXT UNIQUE,
      post_idempotency_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED')),
      CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
      id BIGSERIAL PRIMARY KEY,
      adjustment_request_id BIGINT NOT NULL
        REFERENCES inventory_adjustment_requests(id) ON DELETE CASCADE,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      quantity_delta INTEGER NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(adjustment_request_id, variant_id),
      CHECK (quantity_delta <> 0)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS inventory_adjustment_evidence (
      id BIGSERIAL PRIMARY KEY,
      adjustment_request_id BIGINT NOT NULL
        REFERENCES inventory_adjustment_requests(id) ON DELETE CASCADE,
      evidence_type TEXT NOT NULL,
      object_reference TEXT NOT NULL,
      description TEXT,
      captured_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      captured_by_service TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_status_created
    ON inventory_adjustment_requests(status, created_at DESC)`;
}

async function locationFor(db: DB, id: number) {
  const rows = await db`
    SELECT location_id FROM inventory_adjustment_requests WHERE id = ${id} LIMIT 1`;
  return rows.length ? Number(rows[0].location_id) : null;
}

async function load(db: DB, id: number) {
  const rows = await db`
    SELECT r.*,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', l.id,
          'variantId', l.variant_id,
          'quantityDelta', l.quantity_delta,
          'notes', l.notes
        ) ORDER BY l.id)
        FROM inventory_adjustment_lines l
        WHERE l.adjustment_request_id = r.id
      ), '[]'::json) AS lines,
      (
        SELECT COUNT(*)::int
        FROM inventory_adjustment_evidence e
        WHERE e.adjustment_request_id = r.id
      ) AS evidence_count
    FROM inventory_adjustment_requests r
    WHERE r.id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    requestNumber: row.request_number,
    locationId: Number(row.location_id),
    status: row.status,
    reasonCode: row.reason_code,
    reasonText: row.reason_text || null,
    riskLevel: row.risk_level,
    evidenceRequired: Boolean(row.evidence_required),
    evidenceCount: Number(row.evidence_count || 0),
    requestedByUserId: row.requested_by_user_id == null ? null : Number(row.requested_by_user_id),
    approvedByUserId: row.approved_by_user_id == null ? null : Number(row.approved_by_user_id),
    requestedAt: row.requested_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
    lines: row.lines || []
  };
}

async function createAdjustment(req: Request, db: DB) {
  const body: any = await readBody(req);
  if (!body) return json({ error: "invalid_json" }, 400);

  const locationId = positiveInt(body.locationId);
  if (!locationId) return json({ error: "invalid_location" }, 400);

  const auth = await authorizeInternal(req, db, "inventory_adjustments.create", {
    locationId, mutation: true
  });
  if (!auth.ok) return auth.response;

  const reasonCode = clean(body.reasonCode, 48).toUpperCase();
  if (!REASONS.has(reasonCode)) return json({ error: "invalid_reason_code" }, 400);

  const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, 100) : [];
  if (!rawLines.length) return json({ error: "adjustment_line_required" }, 400);

  const lines: Array<{ variantId: number; quantityDelta: number; notes: string | null }> = [];
  const seen = new Set<number>();

  for (const item of rawLines) {
    const variantId = positiveInt(item?.variantId);
    const quantityDelta = signedInt(item?.quantityDelta);
    if (!variantId) return json({ error: "invalid_variant" }, 400);
    if (quantityDelta == null) return json({ error: "invalid_quantity_delta", variantId }, 400);
    if (seen.has(variantId)) return json({ error: "duplicate_variant", variantId }, 409);
    seen.add(variantId);
    lines.push({ variantId, quantityDelta, notes: clean(item?.notes, 500) || null });
  }

  for (const line of lines) {
    const variant = await db`
      SELECT id FROM product_variants WHERE id = ${line.variantId} LIMIT 1`;
    if (!variant.length) {
      return json({ error: "variant_not_found", variantId: line.variantId }, 404);
    }
  }

  const riskLevel =
    ["THEFT_SUSPECTED","THEFT_CONFIRMED","LOSS_IN_TRANSIT","LOST_IN_STORE","DESTRUCTION"].includes(reasonCode)
      ? "HIGH" : "MEDIUM";
  const evidenceRequired = EVIDENCE_REQUIRED.has(reasonCode);

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`
      INSERT INTO inventory_adjustment_requests(
        request_number, location_id, reason_code, reason_text, risk_level,
        evidence_required, requested_by_user_id, requested_by_service
      )
      VALUES(
        ${requestNumber()}, ${locationId}, ${reasonCode},
        ${clean(body.reasonText, 1000) || null}, ${riskLevel},
        ${evidenceRequired}, ${actorUserId(auth.actor)}, ${actorService(auth.actor)}
      )
      RETURNING id`;
    const id = Number(rows[0].id);

    for (const line of lines) {
      await tx`
        INSERT INTO inventory_adjustment_lines(
          adjustment_request_id, variant_id, quantity_delta, notes
        )
        VALUES(${id}, ${line.variantId}, ${line.quantityDelta}, ${line.notes})`;
    }

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "inventory_adjustment.created",
      resourceType: "InventoryAdjustmentRequest",
      resourceId: id,
      locationId,
      outcome: "SUCCESS",
      reason: reasonCode,
      metadata: { riskLevel, evidenceRequired, lineCount: lines.length }
    });

    return { id };
  });

  return json({ adjustment: await load(db, Number(result.id)) }, 201);
}

async function listAdjustments(req: Request, url: URL, db: DB) {
  const status = clean(url.searchParams.get("status"), 24).toUpperCase();
  if (status && !STATUSES.has(status)) return json({ error: "invalid_status" }, 400);

  const auth = await authorizeInternal(req, db, "inventory_adjustments.read");
  if (!auth.ok) return auth.response;

  const rows = await db`
    SELECT id, request_number, location_id, status, reason_code, risk_level,
           evidence_required, requested_at, submitted_at, approved_at, posted_at
    FROM inventory_adjustment_requests
    WHERE (${status || null}::text IS NULL OR status = ${status || null}::text)
    ORDER BY created_at DESC
    LIMIT 100`;

  return json({
    data: rows.map((row: any) => ({
      id: Number(row.id),
      requestNumber: row.request_number,
      locationId: Number(row.location_id),
      status: row.status,
      reasonCode: row.reason_code,
      riskLevel: row.risk_level,
      evidenceRequired: Boolean(row.evidence_required),
      requestedAt: row.requested_at,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      postedAt: row.posted_at
    }))
  });
}

async function transition(req: Request, db: DB, id: number, target: string) {
  const locationId = await locationFor(db, id);
  if (!locationId) return json({ error: "not_found" }, 404);

  const permission =
    target === "SUBMITTED" || target === "CANCELLED"
      ? "inventory_adjustments.submit"
      : "inventory_adjustments.approve";
  const auth = await authorizeInternal(req, db, permission, { locationId, mutation: true });
  if (!auth.ok) return auth.response;

  if ((target === "APPROVED" || target === "REJECTED") && !humanActionAllowed(auth.actor)) {
    return json({ error: "human_approval_required" }, 403);
  }

  const body: any = target === "REJECTED" ? await readBody(req) : {};
  const rejectionReason = target === "REJECTED" ? clean(body?.reason, 1000) : null;
  if (target === "REJECTED" && !rejectionReason) return json({ error: "reason_required" }, 400);

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`
      SELECT id, status, requested_by_user_id, evidence_required
      FROM inventory_adjustment_requests
      WHERE id = ${id}
      FOR UPDATE`;
    if (!rows.length) return { error: "not_found", status: 404 };

    const current = rows[0].status;
    if (target === "SUBMITTED" && current !== "DRAFT")
      return { error: "invalid_transition", status: 409, current, target };
    if ((target === "APPROVED" || target === "REJECTED") && current !== "SUBMITTED")
      return { error: "invalid_transition", status: 409, current, target };
    if (target === "CANCELLED" && !["DRAFT","SUBMITTED"].includes(current))
      return { error: "invalid_transition", status: 409, current, target };

    if (
      target === "APPROVED" &&
      auth.actor.type === "USER" &&
      rows[0].requested_by_user_id != null &&
      Number(rows[0].requested_by_user_id) === auth.actor.userId
    ) return { error: "self_approval_forbidden", status: 409 };

    if (target === "APPROVED" && rows[0].evidence_required) {
      const evidence = await tx`
        SELECT COUNT(*)::int AS count
        FROM inventory_adjustment_evidence
        WHERE adjustment_request_id = ${id}`;
      if (Number(evidence[0]?.count || 0) < 1)
        return { error: "evidence_required", status: 409 };
    }

    if (target === "SUBMITTED") {
      await tx`
        UPDATE inventory_adjustment_requests
        SET status='SUBMITTED', submitted_at=NOW(), updated_at=NOW()
        WHERE id=${id}`;
    } else if (target === "APPROVED") {
      await tx`
        UPDATE inventory_adjustment_requests
        SET status='APPROVED',
            approved_by_user_id=${actorUserId(auth.actor)},
            approved_by_service=${actorService(auth.actor)},
            approved_at=NOW(), updated_at=NOW()
        WHERE id=${id}`;
    } else if (target === "REJECTED") {
      await tx`
        UPDATE inventory_adjustment_requests
        SET status='REJECTED',
            rejected_by_user_id=${actorUserId(auth.actor)},
            rejected_by_service=${actorService(auth.actor)},
            rejected_at=NOW(), rejection_reason=${rejectionReason}, updated_at=NOW()
        WHERE id=${id}`;
    } else {
      await tx`
        UPDATE inventory_adjustment_requests
        SET status='CANCELLED', updated_at=NOW()
        WHERE id=${id}`;
    }

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "inventory_adjustment." + target.toLowerCase(),
      resourceType: "InventoryAdjustmentRequest",
      resourceId: id,
      locationId,
      outcome: "SUCCESS",
      reason: rejectionReason,
      metadata: { fromStatus: current, toStatus: target }
    });

    return { ok: true };
  });

  if (result.error) return json(result, result.status || 409);
  return json({ adjustment: await load(db, id) });
}

async function addEvidence(req: Request, db: DB, id: number) {
  const locationId = await locationFor(db, id);
  if (!locationId) return json({ error: "not_found" }, 404);

  const auth = await authorizeInternal(req, db, "inventory_adjustments.create", {
    locationId, mutation: true
  });
  if (!auth.ok) return auth.response;

  const body: any = await readBody(req);
  if (!body) return json({ error: "invalid_json" }, 400);

  const evidenceType = clean(body.evidenceType, 40).toUpperCase();
  const objectReference = clean(body.objectReference, 1000);
  if (!objectReference) return json({ error: "object_reference_required" }, 400);

  const rows = await db`
    INSERT INTO inventory_adjustment_evidence(
      adjustment_request_id, evidence_type, object_reference, description,
      captured_by_user_id, captured_by_service
    )
    VALUES(
      ${id}, ${evidenceType || "OTHER"}, ${objectReference},
      ${clean(body.description, 1000) || null},
      ${actorUserId(auth.actor)}, ${actorService(auth.actor)}
    )
    RETURNING id, evidence_type, object_reference, description, captured_at`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "inventory_adjustment.evidence_added",
    resourceType: "InventoryAdjustmentRequest",
    resourceId: id,
    locationId,
    outcome: "SUCCESS",
    metadata: { evidenceType: evidenceType || "OTHER" }
  });

  return json({ evidence: rows[0] }, 201);
}

async function postAdjustment(req: Request, db: DB, id: number) {
  const locationId = await locationFor(db, id);
  if (!locationId) return json({ error: "not_found" }, 404);

  const auth = await authorizeInternal(req, db, "inventory_adjustments.post", {
    locationId, mutation: true
  });
  if (!auth.ok) return auth.response;
  if (!humanActionAllowed(auth.actor)) return json({ error: "human_posting_required" }, 403);

  const key = clean(req.headers.get("idempotency-key"), 200);
  if (!key) return json({ error: "idempotency_key_required" }, 400);
  const hash = sha256("inventory-adjustment-post|" + id);

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`
      SELECT id, request_number, location_id, status, reason_code, reason_text,
             post_idempotency_key, post_idempotency_hash
      FROM inventory_adjustment_requests
      WHERE id=${id}
      FOR UPDATE`;
    if (!rows.length) return { error: "not_found", status: 404 };
    const adjustment = rows[0];

    if (adjustment.status === "POSTED") {
      if (adjustment.post_idempotency_key === key && adjustment.post_idempotency_hash === hash)
        return { replayed: true };
      return { error: "adjustment_already_posted", status: 409 };
    }
    if (adjustment.status !== "APPROVED")
      return { error: "invalid_transition", status: 409, current: adjustment.status, target: "POSTED" };

    const lines = await tx`
      SELECT variant_id, quantity_delta
      FROM inventory_adjustment_lines
      WHERE adjustment_request_id=${id}
      ORDER BY id`;

    for (const line of lines) {
      const variantId = Number(line.variant_id);
      const delta = Number(line.quantity_delta);
      const inv = await tx`
        SELECT quantity, reserved
        FROM inventory
        WHERE variant_id=${variantId} AND location_id=${locationId}
        FOR UPDATE`;
      const before = inv.length ? Number(inv[0].quantity) : 0;
      const reserved = inv.length ? Number(inv[0].reserved) : 0;
      const after = before + delta;

      if (after < 0)
        return { error: "negative_inventory", status: 409, variantId, before, delta };
      if (after < reserved)
        return { error: "reserved_exceeds_quantity", status: 409, variantId, reserved, after };

      if (inv.length) {
        await tx`
          UPDATE inventory SET quantity=${after}, updated_at=NOW()
          WHERE variant_id=${variantId} AND location_id=${locationId}`;
      } else {
        await tx`
          INSERT INTO inventory(variant_id,location_id,quantity,reserved)
          VALUES(${variantId},${locationId},${after},0)`;
      }

      await tx`
        INSERT INTO inventory_movements(
          variant_id,location_id,movement_type,quantity,reference,notes
        )
        VALUES(
          ${variantId},${locationId},${movementType(adjustment.reason_code)},${delta},
          ${"inventory_adjustment:" + adjustment.request_number},
          ${adjustment.reason_text || adjustment.reason_code}
        )`;
    }

    await tx`
      UPDATE inventory_adjustment_requests
      SET status='POSTED',
          posted_by_user_id=${actorUserId(auth.actor)},
          posted_by_service=${actorService(auth.actor)},
          posted_at=NOW(),
          post_idempotency_key=${key},
          post_idempotency_hash=${hash},
          updated_at=NOW()
      WHERE id=${id}`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "inventory_adjustment.posted",
      resourceType: "InventoryAdjustmentRequest",
      resourceId: id,
      locationId,
      outcome: "SUCCESS",
      reason: adjustment.reason_code,
      correlationId: key,
      metadata: { lineCount: lines.length }
    });

    return { replayed: false };
  });

  if (result.error) return json(result, result.status || 409);
  return json({ adjustment: await load(db, id), replayed: Boolean(result.replayed) });
}

export async function handleInventoryAdjustments(req: Request, url: URL, db: DB) {
  if (!url.pathname.startsWith("/v1/internal/inventory-adjustments")) return null;

  if (url.pathname === "/v1/internal/inventory-adjustments") {
    if (req.method === "GET") return listAdjustments(req, url, db);
    if (req.method === "POST") return createAdjustment(req, db);
  }

  const item = url.pathname.match(/^\/v1\/internal\/inventory-adjustments\/(\d+)$/);
  if (item && req.method === "GET") {
    const id = Number(item[1]);
    const locationId = await locationFor(db, id);
    if (!locationId) return json({ error: "not_found" }, 404);
    const auth = await authorizeInternal(req, db, "inventory_adjustments.read", { locationId });
    if (!auth.ok) return auth.response;
    return json({ adjustment: await load(db, id) });
  }

  const evidence = url.pathname.match(/^\/v1\/internal\/inventory-adjustments\/(\d+)\/evidence$/);
  if (evidence && req.method === "POST") return addEvidence(req, db, Number(evidence[1]));

  const action = url.pathname.match(
    /^\/v1\/internal\/inventory-adjustments\/(\d+)\/(submit|approve|reject|cancel|post)$/
  );
  if (action && req.method === "POST") {
    const id = Number(action[1]);
    const name = action[2];
    if (name === "submit") return transition(req, db, id, "SUBMITTED");
    if (name === "approve") return transition(req, db, id, "APPROVED");
    if (name === "reject") return transition(req, db, id, "REJECTED");
    if (name === "cancel") return transition(req, db, id, "CANCELLED");
    if (name === "post") return postAdjustment(req, db, id);
  }

  return json({ error: "not_found" }, 404);
}
