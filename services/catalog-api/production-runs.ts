import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const RUN_STATUSES = new Set(["PLANNED","RELEASED","IN_PRODUCTION","COMPLETED","CANCELLED"]);
const LOT_STATUSES = new Set(["PLANNED","IN_PRODUCTION","COMPLETED","CANCELLED"]);

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

function code(value:unknown,max=100){
  return clean(value,max).toUpperCase().replace(/[^A-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
}

function optionalDate(value:unknown){
  if(value==null||value==="")return null;
  const d=new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

function positiveInt(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}

function nonNegativeInt(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}

function actorFields(actor:any){
  return actor.type==="USER"
    ? {userId:actor.userId,service:null}
    : {userId:null,service:actor.service};
}

export async function ensureProductionRunsSchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS production_runs (
      id BIGSERIAL PRIMARY KEY,
      run_code TEXT UNIQUE NOT NULL,
      product_specification_version_id BIGINT NOT NULL
        REFERENCES product_specification_versions(id) ON DELETE RESTRICT,
      manufacturer_link_id BIGINT NOT NULL
        REFERENCES manufacturer_links(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      external_reference TEXT,
      planned_start_at TIMESTAMPTZ,
      planned_end_at TIMESTAMPTZ,
      actual_start_at TIMESTAMPTZ,
      actual_end_at TIMESTAMPTZ,
      notes TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      released_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      completed_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      released_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PLANNED','RELEASED','IN_PRODUCTION','COMPLETED','CANCELLED')),
      CHECK (
        planned_end_at IS NULL OR planned_start_at IS NULL OR
        planned_end_at >= planned_start_at
      ),
      CHECK (
        actual_end_at IS NULL OR actual_start_at IS NULL OR
        actual_end_at >= actual_start_at
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_runs_status
    ON production_runs(status,updated_at DESC,id DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_runs_spec_version
    ON production_runs(product_specification_version_id,created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS production_lots (
      id BIGSERIAL PRIMARY KEY,
      production_run_id BIGINT NOT NULL REFERENCES production_runs(id) ON DELETE RESTRICT,
      lot_code TEXT UNIQUE NOT NULL,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      planned_quantity INTEGER NOT NULL,
      produced_quantity INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      notes TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PLANNED','IN_PRODUCTION','COMPLETED','CANCELLED')),
      CHECK (planned_quantity > 0),
      CHECK (produced_quantity >= 0)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_lots_run
    ON production_lots(production_run_id,status,id)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_lots_variant
    ON production_lots(variant_id,created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS production_run_history (
      id BIGSERIAL PRIMARY KEY,
      production_run_id BIGINT NOT NULL REFERENCES production_runs(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_production_run_history_run
    ON production_run_history(production_run_id,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS production_lot_history (
      id BIGSERIAL PRIMARY KEY,
      production_lot_id BIGINT NOT NULL REFERENCES production_lots(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_production_lot_history_lot
    ON production_lot_history(production_lot_id,id)`;
}

async function productionContext(db:DB,specVersionId:number,manufacturerLinkId:number){
  const specRows=await db`
    SELECT
      v.id AS version_id,v.version_no,v.status AS version_status,
      s.id AS specification_id,s.code AS specification_code,s.title AS specification_title,
      s.active AS specification_active,s.target_type AS specification_target_type,
      s.product_id AS specification_product_id,s.variant_id AS specification_variant_id,
      COALESCE(s.product_id,pv.product_id) AS resolved_product_id,
      p.name AS product_name,p.commercial_model,
      pv.sku AS specification_variant_sku
    FROM product_specification_versions v
    JOIN product_specifications s ON s.id=v.specification_id
    LEFT JOIN product_variants pv ON pv.id=s.variant_id
    JOIN products p ON p.id=COALESCE(s.product_id,pv.product_id)
    WHERE v.id=${specVersionId}
    LIMIT 1`;
  if(!specRows.length)return {error:"specification_version_not_found" as const,status:404};
  const spec=specRows[0];

  const linkRows=await db`
    SELECT
      l.id,l.target_type,l.product_id,l.variant_id,l.active,
      m.id AS manufacturer_id,m.name AS manufacturer_name,m.active AS manufacturer_active,
      pv.product_id AS link_variant_product_id,pv.sku AS link_variant_sku
    FROM manufacturer_links l
    JOIN manufacturers m ON m.id=l.manufacturer_id
    LEFT JOIN product_variants pv ON pv.id=l.variant_id
    WHERE l.id=${manufacturerLinkId}
    LIMIT 1`;
  if(!linkRows.length)return {error:"manufacturer_link_not_found" as const,status:404};
  const link=linkRows[0];

  const productId=Number(spec.resolved_product_id);
  const specVariantId=spec.specification_variant_id==null?null:Number(spec.specification_variant_id);
  const linkProductId=link.target_type==="PRODUCT"
    ? Number(link.product_id)
    : Number(link.link_variant_product_id);
  const linkVariantId=link.variant_id==null?null:Number(link.variant_id);

  if(productId!==linkProductId){
    return {error:"manufacturer_link_product_mismatch" as const,status:409};
  }
  if(specVariantId!=null&&linkVariantId!=null&&specVariantId!==linkVariantId){
    return {error:"manufacturer_link_variant_mismatch" as const,status:409};
  }

  return {
    spec:{
      versionId:Number(spec.version_id),
      versionNo:Number(spec.version_no),
      versionStatus:String(spec.version_status),
      specificationId:Number(spec.specification_id),
      code:String(spec.specification_code),
      title:String(spec.specification_title),
      active:Boolean(spec.specification_active),
      targetType:String(spec.specification_target_type),
      productId,
      variantId:specVariantId,
      productName:String(spec.product_name),
      commercialModel:spec.commercial_model||null,
      sku:spec.specification_variant_sku||null
    },
    manufacturerLink:{
      id:Number(link.id),
      targetType:String(link.target_type),
      productId:link.target_type==="PRODUCT"?Number(link.product_id):Number(link.link_variant_product_id),
      variantId:linkVariantId,
      active:Boolean(link.active),
      manufacturer:{
        id:Number(link.manufacturer_id),
        name:String(link.manufacturer_name),
        active:Boolean(link.manufacturer_active)
      }
    }
  };
}

async function runRow(db:DB,id:number){
  const rows=await db`
    SELECT
      r.id,r.run_code,r.product_specification_version_id,r.manufacturer_link_id,r.status,
      r.external_reference,r.planned_start_at,r.planned_end_at,r.actual_start_at,r.actual_end_at,
      r.notes,r.released_at,r.completed_at,r.created_at,r.updated_at,
      r.created_by_user_id,creator.display_name AS created_by_display_name,
      r.updated_by_user_id,updater.display_name AS updated_by_display_name,
      r.released_by_user_id,releaser.display_name AS released_by_display_name,
      r.completed_by_user_id,completer.display_name AS completed_by_display_name,
      v.version_no,v.status AS specification_version_status,
      s.id AS specification_id,s.code AS specification_code,s.title AS specification_title,
      s.target_type AS specification_target_type,s.product_id AS specification_product_id,
      s.variant_id AS specification_variant_id,
      COALESCE(s.product_id,spv.product_id) AS resolved_product_id,
      p.name AS product_name,p.category,p.commercial_model,
      spv.sku AS specification_variant_sku,
      ml.target_type AS manufacturer_link_target_type,ml.product_id AS manufacturer_link_product_id,
      ml.variant_id AS manufacturer_link_variant_id,ml.active AS manufacturer_link_active,
      m.id AS manufacturer_id,m.name AS manufacturer_name,m.active AS manufacturer_active
    FROM production_runs r
    JOIN product_specification_versions v ON v.id=r.product_specification_version_id
    JOIN product_specifications s ON s.id=v.specification_id
    LEFT JOIN product_variants spv ON spv.id=s.variant_id
    JOIN products p ON p.id=COALESCE(s.product_id,spv.product_id)
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    LEFT JOIN staff_users creator ON creator.id=r.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=r.updated_by_user_id
    LEFT JOIN staff_users releaser ON releaser.id=r.released_by_user_id
    LEFT JOIN staff_users completer ON completer.id=r.completed_by_user_id
    WHERE r.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapRun(row:any){
  return {
    id:Number(row.id),
    runCode:row.run_code,
    status:row.status,
    specificationVersion:{
      id:Number(row.product_specification_version_id),
      specificationId:Number(row.specification_id),
      specificationCode:row.specification_code,
      specificationTitle:row.specification_title,
      versionNo:Number(row.version_no),
      currentStatus:row.specification_version_status,
      targetType:row.specification_target_type,
      productId:Number(row.resolved_product_id),
      variantId:row.specification_variant_id==null?null:Number(row.specification_variant_id),
      productName:row.product_name,
      category:row.category||null,
      commercialModel:row.commercial_model||null,
      sku:row.specification_variant_sku||null
    },
    manufacturerLink:{
      id:Number(row.manufacturer_link_id),
      targetType:row.manufacturer_link_target_type,
      productId:row.manufacturer_link_product_id==null?null:Number(row.manufacturer_link_product_id),
      variantId:row.manufacturer_link_variant_id==null?null:Number(row.manufacturer_link_variant_id),
      active:Boolean(row.manufacturer_link_active),
      manufacturer:{
        id:Number(row.manufacturer_id),
        name:row.manufacturer_name,
        active:Boolean(row.manufacturer_active)
      }
    },
    externalReference:row.external_reference||null,
    plannedStartAt:row.planned_start_at||null,
    plannedEndAt:row.planned_end_at||null,
    actualStartAt:row.actual_start_at||null,
    actualEndAt:row.actual_end_at||null,
    notes:row.notes||null,
    releasedAt:row.released_at||null,
    completedAt:row.completed_at||null,
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    releasedBy:row.released_by_user_id==null?null:{
      userId:Number(row.released_by_user_id),
      displayName:row.released_by_display_name||null
    },
    completedBy:row.completed_by_user_id==null?null:{
      userId:Number(row.completed_by_user_id),
      displayName:row.completed_by_display_name||null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    inventoryChanged:false,
    productionReceiptCreated:false,
    landedCostCalculated:false,
    qualityApproved:false
  };
}

function runSnapshot(row:any){
  const r=mapRun(row);
  return {
    runCode:r.runCode,
    status:r.status,
    productSpecificationVersionId:r.specificationVersion.id,
    manufacturerLinkId:r.manufacturerLink.id,
    externalReference:r.externalReference,
    plannedStartAt:r.plannedStartAt,
    plannedEndAt:r.plannedEndAt,
    actualStartAt:r.actualStartAt,
    actualEndAt:r.actualEndAt,
    notes:r.notes,
    releasedAt:r.releasedAt,
    completedAt:r.completedAt
  };
}

async function lotRow(db:DB,id:number){
  const rows=await db`
    SELECT
      l.id,l.production_run_id,l.lot_code,l.variant_id,l.status,
      l.planned_quantity,l.produced_quantity,l.started_at,l.completed_at,l.notes,
      l.created_at,l.updated_at,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      pv.product_id,pv.sku,pv.size,pv.color,p.name AS product_name
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapLot(row:any){
  return {
    id:Number(row.id),
    productionRunId:Number(row.production_run_id),
    lotCode:row.lot_code,
    variant:{
      id:Number(row.variant_id),
      productId:Number(row.product_id),
      sku:row.sku,
      size:row.size||null,
      color:row.color||null,
      productName:row.product_name
    },
    status:row.status,
    plannedQuantity:Number(row.planned_quantity),
    producedQuantity:Number(row.produced_quantity),
    startedAt:row.started_at||null,
    completedAt:row.completed_at||null,
    notes:row.notes||null,
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    inventoryChanged:false,
    inventorySourceCreated:false
  };
}

function lotSnapshot(row:any){
  const l=mapLot(row);
  return {
    productionRunId:l.productionRunId,
    lotCode:l.lotCode,
    variantId:l.variant.id,
    status:l.status,
    plannedQuantity:l.plannedQuantity,
    producedQuantity:l.producedQuantity,
    startedAt:l.startedAt,
    completedAt:l.completedAt,
    notes:l.notes
  };
}

async function lotsForRun(db:DB,runId:number){
  const rows=await db`
    SELECT
      l.id,l.production_run_id,l.lot_code,l.variant_id,l.status,
      l.planned_quantity,l.produced_quantity,l.started_at,l.completed_at,l.notes,
      l.created_at,l.updated_at,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      pv.product_id,pv.sku,pv.size,pv.color,p.name AS product_name
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.production_run_id=${runId}
    ORDER BY l.id`;
  return rows.map(mapLot);
}

async function runHistory(db:DB,id:number){
  const rows=await db`
    SELECT h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM production_run_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.production_run_id=${id}
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

async function lotHistory(db:DB,id:number){
  const rows=await db`
    SELECT h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM production_lot_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.production_lot_id=${id}
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

async function appendRunHistory(tx:DB,id:number,actor:any,action:string,note:string|null){
  const row=await runRow(tx,id);
  const a=actorFields(actor);
  await tx`
    INSERT INTO production_run_history(
      production_run_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${id},${a.userId},${a.service},${action},
      ${JSON.stringify(runSnapshot(row))}::jsonb,${note}
    )`;
}

async function appendLotHistory(tx:DB,id:number,actor:any,action:string,note:string|null){
  const row=await lotRow(tx,id);
  const a=actorFields(actor);
  await tx`
    INSERT INTO production_lot_history(
      production_lot_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${id},${a.userId},${a.service},${action},
      ${JSON.stringify(lotSnapshot(row))}::jsonb,${note}
    )`;
}

async function listRuns(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"production_runs.read");
  if(!auth.ok)return auth.response;

  const status=clean(url.searchParams.get("status"),30).toUpperCase();
  const productRaw=url.searchParams.get("productId");
  const productId=productRaw?Number(productRaw):null;
  if(status&&!RUN_STATUSES.has(status))return json({error:"invalid_status"},400);
  if(productId!=null&&(!Number.isSafeInteger(productId)||productId<1)){
    return json({error:"invalid_product"},400);
  }

  const rows=await db`
    SELECT r.id
    FROM production_runs r
    JOIN product_specification_versions v ON v.id=r.product_specification_version_id
    JOIN product_specifications s ON s.id=v.specification_id
    LEFT JOIN product_variants spv ON spv.id=s.variant_id
    WHERE (${status||null}::text IS NULL OR r.status=${status||null}::text)
      AND (
        ${productId}::bigint IS NULL OR
        s.product_id=${productId}::bigint OR
        spv.product_id=${productId}::bigint
      )
    ORDER BY r.updated_at DESC,r.id DESC
    LIMIT 300`;

  const data=[];
  for(const row of rows){
    const run=await runRow(db,Number(row.id));
    data.push({
      ...mapRun(run),
      lots:await lotsForRun(db,Number(row.id))
    });
  }
  return json({data});
}

async function createRun(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const runCode=code(body?.runCode);
  const specVersionId=Number(body?.productSpecificationVersionId);
  const manufacturerLinkId=Number(body?.manufacturerLinkId);
  const externalReference=clean(body?.externalReference,240)||null;
  const notes=clean(body?.notes,4000)||null;
  const plannedStartAt=optionalDate(body?.plannedStartAt);
  const plannedEndAt=optionalDate(body?.plannedEndAt);

  if(runCode.length<3)return json({error:"invalid_run_code"},400);
  if(!Number.isSafeInteger(specVersionId)||specVersionId<1){
    return json({error:"invalid_specification_version"},400);
  }
  if(!Number.isSafeInteger(manufacturerLinkId)||manufacturerLinkId<1){
    return json({error:"invalid_manufacturer_link"},400);
  }
  if(body?.plannedStartAt&&!plannedStartAt)return json({error:"invalid_planned_start"},400);
  if(body?.plannedEndAt&&!plannedEndAt)return json({error:"invalid_planned_end"},400);
  if(plannedStartAt&&plannedEndAt&&new Date(plannedEndAt)<new Date(plannedStartAt)){
    return json({error:"invalid_planned_window"},400);
  }

  const context:any=await productionContext(db,specVersionId,manufacturerLinkId);
  if(context.error)return json({error:context.error},context.status||400);
  if(!context.spec.active)return json({error:"specification_inactive"},409);
  if(context.spec.versionStatus!=="APPROVED"){
    return json({error:"approved_specification_version_required"},409);
  }
  if(!context.manufacturerLink.active||!context.manufacturerLink.manufacturer.active){
    return json({error:"manufacturer_link_inactive"},409);
  }

  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO production_runs(
          run_code,product_specification_version_id,manufacturer_link_id,status,
          external_reference,planned_start_at,planned_end_at,notes,
          created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${runCode},${specVersionId},${manufacturerLinkId},'PLANNED',
          ${externalReference},${plannedStartAt},${plannedEndAt},${notes},
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendRunHistory(tx,id,auth.actor,"CREATED",notes);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"production_run.created",
        resourceType:"ProductionRun",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          runCode,
          productSpecificationVersionId:specVersionId,
          manufacturerLinkId,
          productId:context.spec.productId,
          inventoryChanged:false,
          productionReceiptCreated:false,
          landedCostCalculated:false,
          qualityApproved:false
        }
      });
      return {id};
    });

    return json({
      run:mapRun(await runRow(db,result.id)),
      lots:[],
      inventoryChanged:false,
      productionReceiptCreated:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"run_code_exists"},409);
    }
    throw error;
  }
}

async function getRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.read");
  if(!auth.ok)return auth.response;
  const row=await runRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    run:mapRun(row),
    lots:await lotsForRun(db,id),
    history:await runHistory(db,id),
    inventoryChanged:false,
    productionReceiptCreated:false
  });
}

async function updateRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  const existing=await runRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="PLANNED")return json({error:"run_configuration_locked"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const externalReference=body?.externalReference==null
    ? existing.external_reference
    : (clean(body.externalReference,240)||null);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,4000)||null);
  const plannedStartAt=body?.plannedStartAt==null
    ? existing.planned_start_at
    : optionalDate(body.plannedStartAt);
  const plannedEndAt=body?.plannedEndAt==null
    ? existing.planned_end_at
    : optionalDate(body.plannedEndAt);
  const changeNote=clean(body?.changeNote,1000)||null;

  if(body?.plannedStartAt!=null&&body.plannedStartAt!==""&&!plannedStartAt){
    return json({error:"invalid_planned_start"},400);
  }
  if(body?.plannedEndAt!=null&&body.plannedEndAt!==""&&!plannedEndAt){
    return json({error:"invalid_planned_end"},400);
  }
  if(plannedStartAt&&plannedEndAt&&new Date(plannedEndAt)<new Date(plannedStartAt)){
    return json({error:"invalid_planned_window"},400);
  }

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_runs
      SET external_reference=${externalReference},
          planned_start_at=${plannedStartAt},
          planned_end_at=${plannedEndAt},
          notes=${notes},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='PLANNED'`;
    await appendRunHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.updated",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{
        inventoryChanged:false,
        productionReceiptCreated:false,
        landedCostCalculated:false
      }
    });
  });

  return json({
    run:mapRun(await runRow(db,id)),
    lots:await lotsForRun(db,id),
    inventoryChanged:false
  });
}

async function createLot(req:Request,db:DB,runId:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const run=await runRow(db,runId);
  if(!run)return json({error:"run_not_found"},404);
  if(run.status!=="PLANNED")return json({error:"run_configuration_locked"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const lotCode=code(body?.lotCode,120);
  const variantId=Number(body?.variantId);
  const plannedQuantity=positiveInt(body?.plannedQuantity);
  const notes=clean(body?.notes,2000)||null;

  if(lotCode.length<3)return json({error:"invalid_lot_code"},400);
  if(!Number.isSafeInteger(variantId)||variantId<1)return json({error:"invalid_variant"},400);
  if(plannedQuantity==null)return json({error:"invalid_planned_quantity"},400);

  const variants=await db`
    SELECT id,product_id,sku
    FROM product_variants
    WHERE id=${variantId}
    LIMIT 1`;
  if(!variants.length)return json({error:"variant_not_found"},404);

  const expectedProductId=Number(run.resolved_product_id);
  if(Number(variants[0].product_id)!==expectedProductId){
    return json({error:"variant_product_mismatch"},409);
  }
  if(run.specification_variant_id!=null&&Number(run.specification_variant_id)!==variantId){
    return json({error:"specification_variant_mismatch"},409);
  }
  if(run.manufacturer_link_target_type==="VARIANT"&&Number(run.manufacturer_link_variant_id)!==variantId){
    return json({error:"manufacturer_link_variant_mismatch"},409);
  }

  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO production_lots(
          production_run_id,lot_code,variant_id,status,planned_quantity,produced_quantity,
          notes,created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${runId},${lotCode},${variantId},'PLANNED',${plannedQuantity},0,
          ${notes},
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendLotHistory(tx,id,auth.actor,"CREATED",notes);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"production_lot.created",
        resourceType:"ProductionLot",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          productionRunId:runId,
          variantId,
          plannedQuantity,
          inventoryChanged:false,
          inventorySourceCreated:false
        }
      });
      return {id};
    });

    return json({
      lot:mapLot(await lotRow(db,result.id)),
      inventoryChanged:false,
      inventorySourceCreated:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"lot_code_exists"},409);
    }
    throw error;
  }
}

async function getLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.read");
  if(!auth.ok)return auth.response;
  const row=await lotRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    lot:mapLot(row),
    history:await lotHistory(db,id),
    inventoryChanged:false
  });
}

async function updateLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await lotRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="PLANNED")return json({error:"lot_configuration_locked"},409);

  const run=await runRow(db,Number(existing.production_run_id));
  if(!run||run.status!=="PLANNED")return json({error:"run_configuration_locked"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const plannedQuantity=body?.plannedQuantity==null
    ? Number(existing.planned_quantity)
    : positiveInt(body.plannedQuantity);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,2000)||null);
  const changeNote=clean(body?.changeNote,1000)||null;
  if(plannedQuantity==null)return json({error:"invalid_planned_quantity"},400);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_lots
      SET planned_quantity=${plannedQuantity},
          notes=${notes},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='PLANNED'`;
    await appendLotHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_lot.updated",
      resourceType:"ProductionLot",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{
        productionRunId:Number(existing.production_run_id),
        inventoryChanged:false
      }
    });
  });

  return json({
    lot:mapLot(await lotRow(db,id)),
    history:await lotHistory(db,id),
    inventoryChanged:false
  });
}

async function releaseRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.release",{mutation:true});
  if(!auth.ok)return auth.response;
  if(auth.actor.type!=="USER")return json({error:"human_release_required"},403);

  let body:any={};
  try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;

  const result:any=await db.begin(async(tx:DB)=>{
    const runs=await tx`
      SELECT id,status,product_specification_version_id,manufacturer_link_id
      FROM production_runs
      WHERE id=${id}
      FOR UPDATE`;
    if(!runs.length)return {error:"not_found",status:404};
    if(runs[0].status!=="PLANNED")return {error:"run_not_releasable",status:409};

    const context:any=await productionContext(
      tx,
      Number(runs[0].product_specification_version_id),
      Number(runs[0].manufacturer_link_id)
    );
    if(context.error)return context;
    if(!context.spec.active)return {error:"specification_inactive",status:409};
    if(context.spec.versionStatus!=="APPROVED"){
      return {error:"approved_specification_version_required",status:409};
    }
    if(!context.manufacturerLink.active||!context.manufacturerLink.manufacturer.active){
      return {error:"manufacturer_link_inactive",status:409};
    }

    const lots=await tx`
      SELECT id,status
      FROM production_lots
      WHERE production_run_id=${id}
      ORDER BY id
      FOR UPDATE`;
    if(!lots.length)return {error:"production_lot_required",status:409};
    if(lots.some((x:any)=>x.status!=="PLANNED")){
      return {error:"all_lots_must_be_planned",status:409};
    }

    await tx`
      UPDATE production_runs
      SET status='RELEASED',
          released_by_user_id=${auth.actor.userId},
          released_at=NOW(),
          updated_by_user_id=${auth.actor.userId},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendRunHistory(tx,id,auth.actor,"RELEASED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.released",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        lotIds:lots.map((x:any)=>Number(x.id)),
        productSpecificationVersionId:context.spec.versionId,
        manufacturerLinkId:context.manufacturerLink.id,
        inventoryChanged:false,
        productionReceiptCreated:false
      }
    });
    return {ok:true};
  });

  if(result.error)return json({error:result.error},result.status||409);
  return json({
    run:mapRun(await runRow(db,id)),
    lots:await lotsForRun(db,id),
    inventoryChanged:false,
    productionReceiptCreated:false
  });
}

async function startRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  let body:any={}; try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;

  const existing=await runRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="RELEASED")return json({error:"run_not_startable"},409);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_runs
      SET status='IN_PRODUCTION',
          actual_start_at=COALESCE(actual_start_at,NOW()),
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='RELEASED'`;
    await appendRunHistory(tx,id,auth.actor,"STARTED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.started",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{inventoryChanged:false,productionReceiptCreated:false}
    });
  });

  return json({
    run:mapRun(await runRow(db,id)),
    lots:await lotsForRun(db,id),
    inventoryChanged:false
  });
}

async function cancelRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  let body:any={}; try{body=await req.json();}catch{}
  const note=clean(body?.note,1000);
  if(note.length<5)return json({error:"cancellation_note_required"},400);

  const existing=await runRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(!["PLANNED","RELEASED"].includes(existing.status)){
    return json({error:"run_not_cancellable",currentStatus:existing.status},409);
  }
  const lots=await lotsForRun(db,id);
  if(lots.some((x:any)=>x.status==="IN_PRODUCTION"||x.status==="COMPLETED"||x.producedQuantity>0)){
    return json({error:"run_has_started_lots"},409);
  }

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_runs
      SET status='CANCELLED',
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    await tx`
      UPDATE production_lots
      SET status='CANCELLED',
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE production_run_id=${id} AND status='PLANNED'`;
    const changedLots=await tx`
      SELECT id FROM production_lots
      WHERE production_run_id=${id} AND status='CANCELLED'`;
    for(const lot of changedLots){
      await appendLotHistory(tx,Number(lot.id),auth.actor,"CANCELLED",note);
    }
    await appendRunHistory(tx,id,auth.actor,"CANCELLED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.cancelled",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{inventoryChanged:false,productionReceiptCreated:false}
    });
  });

  return json({
    run:mapRun(await runRow(db,id)),
    lots:await lotsForRun(db,id),
    inventoryChanged:false
  });
}

async function startLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  let body:any={}; try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;

  const existing=await lotRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="PLANNED")return json({error:"lot_not_startable"},409);
  const run=await runRow(db,Number(existing.production_run_id));
  if(!run||run.status!=="IN_PRODUCTION")return json({error:"run_not_in_production"},409);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_lots
      SET status='IN_PRODUCTION',started_at=NOW(),
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='PLANNED'`;
    await appendLotHistory(tx,id,auth.actor,"STARTED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_lot.started",
      resourceType:"ProductionLot",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{productionRunId:Number(existing.production_run_id),inventoryChanged:false}
    });
  });

  return json({lot:mapLot(await lotRow(db,id)),inventoryChanged:false});
}

async function completeLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const producedQuantity=nonNegativeInt(body?.producedQuantity);
  const note=clean(body?.note,1000)||null;
  if(producedQuantity==null)return json({error:"invalid_produced_quantity"},400);

  const existing=await lotRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="IN_PRODUCTION")return json({error:"lot_not_completable"},409);
  const run=await runRow(db,Number(existing.production_run_id));
  if(!run||run.status!=="IN_PRODUCTION")return json({error:"run_not_in_production"},409);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_lots
      SET status='COMPLETED',
          produced_quantity=${producedQuantity},
          completed_at=NOW(),
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='IN_PRODUCTION'`;
    await appendLotHistory(tx,id,auth.actor,"COMPLETED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_lot.completed",
      resourceType:"ProductionLot",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        productionRunId:Number(existing.production_run_id),
        producedQuantity,
        inventoryChanged:false,
        inventorySourceCreated:false,
        qualityApproved:false
      }
    });
  });

  return json({
    lot:mapLot(await lotRow(db,id)),
    inventoryChanged:false,
    inventorySourceCreated:false,
    qualityApproved:false
  });
}

async function cancelLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  let body:any={}; try{body=await req.json();}catch{}
  const note=clean(body?.note,1000);
  if(note.length<5)return json({error:"cancellation_note_required"},400);

  const existing=await lotRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(!["PLANNED","IN_PRODUCTION"].includes(existing.status)){
    return json({error:"lot_not_cancellable"},409);
  }
  const run=await runRow(db,Number(existing.production_run_id));
  if(!run||!["PLANNED","RELEASED","IN_PRODUCTION"].includes(run.status)){
    return json({error:"run_closed"},409);
  }

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_lots
      SET status='CANCELLED',
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendLotHistory(tx,id,auth.actor,"CANCELLED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_lot.cancelled",
      resourceType:"ProductionLot",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{productionRunId:Number(existing.production_run_id),inventoryChanged:false}
    });
  });

  return json({lot:mapLot(await lotRow(db,id)),inventoryChanged:false});
}

async function completeRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  let body:any={}; try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;

  const existing=await runRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="IN_PRODUCTION")return json({error:"run_not_completable"},409);

  const lots=await lotsForRun(db,id);
  if(!lots.length)return json({error:"production_lot_required"},409);
  if(lots.some((x:any)=>!["COMPLETED","CANCELLED"].includes(x.status))){
    return json({error:"lots_not_closed"},409);
  }
  if(!lots.some((x:any)=>x.status==="COMPLETED")){
    return json({error:"completed_lot_required"},409);
  }

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_runs
      SET status='COMPLETED',
          actual_end_at=NOW(),
          completed_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          completed_at=NOW(),
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='IN_PRODUCTION'`;
    await appendRunHistory(tx,id,auth.actor,"COMPLETED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.completed",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        producedQuantity:lots.reduce((sum:number,x:any)=>sum+Number(x.producedQuantity||0),0),
        lotIds:lots.map((x:any)=>x.id),
        inventoryChanged:false,
        productionReceiptCreated:false,
        landedCostCalculated:false,
        qualityApproved:false
      }
    });
  });

  return json({
    run:mapRun(await runRow(db,id)),
    lots:await lotsForRun(db,id),
    inventoryChanged:false,
    productionReceiptCreated:false,
    landedCostCalculated:false,
    qualityApproved:false
  });
}

export async function handleProductionRuns(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/production-runs"){
    if(req.method==="GET")return listRuns(req,url,db);
    if(req.method==="POST")return createRun(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const lotCreate=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/lots$/);
  if(lotCreate){
    if(req.method==="POST")return createLot(req,db,Number(lotCreate[1]));
    return json({error:"method_not_allowed"},405);
  }

  const release=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/release$/);
  if(release){
    if(req.method==="POST")return releaseRun(req,db,Number(release[1]));
    return json({error:"method_not_allowed"},405);
  }

  const start=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/start$/);
  if(start){
    if(req.method==="POST")return startRun(req,db,Number(start[1]));
    return json({error:"method_not_allowed"},405);
  }

  const cancel=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/cancel$/);
  if(cancel){
    if(req.method==="POST")return cancelRun(req,db,Number(cancel[1]));
    return json({error:"method_not_allowed"},405);
  }

  const complete=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/complete$/);
  if(complete){
    if(req.method==="POST")return completeRun(req,db,Number(complete[1]));
    return json({error:"method_not_allowed"},405);
  }

  const runMatch=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)$/);
  if(runMatch){
    const id=Number(runMatch[1]);
    if(req.method==="GET")return getRun(req,db,id);
    if(req.method==="PATCH")return updateRun(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  const lotStart=url.pathname.match(/^\/v1\/internal\/production-lots\/(\d+)\/start$/);
  if(lotStart){
    if(req.method==="POST")return startLot(req,db,Number(lotStart[1]));
    return json({error:"method_not_allowed"},405);
  }

  const lotComplete=url.pathname.match(/^\/v1\/internal\/production-lots\/(\d+)\/complete$/);
  if(lotComplete){
    if(req.method==="POST")return completeLot(req,db,Number(lotComplete[1]));
    return json({error:"method_not_allowed"},405);
  }

  const lotCancel=url.pathname.match(/^\/v1\/internal\/production-lots\/(\d+)\/cancel$/);
  if(lotCancel){
    if(req.method==="POST")return cancelLot(req,db,Number(lotCancel[1]));
    return json({error:"method_not_allowed"},405);
  }

  const lotMatch=url.pathname.match(/^\/v1\/internal\/production-lots\/(\d+)$/);
  if(lotMatch){
    const id=Number(lotMatch[1]);
    if(req.method==="GET")return getLot(req,db,id);
    if(req.method==="PATCH")return updateLot(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if(
    url.pathname.startsWith("/v1/internal/production-runs") ||
    url.pathname.startsWith("/v1/internal/production-lots")
  ){
    return json({error:"not_found"},404);
  }

  return null;
}
