import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const SOURCE_TYPES=new Set(["GOODS_RECEIPT","PRODUCTION_RUN"]);
const COMPONENT_TYPES=new Set([
  "FREIGHT","DUTY","BROKERAGE","INSURANCE",
  "LOCAL_TRANSPORT","PACKAGING","MANUFACTURING","OTHER"
]);

const json=(body:unknown,status=200)=>
  Response.json(body,{
    status,
    headers:{
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });

function clean(value:unknown,max:number){
  return typeof value==="string"?value.trim().slice(0,max):"";
}

function cleanCode(value:unknown,max=100){
  return clean(value,max).toUpperCase().replace(/[^A-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
}

function moneyInt(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}

function currencyCode(value:unknown){
  const code=clean(value,3).toUpperCase();
  return /^[A-Z]{3}$/.test(code)?code:"";
}

function actorFields(actor:any){
  return actor.type==="USER"
    ?{userId:actor.userId,service:null}
    :{userId:null,service:actor.service};
}

export async function ensureLandedCostSchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_cases (
      id BIGSERIAL PRIMARY KEY,
      case_code TEXT UNIQUE NOT NULL,
      source_type TEXT NOT NULL,
      goods_receipt_id BIGINT REFERENCES goods_receipts(id) ON DELETE RESTRICT,
      production_run_id BIGINT REFERENCES production_runs(id) ON DELETE RESTRICT,
      currency CHAR(3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      allocation_method TEXT NOT NULL DEFAULT 'MANUAL',
      notes TEXT,
      finalized_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      finalized_at TIMESTAMPTZ,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_type IN ('GOODS_RECEIPT','PRODUCTION_RUN')),
      CHECK (
        (source_type='GOODS_RECEIPT' AND goods_receipt_id IS NOT NULL AND production_run_id IS NULL) OR
        (source_type='PRODUCTION_RUN' AND goods_receipt_id IS NULL AND production_run_id IS NOT NULL)
      ),
      CHECK (status IN ('DRAFT','FINAL')),
      CHECK (allocation_method='MANUAL')
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_cost_case_receipt_unique
    ON landed_cost_cases(goods_receipt_id)
    WHERE goods_receipt_id IS NOT NULL`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_cost_case_run_unique
    ON landed_cost_cases(production_run_id)
    WHERE production_run_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_cost_cases_status
    ON landed_cost_cases(status,updated_at DESC,id DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_components (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES landed_cost_cases(id) ON DELETE RESTRICT,
      component_type TEXT NOT NULL,
      amount_minor BIGINT NOT NULL CHECK (amount_minor>=0),
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        component_type IN (
          'FREIGHT','DUTY','BROKERAGE','INSURANCE',
          'LOCAL_TRANSPORT','PACKAGING','MANUFACTURING','OTHER'
        )
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_cost_components_case
    ON landed_cost_components(case_id,active,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_allocations (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES landed_cost_cases(id) ON DELETE RESTRICT,
      target_type TEXT NOT NULL,
      goods_receipt_item_id BIGINT REFERENCES goods_receipt_items(id) ON DELETE RESTRICT,
      production_lot_id BIGINT REFERENCES production_lots(id) ON DELETE RESTRICT,
      allocated_cost_minor BIGINT NOT NULL CHECK (allocated_cost_minor>=0),
      quantity_snapshot INTEGER NOT NULL CHECK (quantity_snapshot>0),
      base_unit_cost_minor BIGINT,
      base_cost_minor BIGINT,
      currency CHAR(3) NOT NULL,
      notes TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (target_type IN ('GOODS_RECEIPT_ITEM','PRODUCTION_LOT')),
      CHECK (
        (target_type='GOODS_RECEIPT_ITEM' AND goods_receipt_item_id IS NOT NULL AND production_lot_id IS NULL) OR
        (target_type='PRODUCTION_LOT' AND goods_receipt_item_id IS NULL AND production_lot_id IS NOT NULL)
      ),
      CHECK (base_unit_cost_minor IS NULL OR base_unit_cost_minor>=0),
      CHECK (base_cost_minor IS NULL OR base_cost_minor>=0)
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_cost_allocation_receipt_item_unique
    ON landed_cost_allocations(case_id,goods_receipt_item_id)
    WHERE goods_receipt_item_id IS NOT NULL`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_cost_allocation_production_lot_unique
    ON landed_cost_allocations(case_id,production_lot_id)
    WHERE production_lot_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_case
    ON landed_cost_allocations(case_id,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_history (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES landed_cost_cases(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_landed_cost_history_case
    ON landed_cost_history(case_id,id)`;
}

async function sourceContext(db:DB,sourceType:string,sourceId:number){
  if(sourceType==="GOODS_RECEIPT"){
    const rows=await db`
      SELECT
        gr.id,gr.receipt_number,gr.status,gr.received_at,gr.location_id,
        po.id AS purchase_order_id,po.po_number,po.currency,po.supplier_id,
        po.supplier_name_snapshot
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id=gr.purchase_order_id
      WHERE gr.id=${sourceId}
      LIMIT 1`;
    if(!rows.length)return {error:"goods_receipt_not_found" as const,status:404};
    const row=rows[0];
    const totals=await db`
      SELECT
        COUNT(*)::int AS line_count,
        COALESCE(SUM(quantity_received),0)::bigint AS quantity_total,
        COALESCE(SUM(quantity_received*unit_cost_minor),0)::bigint AS base_cost_minor
      FROM goods_receipt_items
      WHERE goods_receipt_id=${sourceId}`;
    return {
      sourceType,
      sourceId,
      currency:String(row.currency),
      sourceStatus:String(row.status),
      sourceLabel:String(row.receipt_number),
      purchaseOrderId:Number(row.purchase_order_id),
      purchaseOrderNumber:String(row.po_number),
      supplierId:Number(row.supplier_id),
      supplierName:String(row.supplier_name_snapshot),
      locationId:Number(row.location_id),
      occurredAt:row.received_at,
      lineCount:Number(totals[0]?.line_count||0),
      quantityTotal:Number(totals[0]?.quantity_total||0),
      baseCostMinor:Number(totals[0]?.base_cost_minor||0),
      baseCostKnown:true
    };
  }

  const rows=await db`
    SELECT
      r.id,r.run_code,r.status,r.completed_at,
      v.id AS specification_version_id,v.version_no,
      s.id AS specification_id,s.code AS specification_code,
      COALESCE(s.product_id,spv.product_id) AS product_id,
      p.name AS product_name,
      ml.id AS manufacturer_link_id,m.id AS manufacturer_id,m.name AS manufacturer_name
    FROM production_runs r
    JOIN product_specification_versions v ON v.id=r.product_specification_version_id
    JOIN product_specifications s ON s.id=v.specification_id
    LEFT JOIN product_variants spv ON spv.id=s.variant_id
    JOIN products p ON p.id=COALESCE(s.product_id,spv.product_id)
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    WHERE r.id=${sourceId}
    LIMIT 1`;
  if(!rows.length)return {error:"production_run_not_found" as const,status:404};
  const row=rows[0];
  const totals=await db`
    SELECT
      COUNT(*) FILTER(WHERE status='COMPLETED')::int AS line_count,
      COALESCE(SUM(produced_quantity) FILTER(WHERE status='COMPLETED'),0)::bigint AS quantity_total
    FROM production_lots
    WHERE production_run_id=${sourceId}`;
  return {
    sourceType,
    sourceId,
    currency:null,
    sourceStatus:String(row.status),
    sourceLabel:String(row.run_code),
    productId:Number(row.product_id),
    productName:String(row.product_name),
    specificationId:Number(row.specification_id),
    specificationVersionId:Number(row.specification_version_id),
    specificationVersionNo:Number(row.version_no),
    specificationCode:String(row.specification_code),
    manufacturerLinkId:Number(row.manufacturer_link_id),
    manufacturerId:Number(row.manufacturer_id),
    manufacturerName:String(row.manufacturer_name),
    occurredAt:row.completed_at,
    lineCount:Number(totals[0]?.line_count||0),
    quantityTotal:Number(totals[0]?.quantity_total||0),
    baseCostMinor:null,
    baseCostKnown:false
  };
}

async function caseRow(db:DB,id:number){
  const rows=await db`
    SELECT
      c.id,c.case_code,c.source_type,c.goods_receipt_id,c.production_run_id,
      c.currency,c.status,c.allocation_method,c.notes,
      c.finalized_by_user_id,finalizer.display_name AS finalized_by_display_name,
      c.finalized_at,
      c.created_by_user_id,creator.display_name AS created_by_display_name,
      c.updated_by_user_id,updater.display_name AS updated_by_display_name,
      c.created_at,c.updated_at
    FROM landed_cost_cases c
    LEFT JOIN staff_users finalizer ON finalizer.id=c.finalized_by_user_id
    LEFT JOIN staff_users creator ON creator.id=c.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=c.updated_by_user_id
    WHERE c.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

async function componentRows(db:DB,caseId:number){
  return db`
    SELECT
      id,case_id,component_type,amount_minor,description,active,
      created_by_user_id,updated_by_user_id,created_at,updated_at
    FROM landed_cost_components
    WHERE case_id=${caseId}
    ORDER BY active DESC,id`;
}

async function allocationRows(db:DB,caseId:number){
  return db`
    SELECT
      a.id,a.case_id,a.target_type,a.goods_receipt_item_id,a.production_lot_id,
      a.allocated_cost_minor,a.quantity_snapshot,a.base_unit_cost_minor,
      a.base_cost_minor,a.currency,a.notes,a.created_at,a.updated_at,
      gri.variant_id AS receipt_variant_id,
      po_item.sku_snapshot AS receipt_sku,
      po_item.product_name_snapshot AS receipt_product_name,
      pl.variant_id AS production_variant_id,pv.sku AS production_sku,
      p.name AS production_product_name,pl.lot_code
    FROM landed_cost_allocations a
    LEFT JOIN goods_receipt_items gri ON gri.id=a.goods_receipt_item_id
    LEFT JOIN purchase_order_items po_item ON po_item.id=gri.purchase_order_item_id
    LEFT JOIN production_lots pl ON pl.id=a.production_lot_id
    LEFT JOIN product_variants pv ON pv.id=pl.variant_id
    LEFT JOIN products p ON p.id=pv.product_id
    WHERE a.case_id=${caseId}
    ORDER BY a.id`;
}

function mapComponent(row:any){
  return {
    id:Number(row.id),
    caseId:Number(row.case_id),
    componentType:row.component_type,
    amountMinor:Number(row.amount_minor),
    description:row.description||null,
    active:Boolean(row.active),
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

function mapAllocation(row:any){
  const quantity=Number(row.quantity_snapshot);
  const baseCost=row.base_cost_minor==null?null:Number(row.base_cost_minor);
  const allocated=Number(row.allocated_cost_minor);
  const total=baseCost==null?allocated:baseCost+allocated;
  return {
    id:Number(row.id),
    caseId:Number(row.case_id),
    targetType:row.target_type,
    targetId:row.target_type==="GOODS_RECEIPT_ITEM"
      ?Number(row.goods_receipt_item_id)
      :Number(row.production_lot_id),
    variantId:row.target_type==="GOODS_RECEIPT_ITEM"
      ?Number(row.receipt_variant_id)
      :Number(row.production_variant_id),
    sku:row.target_type==="GOODS_RECEIPT_ITEM"
      ?row.receipt_sku
      :row.production_sku,
    productName:row.target_type==="GOODS_RECEIPT_ITEM"
      ?row.receipt_product_name
      :row.production_product_name,
    lotCode:row.lot_code||null,
    allocatedCostMinor:allocated,
    quantitySnapshot:quantity,
    baseUnitCostMinor:row.base_unit_cost_minor==null?null:Number(row.base_unit_cost_minor),
    baseCostMinor:baseCost,
    totalCostMinor:total,
    exactUnitTotalCostMinor:quantity>0&&total%quantity===0?total/quantity:null,
    unitCostRemainderMinor:quantity>0?total%quantity:null,
    currency:row.currency,
    notes:row.notes||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

async function sourceLines(db:DB,row:any){
  if(row.source_type==="GOODS_RECEIPT"){
    const rows=await db`
      SELECT
        gri.id AS target_id,gri.variant_id,gri.quantity_received,
        gri.unit_cost_minor,gri.currency,
        po_item.sku_snapshot,po_item.product_name_snapshot
      FROM goods_receipt_items gri
      JOIN purchase_order_items po_item ON po_item.id=gri.purchase_order_item_id
      WHERE gri.goods_receipt_id=${Number(row.goods_receipt_id)}
      ORDER BY gri.id`;
    return rows.map((x:any)=>({
      targetType:"GOODS_RECEIPT_ITEM",
      targetId:Number(x.target_id),
      variantId:Number(x.variant_id),
      sku:x.sku_snapshot,
      productName:x.product_name_snapshot,
      lotCode:null,
      quantity:Number(x.quantity_received),
      baseUnitCostMinor:Number(x.unit_cost_minor),
      baseCostMinor:Number(x.unit_cost_minor)*Number(x.quantity_received),
      currency:x.currency
    }));
  }

  const rows=await db`
    SELECT
      l.id AS target_id,l.variant_id,l.lot_code,l.produced_quantity,
      pv.sku,p.name AS product_name
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE l.production_run_id=${Number(row.production_run_id)}
      AND l.status='COMPLETED'
      AND l.produced_quantity>0
    ORDER BY l.id`;
  return rows.map((x:any)=>({
    targetType:"PRODUCTION_LOT",
    targetId:Number(x.target_id),
    variantId:Number(x.variant_id),
    sku:x.sku,
    productName:x.product_name,
    lotCode:x.lot_code,
    quantity:Number(x.produced_quantity),
    baseUnitCostMinor:null,
    baseCostMinor:null,
    currency:row.currency
  }));
}

async function mapCase(db:DB,row:any){
  const source:any=await sourceContext(
    db,
    String(row.source_type),
    row.source_type==="GOODS_RECEIPT"
      ?Number(row.goods_receipt_id)
      :Number(row.production_run_id)
  );
  const components=(await componentRows(db,Number(row.id))).map(mapComponent);
  const allocations=(await allocationRows(db,Number(row.id))).map(mapAllocation);
  const componentTotalMinor=components
    .filter((x:any)=>x.active)
    .reduce((sum:number,x:any)=>sum+x.amountMinor,0);
  const allocatedTotalMinor=allocations.reduce(
    (sum:number,x:any)=>sum+x.allocatedCostMinor,0
  );
  const sourceBaseCostMinor=source?.baseCostKnown?Number(source.baseCostMinor||0):null;
  return {
    id:Number(row.id),
    caseCode:row.case_code,
    sourceType:row.source_type,
    source,
    currency:row.currency,
    status:row.status,
    allocationMethod:row.allocation_method,
    notes:row.notes||null,
    finalizedBy:row.finalized_by_user_id==null?null:{
      userId:Number(row.finalized_by_user_id),
      displayName:row.finalized_by_display_name||null
    },
    finalizedAt:row.finalized_at||null,
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
    totals:{
      sourceBaseCostMinor,
      landedComponentsMinor:componentTotalMinor,
      allocatedMinor:allocatedTotalMinor,
      allocationDeltaMinor:componentTotalMinor-allocatedTotalMinor,
      totalCostMinor:sourceBaseCostMinor==null
        ?componentTotalMinor
        :sourceBaseCostMinor+componentTotalMinor
    },
    components,
    allocations,
    inventoryChanged:false,
    sourceCostRewritten:false,
    fxConversionApplied:false
  };
}

async function fullSnapshot(db:DB,caseId:number){
  const row=await caseRow(db,caseId);
  return row?await mapCase(db,row):null;
}

async function appendHistory(
  tx:DB,
  caseId:number,
  actor:any,
  action:string,
  note:string|null
){
  const a=actorFields(actor);
  const snapshot=await fullSnapshot(tx,caseId);
  await tx`
    INSERT INTO landed_cost_history(
      case_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${caseId},${a.userId},${a.service},${action},
      ${JSON.stringify(snapshot)}::jsonb,${note}
    )`;
}

async function history(db:DB,caseId:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM landed_cost_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.case_id=${caseId}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ?{type:"SERVICE",service:row.actor_service}
      :{type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function listSources(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"landed_cost.read");
  if(!auth.ok)return auth.response;

  const receipts=await db`
    SELECT
      gr.id,gr.receipt_number,gr.received_at,po.currency,
      po.po_number,po.supplier_name_snapshot,
      COUNT(gri.id)::int AS line_count,
      COALESCE(SUM(gri.quantity_received),0)::bigint AS quantity_total,
      COALESCE(SUM(gri.quantity_received*gri.unit_cost_minor),0)::bigint AS base_cost_minor,
      existing.id AS landed_cost_case_id
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id=gr.purchase_order_id
    LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id
    LEFT JOIN landed_cost_cases existing ON existing.goods_receipt_id=gr.id
    WHERE gr.status='POSTED'
    GROUP BY gr.id,gr.receipt_number,gr.received_at,po.currency,po.po_number,
      po.supplier_name_snapshot,existing.id
    ORDER BY gr.received_at DESC,gr.id DESC
    LIMIT 200`;

  const runs=await db`
    SELECT
      r.id,r.run_code,r.completed_at,
      p.name AS product_name,m.name AS manufacturer_name,
      COUNT(pl.id) FILTER(WHERE pl.status='COMPLETED')::int AS lot_count,
      COALESCE(SUM(pl.produced_quantity) FILTER(WHERE pl.status='COMPLETED'),0)::bigint AS quantity_total,
      existing.id AS landed_cost_case_id
    FROM production_runs r
    JOIN product_specification_versions sv ON sv.id=r.product_specification_version_id
    JOIN product_specifications ps ON ps.id=sv.specification_id
    LEFT JOIN product_variants specv ON specv.id=ps.variant_id
    JOIN products p ON p.id=COALESCE(ps.product_id,specv.product_id)
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    LEFT JOIN production_lots pl ON pl.production_run_id=r.id
    LEFT JOIN landed_cost_cases existing ON existing.production_run_id=r.id
    WHERE r.status='COMPLETED'
    GROUP BY r.id,r.run_code,r.completed_at,p.name,m.name,existing.id
    ORDER BY r.completed_at DESC,r.id DESC
    LIMIT 200`;

  return json({
    goodsReceipts:receipts.map((x:any)=>({
      sourceType:"GOODS_RECEIPT",
      sourceId:Number(x.id),
      label:x.receipt_number,
      purchaseOrderNumber:x.po_number,
      supplierName:x.supplier_name_snapshot,
      currency:x.currency,
      lineCount:Number(x.line_count),
      quantityTotal:Number(x.quantity_total),
      baseCostMinor:Number(x.base_cost_minor),
      occurredAt:x.received_at,
      landedCostCaseId:x.landed_cost_case_id==null?null:Number(x.landed_cost_case_id)
    })),
    productionRuns:runs.map((x:any)=>({
      sourceType:"PRODUCTION_RUN",
      sourceId:Number(x.id),
      label:x.run_code,
      productName:x.product_name,
      manufacturerName:x.manufacturer_name,
      currency:null,
      lineCount:Number(x.lot_count),
      quantityTotal:Number(x.quantity_total),
      baseCostMinor:null,
      occurredAt:x.completed_at,
      landedCostCaseId:x.landed_cost_case_id==null?null:Number(x.landed_cost_case_id)
    }))
  });
}

async function listCases(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"landed_cost.read");
  if(!auth.ok)return auth.response;

  const status=clean(url.searchParams.get("status"),20).toUpperCase();
  const sourceType=clean(url.searchParams.get("sourceType"),30).toUpperCase();
  if(status&&!["DRAFT","FINAL"].includes(status))return json({error:"invalid_status"},400);
  if(sourceType&&!SOURCE_TYPES.has(sourceType))return json({error:"invalid_source_type"},400);

  const rows=await db`
    SELECT
      c.id,c.case_code,c.source_type,c.goods_receipt_id,c.production_run_id,
      c.currency,c.status,c.allocation_method,c.notes,
      c.finalized_by_user_id,finalizer.display_name AS finalized_by_display_name,
      c.finalized_at,c.created_by_user_id,creator.display_name AS created_by_display_name,
      c.updated_by_user_id,updater.display_name AS updated_by_display_name,
      c.created_at,c.updated_at
    FROM landed_cost_cases c
    LEFT JOIN staff_users finalizer ON finalizer.id=c.finalized_by_user_id
    LEFT JOIN staff_users creator ON creator.id=c.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=c.updated_by_user_id
    WHERE (${status||null}::text IS NULL OR c.status=${status||null}::text)
      AND (${sourceType||null}::text IS NULL OR c.source_type=${sourceType||null}::text)
    ORDER BY CASE c.status WHEN 'DRAFT' THEN 0 ELSE 1 END,c.updated_at DESC,c.id DESC
    LIMIT 200`;

  const data=[];
  for(const row of rows)data.push(await mapCase(db,row));
  return json({data});
}

async function createCase(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const caseCode=cleanCode(body?.caseCode);
  const sourceType=clean(body?.sourceType,30).toUpperCase();
  const sourceId=Number(body?.sourceId);
  const notes=clean(body?.notes,4000)||null;

  if(caseCode.length<3)return json({error:"invalid_case_code"},400);
  if(!SOURCE_TYPES.has(sourceType))return json({error:"invalid_source_type"},400);
  if(!Number.isSafeInteger(sourceId)||sourceId<1)return json({error:"invalid_source"},400);

  const source:any=await sourceContext(db,sourceType,sourceId);
  if(source.error)return json({error:source.error},source.status||400);

  let currency="";
  if(sourceType==="GOODS_RECEIPT"){
    if(source.sourceStatus!=="POSTED")return json({error:"goods_receipt_not_posted"},409);
    currency=String(source.currency);
    const requested=body?.currency==null?"":currencyCode(body.currency);
    if(body?.currency!=null&&!requested)return json({error:"invalid_currency"},400);
    if(requested&&requested!==currency)return json({error:"source_currency_mismatch"},409);
  }else{
    if(source.sourceStatus!=="COMPLETED")return json({error:"production_run_not_completed"},409);
    if(Number(source.quantityTotal)<=0)return json({error:"completed_production_lot_required"},409);
    currency=currencyCode(body?.currency);
    if(!currency)return json({error:"currency_required"},400);
  }

  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO landed_cost_cases(
          case_code,source_type,goods_receipt_id,production_run_id,
          currency,status,allocation_method,notes,
          created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${caseCode},${sourceType},
          ${sourceType==="GOODS_RECEIPT"?sourceId:null},
          ${sourceType==="PRODUCTION_RUN"?sourceId:null},
          ${currency},'DRAFT','MANUAL',${notes},
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendHistory(tx,id,auth.actor,"CREATED",notes);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"landed_cost_case.created",
        resourceType:"LandedCostCase",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          caseCode,sourceType,sourceId,currency,
          allocationMethod:"MANUAL",
          inventoryChanged:false,
          sourceCostRewritten:false,
          fxConversionApplied:false
        }
      });
      return {id};
    });

    return json({
      landedCostCase:await mapCase(db,await caseRow(db,result.id)),
      inventoryChanged:false,
      sourceCostRewritten:false,
      fxConversionApplied:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"landed_cost_case_exists"},409);
    }
    throw error;
  }
}

async function getCase(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.read");
  if(!auth.ok)return auth.response;
  const row=await caseRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    landedCostCase:await mapCase(db,row),
    sourceLines:await sourceLines(db,row),
    history:await history(db,id)
  });
}

async function updateCase(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  const existing=await caseRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  if(existing.status!=="DRAFT")return json({error:"final_case_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const notes=body?.notes==null?existing.notes:(clean(body.notes,4000)||null);
  const changeNote=clean(body?.changeNote,1000)||null;

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE landed_cost_cases
      SET notes=${notes},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id} AND status='DRAFT'`;
    await appendHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_case.updated",
      resourceType:"LandedCostCase",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{inventoryChanged:false,sourceCostRewritten:false}
    });
  });

  return json({landedCostCase:await mapCase(db,await caseRow(db,id))});
}

async function createComponent(req:Request,db:DB,caseId:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const componentType=clean(body?.componentType,40).toUpperCase();
  const amountMinor=moneyInt(body?.amountMinor);
  const description=clean(body?.description,1000)||null;
  if(!COMPONENT_TYPES.has(componentType))return json({error:"invalid_component_type"},400);
  if(amountMinor==null)return json({error:"invalid_amount"},400);

  const result:any=await db.begin(async(tx:DB)=>{
    const cases=await tx`
      SELECT id,status,currency
      FROM landed_cost_cases
      WHERE id=${caseId}
      FOR UPDATE`;
    if(!cases.length)return {error:"case_not_found",status:404};
    if(cases[0].status!=="DRAFT")return {error:"final_case_immutable",status:409};

    const rows=await tx`
      INSERT INTO landed_cost_components(
        case_id,component_type,amount_minor,description,active,
        created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${caseId},${componentType},${amountMinor},${description},TRUE,
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    await appendHistory(tx,caseId,auth.actor,"COMPONENT_CREATED",description);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_component.created",
      resourceType:"LandedCostComponent",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        caseId,componentType,amountMinor,currency:cases[0].currency,
        fxConversionApplied:false
      }
    });
    return {id};
  });

  if(result.error)return json({error:result.error},result.status||409);
  const row=(await componentRows(db,caseId)).find((x:any)=>Number(x.id)===result.id);
  return json({component:mapComponent(row)},201);
}

async function updateComponent(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const note=clean(body?.changeNote,1000)||null;

  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT cc.*,c.status AS case_status
      FROM landed_cost_components cc
      JOIN landed_cost_cases c ON c.id=cc.case_id
      WHERE cc.id=${id}
      FOR UPDATE OF cc,c`;
    if(!rows.length)return {error:"not_found",status:404};
    const current=rows[0];
    if(current.case_status!=="DRAFT")return {error:"final_case_immutable",status:409};

    const componentType=body?.componentType==null
      ?current.component_type
      :clean(body.componentType,40).toUpperCase();
    const amountMinor=body?.amountMinor==null
      ?Number(current.amount_minor)
      :moneyInt(body.amountMinor);
    const description=body?.description==null
      ?current.description
      :(clean(body.description,1000)||null);
    const active=body?.active==null?Boolean(current.active):body.active===true;

    if(!COMPONENT_TYPES.has(componentType))return {error:"invalid_component_type",status:400};
    if(amountMinor==null)return {error:"invalid_amount",status:400};

    await tx`
      UPDATE landed_cost_components
      SET component_type=${componentType},amount_minor=${amountMinor},
          description=${description},active=${active},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendHistory(tx,Number(current.case_id),auth.actor,"COMPONENT_UPDATED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_component.updated",
      resourceType:"LandedCostComponent",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{caseId:Number(current.case_id),componentType,amountMinor,active}
    });
    return {caseId:Number(current.case_id)};
  });

  if(result.error)return json({error:result.error},result.status||409);
  const row=(await componentRows(db,result.caseId)).find((x:any)=>Number(x.id)===id);
  return json({component:mapComponent(row)});
}

async function resolveAllocationTarget(db:DB,c:any,targetId:number){
  if(c.source_type==="GOODS_RECEIPT"){
    const rows=await db`
      SELECT
        gri.id,gri.goods_receipt_id,gri.variant_id,gri.quantity_received,
        gri.unit_cost_minor,gri.currency,
        poi.sku_snapshot,poi.product_name_snapshot
      FROM goods_receipt_items gri
      JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id
      WHERE gri.id=${targetId}
      LIMIT 1`;
    if(!rows.length)return {error:"goods_receipt_item_not_found" as const,status:404};
    const row=rows[0];
    if(Number(row.goods_receipt_id)!==Number(c.goods_receipt_id)){
      return {error:"allocation_target_mismatch" as const,status:409};
    }
    if(String(row.currency)!==String(c.currency)){
      return {error:"source_currency_mismatch" as const,status:409};
    }
    const quantity=Number(row.quantity_received);
    return {
      targetType:"GOODS_RECEIPT_ITEM",
      goodsReceiptItemId:targetId,
      productionLotId:null,
      quantity,
      baseUnitCostMinor:Number(row.unit_cost_minor),
      baseCostMinor:Number(row.unit_cost_minor)*quantity,
      currency:String(row.currency)
    };
  }

  const rows=await db`
    SELECT id,production_run_id,variant_id,status,produced_quantity
    FROM production_lots
    WHERE id=${targetId}
    LIMIT 1`;
  if(!rows.length)return {error:"production_lot_not_found" as const,status:404};
  const row=rows[0];
  if(Number(row.production_run_id)!==Number(c.production_run_id)){
    return {error:"allocation_target_mismatch" as const,status:409};
  }
  if(row.status!=="COMPLETED"||Number(row.produced_quantity)<=0){
    return {error:"completed_production_lot_required" as const,status:409};
  }
  return {
    targetType:"PRODUCTION_LOT",
    goodsReceiptItemId:null,
    productionLotId:targetId,
    quantity:Number(row.produced_quantity),
    baseUnitCostMinor:null,
    baseCostMinor:null,
    currency:String(c.currency)
  };
}

async function createAllocation(req:Request,db:DB,caseId:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const targetId=Number(body?.targetId);
  const allocatedCostMinor=moneyInt(body?.allocatedCostMinor);
  const notes=clean(body?.notes,1000)||null;
  if(!Number.isSafeInteger(targetId)||targetId<1)return json({error:"invalid_target"},400);
  if(allocatedCostMinor==null)return json({error:"invalid_amount"},400);

  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const cases=await tx`
        SELECT *
        FROM landed_cost_cases
        WHERE id=${caseId}
        FOR UPDATE`;
      if(!cases.length)return {error:"case_not_found",status:404};
      const c=cases[0];
      if(c.status!=="DRAFT")return {error:"final_case_immutable",status:409};

      const target:any=await resolveAllocationTarget(tx,c,targetId);
      if(target.error)return {error:target.error,status:target.status||400};

      const rows=await tx`
        INSERT INTO landed_cost_allocations(
          case_id,target_type,goods_receipt_item_id,production_lot_id,
          allocated_cost_minor,quantity_snapshot,base_unit_cost_minor,base_cost_minor,
          currency,notes,created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${caseId},${target.targetType},${target.goodsReceiptItemId},${target.productionLotId},
          ${allocatedCostMinor},${target.quantity},${target.baseUnitCostMinor},${target.baseCostMinor},
          ${target.currency},${notes},
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendHistory(tx,caseId,auth.actor,"ALLOCATION_CREATED",notes);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"landed_cost_allocation.created",
        resourceType:"LandedCostAllocation",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          caseId,targetType:target.targetType,targetId,allocatedCostMinor,
          quantitySnapshot:target.quantity,currency:target.currency,
          inventoryChanged:false,sourceCostRewritten:false
        }
      });
      return {id};
    });

    if(result.error)return json({error:result.error},result.status||409);
    const row=(await allocationRows(db,caseId)).find((x:any)=>Number(x.id)===result.id);
    return json({allocation:mapAllocation(row)},201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"allocation_exists"},409);
    }
    throw error;
  }
}

async function updateAllocation(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const note=clean(body?.changeNote,1000)||null;

  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT a.*,c.status AS case_status
      FROM landed_cost_allocations a
      JOIN landed_cost_cases c ON c.id=a.case_id
      WHERE a.id=${id}
      FOR UPDATE OF a,c`;
    if(!rows.length)return {error:"not_found",status:404};
    const current=rows[0];
    if(current.case_status!=="DRAFT")return {error:"final_case_immutable",status:409};

    const allocatedCostMinor=body?.allocatedCostMinor==null
      ?Number(current.allocated_cost_minor)
      :moneyInt(body.allocatedCostMinor);
    const notes=body?.notes==null?current.notes:(clean(body.notes,1000)||null);
    if(allocatedCostMinor==null)return {error:"invalid_amount",status:400};

    await tx`
      UPDATE landed_cost_allocations
      SET allocated_cost_minor=${allocatedCostMinor},notes=${notes},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendHistory(tx,Number(current.case_id),auth.actor,"ALLOCATION_UPDATED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_allocation.updated",
      resourceType:"LandedCostAllocation",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        caseId:Number(current.case_id),allocatedCostMinor,
        inventoryChanged:false,sourceCostRewritten:false
      }
    });
    return {caseId:Number(current.case_id)};
  });

  if(result.error)return json({error:result.error},result.status||409);
  const row=(await allocationRows(db,result.caseId)).find((x:any)=>Number(x.id)===id);
  return json({allocation:mapAllocation(row)});
}

async function finalizeCase(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.finalize",{mutation:true});
  if(!auth.ok)return auth.response;
  if(auth.actor.type!=="USER")return json({error:"human_finalization_required"},403);

  let body:any={};
  try{body=await req.json();}catch{}
  const note=clean(body?.note,1000)||null;

  const result:any=await db.begin(async(tx:DB)=>{
    const cases=await tx`
      SELECT *
      FROM landed_cost_cases
      WHERE id=${id}
      FOR UPDATE`;
    if(!cases.length)return {error:"not_found",status:404};
    const c=cases[0];
    if(c.status!=="DRAFT")return {error:"case_not_finalizable",status:409};

    const source:any=await sourceContext(
      tx,
      String(c.source_type),
      c.source_type==="GOODS_RECEIPT"
        ?Number(c.goods_receipt_id)
        :Number(c.production_run_id)
    );
    if(source.error)return source;
    if(c.source_type==="GOODS_RECEIPT"&&source.sourceStatus!=="POSTED"){
      return {error:"goods_receipt_not_posted",status:409};
    }
    if(c.source_type==="PRODUCTION_RUN"&&source.sourceStatus!=="COMPLETED"){
      return {error:"production_run_not_completed",status:409};
    }

    const componentTotals=await tx`
      SELECT COALESCE(SUM(amount_minor) FILTER(WHERE active),0)::bigint AS total
      FROM landed_cost_components
      WHERE case_id=${id}`;
    const allocationTotals=await tx`
      SELECT COALESCE(SUM(allocated_cost_minor),0)::bigint AS total
      FROM landed_cost_allocations
      WHERE case_id=${id}`;
    const componentTotal=Number(componentTotals[0]?.total||0);
    const allocationTotal=Number(allocationTotals[0]?.total||0);

    if(componentTotal!==allocationTotal){
      return {
        error:"allocation_total_mismatch",
        status:409,
        componentTotalMinor:componentTotal,
        allocatedTotalMinor:allocationTotal,
        deltaMinor:componentTotal-allocationTotal
      };
    }

    const lines=await sourceLines(tx,c);
    if(!lines.length)return {error:"source_lines_required",status:409};

    const allocations=await tx`
      SELECT
        goods_receipt_item_id,production_lot_id,quantity_snapshot,
        base_unit_cost_minor,base_cost_minor,currency
      FROM landed_cost_allocations
      WHERE case_id=${id}`;

    if(allocations.length!==lines.length){
      return {
        error:"complete_allocation_coverage_required",
        status:409,
        eligibleLineCount:lines.length,
        allocationCount:allocations.length
      };
    }

    for(const allocation of allocations){
      const targetId=c.source_type==="GOODS_RECEIPT"
        ?Number(allocation.goods_receipt_item_id)
        :Number(allocation.production_lot_id);
      const currentLine=lines.find((x:any)=>Number(x.targetId)===targetId);
      if(!currentLine)return {error:"allocation_target_stale",status:409,targetId};
      if(Number(allocation.quantity_snapshot)!==Number(currentLine.quantity)){
        return {error:"allocation_quantity_stale",status:409,targetId};
      }

      const snapshotBaseUnit=allocation.base_unit_cost_minor==null
        ?null
        :Number(allocation.base_unit_cost_minor);
      const currentBaseUnit=currentLine.baseUnitCostMinor==null
        ?null
        :Number(currentLine.baseUnitCostMinor);
      const snapshotBaseCost=allocation.base_cost_minor==null
        ?null
        :Number(allocation.base_cost_minor);
      const currentBaseCost=currentLine.baseCostMinor==null
        ?null
        :Number(currentLine.baseCostMinor);

      if(snapshotBaseUnit!==currentBaseUnit||snapshotBaseCost!==currentBaseCost){
        return {
          error:"allocation_base_cost_stale",
          status:409,
          targetId,
          snapshotBaseUnitCostMinor:snapshotBaseUnit,
          currentBaseUnitCostMinor:currentBaseUnit,
          snapshotBaseCostMinor:snapshotBaseCost,
          currentBaseCostMinor:currentBaseCost
        };
      }

      if(String(allocation.currency)!==String(c.currency)){
        return {error:"allocation_currency_mismatch",status:409,targetId};
      }
    }

    await tx`
      UPDATE landed_cost_cases
      SET status='FINAL',
          finalized_by_user_id=${auth.actor.userId},
          finalized_at=NOW(),
          updated_by_user_id=${auth.actor.userId},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendHistory(tx,id,auth.actor,"FINALIZED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_case.finalized",
      resourceType:"LandedCostCase",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        sourceType:c.source_type,
        sourceId:c.source_type==="GOODS_RECEIPT"
          ?Number(c.goods_receipt_id)
          :Number(c.production_run_id),
        currency:c.currency,
        componentTotalMinor:componentTotal,
        allocatedTotalMinor:allocationTotal,
        sourceBaseCostMinor:source.baseCostKnown?Number(source.baseCostMinor||0):null,
        inventoryChanged:false,
        sourceCostRewritten:false,
        fxConversionApplied:false
      }
    });
    return {ok:true};
  });

  if(result.error)return json(result,result.status||409);
  return json({
    landedCostCase:await mapCase(db,await caseRow(db,id)),
    inventoryChanged:false,
    sourceCostRewritten:false,
    fxConversionApplied:false
  });
}

export async function handleLandedCost(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/landed-cost/sources"&&req.method==="GET"){
    return listSources(req,db);
  }

  if(url.pathname==="/v1/internal/landed-cost/cases"){
    if(req.method==="GET")return listCases(req,url,db);
    if(req.method==="POST")return createCase(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const finalize=url.pathname.match(/^\/v1\/internal\/landed-cost\/cases\/(\d+)\/finalize$/);
  if(finalize){
    if(req.method==="POST")return finalizeCase(req,db,Number(finalize[1]));
    return json({error:"method_not_allowed"},405);
  }

  const components=url.pathname.match(/^\/v1\/internal\/landed-cost\/cases\/(\d+)\/components$/);
  if(components){
    if(req.method==="POST")return createComponent(req,db,Number(components[1]));
    return json({error:"method_not_allowed"},405);
  }

  const allocations=url.pathname.match(/^\/v1\/internal\/landed-cost\/cases\/(\d+)\/allocations$/);
  if(allocations){
    if(req.method==="POST")return createAllocation(req,db,Number(allocations[1]));
    return json({error:"method_not_allowed"},405);
  }

  const caseMatch=url.pathname.match(/^\/v1\/internal\/landed-cost\/cases\/(\d+)$/);
  if(caseMatch){
    const id=Number(caseMatch[1]);
    if(req.method==="GET")return getCase(req,db,id);
    if(req.method==="PATCH")return updateCase(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  const componentMatch=url.pathname.match(/^\/v1\/internal\/landed-cost\/components\/(\d+)$/);
  if(componentMatch){
    if(req.method==="PATCH")return updateComponent(req,db,Number(componentMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  const allocationMatch=url.pathname.match(/^\/v1\/internal\/landed-cost\/allocations\/(\d+)$/);
  if(allocationMatch){
    if(req.method==="PATCH")return updateAllocation(req,db,Number(allocationMatch[1]));
    return json({error:"method_not_allowed"},405);
  }

  if(url.pathname.startsWith("/v1/internal/landed-cost/")){
    return json({error:"not_found"},404);
  }

  return null;
}
