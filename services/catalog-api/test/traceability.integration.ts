import { SQL } from "bun";

if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true") {
  throw new Error("Refusing destructive integration test without ALLOW_DESTRUCTIVE_TEST_DB=true");
}

const db=new SQL({
  hostname:Bun.env.PGHOST!,
  port:Number(Bun.env.PGPORT||5432),
  username:Bun.env.PGUSER!,
  password:Bun.env.PGPASSWORD!,
  database:Bun.env.PGDATABASE!,
  tls:false,
  max:5
});

const base=Bun.env.API_BASE_URL||"http://127.0.0.1:3011";
let failures=0;

function ok(condition:unknown,message:string){
  if(!condition){failures++;console.error("FAIL",message);}
  else console.log("ok  ",message);
}

async function api(path:string,options:RequestInit={}){
  const response=await fetch(base+path,options);
  const body=await response.json().catch(()=>({}));
  return {response,body};
}

function cookieFrom(response:Response){
  return (response.headers.get("set-cookie")||"").split(";")[0]||"";
}

async function createStaff(roleCode:string,displayName:string){
  const slug=displayName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const email=slug+"-"+crypto.randomUUID().slice(0,8)+"@example.test";
  const password="TRACE-"+crypto.randomUUID()+"-Q9!";
  const hash=await Bun.password.hash(password,{algorithm:"argon2id"});

  const users=await db`
    INSERT INTO staff_users(email_normalized,display_name,password_hash,status,email_verified_at)
    VALUES(${email},${displayName},${hash},'ACTIVE',NOW())
    RETURNING id`;
  const roles=await db`SELECT id FROM roles WHERE code=${roleCode} LIMIT 1`;
  if(!roles.length)throw new Error("role_missing:"+roleCode);
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(roles[0].id)},'GLOBAL',NULL)`;

  const login=await api("/v1/auth/login",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({email,password})
  });

  return {
    userId:Number(users[0].id),
    cookie:cookieFrom(login.response),
    csrf:String(login.body.csrfToken||""),
    login
  };
}

function staffHeaders(session:{cookie:string;csrf:string}){
  return {
    cookie:session.cookie,
    "x-csrf-token":session.csrf,
    "content-type":"application/json"
  };
}

const traceRole=await db`
  INSERT INTO roles(code,name,active)
  VALUES('TRACE_ONLY_CI','Trace only CI',TRUE)
  ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,active=TRUE
  RETURNING id`;
await db`DELETE FROM role_permissions WHERE role_id=${Number(traceRole[0].id)}`;
await db`
  INSERT INTO role_permissions(role_id,permission_code)
  VALUES(${Number(traceRole[0].id)},'traceability.read')
  ON CONFLICT DO NOTHING`;

const manager=await createStaff("MANAGER","Trace Manager CI");
const inventoryReader=await createStaff("INVENTORY_OPERATOR","Trace Inventory Reader CI");
const analyst=await createStaff("ANALYST","Trace Analyst CI");
const traceOnly=await createStaff("TRACE_ONLY_CI","Trace Redacted Reader CI");

ok(manager.login.response.status===200,"Manager inicia sesión");
ok(inventoryReader.login.response.status===200,"Inventory Operator inicia sesión");
ok(analyst.login.response.status===200,"Analyst inicia sesión");
ok(traceOnly.login.response.status===200,"Trace-only inicia sesión");

const locationRows=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Trace CI "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId=Number(locationRows[0].id);

const productRows=await db`
  INSERT INTO products(
    name,slug,category,brand,status,commercial_model,default_condition
  )
  VALUES(
    'Traceability CI Product',
    ${"trace-ci-"+crypto.randomUUID()},
    'Vestuario','MR','active','private_label','new'
  )
  RETURNING id`;
const productId=Number(productRows[0].id);

const variantRows=await db`
  INSERT INTO product_variants(
    product_id,sku,size,color,cost,price,currency,active
  )
  VALUES
    (
      ${productId},${"TRACE-A-"+crypto.randomUUID().slice(0,8)},
      'M','Negro',111.11,700.00,'HNL',TRUE
    ),
    (
      ${productId},${"TRACE-B-"+crypto.randomUUID().slice(0,8)},
      'L','Azul',222.22,800.00,'HNL',TRUE
    )
  RETURNING id,sku`;
const variantId=Number(variantRows[0].id);
const otherVariantId=Number(variantRows[1].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES(${variantId},${locationId},9,2)`;

const supplierRows=await db`
  INSERT INTO suppliers(name,country_code,active,default_currency)
  VALUES('Trace Supplier CI','HN',TRUE,'HNL')
  RETURNING id`;
const supplierId=Number(supplierRows[0].id);

const poRows=await db`
  INSERT INTO purchase_orders(
    po_number,supplier_id,supplier_name_snapshot,supplier_country_code_snapshot,
    destination_location_id,status,currency,subtotal_minor,
    shipping_estimate_minor,tax_estimate_minor,other_costs_minor,grand_total_minor,
    supplier_reference,created_by_service,idempotency_key,idempotency_hash
  )
  VALUES(
    ${"PO-TRACE-"+crypto.randomUUID().slice(0,8)},${supplierId},
    'Trace Supplier Snapshot','HN',${locationId},'RECEIVED','HNL',40000,
    0,0,0,40000,'TRACE-CI','traceability-ci',
    ${"po-trace-"+crypto.randomUUID()},${crypto.randomUUID()}
  )
  RETURNING id,po_number`;
const poId=Number(poRows[0].id);

const poItemRows=await db`
  INSERT INTO purchase_order_items(
    purchase_order_id,variant_id,sku_snapshot,product_name_snapshot,
    quantity_ordered,quantity_received,unit_cost_minor,currency,line_total_minor
  )
  VALUES(
    ${poId},${variantId},${variantRows[0].sku},'Traceability CI Product',
    4,4,10000,'HNL',40000
  )
  RETURNING id`;
const poItemId=Number(poItemRows[0].id);

const receiptRows=await db`
  INSERT INTO goods_receipts(
    receipt_number,purchase_order_id,location_id,status,
    idempotency_key,idempotency_hash,supplier_delivery_reference,received_by_service
  )
  VALUES(
    ${"GR-TRACE-"+crypto.randomUUID().slice(0,8)},${poId},${locationId},'POSTED',
    ${"gr-trace-"+crypto.randomUUID()},${crypto.randomUUID()},
    'TRACE-DELIVERY','traceability-ci'
  )
  RETURNING id,receipt_number`;
const receiptId=Number(receiptRows[0].id);

const receiptItemRows=await db`
  INSERT INTO goods_receipt_items(
    goods_receipt_id,purchase_order_item_id,variant_id,
    quantity_received,unit_cost_minor,currency
  )
  VALUES(${receiptId},${poItemId},${variantId},4,10000,'HNL')
  RETURNING id`;
const receiptItemId=Number(receiptItemRows[0].id);

const manufacturerRows=await db`
  INSERT INTO manufacturers(name,country_code,active)
  VALUES('Trace Factory CI','HN',TRUE)
  RETURNING id`;
const manufacturerId=Number(manufacturerRows[0].id);

const manufacturerLinkRows=await db`
  INSERT INTO manufacturer_links(
    manufacturer_id,target_type,product_id,manufacturer_reference,active
  )
  VALUES(
    ${manufacturerId},'PRODUCT',${productId},'FACTORY-TRACE-REF',TRUE
  )
  RETURNING id`;
const manufacturerLinkId=Number(manufacturerLinkRows[0].id);

const specRows=await db`
  INSERT INTO product_specifications(
    code,title,target_type,product_id,active
  )
  VALUES(
    ${"SPEC-TRACE-"+crypto.randomUUID().slice(0,7)},
    'Trace Production Spec','PRODUCT',${productId},TRUE
  )
  RETURNING id,code`;
const specId=Number(specRows[0].id);

const specVersions=await db`
  INSERT INTO product_specification_versions(
    specification_id,version_no,status,change_summary,
    approved_by_user_id,approved_at
  )
  VALUES
    (
      ${specId},1,'APPROVED','Trace approved spec',
      ${manager.userId},NOW()
    ),
    (
      ${specId},2,'SUPERSEDED','Different trace spec version',
      ${manager.userId},NOW()
    )
  RETURNING id,version_no`;
const approvedSpecVersionId=Number(
  specVersions.find((x:any)=>Number(x.version_no)===1)?.id
);
const wrongSpecVersionId=Number(
  specVersions.find((x:any)=>Number(x.version_no)===2)?.id
);

const runRows=await db`
  INSERT INTO production_runs(
    run_code,product_specification_version_id,manufacturer_link_id,status,
    actual_start_at,actual_end_at,released_by_user_id,released_at,
    completed_by_user_id,completed_at
  )
  VALUES(
    ${"RUN-TRACE-"+crypto.randomUUID().slice(0,8)},
    ${approvedSpecVersionId},${manufacturerLinkId},'COMPLETED',
    NOW()-INTERVAL '3 hours',NOW()-INTERVAL '1 hour',
    ${manager.userId},NOW()-INTERVAL '4 hours',
    ${manager.userId},NOW()-INTERVAL '1 hour'
  )
  RETURNING id,run_code`;
const productionRunId=Number(runRows[0].id);

const lotRows=await db`
  INSERT INTO production_lots(
    production_run_id,lot_code,variant_id,status,
    planned_quantity,produced_quantity,started_at,completed_at
  )
  VALUES(
    ${productionRunId},${"LOT-TRACE-"+crypto.randomUUID().slice(0,8)},
    ${variantId},'COMPLETED',5,5,
    NOW()-INTERVAL '3 hours',NOW()-INTERVAL '1 hour'
  )
  RETURNING id,lot_code`;
const productionLotId=Number(lotRows[0].id);

const qualityRows=await db`
  INSERT INTO quality_inspections(
    inspection_type,target_type,variant_id,specification_version_id,
    inspected_quantity,status,result,rationale,evidence_reference,
    created_by_user_id,updated_by_user_id,finalized_by_user_id,finalized_at
  )
  VALUES
    (
      'RECEIVING','VARIANT',${variantId},NULL,
      4,'FINAL','PASS','Receipt QC passed','receipt-qc-evidence',
      ${manager.userId},${manager.userId},${manager.userId},NOW()
    ),
    (
      'FINAL','VARIANT',${variantId},${approvedSpecVersionId},
      5,'FINAL','PASS','Production QC passed','production-qc-evidence',
      ${manager.userId},${manager.userId},${manager.userId},NOW()
    ),
    (
      'FINAL','VARIANT',${variantId},${wrongSpecVersionId},
      5,'FINAL','PASS','Wrong spec QC','wrong-spec-evidence',
      ${manager.userId},${manager.userId},${manager.userId},NOW()
    ),
    (
      'FINAL','VARIANT',${otherVariantId},NULL,
      1,'FINAL','PASS','Other variant QC','other-variant-evidence',
      ${manager.userId},${manager.userId},${manager.userId},NOW()
    ),
    (
      'IN_PROCESS','VARIANT',${variantId},${approvedSpecVersionId},
      1,'DRAFT','PENDING','Draft QC','draft-evidence',
      ${manager.userId},${manager.userId},NULL,NULL
    )
  RETURNING id,rationale`;

const receiptQcId=Number(
  qualityRows.find((x:any)=>x.rationale==="Receipt QC passed")?.id
);
const productionQcId=Number(
  qualityRows.find((x:any)=>x.rationale==="Production QC passed")?.id
);
const wrongSpecQcId=Number(
  qualityRows.find((x:any)=>x.rationale==="Wrong spec QC")?.id
);
const otherVariantQcId=Number(
  qualityRows.find((x:any)=>x.rationale==="Other variant QC")?.id
);
const draftQcId=Number(
  qualityRows.find((x:any)=>x.rationale==="Draft QC")?.id
);

const receiptCaseRows=await db`
  INSERT INTO landed_cost_cases(
    case_code,source_type,goods_receipt_id,currency,status,allocation_method,
    finalized_by_user_id,finalized_at,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${"LC-TRACE-GR-"+crypto.randomUUID().slice(0,6)},
    'GOODS_RECEIPT',${receiptId},'HNL','FINAL','MANUAL',
    ${manager.userId},NOW(),${manager.userId},${manager.userId}
  )
  RETURNING id,case_code`;
const receiptLandedCaseId=Number(receiptCaseRows[0].id);

await db`
  INSERT INTO landed_cost_allocations(
    case_id,target_type,goods_receipt_item_id,
    allocated_cost_minor,quantity_snapshot,base_unit_cost_minor,base_cost_minor,
    currency,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${receiptLandedCaseId},'GOODS_RECEIPT_ITEM',${receiptItemId},
    2000,4,10000,40000,'HNL',${manager.userId},${manager.userId}
  )`;

const productionCaseRows=await db`
  INSERT INTO landed_cost_cases(
    case_code,source_type,production_run_id,currency,status,allocation_method,
    finalized_by_user_id,finalized_at,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${"LC-TRACE-PR-"+crypto.randomUUID().slice(0,6)},
    'PRODUCTION_RUN',${productionRunId},'HNL','FINAL','MANUAL',
    ${manager.userId},NOW(),${manager.userId},${manager.userId}
  )
  RETURNING id,case_code`;
const productionLandedCaseId=Number(productionCaseRows[0].id);

await db`
  INSERT INTO landed_cost_allocations(
    case_id,target_type,production_lot_id,
    allocated_cost_minor,quantity_snapshot,base_unit_cost_minor,base_cost_minor,
    currency,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${productionLandedCaseId},'PRODUCTION_LOT',${productionLotId},
    55000,5,NULL,NULL,'HNL',${manager.userId},${manager.userId}
  )`;

const baseline={
  inventory:(await db`
    SELECT quantity,reserved FROM inventory
    WHERE variant_id=${variantId} AND location_id=${locationId}`)[0],
  movements:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_movements
    WHERE variant_id=${variantId}`)[0]?.count||0),
  sources:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_sources
    WHERE variant_id=${variantId}`)[0]?.count||0),
  qc:await db`
    SELECT id,status,result,specification_version_id
    FROM quality_inspections
    WHERE id IN (${receiptQcId},${productionQcId})
    ORDER BY id`,
  receipt:(await db`
    SELECT quantity_received,unit_cost_minor,currency
    FROM goods_receipt_items WHERE id=${receiptItemId}`)[0],
  run:(await db`
    SELECT status,product_specification_version_id,manufacturer_link_id
    FROM production_runs WHERE id=${productionRunId}`)[0],
  lot:(await db`
    SELECT status,produced_quantity FROM production_lots
    WHERE id=${productionLotId}`)[0],
  landed:await db`
    SELECT id,status,currency FROM landed_cost_cases
    WHERE id IN (${receiptLandedCaseId},${productionLandedCaseId})
    ORDER BY id`
};

const inventoryTraceRead=await api("/v1/internal/traceability?productId="+productId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(inventoryTraceRead.response.status===200,"Inventory Operator puede leer trazabilidad");

const analystTrace=await api("/v1/internal/traceability?productId="+productId,{
  headers:{cookie:analyst.cookie}
});
ok(
  analystTrace.response.status===403&&analystTrace.body.error==="forbidden",
  "reports.read no concede traceability.read"
);

const readerManage=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(inventoryReader),
  body:JSON.stringify({
    qualityInspectionId:receiptQcId,
    sourceType:"GOODS_RECEIPT_ITEM",
    sourceId:receiptItemId
  })
});
ok(
  readerManage.response.status===403&&readerManage.body.error==="forbidden",
  "traceability.read no concede traceability.manage"
);

const draftLink=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    qualityInspectionId:draftQcId,
    sourceType:"PRODUCTION_LOT",
    sourceId:productionLotId
  })
});
ok(
  draftLink.response.status===409&&draftLink.body.error==="final_quality_inspection_required",
  "solo QC FINAL puede vincularse"
);

const variantMismatch=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    qualityInspectionId:otherVariantQcId,
    sourceType:"GOODS_RECEIPT_ITEM",
    sourceId:receiptItemId
  })
});
ok(
  variantMismatch.response.status===409&&variantMismatch.body.error==="quality_target_variant_mismatch",
  "QC de otra variante no puede vincularse"
);

const specMismatch=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    qualityInspectionId:wrongSpecQcId,
    sourceType:"PRODUCTION_LOT",
    sourceId:productionLotId
  })
});
ok(
  specMismatch.response.status===409&&specMismatch.body.error==="quality_specification_mismatch",
  "ProductionLot exige specification version exacta cuando QC la declara"
);

const receiptLink=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    qualityInspectionId:receiptQcId,
    sourceType:"GOODS_RECEIPT_ITEM",
    sourceId:receiptItemId,
    notes:"Vínculo explícito de receiving QC"
  })
});
ok(receiptLink.response.status===201,"crea vínculo explícito receipt QC");
const receiptLinkId=Number(receiptLink.body.link?.id);
ok(receiptLink.body.link?.relationship==="EXPLICIT","link declara relación EXPLICIT");
ok(receiptLink.body.link?.automaticallyInferred===false,"link declara cero inferencia");

const productionLink=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    qualityInspectionId:productionQcId,
    sourceType:"PRODUCTION_LOT",
    sourceId:productionLotId,
    notes:"Vínculo explícito de final production QC"
  })
});
ok(productionLink.response.status===201,"crea vínculo explícito production QC");
const productionLinkId=Number(productionLink.body.link?.id);

const duplicateLink=await api("/v1/internal/traceability/quality-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    qualityInspectionId:receiptQcId,
    sourceType:"GOODS_RECEIPT_ITEM",
    sourceId:receiptItemId
  })
});
ok(
  duplicateLink.response.status===409&&duplicateLink.body.error==="traceability_quality_link_exists",
  "vínculo exacto duplicado se rechaza"
);

const managerTrace=await api("/v1/internal/traceability?productId="+productId,{
  headers:{cookie:manager.cookie}
});
ok(managerTrace.response.status===200,"Manager obtiene linaje de producto");
ok(managerTrace.body.target?.product?.commercialModel==="private_label","trace expone clasificación comercial");
ok(managerTrace.body.currentInventory?.sourceAttributed===false,"inventario agregado no se atribuye a fuente");
ok(
  managerTrace.body.currentInventory?.entries?.some(
    (x:any)=>Number(x.variantId)===variantId&&Number(x.quantity)===9&&Number(x.reserved)===2
  ),
  "trace conserva inventario agregado observable"
);

const procurementLine=managerTrace.body.procurementLineage?.find(
  (x:any)=>Number(x.source?.sourceId)===receiptItemId
);
ok(Boolean(procurementLine),"trace contiene GoodsReceiptItem directo");
ok(procurementLine?.relationship==="DIRECT_SOURCE_EVENT"&&procurementLine?.inferred===false,"procurement lineage no es inferido");
ok(procurementLine?.source?.procurement?.supplierNameSnapshot==="Trace Supplier Snapshot","trace conserva supplier snapshot");
ok(
  procurementLine?.qualityLinks?.some(
    (x:any)=>Number(x.qualityInspection?.id)===receiptQcId&&x.relationship==="EXPLICIT"
  ),
  "receipt lineage incluye únicamente QC explícitamente vinculado"
);
ok(
  procurementLine?.landedCost?.visibility==="FULL" &&
  Number(procurementLine?.landedCost?.allocatedCostMinor)===2000 &&
  Number(procurementLine?.landedCost?.totalCostMinor)===42000,
  "Manager con landed_cost.read ve costeo receipt"
);

const productionLine=managerTrace.body.productionLineage?.find(
  (x:any)=>Number(x.source?.sourceId)===productionLotId
);
ok(Boolean(productionLine),"trace contiene ProductionLot directo");
ok(
  Number(productionLine?.source?.production?.specification?.versionId)===approvedSpecVersionId &&
  productionLine?.source?.production?.manufacturer?.name==="Trace Factory CI",
  "production lineage conserva specification y fabricante explícitos"
);
ok(
  productionLine?.qualityLinks?.some(
    (x:any)=>Number(x.qualityInspection?.id)===productionQcId
  ),
  "production lineage incluye QC explícito"
);
ok(
  productionLine?.landedCost?.visibility==="FULL" &&
  Number(productionLine?.landedCost?.allocatedCostMinor)===55000 &&
  Number(productionLine?.landedCost?.totalCostMinor)===55000,
  "Manager ve Landed Cost FINAL de producción"
);

ok(
  managerTrace.body.traceabilityGaps?.some(
    (x:any)=>x.code==="CURRENT_STOCK_NOT_SOURCE_ATTRIBUTED"
  ),
  "trace declara limitación de current-stock provenance"
);
ok(managerTrace.body.assertions?.unitLevelCurrentStockProvenance===false,"no afirma unit-level provenance");
ok(managerTrace.body.assertions?.qualityLinksExplicitOnly===true,"declara quality links explícitos solamente");
ok(managerTrace.body.assertions?.automaticSourceInference===false,"declara cero source inference");

const redactedTrace=await api("/v1/internal/traceability?variantId="+variantId,{
  headers:{cookie:traceOnly.cookie}
});
ok(redactedTrace.response.status===200,"trace-only puede leer linaje de variante");
ok(redactedTrace.body.visibility?.landedCost==="REDACTED","traceability.read no sustituye landed_cost.read");
const redactedReceipt=redactedTrace.body.procurementLineage?.find(
  (x:any)=>Number(x.source?.sourceId)===receiptItemId
);
const redactedProduction=redactedTrace.body.productionLineage?.find(
  (x:any)=>Number(x.source?.sourceId)===productionLotId
);
ok(
  redactedReceipt?.landedCost?.visibility==="REDACTED" &&
  redactedReceipt?.landedCost?.allocatedCostMinor==null,
  "receipt cost amounts quedan ocultos sin landed_cost.read"
);
ok(
  redactedProduction?.landedCost?.visibility==="REDACTED" &&
  redactedProduction?.landedCost?.allocatedCostMinor==null,
  "production cost amounts quedan ocultos sin landed_cost.read"
);

const linkList=await api("/v1/internal/traceability/quality-links?productId="+productId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(linkList.response.status===200,"lista vínculos explícitos por producto");
ok(
  Array.isArray(linkList.body.data)&&
  linkList.body.data.some((x:any)=>Number(x.id)===receiptLinkId)&&
  linkList.body.data.some((x:any)=>Number(x.id)===productionLinkId),
  "lista contiene ambos vínculos explícitos"
);

const deactivate=await api("/v1/internal/traceability/quality-links/"+productionLinkId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    active:false,
    notes:"Pausa de vínculo",
    changeNote:"Prueba de ciclo active"
  })
});
ok(deactivate.response.status===200&&deactivate.body.link?.active===false,"desactiva vínculo sin borrar historia");
ok(Array.isArray(deactivate.body.history)&&deactivate.body.history.length===2,"historial conserva CREATED + UPDATED");

const afterDeactivate=await api("/v1/internal/traceability?variantId="+variantId,{
  headers:{cookie:manager.cookie}
});
const prodAfterDeactivate=afterDeactivate.body.productionLineage?.find(
  (x:any)=>Number(x.source?.sourceId)===productionLotId
);
ok(
  !prodAfterDeactivate?.qualityLinks?.some((x:any)=>Number(x.id)===productionLinkId),
  "vínculo inactivo no se presenta como evidencia activa"
);
ok(
  afterDeactivate.body.traceabilityGaps?.some(
    (x:any)=>x.code==="EXPLICIT_QUALITY_LINK_MISSING"&&
      x.sourceType==="PRODUCTION_LOT"&&
      Number(x.sourceId)===productionLotId
  ),
  "desactivar vínculo vuelve visible el gap de evidencia"
);

const reactivate=await api("/v1/internal/traceability/quality-links/"+productionLinkId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    active:true,
    notes:"Vínculo restaurado",
    changeNote:"Reactivación explícita"
  })
});
ok(reactivate.response.status===200&&reactivate.body.link?.active===true,"reactiva vínculo con revalidación");

const after={
  inventory:(await db`
    SELECT quantity,reserved FROM inventory
    WHERE variant_id=${variantId} AND location_id=${locationId}`)[0],
  movements:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_movements
    WHERE variant_id=${variantId}`)[0]?.count||0),
  sources:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_sources
    WHERE variant_id=${variantId}`)[0]?.count||0),
  qc:await db`
    SELECT id,status,result,specification_version_id
    FROM quality_inspections
    WHERE id IN (${receiptQcId},${productionQcId})
    ORDER BY id`,
  receipt:(await db`
    SELECT quantity_received,unit_cost_minor,currency
    FROM goods_receipt_items WHERE id=${receiptItemId}`)[0],
  run:(await db`
    SELECT status,product_specification_version_id,manufacturer_link_id
    FROM production_runs WHERE id=${productionRunId}`)[0],
  lot:(await db`
    SELECT status,produced_quantity FROM production_lots
    WHERE id=${productionLotId}`)[0],
  landed:await db`
    SELECT id,status,currency FROM landed_cost_cases
    WHERE id IN (${receiptLandedCaseId},${productionLandedCaseId})
    ORDER BY id`
};

ok(
  Number(after.inventory.quantity)===Number(baseline.inventory.quantity)&&
  Number(after.inventory.reserved)===Number(baseline.inventory.reserved),
  "traceability no cambia quantity/reserved"
);
ok(after.movements===baseline.movements,"traceability no crea inventory_movements");
ok(after.sources===baseline.sources,"traceability no crea ni modifica InventorySource");
ok(JSON.stringify(after.qc)===JSON.stringify(baseline.qc),"traceability no cambia QualityInspection");
ok(
  Number(after.receipt.quantity_received)===Number(baseline.receipt.quantity_received)&&
  Number(after.receipt.unit_cost_minor)===Number(baseline.receipt.unit_cost_minor)&&
  after.receipt.currency===baseline.receipt.currency,
  "traceability no cambia GoodsReceiptItem"
);
ok(JSON.stringify(after.run)===JSON.stringify(baseline.run),"traceability no cambia ProductionRun");
ok(JSON.stringify(after.lot)===JSON.stringify(baseline.lot),"traceability no cambia ProductionLot");
ok(JSON.stringify(after.landed)===JSON.stringify(baseline.landed),"traceability no cambia LandedCost");

const audits=await db`
  SELECT action,resource_id
  FROM audit_events
  WHERE resource_type='TraceabilityQualityLink'
    AND resource_id IN (${String(receiptLinkId)},${String(productionLinkId)})
  ORDER BY id`;
ok(
  audits.filter((x:any)=>x.action==="traceability.quality_link.created").length===2,
  "creaciones de links quedan auditadas"
);
ok(
  audits.filter((x:any)=>x.action==="traceability.quality_link.updated").length>=2,
  "cambios de links quedan auditados"
);

const unauth=await api("/v1/internal/traceability?productId="+productId);
ok(unauth.response.status===401,"traceability interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Provenance & Traceability v1");
await db.close();
