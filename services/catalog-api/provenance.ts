import { machineAuthorized, readStaffSession } from "./auth";

type DB=any;

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

async function readScope(req:Request,db:DB){
  if(machineAuthorized(req)){
    return {
      ok:true as const,
      actor:{type:"SERVICE" as const,service:"internal-api"},
      global:true,
      locationIds:[] as number[]
    };
  }

  const actor=await readStaffSession(req,db);
  if(!actor)return {ok:false as const,response:json({error:"unauthorized"},401)};

  const relevant=actor.grants.filter((g:any)=>g.permission==="provenance.read");
  if(!relevant.length){
    return {ok:false as const,response:json({error:"forbidden"},403)};
  }

  const global=relevant.some((g:any)=>g.scopeType==="GLOBAL");
  const locationIds=[
    ...new Set(
      relevant
        .filter((g:any)=>g.scopeType==="LOCATION"&&g.locationId!=null)
        .map((g:any)=>Number(g.locationId))
    )
  ];

  return {ok:true as const,actor,global,locationIds};
}

function locationAllowed(scope:any,locationId:number){
  return scope.global||scope.locationIds.includes(Number(locationId));
}

async function variantBase(db:DB,variantId:number){
  const rows=await db`
    SELECT
      pv.id,pv.product_id,pv.sku,pv.barcode,pv.size,pv.color,pv.active,
      p.name AS product_name,p.slug,p.category,p.brand,p.status AS product_status,
      p.commercial_model,p.default_condition
    FROM product_variants pv
    JOIN products p ON p.id=pv.product_id
    WHERE pv.id=${variantId}
    LIMIT 1`;
  if(!rows.length)return null;
  const r=rows[0];
  return {
    id:Number(r.id),
    productId:Number(r.product_id),
    sku:r.sku,
    barcode:r.barcode||null,
    size:r.size||null,
    color:r.color||null,
    active:Boolean(r.active),
    product:{
      id:Number(r.product_id),
      name:r.product_name,
      slug:r.slug,
      category:r.category||null,
      brand:r.brand||null,
      status:r.product_status,
      commercialModel:r.commercial_model||null,
      defaultCondition:r.default_condition||null
    }
  };
}

async function procurementRows(db:DB,variantId:number){
  return db`
    SELECT
      gri.id AS goods_receipt_item_id,
      gri.goods_receipt_id,gri.quantity_received,gri.unit_cost_minor,gri.currency,
      gr.receipt_number,gr.location_id,loc.name AS location_name,gr.received_at,
      gr.supplier_delivery_reference,
      poi.id AS purchase_order_item_id,poi.origin_country_code,poi.supplier_sku,
      po.id AS purchase_order_id,po.po_number,po.status AS purchase_order_status,
      po.supplier_id,po.supplier_name_snapshot,po.supplier_country_code_snapshot,
      im.id AS inventory_movement_id,im.quantity AS inventory_movement_quantity,
      im.reference AS inventory_movement_reference,
      lca.id AS landed_cost_allocation_id,lca.allocated_cost_minor,
      lca.quantity_snapshot AS landed_quantity_snapshot,
      lca.base_unit_cost_minor,lca.base_cost_minor,
      lcc.id AS landed_cost_case_id,lcc.case_code,lcc.status AS landed_cost_status,
      lcc.currency AS landed_cost_currency,lcc.finalized_at AS landed_cost_finalized_at
    FROM goods_receipt_items gri
    JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id
    JOIN locations loc ON loc.id=gr.location_id
    JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id
    JOIN purchase_orders po ON po.id=gr.purchase_order_id
    LEFT JOIN inventory_movements im
      ON im.variant_id=gri.variant_id
      AND im.location_id=gr.location_id
      AND im.movement_type='PURCHASE_RECEIPT'
      AND im.reference=('goods_receipt:' || gr.receipt_number)
    LEFT JOIN landed_cost_allocations lca
      ON lca.goods_receipt_item_id=gri.id
    LEFT JOIN landed_cost_cases lcc
      ON lcc.id=lca.case_id
    WHERE gri.variant_id=${variantId}
    ORDER BY gr.received_at DESC,gri.id DESC`;
}

function mapProcurement(r:any){
  return {
    goodsReceiptItemId:Number(r.goods_receipt_item_id),
    goodsReceipt:{
      id:Number(r.goods_receipt_id),
      receiptNumber:r.receipt_number,
      locationId:Number(r.location_id),
      locationName:r.location_name,
      receivedAt:r.received_at,
      supplierDeliveryReference:r.supplier_delivery_reference||null
    },
    purchaseOrder:{
      id:Number(r.purchase_order_id),
      itemId:Number(r.purchase_order_item_id),
      poNumber:r.po_number,
      status:r.purchase_order_status,
      supplierId:Number(r.supplier_id),
      supplierName:r.supplier_name_snapshot,
      supplierCountryCode:r.supplier_country_code_snapshot||null,
      supplierSku:r.supplier_sku||null,
      originCountryCode:r.origin_country_code||null
    },
    receiptEconomics:{
      quantityReceived:Number(r.quantity_received),
      unitCostMinor:Number(r.unit_cost_minor),
      currency:r.currency,
      baseCostMinor:Number(r.quantity_received)*Number(r.unit_cost_minor)
    },
    inventoryMovement:r.inventory_movement_id==null?null:{
      id:Number(r.inventory_movement_id),
      movementType:"PURCHASE_RECEIPT",
      quantity:Number(r.inventory_movement_quantity),
      reference:r.inventory_movement_reference
    },
    landedCost:r.landed_cost_case_id==null?null:{
      caseId:Number(r.landed_cost_case_id),
      caseCode:r.case_code,
      status:r.landed_cost_status,
      currency:r.landed_cost_currency,
      finalizedAt:r.landed_cost_finalized_at||null,
      allocationId:Number(r.landed_cost_allocation_id),
      allocatedCostMinor:Number(r.allocated_cost_minor),
      quantitySnapshot:Number(r.landed_quantity_snapshot),
      baseUnitCostMinor:r.base_unit_cost_minor==null?null:Number(r.base_unit_cost_minor),
      baseCostMinor:r.base_cost_minor==null?null:Number(r.base_cost_minor)
    }
  };
}

async function inventorySourceRows(db:DB,variantId:number){
  return db`
    SELECT
      i.id,i.location_id,l.name AS location_name,i.source_type,i.commercial_mode,
      i.economic_owner_type,i.seller_id,sa.display_name AS seller_name,
      i.seller_agreement_id,i.supplier_id,s.name AS supplier_name,
      i.procurement_lot_id,i.currency,i.cost_basis_minor,i.status,
      i.effective_from,i.effective_to,i.created_at,i.updated_at
    FROM inventory_sources i
    JOIN locations l ON l.id=i.location_id
    LEFT JOIN seller_accounts sa ON sa.id=i.seller_id
    LEFT JOIN suppliers s ON s.id=i.supplier_id
    WHERE i.variant_id=${variantId}
    ORDER BY i.status='ACTIVE' DESC,i.updated_at DESC,i.id DESC`;
}

function mapInventorySource(r:any){
  return {
    id:Number(r.id),
    locationId:Number(r.location_id),
    locationName:r.location_name,
    sourceType:r.source_type,
    commercialMode:r.commercial_mode,
    economicOwnerType:r.economic_owner_type,
    sellerId:r.seller_id==null?null:Number(r.seller_id),
    sellerName:r.seller_name||null,
    sellerAgreementId:r.seller_agreement_id==null?null:Number(r.seller_agreement_id),
    supplierId:r.supplier_id==null?null:Number(r.supplier_id),
    supplierName:r.supplier_name||null,
    procurementLotId:r.procurement_lot_id==null?null:Number(r.procurement_lot_id),
    currency:r.currency,
    costBasisMinor:r.cost_basis_minor==null?null:Number(r.cost_basis_minor),
    status:r.status,
    effectiveFrom:r.effective_from,
    effectiveTo:r.effective_to||null,
    explicitGoodsReceiptLink:false,
    linkNote:"inventory_sources.procurement_lot_id is not an authoritative GoodsReceipt foreign key in v1"
  };
}

async function inventoryRows(db:DB,variantId:number){
  return db`
    SELECT i.location_id,l.name AS location_name,i.quantity,i.reserved,i.updated_at
    FROM inventory i
    JOIN locations l ON l.id=i.location_id
    WHERE i.variant_id=${variantId}
    ORDER BY l.name,i.location_id`;
}

async function productionRows(db:DB,variantId:number){
  return db`
    SELECT
      pl.id AS production_lot_id,pl.lot_code,pl.status AS lot_status,
      pl.planned_quantity,pl.produced_quantity,pl.started_at,pl.completed_at,
      r.id AS production_run_id,r.run_code,r.status AS run_status,
      r.product_specification_version_id,r.manufacturer_link_id,
      r.released_at,r.completed_at AS run_completed_at,
      psv.version_no,psv.status AS specification_version_status,
      ps.id AS specification_id,ps.code AS specification_code,ps.title AS specification_title,
      ml.target_type AS manufacturer_link_target_type,
      m.id AS manufacturer_id,m.name AS manufacturer_name,m.country_code AS manufacturer_country_code,
      lca.id AS landed_cost_allocation_id,lca.allocated_cost_minor,
      lca.quantity_snapshot AS landed_quantity_snapshot,
      lcc.id AS landed_cost_case_id,lcc.case_code,lcc.status AS landed_cost_status,
      lcc.currency AS landed_cost_currency,lcc.finalized_at AS landed_cost_finalized_at
    FROM production_lots pl
    JOIN production_runs r ON r.id=pl.production_run_id
    JOIN product_specification_versions psv ON psv.id=r.product_specification_version_id
    JOIN product_specifications ps ON ps.id=psv.specification_id
    JOIN manufacturer_links ml ON ml.id=r.manufacturer_link_id
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    LEFT JOIN landed_cost_allocations lca ON lca.production_lot_id=pl.id
    LEFT JOIN landed_cost_cases lcc ON lcc.id=lca.case_id
    WHERE pl.variant_id=${variantId}
    ORDER BY pl.created_at DESC,pl.id DESC`;
}

function mapProduction(r:any){
  return {
    productionLot:{
      id:Number(r.production_lot_id),
      lotCode:r.lot_code,
      status:r.lot_status,
      plannedQuantity:Number(r.planned_quantity),
      producedQuantity:Number(r.produced_quantity),
      startedAt:r.started_at||null,
      completedAt:r.completed_at||null
    },
    productionRun:{
      id:Number(r.production_run_id),
      runCode:r.run_code,
      status:r.run_status,
      releasedAt:r.released_at||null,
      completedAt:r.run_completed_at||null
    },
    specificationVersion:{
      id:Number(r.product_specification_version_id),
      specificationId:Number(r.specification_id),
      specificationCode:r.specification_code,
      specificationTitle:r.specification_title,
      versionNo:Number(r.version_no),
      status:r.specification_version_status
    },
    manufacturer:{
      manufacturerLinkId:Number(r.manufacturer_link_id),
      linkTargetType:r.manufacturer_link_target_type,
      id:Number(r.manufacturer_id),
      name:r.manufacturer_name,
      countryCode:r.manufacturer_country_code||null
    },
    landedCost:r.landed_cost_case_id==null?null:{
      caseId:Number(r.landed_cost_case_id),
      caseCode:r.case_code,
      status:r.landed_cost_status,
      currency:r.landed_cost_currency,
      finalizedAt:r.landed_cost_finalized_at||null,
      allocationId:Number(r.landed_cost_allocation_id),
      allocatedCostMinor:Number(r.allocated_cost_minor),
      quantitySnapshot:Number(r.landed_quantity_snapshot)
    }
  };
}

async function qualityContextRows(db:DB,variantId:number,productId:number){
  return db`
    SELECT
      q.id,q.inspection_type,q.target_type,q.product_id,q.variant_id,
      q.specification_version_id,q.inspected_quantity,q.status,q.result,
      q.rationale,q.sample_reference,q.evidence_reference,q.aql_reference,
      q.finalized_at,q.created_at,
      psv.version_no,ps.id AS specification_id,ps.code AS specification_code
    FROM quality_inspections q
    LEFT JOIN product_specification_versions psv ON psv.id=q.specification_version_id
    LEFT JOIN product_specifications ps ON ps.id=psv.specification_id
    WHERE q.status='FINAL'
      AND (
        q.variant_id=${variantId}
        OR q.product_id=${productId}
      )
    ORDER BY q.finalized_at DESC NULLS LAST,q.id DESC
    LIMIT 100`;
}

function mapQualityContext(r:any){
  return {
    inspectionId:Number(r.id),
    inspectionType:r.inspection_type,
    targetType:r.target_type,
    productId:r.product_id==null?null:Number(r.product_id),
    variantId:r.variant_id==null?null:Number(r.variant_id),
    specificationVersion:r.specification_version_id==null?null:{
      id:Number(r.specification_version_id),
      versionNo:Number(r.version_no),
      specificationId:Number(r.specification_id),
      specificationCode:r.specification_code
    },
    inspectedQuantity:Number(r.inspected_quantity),
    result:r.result,
    rationale:r.rationale||null,
    sampleReference:r.sample_reference||null,
    evidenceReference:r.evidence_reference||null,
    aqlReference:r.aql_reference||null,
    finalizedAt:r.finalized_at||null,
    explicitProductionLotLink:false,
    linkNote:"QualityInspection has no production_lot_id in v1; this is compatible product/variant context only"
  };
}

async function manufacturerCapabilityRows(db:DB,variantId:number,productId:number){
  return db`
    SELECT
      ml.id,ml.target_type,ml.product_id,ml.variant_id,ml.manufacturer_reference,
      ml.active AS link_active,m.id AS manufacturer_id,m.name AS manufacturer_name,
      m.country_code,m.city,m.active AS manufacturer_active
    FROM manufacturer_links ml
    JOIN manufacturers m ON m.id=ml.manufacturer_id
    WHERE
      (ml.target_type='VARIANT' AND ml.variant_id=${variantId})
      OR
      (ml.target_type='PRODUCT' AND ml.product_id=${productId})
    ORDER BY ml.active DESC,m.active DESC,ml.id DESC`;
}

async function listVariants(req:Request,url:URL,db:DB){
  const scope=await readScope(req,db);
  if(!scope.ok)return scope.response;

  const q=clean(url.searchParams.get("q"),120);
  const variants=await db`
    SELECT
      pv.id,pv.product_id,pv.sku,pv.size,pv.color,pv.active,
      p.name AS product_name,p.category,p.commercial_model
    FROM product_variants pv
    JOIN products p ON p.id=pv.product_id
    WHERE
      ${q||null}::text IS NULL
      OR pv.sku ILIKE '%' || ${q||null}::text || '%'
      OR p.name ILIKE '%' || ${q||null}::text || '%'
    ORDER BY p.name,pv.sku,pv.id
    LIMIT 300`;

  if(scope.global){
    return json({data:variants.map((r:any)=>({
      id:Number(r.id),
      productId:Number(r.product_id),
      sku:r.sku,
      size:r.size||null,
      color:r.color||null,
      active:Boolean(r.active),
      productName:r.product_name,
      category:r.category||null,
      commercialModel:r.commercial_model||null
    }))});
  }

  const receiptAccess=await db`
    SELECT DISTINCT gri.variant_id,gr.location_id
    FROM goods_receipt_items gri
    JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id`;
  const sourceAccess=await db`
    SELECT DISTINCT variant_id,location_id
    FROM inventory_sources`;

  const allowed=new Set<number>();
  for(const r of [...receiptAccess,...sourceAccess]){
    if(scope.locationIds.includes(Number(r.location_id))){
      allowed.add(Number(r.variant_id));
    }
  }

  return json({
    data:variants
      .filter((r:any)=>allowed.has(Number(r.id)))
      .map((r:any)=>({
        id:Number(r.id),
        productId:Number(r.product_id),
        sku:r.sku,
        size:r.size||null,
        color:r.color||null,
        active:Boolean(r.active),
        productName:r.product_name,
        category:r.category||null,
        commercialModel:r.commercial_model||null
      }))
  });
}

async function variantTrace(req:Request,db:DB,variantId:number){
  const scope=await readScope(req,db);
  if(!scope.ok)return scope.response;

  const variant=await variantBase(db,variantId);
  if(!variant)return json({error:"variant_not_found"},404);

  const procurement=(await procurementRows(db,variantId))
    .filter((r:any)=>locationAllowed(scope,Number(r.location_id)))
    .map(mapProcurement);

  const inventorySources=(await inventorySourceRows(db,variantId))
    .filter((r:any)=>locationAllowed(scope,Number(r.location_id)))
    .map(mapInventorySource);

  const inventoryLevels=(await inventoryRows(db,variantId))
    .filter((r:any)=>locationAllowed(scope,Number(r.location_id)))
    .map((r:any)=>({
      locationId:Number(r.location_id),
      locationName:r.location_name,
      quantity:Number(r.quantity),
      reserved:Number(r.reserved),
      available:Number(r.quantity)-Number(r.reserved),
      updatedAt:r.updated_at
    }));

  if(
    !scope.global &&
    procurement.length===0 &&
    inventorySources.length===0 &&
    inventoryLevels.length===0
  ){
    return json({error:"forbidden"},403);
  }

  const production=scope.global
    ?(await productionRows(db,variantId)).map(mapProduction)
    :[];

  const qualityContext=scope.global
    ?(await qualityContextRows(db,variantId,variant.product.id)).map(mapQualityContext)
    :[];

  const manufacturerCapabilities=scope.global
    ?(await manufacturerCapabilityRows(db,variantId,variant.product.id)).map((r:any)=>({
      manufacturerLinkId:Number(r.id),
      targetType:r.target_type,
      productId:r.product_id==null?null:Number(r.product_id),
      variantId:r.variant_id==null?null:Number(r.variant_id),
      manufacturerReference:r.manufacturer_reference||null,
      linkActive:Boolean(r.link_active),
      manufacturer:{
        id:Number(r.manufacturer_id),
        name:r.manufacturer_name,
        countryCode:r.country_code||null,
        city:r.city||null,
        active:Boolean(r.manufacturer_active)
      },
      evidenceLevel:"CAPABILITY_ONLY",
      provesProduction:false
    }))
    :[];

  const hardLandedCostCount=
    procurement.filter((x:any)=>x.landedCost).length+
    production.filter((x:any)=>x.landedCost).length;

  return json({
    variant,
    visibility:{
      global:scope.global,
      locationIds:scope.global?[]:scope.locationIds,
      productionVisible:scope.global
    },
    authoritativeLineage:{
      procurement,
      production,
      landedCostAllocationCount:hardLandedCostCount
    },
    currentContext:{
      inventoryLevels,
      inventorySources,
      manufacturerCapabilities,
      qualityContext
    },
    limitations:{
      qualityInspectionExplicitProductionLotLink:false,
      inventorySourceExplicitGoodsReceiptLink:false,
      inferredTextOrTimeLinks:false,
      note:"Context records are not promoted to hard provenance edges without explicit keys."
    },
    traceabilityFacts:{
      hasProcurementEvidence:procurement.length>0,
      hasProductionEvidence:production.length>0,
      hasExplicitLandedCostEvidence:hardLandedCostCount>0,
      hasInventoryMovementEvidence:procurement.some((x:any)=>x.inventoryMovement!=null),
      hasQualityContext:qualityContext.length>0,
      hasManufacturerCapabilityContext:manufacturerCapabilities.length>0
    },
    readOnly:true
  });
}

async function receiptItemTrace(req:Request,db:DB,id:number){
  const scope=await readScope(req,db);
  if(!scope.ok)return scope.response;

  const rows=await db`
    SELECT
      gri.id,gri.variant_id,gr.location_id
    FROM goods_receipt_items gri
    JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id
    WHERE gri.id=${id}
    LIMIT 1`;
  if(!rows.length)return json({error:"goods_receipt_item_not_found"},404);
  const row=rows[0];

  if(!locationAllowed(scope,Number(row.location_id))){
    return json({error:"forbidden"},403);
  }

  const variant=await variantBase(db,Number(row.variant_id));
  const procurement=(await procurementRows(db,Number(row.variant_id)))
    .find((x:any)=>Number(x.goods_receipt_item_id)===id);
  const sources=(await inventorySourceRows(db,Number(row.variant_id)))
    .filter((x:any)=>Number(x.location_id)===Number(row.location_id))
    .map(mapInventorySource);

  return json({
    variant,
    lineage:procurement?mapProcurement(procurement):null,
    inventorySourceContext:sources,
    limitations:{
      inventorySourceExplicitGoodsReceiptLink:false,
      inferredTextOrTimeLinks:false
    },
    readOnly:true
  });
}

async function productionLotTrace(req:Request,db:DB,id:number){
  const scope=await readScope(req,db);
  if(!scope.ok)return scope.response;
  if(!scope.global)return json({error:"forbidden"},403);

  const rows=await db`
    SELECT variant_id
    FROM production_lots
    WHERE id=${id}
    LIMIT 1`;
  if(!rows.length)return json({error:"production_lot_not_found"},404);
  const variantId=Number(rows[0].variant_id);
  const variant=await variantBase(db,variantId);
  if(!variant)return json({error:"variant_not_found"},404);

  const productionRow=(await productionRows(db,variantId))
    .find((x:any)=>Number(x.production_lot_id)===id);
  if(!productionRow)return json({error:"production_lot_not_found"},404);
  const production=mapProduction(productionRow);

  const qRows=await qualityContextRows(db,variantId,variant.product.id);
  const qualityContext=qRows
    .filter((q:any)=>
      q.specification_version_id==null ||
      Number(q.specification_version_id)===Number(production.specificationVersion.id)
    )
    .map(mapQualityContext);

  return json({
    variant,
    lineage:production,
    qualityContext,
    limitations:{
      qualityInspectionExplicitProductionLotLink:false,
      inferredTextOrTimeLinks:false,
      note:"Quality context is filtered by variant/product and compatible specification only."
    },
    readOnly:true
  });
}

export async function handleProvenance(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/provenance/variants"){
    if(req.method==="GET")return listVariants(req,url,db);
    return json({error:"method_not_allowed"},405);
  }

  const variant=url.pathname.match(/^\/v1\/internal\/provenance\/variants\/(\d+)$/);
  if(variant){
    if(req.method==="GET")return variantTrace(req,db,Number(variant[1]));
    return json({error:"method_not_allowed"},405);
  }

  const receipt=url.pathname.match(/^\/v1\/internal\/provenance\/goods-receipt-items\/(\d+)$/);
  if(receipt){
    if(req.method==="GET")return receiptItemTrace(req,db,Number(receipt[1]));
    return json({error:"method_not_allowed"},405);
  }

  const lot=url.pathname.match(/^\/v1\/internal\/provenance\/production-lots\/(\d+)$/);
  if(lot){
    if(req.method==="GET")return productionLotTrace(req,db,Number(lot[1]));
    return json({error:"method_not_allowed"},405);
  }

  if(url.pathname.startsWith("/v1/internal/provenance/")){
    return req.method==="GET"
      ?json({error:"not_found"},404)
      :json({error:"method_not_allowed"},405);
  }

  return null;
}
