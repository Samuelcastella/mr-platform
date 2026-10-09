import {
  auditActor,
  authorizeInternal,
  permissionAllowed,
  writeAuditEvent
} from "./auth";

type DB = any;

const SOURCE_TYPES=new Set(["GOODS_RECEIPT_ITEM","PRODUCTION_LOT"]);

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

function actorFields(actor:any){
  return actor.type==="USER"
    ?{userId:actor.userId,service:null}
    :{userId:null,service:actor.service};
}

export async function ensureTraceabilitySchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS traceability_quality_links (
      id BIGSERIAL PRIMARY KEY,
      quality_inspection_id BIGINT NOT NULL
        REFERENCES quality_inspections(id) ON DELETE RESTRICT,
      source_type TEXT NOT NULL,
      goods_receipt_item_id BIGINT
        REFERENCES goods_receipt_items(id) ON DELETE RESTRICT,
      production_lot_id BIGINT
        REFERENCES production_lots(id) ON DELETE RESTRICT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_type IN ('GOODS_RECEIPT_ITEM','PRODUCTION_LOT')),
      CHECK (
        (
          source_type='GOODS_RECEIPT_ITEM'
          AND goods_receipt_item_id IS NOT NULL
          AND production_lot_id IS NULL
        )
        OR
        (
          source_type='PRODUCTION_LOT'
          AND goods_receipt_item_id IS NULL
          AND production_lot_id IS NOT NULL
        )
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_quality_receipt_unique
    ON traceability_quality_links(quality_inspection_id,goods_receipt_item_id)
    WHERE goods_receipt_item_id IS NOT NULL`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_quality_production_unique
    ON traceability_quality_links(quality_inspection_id,production_lot_id)
    WHERE production_lot_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_trace_quality_receipt_source
    ON traceability_quality_links(goods_receipt_item_id,active,id)
    WHERE goods_receipt_item_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_trace_quality_production_source
    ON traceability_quality_links(production_lot_id,active,id)
    WHERE production_lot_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS traceability_quality_link_history (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL
        REFERENCES traceability_quality_links(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_trace_quality_link_history
    ON traceability_quality_link_history(link_id,id)`;
}

async function inspectionRecord(db:DB,id:number){
  const rows=await db`
    SELECT
      q.id,q.inspection_type,q.target_type,q.product_id,q.variant_id,
      q.specification_version_id,q.inspected_quantity,q.status,q.result,
      q.rationale,q.evidence_reference,q.aql_reference,q.finalized_at,
      COALESCE(q.product_id,pv.product_id) AS resolved_product_id,
      p.name AS product_name,
      pv.sku,
      sv.version_no AS specification_version_no,
      ps.code AS specification_code
    FROM quality_inspections q
    LEFT JOIN product_variants pv ON pv.id=q.variant_id
    JOIN products p ON p.id=COALESCE(q.product_id,pv.product_id)
    LEFT JOIN product_specification_versions sv
      ON sv.id=q.specification_version_id
    LEFT JOIN product_specifications ps ON ps.id=sv.specification_id
    WHERE q.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapInspection(row:any){
  return {
    id:Number(row.id),
    inspectionType:row.inspection_type,
    targetType:row.target_type,
    productId:Number(row.resolved_product_id),
    variantId:row.variant_id==null?null:Number(row.variant_id),
    productName:row.product_name,
    sku:row.sku||null,
    specificationVersion:row.specification_version_id==null?null:{
      id:Number(row.specification_version_id),
      versionNo:Number(row.specification_version_no),
      code:row.specification_code||null
    },
    inspectedQuantity:Number(row.inspected_quantity),
    status:row.status,
    result:row.result,
    rationale:row.rationale||null,
    evidenceReference:row.evidence_reference||null,
    aqlReference:row.aql_reference||null,
    finalizedAt:row.finalized_at||null
  };
}

async function sourceRecord(db:DB,sourceType:string,sourceId:number){
  if(sourceType==="GOODS_RECEIPT_ITEM"){
    const rows=await db`
      SELECT
        gri.id,gri.goods_receipt_id,gri.variant_id,gri.quantity_received,
        pv.product_id,pv.sku,pv.size,pv.color,p.name AS product_name,
        gr.receipt_number,gr.received_at,gr.location_id,
        po.id AS purchase_order_id,po.po_number,po.supplier_id,
        po.supplier_name_snapshot,po.supplier_country_code_snapshot
      FROM goods_receipt_items gri
      JOIN product_variants pv ON pv.id=gri.variant_id
      JOIN products p ON p.id=pv.product_id
      JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id
      JOIN purchase_orders po ON po.id=gr.purchase_order_id
      WHERE gri.id=${sourceId}
      LIMIT 1`;
    if(!rows.length)return null;
    const r=rows[0];
    return {
      sourceType,
      sourceId:Number(r.id),
      productId:Number(r.product_id),
      variantId:Number(r.variant_id),
      sku:r.sku,
      productName:r.product_name,
      quantity:Number(r.quantity_received),
      specificationVersionId:null,
      procurement:{
        goodsReceiptId:Number(r.goods_receipt_id),
        receiptNumber:r.receipt_number,
        receivedAt:r.received_at,
        locationId:Number(r.location_id),
        purchaseOrderId:Number(r.purchase_order_id),
        purchaseOrderNumber:r.po_number,
        supplierId:r.supplier_id==null?null:Number(r.supplier_id),
        supplierNameSnapshot:r.supplier_name_snapshot,
        supplierCountryCodeSnapshot:r.supplier_country_code_snapshot||null
      }
    };
  }

  const rows=await db`
    SELECT
      l.id,l.production_run_id,l.variant_id,l.lot_code,l.status,
      l.planned_quantity,l.produced_quantity,l.started_at,l.completed_at,
      pv.product_id,pv.sku,pv.size,pv.color,p.name AS product_name,
      r.run_code,r.status AS run_status,r.product_specification_version_id,
      sv.version_no,ps.id AS specification_id,ps.code AS specification_code,
      ps.title AS specification_title,
      r.manufacturer_link_id,ml.target_type AS manufacturer_link_target_type,
      ml.manufacturer_reference,
      m.id AS manufacturer_id,m.name AS manufacturer_name,m.country_code AS manufacturer_country_code
    FROM production_lots l
    JOIN product_variants pv ON pv.id=l.variant_id
    JOIN products p ON p.id=pv.product_id
    JOIN production_runs r ON r.id=l.production_run_id
    JOIN product_specification_versions sv
      ON sv.id=r.product_specification_version_id
    JOIN product_specifications ps ON ps.id=sv.specification_id
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    WHERE l.id=${sourceId}
    LIMIT 1`;
  if(!rows.length)return null;
  const r=rows[0];
  return {
    sourceType,
    sourceId:Number(r.id),
    productId:Number(r.product_id),
    variantId:Number(r.variant_id),
    sku:r.sku,
    productName:r.product_name,
    quantity:Number(r.produced_quantity),
    specificationVersionId:Number(r.product_specification_version_id),
    production:{
      productionRunId:Number(r.production_run_id),
      runCode:r.run_code,
      runStatus:r.run_status,
      lotCode:r.lot_code,
      lotStatus:r.status,
      plannedQuantity:Number(r.planned_quantity),
      producedQuantity:Number(r.produced_quantity),
      startedAt:r.started_at||null,
      completedAt:r.completed_at||null,
      specification:{
        id:Number(r.specification_id),
        code:r.specification_code,
        title:r.specification_title,
        versionId:Number(r.product_specification_version_id),
        versionNo:Number(r.version_no)
      },
      manufacturerLink:{
        id:Number(r.manufacturer_link_id),
        targetType:r.manufacturer_link_target_type,
        manufacturerReference:r.manufacturer_reference||null
      },
      manufacturer:{
        id:Number(r.manufacturer_id),
        name:r.manufacturer_name,
        countryCode:r.manufacturer_country_code||null
      }
    }
  };
}

function compatible(inspection:any,source:any){
  const inspectionProductId=Number(inspection.resolved_product_id);
  const sourceProductId=Number(source.productId);
  if(inspectionProductId!==sourceProductId){
    return {ok:false,error:"quality_target_product_mismatch"};
  }
  if(
    inspection.target_type==="VARIANT" &&
    Number(inspection.variant_id)!==Number(source.variantId)
  ){
    return {ok:false,error:"quality_target_variant_mismatch"};
  }
  if(
    source.sourceType==="PRODUCTION_LOT" &&
    inspection.specification_version_id!=null &&
    Number(inspection.specification_version_id)!==Number(source.specificationVersionId)
  ){
    return {ok:false,error:"quality_specification_mismatch"};
  }
  return {ok:true};
}

async function linkRow(db:DB,id:number){
  const rows=await db`
    SELECT
      l.id,l.quality_inspection_id,l.source_type,
      l.goods_receipt_item_id,l.production_lot_id,l.notes,l.active,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      l.created_at,l.updated_at
    FROM traceability_quality_links l
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

async function mapLink(db:DB,row:any){
  const inspection=await inspectionRecord(db,Number(row.quality_inspection_id));
  const sourceId=row.source_type==="GOODS_RECEIPT_ITEM"
    ?Number(row.goods_receipt_item_id)
    :Number(row.production_lot_id);
  const source=await sourceRecord(db,String(row.source_type),sourceId);
  return {
    id:Number(row.id),
    qualityInspection:inspection?mapInspection(inspection):null,
    sourceType:row.source_type,
    sourceId,
    source,
    notes:row.notes||null,
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
    updatedAt:row.updated_at,
    relationship:"EXPLICIT",
    automaticallyInferred:false
  };
}

async function linkSnapshot(db:DB,row:any){
  const link=await mapLink(db,row);
  return {
    qualityInspectionId:link.qualityInspection?.id||null,
    sourceType:link.sourceType,
    sourceId:link.sourceId,
    notes:link.notes,
    active:link.active,
    relationship:"EXPLICIT"
  };
}

async function appendHistory(
  tx:DB,
  id:number,
  actor:any,
  action:string,
  note:string|null
){
  const row=await linkRow(tx,id);
  const snapshot=await linkSnapshot(tx,row);
  const a=actorFields(actor);
  await tx`
    INSERT INTO traceability_quality_link_history(
      link_id,actor_user_id,actor_service,action,snapshot,note
    )
    VALUES(
      ${id},${a.userId},${a.service},${action},
      ${JSON.stringify(snapshot)}::jsonb,${note}
    )`;
}

async function linkHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM traceability_quality_link_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.link_id=${id}
    ORDER BY h.id`;
  return rows.map((r:any)=>({
    id:Number(r.id),
    actor:r.actor_user_id==null
      ?{type:"SERVICE",service:r.actor_service}
      :{type:"USER",userId:Number(r.actor_user_id),displayName:r.actor_display_name||null},
    action:r.action,
    snapshot:r.snapshot,
    note:r.note||null,
    createdAt:r.created_at
  }));
}

async function validateExplicitLink(
  db:DB,
  qualityInspectionId:number,
  sourceType:string,
  sourceId:number
){
  const inspection=await inspectionRecord(db,qualityInspectionId);
  if(!inspection)return {error:"quality_inspection_not_found",status:404};
  if(inspection.status!=="FINAL"){
    return {error:"final_quality_inspection_required",status:409};
  }

  const source=await sourceRecord(db,sourceType,sourceId);
  if(!source){
    return {
      error:sourceType==="GOODS_RECEIPT_ITEM"
        ?"goods_receipt_item_not_found"
        :"production_lot_not_found",
      status:404
    };
  }

  const match=compatible(inspection,source);
  if(!match.ok)return {error:match.error,status:409};

  return {inspection,source};
}

async function createQualityLink(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"traceability.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const qualityInspectionId=Number(body?.qualityInspectionId);
  const sourceType=clean(body?.sourceType,40).toUpperCase();
  const sourceId=Number(body?.sourceId);
  const notes=clean(body?.notes,2000)||null;

  if(!Number.isSafeInteger(qualityInspectionId)||qualityInspectionId<1){
    return json({error:"invalid_quality_inspection"},400);
  }
  if(!SOURCE_TYPES.has(sourceType))return json({error:"invalid_source_type"},400);
  if(!Number.isSafeInteger(sourceId)||sourceId<1){
    return json({error:"invalid_source"},400);
  }

  const valid:any=await validateExplicitLink(
    db,
    qualityInspectionId,
    sourceType,
    sourceId
  );
  if(valid.error)return json({error:valid.error},valid.status||409);

  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO traceability_quality_links(
          quality_inspection_id,source_type,goods_receipt_item_id,production_lot_id,
          notes,active,created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${qualityInspectionId},${sourceType},
          ${sourceType==="GOODS_RECEIPT_ITEM"?sourceId:null},
          ${sourceType==="PRODUCTION_LOT"?sourceId:null},
          ${notes},TRUE,
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      await appendHistory(tx,id,auth.actor,"CREATED",notes);
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"traceability.quality_link.created",
        resourceType:"TraceabilityQualityLink",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          qualityInspectionId,
          sourceType,
          sourceId,
          relationship:"EXPLICIT",
          automaticallyInferred:false,
          sourceMutated:false,
          qualityInspectionMutated:false
        }
      });
      return {id};
    });

    return json({
      link:await mapLink(db,await linkRow(db,result.id)),
      sourceMutated:false,
      qualityInspectionMutated:false
    },201);
  }catch(error:any){
    if(error?.code==="23505"||String(error?.message||"").includes("duplicate key")){
      return json({error:"traceability_quality_link_exists"},409);
    }
    throw error;
  }
}

async function updateQualityLink(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"traceability.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await linkRow(db,id);
  if(!existing)return json({error:"not_found"},404);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const active=body?.active==null?Boolean(existing.active):body.active===true;
  const notes=body?.notes==null?existing.notes:(clean(body.notes,2000)||null);
  const changeNote=clean(body?.changeNote,1000)||null;

  if(active&&!existing.active){
    const sourceId=existing.source_type==="GOODS_RECEIPT_ITEM"
      ?Number(existing.goods_receipt_item_id)
      :Number(existing.production_lot_id);
    const valid:any=await validateExplicitLink(
      db,
      Number(existing.quality_inspection_id),
      String(existing.source_type),
      sourceId
    );
    if(valid.error)return json({error:valid.error},valid.status||409);
  }

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE traceability_quality_links
      SET notes=${notes},active=${active},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    await appendHistory(tx,id,auth.actor,"UPDATED",changeNote);
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"traceability.quality_link.updated",
      resourceType:"TraceabilityQualityLink",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{
        fromActive:Boolean(existing.active),
        toActive:active,
        relationship:"EXPLICIT",
        automaticallyInferred:false,
        sourceMutated:false,
        qualityInspectionMutated:false
      }
    });
  });

  return json({
    link:await mapLink(db,await linkRow(db,id)),
    history:await linkHistory(db,id),
    sourceMutated:false,
    qualityInspectionMutated:false
  });
}

async function getQualityLink(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"traceability.read");
  if(!auth.ok)return auth.response;
  const row=await linkRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    link:await mapLink(db,row),
    history:await linkHistory(db,id)
  });
}

async function listQualityLinks(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"traceability.read");
  if(!auth.ok)return auth.response;

  const inspectionRaw=url.searchParams.get("qualityInspectionId");
  const productRaw=url.searchParams.get("productId");
  const variantRaw=url.searchParams.get("variantId");
  const activeRaw=url.searchParams.get("active");

  const qualityInspectionId=inspectionRaw?Number(inspectionRaw):null;
  const productId=productRaw?Number(productRaw):null;
  const variantId=variantRaw?Number(variantRaw):null;

  if(qualityInspectionId!=null&&(!Number.isSafeInteger(qualityInspectionId)||qualityInspectionId<1)){
    return json({error:"invalid_quality_inspection"},400);
  }
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
    SELECT l.id
    FROM traceability_quality_links l
    JOIN quality_inspections q ON q.id=l.quality_inspection_id
    LEFT JOIN product_variants qv ON qv.id=q.variant_id
    WHERE (
      ${qualityInspectionId}::bigint IS NULL
      OR l.quality_inspection_id=${qualityInspectionId}::bigint
    )
      AND (
        ${productId}::bigint IS NULL
        OR q.product_id=${productId}::bigint
        OR qv.product_id=${productId}::bigint
      )
      AND (
        ${variantId}::bigint IS NULL
        OR q.variant_id=${variantId}::bigint
      )
      AND (${active}::boolean IS NULL OR l.active=${active}::boolean)
    ORDER BY l.active DESC,l.updated_at DESC,l.id DESC
    LIMIT 500`;

  const data=[];
  for(const row of rows){
    data.push(await mapLink(db,await linkRow(db,Number(row.id))));
  }
  return json({data});
}

async function activeQualityForSource(
  db:DB,
  sourceType:string,
  sourceId:number
){
  const rows=sourceType==="GOODS_RECEIPT_ITEM"
    ?await db`
      SELECT l.id
      FROM traceability_quality_links l
      WHERE l.source_type='GOODS_RECEIPT_ITEM'
        AND l.goods_receipt_item_id=${sourceId}
        AND l.active
      ORDER BY l.id`
    :await db`
      SELECT l.id
      FROM traceability_quality_links l
      WHERE l.source_type='PRODUCTION_LOT'
        AND l.production_lot_id=${sourceId}
        AND l.active
      ORDER BY l.id`;
  const data=[];
  for(const row of rows){
    data.push(await mapLink(db,await linkRow(db,Number(row.id))));
  }
  return data;
}

async function landedCostForSource(
  db:DB,
  sourceType:string,
  sourceId:number,
  canReadCosts:boolean
){
  const rows=sourceType==="GOODS_RECEIPT_ITEM"
    ?await db`
      SELECT
        c.id AS case_id,c.case_code,c.status,c.currency,
        a.id AS allocation_id,a.allocated_cost_minor,a.quantity_snapshot,
        a.base_unit_cost_minor,a.base_cost_minor
      FROM landed_cost_allocations a
      JOIN landed_cost_cases c ON c.id=a.case_id
      WHERE a.target_type='GOODS_RECEIPT_ITEM'
        AND a.goods_receipt_item_id=${sourceId}
        AND c.status='FINAL'
      ORDER BY c.finalized_at DESC,c.id DESC
      LIMIT 1`
    :await db`
      SELECT
        c.id AS case_id,c.case_code,c.status,c.currency,
        a.id AS allocation_id,a.allocated_cost_minor,a.quantity_snapshot,
        a.base_unit_cost_minor,a.base_cost_minor
      FROM landed_cost_allocations a
      JOIN landed_cost_cases c ON c.id=a.case_id
      WHERE a.target_type='PRODUCTION_LOT'
        AND a.production_lot_id=${sourceId}
        AND c.status='FINAL'
      ORDER BY c.finalized_at DESC,c.id DESC
      LIMIT 1`;

  if(!rows.length)return null;
  if(!canReadCosts){
    return {
      present:true,
      visibility:"REDACTED",
      reason:"landed_cost.read required"
    };
  }
  const r=rows[0];
  const base=r.base_cost_minor==null?null:Number(r.base_cost_minor);
  const allocated=Number(r.allocated_cost_minor);
  return {
    present:true,
    visibility:"FULL",
    caseId:Number(r.case_id),
    caseCode:r.case_code,
    status:r.status,
    currency:r.currency,
    allocationId:Number(r.allocation_id),
    quantitySnapshot:Number(r.quantity_snapshot),
    baseUnitCostMinor:r.base_unit_cost_minor==null?null:Number(r.base_unit_cost_minor),
    baseCostMinor:base,
    allocatedCostMinor:allocated,
    totalCostMinor:base==null?allocated:base+allocated
  };
}

async function qualityCandidates(db:DB,productId:number,variantId:number|null){
  const rows=await db`
    SELECT
      q.id,q.inspection_type,q.target_type,q.product_id,q.variant_id,
      q.specification_version_id,q.inspected_quantity,q.status,q.result,
      q.rationale,q.evidence_reference,q.aql_reference,q.finalized_at,
      COALESCE(q.product_id,pv.product_id) AS resolved_product_id,
      p.name AS product_name,pv.sku,
      sv.version_no AS specification_version_no,
      ps.code AS specification_code
    FROM quality_inspections q
    LEFT JOIN product_variants pv ON pv.id=q.variant_id
    JOIN products p ON p.id=COALESCE(q.product_id,pv.product_id)
    LEFT JOIN product_specification_versions sv
      ON sv.id=q.specification_version_id
    LEFT JOIN product_specifications ps ON ps.id=sv.specification_id
    WHERE q.status='FINAL'
      AND COALESCE(q.product_id,pv.product_id)=${productId}
      AND (
        ${variantId}::bigint IS NULL
        OR q.target_type='PRODUCT'
        OR q.variant_id=${variantId}::bigint
      )
    ORDER BY q.finalized_at DESC,q.id DESC
    LIMIT 200`;
  return rows.map(mapInspection);
}

async function resolveTraceTarget(
  db:DB,
  productId:number|null,
  variantId:number|null
){
  if((productId==null)===(variantId==null)){
    return {error:"exactly_one_trace_target_required",status:400};
  }

  if(variantId!=null){
    const rows=await db`
      SELECT
        pv.id AS variant_id,pv.product_id,pv.sku,pv.size,pv.color,pv.active,
        p.name,p.category,p.brand,p.status,p.commercial_model,p.default_condition
      FROM product_variants pv
      JOIN products p ON p.id=pv.product_id
      WHERE pv.id=${variantId}
      LIMIT 1`;
    if(!rows.length)return {error:"variant_not_found",status:404};
    return {
      productId:Number(rows[0].product_id),
      variantId,
      product:{
        id:Number(rows[0].product_id),
        name:rows[0].name,
        category:rows[0].category||null,
        brand:rows[0].brand||null,
        status:rows[0].status,
        commercialModel:rows[0].commercial_model||null,
        defaultCondition:rows[0].default_condition||null
      }
    };
  }

  const rows=await db`
    SELECT id,name,category,brand,status,commercial_model,default_condition
    FROM products
    WHERE id=${productId}
    LIMIT 1`;
  if(!rows.length)return {error:"product_not_found",status:404};
  return {
    productId:Number(rows[0].id),
    variantId:null,
    product:{
      id:Number(rows[0].id),
      name:rows[0].name,
      category:rows[0].category||null,
      brand:rows[0].brand||null,
      status:rows[0].status,
      commercialModel:rows[0].commercial_model||null,
      defaultCondition:rows[0].default_condition||null
    }
  };
}

async function traceView(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"traceability.read");
  if(!auth.ok)return auth.response;

  const productRaw=url.searchParams.get("productId");
  const variantRaw=url.searchParams.get("variantId");
  const productId=productRaw?Number(productRaw):null;
  const variantId=variantRaw?Number(variantRaw):null;
  if(productId!=null&&(!Number.isSafeInteger(productId)||productId<1)){
    return json({error:"invalid_product"},400);
  }
  if(variantId!=null&&(!Number.isSafeInteger(variantId)||variantId<1)){
    return json({error:"invalid_variant"},400);
  }

  const resolved:any=await resolveTraceTarget(db,productId,variantId);
  if(resolved.error)return json({error:resolved.error},resolved.status||400);

  const canReadCosts=auth.actor.type==="SERVICE" ||
    permissionAllowed(auth.actor.grants,"landed_cost.read");

  const variants=await db`
    SELECT id,sku,size,color,active
    FROM product_variants
    WHERE product_id=${resolved.productId}
      AND (${resolved.variantId}::bigint IS NULL OR id=${resolved.variantId}::bigint)
    ORDER BY id`;
  const variantIds=variants.map((x:any)=>Number(x.id));

  const inventory=variantIds.length
    ?await db`
      SELECT
        i.variant_id,pv.sku,i.location_id,l.name AS location_name,l.type AS location_type,
        i.quantity,i.reserved,i.updated_at
      FROM inventory i
      JOIN product_variants pv ON pv.id=i.variant_id
      JOIN locations l ON l.id=i.location_id
      WHERE pv.product_id=${resolved.productId}
        AND (
          ${resolved.variantId}::bigint IS NULL
          OR i.variant_id=${resolved.variantId}::bigint
        )
      ORDER BY i.variant_id,i.location_id`
    :[];

  const receiptRows=variantIds.length
    ?await db`
      SELECT gri.id
      FROM goods_receipt_items gri
      JOIN product_variants pv ON pv.id=gri.variant_id
      WHERE pv.product_id=${resolved.productId}
        AND (
          ${resolved.variantId}::bigint IS NULL
          OR gri.variant_id=${resolved.variantId}::bigint
        )
      ORDER BY gri.created_at DESC,gri.id DESC
      LIMIT 300`
    :[];

  const procurementLineage=[];
  for(const row of receiptRows){
    const source=await sourceRecord(db,"GOODS_RECEIPT_ITEM",Number(row.id));
    if(!source)continue;
    const qualityLinks=await activeQualityForSource(
      db,
      "GOODS_RECEIPT_ITEM",
      Number(row.id)
    );
    const landedCost=await landedCostForSource(
      db,
      "GOODS_RECEIPT_ITEM",
      Number(row.id),
      canReadCosts
    );
    procurementLineage.push({
      relationship:"DIRECT_SOURCE_EVENT",
      source,
      qualityLinks,
      landedCost,
      inferred:false
    });
  }

  const lotRows=variantIds.length
    ?await db`
      SELECT l.id
      FROM production_lots l
      JOIN product_variants pv ON pv.id=l.variant_id
      WHERE pv.product_id=${resolved.productId}
        AND (
          ${resolved.variantId}::bigint IS NULL
          OR l.variant_id=${resolved.variantId}::bigint
        )
      ORDER BY l.created_at DESC,l.id DESC
      LIMIT 300`
    :[];

  const productionLineage=[];
  for(const row of lotRows){
    const source=await sourceRecord(db,"PRODUCTION_LOT",Number(row.id));
    if(!source)continue;
    const qualityLinks=await activeQualityForSource(
      db,
      "PRODUCTION_LOT",
      Number(row.id)
    );
    const landedCost=await landedCostForSource(
      db,
      "PRODUCTION_LOT",
      Number(row.id),
      canReadCosts
    );
    productionLineage.push({
      relationship:"DIRECT_SOURCE_EVENT",
      source,
      qualityLinks,
      landedCost,
      inferred:false
    });
  }

  const candidates=await qualityCandidates(
    db,
    resolved.productId,
    resolved.variantId
  );

  const gaps:any[]=[];
  if(inventory.some((x:any)=>Number(x.quantity)>0)){
    gaps.push({
      code:"CURRENT_STOCK_NOT_SOURCE_ATTRIBUTED",
      severity:"MODEL_LIMITATION",
      message:"Current inventory is aggregated by variant/location and is not physically attributed to a GoodsReceiptItem or ProductionLot."
    });
  }

  for(const entry of procurementLineage){
    if(!entry.qualityLinks.length){
      gaps.push({
        code:"EXPLICIT_QUALITY_LINK_MISSING",
        severity:"EVIDENCE_GAP",
        sourceType:"GOODS_RECEIPT_ITEM",
        sourceId:entry.source.sourceId
      });
    }
    if(!entry.landedCost){
      gaps.push({
        code:"FINAL_LANDED_COST_MISSING",
        severity:"EVIDENCE_GAP",
        sourceType:"GOODS_RECEIPT_ITEM",
        sourceId:entry.source.sourceId
      });
    }
  }

  for(const entry of productionLineage){
    if(!entry.qualityLinks.length){
      gaps.push({
        code:"EXPLICIT_QUALITY_LINK_MISSING",
        severity:"EVIDENCE_GAP",
        sourceType:"PRODUCTION_LOT",
        sourceId:entry.source.sourceId
      });
    }
    if(!entry.landedCost){
      gaps.push({
        code:"FINAL_LANDED_COST_MISSING",
        severity:"EVIDENCE_GAP",
        sourceType:"PRODUCTION_LOT",
        sourceId:entry.source.sourceId
      });
    }
  }

  return json({
    target:{
      product:resolved.product,
      variantId:resolved.variantId
    },
    variants:variants.map((x:any)=>({
      id:Number(x.id),
      sku:x.sku,
      size:x.size||null,
      color:x.color||null,
      active:Boolean(x.active)
    })),
    currentInventory:{
      sourceAttributed:false,
      attributionLevel:"VARIANT_LOCATION_AGGREGATE_ONLY",
      entries:inventory.map((x:any)=>({
        variantId:Number(x.variant_id),
        sku:x.sku,
        locationId:Number(x.location_id),
        locationName:x.location_name,
        locationType:x.location_type,
        quantity:Number(x.quantity),
        reserved:Number(x.reserved),
        updatedAt:x.updated_at
      }))
    },
    procurementLineage,
    productionLineage,
    qualityCandidates:candidates,
    traceabilityGaps:gaps,
    visibility:{
      landedCost:canReadCosts?"FULL":"REDACTED"
    },
    assertions:{
      unitLevelCurrentStockProvenance:false,
      qualityLinksExplicitOnly:true,
      automaticSourceInference:false,
      inventoryMutated:false
    }
  });
}

export async function handleTraceability(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/traceability"&&req.method==="GET"){
    return traceView(req,url,db);
  }

  if(url.pathname==="/v1/internal/traceability/quality-links"){
    if(req.method==="GET")return listQualityLinks(req,url,db);
    if(req.method==="POST")return createQualityLink(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const linkMatch=url.pathname.match(
    /^\/v1\/internal\/traceability\/quality-links\/(\d+)$/
  );
  if(linkMatch){
    const id=Number(linkMatch[1]);
    if(req.method==="GET")return getQualityLink(req,db,id);
    if(req.method==="PATCH")return updateQualityLink(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if(url.pathname.startsWith("/v1/internal/traceability/")){
    return json({error:"not_found"},404);
  }

  return null;
}
