import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const ROLES = new Set(["PRIMARY_SALESPERSON", "ASSIST"]);
const SOURCES = new Set(["STAFF_SESSION", "MANUAL_OVERRIDE", "IMPORT", "SYSTEM"]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function ensureStaffAttributionSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS order_staff_attributions (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      staff_user_id BIGINT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      attribution_role TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_reference TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      supersedes_attribution_id BIGINT REFERENCES order_staff_attributions(id) ON DELETE SET NULL,
      correction_reason TEXT,
      assignment_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (attribution_role IN ('PRIMARY_SALESPERSON','ASSIST')),
      CHECK (source_type IN ('STAFF_SESSION','MANUAL_OVERRIDE','IMPORT','SYSTEM')),
      CHECK (status IN ('ACTIVE','SUPERSEDED','REMOVED'))
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_order_staff_primary_active
    ON order_staff_attributions(order_id)
    WHERE attribution_role='PRIMARY_SALESPERSON' AND status='ACTIVE'`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_order_staff_assist_active
    ON order_staff_attributions(order_id,staff_user_id,attribution_role)
    WHERE attribution_role='ASSIST' AND status='ACTIVE'`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_order_staff_user_active
    ON order_staff_attributions(staff_user_id,status,created_at DESC)`;
}

function mapAttribution(row: any) {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    staffUserId: Number(row.staff_user_id),
    staffDisplayName: row.staff_display_name || null,
    staffEmail: row.staff_email || null,
    attributionRole: row.attribution_role,
    sourceType: row.source_type,
    sourceReference: row.source_reference || null,
    status: row.status,
    supersedesAttributionId:
      row.supersedes_attribution_id == null ? null : Number(row.supersedes_attribution_id),
    correctionReason: row.correction_reason || null,
    assignmentSnapshot: row.assignment_snapshot || {},
    createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
    actorService: row.actor_service || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadOrderContext(db: DB, orderId: number) {
  const rows = await db`
    SELECT id,status,channel,location_id,order_number,grand_total_minor,currency
    FROM orders
    WHERE id=${orderId}
    LIMIT 1`;
  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    status: String(rows[0].status),
    channel: String(rows[0].channel),
    locationId: Number(rows[0].location_id),
    orderNumber: String(rows[0].order_number),
    grandTotalMinor: Number(rows[0].grand_total_minor),
    currency: String(rows[0].currency)
  };
}

async function listAttributions(req: Request, url: URL, db: DB, orderId: number) {
  const order = await loadOrderContext(db, orderId);
  if (!order) return json({ error: "not_found" }, 404);

  const auth = await authorizeInternal(req, db, "commissions.attribution.read", {
    locationId: order.locationId
  });
  if (!auth.ok) return auth.response;

  const includeHistory = url.searchParams.get("history") === "true";
  const rows = await db`
    SELECT a.*,u.display_name AS staff_display_name,u.email_normalized AS staff_email
    FROM order_staff_attributions a
    JOIN staff_users u ON u.id=a.staff_user_id
    WHERE a.order_id=${orderId}
      AND (${includeHistory}::boolean OR a.status='ACTIVE')
    ORDER BY
      CASE a.status WHEN 'ACTIVE' THEN 1 WHEN 'SUPERSEDED' THEN 2 ELSE 3 END,
      CASE a.attribution_role WHEN 'PRIMARY_SALESPERSON' THEN 1 ELSE 2 END,
      a.created_at DESC,a.id DESC`;

  return json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      channel: order.channel,
      locationId: order.locationId
    },
    data: rows.map(mapAttribution)
  });
}

async function assignAttribution(req: Request, db: DB, orderId: number) {
  const order = await loadOrderContext(db, orderId);
  if (!order) return json({ error: "not_found" }, 404);

  const auth = await authorizeInternal(req, db, "commissions.attribution.manage", {
    locationId: order.locationId,
    mutation: true
  });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const staffUserId = positiveInt(body?.staffUserId);
  const role = clean(body?.attributionRole, 40).toUpperCase();
  let sourceType = clean(body?.sourceType, 40).toUpperCase();
  const sourceReference = clean(body?.sourceReference, 160) || null;
  const reason = clean(body?.reason, 500) || null;

  if (!staffUserId) return json({ error: "invalid_staff_user" }, 400);
  if (!ROLES.has(role)) return json({ error: "invalid_attribution_role" }, 400);

  if (!sourceType) {
    sourceType = auth.actor.type === "USER" ? "MANUAL_OVERRIDE" : "SYSTEM";
  }
  if (!SOURCES.has(sourceType)) return json({ error: "invalid_source_type" }, 400);

  const staff = await db`
    SELECT id,display_name,email_normalized,status
    FROM staff_users
    WHERE id=${staffUserId}
    LIMIT 1`;
  if (!staff.length) return json({ error: "staff_user_not_found" }, 404);
  if (staff[0].status !== "ACTIVE") return json({ error: "staff_user_not_active" }, 409);

  const result: any = await db.begin(async (tx: DB) => {
    const lockedOrders = await tx`
      SELECT id,status,channel,location_id,order_number,grand_total_minor,currency
      FROM orders
      WHERE id=${orderId}
      FOR UPDATE`;
    if (!lockedOrders.length) return { error: "not_found", status: 404 };

    const lockedOrder = {
      status: String(lockedOrders[0].status),
      channel: String(lockedOrders[0].channel),
      locationId: Number(lockedOrders[0].location_id)
    };
    const committed = lockedOrder.status !== "PENDING_CONFIRMATION";

    const current = await tx`
      SELECT id,staff_user_id,attribution_role,status
      FROM order_staff_attributions
      WHERE order_id=${orderId}
        AND attribution_role=${role}
        AND status='ACTIVE'
      ORDER BY id
      FOR UPDATE`;

    if (role === "ASSIST") {
      const same = current.find((x: any) => Number(x.staff_user_id) === staffUserId);
      if (same) return { ok: true, replayed: true, attributionId: Number(same.id) };
    } else if (current.length && Number(current[0].staff_user_id) === staffUserId) {
      return { ok: true, replayed: true, attributionId: Number(current[0].id) };
    }

    const isPrimaryCorrection = role === "PRIMARY_SALESPERSON" && current.length > 0;
    if (committed && auth.actor.type === "USER") {
      sourceType = "MANUAL_OVERRIDE";
      if (!reason || reason.length < 8) {
        return { error: "correction_reason_required", status: 409 };
      }
    } else if (committed && isPrimaryCorrection && (!reason || reason.length < 8)) {
      return { error: "correction_reason_required", status: 409 };
    }

    let supersedesId: number | null = null;
    if (role === "PRIMARY_SALESPERSON" && current.length) {
      supersedesId = Number(current[0].id);
      await tx`
        UPDATE order_staff_attributions
        SET status='SUPERSEDED',updated_at=NOW()
        WHERE id=${supersedesId}`;
    }

    const snapshot = {
      orderStatus: lockedOrder.status,
      originatingChannel: lockedOrder.channel,
      originatingLocationId: lockedOrder.locationId,
      staffUserId,
      staffDisplayName: staff[0].display_name,
      staffEmail: staff[0].email_normalized
    };

    const inserted = await tx`
      INSERT INTO order_staff_attributions(
        order_id,staff_user_id,attribution_role,source_type,source_reference,
        status,supersedes_attribution_id,correction_reason,assignment_snapshot,
        created_by_user_id,actor_service
      )
      VALUES(
        ${orderId},${staffUserId},${role},${sourceType},${sourceReference},
        'ACTIVE',${supersedesId},${reason},${JSON.stringify(snapshot)}::jsonb,
        ${auth.actor.type === "USER" ? auth.actor.userId : null},
        ${auth.actor.type === "SERVICE" ? auth.actor.service : null}
      )
      RETURNING id`;
    const attributionId = Number(inserted[0].id);

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: supersedesId
        ? "commission_attribution.corrected"
        : "commission_attribution.assigned",
      resourceType: "OrderStaffAttribution",
      resourceId: attributionId,
      locationId: lockedOrder.locationId,
      outcome: "SUCCESS",
      reason,
      metadata: {
        orderId,
        orderStatus: lockedOrder.status,
        staffUserId,
        attributionRole: role,
        sourceType,
        supersedesAttributionId: supersedesId
      }
    });

    return { ok: true, replayed: false, attributionId };
  });

  if (result.error) return json(result, result.status || 409);

  const rows = await db`
    SELECT a.*,u.display_name AS staff_display_name,u.email_normalized AS staff_email
    FROM order_staff_attributions a
    JOIN staff_users u ON u.id=a.staff_user_id
    WHERE a.id=${result.attributionId}
    LIMIT 1`;

  return json({
    ok: true,
    replayed: Boolean(result.replayed),
    attribution: rows.length ? mapAttribution(rows[0]) : null
  }, result.replayed ? 200 : 201);
}

export async function handleStaffAttribution(req: Request, url: URL, db: DB) {
  const match = url.pathname.match(
    /^\/v1\/internal\/orders\/(\d+)\/staff-attributions$/
  );
  if (match) {
    const orderId = Number(match[1]);
    if (req.method === "GET") return listAttributions(req, url, db, orderId);
    if (req.method === "POST") return assignAttribution(req, db, orderId);
    return json({ error: "method_not_allowed" }, 405);
  }

  if (url.pathname.includes("/staff-attributions")) {
    return json({ error: "not_found" }, 404);
  }

  return null;
}
