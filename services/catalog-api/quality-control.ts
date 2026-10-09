import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const INSPECTION_TYPES=new Set(["SAMPLE","PRE_PRODUCTION","IN_PROCESS","FINAL","RECEIVING"]);
const TARGET_TYPES=new Set(["PRODUCT","VARIANT"]);
const RESULTS=new Set(["PENDING","PASS","CONDITIONAL","FAIL"]);
const DEFECT_SEVERITIES=new Set(["MINOR","MAJOR","CRITICAL"]);

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

function actorFields(actor:any){
  return actor.type==="USER"
    ? {userId:actor.userId,service:null}
    : {userId:null,service:actor.service};
}

function parseJsonObject(value:unknown){
  if(value==null)return {};
  if(typeof value==="string"){
    try{
      const parsed=JSON.parse(value);
      return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
    }catch{return {};}
  }
  return typeof value==="object"&&!Array.isArray(value)?value:{};
}

export async function ensureQualityControlSchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS quality_inspections (
      id BIGSERIAL PRIMARY KEY,
      inspection_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
      variant_id BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
      specification_version_id BIGINT REFERENCES product_specification_versions(id) ON DELETE RESTRICT,
      sample_reference TEXT,
      inspected_quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      result TEXT NOT NULL DEFAULT 'PENDING',
      rationale TEXT,
      evidence_reference TEXT,
      aql_reference TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      finalized_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      finalized_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (inspection_type IN ('SAMPLE','PRE_PRODUCTION','IN_PROCESS','FINAL','RECEIVING')),
      CHECK (target_type IN ('PRODUCT','VARIANT')),
      CHECK (
        (target_type='PRODUCT' AND product_id IS NOT NULL AND variant_id IS NULL) OR
        (target_type='VARIANT' AND product_id IS NULL AND variant_id IS NOT NULL)
      ),
      CHECK (inspected_quantity>=1),
      CHECK (status IN ('DRAFT','FINAL')),
      CHECK (result IN ('PENDING','PASS','CONDITIONAL','FAIL'))
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_quality_inspections_target_product
    ON quality_inspections(product_id,status,updated_at DESC)
    WHERE product_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_quality_inspections_target_variant
    ON quality_inspections(variant_id,status,updated_at DESC)
    WHERE variant_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS quality_defects (
      id BIGSERIAL PRIMARY KEY,
      inspection_id BIGINT NOT NULL REFERENCES quality_inspections(id) ON DELETE RESTRICT,
      severity TEXT NOT NULL,
      defect_code TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      evidence_reference TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (severity IN ('MINOR','MAJOR','CRITICAL')),
      CHECK (quantity>=1)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_quality_defects_inspection
    ON quality_defects(inspection_id,active,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS quality_inspection_history (
      id BIGSERIAL PRIMARY KEY,
      inspection_id BIGINT NOT NULL REFERENCES quality_inspections(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_quality_inspection_history_record
    ON quality_inspection_history(inspection_id,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS quality_defect_history (
      id BIGSERIAL PRIMARY KEY,
      defect_id BIGINT NOT NULL REFERENCES quality_defects(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_quality_defect_history_record
    ON quality_defect_history(defect_id,id)`;
}

async function inspectionRow(db:DB,id:number){
  const rows=await db`
    SELECT
      q.id,q.inspection_type,q.target_type,q.product_id,q.variant_id,
      q.specification_version_id,q.sample_reference,q.inspected_quantity,
      q.status,q.result,q.rationale,q.evidence_reference,q.aql_reference,
      COALESCE(p.id,vp.id) AS resolved_product_id,
      COALESCE(p.name,vp.name) AS product_name,
      COALESCE(p.category,vp.category) AS category,
      pv.sku,pv.size,pv.color,
      sv.version_no AS specification_version_no,
      sv.status AS specification_version_status,
      ps.id AS specification_id,ps.code AS specification_code,ps.title AS specification_title,
      q.created_by_user_id,creator.display_name AS created_by_display_name,
      q.updated_by_user_id,updater.display_name AS updated_by_display_name,
      q.finalized_by_user_id,finalizer.display_name AS finalized_by_display_name,
      q.finalized_at,q.created_at,q.updated_at
    FROM quality_inspections q
    LEFT JOIN products p ON p.id=q.product_id
    LEFT JOIN product_variants pv ON pv.id=q.variant_id
    LEFT JOIN products vp ON vp.id=pv.product_id
    LEFT JOIN product_specification_versions sv ON sv.id=q.specification_version_id
    LEFT JOIN product_specifications ps ON ps.id=sv.specification_id
    LEFT JOIN staff_users creator ON creator.id=q.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=q.updated_by_user_id
    LEFT JOIN staff_users finalizer ON finalizer.id=q.finalized_by_user_id
    WHERE q.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapInspection(row:any){
  return {
    id:Number(row.id),
    inspectionType:row.inspection_type,
    targetType:row.target_type,
    productId:row.resolved_product_id==null?null:Number(row.resolved_product_id),
    variantId:row.variant_id==null?null:Number(row.variant_id),
    productName:row.product_name||null,
    category:row.category||null,
    sku:row.sku||null,
    size:row.size||null,
    color:row.color||null,
    specificationVersion:row.specification_version_id==null?null:{
      id:Number(row.specification_version_id),
      versionNo:Number(row.specification_version_no),
      status:row.specification_version_status,
      specificationId:Number(row.specification_id),
      code:row.specification_code,
      title:row.specification_title
    },
    sampleReference:row.sample_reference||null,
    inspectedQuantity:Number(row.inspected_quantity),
    status:row.status,
    result:row.result,
    rationale:row.rationale||null,
    evidenceReference:row.evidence_reference||null,
    aqlReference:row.aql_reference||null,
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    finalizedBy:row.finalized_by_user_id==null?null:{
      userId:Number(row.finalized_by_user_id),
      displayName:row.finalized_by_display_name||null
    },
    finalizedAt:row.finalized_at||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    resultCalculatedAutomatically:false,
    inventoryChanged:false,
    productionRunChanged:false
  };
}

async function defectRows(db:DB,inspectionId:number){
  const rows=await db`
    SELECT
      d.id,d.inspection_id,d.severity,d.defect_code,d.description,d.quantity,
      d.evidence_reference,d.active,
      d.created_by_user_id,creator.display_name AS created_by_display_name,
      d.updated_by_user_id,updater.display_name AS updated_by_display_name,
      d.created_at,d.updated_at
    FROM quality_defects d
    LEFT JOIN staff_users creator ON creator.id=d.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=d.updated_by_user_id
    WHERE d.inspection_id=${inspectionId}
    ORDER BY d.active DESC,
      CASE d.severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END,
      d.id`;
  return rows;
}

function mapDefect(row:any){
  return {
    id:Number(row.id),
    inspectionId:Number(row.inspection_id),
    severity:row.severity,
    defectCode:row.defect_code,
    description:row.description,
    quantity:Number(row.quantity),
    evidenceReference:row.evidence_reference||null,
    active:Boolean(row.active),
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

async function defectRow(db:DB,id:number){
  const rows=await db`
    SELECT
      d.id,d.inspection_id,d.severity,d.defect_code,d.description,d.quantity,
      d.evidence_reference,d.active,
      d.created_by_user_id,creator.display_name AS created_by_display_name,
      d.updated_by_user_id,updater.display_name AS updated_by_display_name,
      d.created_at,d.updated_at
    FROM quality_defects d
    LEFT JOIN staff_users creator ON creator.id=d.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=d.updated_by_user_id
    WHERE d.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

async function fullSnapshot(db:DB,inspectionId:number){
  const row=await inspectionRow(db,inspectionId);
  const defects=await defectRows(db,inspectionId);
  return {
    inspection:row?mapInspection(row):null,
    defects:defects.map(mapDefect)
  };
}

async function history(db:DB,inspectionId:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM quality_inspection_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.inspection_id=${inspectionId}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:parseJsonObject(row.snapshot),
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function resolveTarget(db:DB,targetType:string,targetId:number){
  if(targetType==="PRODUCT"){
    const rows=await db`
      SELECT id,name,category
      FROM products
      WHERE id=${targetId}
      LIMIT 1`;
    if(!rows.length)return {error:"product_not_found" as const,status:404};
    return {productId:targetId,variantId:null,resolvedProductId:targetId};
  }
  const rows=await db`
    SELECT pv.id,pv.product_id,p.name
    FROM product_variants pv
    JOIN products p ON p.id=pv.product_id
    WHERE pv.id=${targetId}
    LIMIT 1`;
  if(!rows.length)return {error:"variant_not_found" as const,status:404};
  return {
    productId:null,
    variantId:targetId,
    resolvedProductId:Number(rows[0].product_id)
  };
}

async function validateSpecificationVersion(
  db:DB,
  specificationVersionId:number|null,
  targetType:string,
  target:any
){
  if(specificationVersionId==null)return {ok:true as const,observed:null};

  const rows=await db`
    SELECT
      v.id,v.version_no,v.status,v.specification_id,
      s.target_type,s.product_id,s.variant_id,
      COALESCE(s.product_id,pv.product_id) AS resolved_product_id
    FROM product_specification_versions v
    JOIN product_specifications s ON s.id=v.specification_id
    LEFT JOIN product_variants pv ON pv.id=s.variant_id
    WHERE v.id=${specificationVersionId}
    LIMIT 1`;
  if(!rows.length)return {error:"specification_version_not_found" as const,status:404};

  const row=rows[0];
  if(row.status==="DRAFT"){
    return {error:"draft_specification_not_allowed" as const,status:409};
  }

  const specProductId=Number(row.resolved_product_id);
  const specVariantId=row.variant_id==null?null:Number(row.variant_id);
  const targetProductId=Number(target.resolvedProductId);

  let compatible=false;
  if(targetType==="PRODUCT"){
    compatible=row.target_type==="PRODUCT"&&specProductId===targetProductId;
  }else{
    compatible=
      (row.target_type==="VARIANT"&&specVariantId===Number(target.variantId)) ||
      (row.target_type==="PRODUCT"&&specProductId===targetProductId);
  }

  if(!compatible){
    return {error:"specification_target_mismatch" as const,status:409};
  }

  return {
    ok:true as const,
    observed:{
      id:Number(row.id),
      status:row.status,
      versionNo:Number(row.version_no),
      specificationId:Number(row.specification_id)
    }
  };
}

async function listInspections(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"quality.read");
  if(!auth.ok)return auth.response;

  const status=clean(url.searchParams.get("status"),20).toUpperCase();
  const result=clean(url.searchParams.get("result"),20).toUpperCase();
  const productRaw=url.searchParams.get("productId");
  const variantRaw=url.searchParams.get("variantId");
  const productId=productRaw?Number(productRaw):null;
  const variantId=variantRaw?Number(variantRaw):null;

  if(status&&!["DRAFT","FINAL"].includes(status))return json({error:"invalid_status"},400);
  if(result&&!RESULTS.has(result))return json({error:"invalid_result"},400);
  if(productId!=null&&(!Number.isSafeInteger(productId)||productId<1))return json({error:"invalid_product"},400);
  if(variantId!=null&&(!Number.isSafeInteger(variantId)||variantId<1))return json({error:"invalid_variant"},400);

  const rows=await db`
    SELECT
      q.id,q.inspection_type,q.target_type,q.product_id,q.variant_id,
      q.specification_version_id,q.sample_reference,q.inspected_quantity,
      q.status,q.result,q.rationale,q.evidence_reference,q.aql_reference,
      COALESCE(p.id,vp.id) AS resolved_product_id,
      COALESCE(p.name,vp.name) AS product_name,
      COALESCE(p.category,vp.category) AS category,
      pv.sku,pv.size,pv.color,
      sv.version_no AS specification_version_no,
      sv.status AS specification_version_status,
      ps.id AS specification_id,ps.code AS specification_code,ps.title AS specification_title,
      q.created_by_user_id,creator.display_name AS created_by_display_name,
      q.updated_by_user_id,updater.display_name AS updated_by_display_name,
      q.finalized_by_user_id,finalizer.display_name AS finalized_by_display_name,
      q.finalized_at,q.created_at,q.updated_at
    FROM quality_inspections q
    LEFT JOIN products p ON p.id=q.product_id
    LEFT JOIN product_variants pv ON pv.id=q.variant_id
    LEFT JOIN products vp ON vp.id=pv.product_id
    LEFT JOIN product_specification_versions sv ON sv.id=q.specification_version_id
    LEFT JOIN product_specifications ps ON ps.id=sv.specification_id
    LEFT JOIN staff_users creator ON creator.id=q.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=q.updated_by_user_id
    LEFT JOIN staff_users finalizer ON finalizer.id=q.finalized_by_user_id
    WHERE (${status||null}::text IS NULL OR q.status=${status||null}::text)
      AND (${result||null}::text IS NULL OR q.result=${result||null}::text)
      AND (
        ${productId}::bigint IS NULL OR
        q.product_id=${productId}::bigint OR
        pv.product_id=${productId}::bigint
      )
      AND (${variantId}::bigint IS NULL OR q.variant_id=${variantId}::bigint)
    ORDER BY CASE q.status WHEN 'DRAFT' THEN 0 ELSE 1 END,q.updated_at DESC,q.id DESC
    LIMIT 300`;

  return json({data:rows.map(mapInspection)});
}

async function createInspection(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"quality.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const inspectionType=clean(body?.inspectionType,30).toUpperCase();
  const targetType=clean(body?.targetType,20).toUpperCase();
  const targetId=Number(body?.targetId);
  const specificationVersionId=body?.specificationVersionId==null||body?.specificationVersionId===""
    ? null
    : Number(body.specificationVersionId);
  const sampleReference=clean(body?.sampleReference,240)||null;
  const inspectedQuantity=Number(body?.inspectedQuantity||1);
  const evidenceReference=clean(body?.evidenceReference,1000)||null;
  const aqlReference=clean(body?.aqlReference,240)||null;
  const rationale=clean(body?.rationale,4000)||null;

  if(!INSPECTION_TYPES.has(inspectionType))return json({error:"invalid_inspection_type"},400);
  if(!TARGET_TYPES.has(targetType))return json({error:"invalid_target_type"},400);
  if(!Number.isSafeInteger(targetId)||targetId<1)return json({error:"invalid_target"},400);
  if(
    specificationVersionId!=null &&
    (!Number.isSafeInteger(specificationVersionId)||specificationVersionId<1)
  )return json({error:"invalid_specification_version"},400);
  if(!Number.isSafeInteger(inspectedQuantity)||inspectedQuantity<1||inspectedQuantity>1000000){
    return json({error:"invalid_inspected_quantity"},400);
  }

  const target:any=await resolveTarget(db,targetType,targetId);
  if(target.error)return json({error:target.error},target.status||400);

  const spec:any=await validateSpecificationVersion(
    db,specificationVersionId,targetType,target
  );
  if(spec.error)return json({error:spec.error},spec.status||400);

  const actor=actorFields(auth.actor);
  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      INSERT INTO quality_inspections(
        inspection_type,target_type,product_id,variant_id,specification_version_id,
        sample_reference,inspected_quantity,status,result,rationale,
        evidence_reference,aql_reference,created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${inspectionType},${targetType},${target.productId},${target.variantId},
        ${specificationVersionId},${sampleReference},${inspectedQuantity},
        'DRAFT','PENDING',${rationale},${evidenceReference},${aqlReference},
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    const snap=await fullSnapshot(tx,id);
    await tx`
      INSERT INTO quality_inspection_history(
        inspection_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CREATED',
        ${JSON.stringify(snap)}::jsonb,NULL
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"quality_inspection.created",
      resourceType:"QualityInspection",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        inspectionType,
        targetType,
        targetId,
        specificationVersionId,
        specificationVersionStatus:spec.observed?.status||null,
        resultCalculatedAutomatically:false,
        inventoryChanged:false,
        productionRunChanged:false
      }
    });
    return {id};
  });

  return json({
    inspection:mapInspection(await inspectionRow(db,result.id)),
    defects:[],
    resultCalculatedAutomatically:false,
    inventoryChanged:false,
    productionRunChanged:false
  },201);
}

async function updateInspection(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"quality.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await inspectionRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="DRAFT")return json({error:"final_inspection_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const sampleReference=body?.sampleReference==null
    ? existing.sample_reference
    : (clean(body.sampleReference,240)||null);
  const evidenceReference=body?.evidenceReference==null
    ? existing.evidence_reference
    : (clean(body.evidenceReference,1000)||null);
  const aqlReference=body?.aqlReference==null
    ? existing.aql_reference
    : (clean(body.aqlReference,240)||null);
  const rationale=body?.rationale==null
    ? existing.rationale
    : (clean(body.rationale,4000)||null);
  const inspectedQuantity=body?.inspectedQuantity==null
    ? Number(existing.inspected_quantity)
    : Number(body.inspectedQuantity);
  const note=clean(body?.changeNote,1000)||null;

  if(!Number.isSafeInteger(inspectedQuantity)||inspectedQuantity<1||inspectedQuantity>1000000){
    return json({error:"invalid_inspected_quantity"},400);
  }

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE quality_inspections
      SET sample_reference=${sampleReference},
          inspected_quantity=${inspectedQuantity},
          rationale=${rationale},
          evidence_reference=${evidenceReference},
          aql_reference=${aqlReference},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='DRAFT'`;
    const snap=await fullSnapshot(tx,id);
    await tx`
      INSERT INTO quality_inspection_history(
        inspection_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"quality_inspection.updated",
      resourceType:"QualityInspection",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        resultCalculatedAutomatically:false,
        inventoryChanged:false,
        productionRunChanged:false
      }
    });
  });

  return json({
    inspection:mapInspection(await inspectionRow(db,id)),
    defects:(await defectRows(db,id)).map(mapDefect),
    history:await history(db,id),
    resultCalculatedAutomatically:false,
    inventoryChanged:false,
    productionRunChanged:false
  });
}

async function createDefect(req:Request,db:DB,inspectionId:number){
  const auth=await authorizeInternal(req,db,"quality.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const inspection=await inspectionRow(db,inspectionId);
  if(!inspection)return json({error:"inspection_not_found"},404);
  if(inspection.status!=="DRAFT")return json({error:"final_inspection_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const severity=clean(body?.severity,20).toUpperCase();
  const defectCode=clean(body?.defectCode,80).toUpperCase();
  const description=clean(body?.description,1000);
  const quantity=Number(body?.quantity||1);
  const evidenceReference=clean(body?.evidenceReference,1000)||null;

  if(!DEFECT_SEVERITIES.has(severity))return json({error:"invalid_severity"},400);
  if(defectCode.length<2)return json({error:"defect_code_required"},400);
  if(description.length<3)return json({error:"description_required"},400);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return json({error:"invalid_quantity"},400);

  const actor=actorFields(auth.actor);
  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      INSERT INTO quality_defects(
        inspection_id,severity,defect_code,description,quantity,evidence_reference,active,
        created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${inspectionId},${severity},${defectCode},${description},${quantity},
        ${evidenceReference},TRUE,
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    const row=await defectRow(tx,id);
    await tx`
      INSERT INTO quality_defect_history(
        defect_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CREATED',
        ${JSON.stringify(mapDefect(row))}::jsonb,NULL
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"quality_defect.created",
      resourceType:"QualityDefect",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        inspectionId,
        severity,
        resultCalculatedAutomatically:false
      }
    });
    return {id};
  });

  return json({
    defect:mapDefect(await defectRow(db,result.id)),
    resultCalculatedAutomatically:false
  },201);
}

async function updateDefect(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"quality.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await defectRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  const inspection=await inspectionRow(db,Number(existing.inspection_id));
  if(!inspection)return json({error:"inspection_not_found"},404);
  if(inspection.status!=="DRAFT")return json({error:"final_inspection_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const severity=body?.severity==null?existing.severity:clean(body.severity,20).toUpperCase();
  const defectCode=body?.defectCode==null?existing.defect_code:clean(body.defectCode,80).toUpperCase();
  const description=body?.description==null?existing.description:clean(body.description,1000);
  const quantity=body?.quantity==null?Number(existing.quantity):Number(body.quantity);
  const evidenceReference=body?.evidenceReference==null
    ? existing.evidence_reference
    : (clean(body.evidenceReference,1000)||null);
  const active=body?.active==null?Boolean(existing.active):body.active===true;
  const note=clean(body?.changeNote,1000)||null;

  if(!DEFECT_SEVERITIES.has(severity))return json({error:"invalid_severity"},400);
  if(defectCode.length<2)return json({error:"defect_code_required"},400);
  if(description.length<3)return json({error:"description_required"},400);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return json({error:"invalid_quantity"},400);

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE quality_defects
      SET severity=${severity},defect_code=${defectCode},description=${description},
          quantity=${quantity},evidence_reference=${evidenceReference},active=${active},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    const row=await defectRow(tx,id);
    await tx`
      INSERT INTO quality_defect_history(
        defect_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(mapDefect(row))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"quality_defect.updated",
      resourceType:"QualityDefect",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        inspectionId:Number(existing.inspection_id),
        fromActive:Boolean(existing.active),
        toActive:active,
        resultCalculatedAutomatically:false
      }
    });
  });

  return json({
    defect:mapDefect(await defectRow(db,id)),
    resultCalculatedAutomatically:false
  });
}

async function finalizeInspection(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"quality.finalize",{mutation:true});
  if(!auth.ok)return auth.response;
  if(auth.actor.type!=="USER")return json({error:"human_finalization_required"},403);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const result=clean(body?.result,20).toUpperCase();
  const rationale=clean(body?.rationale,4000);
  const note=clean(body?.note,1000)||null;

  if(!RESULTS.has(result)||result==="PENDING")return json({error:"final_result_required"},400);
  if(rationale.length<8)return json({error:"rationale_required"},400);

  const actor=actorFields(auth.actor);
  const output:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,status
      FROM quality_inspections
      WHERE id=${id}
      FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};
    if(rows[0].status!=="DRAFT")return {error:"inspection_not_finalizable",status:409};

    await tx`
      UPDATE quality_inspections
      SET status='FINAL',result=${result},rationale=${rationale},
          finalized_by_user_id=${auth.actor.userId},finalized_at=NOW(),
          updated_by_user_id=${auth.actor.userId},updated_at=NOW()
      WHERE id=${id}`;

    const snap=await fullSnapshot(tx,id);
    await tx`
      INSERT INTO quality_inspection_history(
        inspection_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'FINALIZED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"quality_inspection.finalized",
      resourceType:"QualityInspection",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        result,
        defectCount:snap.defects.filter((d:any)=>d.active).length,
        resultCalculatedAutomatically:false,
        inventoryChanged:false,
        purchaseOrderChanged:false,
        productionRunChanged:false
      }
    });
    return {ok:true};
  });

  if(output.error)return json(output,output.status||400);
  return json({
    inspection:mapInspection(await inspectionRow(db,id)),
    defects:(await defectRows(db,id)).map(mapDefect),
    history:await history(db,id),
    resultCalculatedAutomatically:false,
    inventoryChanged:false,
    purchaseOrderChanged:false,
    productionRunChanged:false
  });
}

async function getInspection(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"quality.read");
  if(!auth.ok)return auth.response;
  const row=await inspectionRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    inspection:mapInspection(row),
    defects:(await defectRows(db,id)).map(mapDefect),
    history:await history(db,id),
    resultCalculatedAutomatically:false
  });
}

export async function handleQualityControl(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/quality-inspections"){
    if(req.method==="GET")return listInspections(req,url,db);
    if(req.method==="POST")return createInspection(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const finalizeMatch=url.pathname.match(/^\/v1\/internal\/quality-inspections\/(\d+)\/finalize$/);
  if(finalizeMatch){
    if(req.method==="POST")return finalizeInspection(req,db,Number(finalizeMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const defectsMatch=url.pathname.match(/^\/v1\/internal\/quality-inspections\/(\d+)\/defects$/);
  if(defectsMatch){
    if(req.method==="POST")return createDefect(req,db,Number(defectsMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const inspectionMatch=url.pathname.match(/^\/v1\/internal\/quality-inspections\/(\d+)$/);
  if(inspectionMatch){
    const id=Number(inspectionMatch[1]);
    if(req.method==="GET")return getInspection(req,db,id);
    if(req.method==="PATCH")return updateInspection(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  const defectMatch=url.pathname.match(/^\/v1\/internal\/quality-defects\/(\d+)$/);
  if(defectMatch){
    if(req.method==="PATCH")return updateDefect(req,db,Number(defectMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  if(
    url.pathname.startsWith("/v1/internal/quality-inspections") ||
    url.pathname.startsWith("/v1/internal/quality-defects")
  ){
    return json({error:"not_found"},404);
  }

  return null;
}
