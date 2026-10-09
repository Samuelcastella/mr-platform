import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const SOURCE_TYPES = new Set(["GOODS_RECEIPT","PRODUCTION_RUN"]);
const COMPONENT_TYPES = new Set([
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
  return typeof value==="string" ? value.trim().slice(0,max) : "";
}

function normalizeCode(value:unknown,max=100){
  return clean(value,max).toUpperCase().replace(/[^A-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
}

function currencyCode(value:unknown){
  const code=clean(value,3).toUpperCase();
  return /^[A-Z]{3}$/.test(code)?code:"";
}

function nonNegativeInt(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}

function positiveInt(value:unknown){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}

function actorFields(actor:any){
  return actor.type==="USER"
    ? {userId:actor.userId,service:null}
    : {userId:null,service:actor.service};
}

function parseJson(value:any){
  if(value==null)return {};
  if(typeof value==="string"){
    try{return JSON.parse(value);}catch{return {};}
  }
  return value;
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
      created_by_service TEXT,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_service TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_type IN ('GOODS_RECEIPT','PRODUCTION_RUN')),
      CHECK (status IN ('DRAFT','FINAL')),
      CHECK (allocation_method='MANUAL'),
      CHECK (
        (source_type='GOODS_RECEIPT' AND goods_receipt_id IS NOT NULL AND production_run_id IS NULL)
        OR
        (source_type='PRODUCTION_RUN' AND goods_receipt_id IS NULL AND production_run_id IS NOT NULL)
      ),
      CHECK (
        (created_by_user_id IS NOT NULL AND created_by_service IS NULL)
        OR
        (created_by_user_id IS NULL AND created_by_service IS NOT NULL)
      ),
      CHECK (
        (updated_by_user_id IS NOT NULL AND updated_by_service IS NULL)
        OR
        (updated_by_user_id IS NULL AND updated_by_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_cost_case_receipt_unique
    ON landed_cost_cases(goods_receipt_id)
    WHERE goods_receipt_id IS NOT NULL`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_cost_case_production_unique
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
      amount_minor BIGINT NOT NULL,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_by_service TEXT,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_service TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        component_type IN (
          'FREIGHT','DUTY','BROKERAGE','INSURANCE',
          'LOCAL_TRANSPORT','PACKAGING','MANUFACTURING','OTHER'
        )
      ),
      CHECK (amount_minor >= 0),
      CHECK (
        (created_by_user_id IS NOT NULL AND created_by_service IS NULL)
        OR
        (created_by_user_id IS NULL AND created_by_service IS NOT NULL)
      ),
      CHECK (
        (updated_by_user_id IS NOT NULL AND updated_by_service IS NULL)
        OR
        (updated_by_user_id IS NULL AND updated_by_service IS NOT NULL)
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
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      quantity_snapshot INTEGER NOT NULL,
      base_unit_cost_minor BIGINT,
      base_cost_minor BIGINT,
      allocated_cost_minor BIGINT NOT NULL,
      currency CHAR(3) NOT NULL,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_by_service TEXT,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_service TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (target_type IN ('GOODS_RECEIPT_ITEM','PRODUCTION_LOT')),
      CHECK (quantity_snapshot >= 0),
      CHECK (base_unit_cost_minor IS NULL OR base_unit_cost_minor >= 0),
      CHECK (base_cost_minor IS NULL OR base_cost_minor >= 0),
      CHECK (allocated_cost_minor >= 0),
      CHECK (
        (target_type='GOODS_RECEIPT_ITEM' AND goods_receipt_item_id IS NOT NULL AND production_lot_id IS NULL)
        OR
        (target_type='PRODUCTION_LOT' AND goods_receipt_item_id IS NULL AND production_lot_id IS NOT NULL)
      ),
      CHECK (
        (created_by_user_id IS NOT NULL AND created_by_service IS NULL)
        OR
        (created_by_user_id IS NULL AND created_by_service IS NOT NULL)
      ),
      CHECK (
        (updated_by_user_id IS NOT NULL AND updated_by_service IS NULL)
        OR
        (updated_by_user_id IS NULL AND updated_by_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_alloc_receipt_item_unique
    ON landed_cost_allocations(case_id,goods_receipt_item_id)
    WHERE goods_receipt_item_id IS NOT NULL`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landed_alloc_production_lot_unique
    ON landed_cost_allocations(case_id,production_lot_id)
    WHERE production_lot_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_case
    ON landed_cost_allocations(case_id,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_case_history (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES landed_cost_cases(id) ON DELETE RESTRICT,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (actor_user_id IS NOT NULL AND actor_service IS NULL)
        OR
        (actor_user_id IS NULL AND actor_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_component_history (
      id BIGSERIAL PRIMARY KEY,
      component_id BIGINT NOT NULL REFERENCES landed_cost_components(id) ON DELETE RESTRICT,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (actor_user_id IS NOT NULL AND actor_service IS NULL)
        OR
        (actor_user_id IS NULL AND actor_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS landed_cost_allocation_history (
      id BIGSERIAL PRIMARY KEY,
      allocation_id BIGINT NOT NULL REFERENCES landed_cost_allocations(id) ON DELETE RESTRICT,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (actor_user_id IS NOT NULL AND actor_service IS NULL)
        OR
        (actor_user_id IS NULL AND actor_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_case_history
    ON landed_cost_case_history(case_id,id)`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_component_history
    ON landed_cost_component_history(component_id,id)`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_landed_allocation_history
    ON landed_cost_allocation_history(allocation_id,id)`;
}

async function caseRow(db:DB,id:number){
  const rows=await db`
    SELECT
      c.id,c.case_code,c.source_type,c.goods_receipt_id,c.production_run_id,
      c.currency,c.status,c.allocation_method,c.notes,
      c.finalized_by_user_id,finalizer.display_name AS finalized_by_display_name,
      c.finalized_at,c.created_by_user_id,creator.display_name AS created_by_display_name,
      c.created_by_service,c.updated_by_user_id,updater.display_name AS updated_by_display_name,
      c.updated_by_service,c.created_at,c.updated_at,
      gr.receipt_number,gr.status AS receipt_status,gr.location_id AS receipt_location_id,
      po.po_number,po.supplier_name_snapshot,
      pr.run_code,pr.status AS production_run_status,
      ps.code AS specification_code,ps.title AS specification_title,
      pv_spec.version_no AS specification_version_no,
      m.name AS manufacturer_name
    FROM landed_cost_cases c
    LEFT JOIN goods_receipts gr ON gr.id=c.goods_receipt_id
    LEFT JOIN purchase_orders po ON po.id=gr.purchase_order_id
    LEFT JOIN production_runs pr ON pr.id=c.production_run_id
    LEFT JOIN product_specification_versions pv_spec
      ON pv_spec.id=pr.product_specification_version_id
    LEFT JOIN product_specifications ps ON ps.id=pv_spec.specification_id
    LEFT JOIN manufacturer_links ml ON ml.id=pr.manufacturer_link_id
    LEFT JOIN manufacturers m ON m.id=ml.manufacturer_id
    LEFT JOIN staff_users finalizer ON finalizer.id=c.finalized_by_user_id
    LEFT JOIN staff_users creator ON creator.id=c.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=c.updated_by_user_id
    WHERE c.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapCase(row:any){
  return {
    id:Number(row.id),
    caseCode:row.case_code,
    sourceType:row.source_type,
    currency:row.currency,
    status:row.status,
    allocationMethod:row.allocation_method,
    notes:row.notes||null,
    source:row.source_type==="GOODS_RECEIPT"
      ? {
          goodsReceiptId:Number(row.goods_receipt_id),
          receiptNumber:row.receipt_number,
          receiptStatus:row.receipt_status,
          locationId:row.receipt_location_id==null?null:Number(row.receipt_location_id),
          poNumber:row.po_number||null,
          supplierName:row.supplier_name_snapshot||null
        }
      : {
          productionRunId:Number(row.production_run_id),
          runCode:row.run_code,
          runStatus:row.production_run_status,
          specificationCode:row.specification_code||null,
          specificationTitle:row.specification_title||null,
          specificationVersionNo:row.specification_version_no==null?null:Number(row.specification_version_no),
          manufacturerName:row.manufacturer_name||null
        },
    finalizedBy:row.finalized_by_user_id==null?null:{
      userId:Number(row.finalized_by_user_id),
      displayName:row.finalized_by_display_name||null
    },
    finalizedAt:row.finalized_at||null,
    createdBy:row.created_by_user_id==null
      ? {type:"SERVICE",service:row.created_by_service}
      : {type:"USER",userId:Number(row.created_by_user_id),displayName:row.created_by_display_name||null},
    updatedBy:row.updated_by_user_id==null
      ? {type:"SERVICE",service:row.updated_by_service}
      : {type:"USER",userId:Number(row.updated_by_user_id),displayName:row.updated_by_display_name||null},
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    fxConversionApplied:false,
    inventoryChanged:false,
    inventorySourceChanged:false,
    sourceCostChanged:false
  };
}

function caseSnapshot(row:any){
  const c=mapCase(row);
  return {
    caseCode:c.caseCode,
    sourceType:c.sourceType,
    source:c.source,
    currency:c.currency,
    status:c.status,
    allocationMethod:c.allocationMethod,
    notes:c.notes,
    finalizedByUserId:c.finalizedBy?.userId||null,
    finalizedAt:c.finalizedAt
  };
}

async function componentRow(db:DB,id:number){
  const rows=await db`
    SELECT
      c.id,c.case_id,c.component_type,c.amount_minor,c.description,c.active,
      c.created_by_user_id,c.created_by_service,c.updated_by_user_id,c.updated_by_service,
      c.created_at,c.updated_at
    FROM landed_cost_components c
    WHERE c.id=${id}
    LIMIT 1`;
  return rows[0]||null;
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

function componentSnapshot(row:any){
  const c=mapComponent(row);
  return {
    caseId:c.caseId,
    componentType:c.componentType,
    amountMinor:c.amountMinor,
    description:c.description,
    active:c.active
  };
}

async function allocationRow(db:DB,id:number){
  const rows=await db`
    SELECT
      a.id,a.case_id,a.target_type,a.goods_receipt_item_id,a.production_lot_id,
      a.variant_id,a.quantity_snapshot,a.base_unit_cost_minor,a.base_cost_minor,
      a.allocated_cost_minor,a.currency,a.created_at,a.updated_at,
      pv.sku,pv.size,pv.color,p.name AS product_name
    FROM landed_cost_allocations a
    JOIN product_variants pv ON pv.id=a.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE a.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapAllocation(row:any){
  const quantity=Number(row.quantity_snapshot);
  const allocated=Number(row.allocated_cost_minor);
  const base=row.base_cost_minor==null?null:Number(row.base_cost_minor);
  return {
    id:Number(row.id),
    caseId:Number(row.case_id),
    targetType:row.target_type,
    goodsReceiptItemId:row.goods_receipt_item_id==null?null:Number(row.goods_receipt_item_id),
    productionLotId:row.production_lot_id==null?null:Number(row.production_lot_id),
    variant:{
      id:Number(row.variant_id),
      sku:row.sku,
      productName:row.product_name,
      size:row.size||null,
      color:row.color||null
    },
    quantitySnapshot:quantity,
    baseUnitCostMinor:row.base_unit_cost_minor==null?null:Number(row.base_unit_cost_minor),
    baseCostMinor:base,
    allocatedCostMinor:allocated,
    currency:row.currency,
    totalLandedCostMinor:base==null?allocated:base+allocated,
    unitLandedCostExact:
      quantity>0&&((base==null?allocated:base+allocated)%quantity===0)
        ? (base==null?allocated:base+allocated)/quantity
        : null,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

function allocationSnapshot(row:any){
  const a=mapAllocation(row);
  return {
    caseId:a.caseId,
    targetType:a.targetType,
    goodsReceiptItemId:a.goodsReceiptItemId,
    productionLotId:a.productionLotId,
    variantId:a.variant.id,
    quantitySnapshot:a.quantitySnapshot,
    baseUnitCostMinor:a.baseUnitCostMinor,
    baseCostMinor:a.baseCostMinor,
    allocatedCostMinor:a.allocatedCostMinor,
    currency:a.currency
  };
}

async function receiptSource(db:DB,id:number){
  const receipts=await db`
    SELECT
      gr.id,gr.receipt_number,gr.status,gr.location_id,gr.purchase_order_id,
      po.po_number,po.supplier_name_snapshot
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id=gr.purchase_order_id
    WHERE gr.id=${id}
    LIMIT 1`;
  if(!receipts.length)return null;
  const lines=await db`
    SELECT
      gri.id,gri.variant_id,gri.quantity_received,gri.unit_cost_minor,gri.currency,
      pv.sku,pv.size,pv.color,p.name AS product_name
    FROM goods_receipt_items gri
    JOIN product_variants pv ON pv.id=gri.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE gri.goods_receipt_id=${id}
    ORDER BY gri.id`;
  const currencies=[...new Set(lines.map((x:any)=>String(x.currency)))];
  return {
    id:Number(receipts[0].id),
    receiptNumber:receipts[0].receipt_number,
    status:receipts[0].status,
    locationId:Number(receipts[0].location_id),
    purchaseOrderId:Number(receipts[0].purchase_order_id),
    poNumber:receipts[0].po_number,
    supplierName:receipts[0].supplier_name_snapshot,
    currency:currencies.length===1?currencies[0]:null,
    currencyCount:currencies.length,
    lines:lines.map((row:any)=>({
      targetType:"GOODS_RECEIPT_ITEM",
      targetId:Number(row.id),
      goodsReceiptItemId:Number(row.id),
      productionLotId:null,
      variantId:Number(row.variant_id),
      sku:row.sku,
      productName:row.product_name,
      size:row.size||null,
      color:row.color||null,
      quantity:Number(row.quantity_received),
      baseUnitCostMinor:Number(row.unit_cost_minor),
      baseCostMinor:Number(row.unit_cost_minor)*Number(row.quantity_received),
      currency:row.currency,
      eligibleForAllocation:true
    }))
  };
}

async function productionSource(db:DB,id:number){
  const runs=await db`
    SELECT
      r.id,r.run_code,r.status,
      ps.code AS specification_code,ps.title AS specification_title,
      psv.version_no,
      m.name AS manufacturer_name
    FROM production_runs r
    JOIN product_specification_versions psv ON psv.id=r.product_specification_version_id
    JOIN product_specifications ps ON ps.id=psv.specification_id
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    WHERE r.id=${id}
    LIMIT 1`;
  if(!runs.length)return null;
  const lots=await db`
    SELECT
      l.id,l.variant_id,l.lot_code,l.status,l.planned_quantity,l.produced_quantity,
      pv.sku,pv.size,pv.color,p.name AS product_name
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE l.production_run_id=${id}
    ORDER BY l.id`;
  return {
    id:Number(runs[0].id),
    runCode:runs[0].run_code,
    status:runs[0].status,
    specificationCode:runs[0].specification_code,
    specificationTitle:runs[0].specification_title,
    specificationVersionNo:Number(runs[0].version_no),
    manufacturerName:runs[0].manufacturer_name,
    lines:lots.map((row:any)=>({
      targetType:"PRODUCTION_LOT",
      targetId:Number(row.id),
      goodsReceiptItemId:null,
      productionLotId:Number(row.id),
      variantId:Number(row.variant_id),
      sku:row.sku,
      productName:row.product_name,
      size:row.size||null,
      color:row.color||null,
      lotCode:row.lot_code,
      status:row.status,
      plannedQuantity:Number(row.planned_quantity),
      quantity:Number(row.produced_quantity),
      baseUnitCostMinor:null,
      baseCostMinor:null,
      currency:null,
      eligibleForAllocation:row.status==="COMPLETED"&&Number(row.produced_quantity)>0
    }))
  };
}

async function resolveAllocationTarget(db:DB,caseRecord:any,targetId:number){
  if(caseRecord.source_type==="GOODS_RECEIPT"){
    const rows=await db`
      SELECT
        gri.id,gri.variant_id,gri.quantity_received,gri.unit_cost_minor,gri.currency
      FROM goods_receipt_items gri
      WHERE gri.id=${targetId}
        AND gri.goods_receipt_id=${Number(caseRecord.goods_receipt_id)}
      LIMIT 1`;
    if(!rows.length)return {error:"receipt_item_not_in_case_source" as const,status:409};
    const row=rows[0];
    if(String(row.currency)!==String(caseRecord.currency)){
      return {error:"source_currency_mismatch" as const,status:409};
    }
    return {
      targetType:"GOODS_RECEIPT_ITEM",
      goodsReceiptItemId:Number(row.id),
      productionLotId:null,
      variantId:Number(row.variant_id),
      quantity:Number(row.quantity_received),
      baseUnitCostMinor:Number(row.unit_cost_minor),
      baseCostMinor:Number(row.unit_cost_minor)*Number(row.quantity_received),
      currency:String(row.currency)
    };
  }

  const rows=await db`
    SELECT id,variant_id,status,produced_quantity
    FROM production_lots
    WHERE id=${targetId}
      AND production_run_id=${Number(caseRecord.production_run_id)}
    LIMIT 1`;
  if(!rows.length)return {error:"production_lot_not_in_case_source" as const,status:409};
  const row=rows[0];
  if(row.status!=="COMPLETED"){
    return {error:"production_lot_not_completed" as const,status:409};
  }
  return {
    targetType:"PRODUCTION_LOT",
    goodsReceiptItemId:null,
    productionLotId:Number(row.id),
    variantId:Number(row.variant_id),
    quantity:Number(row.produced_quantity),
    baseUnitCostMinor:null,
    baseCostMinor:null,
    currency:String(caseRecord.currency)
  };
}

async function componentsForCase(db:DB,id:number){
  const rows=await db`
    SELECT id,case_id,component_type,amount_minor,description,active,created_at,updated_at
    FROM landed_cost_components
    WHERE case_id=${id}
    ORDER BY active DESC,id`;
  return rows.map(mapComponent);
}

async function allocationsForCase(db:DB,id:number){
  const rows=await db`
    SELECT
      a.id,a.case_id,a.target_type,a.goods_receipt_item_id,a.production_lot_id,
      a.variant_id,a.quantity_snapshot,a.base_unit_cost_minor,a.base_cost_minor,
      a.allocated_cost_minor,a.currency,a.created_at,a.updated_at,
      pv.sku,pv.size,pv.color,p.name AS product_name
    FROM landed_cost_allocations a
    JOIN product_variants pv ON pv.id=a.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE a.case_id=${id}
    ORDER BY a.id`;
  return rows.map(mapAllocation);
}

async function historyRows(db:DB,table:string,column:string,id:number){
  const allowed:any={
    landed_cost_case_history:["case_id","case"],
    landed_cost_component_history:["component_id","component"],
    landed_cost_allocation_history:["allocation_id","allocation"]
  };
  if(!allowed[table]||allowed[table][0]!==column)return [];
  return db.unsafe(
    `SELECT h.id,h.actor_user_id,u.display_name AS actor_display_name,
       h.actor_service,h.action,h.snapshot,h.note,h.created_at
     FROM ${table} h
     LEFT JOIN staff_users u ON u.id=h.actor_user_id
     WHERE h.${column}=$1
     ORDER BY h.id`,
    [id]
  );
}

function mapHistory(rows:any[]){
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:parseJson(row.snapshot),
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function appendCaseHistory(tx:DB,id:number,actor:any,action:string,note:string|null){
  const row=await caseRow(tx,id);
  const a=actorFields(actor);
  await tx`
    INSERT INTO landed_cost_case_history(
      case_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${id},${a.userId},${a.service},${action},
      ${JSON.stringify(caseSnapshot(row))}::jsonb,${note}
    )`;
}

async function appendComponentHistory(tx:DB,id:number,actor:any,action:string,note:string|null){
  const row=await componentRow(tx,id);
  const a=actorFields(actor);
  await tx`
    INSERT INTO landed_cost_component_history(
      component_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${id},${a.userId},${a.service},${action},
      ${JSON.stringify(componentSnapshot(row))}::jsonb,${note}
    )`;
}

async function appendAllocationHistory(tx:DB,id:number,actor:any,action:string,note:string|null){
  const row=await allocationRow(tx,id);
  const a=actorFields(actor);
  await tx`
    INSERT INTO landed_cost_allocation_history(
      allocation_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${id},${a.userId},${a.service},${action},
      ${JSON.stringify(allocationSnapshot(row))}::jsonb,${note}
    )`;
}

function summary(components:any[],allocations:any[]){
  const componentTotal=components
    .filter((x:any)=>x.active)
    .reduce((sum:number,x:any)=>sum+Number(x.amountMinor||0),0);
  const allocatedTotal=allocations
    .reduce((sum:number,x:any)=>sum+Number(x.allocatedCostMinor||0),0);
  const baseRows=allocations.filter((x:any)=>x.baseCostMinor!=null);
  const baseCostTotal=baseRows.length===allocations.length&&allocations.length
    ? allocations.reduce((sum:number,x:any)=>sum+Number(x.baseCostMinor||0),0)
    : null;
  return {
    componentTotalMinor:componentTotal,
    allocatedTotalMinor:allocatedTotal,
    unallocatedMinor:componentTotal-allocatedTotal,
    baseCostTotalMinor:baseCostTotal,
    totalLandedCostMinor:baseCostTotal==null?allocatedTotal:baseCostTotal+allocatedTotal,
    balanced:componentTotal===allocatedTotal
  };
}

async function listCases(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"landed_cost.read");
  if(!auth.ok)return auth.response;

  const status=clean(url.searchParams.get("status"),20).toUpperCase();
  const sourceType=clean(url.searchParams.get("sourceType"),30).toUpperCase();
  if(status&&!["DRAFT","FINAL"].includes(status))return json({error:"invalid_status"},400);
  if(sourceType&&!SOURCE_TYPES.has(sourceType))return json({error:"invalid_source_type"},400);

  const rows=await db`
    SELECT id
    FROM landed_cost_cases
    WHERE (${status||null}::text IS NULL OR status=${status||null}::text)
      AND (${sourceType||null}::text IS NULL OR source_type=${sourceType||null}::text)
    ORDER BY updated_at DESC,id DESC
    LIMIT 300`;

  const data=[];
  for(const row of rows){
    const id=Number(row.id);
    const c=await caseRow(db,id);
    const components=await componentsForCase(db,id);
    const allocations=await allocationsForCase(db,id);
    data.push({...mapCase(c),summary:summary(components,allocations)});
  }
  return json({data});
}

async function listTargets(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"landed_cost.read");
  if(!auth.ok)return auth.response;
  const type=clean(url.searchParams.get("type"),30).toUpperCase();
  if(type&&!SOURCE_TYPES.has(type))return json({error:"invalid_source_type"},400);

  const data:any[]=[];
  if(!type||type==="GOODS_RECEIPT"){
    const rows=await db`
      SELECT gr.id
      FROM goods_receipts gr
      LEFT JOIN landed_cost_cases c ON c.goods_receipt_id=gr.id
      WHERE c.id IS NULL
      ORDER BY gr.received_at DESC,gr.id DESC
      LIMIT 150`;
    for(const row of rows){
      const source=await receiptSource(db,Number(row.id));
      if(source)data.push({sourceType:"GOODS_RECEIPT",source});
    }
  }
  if(!type||type==="PRODUCTION_RUN"){
    const rows=await db`
      SELECT pr.id
      FROM production_runs pr
      LEFT JOIN landed_cost_cases c ON c.production_run_id=pr.id
      WHERE c.id IS NULL
        AND pr.status<>'CANCELLED'
      ORDER BY pr.updated_at DESC,pr.id DESC
      LIMIT 150`;
    for(const row of rows){
      const source=await productionSource(db,Number(row.id));
      if(source)data.push({sourceType:"PRODUCTION_RUN",source});
    }
  }
  return json({data});
}

async function createCase(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const caseCode=normalizeCode(body?.caseCode);
  const sourceType=clean(body?.sourceType,30).toUpperCase();
  const sourceId=Number(body?.sourceId);
  const notes=clean(body?.notes,4000)||null;

  if(caseCode.length<3)return json({error:"invalid_case_code"},400);
  if(!SOURCE_TYPES.has(sourceType))return json({error:"invalid_source_type"},400);
  if(!Number.isSafeInteger(sourceId)||sourceId<1)return json({error:"invalid_source"},400);

  let resolvedCurrency="";
  if(sourceType==="GOODS_RECEIPT"){
    const source=await receiptSource(db,sourceId);
    if(!source)return json({error:"goods_receipt_not_found"},404);
    if(source.status!=="POSTED")return json({error:"goods_receipt_not_posted"},409);
    if(!source.lines.length)return json({error:"goods_receipt_empty"},409);
    if(source.currencyCount!==1||!source.currency)return json({error:"goods_receipt_currency_ambiguous"},409);
    const requested=body?.currency==null||body?.currency===""?source.currency:currencyCode(body.currency);
    if(!requested)return json({error:"invalid_currency"},400);
    if(requested!==source.currency)return json({error:"source_currency_mismatch"},409);
    resolvedCurrency=requested;
  }else{
    const source=await productionSource(db,sourceId);
    if(!source)return json({error:"production_run_not_found"},404);
    if(source.status==="CANCELLED")return json({error:"production_run_cancelled"},409);
    resolvedCurrency=currencyCode(body?.currency);
    if(!resolvedCurrency)return json({error:"currency_required"},400);
  }

  const a=actorFields(auth.actor);
  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO landed_cost_cases(
          case_code,source_type,goods_receipt_id,production_run_id,currency,status,
          allocation_method,notes,
          created_by_user_id,created_by_service,updated_by_user_id,updated_by_service
        )
        VALUES(
          ${caseCode},${sourceType},
          ${sourceType==="GOODS_RECEIPT"?sourceId:null},
          ${sourceType==="PRODUCTION_RUN"?sourceId:null},
          ${resolvedCurrency},'DRAFT','MANUAL',${notes},
          ${a.userId},${a.service},${a.userId},${a.service}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendCaseHistory(tx,id,auth.actor,"CREATED",notes);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"landed_cost_case.created",
        resourceType:"LandedCostCase",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          sourceType,
          sourceId,
          currency:resolvedCurrency,
          allocationMethod:"MANUAL",
          fxConversionApplied:false,
          inventoryChanged:false,
          inventorySourceChanged:false,
          sourceCostChanged:false
        }
      });
      return {id};
    });
    return json({
      case:mapCase(await caseRow(db,result.id)),
      inventoryChanged:false,
      inventorySourceChanged:false,
      sourceCostChanged:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"landed_cost_case_exists"},409);
    }
    throw error;
  }
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
  const a=actorFields(auth.actor);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE landed_cost_cases
      SET notes=${notes},updated_by_user_id=${a.userId},updated_by_service=${a.service},updated_at=NOW()
      WHERE id=${id} AND status='DRAFT'`;
    await appendCaseHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_case.updated",
      resourceType:"LandedCostCase",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{inventoryChanged:false,inventorySourceChanged:false,sourceCostChanged:false}
    });
  });

  return json({case:mapCase(await caseRow(db,id))});
}

async function getCase(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.read");
  if(!auth.ok)return auth.response;
  const row=await caseRow(db,id);
  if(!row)return json({error:"not_found"},404);
  const components=await componentsForCase(db,id);
  const allocations=await allocationsForCase(db,id);
  const source=row.source_type==="GOODS_RECEIPT"
    ? await receiptSource(db,Number(row.goods_receipt_id))
    : await productionSource(db,Number(row.production_run_id));
  const history=mapHistory(await historyRows(db,"landed_cost_case_history","case_id",id));
  return json({
    case:mapCase(row),
    source,
    components,
    allocations,
    summary:summary(components,allocations),
    history,
    fxConversionApplied:false,
    inventoryChanged:false,
    inventorySourceChanged:false
  });
}

async function createComponent(req:Request,db:DB,caseId:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  const c=await caseRow(db,caseId);
  if(!c)return json({error:"case_not_found"},404);
  if(c.status!=="DRAFT")return json({error:"final_case_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const componentType=clean(body?.componentType,40).toUpperCase();
  const amount=nonNegativeInt(body?.amountMinor);
  const description=clean(body?.description,1000)||null;
  if(!COMPONENT_TYPES.has(componentType))return json({error:"invalid_component_type"},400);
  if(amount==null)return json({error:"invalid_amount"},400);
  const a=actorFields(auth.actor);

  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      INSERT INTO landed_cost_components(
        case_id,component_type,amount_minor,description,active,
        created_by_user_id,created_by_service,updated_by_user_id,updated_by_service
      )
      VALUES(
        ${caseId},${componentType},${amount},${description},TRUE,
        ${a.userId},${a.service},${a.userId},${a.service}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    await appendComponentHistory(tx,id,auth.actor,"CREATED",description);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_component.created",
      resourceType:"LandedCostComponent",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{caseId,componentType,amountMinor:amount,currency:c.currency}
    });
    return {id};
  });

  return json({component:mapComponent(await componentRow(db,result.id))},201);
}

async function updateComponent(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  const existing=await componentRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  const c=await caseRow(db,Number(existing.case_id));
  if(!c||c.status!=="DRAFT")return json({error:"final_case_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const componentType=body?.componentType==null
    ? existing.component_type
    : clean(body.componentType,40).toUpperCase();
  const amount=body?.amountMinor==null?Number(existing.amount_minor):nonNegativeInt(body.amountMinor);
  const description=body?.description==null
    ? existing.description
    : (clean(body.description,1000)||null);
  const active=body?.active==null?Boolean(existing.active):body.active===true;
  const changeNote=clean(body?.changeNote,1000)||null;
  if(!COMPONENT_TYPES.has(componentType))return json({error:"invalid_component_type"},400);
  if(amount==null)return json({error:"invalid_amount"},400);
  const a=actorFields(auth.actor);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE landed_cost_components
      SET component_type=${componentType},amount_minor=${amount},description=${description},
          active=${active},updated_by_user_id=${a.userId},updated_by_service=${a.service},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendComponentHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_component.updated",
      resourceType:"LandedCostComponent",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{caseId:Number(existing.case_id),componentType,amountMinor:amount,active}
    });
  });

  return json({
    component:mapComponent(await componentRow(db,id)),
    history:mapHistory(await historyRows(db,"landed_cost_component_history","component_id",id))
  });
}

async function createAllocation(req:Request,db:DB,caseId:number){
  const auth=await authorizeInternal(req,db,"landed_cost.manage",{mutation:true});
  if(!auth.ok)return auth.response;
  const c=await caseRow(db,caseId);
  if(!c)return json({error:"case_not_found"},404);
  if(c.status!=="DRAFT")return json({error:"final_case_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const targetId=Number(body?.targetId);
  const amount=nonNegativeInt(body?.allocatedCostMinor);
  if(!Number.isSafeInteger(targetId)||targetId<1)return json({error:"invalid_target"},400);
  if(amount==null)return json({error:"invalid_amount"},400);

  const target:any=await resolveAllocationTarget(db,c,targetId);
  if(target.error)return json({error:target.error},target.status||409);
  if(target.targetType==="PRODUCTION_LOT"&&target.quantity===0&&amount>0){
    return json({error:"cannot_allocate_to_zero_quantity"},409);
  }
  const a=actorFields(auth.actor);

  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO landed_cost_allocations(
          case_id,target_type,goods_receipt_item_id,production_lot_id,variant_id,
          quantity_snapshot,base_unit_cost_minor,base_cost_minor,allocated_cost_minor,currency,
          created_by_user_id,created_by_service,updated_by_user_id,updated_by_service
        )
        VALUES(
          ${caseId},${target.targetType},${target.goodsReceiptItemId},${target.productionLotId},
          ${target.variantId},${target.quantity},${target.baseUnitCostMinor},${target.baseCostMinor},
          ${amount},${c.currency},
          ${a.userId},${a.service},${a.userId},${a.service}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendAllocationHistory(tx,id,auth.actor,"CREATED",null);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"landed_cost_allocation.created",
        resourceType:"LandedCostAllocation",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          caseId,
          targetType:target.targetType,
          targetId,
          allocatedCostMinor:amount,
          currency:c.currency,
          inventoryChanged:false,
          inventorySourceChanged:false
        }
      });
      return {id};
    });
    return json({allocation:mapAllocation(await allocationRow(db,result.id))},201);
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
  const existing=await allocationRow(db,id);
  if(!existing)return json({error:"not_found"},404);
  const c=await caseRow(db,Number(existing.case_id));
  if(!c||c.status!=="DRAFT")return json({error:"final_case_immutable"},409);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
  const amount=body?.allocatedCostMinor==null
    ? Number(existing.allocated_cost_minor)
    : nonNegativeInt(body.allocatedCostMinor);
  const changeNote=clean(body?.changeNote,1000)||null;
  if(amount==null)return json({error:"invalid_amount"},400);
  const targetId=existing.target_type==="GOODS_RECEIPT_ITEM"
    ? Number(existing.goods_receipt_item_id)
    : Number(existing.production_lot_id);
  const target:any=await resolveAllocationTarget(db,c,targetId);
  if(target.error)return json({error:target.error},target.status||409);
  if(target.targetType==="PRODUCTION_LOT"&&target.quantity===0&&amount>0){
    return json({error:"cannot_allocate_to_zero_quantity"},409);
  }
  const a=actorFields(auth.actor);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE landed_cost_allocations
      SET variant_id=${target.variantId},
          quantity_snapshot=${target.quantity},
          base_unit_cost_minor=${target.baseUnitCostMinor},
          base_cost_minor=${target.baseCostMinor},
          allocated_cost_minor=${amount},
          currency=${c.currency},
          updated_by_user_id=${a.userId},updated_by_service=${a.service},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendAllocationHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_allocation.updated",
      resourceType:"LandedCostAllocation",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{
        caseId:Number(existing.case_id),
        allocatedCostMinor:amount,
        inventoryChanged:false,
        inventorySourceChanged:false
      }
    });
  });

  return json({
    allocation:mapAllocation(await allocationRow(db,id)),
    history:mapHistory(await historyRows(db,"landed_cost_allocation_history","allocation_id",id))
  });
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

    let source:any;
    if(c.source_type==="GOODS_RECEIPT"){
      source=await receiptSource(tx,Number(c.goods_receipt_id));
      if(!source||source.status!=="POSTED")return {error:"goods_receipt_not_posted",status:409};
      if(source.currencyCount!==1||source.currency!==c.currency){
        return {error:"source_currency_mismatch",status:409};
      }
    }else{
      source=await productionSource(tx,Number(c.production_run_id));
      if(!source)return {error:"production_run_not_found",status:404};
      if(source.status!=="COMPLETED")return {error:"production_run_not_completed",status:409};
    }

    const componentRows=await tx`
      SELECT id,amount_minor
      FROM landed_cost_components
      WHERE case_id=${id} AND active
      ORDER BY id
      FOR UPDATE`;
    if(!componentRows.length)return {error:"active_component_required",status:409};

    const allocationRows=await tx`
      SELECT *
      FROM landed_cost_allocations
      WHERE case_id=${id}
      ORDER BY id
      FOR UPDATE`;

    const eligible=source.lines.filter((x:any)=>x.eligibleForAllocation);
    if(allocationRows.length!==eligible.length){
      return {
        error:"complete_allocation_coverage_required",
        status:409,
        eligibleLineCount:eligible.length,
        allocationCount:allocationRows.length
      };
    }

    const eligibleIds=new Set(eligible.map((x:any)=>Number(x.targetId)));
    for(const row of allocationRows){
      const targetId=row.target_type==="GOODS_RECEIPT_ITEM"
        ? Number(row.goods_receipt_item_id)
        : Number(row.production_lot_id);
      if(!eligibleIds.has(targetId)){
        return {error:"allocation_target_not_eligible",status:409,targetId};
      }
      const resolved:any=await resolveAllocationTarget(tx,c,targetId);
      if(resolved.error)return {error:resolved.error,status:resolved.status||409,targetId};
      if(
        Number(row.variant_id)!==resolved.variantId ||
        Number(row.quantity_snapshot)!==resolved.quantity ||
        (row.base_unit_cost_minor==null?null:Number(row.base_unit_cost_minor))!==resolved.baseUnitCostMinor ||
        (row.base_cost_minor==null?null:Number(row.base_cost_minor))!==resolved.baseCostMinor ||
        String(row.currency)!==String(c.currency)
      ){
        return {error:"allocation_snapshot_stale",status:409,targetId};
      }
    }

    const componentTotal=componentRows.reduce(
      (sum:number,row:any)=>sum+Number(row.amount_minor),0
    );
    const allocationTotal=allocationRows.reduce(
      (sum:number,row:any)=>sum+Number(row.allocated_cost_minor),0
    );
    if(componentTotal!==allocationTotal){
      return {
        error:"allocation_not_balanced",
        status:409,
        componentTotalMinor:componentTotal,
        allocatedTotalMinor:allocationTotal,
        differenceMinor:componentTotal-allocationTotal
      };
    }

    await tx`
      UPDATE landed_cost_cases
      SET status='FINAL',
          finalized_by_user_id=${auth.actor.userId},
          finalized_at=NOW(),
          updated_by_user_id=${auth.actor.userId},
          updated_by_service=NULL,
          updated_at=NOW()
      WHERE id=${id}`;
    await appendCaseHistory(tx,id,auth.actor,"FINALIZED",note);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"landed_cost_case.finalized",
      resourceType:"LandedCostCase",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        sourceType:c.source_type,
        goodsReceiptId:c.goods_receipt_id==null?null:Number(c.goods_receipt_id),
        productionRunId:c.production_run_id==null?null:Number(c.production_run_id),
        currency:c.currency,
        componentTotalMinor:componentTotal,
        allocatedTotalMinor:allocationTotal,
        allocationMethod:"MANUAL",
        fxConversionApplied:false,
        inventoryChanged:false,
        inventorySourceChanged:false,
        sourceCostChanged:false,
        accountingEntryCreated:false
      }
    });

    return {ok:true};
  });

  if(result.error)return json(result,result.status||409);
  const c=await caseRow(db,id);
  const components=await componentsForCase(db,id);
  const allocations=await allocationsForCase(db,id);
  return json({
    case:mapCase(c),
    components,
    allocations,
    summary:summary(components,allocations),
    inventoryChanged:false,
    inventorySourceChanged:false,
    sourceCostChanged:false,
    accountingEntryCreated:false
  });
}

export async function handleLandedCost(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/landed-cost/targets"&&req.method==="GET"){
    return listTargets(req,url,db);
  }

  if(url.pathname==="/v1/internal/landed-cost/cases"){
    if(req.method==="GET")return listCases(req,url,db);
    if(req.method==="POST")return createCase(req,db);
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

  const finalize=url.pathname.match(/^\/v1\/internal\/landed-cost\/cases\/(\d+)\/finalize$/);
  if(finalize){
    if(req.method==="POST")return finalizeCase(req,db,Number(finalize[1]));
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
