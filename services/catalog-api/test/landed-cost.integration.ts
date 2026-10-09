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

async function createStaff(roleCode:string,displayName:string){
  const slug=displayName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const email=slug+"-"+crypto.randomUUID().slice(0,8)+"@example.test";
  const password="LAND-"+crypto.randomUUID()+"-Q9!";
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

const internalHeaders={
  "content-type":"application/json",
  "x-internal-key":serviceKey
};

const locationRows=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Landed Cost CI "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId=Number(locationRows[0].id);

const productRows=await db`
  INSERT INTO products(
    name,slug,category,brand,status,commercial_model,default_condition
  )
  VALUES(
    'Landed Cost CI Product',
    ${"landed-cost-ci-"+crypto.randomUUID()},
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
      ${productId},${"LC-A-"+crypto.randomUUID().slice(0,8)},
      'M','Negro',123.45,500.00,'HNL',TRUE
    ),
    (
      ${productId},${"LC-B-"+crypto.randomUUID().slice(0,8)},
      'L','Azul',234.56,700.00,'HNL',TRUE
    )
  RETURNING id,sku,cost`;
const variantA=Number(variantRows[0].id);
const variantB=Number(variantRows[1].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES
    (${variantA},${locationId},5,1),
    (${variantB},${locationId},3,0)`;

const manager=await createStaff("MANAGER","Landed Cost Manager CI");
const inventoryReader=await createStaff("INVENTORY_OPERATOR","Landed Cost Reader CI");
const analyst=await createStaff("ANALYST","Landed Cost Analyst CI");
ok(manager.login.response.status===200,"Manager inicia sesión");
ok(inventoryReader.login.response.status===200,"Inventory Operator inicia sesión");
ok(analyst.login.response.status===200,"Analyst inicia sesión");

const supplierRows=await db`
  INSERT INTO suppliers(name,country_code,active,default_currency)
  VALUES('Landed Cost Supplier CI','HN',TRUE,'HNL')
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
    ${"PO-LC-"+crypto.randomUUID().slice(0,8)},${supplierId},
    'Landed Cost Supplier CI','HN',${locationId},'RECEIVED','HNL',80000,
    0,0,0,80000,'LC-CI','landed-cost-ci',
    ${"po-lc-"+crypto.randomUUID()},${crypto.randomUUID()}
  )
  RETURNING id,po_number`;
const poId=Number(poRows[0].id);

const poItemRows=await db`
  INSERT INTO purchase_order_items(
    purchase_order_id,variant_id,sku_snapshot,product_name_snapshot,
    quantity_ordered,quantity_received,unit_cost_minor,currency,line_total_minor
  )
  VALUES
    (
      ${poId},${variantA},${variantRows[0].sku},'Landed Cost CI Product',
      2,2,10000,'HNL',20000
    ),
    (
      ${poId},${variantB},${variantRows[1].sku},'Landed Cost CI Product',
      3,3,20000,'HNL',60000
    )
  RETURNING id,variant_id`;
const poItemA=Number(poItemRows[0].id);
const poItemB=Number(poItemRows[1].id);

const receiptRows=await db`
  INSERT INTO goods_receipts(
    receipt_number,purchase_order_id,location_id,status,
    idempotency_key,idempotency_hash,supplier_delivery_reference,received_by_service
  )
  VALUES(
    ${"GR-LC-"+crypto.randomUUID().slice(0,8)},${poId},${locationId},'POSTED',
    ${"gr-lc-"+crypto.randomUUID()},${crypto.randomUUID()},'DELIVERY-LC-CI','landed-cost-ci'
  )
  RETURNING id,receipt_number`;
const receiptId=Number(receiptRows[0].id);

const receiptItems=await db`
  INSERT INTO goods_receipt_items(
    goods_receipt_id,purchase_order_item_id,variant_id,quantity_received,unit_cost_minor,currency
  )
  VALUES
    (${receiptId},${poItemA},${variantA},2,10000,'HNL'),
    (${receiptId},${poItemB},${variantB},3,20000,'HNL')
  RETURNING id,variant_id`;
const receiptItemA=Number(receiptItems[0].id);
const receiptItemB=Number(receiptItems[1].id);

const manufacturerRows=await db`
  INSERT INTO manufacturers(name,country_code,active)
  VALUES('Landed Cost Factory CI','HN',TRUE)
  RETURNING id`;
const manufacturerId=Number(manufacturerRows[0].id);

const manufacturerLinkRows=await db`
  INSERT INTO manufacturer_links(
    manufacturer_id,target_type,product_id,active
  )
  VALUES(${manufacturerId},'PRODUCT',${productId},TRUE)
  RETURNING id`;
const manufacturerLinkId=Number(manufacturerLinkRows[0].id);

const specRows=await db`
  INSERT INTO product_specifications(
    code,title,target_type,product_id,active
  )
  VALUES(
    ${"SPEC-LC-"+crypto.randomUUID().slice(0,8)},
    'Landed Cost Production Specification','PRODUCT',${productId},TRUE
  )
  RETURNING id`;
const specId=Number(specRows[0].id);

const specVersionRows=await db`
  INSERT INTO product_specification_versions(
    specification_id,version_no,status,change_summary,approved_by_user_id,approved_at
  )
  VALUES(
    ${specId},1,'APPROVED','Approved for landed cost CI',
    ${manager.userId},NOW()
  )
  RETURNING id`;
const specVersionId=Number(specVersionRows[0].id);

const runRows=await db`
  INSERT INTO production_runs(
    run_code,product_specification_version_id,manufacturer_link_id,status,
    actual_start_at,actual_end_at,released_by_user_id,released_at,
    completed_by_user_id,completed_at
  )
  VALUES(
    ${"RUN-LC-"+crypto.randomUUID().slice(0,8)},
    ${specVersionId},${manufacturerLinkId},'COMPLETED',
    NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour',
    ${manager.userId},NOW()-INTERVAL '3 hours',
    ${manager.userId},NOW()-INTERVAL '1 hour'
  )
  RETURNING id,run_code`;
const productionRunId=Number(runRows[0].id);

const lotRows=await db`
  INSERT INTO production_lots(
    production_run_id,lot_code,variant_id,status,
    planned_quantity,produced_quantity,started_at,completed_at
  )
  VALUES
    (
      ${productionRunId},${"LOT-LC-A-"+crypto.randomUUID().slice(0,6)},
      ${variantA},'COMPLETED',5,5,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour'
    ),
    (
      ${productionRunId},${"LOT-LC-B-"+crypto.randomUUID().slice(0,6)},
      ${variantB},'COMPLETED',3,3,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour'
    )
  RETURNING id,variant_id`;
const productionLotA=Number(lotRows[0].id);
const productionLotB=Number(lotRows[1].id);

const baseline={
  inventory:await db`
    SELECT variant_id,quantity,reserved
    FROM inventory
    WHERE location_id=${locationId}
      AND variant_id IN (${variantA},${variantB})
    ORDER BY variant_id`,
  movements:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_movements
    WHERE variant_id IN (${variantA},${variantB})`)[0]?.count||0),
  sources:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_sources
    WHERE variant_id IN (${variantA},${variantB})`)[0]?.count||0),
  po:(await db`
    SELECT status,subtotal_minor,grand_total_minor
    FROM purchase_orders WHERE id=${poId}`)[0],
  receipt:(await db`
    SELECT status,receipt_number
    FROM goods_receipts WHERE id=${receiptId}`)[0],
  run:(await db`
    SELECT status,run_code FROM production_runs WHERE id=${productionRunId}`)[0],
  lots:await db`
    SELECT id,status,produced_quantity
    FROM production_lots WHERE production_run_id=${productionRunId}
    ORDER BY id`,
  variantCosts:await db`
    SELECT id,cost FROM product_variants
    WHERE id IN (${variantA},${variantB})
    ORDER BY id`,
  qc:Number((await db`SELECT COUNT(*)::int count FROM quality_inspections`)[0]?.count||0)
};

const readerCases=await api("/v1/internal/landed-cost/cases",{
  headers:{cookie:inventoryReader.cookie}
});
ok(readerCases.response.status===200,"Inventory Operator puede leer landed cost");

const analystCases=await api("/v1/internal/landed-cost/cases",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystCases.response.status===403&&analystCases.body.error==="forbidden",
  "reports.read no concede landed_cost.read"
);

const readerCreate=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(inventoryReader),
  body:JSON.stringify({
    caseCode:"LC-UNAUTHORIZED",
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId,
    currency:"HNL"
  })
});
ok(
  readerCreate.response.status===403&&readerCreate.body.error==="forbidden",
  "landed_cost.read no concede manage"
);

const targets=await api("/v1/internal/landed-cost/targets",{
  headers:{cookie:inventoryReader.cookie}
});
ok(targets.response.status===200,"lista fuentes elegibles");
ok(
  Array.isArray(targets.body.data)&&
  targets.body.data.some((x:any)=>x.sourceType==="GOODS_RECEIPT"&&Number(x.source?.id)===receiptId)&&
  targets.body.data.some((x:any)=>x.sourceType==="PRODUCTION_RUN"&&Number(x.source?.id)===productionRunId),
  "targets incluye receipt y production run"
);

const wrongCurrency=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-WRONG-"+crypto.randomUUID().slice(0,5),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId,
    currency:"USD"
  })
});
ok(
  wrongCurrency.response.status===409&&wrongCurrency.body.error==="source_currency_mismatch",
  "recepción rechaza moneda distinta sin FX"
);

const receiptCase=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-GR-"+crypto.randomUUID().slice(0,6),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId,
    currency:"HNL",
    notes:"Costeo de recepción CI"
  })
});
ok(receiptCase.response.status===201,"crea caso de recepción");
const receiptCaseId=Number(receiptCase.body.case?.id);
ok(receiptCase.body.case?.fxConversionApplied===false,"caso declara cero FX");

const duplicateReceipt=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-GR-DUP-"+crypto.randomUUID().slice(0,5),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId,
    currency:"HNL"
  })
});
ok(
  duplicateReceipt.response.status===409&&duplicateReceipt.body.error==="landed_cost_case_exists",
  "una recepción tiene un solo caso landed cost"
);

const freight=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({componentType:"FREIGHT",amountMinor:3000,description:"Flete real"})
});
ok(freight.response.status===201,"registra freight");
const freightId=Number(freight.body.component?.id);

const duty=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({componentType:"DUTY",amountMinor:2000,description:"Arancel real"})
});
ok(duty.response.status===201,"registra duty");

const allocA=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/allocations",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({targetId:receiptItemA,allocatedCostMinor:3000})
});
ok(allocA.response.status===201,"asigna costo a receipt item A");
const allocAId=Number(allocA.body.allocation?.id);
ok(
  allocA.body.allocation?.baseCostMinor===20000 &&
  allocA.body.allocation?.totalLandedCostMinor===23000,
  "preserva base cost y suma allocation sin reescribir origen"
);

const incompleteCoverage=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Debe fallar cobertura"})
});
ok(
  incompleteCoverage.response.status===409 &&
  incompleteCoverage.body.error==="complete_allocation_coverage_required",
  "final requiere cobertura de todas las líneas"
);

const allocB=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/allocations",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({targetId:receiptItemB,allocatedCostMinor:1000})
});
ok(allocB.response.status===201,"asigna costo inicial a receipt item B");
const allocBId=Number(allocB.body.allocation?.id);

const unbalanced=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Debe fallar balance"})
});
ok(
  unbalanced.response.status===409 &&
  unbalanced.body.error==="allocation_not_balanced" &&
  unbalanced.body.componentTotalMinor===5000 &&
  unbalanced.body.allocatedTotalMinor===4000,
  "final exige suma allocations igual a componentes"
);

const rebalance=await api("/v1/internal/landed-cost/allocations/"+allocBId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({allocatedCostMinor:2000,changeNote:"Balance final"})
});
ok(rebalance.response.status===200,"rebalacea allocation B");

const serviceFinalize=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({note:"Servicio no debe finalizar"})
});
ok(
  serviceFinalize.response.status===403 &&
  serviceFinalize.body.error==="human_finalization_required",
  "finalización exige StaffUser humano"
);

const finalizedReceipt=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Costeo real conciliado"})
});
ok(
  finalizedReceipt.response.status===200 &&
  finalizedReceipt.body.case?.status==="FINAL",
  "finaliza caso de recepción"
);
ok(
  finalizedReceipt.body.summary?.componentTotalMinor===5000 &&
  finalizedReceipt.body.summary?.allocatedTotalMinor===5000 &&
  finalizedReceipt.body.summary?.baseCostTotalMinor===80000 &&
  finalizedReceipt.body.summary?.totalLandedCostMinor===85000 &&
  finalizedReceipt.body.summary?.balanced===true,
  "summary de recepción conserva base + landed exacto"
);
ok(
  finalizedReceipt.body.inventoryChanged===false &&
  finalizedReceipt.body.inventorySourceChanged===false &&
  finalizedReceipt.body.sourceCostChanged===false,
  "final receipt case declara cero side effects"
);

const immutableComponent=await api("/v1/internal/landed-cost/components/"+freightId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({amountMinor:9999})
});
ok(
  immutableComponent.response.status===409 &&
  immutableComponent.body.error==="final_case_immutable",
  "componentes FINAL son inmutables"
);

const missingProductionCurrency=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-PR-MISS-"+crypto.randomUUID().slice(0,5),
    sourceType:"PRODUCTION_RUN",
    sourceId:productionRunId
  })
});
ok(
  missingProductionCurrency.response.status===400 &&
  missingProductionCurrency.body.error==="currency_required",
  "producción requiere moneda explícita"
);

const productionCase=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-PR-"+crypto.randomUUID().slice(0,6),
    sourceType:"PRODUCTION_RUN",
    sourceId:productionRunId,
    currency:"HNL",
    notes:"Costeo producción CI"
  })
});
ok(productionCase.response.status===201,"crea caso de producción");
const productionCaseId=Number(productionCase.body.case?.id);

const manufacturing=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({componentType:"MANUFACTURING",amountMinor:70000,description:"Manufactura"})
});
ok(manufacturing.response.status===201,"registra costo de manufactura explícito");

const prodFreight=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({componentType:"FREIGHT",amountMinor:10000,description:"Flete de planta"})
});
ok(prodFreight.response.status===201,"registra flete de producción");

const prodAllocA=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/allocations",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({targetId:productionLotA,allocatedCostMinor:50000})
});
ok(prodAllocA.response.status===201,"asigna producción lote A");
ok(
  prodAllocA.body.allocation?.baseCostMinor==null &&
  prodAllocA.body.allocation?.totalLandedCostMinor===50000 &&
  prodAllocA.body.allocation?.quantitySnapshot===5,
  "producción no inventa base cost"
);

const prodAllocB=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/allocations",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({targetId:productionLotB,allocatedCostMinor:30000})
});
ok(prodAllocB.response.status===201,"asigna producción lote B");

const finalizedProduction=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Costeo de producción conciliado"})
});
ok(
  finalizedProduction.response.status===200 &&
  finalizedProduction.body.case?.status==="FINAL",
  "finaliza caso de producción"
);
ok(
  finalizedProduction.body.summary?.componentTotalMinor===80000 &&
  finalizedProduction.body.summary?.allocatedTotalMinor===80000 &&
  finalizedProduction.body.summary?.baseCostTotalMinor==null &&
  finalizedProduction.body.summary?.totalLandedCostMinor===80000,
  "producción usa componentes explícitos como total capturado"
);

const after={
  inventory:await db`
    SELECT variant_id,quantity,reserved
    FROM inventory
    WHERE location_id=${locationId}
      AND variant_id IN (${variantA},${variantB})
    ORDER BY variant_id`,
  movements:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_movements
    WHERE variant_id IN (${variantA},${variantB})`)[0]?.count||0),
  sources:Number((await db`
    SELECT COUNT(*)::int count FROM inventory_sources
    WHERE variant_id IN (${variantA},${variantB})`)[0]?.count||0),
  po:(await db`
    SELECT status,subtotal_minor,grand_total_minor
    FROM purchase_orders WHERE id=${poId}`)[0],
  receipt:(await db`
    SELECT status,receipt_number
    FROM goods_receipts WHERE id=${receiptId}`)[0],
  run:(await db`
    SELECT status,run_code FROM production_runs WHERE id=${productionRunId}`)[0],
  lots:await db`
    SELECT id,status,produced_quantity
    FROM production_lots WHERE production_run_id=${productionRunId}
    ORDER BY id`,
  variantCosts:await db`
    SELECT id,cost FROM product_variants
    WHERE id IN (${variantA},${variantB})
    ORDER BY id`,
  qc:Number((await db`SELECT COUNT(*)::int count FROM quality_inspections`)[0]?.count||0)
};

ok(JSON.stringify(after.inventory)===JSON.stringify(baseline.inventory),"landed cost no cambia quantity/reserved");
ok(after.movements===baseline.movements,"landed cost no crea inventory movements");
ok(after.sources===baseline.sources,"landed cost no crea InventorySource");
ok(
  after.po.status===baseline.po.status &&
  Number(after.po.subtotal_minor)===Number(baseline.po.subtotal_minor) &&
  Number(after.po.grand_total_minor)===Number(baseline.po.grand_total_minor),
  "landed cost no reescribe PurchaseOrder"
);
ok(
  after.receipt.status===baseline.receipt.status &&
  after.receipt.receipt_number===baseline.receipt.receipt_number,
  "landed cost no reescribe GoodsReceipt"
);
ok(
  after.run.status===baseline.run.status &&
  after.run.run_code===baseline.run.run_code,
  "landed cost no reescribe ProductionRun"
);
ok(JSON.stringify(after.lots)===JSON.stringify(baseline.lots),"landed cost no reescribe ProductionLot");
ok(JSON.stringify(after.variantCosts)===JSON.stringify(baseline.variantCosts),"landed cost no cambia ProductVariant.cost");
ok(after.qc===baseline.qc,"landed cost no crea ni cambia quality inspections");

const audit=await db`
  SELECT action,resource_id
  FROM audit_events
  WHERE resource_type='LandedCostCase'
    AND resource_id IN (${String(receiptCaseId)},${String(productionCaseId)})
  ORDER BY id`;
ok(
  audit.filter((x:any)=>x.action==="landed_cost_case.created").length===2,
  "creaciones de caso quedan auditadas"
);
ok(
  audit.filter((x:any)=>x.action==="landed_cost_case.finalized").length===2,
  "finalizaciones quedan auditadas"
);

const detail=await api("/v1/internal/landed-cost/cases/"+receiptCaseId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(detail.response.status===200,"detalle FINAL sigue legible");
ok(
  Array.isArray(detail.body.history)&&
  detail.body.history.some((x:any)=>x.action==="CREATED")&&
  detail.body.history.some((x:any)=>x.action==="FINALIZED"),
  "historial append-only conserva creación y finalización"
);
ok(detail.body.fxConversionApplied===false,"detalle explicita cero FX");

const unauth=await api("/v1/internal/landed-cost/cases");
ok(unauth.response.status===401,"landed cost interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Landed Cost v1");
await db.close();
