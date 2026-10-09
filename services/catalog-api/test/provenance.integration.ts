import { SQL } from "bun";

if(Bun.env.ALLOW_DESTRUCTIVE_TEST_DB!=="true"){
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
const serviceKey=Bun.env.INTERNAL_API_TOKEN||"ci-internal-token";
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

async function createStaff(
  roleCode:string,
  displayName:string,
  scopeType:"GLOBAL"|"LOCATION"="GLOBAL",
  locationId:number|null=null
){
  const slug=displayName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const email=slug+"-"+crypto.randomUUID().slice(0,8)+"@example.test";
  const password="PROV-"+crypto.randomUUID()+"-R9!";
  const hash=await Bun.password.hash(password,{algorithm:"argon2id"});

  const users=await db`
    INSERT INTO staff_users(email_normalized,display_name,password_hash,status,email_verified_at)
    VALUES(${email},${displayName},${hash},'ACTIVE',NOW())
    RETURNING id`;
  const roles=await db`SELECT id FROM roles WHERE code=${roleCode} LIMIT 1`;
  if(!roles.length)throw new Error("role_missing:"+roleCode);

  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(
      ${Number(users[0].id)},${Number(roles[0].id)},${scopeType},
      ${scopeType==="LOCATION"?locationId:null}
    )`;

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

const locationA=Number((await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Provenance A "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`)[0].id);
const locationB=Number((await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Provenance B "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`)[0].id);

const manager=await createStaff("MANAGER","Provenance Manager CI");
const readerA=await createStaff("INVENTORY_OPERATOR","Provenance Reader A CI","LOCATION",locationA);
const readerB=await createStaff("INVENTORY_OPERATOR","Provenance Reader B CI","LOCATION",locationB);
const analyst=await createStaff("ANALYST","Provenance Analyst CI");

ok(manager.login.response.status===200,"manager inicia sesión");
ok(readerA.login.response.status===200,"reader A inicia sesión");
ok(readerB.login.response.status===200,"reader B inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const productId=Number((await db`
  INSERT INTO products(
    name,slug,category,brand,status,commercial_model,default_condition
  )
  VALUES(
    'Provenance CI Product',
    ${"provenance-ci-"+crypto.randomUUID()},
    'Vestuario','MR','draft','private_label','new'
  )
  RETURNING id`)[0].id);

const variantId=Number((await db`
  INSERT INTO product_variants(
    product_id,sku,size,color,cost,price,currency,active
  )
  VALUES(
    ${productId},
    ${"PROV-CI-"+crypto.randomUUID().slice(0,8)},
    'M','Negro',77,1200,'HNL',TRUE
  )
  RETURNING id`)[0].id);

const isolatedVariantId=Number((await db`
  INSERT INTO product_variants(
    product_id,sku,size,color,cost,price,currency,active
  )
  VALUES(
    ${productId},
    ${"PROV-ISO-"+crypto.randomUUID().slice(0,8)},
    'L','Azul',88,1300,'HNL',TRUE
  )
  RETURNING id`)[0].id);

const supplier=await db`
  INSERT INTO suppliers(name,country_code,active)
  VALUES('Provenance Supplier CI','HN',TRUE)
  RETURNING id,name,country_code`;
const supplierId=Number(supplier[0].id);

const po=await db`
  INSERT INTO purchase_orders(
    po_number,supplier_id,supplier_name_snapshot,supplier_country_code_snapshot,
    destination_location_id,status,currency,subtotal_minor,
    shipping_estimate_minor,tax_estimate_minor,other_costs_minor,grand_total_minor,
    supplier_reference,created_by_service,idempotency_key,idempotency_hash
  )
  VALUES(
    ${"PO-PROV-"+crypto.randomUUID().slice(0,8)},
    ${supplierId},'Provenance Supplier CI','HN',
    ${locationA},'RECEIVED','HNL',40000,
    0,0,0,40000,'PROV-PO','provenance-test',
    ${"prov-po-"+crypto.randomUUID()},${crypto.randomUUID()}
  )
  RETURNING id,po_number`;
const poId=Number(po[0].id);
const poNumber=String(po[0].po_number);

const poItem=await db`
  INSERT INTO purchase_order_items(
    purchase_order_id,variant_id,sku_snapshot,product_name_snapshot,
    supplier_sku,origin_country_code,quantity_ordered,quantity_received,
    unit_cost_minor,currency,line_total_minor
  )
  VALUES(
    ${poId},${variantId},
    (SELECT sku FROM product_variants WHERE id=${variantId}),
    'Provenance CI Product','SUP-PROV','VN',
    4,4,10000,'HNL',40000
  )
  RETURNING id`;
const poItemId=Number(poItem[0].id);

const receipt=await db`
  INSERT INTO goods_receipts(
    receipt_number,purchase_order_id,location_id,status,
    idempotency_key,idempotency_hash,supplier_delivery_reference,
    received_by_service,received_at
  )
  VALUES(
    ${"GR-PROV-"+crypto.randomUUID().slice(0,8)},
    ${poId},${locationA},'POSTED',
    ${"prov-gr-"+crypto.randomUUID()},${crypto.randomUUID()},
    'DELIVERY-PROV','provenance-test',NOW()
  )
  RETURNING id,receipt_number`;
const receiptId=Number(receipt[0].id);
const receiptNumber=String(receipt[0].receipt_number);

const receiptItem=await db`
  INSERT INTO goods_receipt_items(
    goods_receipt_id,purchase_order_item_id,variant_id,
    quantity_received,unit_cost_minor,currency
  )
  VALUES(${receiptId},${poItemId},${variantId},4,10000,'HNL')
  RETURNING id`;
const receiptItemId=Number(receiptItem[0].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES(${variantId},${locationA},4,0)
  ON CONFLICT(variant_id,location_id)
  DO UPDATE SET quantity=EXCLUDED.quantity,reserved=EXCLUDED.reserved,updated_at=NOW()`;

const movement=await db`
  INSERT INTO inventory_movements(
    variant_id,location_id,movement_type,quantity,reference,notes
  )
  VALUES(
    ${variantId},${locationA},'PURCHASE_RECEIPT',4,
    ${"goods_receipt:"+receiptNumber},'Provenance fixture'
  )
  RETURNING id`;
const movementId=Number(movement[0].id);

const receiptCase=await db`
  INSERT INTO landed_cost_cases(
    case_code,source_type,goods_receipt_id,currency,status,allocation_method,
    finalized_by_user_id,finalized_at,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${"LC-PROV-GR-"+crypto.randomUUID().slice(0,6)},
    'GOODS_RECEIPT',${receiptId},'HNL','FINAL','MANUAL',
    ${manager.userId},NOW(),${manager.userId},${manager.userId}
  )
  RETURNING id,case_code`;
const receiptCaseId=Number(receiptCase[0].id);
const receiptCaseCode=String(receiptCase[0].case_code);

await db`
  INSERT INTO landed_cost_allocations(
    case_id,target_type,goods_receipt_item_id,
    allocated_cost_minor,quantity_snapshot,base_unit_cost_minor,base_cost_minor,
    currency,notes,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${receiptCaseId},'GOODS_RECEIPT_ITEM',${receiptItemId},
    2000,4,10000,40000,'HNL','Provenance receipt allocation',
    ${manager.userId},${manager.userId}
  )`;

await db`
  INSERT INTO inventory_sources(
    variant_id,location_id,source_type,commercial_mode,economic_owner_type,
    supplier_id,procurement_lot_id,currency,cost_basis_minor,status,
    created_by_user_id
  )
  VALUES(
    ${variantId},${locationA},'PROCUREMENT','OWNED','MR',
    ${supplierId},${receiptId},'HNL',10500,'ACTIVE',${manager.userId}
  )`;

const manufacturer=await db`
  INSERT INTO manufacturers(
    name,country_code,city,active,created_by_user_id,updated_by_user_id
  )
  VALUES(
    'Provenance Factory CI','HN','San Pedro Sula',TRUE,
    ${manager.userId},${manager.userId}
  )
  RETURNING id`;
const manufacturerId=Number(manufacturer[0].id);

const manufacturerLink=await db`
  INSERT INTO manufacturer_links(
    manufacturer_id,target_type,product_id,manufacturer_reference,active,
    created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${manufacturerId},'PRODUCT',${productId},'FACTORY-PROV',TRUE,
    ${manager.userId},${manager.userId}
  )
  RETURNING id`;
const manufacturerLinkId=Number(manufacturerLink[0].id);

const spec=await db`
  INSERT INTO product_specifications(
    code,title,target_type,product_id,active,
    created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${"SPEC-PROV-"+crypto.randomUUID().slice(0,6)},
    'Provenance Specification CI','PRODUCT',${productId},TRUE,
    ${manager.userId},${manager.userId}
  )
  RETURNING id,code`;
const specId=Number(spec[0].id);
const specCode=String(spec[0].code);

const specVersion=await db`
  INSERT INTO product_specification_versions(
    specification_id,version_no,status,change_summary,
    approved_by_user_id,approved_at,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${specId},1,'APPROVED','Provenance approved version',
    ${manager.userId},NOW(),${manager.userId},${manager.userId}
  )
  RETURNING id`;
const specVersionId=Number(specVersion[0].id);

const run=await db`
  INSERT INTO production_runs(
    run_code,product_specification_version_id,manufacturer_link_id,status,
    actual_start_at,actual_end_at,released_by_user_id,released_at,
    completed_by_user_id,completed_at,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${"RUN-PROV-"+crypto.randomUUID().slice(0,6)},
    ${specVersionId},${manufacturerLinkId},'COMPLETED',
    NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour',
    ${manager.userId},NOW()-INTERVAL '3 hours',
    ${manager.userId},NOW()-INTERVAL '1 hour',
    ${manager.userId},${manager.userId}
  )
  RETURNING id,run_code`;
const runId=Number(run[0].id);
const runCode=String(run[0].run_code);

const lot=await db`
  INSERT INTO production_lots(
    production_run_id,lot_code,variant_id,status,
    planned_quantity,produced_quantity,started_at,completed_at,
    created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${runId},${"LOT-PROV-"+crypto.randomUUID().slice(0,6)},
    ${variantId},'COMPLETED',5,5,
    NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour',
    ${manager.userId},${manager.userId}
  )
  RETURNING id,lot_code`;
const lotId=Number(lot[0].id);
const lotCode=String(lot[0].lot_code);

const productionCase=await db`
  INSERT INTO landed_cost_cases(
    case_code,source_type,production_run_id,currency,status,allocation_method,
    finalized_by_user_id,finalized_at,created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${"LC-PROV-RUN-"+crypto.randomUUID().slice(0,6)},
    'PRODUCTION_RUN',${runId},'HNL','FINAL','MANUAL',
    ${manager.userId},NOW(),${manager.userId},${manager.userId}
  )
  RETURNING id,case_code`;
const productionCaseId=Number(productionCase[0].id);
const productionCaseCode=String(productionCase[0].case_code);

await db`
  INSERT INTO landed_cost_allocations(
    case_id,target_type,production_lot_id,
    allocated_cost_minor,quantity_snapshot,currency,notes,
    created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${productionCaseId},'PRODUCTION_LOT',${lotId},
    55000,5,'HNL','Provenance production allocation',
    ${manager.userId},${manager.userId}
  )`;

const inspection=await db`
  INSERT INTO quality_inspections(
    inspection_type,target_type,variant_id,specification_version_id,
    inspected_quantity,status,result,rationale,evidence_reference,
    created_by_user_id,updated_by_user_id,finalized_by_user_id,finalized_at
  )
  VALUES(
    'FINAL','VARIANT',${variantId},${specVersionId},
    5,'FINAL','PASS','Compatible QC context for provenance',
    'evidence://provenance-ci',
    ${manager.userId},${manager.userId},${manager.userId},NOW()
  )
  RETURNING id`;
const inspectionId=Number(inspection[0].id);

const countsBefore=(await db`
  SELECT
    (SELECT COUNT(*) FROM inventory_movements)::int AS movements,
    (SELECT COUNT(*) FROM goods_receipts)::int AS receipts,
    (SELECT COUNT(*) FROM production_runs)::int AS runs,
    (SELECT COUNT(*) FROM production_lots)::int AS lots,
    (SELECT COUNT(*) FROM quality_inspections)::int AS inspections,
    (SELECT COUNT(*) FROM landed_cost_cases)::int AS cost_cases,
    (SELECT COUNT(*) FROM inventory_sources)::int AS inventory_sources`)[0];

const managerList=await api("/v1/internal/provenance/variants?q=Provenance",{
  headers:{cookie:manager.cookie}
});
ok(managerList.response.status===200,"manager lista variantes");
ok(
  (managerList.body.data||[]).some((x:any)=>Number(x.id)===variantId),
  "manager ve variante con provenance"
);

const analystList=await api("/v1/internal/provenance/variants",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystList.response.status===403&&analystList.body.error==="forbidden",
  "reports.read no concede provenance.read"
);

const managerTrace=await api("/v1/internal/provenance/variants/"+variantId,{
  headers:{cookie:manager.cookie}
});
ok(managerTrace.response.status===200,"manager abre trace completo");

const procurement=(managerTrace.body.authoritativeLineage?.procurement||[])[0];
ok(Number(procurement?.goodsReceiptItemId)===receiptItemId,"trace resuelve GoodsReceiptItem exacto");
ok(procurement?.goodsReceipt?.receiptNumber===receiptNumber,"trace resuelve GoodsReceipt exacto");
ok(procurement?.purchaseOrder?.poNumber===poNumber,"trace resuelve PurchaseOrder exacto");
ok(procurement?.purchaseOrder?.supplierName==="Provenance Supplier CI","trace conserva supplier snapshot");
ok(procurement?.purchaseOrder?.originCountryCode==="VN","trace conserva país de origen");
ok(Number(procurement?.inventoryMovement?.id)===movementId,"trace resuelve movimiento PURCHASE_RECEIPT exacto");
ok(procurement?.inventoryMovement?.reference==="goods_receipt:"+receiptNumber,"movimiento usa referencia gobernada");
ok(procurement?.landedCost?.caseCode===receiptCaseCode,"trace enlaza landed cost de receipt por FK");
ok(Number(procurement?.landedCost?.allocatedCostMinor)===2000,"trace conserva allocation de receipt");

const production=(managerTrace.body.authoritativeLineage?.production||[])[0];
ok(production?.productionLot?.lotCode===lotCode,"trace resuelve ProductionLot exacto");
ok(production?.productionRun?.runCode===runCode,"trace resuelve ProductionRun exacto");
ok(production?.specificationVersion?.specificationCode===specCode,"trace resuelve specification exacta");
ok(production?.manufacturer?.name==="Provenance Factory CI","trace resuelve fabricante exacto");
ok(production?.landedCost?.caseCode===productionCaseCode,"trace enlaza landed cost de producción por FK");

const quality=(managerTrace.body.currentContext?.qualityContext||[]).find(
  (x:any)=>Number(x.inspectionId)===inspectionId
);
ok(Boolean(quality),"QC FINAL compatible aparece como contexto");
ok(quality?.explicitProductionLotLink===false,"QC declara no tener vínculo explícito al lot");
ok(
  String(quality?.linkNote||"").includes("no production_lot_id"),
  "QC documenta limitación de enlace"
);

const source=(managerTrace.body.currentContext?.inventorySources||[])[0];
ok(Boolean(source),"InventorySource aparece como contexto");
ok(source?.explicitGoodsReceiptLink===false,"InventorySource no se promueve a edge de receipt");
ok(
  String(source?.linkNote||"").includes("not an authoritative GoodsReceipt"),
  "InventorySource documenta limitación de FK"
);

const capability=(managerTrace.body.currentContext?.manufacturerCapabilities||[])[0];
ok(capability?.evidenceLevel==="CAPABILITY_ONLY","ManufacturerLink se etiqueta capability-only");
ok(capability?.provesProduction===false,"ManufacturerLink aislado no prueba producción");
ok(managerTrace.body.limitations?.inferredTextOrTimeLinks===false,"trace prohíbe inferencias texto/tiempo");
ok(managerTrace.body.readOnly===true,"trace se declara read-only");

const receiptDetail=await api(
  "/v1/internal/provenance/goods-receipt-items/"+receiptItemId,
  {headers:{cookie:manager.cookie}}
);
ok(receiptDetail.response.status===200,"manager abre receipt-item trace");
ok(receiptDetail.body.lineage?.purchaseOrder?.originCountryCode==="VN","receipt detail conserva origin");
ok(
  receiptDetail.body.limitations?.inventorySourceExplicitGoodsReceiptLink===false,
  "receipt detail no inventa InventorySource edge"
);

const lotDetail=await api(
  "/v1/internal/provenance/production-lots/"+lotId,
  {headers:{cookie:manager.cookie}}
);
ok(lotDetail.response.status===200,"manager abre production-lot trace");
ok(lotDetail.body.lineage?.productionLot?.lotCode===lotCode,"lot detail conserva lote exacto");
ok(
  lotDetail.body.qualityContext?.some((x:any)=>Number(x.inspectionId)===inspectionId),
  "lot detail muestra QC compatible"
);
ok(
  lotDetail.body.qualityContext?.every((x:any)=>x.explicitProductionLotLink===false),
  "lot detail no presenta QC como edge duro"
);

const readerAList=await api("/v1/internal/provenance/variants",{
  headers:{cookie:readerA.cookie}
});
ok(readerAList.response.status===200,"LOCATION A lista provenance");
ok(
  (readerAList.body.data||[]).some((x:any)=>Number(x.id)===variantId),
  "LOCATION A ve variante con evidencia local"
);

const readerATrace=await api("/v1/internal/provenance/variants/"+variantId,{
  headers:{cookie:readerA.cookie}
});
ok(readerATrace.response.status===200,"LOCATION A abre variante local");
ok(
  (readerATrace.body.authoritativeLineage?.procurement||[]).length===1,
  "LOCATION A ve procurement local"
);
ok(
  (readerATrace.body.authoritativeLineage?.production||[]).length===0 &&
  readerATrace.body.visibility?.productionVisible===false,
  "LOCATION A no ve production provenance global"
);
ok(
  (readerATrace.body.currentContext?.qualityContext||[]).length===0 &&
  (readerATrace.body.currentContext?.manufacturerCapabilities||[]).length===0,
  "LOCATION A no ve contexto global QC/manufacturer"
);
ok(
  (readerATrace.body.currentContext?.inventorySources||[]).length===1,
  "LOCATION A ve InventorySource local"
);

const readerAReceipt=await api(
  "/v1/internal/provenance/goods-receipt-items/"+receiptItemId,
  {headers:{cookie:readerA.cookie}}
);
ok(readerAReceipt.response.status===200,"LOCATION A abre receipt item local");

const readerBList=await api("/v1/internal/provenance/variants",{
  headers:{cookie:readerB.cookie}
});
ok(readerBList.response.status===200,"LOCATION B obtiene listado filtrado");
ok(
  !(readerBList.body.data||[]).some((x:any)=>Number(x.id)===variantId),
  "LOCATION B no ve variante sin evidencia local"
);

const readerBTrace=await api("/v1/internal/provenance/variants/"+variantId,{
  headers:{cookie:readerB.cookie}
});
ok(
  readerBTrace.response.status===403&&readerBTrace.body.error==="forbidden",
  "detalle variant falla cerrado fuera de scope"
);

const readerBReceipt=await api(
  "/v1/internal/provenance/goods-receipt-items/"+receiptItemId,
  {headers:{cookie:readerB.cookie}}
);
ok(
  readerBReceipt.response.status===403&&readerBReceipt.body.error==="forbidden",
  "receipt item rechaza ubicación ajena"
);

const readerALot=await api(
  "/v1/internal/provenance/production-lots/"+lotId,
  {headers:{cookie:readerA.cookie}}
);
ok(
  readerALot.response.status===403&&readerALot.body.error==="forbidden",
  "ProductionLot provenance requiere scope GLOBAL"
);

const isolatedTrace=await api(
  "/v1/internal/provenance/variants/"+isolatedVariantId,
  {headers:{cookie:readerA.cookie}}
);
ok(
  isolatedTrace.response.status===403&&isolatedTrace.body.error==="forbidden",
  "LOCATION no recibe metadatos de variant sin evidencia visible"
);

const serviceTrace=await api("/v1/internal/provenance/variants/"+variantId,{
  headers:{"x-internal-key":serviceKey}
});
ok(serviceTrace.response.status===200,"servicio interno conserva lectura global");
ok(
  (serviceTrace.body.authoritativeLineage?.production||[]).length===1,
  "servicio interno ve producción"
);

const mutationAttempt=await api("/v1/internal/provenance/variants/"+variantId,{
  method:"POST",
  headers:{
    cookie:manager.cookie,
    "content-type":"application/json",
    "x-csrf-token":manager.csrf
  },
  body:"{}"
});
ok(
  mutationAttempt.response.status===405 &&
  mutationAttempt.body.error==="method_not_allowed",
  "provenance rechaza mutaciones"
);

const countsAfter=(await db`
  SELECT
    (SELECT COUNT(*) FROM inventory_movements)::int AS movements,
    (SELECT COUNT(*) FROM goods_receipts)::int AS receipts,
    (SELECT COUNT(*) FROM production_runs)::int AS runs,
    (SELECT COUNT(*) FROM production_lots)::int AS lots,
    (SELECT COUNT(*) FROM quality_inspections)::int AS inspections,
    (SELECT COUNT(*) FROM landed_cost_cases)::int AS cost_cases,
    (SELECT COUNT(*) FROM inventory_sources)::int AS inventory_sources`)[0];

for(const field of [
  "movements","receipts","runs","lots","inspections","cost_cases","inventory_sources"
]){
  ok(
    Number(countsAfter[field])===Number(countsBefore[field]),
    "lecturas provenance no cambian "+field
  );
}

const unauth=await api("/v1/internal/provenance/variants");
ok(unauth.response.status===401,"provenance interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Provenance / Traceability v1");
await db.close();
