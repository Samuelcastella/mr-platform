import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const TARGET_TYPES = new Set(["PRODUCT", "CATEGORY"]);
const DIRECTIONS = new Set([
  "WATCH",
  "SOURCE_SUPPLIER",
  "EVALUATE_DIRECT_BUY",
  "PRIVATE_LABEL_CANDIDATE",
  "HOLD",
  "DECLINED"
]);
const STATUSES = new Set(["OPEN", "VALIDATED", "DISMISSED", "ARCHIVED"]);

const STATUS_TRANSITIONS: Record<string, Set<string>> = {
  OPEN: new Set(["OPEN", "VALIDATED", "DISMISSED", "ARCHIVED"]),
  VALIDATED: new Set(["VALIDATED", "OPEN", "DISMISSED", "ARCHIVED"]),
  DISMISSED: new Set(["DISMISSED", "OPEN", "ARCHIVED"]),
  ARCHIVED: new Set(["ARCHIVED"])
};

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

function parsePriority(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null;
}

function actorHistoryFields(actor: any) {
  return actor.type === "USER"
    ? { userId: actor.userId, service: null }
    : { userId: null, service: actor.service };
}

export async function ensureAssortmentDecisionSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS assortment_decisions (
      id BIGSERIAL PRIMARY KEY,
      target_type TEXT NOT NULL,
      product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
      category_text TEXT,
      target_label TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      priority SMALLINT NOT NULL DEFAULT 1,
      rationale TEXT NOT NULL,
      evidence_reference TEXT,
      owner_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (target_type IN ('PRODUCT','CATEGORY')),
      CHECK (
        (target_type='PRODUCT' AND product_id IS NOT NULL AND category_text IS NULL) OR
        (target_type='CATEGORY' AND product_id IS NULL AND category_text IS NOT NULL)
      ),
      CHECK (
        direction IN (
          'WATCH','SOURCE_SUPPLIER','EVALUATE_DIRECT_BUY',
          'PRIVATE_LABEL_CANDIDATE','HOLD','DECLINED'
        )
      ),
      CHECK (status IN ('OPEN','VALIDATED','DISMISSED','ARCHIVED')),
      CHECK (priority >= 0 AND priority <= 3)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_assortment_decisions_status_priority
    ON assortment_decisions(status,priority DESC,updated_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_assortment_decisions_product
    ON assortment_decisions(product_id,updated_at DESC)
    WHERE product_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS assortment_decision_history (
      id BIGSERIAL PRIMARY KEY,
      decision_id BIGINT NOT NULL REFERENCES assortment_decisions(id) ON DELETE RESTRICT,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      from_direction TEXT,
      to_direction TEXT,
      from_status TEXT,
      to_status TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (actor_user_id IS NOT NULL AND actor_service IS NULL) OR
        (actor_user_id IS NULL AND actor_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_assortment_decision_history_decision
    ON assortment_decision_history(decision_id,id)`;
}

async function decisionRow(db: DB, id: number) {
  const rows = await db`
    SELECT
      d.id,d.target_type,d.product_id,d.category_text,d.target_label,
      d.direction,d.status,d.priority,d.rationale,d.evidence_reference,
      d.owner_user_id,owner.display_name AS owner_display_name,
      d.created_by_user_id,creator.display_name AS created_by_display_name,
      d.updated_by_user_id,updater.display_name AS updated_by_display_name,
      d.created_at,d.updated_at
    FROM assortment_decisions d
    LEFT JOIN staff_users owner ON owner.id=d.owner_user_id
    LEFT JOIN staff_users creator ON creator.id=d.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=d.updated_by_user_id
    WHERE d.id=${id}
    LIMIT 1`;
  return rows[0] || null;
}

function mapDecision(row: any) {
  return {
    id:Number(row.id),
    targetType:row.target_type,
    productId:row.product_id == null ? null : Number(row.product_id),
    category:row.category_text || null,
    targetLabel:row.target_label,
    direction:row.direction,
    status:row.status,
    priority:Number(row.priority),
    rationale:row.rationale,
    evidenceReference:row.evidence_reference || null,
    owner:row.owner_user_id == null ? null : {
      userId:Number(row.owner_user_id),
      displayName:row.owner_display_name || null
    },
    createdBy:row.created_by_user_id == null ? null : {
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name || null
    },
    updatedBy:row.updated_by_user_id == null ? null : {
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name || null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

async function historyFor(db: DB, id: number) {
  const rows = await db`
    SELECT
      h.id,h.decision_id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.from_direction,h.to_direction,
      h.from_status,h.to_status,h.note,h.created_at
    FROM assortment_decision_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.decision_id=${id}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id == null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name || null},
    action:row.action,
    fromDirection:row.from_direction || null,
    toDirection:row.to_direction || null,
    fromStatus:row.from_status || null,
    toStatus:row.to_status || null,
    note:row.note || null,
    createdAt:row.created_at
  }));
}

async function listDecisions(req: Request, url: URL, db: DB) {
  const auth = await authorizeInternal(req, db, "assortment.decisions.read");
  if (!auth.ok) return auth.response;

  const status = clean(url.searchParams.get("status"), 24).toUpperCase();
  const direction = clean(url.searchParams.get("direction"), 40).toUpperCase();
  const targetType = clean(url.searchParams.get("targetType"), 20).toUpperCase();

  if (status && !STATUSES.has(status)) return json({error:"invalid_status"},400);
  if (direction && !DIRECTIONS.has(direction)) return json({error:"invalid_direction"},400);
  if (targetType && !TARGET_TYPES.has(targetType)) return json({error:"invalid_target_type"},400);

  const rows = await db`
    SELECT
      d.id,d.target_type,d.product_id,d.category_text,d.target_label,
      d.direction,d.status,d.priority,d.rationale,d.evidence_reference,
      d.owner_user_id,owner.display_name AS owner_display_name,
      d.created_by_user_id,creator.display_name AS created_by_display_name,
      d.updated_by_user_id,updater.display_name AS updated_by_display_name,
      d.created_at,d.updated_at
    FROM assortment_decisions d
    LEFT JOIN staff_users owner ON owner.id=d.owner_user_id
    LEFT JOIN staff_users creator ON creator.id=d.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=d.updated_by_user_id
    WHERE (${status || null}::text IS NULL OR d.status=${status || null}::text)
      AND (${direction || null}::text IS NULL OR d.direction=${direction || null}::text)
      AND (${targetType || null}::text IS NULL OR d.target_type=${targetType || null}::text)
    ORDER BY
      CASE d.status WHEN 'OPEN' THEN 0 WHEN 'VALIDATED' THEN 1 WHEN 'DISMISSED' THEN 2 ELSE 3 END,
      d.priority DESC,d.updated_at DESC,d.id DESC
    LIMIT 200`;

  return json({data:rows.map(mapDecision)});
}

async function getDecision(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "assortment.decisions.read");
  if (!auth.ok) return auth.response;

  const row = await decisionRow(db,id);
  if (!row) return json({error:"not_found"},404);

  return json({
    decision:mapDecision(row),
    history:await historyFor(db,id),
    automatedActionsTriggered:false
  });
}

async function resolveTarget(db: DB, targetType: string, body: any) {
  if (targetType === "PRODUCT") {
    const productId = Number(body?.productId);
    if (!Number.isSafeInteger(productId) || productId < 1) {
      return {error:"product_required" as const};
    }
    const rows = await db`
      SELECT id,name,category
      FROM products
      WHERE id=${productId}
      LIMIT 1`;
    if (!rows.length) return {error:"product_not_found" as const,status:404};
    return {
      productId,
      category:null,
      targetLabel:String(rows[0].name),
      sourceCategory:rows[0].category || null
    };
  }

  const category = clean(body?.category,120);
  if (!category) return {error:"category_required" as const};
  return {
    productId:null,
    category,
    targetLabel:category,
    sourceCategory:category
  };
}

async function validateOwner(db: DB, raw: unknown) {
  if (raw == null || raw === "") return {ownerUserId:null};
  const ownerUserId = Number(raw);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) {
    return {error:"invalid_owner" as const};
  }
  const rows = await db`
    SELECT id
    FROM staff_users
    WHERE id=${ownerUserId} AND status='ACTIVE'
    LIMIT 1`;
  if (!rows.length) return {error:"owner_not_active" as const};
  return {ownerUserId};
}

async function createDecision(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "assortment.decisions.manage", {mutation:true});
  if (!auth.ok) return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const targetType = clean(body?.targetType,20).toUpperCase();
  const direction = clean(body?.direction,40).toUpperCase();
  const rationale = clean(body?.rationale,4000);
  const evidenceReference = clean(body?.evidenceReference,1000) || null;
  const priority = parsePriority(body?.priority ?? 1);

  if (!TARGET_TYPES.has(targetType)) return json({error:"invalid_target_type"},400);
  if (!DIRECTIONS.has(direction)) return json({error:"invalid_direction"},400);
  if (rationale.length < 8) return json({error:"rationale_required"},400);
  if (priority == null) return json({error:"invalid_priority"},400);

  const target:any = await resolveTarget(db,targetType,body);
  if (target.error) return json({error:target.error},target.status || 400);

  const owner:any = await validateOwner(db,body?.ownerUserId);
  if (owner.error) return json({error:owner.error},400);

  const actor = actorHistoryFields(auth.actor);
  const defaultOwner = owner.ownerUserId == null && auth.actor.type === "USER"
    ? auth.actor.userId
    : owner.ownerUserId;

  const result:any = await db.begin(async (tx:DB)=>{
    const rows = await tx`
      INSERT INTO assortment_decisions(
        target_type,product_id,category_text,target_label,
        direction,status,priority,rationale,evidence_reference,
        owner_user_id,created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${targetType},${target.productId},${target.category},${target.targetLabel},
        ${direction},'OPEN',${priority},${rationale},${evidenceReference},
        ${defaultOwner},${auth.actor.type==="USER" ? auth.actor.userId : null},
        ${auth.actor.type==="USER" ? auth.actor.userId : null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);

    await tx`
      INSERT INTO assortment_decision_history(
        decision_id,actor_user_id,actor_service,action,
        from_direction,to_direction,from_status,to_status,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CREATED',
        NULL,${direction},NULL,'OPEN',${rationale}
      )`;

    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"assortment_decision.created",
      resourceType:"AssortmentDecision",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        targetType,
        productId:target.productId,
        category:target.category,
        direction,
        priority,
        automatedActionsTriggered:false
      }
    });

    return {id};
  });

  const row=await decisionRow(db,result.id);
  return json({
    decision:mapDecision(row),
    automatedActionsTriggered:false
  },201);
}

async function updateDecision(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "assortment.decisions.manage", {mutation:true});
  if (!auth.ok) return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const existing=await decisionRow(db,id);
  if (!existing) return json({error:"not_found"},404);

  const currentStatus=String(existing.status);
  if (currentStatus === "ARCHIVED") {
    return json({error:"decision_archived"},409);
  }

  const directionRaw=body?.direction == null ? null : clean(body.direction,40).toUpperCase();
  const statusRaw=body?.status == null ? null : clean(body.status,24).toUpperCase();
  const priorityRaw=body?.priority == null ? null : parsePriority(body.priority);
  const rationaleRaw=body?.rationale == null ? null : clean(body.rationale,4000);
  const evidenceProvided=Object.prototype.hasOwnProperty.call(body||{},"evidenceReference");
  const evidenceReference=evidenceProvided ? (clean(body.evidenceReference,1000) || null) : existing.evidence_reference;
  const ownerProvided=Object.prototype.hasOwnProperty.call(body||{},"ownerUserId");

  if (directionRaw && !DIRECTIONS.has(directionRaw)) return json({error:"invalid_direction"},400);
  if (statusRaw && !STATUSES.has(statusRaw)) return json({error:"invalid_status"},400);
  if (priorityRaw == null && body?.priority != null) return json({error:"invalid_priority"},400);
  if (rationaleRaw != null && rationaleRaw.length < 8) return json({error:"rationale_required"},400);

  const nextDirection=directionRaw || existing.direction;
  const nextStatus=statusRaw || existing.status;
  const nextPriority=priorityRaw == null ? Number(existing.priority) : priorityRaw;
  const nextRationale=rationaleRaw == null ? existing.rationale : rationaleRaw;

  if (!STATUS_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    return json({error:"invalid_status_transition",from:currentStatus,to:nextStatus},409);
  }

  let nextOwner = existing.owner_user_id == null ? null : Number(existing.owner_user_id);
  if (ownerProvided) {
    const owner:any=await validateOwner(db,body.ownerUserId);
    if (owner.error) return json({error:owner.error},400);
    nextOwner=owner.ownerUserId;
  }

  const note=clean(body?.note,1000) || null;
  const actor=actorHistoryFields(auth.actor);

  await db.begin(async (tx:DB)=>{
    await tx`
      UPDATE assortment_decisions
      SET direction=${nextDirection},
          status=${nextStatus},
          priority=${nextPriority},
          rationale=${nextRationale},
          evidence_reference=${evidenceReference},
          owner_user_id=${nextOwner},
          updated_by_user_id=${auth.actor.type==="USER" ? auth.actor.userId : null},
          updated_at=NOW()
      WHERE id=${id}`;

    await tx`
      INSERT INTO assortment_decision_history(
        decision_id,actor_user_id,actor_service,action,
        from_direction,to_direction,from_status,to_status,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${existing.direction},${nextDirection},${existing.status},${nextStatus},
        ${note || nextRationale}
      )`;

    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"assortment_decision.updated",
      resourceType:"AssortmentDecision",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        fromDirection:existing.direction,
        toDirection:nextDirection,
        fromStatus:existing.status,
        toStatus:nextStatus,
        priority:nextPriority,
        automatedActionsTriggered:false
      }
    });
  });

  const row=await decisionRow(db,id);
  return json({
    decision:mapDecision(row),
    history:await historyFor(db,id),
    automatedActionsTriggered:false
  });
}

export async function handleAssortmentDecisions(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/assortment-decisions") {
    if (req.method === "GET") return listDecisions(req,url,db);
    if (req.method === "POST") return createDecision(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const match=url.pathname.match(/^\/v1\/internal\/assortment-decisions\/(\d+)$/);
  if (match) {
    const id=Number(match[1]);
    if (req.method === "GET") return getDecision(req,db,id);
    if (req.method === "PATCH") return updateDecision(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if (url.pathname.startsWith("/v1/internal/assortment-decisions")) {
    return json({error:"not_found"},404);
  }

  return null;
}
