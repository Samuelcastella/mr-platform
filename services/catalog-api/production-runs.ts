import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const RUN_STATUSES=new Set(["PLANNED","RELEASED","IN_PRODUCTION","COMPLETED","CANCELLED"]);
const LOT_STATUSES=new Set(["PLANNED","IN_PRODUCTION","COMPLETED","CANCELLED"]);

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

function isoDate(value:unknown){
  if(value==null||value==="")return null;
  if(typeof value!=="string")return "";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"":d.toISOString();
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

export async function ensureProductionRunsSchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS production_runs (
      id BIGSERIAL PRIMARY KEY,
      run_code TEXT UNIQUE NOT NULL,
      product_specification_version_id BIGINT NOT NULL REFERENCES product_specification_versions(id) ON DELETE RESTRICT,
      manufacturer_link_id BIGINT NOT NULL REFERENCES manufacturer_links(id) ON DELETE RESTRICT,
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
      released_at TIMESTAMPTZ,
      completed_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      completed_at TIMESTAMPTZ,
      cancelled_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PLANNED','RELEASED','IN_PRODUCTION','COMPLETED','CANCELLED'))
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_runs_status
    ON production_runs(status,updated_at DESC,id DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_runs_spec
    ON production_runs(product_specification_version_id,created_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_production_runs_manufacturer
    ON production_runs(manufacturer_link_id,created_at DESC)`;

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
      CHECK (planned_quantity>0),
      CHECK (produced_quantity>=0)
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
    CREATE INDEX IF NOT EXISTS idx_production_run_history_record
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
    CREATE INDEX IF NOT EXISTS idx_production_lot_history_record
    ON production_lot_history(production_lot_id,id)`;
}

async function contextForSpecAndManufacturer(db:DB,specVersionId:number,manufacturerLinkId:number){
  const specs=await db`
    SELECT
      v.id AS version_id,v.version_no,v.status AS version_status,
      s.id AS specification_id,s.code AS specification_code,s.title AS specification_title,
      s.target_type AS specification_target_type,s.product_id AS specification_product_id,
      s.variant_id AS specification_variant_id,
      COALESCE(s.product_id,spv.product_id) AS specification_resolved_product_id
    FROM product_specification_versions v
    JOIN product_specifications s ON s.id=v.specification_id
    LEFT JOIN product_variants spv ON spv.id=s.variant_id
    WHERE v.id=${specVersionId}
    LIMIT 1`;
  if(!specs.length)return {error:"specification_version_not_found" as const,status:404};
  if(specs[0].version_status!=="APPROVED"){
    return {error:"approved_specification_required" as const,status:409};
  }

  const links=await db`
    SELECT
      l.id,l.target_type,l.product_id,l.variant_id,l.active AS link_active,
      m.id AS manufacturer_id,m.name AS manufacturer_name,m.active AS manufacturer_active,
      COALESCE(l.product_id,lpv.product_id) AS link_resolved_product_id
    FROM manufacturer_links l
    JOIN manufacturers m ON m.id=l.manufacturer_id
    LEFT JOIN product_variants lpv ON lpv.id=l.variant_id
    WHERE l.id=${manufacturerLinkId}
    LIMIT 1`;
  if(!links.length)return {error:"manufacturer_link_not_found" as const,status:404};
  if(!links[0].link_active||!links[0].manufacturer_active){
    return {error:"manufacturer_link_inactive" as const,status:409};
  }

  const spec=specs[0],link=links[0];
  if(Number(spec.specification_resolved_product_id)!==Number(link.link_resolved_product_id)){
    return {error:"manufacturer_link_specification_mismatch" as const,status:409};
  }
  if(
    spec.specification_target_type==="VARIANT" &&
    link.target_type==="VARIANT" &&
    Number(spec.specification_variant_id)!==Number(link.variant_id)
  ){
    return {error:"manufacturer_link_specification_mismatch" as const,status:409};
  }

  return {
    ok:true as const,
    specification:{
      versionId:Number(spec.version_id),
      versionNo:Number(spec.version_no),
      specificationId:Number(spec.specification_id),
      code:spec.specification_code,
      title:spec.specification_title,
      targetType:spec.specification_target_type,
      productId:Number(spec.specification_resolved_product_id),
      variantId:spec.specification_variant_id==null?null:Number(spec.specification_variant_id)
    },
    manufacturerLink:{
      id:Number(link.id),
      targetType:link.target_type,
      productId:Number(link.link_resolved_product_id),
      variantId:link.variant_id==null?null:Number(link.variant_id),
      manufacturerId:Number(link.manufacturer_id),
      manufacturerName:link.manufacturer_name
    }
  };
}

async function runRow(db:DB,id:number){
  const rows=await db`
    SELECT
      r.id,r.run_code,r.product_specification_version_id,r.manufacturer_link_id,r.status,
      r.external_reference,r.planned_start_at,r.planned_end_at,r.actual_start_at,r.actual_end_at,r.notes,
      sv.version_no AS specification_version_no,
      ps.id AS specification_id,ps.code AS specification_code,ps.title AS specification_title,
      ps.target_type AS specification_target_type,
      COALESCE(ps.product_id,spv.product_id) AS resolved_product_id,
      ps.variant_id AS specification_variant_id,
      p.name AS product_name,p.category,p.commercial_model,
      ml.target_type AS manufacturer_link_target_type,
      ml.variant_id AS manufacturer_link_variant_id,
      m.id AS manufacturer_id,m.name AS manufacturer_name,
      r.created_by_user_id,creator.display_name AS created_by_display_name,
      r.updated_by_user_id,updater.display_name AS updated_by_display_name,
      r.released_by_user_id,releaser.display_name AS released_by_display_name,r.released_at,
      r.completed_by_user_id,completer.display_name AS completed_by_display_name,r.completed_at,
      r.cancelled_by_user_id,canceller.display_name AS cancelled_by_display_name,r.cancelled_at,
      r.created_at,r.updated_at
    FROM production_runs r
    JOIN product_specification_versions sv ON sv.id=r.product_specification_version_id
    JOIN product_specifications ps ON ps.id=sv.specification_id
    LEFT JOIN product_variants spv ON spv.id=ps.variant_id
    JOIN products p ON p.id=COALESCE(ps.product_id,spv.product_id)
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    LEFT JOIN staff_users creator ON creator.id=r.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=r.updated_by_user_id
    LEFT JOIN staff_users releaser ON releaser.id=r.released_by_user_id
    LEFT JOIN staff_users completer ON completer.id=r.completed_by_user_id
    LEFT JOIN staff_users canceller ON canceller.id=r.cancelled_by_user_id
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
      versionNo:Number(row.specification_version_no),
      specificationId:Number(row.specification_id),
      code:row.specification_code,
      title:row.specification_title,
      targetType:row.specification_target_type,
      productId:Number(row.resolved_product_id),
      variantId:row.specification_variant_id==null?null:Number(row.specification_variant_id)
    },
    manufacturerLink:{
      id:Number(row.manufacturer_link_id),
      targetType:row.manufacturer_link_target_type,
      variantId:row.manufacturer_link_variant_id==null?null:Number(row.manufacturer_link_variant_id),
      manufacturerId:Number(row.manufacturer_id),
      manufacturerName:row.manufacturer_name
    },
    productName:row.product_name,
    category:row.category||null,
    commercialModel:row.commercial_model||null,
    externalReference:row.external_reference||null,
    plannedStartAt:row.planned_start_at||null,
    plannedEndAt:row.planned_end_at||null,
    actualStartAt:row.actual_start_at||null,
    actualEndAt:row.actual_end_at||null,
    notes:row.notes||null,
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),displayName:row.updated_by_display_name||null
    },
    releasedBy:row.released_by_user_id==null?null:{
      userId:Number(row.released_by_user_id),displayName:row.released_by_display_name||null
    },
    releasedAt:row.released_at||null,
    completedBy:row.completed_by_user_id==null?null:{
      userId:Number(row.completed_by_user_id),displayName:row.completed_by_display_name||null
    },
    completedAt:row.completed_at||null,
    cancelledBy:row.cancelled_by_user_id==null?null:{
      userId:Number(row.cancelled_by_user_id),displayName:row.cancelled_by_display_name||null
    },
    cancelledAt:row.cancelled_at||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    inventoryChanged:false,
    goodsReceiptCreated:false,
    landedCostCalculated:false
  };
}

async function lotRows(db:DB,runId:number){
  const rows=await db`
    SELECT
      l.id,l.production_run_id,l.lot_code,l.variant_id,l.status,
      l.planned_quantity,l.produced_quantity,l.started_at,l.completed_at,l.notes,
      pv.sku,pv.size,pv.color,pv.product_id,p.name AS product_name,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      l.created_at,l.updated_at
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.production_run_id=${runId}
    ORDER BY l.id`;
  return rows;
}

function mapLot(row:any){
  return {
    id:Number(row.id),
    productionRunId:Number(row.production_run_id),
    lotCode:row.lot_code,
    variantId:Number(row.variant_id),
    sku:row.sku,
    size:row.size||null,
    color:row.color||null,
    productId:Number(row.product_id),
    productName:row.product_name,
    status:row.status,
    plannedQuantity:Number(row.planned_quantity),
    producedQuantity:Number(row.produced_quantity),
    startedAt:row.started_at||null,
    completedAt:row.completed_at||null,
    notes:row.notes||null,
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),displayName:row.updated_by_display_name||null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    inventoryReceived:false
  };
}

async function lotRow(db:DB,id:number){
  const rows=await db`
    SELECT
      l.id,l.production_run_id,l.lot_code,l.variant_id,l.status,
      l.planned_quantity,l.produced_quantity,l.started_at,l.completed_at,l.notes,
      pv.sku,pv.size,pv.color,pv.product_id,p.name AS product_name,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      l.created_at,l.updated_at
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

async function snapshotRun(db:DB,id:number){
  return {
    run:mapRun(await runRow(db,id)),
    lots:(await lotRows(db,id)).map(mapLot)
  };
}

async function runHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
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
    snapshot:parseJsonObject(row.snapshot),
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function lotHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
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
    snapshot:parseJsonObject(row.snapshot),
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function listRuns(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"production_runs.read");
  if(!auth.ok)return auth.response;

  const status=clean(url.searchParams.get("status"),30).toUpperCase();
  if(status&&!RUN_STATUSES.has(status))return json({error:"invalid_status"},400);

  const rows=await db`
    SELECT
      r.id,r.run_code,r.product_specification_version_id,r.manufacturer_link_id,r.status,
      r.external_reference,r.planned_start_at,r.planned_end_at,r.actual_start_at,r.actual_end_at,r.notes,
      sv.version_no AS specification_version_no,
      ps.id AS specification_id,ps.code AS specification_code,ps.title AS specification_title,
      ps.target_type AS specification_target_type,
      COALESCE(ps.product_id,spv.product_id) AS resolved_product_id,
      ps.variant_id AS specification_variant_id,
      p.name AS product_name,p.category,p.commercial_model,
      ml.target_type AS manufacturer_link_target_type,
      ml.variant_id AS manufacturer_link_variant_id,
      m.id AS manufacturer_id,m.name AS manufacturer_name,
      r.created_by_user_id,creator.display_name AS created_by_display_name,
      r.updated_by_user_id,updater.display_name AS updated_by_display_name,
      r.released_by_user_id,releaser.display_name AS released_by_display_name,r.released_at,
      r.completed_by_user_id,completer.display_name AS completed_by_display_name,r.completed_at,
      r.cancelled_by_user_id,canceller.display_name AS cancelled_by_display_name,r.cancelled_at,
      r.created_at,r.updated_at
    FROM production_runs r
    JOIN product_specification_versions sv ON sv.id=r.product_specification_version_id
    JOIN product_specifications ps ON ps.id=sv.specification_id
    LEFT JOIN product_variants spv ON spv.id=ps.variant_id
    JOIN products p ON p.id=COALESCE(ps.product_id,spv.product_id)
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    LEFT JOIN staff_users creator ON creator.id=r.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=r.updated_by_user_id
    LEFT JOIN staff_users releaser ON releaser.id=r.released_by_user_id
    LEFT JOIN staff_users completer ON completer.id=r.completed_by_user_id
    LEFT JOIN staff_users canceller ON canceller.id=r.cancelled_by_user_id
    WHERE (${status||null}::text IS NULL OR r.status=${status||null}::text)
    ORDER BY
      CASE r.status WHEN 'IN_PRODUCTION' THEN 0 WHEN 'RELEASED' THEN 1 WHEN 'PLANNED' THEN 2 ELSE 3 END,
      r.updated_at DESC,r.id DESC
    LIMIT 300`;

  return json({data:rows.map(mapRun)});
}

async function createRun(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const runCode=code(body?.runCode,100);
  const specVersionId=Number(body?.productSpecificationVersionId);
  const manufacturerLinkId=Number(body?.manufacturerLinkId);
  const externalReference=clean(body?.externalReference,240)||null;
  const plannedStartAt=isoDate(body?.plannedStartAt);
  const plannedEndAt=isoDate(body?.plannedEndAt);
  const notes=clean(body?.notes,4000)||null;

  if(runCode.length<3)return json({error:"invalid_run_code"},400);
  if(!Number.isSafeInteger(specVersionId)||specVersionId<1)return json({error:"invalid_specification_version"},400);
  if(!Number.isSafeInteger(manufacturerLinkId)||manufacturerLinkId<1)return json({error:"invalid_manufacturer_link"},400);
  if(plannedStartAt==="")return json({error:"invalid_planned_start"},400);
  if(plannedEndAt==="")return json({error:"invalid_planned_end"},400);
  if(plannedStartAt&&plannedEndAt&&new Date(plannedEndAt)<new Date(plannedStartAt)){
    return json({error:"invalid_planned_window"},400);
  }

  const context:any=await contextForSpecAndManufacturer(db,specVersionId,manufacturerLinkId);
  if(context.error)return json({error:context.error},context.status||400);

  const actor=actorFields(auth.actor);
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
      const snap=await snapshotRun(tx,id);
      await tx`
        INSERT INTO production_run_history(
          production_run_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${id},${actor.userId},${actor.service},'CREATED',
          ${JSON.stringify(snap)}::jsonb,${notes}
        )`;
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"production_run.created",
        resourceType:"ProductionRun",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          runCode,
          specificationVersionId:specVersionId,
          manufacturerLinkId,
          inventoryChanged:false,
          goodsReceiptCreated:false,
          landedCostCalculated:false
        }
      });
      return {id};
    });

    return json({
      productionRun:mapRun(await runRow(db,result.id)),
      lots:[],
      inventoryChanged:false,
      goodsReceiptCreated:false,
      landedCostCalculated:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"run_code_exists"},409);
    }
    throw error;
  }
}

async function updateRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await runRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="PLANNED")return json({error:"run_not_editable",status:existing.status},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const externalReference=body?.externalReference==null
    ? existing.external_reference
    : (clean(body.externalReference,240)||null);
  const plannedStartAt=body?.plannedStartAt==null
    ? (existing.planned_start_at?new Date(existing.planned_start_at).toISOString():null)
    : isoDate(body.plannedStartAt);
  const plannedEndAt=body?.plannedEndAt==null
    ? (existing.planned_end_at?new Date(existing.planned_end_at).toISOString():null)
    : isoDate(body.plannedEndAt);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,4000)||null);
  const note=clean(body?.changeNote,1000)||null;

  if(plannedStartAt==="")return json({error:"invalid_planned_start"},400);
  if(plannedEndAt==="")return json({error:"invalid_planned_end"},400);
  if(plannedStartAt&&plannedEndAt&&new Date(plannedEndAt)<new Date(plannedStartAt)){
    return json({error:"invalid_planned_window"},400);
  }

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_runs
      SET external_reference=${externalReference},
          planned_start_at=${plannedStartAt},planned_end_at=${plannedEndAt},
          notes=${notes},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='PLANNED'`;
    const snap=await snapshotRun(tx,id);
    await tx`
      INSERT INTO production_run_history(
        production_run_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.updated",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{inventoryChanged:false,goodsReceiptCreated:false}
    });
  });

  return json({
    productionRun:mapRun(await runRow(db,id)),
    lots:(await lotRows(db,id)).map(mapLot),
    history:await runHistory(db,id),
    inventoryChanged:false,
    goodsReceiptCreated:false
  });
}

async function createLot(req:Request,db:DB,runId:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const run=await runRow(db,runId);
  if(!run)return json({error:"run_not_found"},404);
  if(run.status!=="PLANNED")return json({error:"run_not_editable",status:run.status},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const lotCode=code(body?.lotCode,120);
  const variantId=Number(body?.variantId);
  const plannedQuantity=Number(body?.plannedQuantity);
  const notes=clean(body?.notes,2000)||null;

  if(lotCode.length<3)return json({error:"invalid_lot_code"},400);
  if(!Number.isSafeInteger(variantId)||variantId<1)return json({error:"invalid_variant"},400);
  if(!Number.isSafeInteger(plannedQuantity)||plannedQuantity<1||plannedQuantity>100000000){
    return json({error:"invalid_planned_quantity"},400);
  }

  const variants=await db`
    SELECT id,product_id
    FROM product_variants
    WHERE id=${variantId}
    LIMIT 1`;
  if(!variants.length)return json({error:"variant_not_found"},404);

  const targetProductId=Number(run.resolved_product_id);
  if(Number(variants[0].product_id)!==targetProductId){
    return json({error:"variant_product_mismatch"},409);
  }
  if(
    run.specification_target_type==="VARIANT" &&
    Number(run.specification_variant_id)!==variantId
  ){
    return json({error:"variant_specification_mismatch"},409);
  }
  if(
    run.manufacturer_link_target_type==="VARIANT" &&
    Number(run.manufacturer_link_variant_id)!==variantId
  ){
    return json({error:"variant_manufacturer_link_mismatch"},409);
  }

  const actor=actorFields(auth.actor);
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
      const row=await lotRow(tx,id);
      await tx`
        INSERT INTO production_lot_history(
          production_lot_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${id},${actor.userId},${actor.service},'CREATED',
          ${JSON.stringify(mapLot(row))}::jsonb,${notes}
        )`;
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
          goodsReceiptCreated:false
        }
      });
      return {id};
    });

    return json({
      lot:mapLot(await lotRow(db,result.id)),
      inventoryChanged:false,
      goodsReceiptCreated:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"lot_code_exists"},409);
    }
    throw error;
  }
}

async function updateLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await lotRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  const run=await runRow(db,Number(existing.production_run_id));
  if(!run)return json({error:"run_not_found"},404);
  if(run.status!=="PLANNED"||existing.status!=="PLANNED"){
    return json({error:"lot_not_editable"},409);
  }

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const plannedQuantity=body?.plannedQuantity==null
    ? Number(existing.planned_quantity)
    : Number(body.plannedQuantity);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,2000)||null);
  const note=clean(body?.changeNote,1000)||null;

  if(!Number.isSafeInteger(plannedQuantity)||plannedQuantity<1||plannedQuantity>100000000){
    return json({error:"invalid_planned_quantity"},400);
  }

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE production_lots
      SET planned_quantity=${plannedQuantity},notes=${notes},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    const row=await lotRow(tx,id);
    await tx`
      INSERT INTO production_lot_history(
        production_lot_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(mapLot(row))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_lot.updated",
      resourceType:"ProductionLot",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{productionRunId:Number(existing.production_run_id),inventoryChanged:false}
    });
  });

  return json({
    lot:mapLot(await lotRow(db,id)),
    history:await lotHistory(db,id),
    inventoryChanged:false
  });
}

async function lifecycleAuth(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"production_runs.release",{mutation:true});
  if(!auth.ok)return auth;
  if(auth.actor.type!=="USER"){
    return {ok:false as const,response:json({error:"human_lifecycle_action_required"},403)};
  }
  return auth;
}

async function releaseRun(req:Request,db:DB,id:number){
  const auth=await lifecycleAuth(req,db);
  if(!auth.ok)return auth.response;

  let body:any={};
  try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;
  const actor=actorFields(auth.actor);

  const output:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,status
      FROM production_runs
      WHERE id=${id}
      FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};
    if(rows[0].status!=="PLANNED")return {error:"run_not_releasable",status:409};

    const lots=await tx`
      SELECT id,status
      FROM production_lots
      WHERE production_run_id=${id}
      ORDER BY id`;
    if(!lots.length)return {error:"lot_required",status:409};
    if(lots.some((x:any)=>x.status!=="PLANNED")){
      return {error:"lots_not_planned",status:409};
    }

    await tx`
      UPDATE production_runs
      SET status='RELEASED',
          released_by_user_id=${auth.actor.userId},released_at=NOW(),
          updated_by_user_id=${auth.actor.userId},updated_at=NOW()
      WHERE id=${id}`;
    const snap=await snapshotRun(tx,id);
    await tx`
      INSERT INTO production_run_history(
        production_run_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'RELEASED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.released",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{lotCount:lots.length,inventoryChanged:false,goodsReceiptCreated:false}
    });
    return {ok:true};
  });

  if(output.error)return json(output,output.status||400);
  return json({
    productionRun:mapRun(await runRow(db,id)),
    lots:(await lotRows(db,id)).map(mapLot),
    inventoryChanged:false,
    goodsReceiptCreated:false
  });
}

async function startRun(req:Request,db:DB,id:number){
  const auth=await lifecycleAuth(req,db);
  if(!auth.ok)return auth.response;
  let body:any={};try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;
  const actor=actorFields(auth.actor);

  const output:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,status FROM production_runs WHERE id=${id} FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};
    if(rows[0].status!=="RELEASED")return {error:"run_not_startable",status:409};
    await tx`
      UPDATE production_runs
      SET status='IN_PRODUCTION',actual_start_at=COALESCE(actual_start_at,NOW()),
          updated_by_user_id=${auth.actor.userId},updated_at=NOW()
      WHERE id=${id}`;
    const snap=await snapshotRun(tx,id);
    await tx`
      INSERT INTO production_run_history(
        production_run_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'STARTED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.started",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{inventoryChanged:false}
    });
    return {ok:true};
  });
  if(output.error)return json(output,output.status||400);
  return json({productionRun:mapRun(await runRow(db,id)),lots:(await lotRows(db,id)).map(mapLot),inventoryChanged:false});
}

async function lotAction(req:Request,db:DB,id:number,action:"start"|"complete"|"cancel"){
  const auth=await lifecycleAuth(req,db);
  if(!auth.ok)return auth.response;
  let body:any={};try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;
  const actor=actorFields(auth.actor);

  const output:any=await db.begin(async(tx:DB)=>{
    const lotRowsLocked=await tx`
      SELECT id,production_run_id,status,planned_quantity,produced_quantity
      FROM production_lots
      WHERE id=${id}
      FOR UPDATE`;
    if(!lotRowsLocked.length)return {error:"not_found",status:404};
    const lot=lotRowsLocked[0];

    const runRows=await tx`
      SELECT id,status
      FROM production_runs
      WHERE id=${Number(lot.production_run_id)}
      FOR UPDATE`;
    if(!runRows.length)return {error:"run_not_found",status:404};
    const runStatus=runRows[0].status;

    let actionName="",producedQuantity=Number(lot.produced_quantity);

    if(action==="start"){
      if(runStatus!=="IN_PRODUCTION")return {error:"run_not_in_production",status:409};
      if(lot.status!=="PLANNED")return {error:"lot_not_startable",status:409};
      await tx`
        UPDATE production_lots
        SET status='IN_PRODUCTION',started_at=COALESCE(started_at,NOW()),
            updated_by_user_id=${auth.actor.userId},updated_at=NOW()
        WHERE id=${id}`;
      actionName="STARTED";
    }else if(action==="complete"){
      if(runStatus!=="IN_PRODUCTION")return {error:"run_not_in_production",status:409};
      if(lot.status!=="IN_PRODUCTION")return {error:"lot_not_completable",status:409};
      producedQuantity=Number(body?.producedQuantity);
      if(!Number.isSafeInteger(producedQuantity)||producedQuantity<0||producedQuantity>100000000){
        return {error:"invalid_produced_quantity",status:400};
      }
      await tx`
        UPDATE production_lots
        SET status='COMPLETED',produced_quantity=${producedQuantity},
            completed_at=NOW(),updated_by_user_id=${auth.actor.userId},updated_at=NOW()
        WHERE id=${id}`;
      actionName="COMPLETED";
    }else{
      if(!["PLANNED","RELEASED","IN_PRODUCTION"].includes(runStatus)){
        return {error:"run_terminal",status:409};
      }
      if(!["PLANNED","IN_PRODUCTION"].includes(lot.status)){
        return {error:"lot_not_cancellable",status:409};
      }
      if(!note||note.length<5)return {error:"cancellation_note_required",status:400};
      await tx`
        UPDATE production_lots
        SET status='CANCELLED',completed_at=NOW(),
            updated_by_user_id=${auth.actor.userId},updated_at=NOW()
        WHERE id=${id}`;
      actionName="CANCELLED";
    }

    const row=await lotRow(tx,id);
    await tx`
      INSERT INTO production_lot_history(
        production_lot_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},${actionName},
        ${JSON.stringify(mapLot(row))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_lot."+action,
      resourceType:"ProductionLot",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        productionRunId:Number(lot.production_run_id),
        producedQuantity,
        inventoryChanged:false,
        goodsReceiptCreated:false
      }
    });
    return {ok:true};
  });

  if(output.error)return json(output,output.status||400);
  return json({
    lot:mapLot(await lotRow(db,id)),
    history:await lotHistory(db,id),
    inventoryChanged:false,
    goodsReceiptCreated:false
  });
}

async function completeRun(req:Request,db:DB,id:number){
  const auth=await lifecycleAuth(req,db);
  if(!auth.ok)return auth.response;
  let body:any={};try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;
  const actor=actorFields(auth.actor);

  const output:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,status
      FROM production_runs
      WHERE id=${id}
      FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};
    if(rows[0].status!=="IN_PRODUCTION")return {error:"run_not_completable",status:409};

    const lots=await tx`
      SELECT id,status
      FROM production_lots
      WHERE production_run_id=${id}
      ORDER BY id
      FOR UPDATE`;
    if(!lots.length)return {error:"lot_required",status:409};
    if(lots.some((x:any)=>!["COMPLETED","CANCELLED"].includes(x.status))){
      return {error:"lots_not_terminal",status:409};
    }
    if(!lots.some((x:any)=>x.status==="COMPLETED")){
      return {error:"completed_lot_required",status:409};
    }

    await tx`
      UPDATE production_runs
      SET status='COMPLETED',actual_end_at=NOW(),
          completed_by_user_id=${auth.actor.userId},completed_at=NOW(),
          updated_by_user_id=${auth.actor.userId},updated_at=NOW()
      WHERE id=${id}`;
    const snap=await snapshotRun(tx,id);
    await tx`
      INSERT INTO production_run_history(
        production_run_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'COMPLETED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.completed",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        completedLotCount:lots.filter((x:any)=>x.status==="COMPLETED").length,
        inventoryChanged:false,
        goodsReceiptCreated:false,
        landedCostCalculated:false
      }
    });
    return {ok:true};
  });

  if(output.error)return json(output,output.status||400);
  return json({
    productionRun:mapRun(await runRow(db,id)),
    lots:(await lotRows(db,id)).map(mapLot),
    history:await runHistory(db,id),
    inventoryChanged:false,
    goodsReceiptCreated:false,
    landedCostCalculated:false
  });
}

async function cancelRun(req:Request,db:DB,id:number){
  const auth=await lifecycleAuth(req,db);
  if(!auth.ok)return auth.response;
  let body:any={};try{body=await req.json();}catch{}
  const note=clean(body?.note,1000);
  if(note.length<5)return json({error:"cancellation_note_required"},400);
  const actor=actorFields(auth.actor);

  const output:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,status
      FROM production_runs
      WHERE id=${id}
      FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};
    if(["COMPLETED","CANCELLED"].includes(rows[0].status)){
      return {error:"run_terminal",status:409};
    }

    const lots=await tx`
      SELECT id,status
      FROM production_lots
      WHERE production_run_id=${id}
      ORDER BY id
      FOR UPDATE`;
    if(lots.some((x:any)=>x.status==="IN_PRODUCTION")){
      return {error:"in_production_lot_requires_resolution",status:409};
    }

    for(const lot of lots.filter((x:any)=>x.status==="PLANNED")){
      await tx`
        UPDATE production_lots
        SET status='CANCELLED',completed_at=NOW(),
            updated_by_user_id=${auth.actor.userId},updated_at=NOW()
        WHERE id=${Number(lot.id)}`;
      const row=await lotRow(tx,Number(lot.id));
      await tx`
        INSERT INTO production_lot_history(
          production_lot_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${Number(lot.id)},${actor.userId},${actor.service},'CANCELLED_BY_RUN',
          ${JSON.stringify(mapLot(row))}::jsonb,${note}
        )`;
    }

    await tx`
      UPDATE production_runs
      SET status='CANCELLED',cancelled_by_user_id=${auth.actor.userId},
          cancelled_at=NOW(),updated_by_user_id=${auth.actor.userId},updated_at=NOW()
      WHERE id=${id}`;
    const snap=await snapshotRun(tx,id);
    await tx`
      INSERT INTO production_run_history(
        production_run_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CANCELLED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"production_run.cancelled",
      resourceType:"ProductionRun",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{inventoryChanged:false,goodsReceiptCreated:false}
    });
    return {ok:true};
  });

  if(output.error)return json(output,output.status||400);
  return json({
    productionRun:mapRun(await runRow(db,id)),
    lots:(await lotRows(db,id)).map(mapLot),
    inventoryChanged:false,
    goodsReceiptCreated:false
  });
}

async function getRun(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.read");
  if(!auth.ok)return auth.response;
  const row=await runRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    productionRun:mapRun(row),
    lots:(await lotRows(db,id)).map(mapLot),
    history:await runHistory(db,id),
    inventoryChanged:false,
    goodsReceiptCreated:false,
    landedCostCalculated:false
  });
}

async function getLot(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"production_runs.read");
  if(!auth.ok)return auth.response;
  const row=await lotRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({lot:mapLot(row),history:await lotHistory(db,id),inventoryReceived:false});
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

  const releaseMatch=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/release$/);
  if(releaseMatch){
    if(req.method==="POST")return releaseRun(req,db,Number(releaseMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const startMatch=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/start$/);
  if(startMatch){
    if(req.method==="POST")return startRun(req,db,Number(startMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const completeMatch=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/complete$/);
  if(completeMatch){
    if(req.method==="POST")return completeRun(req,db,Number(completeMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const cancelMatch=url.pathname.match(/^\/v1\/internal\/production-runs\/(\d+)\/cancel$/);
  if(cancelMatch){
    if(req.method==="POST")return cancelRun(req,db,Number(cancelMatch[1]));
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
    if(req.method==="POST")return lotAction(req,db,Number(lotStart[1]),"start");
    return json({error:"method_not_allowed"},405);
  }

  const lotComplete=url.pathname.match(/^\/v1\/internal\/production-lots\/(\d+)\/complete$/);
  if(lotComplete){
    if(req.method==="POST")return lotAction(req,db,Number(lotComplete[1]),"complete");
    return json({error:"method_not_allowed"},405);
  }

  const lotCancel=url.pathname.match(/^\/v1\/internal\/production-lots\/(\d+)\/cancel$/);
  if(lotCancel){
    if(req.method==="POST")return lotAction(req,db,Number(lotCancel[1]),"cancel");
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
