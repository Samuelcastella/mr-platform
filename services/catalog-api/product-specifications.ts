import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const TARGET_TYPES=new Set(["PRODUCT","VARIANT"]);
const VERSION_STATUSES=new Set(["DRAFT","APPROVED","SUPERSEDED","WITHDRAWN"]);
const SECTION_KEYS=[
  "materials",
  "measurements",
  "construction",
  "packaging",
  "labeling",
  "qualityRequirements"
] as const;

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

function slugCode(value:unknown){
  return clean(value,80).toUpperCase().replace(/[^A-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
}

function section(value:unknown){
  if(value==null)return {};
  if(typeof value!=="object"||Array.isArray(value))return null;
  const serialized=JSON.stringify(value);
  if(serialized.length>20000)return null;
  return value as Record<string,unknown>;
}

function jsonObject(value:unknown){
  if(value==null)return {};
  if(typeof value==="string"){
    try{
      const parsed=JSON.parse(value);
      return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
    }catch{
      return {};
    }
  }
  return typeof value==="object"&&!Array.isArray(value)?value:{};
}

function actorFields(actor:any){
  return actor.type==="USER"
    ? {userId:actor.userId,service:null}
    : {userId:null,service:actor.service};
}

export async function ensureProductSpecificationSchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS product_specifications (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      target_type TEXT NOT NULL,
      product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
      variant_id BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (target_type IN ('PRODUCT','VARIANT')),
      CHECK (
        (target_type='PRODUCT' AND product_id IS NOT NULL AND variant_id IS NULL) OR
        (target_type='VARIANT' AND product_id IS NULL AND variant_id IS NOT NULL)
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_specs_active_product
    ON product_specifications(product_id)
    WHERE target_type='PRODUCT' AND active`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_specs_active_variant
    ON product_specifications(variant_id)
    WHERE target_type='VARIANT' AND active`;

  await db`
    CREATE TABLE IF NOT EXISTS product_specification_versions (
      id BIGSERIAL PRIMARY KEY,
      specification_id BIGINT NOT NULL REFERENCES product_specifications(id) ON DELETE RESTRICT,
      version_no INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      materials JSONB NOT NULL DEFAULT '{}'::jsonb,
      measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
      construction JSONB NOT NULL DEFAULT '{}'::jsonb,
      packaging JSONB NOT NULL DEFAULT '{}'::jsonb,
      labeling JSONB NOT NULL DEFAULT '{}'::jsonb,
      quality_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes TEXT,
      change_summary TEXT NOT NULL,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      approved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(specification_id,version_no),
      CHECK (version_no>=1),
      CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED','WITHDRAWN'))
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_spec_versions_one_approved
    ON product_specification_versions(specification_id)
    WHERE status='APPROVED'`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_product_spec_versions_spec
    ON product_specification_versions(specification_id,version_no DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS product_specification_history (
      id BIGSERIAL PRIMARY KEY,
      specification_id BIGINT NOT NULL REFERENCES product_specifications(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_product_spec_history_spec
    ON product_specification_history(specification_id,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS product_specification_version_history (
      id BIGSERIAL PRIMARY KEY,
      version_id BIGINT NOT NULL REFERENCES product_specification_versions(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_product_spec_version_history_version
    ON product_specification_version_history(version_id,id)`;
}

async function specificationRow(db:DB,id:number){
  const rows=await db`
    SELECT
      s.id,s.code,s.title,s.target_type,s.product_id,s.variant_id,s.active,
      COALESCE(p.id,vp.id) AS resolved_product_id,
      COALESCE(p.name,vp.name) AS product_name,
      COALESCE(p.category,vp.category) AS category,
      COALESCE(p.commercial_model,vp.commercial_model) AS commercial_model,
      pv.sku,pv.size,pv.color,
      s.created_by_user_id,creator.display_name AS created_by_display_name,
      s.updated_by_user_id,updater.display_name AS updated_by_display_name,
      s.created_at,s.updated_at
    FROM product_specifications s
    LEFT JOIN products p ON p.id=s.product_id
    LEFT JOIN product_variants pv ON pv.id=s.variant_id
    LEFT JOIN products vp ON vp.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=s.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=s.updated_by_user_id
    WHERE s.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapSpecification(row:any){
  return {
    id:Number(row.id),
    code:row.code,
    title:row.title,
    targetType:row.target_type,
    productId:row.resolved_product_id==null?null:Number(row.resolved_product_id),
    variantId:row.variant_id==null?null:Number(row.variant_id),
    productName:row.product_name||null,
    category:row.category||null,
    commercialModel:row.commercial_model||null,
    sku:row.sku||null,
    size:row.size||null,
    color:row.color||null,
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

function specificationSnapshot(row:any){
  const s=mapSpecification(row);
  return {
    code:s.code,
    title:s.title,
    targetType:s.targetType,
    productId:s.productId,
    variantId:s.variantId,
    active:s.active
  };
}

async function versionRow(db:DB,id:number){
  const rows=await db`
    SELECT
      v.id,v.specification_id,v.version_no,v.status,
      v.materials,v.measurements,v.construction,v.packaging,v.labeling,v.quality_requirements,
      v.notes,v.change_summary,
      v.created_by_user_id,creator.display_name AS created_by_display_name,
      v.updated_by_user_id,updater.display_name AS updated_by_display_name,
      v.approved_by_user_id,approver.display_name AS approved_by_display_name,
      v.approved_at,v.created_at,v.updated_at
    FROM product_specification_versions v
    LEFT JOIN staff_users creator ON creator.id=v.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=v.updated_by_user_id
    LEFT JOIN staff_users approver ON approver.id=v.approved_by_user_id
    WHERE v.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapVersion(row:any){
  return {
    id:Number(row.id),
    specificationId:Number(row.specification_id),
    versionNo:Number(row.version_no),
    status:row.status,
    sections:{
      materials:jsonObject(row.materials),
      measurements:jsonObject(row.measurements),
      construction:jsonObject(row.construction),
      packaging:jsonObject(row.packaging),
      labeling:jsonObject(row.labeling),
      qualityRequirements:jsonObject(row.quality_requirements)
    },
    notes:row.notes||null,
    changeSummary:row.change_summary,
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    approvedBy:row.approved_by_user_id==null?null:{
      userId:Number(row.approved_by_user_id),
      displayName:row.approved_by_display_name||null
    },
    approvedAt:row.approved_at||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    technicalContentMutable:row.status==="DRAFT",
    automaticallyAppliedToProduction:false
  };
}

function versionSnapshot(row:any){
  const v=mapVersion(row);
  return {
    specificationId:v.specificationId,
    versionNo:v.versionNo,
    status:v.status,
    sections:v.sections,
    notes:v.notes,
    changeSummary:v.changeSummary,
    approvedByUserId:v.approvedBy?.userId||null,
    approvedAt:v.approvedAt
  };
}

async function specificationHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM product_specification_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.specification_id=${id}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function versionHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM product_specification_version_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.version_id=${id}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function versionsForSpecification(db:DB,id:number){
  const rows=await db`
    SELECT
      v.id,v.specification_id,v.version_no,v.status,
      v.materials,v.measurements,v.construction,v.packaging,v.labeling,v.quality_requirements,
      v.notes,v.change_summary,
      v.created_by_user_id,creator.display_name AS created_by_display_name,
      v.updated_by_user_id,updater.display_name AS updated_by_display_name,
      v.approved_by_user_id,approver.display_name AS approved_by_display_name,
      v.approved_at,v.created_at,v.updated_at
    FROM product_specification_versions v
    LEFT JOIN staff_users creator ON creator.id=v.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=v.updated_by_user_id
    LEFT JOIN staff_users approver ON approver.id=v.approved_by_user_id
    WHERE v.specification_id=${id}
    ORDER BY v.version_no DESC`;
  return rows.map(mapVersion);
}

async function resolveTarget(db:DB,targetType:string,targetId:number){
  if(targetType==="PRODUCT"){
    const rows=await db`
      SELECT id,name,category,commercial_model
      FROM products
      WHERE id=${targetId}
      LIMIT 1`;
    if(!rows.length)return {error:"product_not_found" as const,status:404};
    return {
      productId:targetId,
      variantId:null,
      productName:rows[0].name,
      commercialModel:rows[0].commercial_model||null
    };
  }
  const rows=await db`
    SELECT pv.id,pv.product_id,pv.sku,p.name,p.commercial_model
    FROM product_variants pv
    JOIN products p ON p.id=pv.product_id
    WHERE pv.id=${targetId}
    LIMIT 1`;
  if(!rows.length)return {error:"variant_not_found" as const,status:404};
  return {
    productId:null,
    variantId:targetId,
    resolvedProductId:Number(rows[0].product_id),
    productName:rows[0].name,
    commercialModel:rows[0].commercial_model||null
  };
}

async function listSpecifications(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"product_specs.read");
  if(!auth.ok)return auth.response;

  const productRaw=url.searchParams.get("productId");
  const variantRaw=url.searchParams.get("variantId");
  const activeRaw=url.searchParams.get("active");
  const productId=productRaw?Number(productRaw):null;
  const variantId=variantRaw?Number(variantRaw):null;

  if(productId!=null&&(!Number.isSafeInteger(productId)||productId<1)){
    return json({error:"invalid_product"},400);
  }
  if(variantId!=null&&(!Number.isSafeInteger(variantId)||variantId<1)){
    return json({error:"invalid_variant"},400);
  }
  if(activeRaw!=null&&activeRaw!==""&&!["true","false"].includes(activeRaw)){
    return json({error:"invalid_active"},400);
  }
  const active=activeRaw==null||activeRaw===""?null:activeRaw==="true";

  const rows=await db`
    SELECT
      s.id,s.code,s.title,s.target_type,s.product_id,s.variant_id,s.active,
      COALESCE(p.id,vp.id) AS resolved_product_id,
      COALESCE(p.name,vp.name) AS product_name,
      COALESCE(p.category,vp.category) AS category,
      COALESCE(p.commercial_model,vp.commercial_model) AS commercial_model,
      pv.sku,pv.size,pv.color,
      s.created_by_user_id,creator.display_name AS created_by_display_name,
      s.updated_by_user_id,updater.display_name AS updated_by_display_name,
      s.created_at,s.updated_at,
      approved.id AS approved_version_id,
      approved.version_no AS approved_version_no
    FROM product_specifications s
    LEFT JOIN products p ON p.id=s.product_id
    LEFT JOIN product_variants pv ON pv.id=s.variant_id
    LEFT JOIN products vp ON vp.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=s.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=s.updated_by_user_id
    LEFT JOIN product_specification_versions approved
      ON approved.specification_id=s.id AND approved.status='APPROVED'
    WHERE (
        ${productId}::bigint IS NULL OR
        s.product_id=${productId}::bigint OR
        pv.product_id=${productId}::bigint
      )
      AND (${variantId}::bigint IS NULL OR s.variant_id=${variantId}::bigint)
      AND (${active}::boolean IS NULL OR s.active=${active}::boolean)
    ORDER BY s.active DESC,s.updated_at DESC,s.id DESC
    LIMIT 300`;

  return json({
    data:rows.map((row:any)=>({
      ...mapSpecification(row),
      approvedVersion:row.approved_version_id==null?null:{
        id:Number(row.approved_version_id),
        versionNo:Number(row.approved_version_no)
      }
    }))
  });
}

async function createSpecification(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"product_specs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const code=slugCode(body?.code);
  const title=clean(body?.title,240);
  const targetType=clean(body?.targetType,20).toUpperCase();
  const targetId=Number(body?.targetId);

  if(code.length<3)return json({error:"invalid_code"},400);
  if(title.length<3)return json({error:"title_required"},400);
  if(!TARGET_TYPES.has(targetType))return json({error:"invalid_target_type"},400);
  if(!Number.isSafeInteger(targetId)||targetId<1)return json({error:"invalid_target"},400);

  const target:any=await resolveTarget(db,targetType,targetId);
  if(target.error)return json({error:target.error},target.status||400);

  const actor=actorFields(auth.actor);
  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO product_specifications(
          code,title,target_type,product_id,variant_id,active,
          created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${code},${title},${targetType},${target.productId},${target.variantId},TRUE,
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      const row=await specificationRow(tx,id);
      await tx`
        INSERT INTO product_specification_history(
          specification_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${id},${actor.userId},${actor.service},'CREATED',
          ${JSON.stringify(specificationSnapshot(row))}::jsonb,NULL
        )`;
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"product_specification.created",
        resourceType:"ProductSpecification",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          targetType,
          targetId,
          commercialModelObserved:target.commercialModel||null,
          commercialModelChanged:false,
          productionRunCreated:false,
          inventoryChanged:false
        }
      });
      return {id};
    });

    return json({
      specification:mapSpecification(await specificationRow(db,result.id)),
      productionRunCreated:false,
      inventoryChanged:false,
      catalogChanged:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"specification_exists"},409);
    }
    throw error;
  }
}

async function updateSpecification(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"product_specs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await specificationRow(db,id);
  if(!existing)return json({error:"not_found"},404);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const title=body?.title==null?existing.title:clean(body.title,240);
  const active=body?.active==null?Boolean(existing.active):body.active===true;
  const note=clean(body?.changeNote,1000)||null;
  if(title.length<3)return json({error:"title_required"},400);

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE product_specifications
      SET title=${title},active=${active},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    const row=await specificationRow(tx,id);
    await tx`
      INSERT INTO product_specification_history(
        specification_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(specificationSnapshot(row))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"product_specification.updated",
      resourceType:"ProductSpecification",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        fromActive:Boolean(existing.active),
        toActive:active,
        commercialModelChanged:false,
        productionRunCreated:false,
        inventoryChanged:false
      }
    });
  });

  return json({
    specification:mapSpecification(await specificationRow(db,id)),
    history:await specificationHistory(db,id),
    productionRunCreated:false,
    inventoryChanged:false,
    catalogChanged:false
  });
}

async function getSpecification(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"product_specs.read");
  if(!auth.ok)return auth.response;
  const row=await specificationRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    specification:mapSpecification(row),
    versions:await versionsForSpecification(db,id),
    history:await specificationHistory(db,id),
    automaticallyAppliedToProduction:false
  });
}

function extractSections(body:any,base:any=null){
  const result:any={};
  for(const key of SECTION_KEYS){
    const supplied=body?.sections && Object.prototype.hasOwnProperty.call(body.sections,key);
    if(supplied){
      const parsed=section(body.sections[key]);
      if(parsed==null)return {error:"invalid_section",field:key};
      result[key]=parsed;
    }else{
      result[key]=base?.sections?.[key]||{};
    }
  }
  return {sections:result};
}

async function createVersion(req:Request,db:DB,specificationId:number){
  const auth=await authorizeInternal(req,db,"product_specs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const changeSummary=clean(body?.changeSummary,1000);
  const notes=clean(body?.notes,4000)||null;
  const cloneVersionId=body?.cloneVersionId==null||body?.cloneVersionId===""
    ? null
    : Number(body.cloneVersionId);

  if(changeSummary.length<5)return json({error:"change_summary_required"},400);
  if(cloneVersionId!=null&&(!Number.isSafeInteger(cloneVersionId)||cloneVersionId<1)){
    return json({error:"invalid_clone_version"},400);
  }

  let clone:any=null;
  if(cloneVersionId!=null){
    const row=await versionRow(db,cloneVersionId);
    if(!row||Number(row.specification_id)!==specificationId){
      return json({error:"clone_version_not_found"},404);
    }
    clone=mapVersion(row);
  }

  const extracted:any=extractSections(body,clone);
  if(extracted.error)return json(extracted,400);
  const actor=actorFields(auth.actor);

  const result:any=await db.begin(async(tx:DB)=>{
    const specs=await tx`
      SELECT id,active
      FROM product_specifications
      WHERE id=${specificationId}
      FOR UPDATE`;
    if(!specs.length)return {error:"specification_not_found",status:404};
    if(!specs[0].active)return {error:"specification_inactive",status:409};

    const maxRows=await tx`
      SELECT COALESCE(MAX(version_no),0)::int AS max_version
      FROM product_specification_versions
      WHERE specification_id=${specificationId}`;
    const versionNo=Number(maxRows[0].max_version)+1;

    const rows=await tx`
      INSERT INTO product_specification_versions(
        specification_id,version_no,status,
        materials,measurements,construction,packaging,labeling,quality_requirements,
        notes,change_summary,created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${specificationId},${versionNo},'DRAFT',
        ${JSON.stringify(extracted.sections.materials)}::jsonb,
        ${JSON.stringify(extracted.sections.measurements)}::jsonb,
        ${JSON.stringify(extracted.sections.construction)}::jsonb,
        ${JSON.stringify(extracted.sections.packaging)}::jsonb,
        ${JSON.stringify(extracted.sections.labeling)}::jsonb,
        ${JSON.stringify(extracted.sections.qualityRequirements)}::jsonb,
        ${notes},${changeSummary},
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    const row=await versionRow(tx,id);
    await tx`
      INSERT INTO product_specification_version_history(
        version_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CREATED',
        ${JSON.stringify(versionSnapshot(row))}::jsonb,${changeSummary}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"product_specification_version.created",
      resourceType:"ProductSpecificationVersion",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        specificationId,
        versionNo,
        cloneVersionId,
        productionRunCreated:false,
        inventoryChanged:false,
        catalogChanged:false
      }
    });
    return {id};
  });

  if(result.error)return json({error:result.error},result.status||400);
  return json({
    version:mapVersion(await versionRow(db,result.id)),
    productionRunCreated:false,
    inventoryChanged:false,
    catalogChanged:false
  },201);
}

async function updateVersion(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"product_specs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await versionRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="DRAFT"){
    return json({error:"approved_version_immutable",status:existing.status},409);
  }

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const base=mapVersion(existing);
  const extracted:any=extractSections(body,base);
  if(extracted.error)return json(extracted,400);
  const changeSummary=body?.changeSummary==null
    ? existing.change_summary
    : clean(body.changeSummary,1000);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,4000)||null);
  const note=clean(body?.changeNote,1000)||null;
  if(changeSummary.length<5)return json({error:"change_summary_required"},400);

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE product_specification_versions
      SET materials=${JSON.stringify(extracted.sections.materials)}::jsonb,
          measurements=${JSON.stringify(extracted.sections.measurements)}::jsonb,
          construction=${JSON.stringify(extracted.sections.construction)}::jsonb,
          packaging=${JSON.stringify(extracted.sections.packaging)}::jsonb,
          labeling=${JSON.stringify(extracted.sections.labeling)}::jsonb,
          quality_requirements=${JSON.stringify(extracted.sections.qualityRequirements)}::jsonb,
          notes=${notes},change_summary=${changeSummary},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='DRAFT'`;
    const row=await versionRow(tx,id);
    await tx`
      INSERT INTO product_specification_version_history(
        version_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(versionSnapshot(row))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"product_specification_version.updated",
      resourceType:"ProductSpecificationVersion",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        specificationId:Number(existing.specification_id),
        versionNo:Number(existing.version_no),
        productionRunCreated:false,
        inventoryChanged:false,
        catalogChanged:false
      }
    });
  });

  return json({
    version:mapVersion(await versionRow(db,id)),
    history:await versionHistory(db,id),
    productionRunCreated:false,
    inventoryChanged:false,
    catalogChanged:false
  });
}

async function approveVersion(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"product_specs.approve",{mutation:true});
  if(!auth.ok)return auth.response;
  if(auth.actor.type!=="USER")return json({error:"human_approval_required"},403);

  let body:any={};
  try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;
  const actor=actorFields(auth.actor);

  const result:any=await db.begin(async(tx:DB)=>{
    const currentRows=await tx`
      SELECT id,specification_id,version_no,status
      FROM product_specification_versions
      WHERE id=${id}
      FOR UPDATE`;
    if(!currentRows.length)return {error:"not_found",status:404};
    const current=currentRows[0];
    if(current.status!=="DRAFT"){
      return {error:"version_not_approvable",status:409,currentStatus:current.status};
    }

    const specs=await tx`
      SELECT id,active
      FROM product_specifications
      WHERE id=${Number(current.specification_id)}
      FOR UPDATE`;
    if(!specs.length)return {error:"specification_not_found",status:404};
    if(!specs[0].active)return {error:"specification_inactive",status:409};

    const prior=await tx`
      SELECT id
      FROM product_specification_versions
      WHERE specification_id=${Number(current.specification_id)}
        AND status='APPROVED'
      FOR UPDATE`;

    for(const p of prior){
      await tx`
        UPDATE product_specification_versions
        SET status='SUPERSEDED',updated_at=NOW()
        WHERE id=${Number(p.id)}`;
      const superseded=await versionRow(tx,Number(p.id));
      await tx`
        INSERT INTO product_specification_version_history(
          version_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${Number(p.id)},${actor.userId},${actor.service},'SUPERSEDED',
          ${JSON.stringify(versionSnapshot(superseded))}::jsonb,
          ${"Superseded by version "+Number(current.version_no)}
        )`;
    }

    await tx`
      UPDATE product_specification_versions
      SET status='APPROVED',
          approved_by_user_id=${auth.actor.userId},
          approved_at=NOW(),
          updated_by_user_id=${auth.actor.userId},
          updated_at=NOW()
      WHERE id=${id}`;
    const approved=await versionRow(tx,id);
    await tx`
      INSERT INTO product_specification_version_history(
        version_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'APPROVED',
        ${JSON.stringify(versionSnapshot(approved))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"product_specification_version.approved",
      resourceType:"ProductSpecificationVersion",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        specificationId:Number(current.specification_id),
        versionNo:Number(current.version_no),
        supersededVersionIds:prior.map((x:any)=>Number(x.id)),
        productionRunCreated:false,
        inventoryChanged:false,
        catalogChanged:false
      }
    });
    return {supersededVersionIds:prior.map((x:any)=>Number(x.id))};
  });

  if(result.error)return json(result,result.status||400);
  return json({
    version:mapVersion(await versionRow(db,id)),
    supersededVersionIds:result.supersededVersionIds,
    productionRunCreated:false,
    inventoryChanged:false,
    catalogChanged:false,
    automaticallyAppliedToProduction:false
  });
}

async function withdrawVersion(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"product_specs.approve",{mutation:true});
  if(!auth.ok)return auth.response;
  if(auth.actor.type!=="USER")return json({error:"human_approval_required"},403);

  let body:any={};
  try{body=await req.json();}catch{}
  const note=clean(body?.note,1000);
  if(note.length<5)return json({error:"withdrawal_note_required"},400);
  const actor=actorFields(auth.actor);

  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,specification_id,version_no,status
      FROM product_specification_versions
      WHERE id=${id}
      FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};
    if(rows[0].status!=="APPROVED"){
      return {error:"version_not_withdrawable",status:409,currentStatus:rows[0].status};
    }

    await tx`
      UPDATE product_specification_versions
      SET status='WITHDRAWN',
          updated_by_user_id=${auth.actor.userId},
          updated_at=NOW()
      WHERE id=${id}`;
    const withdrawn=await versionRow(tx,id);
    await tx`
      INSERT INTO product_specification_version_history(
        version_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'WITHDRAWN',
        ${JSON.stringify(versionSnapshot(withdrawn))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"product_specification_version.withdrawn",
      resourceType:"ProductSpecificationVersion",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        specificationId:Number(rows[0].specification_id),
        versionNo:Number(rows[0].version_no),
        productionRunCreated:false,
        inventoryChanged:false,
        catalogChanged:false
      }
    });
    return {ok:true};
  });

  if(result.error)return json(result,result.status||400);
  return json({
    version:mapVersion(await versionRow(db,id)),
    productionRunCreated:false,
    inventoryChanged:false,
    catalogChanged:false,
    automaticallyAppliedToProduction:false
  });
}

async function getVersion(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"product_specs.read");
  if(!auth.ok)return auth.response;
  const row=await versionRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    version:mapVersion(row),
    history:await versionHistory(db,id),
    automaticallyAppliedToProduction:false
  });
}

export async function handleProductSpecifications(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/product-specifications"){
    if(req.method==="GET")return listSpecifications(req,url,db);
    if(req.method==="POST")return createSpecification(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const specMatch=url.pathname.match(/^\/v1\/internal\/product-specifications\/(\d+)$/);
  if(specMatch){
    const id=Number(specMatch[1]);
    if(req.method==="GET")return getSpecification(req,db,id);
    if(req.method==="PATCH")return updateSpecification(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  const versionsMatch=url.pathname.match(/^\/v1\/internal\/product-specifications\/(\d+)\/versions$/);
  if(versionsMatch){
    if(req.method==="POST")return createVersion(req,db,Number(versionsMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const approveMatch=url.pathname.match(/^\/v1\/internal\/product-specification-versions\/(\d+)\/approve$/);
  if(approveMatch){
    if(req.method==="POST")return approveVersion(req,db,Number(approveMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const withdrawMatch=url.pathname.match(/^\/v1\/internal\/product-specification-versions\/(\d+)\/withdraw$/);
  if(withdrawMatch){
    if(req.method==="POST")return withdrawVersion(req,db,Number(withdrawMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const versionMatch=url.pathname.match(/^\/v1\/internal\/product-specification-versions\/(\d+)$/);
  if(versionMatch){
    const id=Number(versionMatch[1]);
    if(req.method==="GET")return getVersion(req,db,id);
    if(req.method==="PATCH")return updateVersion(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if(
    url.pathname.startsWith("/v1/internal/product-specifications") ||
    url.pathname.startsWith("/v1/internal/product-specification-versions")
  ){
    return json({error:"not_found"},404);
  }

  return null;
}
