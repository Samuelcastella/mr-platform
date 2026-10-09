import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const TYPES = new Set(["SUPPLIER","SAMPLE"]);
const CRITERIA = new Set(["NOT_REVIEWED","ACCEPTABLE","CONCERN","UNACCEPTABLE"]);
const DECISIONS = new Set(["CONTINUE","SHORTLIST","REQUEST_REVISION","HOLD","DECLINE"]);
const STATUSES = new Set(["OPEN","FINAL","ARCHIVED"]);

const STATUS_TRANSITIONS: Record<string, Set<string>> = {
  OPEN:new Set(["OPEN","FINAL","ARCHIVED"]),
  FINAL:new Set(["FINAL","OPEN","ARCHIVED"]),
  ARCHIVED:new Set(["ARCHIVED"])
};

const json=(body:unknown,status=200)=>
  Response.json(body,{
    status,
    headers:{
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });

function clean(value:unknown,max:number){
  return typeof value==="string" ? value.trim().slice(0,max) : "";
}

function criterion(value:unknown,fallback="NOT_REVIEWED"){
  const v=clean(value,32).toUpperCase() || fallback;
  return CRITERIA.has(v) ? v : "";
}

function actorFields(actor:any){
  return actor.type==="USER"
    ? {userId:actor.userId,service:null}
    : {userId:null,service:actor.service};
}

export async function ensureSupplierEvaluationSchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS supplier_evaluations (
      id BIGSERIAL PRIMARY KEY,
      evaluation_type TEXT NOT NULL,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      supplier_variant_id BIGINT REFERENCES supplier_variants(id) ON DELETE RESTRICT,
      sample_reference TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      decision TEXT NOT NULL,
      quality TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
      consistency TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
      communication TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
      lead_time_confidence TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
      packaging TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
      rationale TEXT NOT NULL,
      evidence_reference TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (evaluation_type IN ('SUPPLIER','SAMPLE')),
      CHECK (status IN ('OPEN','FINAL','ARCHIVED')),
      CHECK (decision IN ('CONTINUE','SHORTLIST','REQUEST_REVISION','HOLD','DECLINE')),
      CHECK (quality IN ('NOT_REVIEWED','ACCEPTABLE','CONCERN','UNACCEPTABLE')),
      CHECK (consistency IN ('NOT_REVIEWED','ACCEPTABLE','CONCERN','UNACCEPTABLE')),
      CHECK (communication IN ('NOT_REVIEWED','ACCEPTABLE','CONCERN','UNACCEPTABLE')),
      CHECK (lead_time_confidence IN ('NOT_REVIEWED','ACCEPTABLE','CONCERN','UNACCEPTABLE')),
      CHECK (packaging IN ('NOT_REVIEWED','ACCEPTABLE','CONCERN','UNACCEPTABLE')),
      CHECK (
        evaluation_type <> 'SAMPLE'
        OR supplier_variant_id IS NOT NULL
        OR sample_reference IS NOT NULL
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_supplier_evaluations_supplier
    ON supplier_evaluations(supplier_id,status,updated_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_supplier_evaluations_offer
    ON supplier_evaluations(supplier_variant_id,updated_at DESC)
    WHERE supplier_variant_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS supplier_evaluation_history (
      id BIGSERIAL PRIMARY KEY,
      evaluation_id BIGINT NOT NULL REFERENCES supplier_evaluations(id) ON DELETE RESTRICT,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (actor_user_id IS NOT NULL AND actor_service IS NULL) OR
        (actor_user_id IS NULL AND actor_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_supplier_evaluation_history_eval
    ON supplier_evaluation_history(evaluation_id,id)`;
}

async function loadEvaluation(db:DB,id:number){
  const rows=await db`
    SELECT
      e.id,e.evaluation_type,e.supplier_id,s.name AS supplier_name,
      s.country_code AS supplier_country_code,s.active AS supplier_active,
      e.supplier_variant_id,sv.variant_id,pv.sku,
      p.id AS product_id,p.name AS product_name,p.category,
      e.sample_reference,e.status,e.decision,
      e.quality,e.consistency,e.communication,e.lead_time_confidence,e.packaging,
      e.rationale,e.evidence_reference,
      e.created_by_user_id,creator.display_name AS created_by_display_name,
      e.updated_by_user_id,updater.display_name AS updated_by_display_name,
      e.created_at,e.updated_at
    FROM supplier_evaluations e
    JOIN suppliers s ON s.id=e.supplier_id
    LEFT JOIN supplier_variants sv ON sv.id=e.supplier_variant_id
    LEFT JOIN product_variants pv ON pv.id=sv.variant_id
    LEFT JOIN products p ON p.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=e.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=e.updated_by_user_id
    WHERE e.id=${id}
    LIMIT 1`;
  return rows[0] || null;
}

function mapEvaluation(row:any){
  return {
    id:Number(row.id),
    type:row.evaluation_type,
    supplier:{
      id:Number(row.supplier_id),
      name:row.supplier_name,
      countryCode:row.supplier_country_code || null,
      active:Boolean(row.supplier_active)
    },
    sourcingOffer:row.supplier_variant_id==null ? null : {
      id:Number(row.supplier_variant_id),
      variantId:Number(row.variant_id),
      sku:row.sku,
      productId:row.product_id==null ? null : Number(row.product_id),
      productName:row.product_name || null,
      category:row.category || null
    },
    sampleReference:row.sample_reference || null,
    status:row.status,
    decision:row.decision,
    criteria:{
      quality:row.quality,
      consistency:row.consistency,
      communication:row.communication,
      leadTimeConfidence:row.lead_time_confidence,
      packaging:row.packaging
    },
    rationale:row.rationale,
    evidenceReference:row.evidence_reference || null,
    createdBy:row.created_by_user_id==null ? null : {
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name || null
    },
    updatedBy:row.updated_by_user_id==null ? null : {
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name || null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    compositeScore:null,
    automaticSupplierSelection:false
  };
}

function snapshot(row:any){
  const e=mapEvaluation(row);
  return {
    type:e.type,
    supplierId:e.supplier.id,
    supplierVariantId:e.sourcingOffer?.id || null,
    sampleReference:e.sampleReference,
    status:e.status,
    decision:e.decision,
    criteria:e.criteria,
    rationale:e.rationale,
    evidenceReference:e.evidenceReference
  };
}

async function history(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM supplier_evaluation_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.evaluation_id=${id}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name || null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note || null,
    createdAt:row.created_at
  }));
}

async function validateSupplierAndOffer(db:DB,supplierId:number,supplierVariantId:number|null){
  const suppliers=await db`
    SELECT id
    FROM suppliers
    WHERE id=${supplierId}
    LIMIT 1`;
  if(!suppliers.length) return {error:"supplier_not_found" as const,status:404};

  if(supplierVariantId==null) return {ok:true as const};

  const offers=await db`
    SELECT id,supplier_id
    FROM supplier_variants
    WHERE id=${supplierVariantId}
    LIMIT 1`;
  if(!offers.length) return {error:"sourcing_offer_not_found" as const,status:404};
  if(Number(offers[0].supplier_id)!==supplierId){
    return {error:"sourcing_offer_supplier_mismatch" as const,status:409};
  }
  return {ok:true as const};
}

async function listEvaluations(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"suppliers.read");
  if(!auth.ok) return auth.response;

  const type=clean(url.searchParams.get("type"),20).toUpperCase();
  const status=clean(url.searchParams.get("status"),20).toUpperCase();
  const supplierRaw=url.searchParams.get("supplierId");
  const supplierId=supplierRaw ? Number(supplierRaw) : null;

  if(type && !TYPES.has(type)) return json({error:"invalid_type"},400);
  if(status && !STATUSES.has(status)) return json({error:"invalid_status"},400);
  if(supplierId!=null && (!Number.isSafeInteger(supplierId)||supplierId<1)){
    return json({error:"invalid_supplier"},400);
  }

  const rows=await db`
    SELECT
      e.id,e.evaluation_type,e.supplier_id,s.name AS supplier_name,
      s.country_code AS supplier_country_code,s.active AS supplier_active,
      e.supplier_variant_id,sv.variant_id,pv.sku,
      p.id AS product_id,p.name AS product_name,p.category,
      e.sample_reference,e.status,e.decision,
      e.quality,e.consistency,e.communication,e.lead_time_confidence,e.packaging,
      e.rationale,e.evidence_reference,
      e.created_by_user_id,creator.display_name AS created_by_display_name,
      e.updated_by_user_id,updater.display_name AS updated_by_display_name,
      e.created_at,e.updated_at
    FROM supplier_evaluations e
    JOIN suppliers s ON s.id=e.supplier_id
    LEFT JOIN supplier_variants sv ON sv.id=e.supplier_variant_id
    LEFT JOIN product_variants pv ON pv.id=sv.variant_id
    LEFT JOIN products p ON p.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=e.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=e.updated_by_user_id
    WHERE (${type || null}::text IS NULL OR e.evaluation_type=${type || null}::text)
      AND (${status || null}::text IS NULL OR e.status=${status || null}::text)
      AND (${supplierId}::bigint IS NULL OR e.supplier_id=${supplierId}::bigint)
    ORDER BY
      CASE e.status WHEN 'OPEN' THEN 0 WHEN 'FINAL' THEN 1 ELSE 2 END,
      e.updated_at DESC,e.id DESC
    LIMIT 300`;

  return json({data:rows.map(mapEvaluation)});
}

async function createEvaluation(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"suppliers.write",{mutation:true});
  if(!auth.ok) return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const type=clean(body?.type,20).toUpperCase();
  const supplierId=Number(body?.supplierId);
  const supplierVariantId=body?.supplierVariantId==null||body?.supplierVariantId===""
    ? null
    : Number(body.supplierVariantId);
  const sampleReference=clean(body?.sampleReference,240) || null;
  const decision=clean(body?.decision,32).toUpperCase();
  const rationale=clean(body?.rationale,4000);
  const evidenceReference=clean(body?.evidenceReference,1000) || null;

  if(!TYPES.has(type)) return json({error:"invalid_type"},400);
  if(!Number.isSafeInteger(supplierId)||supplierId<1) return json({error:"invalid_supplier"},400);
  if(
    supplierVariantId!=null &&
    (!Number.isSafeInteger(supplierVariantId)||supplierVariantId<1)
  ) return json({error:"invalid_sourcing_offer"},400);
  if(!DECISIONS.has(decision)) return json({error:"invalid_decision"},400);
  if(rationale.length<8) return json({error:"rationale_required"},400);
  if(type==="SAMPLE" && supplierVariantId==null && !sampleReference){
    return json({error:"sample_reference_or_offer_required"},400);
  }

  const criteria={
    quality:criterion(body?.criteria?.quality),
    consistency:criterion(body?.criteria?.consistency),
    communication:criterion(body?.criteria?.communication),
    leadTimeConfidence:criterion(body?.criteria?.leadTimeConfidence),
    packaging:criterion(body?.criteria?.packaging)
  };
  if(Object.values(criteria).some(v=>!v)) return json({error:"invalid_criterion"},400);

  const valid=await validateSupplierAndOffer(db,supplierId,supplierVariantId);
  if("error" in valid) return json({error:valid.error},valid.status);

  const actor=actorFields(auth.actor);

  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      INSERT INTO supplier_evaluations(
        evaluation_type,supplier_id,supplier_variant_id,sample_reference,
        status,decision,quality,consistency,communication,lead_time_confidence,packaging,
        rationale,evidence_reference,created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${type},${supplierId},${supplierVariantId},${sampleReference},
        'OPEN',${decision},
        ${criteria.quality},${criteria.consistency},${criteria.communication},
        ${criteria.leadTimeConfidence},${criteria.packaging},
        ${rationale},${evidenceReference},
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    const row=await loadEvaluation(tx,id);
    const snap=snapshot(row);

    await tx`
      INSERT INTO supplier_evaluation_history(
        evaluation_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CREATED',
        ${JSON.stringify(snap)}::jsonb,${rationale}
      )`;

    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"supplier_evaluation.created",
      resourceType:"SupplierEvaluation",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        type,supplierId,supplierVariantId,decision,
        compositeScore:null,
        automaticSupplierSelection:false,
        createsPurchaseOrder:false
      }
    });

    return {id};
  });

  const row=await loadEvaluation(db,result.id);
  return json({
    evaluation:mapEvaluation(row),
    createsPurchaseOrder:false,
    inventoryChanged:false,
    supplierPreferenceChanged:false
  },201);
}

async function updateEvaluation(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"suppliers.write",{mutation:true});
  if(!auth.ok) return auth.response;

  const existing=await loadEvaluation(db,id);
  if(!existing) return json({error:"not_found"},404);
  if(existing.status==="ARCHIVED") return json({error:"evaluation_archived"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const nextStatus=body?.status==null
    ? String(existing.status)
    : clean(body.status,20).toUpperCase();
  const nextDecision=body?.decision==null
    ? String(existing.decision)
    : clean(body.decision,32).toUpperCase();
  if(!STATUSES.has(nextStatus)) return json({error:"invalid_status"},400);
  if(!DECISIONS.has(nextDecision)) return json({error:"invalid_decision"},400);
  if(!STATUS_TRANSITIONS[String(existing.status)]?.has(nextStatus)){
    return json({error:"invalid_status_transition"},409);
  }

  const existingCriteria={
    quality:String(existing.quality),
    consistency:String(existing.consistency),
    communication:String(existing.communication),
    leadTimeConfidence:String(existing.lead_time_confidence),
    packaging:String(existing.packaging)
  };

  const inputCriteria=body?.criteria && typeof body.criteria==="object" ? body.criteria : {};
  const criteria={
    quality:Object.prototype.hasOwnProperty.call(inputCriteria,"quality")
      ? criterion(inputCriteria.quality,"")
      : existingCriteria.quality,
    consistency:Object.prototype.hasOwnProperty.call(inputCriteria,"consistency")
      ? criterion(inputCriteria.consistency,"")
      : existingCriteria.consistency,
    communication:Object.prototype.hasOwnProperty.call(inputCriteria,"communication")
      ? criterion(inputCriteria.communication,"")
      : existingCriteria.communication,
    leadTimeConfidence:Object.prototype.hasOwnProperty.call(inputCriteria,"leadTimeConfidence")
      ? criterion(inputCriteria.leadTimeConfidence,"")
      : existingCriteria.leadTimeConfidence,
    packaging:Object.prototype.hasOwnProperty.call(inputCriteria,"packaging")
      ? criterion(inputCriteria.packaging,"")
      : existingCriteria.packaging
  };
  if(Object.values(criteria).some(v=>!v)) return json({error:"invalid_criterion"},400);

  const rationale=body?.rationale==null
    ? String(existing.rationale)
    : clean(body.rationale,4000);
  if(rationale.length<8) return json({error:"rationale_required"},400);

  const evidenceReference=Object.prototype.hasOwnProperty.call(body||{},"evidenceReference")
    ? (clean(body.evidenceReference,1000) || null)
    : existing.evidence_reference || null;
  const sampleReference=Object.prototype.hasOwnProperty.call(body||{},"sampleReference")
    ? (clean(body.sampleReference,240) || null)
    : existing.sample_reference || null;

  if(
    existing.evaluation_type==="SAMPLE" &&
    existing.supplier_variant_id==null &&
    !sampleReference
  ) return json({error:"sample_reference_or_offer_required"},400);

  const note=clean(body?.note,1000) || null;
  const actor=actorFields(auth.actor);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE supplier_evaluations
      SET status=${nextStatus},
          decision=${nextDecision},
          quality=${criteria.quality},
          consistency=${criteria.consistency},
          communication=${criteria.communication},
          lead_time_confidence=${criteria.leadTimeConfidence},
          packaging=${criteria.packaging},
          sample_reference=${sampleReference},
          rationale=${rationale},
          evidence_reference=${evidenceReference},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;

    const row=await loadEvaluation(tx,id);
    const snap=snapshot(row);

    await tx`
      INSERT INTO supplier_evaluation_history(
        evaluation_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;

    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"supplier_evaluation.updated",
      resourceType:"SupplierEvaluation",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        fromStatus:existing.status,
        toStatus:nextStatus,
        fromDecision:existing.decision,
        toDecision:nextDecision,
        compositeScore:null,
        automaticSupplierSelection:false,
        createsPurchaseOrder:false
      }
    });
  });

  const row=await loadEvaluation(db,id);
  return json({
    evaluation:mapEvaluation(row),
    history:await history(db,id),
    createsPurchaseOrder:false,
    inventoryChanged:false,
    supplierPreferenceChanged:false
  });
}

async function getEvaluation(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"suppliers.read");
  if(!auth.ok) return auth.response;

  const row=await loadEvaluation(db,id);
  if(!row) return json({error:"not_found"},404);
  return json({
    evaluation:mapEvaluation(row),
    history:await history(db,id),
    createsPurchaseOrder:false,
    automaticSupplierSelection:false
  });
}

export async function handleSupplierEvaluations(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/sourcing/evaluations"){
    if(req.method==="GET") return listEvaluations(req,url,db);
    if(req.method==="POST") return createEvaluation(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const match=url.pathname.match(/^\/v1\/internal\/sourcing\/evaluations\/(\d+)$/);
  if(match){
    const id=Number(match[1]);
    if(req.method==="GET") return getEvaluation(req,db,id);
    if(req.method==="PATCH") return updateEvaluation(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  return null;
}
