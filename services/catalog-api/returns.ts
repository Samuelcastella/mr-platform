import {
  auditActor,
  authorizeInternal,
  writeAuditEvent,
  type InternalActor
} from "./auth";

type DB = any;

const RETURN_STATUSES = new Set([
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "RECEIVED",
  "INSPECTED",
  "COMPLETED",
  "CANCELLED"
]);

const RESOLUTIONS = new Set([
  "REFUND",
  "EXCHANGE",
  "STORE_CREDIT",
  "NONE"
]);

const DISPOSITIONS = new Set([
  "RESTOCK",
  "DAMAGED",
  "QUARANTINE",
  "RETURN_TO_SUPPLIER"
]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function requestHash(value: unknown) {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function returnNumber() {
  return "MR-RET-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    crypto.randomUUID().slice(0, 6).toUpperCase();
}

function actorFields(actor: InternalActor) {
  return actor.type === "USER"
    ? { userId: actor.userId, service: null }
    : { userId: null, service: actor.service };
}

async function loadReturnCase(db: DB, id: number) {
  const rows = await db`
    SELECT
      r.id, r.return_number, r.order_id, o.order_number,
      o.location_id AS order_location_id,
      r.status, r.requested_resolution, r.resolution_status,
      r.reason_code, r.reason_note, r.receive_location_id,
      r.requested_at, r.approved_at, r.rejected_at, r.received_at,
      r.inspected_at, r.completed_at, r.cancelled_at,
      r.created_at, r.updated_at
    FROM return_cases r
    JOIN orders o ON o.id = r.order_id
    WHERE r.id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;

  const items = await db`
    SELECT
      ri.id, ri.order_item_id, ri.variant_id, ri.sku_snapshot,
      ri.product_name_snapshot, ri.quantity_requested, ri.quantity_received,
      ri.created_at, ri.updated_at
    FROM return_items ri
    WHERE ri.return_case_id = ${id}
    ORDER BY ri.id`;

  const itemIds = items.map((item: any) => Number(item.id));
  const dispositions = itemIds.length
    ? await db`
        SELECT id, return_item_id, disposition, quantity, notes, created_at
        FROM return_item_dispositions
        WHERE return_item_id IN (
          SELECT value::bigint
          FROM jsonb_array_elements_text(
            ${JSON.stringify(itemIds)}::text::jsonb
          )
        )
        ORDER BY id`
    : [];

  const byItem = new Map<number, any[]>();
  for (const row of dispositions as any[]) {
    const key = Number(row.return_item_id);
    const current = byItem.get(key) || [];
    current.push({
      id: Number(row.id),
      disposition: row.disposition,
      quantity: Number(row.quantity),
      notes: row.notes || null,
      createdAt: row.created_at
    });
    byItem.set(key, current);
  }

  const row = rows[0];
  return {
    id: Number(row.id),
    returnNumber: row.return_number,
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    orderLocationId: Number(row.order_location_id),
    status: row.status,
    requestedResolution: row.requested_resolution,
    resolutionStatus: row.resolution_status,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note || null,
    receiveLocationId:
      row.receive_location_id == null
        ? null
        : Number(row.receive_location_id),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    receivedAt: row.received_at || null,
    inspectedAt: row.inspected_at || null,
    completedAt: row.completed_at || null,
    cancelledAt: row.cancelled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item: any) => ({
      id: Number(item.id),
      orderItemId: Number(item.order_item_id),
      variantId: item.variant_id == null ? null : Number(item.variant_id),
      sku: item.sku_snapshot,
      productName: item.product_name_snapshot,
      quantityRequested: Number(item.quantity_requested),
      quantityReceived: Number(item.quantity_received),
      dispositions: byItem.get(Number(item.id)) || [],
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }))
  };
}

export async function ensureReturnsSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS return_cases (
      id BIGSERIAL PRIMARY KEY,
      return_number TEXT UNIQUE NOT NULL,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      requested_resolution TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      reason_note TEXT,
      receive_location_id BIGINT REFERENCES locations(id) ON DELETE RESTRICT,
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      receive_idempotency_key TEXT UNIQUE,
      receive_idempotency_hash TEXT,
      inspection_idempotency_key TEXT UNIQUE,
      inspection_idempotency_hash TEXT,
      requested_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      requested_by_service TEXT,
      approved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      approved_by_service TEXT,
      rejected_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      rejected_by_service TEXT,
      cancelled_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      cancelled_by_service TEXT,
      received_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      received_by_service TEXT,
      inspected_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      inspected_by_service TEXT,
      completed_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      completed_by_service TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      inspected_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        status IN (
          'REQUESTED','APPROVED','REJECTED','RECEIVED',
          'INSPECTED','COMPLETED','CANCELLED'
        )
      ),
      CHECK (
        requested_resolution IN ('REFUND','EXCHANGE','STORE_CREDIT','NONE')
      ),
      CHECK (
        resolution_status IN ('NOT_REQUIRED','PENDING_HANDOFF','RESOLVED')
      ),
      CHECK (
        (requested_by_user_id IS NOT NULL AND requested_by_service IS NULL) OR
        (requested_by_user_id IS NULL AND requested_by_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_return_cases_order_created
    ON return_cases(order_id, created_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_return_cases_status_created
    ON return_cases(status, created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS return_items (
      id BIGSERIAL PRIMARY KEY,
      return_case_id BIGINT NOT NULL REFERENCES return_cases(id) ON DELETE RESTRICT,
      order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
      variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
      sku_snapshot TEXT NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
      quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(return_case_id, order_item_id),
      CHECK (quantity_received <= quantity_requested)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_return_items_order_item
    ON return_items(order_item_id)`;

  await db`
    CREATE TABLE IF NOT EXISTS return_item_dispositions (
      id BIGSERIAL PRIMARY KEY,
      return_item_id BIGINT NOT NULL REFERENCES return_items(id) ON DELETE RESTRICT,
      disposition TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        disposition IN (
          'RESTOCK','DAMAGED','QUARANTINE','RETURN_TO_SUPPLIER'
        )
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_return_dispositions_item
    ON return_item_dispositions(return_item_id, id)`;
}

function normalizeCreateBody(body: any) {
  const orderId = Number(body?.orderId);
  const requestedResolution =
    clean(body?.requestedResolution, 32).toUpperCase();
  const reasonCode = clean(body?.reasonCode, 80).toUpperCase();
  const reasonNote = clean(body?.reasonNote, 1000) || null;

  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return { error: "invalid_order" as const };
  }
  if (!RESOLUTIONS.has(requestedResolution)) {
    return { error: "invalid_resolution" as const };
  }
  if (!reasonCode) {
    return { error: "reason_code_required" as const };
  }
  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 50) {
    return { error: "items_required" as const };
  }

  const seen = new Set<number>();
  const items: { orderItemId: number; quantity: number }[] = [];
  for (const raw of body.items) {
    const orderItemId = Number(raw?.orderItemId);
    const quantity = Number(raw?.quantity);

    if (!Number.isSafeInteger(orderItemId) || orderItemId < 1) {
      return { error: "invalid_order_item" as const };
    }
    if (seen.has(orderItemId)) {
      return { error: "duplicate_order_item" as const };
    }
    seen.add(orderItemId);

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      return { error: "invalid_quantity" as const };
    }

    items.push({ orderItemId, quantity });
  }

  items.sort((a, b) => a.orderItemId - b.orderItemId);

  return {
    value: {
      orderId,
      requestedResolution,
      reasonCode,
      reasonNote,
      items
    }
  };
}

async function createReturnCase(req: Request, db: DB) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) {
    return json({ error: "idempotency_key_required" }, 400);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const normalized = normalizeCreateBody(body);
  if ("error" in normalized) {
    return json({ error: normalized.error }, 400);
  }

  const orderRows = await db`
    SELECT id, status, location_id
    FROM orders
    WHERE id = ${normalized.value.orderId}
    LIMIT 1`;
  if (!orderRows.length) return json({ error: "order_not_found" }, 404);

  const order = orderRows[0];
  if (!["DELIVERED", "COMPLETED"].includes(order.status)) {
    return json({
      error: "order_not_returnable",
      orderStatus: order.status
    }, 409);
  }

  const auth = await authorizeInternal(req, db, "returns.create", {
    locationId: Number(order.location_id),
    mutation: true
  });
  if (!auth.ok) return auth.response;

  const hash = requestHash(normalized.value);
  const existing = await db`
    SELECT id, idempotency_hash
    FROM return_cases
    WHERE idempotency_key = ${key}
    LIMIT 1`;
  if (existing.length) {
    if (existing[0].idempotency_hash !== hash) {
      return json({ error: "idempotency_conflict" }, 409);
    }
    return json({
      returnCase: await loadReturnCase(db, Number(existing[0].id)),
      replayed: true
    });
  }

  const actor = actorFields(auth.actor);

  const result: any = await db.begin(async (tx: DB) => {
    const lockedOrder = await tx`
      SELECT id, status, location_id
      FROM orders
      WHERE id = ${normalized.value.orderId}
      FOR UPDATE`;
    if (!lockedOrder.length) return { error: "order_not_found", status: 404 };
    if (!["DELIVERED", "COMPLETED"].includes(lockedOrder[0].status)) {
      return {
        error: "order_not_returnable",
        status: 409,
        orderStatus: lockedOrder[0].status
      };
    }

    const itemSnapshots: any[] = [];

    for (const requested of normalized.value.items) {
      const itemRows = await tx`
        SELECT
          id, order_id, variant_id, sku_snapshot,
          product_name_snapshot, quantity
        FROM order_items
        WHERE id = ${requested.orderItemId}
        FOR UPDATE`;
      if (!itemRows.length) {
        return {
          error: "order_item_not_found",
          status: 404,
          orderItemId: requested.orderItemId
        };
      }

      const item = itemRows[0];
      if (Number(item.order_id) !== normalized.value.orderId) {
        return {
          error: "item_not_in_order",
          status: 409,
          orderItemId: requested.orderItemId
        };
      }

      const already = await tx`
        SELECT COALESCE(SUM(ri.quantity_requested),0)::bigint AS quantity
        FROM return_items ri
        JOIN return_cases rc ON rc.id = ri.return_case_id
        WHERE ri.order_item_id = ${requested.orderItemId}
          AND rc.status NOT IN ('REJECTED','CANCELLED')`;
      const committed = Number(already[0]?.quantity || 0);
      const sold = Number(item.quantity);
      const available = sold - committed;

      if (requested.quantity > available) {
        return {
          error: "return_quantity_exceeded",
          status: 409,
          orderItemId: requested.orderItemId,
          sold,
          alreadyRequested: committed,
          available
        };
      }

      itemSnapshots.push({
        ...requested,
        variantId: item.variant_id == null ? null : Number(item.variant_id),
        sku: item.sku_snapshot,
        productName: item.product_name_snapshot
      });
    }

    const resolutionStatus =
      normalized.value.requestedResolution === "NONE"
        ? "NOT_REQUIRED"
        : "PENDING_HANDOFF";

    const cases = await tx`
      INSERT INTO return_cases(
        return_number, order_id, status, requested_resolution,
        resolution_status, reason_code, reason_note,
        idempotency_key, idempotency_hash,
        requested_by_user_id, requested_by_service
      )
      VALUES(
        ${returnNumber()}, ${normalized.value.orderId}, 'REQUESTED',
        ${normalized.value.requestedResolution}, ${resolutionStatus},
        ${normalized.value.reasonCode}, ${normalized.value.reasonNote},
        ${key}, ${hash}, ${actor.userId}, ${actor.service}
      )
      RETURNING id`;
    const returnCaseId = Number(cases[0].id);

    for (const item of itemSnapshots) {
      await tx`
        INSERT INTO return_items(
          return_case_id, order_item_id, variant_id,
          sku_snapshot, product_name_snapshot,
          quantity_requested, quantity_received
        )
        VALUES(
          ${returnCaseId}, ${item.orderItemId}, ${item.variantId},
          ${item.sku}, ${item.productName},
          ${item.quantity}, 0
        )`;
    }

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "return.requested",
      resourceType: "ReturnCase",
      resourceId: returnCaseId,
      locationId: Number(lockedOrder[0].location_id),
      outcome: "SUCCESS",
      metadata: {
        orderId: normalized.value.orderId,
        requestedResolution: normalized.value.requestedResolution,
        itemCount: itemSnapshots.length,
        requestedUnits: itemSnapshots.reduce(
          (sum, item) => sum + item.quantity,
          0
        )
      }
    });

    return { returnCaseId };
  });

  if (result.error) return json(result, result.status || 409);

  return json({
    returnCase: await loadReturnCase(db, result.returnCaseId)
  }, 201);
}

async function listReturnCases(req: Request, url: URL, db: DB) {
  const auth = await authorizeInternal(req, db, "returns.read");
  if (!auth.ok) return auth.response;

  const status = clean(url.searchParams.get("status"), 32).toUpperCase();
  if (status && !RETURN_STATUSES.has(status)) {
    return json({ error: "invalid_status" }, 400);
  }

  const orderIdRaw = url.searchParams.get("orderId");
  const orderId =
    orderIdRaw == null || orderIdRaw === "" ? null : Number(orderIdRaw);
  if (orderId != null && (!Number.isSafeInteger(orderId) || orderId < 1)) {
    return json({ error: "invalid_order" }, 400);
  }

  const rows = await db`
    SELECT
      r.id, r.return_number, r.order_id, o.order_number,
      r.status, r.requested_resolution, r.resolution_status,
      r.reason_code, r.receive_location_id, r.requested_at,
      r.received_at, r.inspected_at, r.completed_at, r.updated_at
    FROM return_cases r
    JOIN orders o ON o.id = r.order_id
    WHERE (${status || null}::text IS NULL OR r.status = ${status || null}::text)
      AND (${orderId}::bigint IS NULL OR r.order_id = ${orderId}::bigint)
    ORDER BY r.created_at DESC
    LIMIT 100`;

  return json({
    data: rows.map((row: any) => ({
      id: Number(row.id),
      returnNumber: row.return_number,
      orderId: Number(row.order_id),
      orderNumber: row.order_number,
      status: row.status,
      requestedResolution: row.requested_resolution,
      resolutionStatus: row.resolution_status,
      reasonCode: row.reason_code,
      receiveLocationId:
        row.receive_location_id == null
          ? null
          : Number(row.receive_location_id),
      requestedAt: row.requested_at,
      receivedAt: row.received_at || null,
      inspectedAt: row.inspected_at || null,
      completedAt: row.completed_at || null,
      updatedAt: row.updated_at
    }))
  });
}

async function transitionReturnCase(
  req: Request,
  db: DB,
  id: number,
  action: "APPROVE" | "REJECT" | "CANCEL" | "COMPLETE"
) {
  const rows = await db`
    SELECT r.id, r.status, r.order_id, o.location_id
    FROM return_cases r
    JOIN orders o ON o.id = r.order_id
    WHERE r.id = ${id}
    LIMIT 1`;
  if (!rows.length) return json({ error: "not_found" }, 404);

  const permission =
    action === "CANCEL" ? "returns.cancel" : "returns.approve";

  const auth = await authorizeInternal(req, db, permission, {
    locationId: Number(rows[0].location_id),
    mutation: true
  });
  if (!auth.ok) return auth.response;

  let reason: string | null = null;
  if (action === "REJECT" || action === "CANCEL") {
    try {
      const body: any = await req.json();
      reason = clean(body?.reason, 500) || null;
    } catch {
      reason = null;
    }
  }

  const actor = actorFields(auth.actor);

  const result: any = await db.begin(async (tx: DB) => {
    const locked = await tx`
      SELECT id, status, order_id
      FROM return_cases
      WHERE id = ${id}
      FOR UPDATE`;
    if (!locked.length) return { error: "not_found", status: 404 };

    const current = locked[0].status;
    let target = current;

    if (action === "APPROVE") {
      if (current !== "REQUESTED") {
        return { error: "invalid_transition", status: 409, current };
      }
      target = "APPROVED";
      await tx`
        UPDATE return_cases
        SET status = 'APPROVED',
            approved_by_user_id = ${actor.userId},
            approved_by_service = ${actor.service},
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = ${id}`;
    } else if (action === "REJECT") {
      if (current !== "REQUESTED") {
        return { error: "invalid_transition", status: 409, current };
      }
      if (!reason) return { error: "reason_required", status: 400 };
      target = "REJECTED";
      await tx`
        UPDATE return_cases
        SET status = 'REJECTED',
            rejected_by_user_id = ${actor.userId},
            rejected_by_service = ${actor.service},
            rejected_at = NOW(),
            updated_at = NOW()
        WHERE id = ${id}`;
    } else if (action === "CANCEL") {
      if (!["REQUESTED", "APPROVED"].includes(current)) {
        return { error: "invalid_transition", status: 409, current };
      }
      target = "CANCELLED";
      await tx`
        UPDATE return_cases
        SET status = 'CANCELLED',
            cancelled_by_user_id = ${actor.userId},
            cancelled_by_service = ${actor.service},
            cancelled_at = NOW(),
            updated_at = NOW()
        WHERE id = ${id}`;
    } else {
      if (current !== "INSPECTED") {
        return { error: "invalid_transition", status: 409, current };
      }
      target = "COMPLETED";
      await tx`
        UPDATE return_cases
        SET status = 'COMPLETED',
            completed_by_user_id = ${actor.userId},
            completed_by_service = ${actor.service},
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${id}`;
    }

    const event =
      action === "APPROVE"
        ? "return.approved"
        : action === "REJECT"
          ? "return.rejected"
          : action === "CANCEL"
            ? "return.cancelled"
            : "return.completed";

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: event,
      resourceType: "ReturnCase",
      resourceId: id,
      locationId: Number(rows[0].location_id),
      outcome: "SUCCESS",
      reason,
      metadata: { fromStatus: current, toStatus: target }
    });

    return { ok: true };
  });

  if (result.error) return json(result, result.status || 409);
  return json({ returnCase: await loadReturnCase(db, id) });
}

async function receiveReturnCase(req: Request, db: DB, id: number) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) {
    return json({ error: "idempotency_key_required" }, 400);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const locationId = Number(body?.locationId);
  if (!Number.isSafeInteger(locationId) || locationId < 1) {
    return json({ error: "invalid_location" }, 400);
  }

  const location = await db`
    SELECT id, active
    FROM locations
    WHERE id = ${locationId}
    LIMIT 1`;
  if (!location.length || !location[0].active) {
    return json({ error: "location_unavailable" }, 409);
  }

  const auth = await authorizeInternal(req, db, "returns.receive", {
    locationId,
    mutation: true
  });
  if (!auth.ok) return auth.response;

  const hash = requestHash({ returnCaseId: id, locationId });
  const actor = actorFields(auth.actor);

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`
      SELECT
        id, status, receive_idempotency_key,
        receive_idempotency_hash, receive_location_id
      FROM return_cases
      WHERE id = ${id}
      FOR UPDATE`;
    if (!rows.length) return { error: "not_found", status: 404 };

    const row = rows[0];

    if (row.receive_idempotency_key) {
      if (row.receive_idempotency_key === key) {
        if (row.receive_idempotency_hash !== hash) {
          return { error: "idempotency_conflict", status: 409 };
        }
        return { replayed: true };
      }
      return { error: "return_already_received", status: 409 };
    }

    if (row.status !== "APPROVED") {
      return {
        error: "invalid_transition",
        status: 409,
        current: row.status,
        target: "RECEIVED"
      };
    }

    await tx`
      UPDATE return_items
      SET quantity_received = quantity_requested,
          updated_at = NOW()
      WHERE return_case_id = ${id}`;

    await tx`
      UPDATE return_cases
      SET status = 'RECEIVED',
          receive_location_id = ${locationId},
          receive_idempotency_key = ${key},
          receive_idempotency_hash = ${hash},
          received_by_user_id = ${actor.userId},
          received_by_service = ${actor.service},
          received_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}`;

    const totals = await tx`
      SELECT COALESCE(SUM(quantity_received),0)::bigint AS units
      FROM return_items
      WHERE return_case_id = ${id}`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "return.received",
      resourceType: "ReturnCase",
      resourceId: id,
      locationId,
      outcome: "SUCCESS",
      metadata: { receivedUnits: Number(totals[0]?.units || 0) }
    });

    return { replayed: false };
  });

  if (result.error) return json(result, result.status || 409);

  return json({
    returnCase: await loadReturnCase(db, id),
    replayed: Boolean(result.replayed)
  }, result.replayed ? 200 : 201);
}

function normalizeInspection(body: any) {
  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 50) {
    return { error: "items_required" as const };
  }

  const seen = new Set<number>();
  const items: any[] = [];

  for (const raw of body.items) {
    const returnItemId = Number(raw?.returnItemId);
    if (!Number.isSafeInteger(returnItemId) || returnItemId < 1) {
      return { error: "invalid_return_item" as const };
    }
    if (seen.has(returnItemId)) {
      return { error: "duplicate_return_item" as const };
    }
    seen.add(returnItemId);

    if (
      !Array.isArray(raw?.dispositions) ||
      raw.dispositions.length < 1 ||
      raw.dispositions.length > 10
    ) {
      return { error: "dispositions_required" as const };
    }

    const dispositions: any[] = [];
    const seenDispositions = new Set<string>();
    for (const d of raw.dispositions) {
      const disposition = clean(d?.disposition, 40).toUpperCase();
      const quantity = Number(d?.quantity);
      const notes = clean(d?.notes, 500) || null;

      if (!DISPOSITIONS.has(disposition)) {
        return { error: "invalid_disposition" as const };
      }
      if (seenDispositions.has(disposition)) {
        return { error: "duplicate_disposition" as const };
      }
      seenDispositions.add(disposition);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
        return { error: "invalid_disposition_quantity" as const };
      }

      dispositions.push({ disposition, quantity, notes });
    }

    dispositions.sort((a, b) =>
      a.disposition.localeCompare(b.disposition) ||
      a.quantity - b.quantity
    );

    items.push({ returnItemId, dispositions });
  }

  items.sort((a, b) => a.returnItemId - b.returnItemId);

  return { value: { items } };
}

async function inspectReturnCase(req: Request, db: DB, id: number) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) {
    return json({ error: "idempotency_key_required" }, 400);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const normalized = normalizeInspection(body);
  if ("error" in normalized) {
    return json({ error: normalized.error }, 400);
  }

  const caseRows = await db`
    SELECT id, status, receive_location_id
    FROM return_cases
    WHERE id = ${id}
    LIMIT 1`;
  if (!caseRows.length) return json({ error: "not_found" }, 404);
  if (caseRows[0].receive_location_id == null) {
    return json({ error: "return_not_received" }, 409);
  }

  const locationId = Number(caseRows[0].receive_location_id);
  const auth = await authorizeInternal(req, db, "returns.inspect", {
    locationId,
    mutation: true
  });
  if (!auth.ok) return auth.response;

  const hash = requestHash({
    returnCaseId: id,
    items: normalized.value.items
  });
  const actor = actorFields(auth.actor);

  const result: any = await db.begin(async (tx: DB) => {
    const cases = await tx`
      SELECT
        id, return_number, status, receive_location_id,
        inspection_idempotency_key, inspection_idempotency_hash
      FROM return_cases
      WHERE id = ${id}
      FOR UPDATE`;
    if (!cases.length) return { error: "not_found", status: 404 };

    const returnCase = cases[0];

    if (returnCase.inspection_idempotency_key) {
      if (returnCase.inspection_idempotency_key === key) {
        if (returnCase.inspection_idempotency_hash !== hash) {
          return { error: "idempotency_conflict", status: 409 };
        }
        return { replayed: true };
      }
      return { error: "return_already_inspected", status: 409 };
    }

    if (returnCase.status !== "RECEIVED") {
      return {
        error: "invalid_transition",
        status: 409,
        current: returnCase.status,
        target: "INSPECTED"
      };
    }

    const items = await tx`
      SELECT
        id, variant_id, quantity_received
      FROM return_items
      WHERE return_case_id = ${id}
      ORDER BY id
      FOR UPDATE`;

    if (items.length !== normalized.value.items.length) {
      return { error: "all_return_items_required", status: 400 };
    }

    const itemById = new Map<number, any>(
      items.map((row: any) => [Number(row.id), row])
    );

    const dispositionTotals: Record<string, number> = {
      RESTOCK: 0,
      DAMAGED: 0,
      QUARANTINE: 0,
      RETURN_TO_SUPPLIER: 0
    };

    for (const requested of normalized.value.items) {
      const item = itemById.get(requested.returnItemId);
      if (!item) {
        return {
          error: "return_item_not_in_case",
          status: 409,
          returnItemId: requested.returnItemId
        };
      }

      const sum = requested.dispositions.reduce(
        (total: number, d: any) => total + d.quantity,
        0
      );
      if (sum !== Number(item.quantity_received)) {
        return {
          error: "disposition_quantity_mismatch",
          status: 409,
          returnItemId: requested.returnItemId,
          expected: Number(item.quantity_received),
          provided: sum
        };
      }

      for (const disposition of requested.dispositions) {
        if (disposition.disposition === "RESTOCK" && item.variant_id == null) {
          return {
            error: "restock_variant_unavailable",
            status: 409,
            returnItemId: requested.returnItemId
          };
        }
      }
    }

    for (const requested of normalized.value.items) {
      const item = itemById.get(requested.returnItemId);

      for (const disposition of requested.dispositions) {
        await tx`
          INSERT INTO return_item_dispositions(
            return_item_id, disposition, quantity, notes
          )
          VALUES(
            ${requested.returnItemId},
            ${disposition.disposition},
            ${disposition.quantity},
            ${disposition.notes}
          )`;

        dispositionTotals[disposition.disposition] += disposition.quantity;

        if (disposition.disposition === "RESTOCK") {
          const variantId = Number(item.variant_id);

          await tx`
            INSERT INTO inventory(
              variant_id, location_id, quantity, reserved, updated_at
            )
            VALUES(
              ${variantId}, ${locationId},
              ${disposition.quantity}, 0, NOW()
            )
            ON CONFLICT(variant_id, location_id)
            DO UPDATE SET
              quantity = inventory.quantity + EXCLUDED.quantity,
              updated_at = NOW()`;

          await tx`
            INSERT INTO inventory_movements(
              variant_id, location_id, movement_type,
              quantity, reference, notes
            )
            VALUES(
              ${variantId}, ${locationId}, 'CUSTOMER_RETURN',
              ${disposition.quantity},
              ${"return:" + returnCase.return_number + ":item:" + requested.returnItemId},
              'Inspected customer return approved for restock'
            )`;
        }
      }
    }

    await tx`
      UPDATE return_cases
      SET status = 'INSPECTED',
          inspection_idempotency_key = ${key},
          inspection_idempotency_hash = ${hash},
          inspected_by_user_id = ${actor.userId},
          inspected_by_service = ${actor.service},
          inspected_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "return.inspected",
      resourceType: "ReturnCase",
      resourceId: id,
      locationId,
      outcome: "SUCCESS",
      metadata: {
        dispositionTotals
      }
    });

    return { replayed: false };
  });

  if (result.error) return json(result, result.status || 409);

  return json({
    returnCase: await loadReturnCase(db, id),
    replayed: Boolean(result.replayed)
  }, result.replayed ? 200 : 201);
}

export async function handleReturns(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/returns" && req.method === "POST") {
    return createReturnCase(req, db);
  }

  if (url.pathname === "/v1/internal/returns" && req.method === "GET") {
    return listReturnCases(req, url, db);
  }

  const returnRoute = url.pathname.match(/^\/v1\/internal\/returns\/(\d+)$/);
  if (returnRoute && req.method === "GET") {
    const id = Number(returnRoute[1]);
    const returnCase = await loadReturnCase(db, id);
    if (!returnCase) return json({ error: "not_found" }, 404);

    const auth = await authorizeInternal(req, db, "returns.read", {
      locationId: returnCase.orderLocationId
    });
    if (!auth.ok) return auth.response;

    return json({ returnCase });
  }

  const approveRoute = url.pathname.match(
    /^\/v1\/internal\/returns\/(\d+)\/approve$/
  );
  if (approveRoute && req.method === "POST") {
    return transitionReturnCase(
      req,
      db,
      Number(approveRoute[1]),
      "APPROVE"
    );
  }

  const rejectRoute = url.pathname.match(
    /^\/v1\/internal\/returns\/(\d+)\/reject$/
  );
  if (rejectRoute && req.method === "POST") {
    return transitionReturnCase(
      req,
      db,
      Number(rejectRoute[1]),
      "REJECT"
    );
  }

  const cancelRoute = url.pathname.match(
    /^\/v1\/internal\/returns\/(\d+)\/cancel$/
  );
  if (cancelRoute && req.method === "POST") {
    return transitionReturnCase(
      req,
      db,
      Number(cancelRoute[1]),
      "CANCEL"
    );
  }

  const receiveRoute = url.pathname.match(
    /^\/v1\/internal\/returns\/(\d+)\/receive$/
  );
  if (receiveRoute && req.method === "POST") {
    return receiveReturnCase(req, db, Number(receiveRoute[1]));
  }

  const inspectRoute = url.pathname.match(
    /^\/v1\/internal\/returns\/(\d+)\/inspect$/
  );
  if (inspectRoute && req.method === "POST") {
    return inspectReturnCase(req, db, Number(inspectRoute[1]));
  }

  const completeRoute = url.pathname.match(
    /^\/v1\/internal\/returns\/(\d+)\/complete$/
  );
  if (completeRoute && req.method === "POST") {
    return transitionReturnCase(
      req,
      db,
      Number(completeRoute[1]),
      "COMPLETE"
    );
  }

  if (url.pathname.startsWith("/v1/internal/returns")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
