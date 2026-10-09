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

async function createStaff(
  roleCode:string,
  displayName:string,
  scopeType:"GLOBAL"|"LOCATION"="GLOBAL",
  locationId:number|null=null
){
  const slug=displayName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const email=slug+"-"+crypto.randomUUID().slice(0,8)+"@example.test";
  const password="LAND-"+crypto.randomUUID()+"-R9!";
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

function staffHeaders(session:{cookie:string;csrf:string},idempotencyKey?:string){
  const headers:any={
    cookie:session.cookie,
    "x-csrf-token":session.csrf,
    "content-type":"application/json"
  };
  if(idempotencyKey)headers["idempotency-key"]=idempotencyKey;
  return headers;
}

const internalHeaders={
  "content-type":"application/json",
  "x-internal-key":serviceKey
};

const locations=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Landed Cost CI A "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId=Number(locations[0].id);

const otherLocations=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Landed Cost CI B "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const otherLocationId=Number(otherLocations[0].id);

const manager=await createStaff("MANAGER","Landed Cost Manager CI");
const inventoryReader=await createStaff(
  "INVENTORY_OPERATOR",
  "Landed Cost Reader CI",
  "LOCATION",
  locationId
);
const otherLocationReader=await createStaff(
  "INVENTORY_OPERATOR",
  "Landed Cost Other Location CI",
  "LOCATION",
  otherLocationId
);
const analyst=await createStaff("ANALYST","Landed Cost Analyst CI");

ok(manager.login.response.status===200,"manager inicia sesión");
ok(inventoryReader.login.response.status===200,"inventory operator scoped inicia sesión");
ok(otherLocationReader.login.response.status===200,"segundo inventory operator scoped inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const receiptProduct=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Landed Receipt Product CI",
    category:"Accesorios",
    brand:"MR",
    commercialModel:"curated",
    defaultCondition:"new",
    status:"draft",
    variants:[{
      sku:"LAND-REC-"+crypto.randomUUID().slice(0,8),
      size:"U",
      color:"Negro",
      cost:77,
      price:250,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(receiptProduct.response.status===201,"crea producto de recepción");
const receiptProductId=Number(receiptProduct.body.product?.id);
const receiptVariantId=Number(receiptProduct.body.variants?.[0]?.id);

const supplier=await api("/v1/internal/suppliers",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    name:"Landed Cost Supplier CI",
    countryCode:"HN",
    defaultCurrency:"HNL"
  })
});
ok(supplier.response.status===201,"crea proveedor");
const supplierId=Number(supplier.body.supplier?.id);

const po=await api("/v1/internal/procurement/purchase-orders",{
  method:"POST",
  headers:staffHeaders(manager,"land-po-"+crypto.randomUUID()),
  body:JSON.stringify({
    supplierId,
    destinationLocationId:locationId,
    currency:"HNL",
    shippingEstimateMinor:0,
    taxEstimateMinor:0,
    otherCostsMinor:0,
    items:[{
      variantId:receiptVariantId,
      quantityOrdered:4,
      unitCostMinor:10000,
      originCountryCode:"HN"
    }]
  })
});
ok(po.response.status===201,"crea PO de landed cost");
const poId=Number(po.body.purchaseOrder?.id);
const poItemId=Number(po.body.purchaseOrder?.items?.[0]?.id);

const approvePo=await api("/v1/internal/procurement/purchase-orders/"+poId+"/approve",{
  method:"POST",headers:staffHeaders(manager),body:"{}"
});
ok(approvePo.response.status===200,"aprueba PO");
const orderPo=await api("/v1/internal/procurement/purchase-orders/"+poId+"/order",{
  method:"POST",headers:staffHeaders(manager),body:"{}"
});
ok(orderPo.response.status===200,"ordena PO");

const receipt=await api("/v1/internal/procurement/purchase-orders/"+poId+"/receipts",{
  method:"POST",
  headers:staffHeaders(inventoryReader,"land-gr-"+crypto.randomUUID()),
  body:JSON.stringify({
    supplierDeliveryReference:"LAND-DELIVERY-CI",
    items:[{purchaseOrderItemId:poItemId,quantityReceived:4}]
  })
});
ok(receipt.response.status===201,"posta GoodsReceipt");
const receiptId=Number(receipt.body.goodsReceipt?.id);
const receiptItemId=Number(receipt.body.goodsReceipt?.items?.[0]?.id);
ok(receipt.body.purchaseOrder?.status==="RECEIVED","PO queda RECEIVED");

const inventoryReceiptBefore=(await db`
  SELECT quantity,reserved
  FROM inventory
  WHERE variant_id=${receiptVariantId} AND location_id=${locationId}`)[0];
const receiptMovementsBefore=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id=${receiptVariantId}`)[0]?.count||0);
const receiptSourcesBefore=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_sources
  WHERE variant_id=${receiptVariantId}`)[0]?.count||0);
const receiptVariantBefore=(await db`
  SELECT cost FROM product_variants WHERE id=${receiptVariantId}`)[0];
const receiptItemBefore=(await db`
  SELECT unit_cost_minor,quantity_received,currency
  FROM goods_receipt_items WHERE id=${receiptItemId}`)[0];

const readerSources=await api("/v1/internal/landed-cost/sources",{
  headers:{cookie:inventoryReader.cookie}
});
ok(readerSources.response.status===200,"Inventory Operator LOCATION puede leer fuentes de su ubicación");
ok(
  readerSources.body.goodsReceipts?.some((x:any)=>Number(x.sourceId)===receiptId),
  "fuentes incluyen GoodsReceipt"
);

ok(
  Array.isArray(readerSources.body.productionRuns) &&
  readerSources.body.productionRuns.length===0,
  "grant LOCATION no expone fuentes ProductionRun sin ubicación autoritativa"
);

const otherReaderSources=await api("/v1/internal/landed-cost/sources",{
  headers:{cookie:otherLocationReader.cookie}
});
ok(otherReaderSources.response.status===200,"otro LOCATION obtiene listado filtrado");
ok(
  !otherReaderSources.body.goodsReceipts?.some((x:any)=>Number(x.sourceId)===receiptId),
  "otra ubicación no ve GoodsReceipt ajeno"
);

const analystRead=await api("/v1/internal/landed-cost/cases",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystRead.response.status===403&&analystRead.body.error==="forbidden",
  "reports.read no concede landed_cost.read"
);

const readerManage=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(inventoryReader),
  body:JSON.stringify({
    caseCode:"LC-UNAUTH-"+crypto.randomUUID().slice(0,6),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId
  })
});
ok(
  readerManage.response.status===403&&readerManage.body.error==="forbidden",
  "landed_cost.read no concede manage"
);

const wrongCurrency=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-WRONG-"+crypto.randomUUID().slice(0,6),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId,
    currency:"USD"
  })
});
ok(
  wrongCurrency.response.status===409&&wrongCurrency.body.error==="source_currency_mismatch",
  "receipt case rechaza moneda distinta sin FX"
);

const receiptCase=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-REC-"+crypto.randomUUID().slice(0,6),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId,
    notes:"Costeo de recepción CI"
  })
});
ok(receiptCase.response.status===201,"crea caso de recepción");
const receiptCaseId=Number(receiptCase.body.landedCostCase?.id);
ok(receiptCase.body.landedCostCase?.currency==="HNL","moneda se deriva de recepción");
ok(
  Number(receiptCase.body.landedCostCase?.totals?.sourceBaseCostMinor)===40000,
  "costo base receipt = quantity × unit cost"
);
ok(receiptCase.body.fxConversionApplied===false,"caso declara cero FX");

const scopedReceiptCases=await api("/v1/internal/landed-cost/cases",{
  headers:{cookie:inventoryReader.cookie}
});
ok(
  scopedReceiptCases.response.status===200 &&
  scopedReceiptCases.body.data?.some((x:any)=>Number(x.id)===receiptCaseId),
  "LOCATION ve landed cost case de su GoodsReceipt"
);

const otherScopedReceiptCases=await api("/v1/internal/landed-cost/cases",{
  headers:{cookie:otherLocationReader.cookie}
});
ok(
  otherScopedReceiptCases.response.status===200 &&
  !otherScopedReceiptCases.body.data?.some((x:any)=>Number(x.id)===receiptCaseId),
  "LOCATION ajena no ve landed cost case del receipt"
);

const otherReceiptDetail=await api("/v1/internal/landed-cost/cases/"+receiptCaseId,{
  headers:{cookie:otherLocationReader.cookie}
});
ok(
  otherReceiptDetail.response.status===403 &&
  otherReceiptDetail.body.error==="forbidden",
  "detalle GoodsReceipt exige location compatible"
);

const duplicateReceiptCase=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-REC-DUP-"+crypto.randomUUID().slice(0,6),
    sourceType:"GOODS_RECEIPT",
    sourceId:receiptId
  })
});
ok(
  duplicateReceiptCase.response.status===409&&duplicateReceiptCase.body.error==="landed_cost_case_exists",
  "v1 permite un caso por GoodsReceipt"
);

const freight=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    componentType:"FREIGHT",
    amountMinor:1200,
    description:"Flete real"
  })
});
ok(freight.response.status===201,"agrega flete");
const freightId=Number(freight.body.component?.id);

const duty=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    componentType:"DUTY",
    amountMinor:800,
    description:"Arancel real"
  })
});
ok(duty.response.status===201,"agrega arancel");

const allocation=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/allocations",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    targetId:receiptItemId,
    allocatedCostMinor:1500,
    notes:"Asignación inicial incompleta"
  })
});
ok(allocation.response.status===201,"crea asignación de receipt item");
const receiptAllocationId=Number(allocation.body.allocation?.id);
ok(Number(allocation.body.allocation?.quantitySnapshot)===4,"snapshot conserva cantidad recibida");
ok(Number(allocation.body.allocation?.baseUnitCostMinor)===10000,"snapshot conserva costo unitario de receipt");
ok(Number(allocation.body.allocation?.baseCostMinor)===40000,"snapshot conserva costo base de línea");

const mismatchFinalize=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Debe fallar por delta"})
});
ok(
  mismatchFinalize.response.status===409 &&
  mismatchFinalize.body.error==="allocation_total_mismatch" &&
  Number(mismatchFinalize.body.deltaMinor)===500,
  "finalización exige suma de asignaciones exactamente igual a componentes"
);

const serviceFinalize=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({note:"Servicio no finaliza"})
});
ok(
  serviceFinalize.response.status===403&&serviceFinalize.body.error==="human_finalization_required",
  "finalización exige StaffUser humano"
);

const allocationFixed=await api("/v1/internal/landed-cost/allocations/"+receiptAllocationId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    allocatedCostMinor:2000,
    notes:"Asignación completa",
    changeNote:"Se concilia con componentes"
  })
});
ok(allocationFixed.response.status===200,"corrige asignación a total exacto");

const finalizedReceipt=await api("/v1/internal/landed-cost/cases/"+receiptCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Costeo receipt conciliado"})
});
ok(
  finalizedReceipt.response.status===200 &&
  finalizedReceipt.body.landedCostCase?.status==="FINAL",
  "finaliza costeo de recepción"
);
const receiptTotals=finalizedReceipt.body.landedCostCase?.totals||{};
ok(Number(receiptTotals.sourceBaseCostMinor)===40000,"FINAL conserva base 40000");
ok(Number(receiptTotals.landedComponentsMinor)===2000,"FINAL conserva componentes 2000");
ok(Number(receiptTotals.allocatedMinor)===2000,"FINAL conserva asignado 2000");
ok(Number(receiptTotals.totalCostMinor)===42000,"FINAL total receipt = base + landed");
const finalReceiptAllocation=finalizedReceipt.body.landedCostCase?.allocations?.[0];
ok(Number(finalReceiptAllocation?.totalCostMinor)===42000,"línea suma base + allocation");
ok(Number(finalReceiptAllocation?.exactUnitTotalCostMinor)===10500,"unitario exacto se deriva sin redondeo");

const mutateFinalComponent=await api("/v1/internal/landed-cost/components/"+freightId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({amountMinor:1300})
});
ok(
  mutateFinalComponent.response.status===409&&mutateFinalComponent.body.error==="final_case_immutable",
  "componentes FINAL son inmutables"
);

const mutateFinalAllocation=await api("/v1/internal/landed-cost/allocations/"+receiptAllocationId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({allocatedCostMinor:2100})
});
ok(
  mutateFinalAllocation.response.status===409&&mutateFinalAllocation.body.error==="final_case_immutable",
  "asignaciones FINAL son inmutables"
);

const mutateFinalCase=await api("/v1/internal/landed-cost/cases/"+receiptCaseId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({notes:"No debe cambiar"})
});
ok(
  mutateFinalCase.response.status===409&&mutateFinalCase.body.error==="final_case_immutable",
  "caso FINAL es inmutable"
);

const inventoryReceiptAfter=(await db`
  SELECT quantity,reserved
  FROM inventory
  WHERE variant_id=${receiptVariantId} AND location_id=${locationId}`)[0];
const receiptMovementsAfter=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id=${receiptVariantId}`)[0]?.count||0);
const receiptSourcesAfter=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_sources
  WHERE variant_id=${receiptVariantId}`)[0]?.count||0);
const receiptVariantAfter=(await db`
  SELECT cost FROM product_variants WHERE id=${receiptVariantId}`)[0];
const receiptItemAfter=(await db`
  SELECT unit_cost_minor,quantity_received,currency
  FROM goods_receipt_items WHERE id=${receiptItemId}`)[0];
const poAfter=(await db`
  SELECT status FROM purchase_orders WHERE id=${poId}`)[0];

ok(
  Number(inventoryReceiptAfter.quantity)===Number(inventoryReceiptBefore.quantity)&&
  Number(inventoryReceiptAfter.reserved)===Number(inventoryReceiptBefore.reserved),
  "receipt landed cost no cambia inventory quantity/reserved"
);
ok(receiptMovementsAfter===receiptMovementsBefore,"receipt landed cost no crea inventory movement");
ok(receiptSourcesAfter===receiptSourcesBefore,"receipt landed cost no crea InventorySource");
ok(String(receiptVariantAfter.cost)===String(receiptVariantBefore.cost),"no reescribe product_variants.cost");
ok(
  Number(receiptItemAfter.unit_cost_minor)===Number(receiptItemBefore.unit_cost_minor)&&
  Number(receiptItemAfter.quantity_received)===Number(receiptItemBefore.quantity_received)&&
  receiptItemAfter.currency===receiptItemBefore.currency,
  "no reescribe GoodsReceiptItem"
);
ok(poAfter.status==="RECEIVED","no cambia lifecycle de PurchaseOrder");

const productionProduct=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Landed Production Product CI",
    category:"Vestuario",
    brand:"MR",
    commercialModel:"private_label",
    defaultCondition:"new",
    status:"draft",
    variants:[{
      sku:"LAND-PROD-"+crypto.randomUUID().slice(0,8),
      size:"M",
      color:"Natural",
      cost:33,
      price:600,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(productionProduct.response.status===201,"crea producto de producción");
const productionProductId=Number(productionProduct.body.product?.id);
const productionVariantId=Number(productionProduct.body.variants?.[0]?.id);

const manufacturer=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({name:"Landed Factory CI",countryCode:"HN"})
});
ok(manufacturer.response.status===201,"crea fabricante");
const manufacturerId=Number(manufacturer.body.manufacturer?.id);

const manufacturerLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    manufacturerId,
    targetType:"PRODUCT",
    targetId:productionProductId
  })
});
ok(manufacturerLink.response.status===201,"crea ManufacturerLink");
const manufacturerLinkId=Number(manufacturerLink.body.link?.id);

const spec=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    code:"LC-SPEC-"+crypto.randomUUID().slice(0,6),
    title:"Landed Production Spec CI",
    targetType:"PRODUCT",
    targetId:productionProductId
  })
});
ok(spec.response.status===201,"crea product specification");
const specId=Number(spec.body.specification?.id);

const version=await api("/v1/internal/product-specifications/"+specId+"/versions",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    changeSummary:"Versión para fixture landed cost",
    sections:{materials:{fabric:"cotton"}}
  })
});
ok(version.response.status===201,"crea specification version");
const specVersionId=Number(version.body.version?.id);

const approvedVersion=await api("/v1/internal/product-specification-versions/"+specVersionId+"/approve",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Aprobada para fixture landed"})
});
ok(approvedVersion.response.status===200,"aprueba specification version");

const runRows=await db`
  INSERT INTO production_runs(
    run_code,product_specification_version_id,manufacturer_link_id,status,
    actual_start_at,actual_end_at,completed_at,
    created_by_user_id,updated_by_user_id,released_by_user_id,completed_by_user_id,
    released_at
  )
  VALUES(
    ${"LC-RUN-"+crypto.randomUUID().slice(0,8)},
    ${specVersionId},${manufacturerLinkId},'COMPLETED',
    NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day',
    ${manager.userId},${manager.userId},${manager.userId},${manager.userId},
    NOW()-INTERVAL '3 days'
  )
  RETURNING id,run_code`;
const productionRunId=Number(runRows[0].id);

const lotRows=await db`
  INSERT INTO production_lots(
    production_run_id,lot_code,variant_id,status,
    planned_quantity,produced_quantity,started_at,completed_at,
    created_by_user_id,updated_by_user_id
  )
  VALUES(
    ${productionRunId},${"LC-LOT-"+crypto.randomUUID().slice(0,8)},
    ${productionVariantId},'COMPLETED',5,5,
    NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day',
    ${manager.userId},${manager.userId}
  )
  RETURNING id,lot_code`;
const productionLotId=Number(lotRows[0].id);

const productionInventoryBefore=await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${productionVariantId}`;
const productionMovementsBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${productionVariantId}`)[0]?.count||0);
const productionSourcesBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${productionVariantId}`)[0]?.count||0);
const productionVariantBefore=(await db`
  SELECT cost FROM product_variants WHERE id=${productionVariantId}`)[0];
const runBefore=(await db`
  SELECT status FROM production_runs WHERE id=${productionRunId}`)[0];
const lotBefore=(await db`
  SELECT status,produced_quantity FROM production_lots WHERE id=${productionLotId}`)[0];
const qcBefore=Number((await db`
  SELECT COUNT(*)::int count
  FROM quality_inspections
  WHERE product_id=${productionProductId} OR variant_id=${productionVariantId}`)[0]?.count||0);

const productionMissingCurrency=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-PROD-NOCUR-"+crypto.randomUUID().slice(0,5),
    sourceType:"PRODUCTION_RUN",
    sourceId:productionRunId
  })
});
ok(
  productionMissingCurrency.response.status===400 &&
  productionMissingCurrency.body.error==="currency_required",
  "production landed cost exige moneda explícita"
);

const productionCase=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-PROD-"+crypto.randomUUID().slice(0,6),
    sourceType:"PRODUCTION_RUN",
    sourceId:productionRunId,
    currency:"HNL",
    notes:"Costeo de producción"
  })
});
ok(productionCase.response.status===201,"crea caso de ProductionRun");
const productionCaseId=Number(productionCase.body.landedCostCase?.id);
ok(productionCase.body.landedCostCase?.totals?.sourceBaseCostMinor==null,"producción no inventa costo base");
ok(Number(productionCase.body.landedCostCase?.source?.quantityTotal)===5,"source conserva produced quantity");

const manufacturing=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    componentType:"MANUFACTURING",
    amountMinor:50000,
    description:"Costo directo manufactura"
  })
});
ok(manufacturing.response.status===201,"registra costo de manufactura explícito");

const prodFreight=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/components",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    componentType:"FREIGHT",
    amountMinor:5000,
    description:"Transporte de fábrica"
  })
});
ok(prodFreight.response.status===201,"registra flete de producción");

const productionAllocation=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/allocations",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    targetId:productionLotId,
    allocatedCostMinor:55000,
    notes:"Todo el costo al lote único"
  })
});
ok(productionAllocation.response.status===201,"asigna landed cost al ProductionLot");
ok(productionAllocation.body.allocation?.baseCostMinor==null,"allocation producción conserva base null");
ok(Number(productionAllocation.body.allocation?.quantitySnapshot)===5,"snapshot usa produced_quantity");

const productionFinal=await api("/v1/internal/landed-cost/cases/"+productionCaseId+"/finalize",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Costeo producción conciliado"})
});
ok(
  productionFinal.response.status===200 &&
  productionFinal.body.landedCostCase?.status==="FINAL",
  "finaliza caso producción"
);
const prodTotals=productionFinal.body.landedCostCase?.totals||{};
ok(prodTotals.sourceBaseCostMinor==null,"FINAL producción mantiene base null");
ok(Number(prodTotals.landedComponentsMinor)===55000,"FINAL producción suma componentes");
ok(Number(prodTotals.totalCostMinor)===55000,"total producción es componentes explícitos");
const prodAllocationFinal=productionFinal.body.landedCostCase?.allocations?.[0];
ok(Number(prodAllocationFinal?.totalCostMinor)===55000,"lote conserva total allocated");
ok(Number(prodAllocationFinal?.exactUnitTotalCostMinor)===11000,"unitario producción exacto 11000");

const scopedCasesAfterProduction=await api("/v1/internal/landed-cost/cases",{
  headers:{cookie:inventoryReader.cookie}
});
ok(
  scopedCasesAfterProduction.response.status===200 &&
  !scopedCasesAfterProduction.body.data?.some((x:any)=>Number(x.id)===productionCaseId),
  "LOCATION no ve landed cost case de ProductionRun"
);

const scopedProductionDetail=await api(
  "/v1/internal/landed-cost/cases/"+productionCaseId,
  {headers:{cookie:inventoryReader.cookie}}
);
ok(
  scopedProductionDetail.response.status===403 &&
  scopedProductionDetail.body.error==="forbidden",
  "LOCATION no abre detalle ProductionRun sin grant GLOBAL"
);

const managerProductionDetail=await api(
  "/v1/internal/landed-cost/cases/"+productionCaseId,
  {headers:{cookie:manager.cookie}}
);
ok(managerProductionDetail.response.status===200,"MANAGER GLOBAL conserva acceso a ProductionRun");

const productionInventoryAfter=await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${productionVariantId}`;
const productionMovementsAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${productionVariantId}`)[0]?.count||0);
const productionSourcesAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${productionVariantId}`)[0]?.count||0);
const productionVariantAfter=(await db`
  SELECT cost FROM product_variants WHERE id=${productionVariantId}`)[0];
const runAfter=(await db`
  SELECT status FROM production_runs WHERE id=${productionRunId}`)[0];
const lotAfter=(await db`
  SELECT status,produced_quantity FROM production_lots WHERE id=${productionLotId}`)[0];
const qcAfter=Number((await db`
  SELECT COUNT(*)::int count
  FROM quality_inspections
  WHERE product_id=${productionProductId} OR variant_id=${productionVariantId}`)[0]?.count||0);

ok(
  Number(productionInventoryAfter[0].quantity)===Number(productionInventoryBefore[0].quantity) &&
  Number(productionInventoryAfter[0].reserved)===Number(productionInventoryBefore[0].reserved),
  "production landed cost no recibe ni reserva inventario"
);
ok(productionMovementsAfter===productionMovementsBefore,"production landed cost no crea movimientos");
ok(productionSourcesAfter===productionSourcesBefore,"production landed cost no crea InventorySource");
ok(String(productionVariantAfter.cost)===String(productionVariantBefore.cost),"production landed cost no reescribe variant.cost");
ok(runAfter.status===runBefore.status&&runAfter.status==="COMPLETED","no cambia ProductionRun");
ok(
  lotAfter.status===lotBefore.status &&
  Number(lotAfter.produced_quantity)===Number(lotBefore.produced_quantity),
  "no cambia ProductionLot"
);
ok(qcAfter===qcBefore,"landed cost no crea ni modifica QualityInspection");

const coveragePo=await api("/v1/internal/procurement/purchase-orders",{
  method:"POST",
  headers:staffHeaders(manager,"land-cover-po-"+crypto.randomUUID()),
  body:JSON.stringify({
    supplierId,
    destinationLocationId:locationId,
    currency:"HNL",
    shippingEstimateMinor:0,
    taxEstimateMinor:0,
    otherCostsMinor:0,
    items:[
      {
        variantId:receiptVariantId,
        quantityOrdered:1,
        unitCostMinor:10000,
        originCountryCode:"HN"
      },
      {
        variantId:productionVariantId,
        quantityOrdered:1,
        unitCostMinor:20000,
        originCountryCode:"HN"
      }
    ]
  })
});
ok(coveragePo.response.status===201,"crea PO multi-línea para hardening de cobertura");
const coveragePoId=Number(coveragePo.body.purchaseOrder?.id);

const coverageApproved=await api("/v1/internal/procurement/purchase-orders/"+coveragePoId+"/approve",{
  method:"POST",headers:staffHeaders(manager),body:"{}"
});
ok(coverageApproved.response.status===200,"aprueba PO de cobertura");

const coverageOrdered=await api("/v1/internal/procurement/purchase-orders/"+coveragePoId+"/order",{
  method:"POST",headers:staffHeaders(manager),body:"{}"
});
ok(coverageOrdered.response.status===200,"ordena PO de cobertura");
const coverageItemA=Number(
  coverageOrdered.body.purchaseOrder?.items?.find(
    (x:any)=>Number(x.variantId)===receiptVariantId
  )?.id
);
const coverageItemB=Number(
  coverageOrdered.body.purchaseOrder?.items?.find(
    (x:any)=>Number(x.variantId)===productionVariantId
  )?.id
);
ok(coverageItemA>0&&coverageItemB>0,"resuelve ambas líneas de PO para cobertura");

const coverageReceipt=await api(
  "/v1/internal/procurement/purchase-orders/"+coveragePoId+"/receipts",
  {
    method:"POST",
    headers:staffHeaders(inventoryReader,"land-cover-gr-"+crypto.randomUUID()),
    body:JSON.stringify({
      supplierDeliveryReference:"LAND-COVERAGE-CI",
      items:[
        {purchaseOrderItemId:coverageItemA,quantityReceived:1},
        {purchaseOrderItemId:coverageItemB,quantityReceived:1}
      ]
    })
  }
);
ok(coverageReceipt.response.status===201,"posta receipt multi-línea para cobertura");
const coverageReceiptId=Number(coverageReceipt.body.goodsReceipt?.id);
const coverageReceiptItems:any[]=Array.isArray(coverageReceipt.body.goodsReceipt?.items)
  ?coverageReceipt.body.goodsReceipt.items
  :[];
const coverageReceiptItemA=Number(
  coverageReceiptItems.find((x:any)=>Number(x.variantId)===receiptVariantId)?.id
);
const coverageReceiptItemB=Number(
  coverageReceiptItems.find((x:any)=>Number(x.variantId)===productionVariantId)?.id
);
ok(
  coverageReceiptItemA>0&&coverageReceiptItemB>0,
  "receipt multi-línea expone ambos targets de landed cost"
);

const coverageCase=await api("/v1/internal/landed-cost/cases",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    caseCode:"LC-COVER-"+crypto.randomUUID().slice(0,6),
    sourceType:"GOODS_RECEIPT",
    sourceId:coverageReceiptId
  })
});
ok(coverageCase.response.status===201,"crea caso multi-línea de hardening");
const coverageCaseId=Number(coverageCase.body.landedCostCase?.id);

const coverageComponent=await api(
  "/v1/internal/landed-cost/cases/"+coverageCaseId+"/components",
  {
    method:"POST",
    headers:staffHeaders(manager),
    body:JSON.stringify({
      componentType:"FREIGHT",
      amountMinor:1000,
      description:"Componente para validar cobertura"
    })
  }
);
ok(coverageComponent.response.status===201,"crea componente para caso multi-línea");

const coverageAllocationA=await api(
  "/v1/internal/landed-cost/cases/"+coverageCaseId+"/allocations",
  {
    method:"POST",
    headers:staffHeaders(manager),
    body:JSON.stringify({
      targetId:coverageReceiptItemA,
      allocatedCostMinor:1000,
      notes:"Balance total, pero falta segunda línea"
    })
  }
);
ok(coverageAllocationA.response.status===201,"crea primera allocation del caso multi-línea");

const coverageFinalize=await api(
  "/v1/internal/landed-cost/cases/"+coverageCaseId+"/finalize",
  {
    method:"POST",
    headers:staffHeaders(manager),
    body:JSON.stringify({note:"Debe fallar por línea sin asignación"})
  }
);
ok(
  coverageFinalize.response.status===409 &&
  coverageFinalize.body.error==="complete_allocation_coverage_required" &&
  Number(coverageFinalize.body.eligibleLineCount)===2 &&
  Number(coverageFinalize.body.allocationCount)===1,
  "FINAL exige allocation explícita para cada línea elegible aunque el total ya balancee"
);

const coverageAllocationB=await api(
  "/v1/internal/landed-cost/cases/"+coverageCaseId+"/allocations",
  {
    method:"POST",
    headers:staffHeaders(manager),
    body:JSON.stringify({
      targetId:coverageReceiptItemB,
      allocatedCostMinor:0,
      notes:"Allocation explícita de cero mantiene cobertura completa"
    })
  }
);
ok(coverageAllocationB.response.status===201,"allocation cero completa cobertura explícita");

await db.unsafe(
  "UPDATE goods_receipt_items SET unit_cost_minor=$1 WHERE id=$2",
  [11000,coverageReceiptItemA]
);

const staleBaseFinalize=await api(
  "/v1/internal/landed-cost/cases/"+coverageCaseId+"/finalize",
  {
    method:"POST",
    headers:staffHeaders(manager),
    body:JSON.stringify({note:"Debe fallar por costo base cambiado"})
  }
);
ok(
  staleBaseFinalize.response.status===409 &&
  staleBaseFinalize.body.error==="allocation_base_cost_stale" &&
  Number(staleBaseFinalize.body.targetId)===coverageReceiptItemA &&
  Number(staleBaseFinalize.body.snapshotBaseUnitCostMinor)===10000 &&
  Number(staleBaseFinalize.body.currentBaseUnitCostMinor)===11000,
  "FINAL revalida snapshot de costo base de GoodsReceiptItem"
);

await db.unsafe(
  "UPDATE goods_receipt_items SET unit_cost_minor=$1 WHERE id=$2",
  [10000,coverageReceiptItemA]
);

const coverageFinal=await api(
  "/v1/internal/landed-cost/cases/"+coverageCaseId+"/finalize",
  {
    method:"POST",
    headers:staffHeaders(manager),
    body:JSON.stringify({note:"Cobertura y costos base revalidados"})
  }
);
ok(
  coverageFinal.response.status===200 &&
  coverageFinal.body.landedCostCase?.status==="FINAL",
  "caso multi-línea finaliza después de restaurar invariantes"
);
ok(
  Number(coverageFinal.body.landedCostCase?.totals?.sourceBaseCostMinor)===30000 &&
  Number(coverageFinal.body.landedCostCase?.totals?.landedComponentsMinor)===1000 &&
  Number(coverageFinal.body.landedCostCase?.totals?.totalCostMinor)===31000,
  "hardening preserva base receipt + landed cost tras cobertura completa"
);


const receiptDetail=await api("/v1/internal/landed-cost/cases/"+receiptCaseId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(receiptDetail.response.status===200,"detalle FINAL es legible");
const actions=(receiptDetail.body.history||[]).map((x:any)=>x.action);
ok(actions.includes("CREATED"),"history conserva CREATED");
ok(actions.includes("COMPONENT_CREATED"),"history conserva COMPONENT_CREATED");
ok(actions.includes("ALLOCATION_CREATED"),"history conserva ALLOCATION_CREATED");
ok(actions.includes("ALLOCATION_UPDATED"),"history conserva ALLOCATION_UPDATED");
ok(actions.includes("FINALIZED"),"history conserva FINALIZED");

const audits=await db`
  SELECT action
  FROM audit_events
  WHERE (
    resource_type='LandedCostCase' AND resource_id IN (${String(receiptCaseId)},${String(productionCaseId)})
  ) OR resource_type IN ('LandedCostComponent','LandedCostAllocation')
  ORDER BY id`;
ok(audits.some((x:any)=>x.action==="landed_cost_case.created"),"audit registra case.created");
ok(audits.some((x:any)=>x.action==="landed_cost_component.created"),"audit registra component.created");
ok(audits.some((x:any)=>x.action==="landed_cost_allocation.created"),"audit registra allocation.created");
ok(audits.some((x:any)=>x.action==="landed_cost_case.finalized"),"audit registra case.finalized");

const unauth=await api("/v1/internal/landed-cost/cases");
ok(unauth.response.status===401,"landed cost interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Landed Cost v1");
await db.close();
