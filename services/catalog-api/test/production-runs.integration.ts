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
  const password="PROD-"+crypto.randomUUID()+"-R9!";
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
  "x-internal-key":serviceKey,
  "content-type":"application/json"
};

const manager=await createStaff("MANAGER","Production Manager CI");
const inventoryReader=await createStaff("INVENTORY_OPERATOR","Production Reader CI");
const analyst=await createStaff("ANALYST","Production Analyst CI");

ok(manager.login.response.status===200,"manager inicia sesión");
ok(inventoryReader.login.response.status===200,"inventory operator inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const product=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Production Run CI Product",
    category:"Vestuario",
    brand:"MR",
    commercialModel:"private_label",
    defaultCondition:"new",
    status:"draft",
    variants:[
      {
        sku:"PROD-CI-A-"+crypto.randomUUID().slice(0,6),
        size:"M",
        color:"Negro",
        price:1000,
        currency:"HNL",
        stock:5
      },
      {
        sku:"PROD-CI-B-"+crypto.randomUUID().slice(0,6),
        size:"L",
        color:"Negro",
        price:1000,
        currency:"HNL",
        stock:2
      }
    ]
  })
});
ok(product.response.status===201,"crea producto privado para producción");
const productId=Number(product.body.product?.id);
const variantAId=Number(product.body.variants?.[0]?.id);
const variantBId=Number(product.body.variants?.[1]?.id);
ok(productId>0&&variantAId>0&&variantBId>0,"producto y variantes reciben IDs");

const manufacturer=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    name:"Production Factory CI",
    countryCode:"HN",
    city:"San Pedro Sula"
  })
});
ok(manufacturer.response.status===201,"crea fabricante");
const manufacturerId=Number(manufacturer.body.manufacturer?.id);

const manufacturerLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    manufacturerId,
    targetType:"PRODUCT",
    targetId:productId,
    manufacturerReference:"FACTORY-PROD-CI"
  })
});
ok(manufacturerLink.response.status===201,"vincula fabricante al producto");
const manufacturerLinkId=Number(manufacturerLink.body.link?.id);

const spec=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    code:"SPEC-PROD-"+crypto.randomUUID().slice(0,6),
    title:"Production CI Technical Specification",
    targetType:"PRODUCT",
    targetId:productId
  })
});
ok(spec.response.status===201,"crea specification");
const specId=Number(spec.body.specification?.id);

const draftV1=await api("/v1/internal/product-specifications/"+specId+"/versions",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    changeSummary:"Primera versión para producción CI",
    sections:{
      materials:{fabric:"cotton"},
      measurements:{sizeGrid:["M","L"]},
      construction:{stitch:"standard"},
      packaging:{bag:"individual"},
      labeling:{brand:"MR"},
      qualityRequirements:{visual:"required"}
    }
  })
});
ok(draftV1.response.status===201,"crea draft v1");
const v1Id=Number(draftV1.body.version?.id);

const runWithDraft=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    runCode:"RUN-DRAFT-"+crypto.randomUUID().slice(0,6),
    productSpecificationVersionId:v1Id,
    manufacturerLinkId
  })
});
ok(
  runWithDraft.response.status===409 &&
  runWithDraft.body.error==="approved_specification_version_required",
  "run rechaza specification DRAFT"
);

const approveV1=await api("/v1/internal/product-specification-versions/"+v1Id+"/approve",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Aprobada para primera planificación CI"})
});
ok(approveV1.response.status===200&&approveV1.body.version?.status==="APPROVED","aprueba v1");

const oldRun=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    runCode:"RUN-OLD-"+crypto.randomUUID().slice(0,6),
    productSpecificationVersionId:v1Id,
    manufacturerLinkId,
    externalReference:"OLD-SPEC"
  })
});
ok(oldRun.response.status===201,"crea run contra v1 aprobada");
const oldRunId=Number(oldRun.body.run?.id);

const oldLot=await api("/v1/internal/production-runs/"+oldRunId+"/lots",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    lotCode:"LOT-OLD-"+crypto.randomUUID().slice(0,6),
    variantId:variantAId,
    plannedQuantity:5
  })
});
ok(oldLot.response.status===201,"crea lote del run v1");

const draftV2=await api("/v1/internal/product-specifications/"+specId+"/versions",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    cloneVersionId:v1Id,
    changeSummary:"Segunda versión para producción CI",
    sections:{qualityRequirements:{visual:"required",stitching:"tight"}}
  })
});
ok(draftV2.response.status===201,"crea v2");
const v2Id=Number(draftV2.body.version?.id);

const approveV2=await api("/v1/internal/product-specification-versions/"+v2Id+"/approve",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"V2 reemplaza v1"})
});
ok(approveV2.response.status===200&&approveV2.body.version?.status==="APPROVED","aprueba v2");
ok(
  Array.isArray(approveV2.body.supersededVersionIds)&&approveV2.body.supersededVersionIds.includes(v1Id),
  "aprobar v2 supersede v1"
);

const releaseOld=await api("/v1/internal/production-runs/"+oldRunId+"/release",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Debe fallar por spec superseded"})
});
ok(
  releaseOld.response.status===409 &&
  releaseOld.body.error==="approved_specification_version_required",
  "release revalida specification y bloquea v1 superseded"
);

const run=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    runCode:"RUN-CI-"+crypto.randomUUID().slice(0,6),
    productSpecificationVersionId:v2Id,
    manufacturerLinkId,
    externalReference:"FACTORY-ORDER-CI",
    notes:"Run principal de integración"
  })
});
ok(run.response.status===201,"crea run principal con v2 aprobada");
const runId=Number(run.body.run?.id);
ok(run.body.run?.status==="PLANNED","run inicia PLANNED");
ok(run.body.inventoryChanged===false,"crear run no cambia inventario");

const lot=await api("/v1/internal/production-runs/"+runId+"/lots",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    lotCode:"LOT-CI-"+crypto.randomUUID().slice(0,6),
    variantId:variantAId,
    plannedQuantity:7,
    notes:"Lote principal"
  })
});
ok(lot.response.status===201,"crea lote principal");
const lotId=Number(lot.body.lot?.id);
ok(lot.body.lot?.status==="PLANNED","lote inicia PLANNED");
ok(lot.body.inventoryChanged===false,"crear lote no cambia inventario");

const readerList=await api("/v1/internal/production-runs",{
  headers:{cookie:inventoryReader.cookie}
});
ok(readerList.response.status===200,"Inventory Operator puede leer production runs");

const analystList=await api("/v1/internal/production-runs",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystList.response.status===403&&analystList.body.error==="forbidden",
  "reports.read no concede production_runs.read"
);

const readerMutate=await api("/v1/internal/production-runs/"+runId+"/lots",{
  method:"POST",
  headers:staffHeaders(inventoryReader),
  body:JSON.stringify({
    lotCode:"UNAUTHORIZED-"+crypto.randomUUID().slice(0,4),
    variantId:variantBId,
    plannedQuantity:1
  })
});
ok(
  readerMutate.response.status===403&&readerMutate.body.error==="forbidden",
  "production_runs.read no concede manage"
);

const variantManufacturerLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    manufacturerId,
    targetType:"VARIANT",
    targetId:variantAId,
    manufacturerReference:"FACTORY-VARIANT-A-CI"
  })
});
ok(variantManufacturerLink.response.status===201,"crea ManufacturerLink específico de variante A");
const variantManufacturerLinkId=Number(variantManufacturerLink.body.link?.id);

const variantSpec=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    code:"SPEC-VARIANT-"+crypto.randomUUID().slice(0,6),
    title:"Production CI Variant A Specification",
    targetType:"VARIANT",
    targetId:variantAId
  })
});
ok(variantSpec.response.status===201,"crea specification específica de variante A");
const variantSpecId=Number(variantSpec.body.specification?.id);

const variantSpecDraft=await api("/v1/internal/product-specifications/"+variantSpecId+"/versions",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    changeSummary:"Specification específica para variante A",
    sections:{measurements:{size:"M"},qualityRequirements:{visual:"required"}}
  })
});
ok(variantSpecDraft.response.status===201,"crea versión de specification de variante A");
const variantSpecVersionId=Number(variantSpecDraft.body.version?.id);

const variantSpecApproved=await api("/v1/internal/product-specification-versions/"+variantSpecVersionId+"/approve",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Aprobada para validar compatibilidad por variante"})
});
ok(
  variantSpecApproved.response.status===200 &&
  variantSpecApproved.body.version?.status==="APPROVED",
  "aprueba specification de variante A"
);

const variantSpecRun=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    runCode:"RUN-VARIANT-SPEC-"+crypto.randomUUID().slice(0,6),
    productSpecificationVersionId:variantSpecVersionId,
    manufacturerLinkId
  })
});
ok(
  variantSpecRun.response.status===201,
  "spec VARIANT puede usar ManufacturerLink PRODUCT del mismo producto"
);
const variantSpecRunId=Number(variantSpecRun.body.run?.id);

const wrongLotForVariantSpec=await api("/v1/internal/production-runs/"+variantSpecRunId+"/lots",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    lotCode:"LOT-WRONG-SPEC-"+crypto.randomUUID().slice(0,6),
    variantId:variantBId,
    plannedQuantity:2
  })
});
ok(
  wrongLotForVariantSpec.response.status===409 &&
  wrongLotForVariantSpec.body.error==="specification_variant_mismatch",
  "specification VARIANT rechaza lote de otra variante"
);

const correctLotForVariantSpec=await api("/v1/internal/production-runs/"+variantSpecRunId+"/lots",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    lotCode:"LOT-CORRECT-SPEC-"+crypto.randomUUID().slice(0,6),
    variantId:variantAId,
    plannedQuantity:2
  })
});
ok(correctLotForVariantSpec.response.status===201,"specification VARIANT acepta su variante exacta");

const variantManufacturerRun=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    runCode:"RUN-VARIANT-MFG-"+crypto.randomUUID().slice(0,6),
    productSpecificationVersionId:v2Id,
    manufacturerLinkId:variantManufacturerLinkId
  })
});
ok(
  variantManufacturerRun.response.status===201,
  "spec PRODUCT puede usar ManufacturerLink VARIANT del mismo producto"
);
const variantManufacturerRunId=Number(variantManufacturerRun.body.run?.id);

const wrongLotForVariantManufacturer=await api("/v1/internal/production-runs/"+variantManufacturerRunId+"/lots",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    lotCode:"LOT-WRONG-MFG-"+crypto.randomUUID().slice(0,6),
    variantId:variantBId,
    plannedQuantity:2
  })
});
ok(
  wrongLotForVariantManufacturer.response.status===409 &&
  wrongLotForVariantManufacturer.body.error==="manufacturer_link_variant_mismatch",
  "ManufacturerLink VARIANT rechaza lote de otra variante"
);

const correctLotForVariantManufacturer=await api("/v1/internal/production-runs/"+variantManufacturerRunId+"/lots",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    lotCode:"LOT-CORRECT-MFG-"+crypto.randomUUID().slice(0,6),
    variantId:variantAId,
    plannedQuantity:2
  })
});
ok(correctLotForVariantManufacturer.response.status===201,"ManufacturerLink VARIANT acepta su variante exacta");

const inventoryBefore=(await db`
  SELECT
    COALESCE(SUM(quantity),0)::int AS quantity,
    COALESCE(SUM(reserved),0)::int AS reserved
  FROM inventory
  WHERE variant_id IN (${variantAId},${variantBId})`)[0];
const movementsBefore=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id IN (${variantAId},${variantBId})`)[0]?.count||0);
const sourcesBefore=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_sources
  WHERE variant_id IN (${variantAId},${variantBId})`)[0]?.count||0);
const poBefore=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const receiptsBefore=Number((await db`SELECT COUNT(*)::int count FROM goods_receipts`)[0]?.count||0);
const manufacturerLinksBefore=Number((await db`
  SELECT COUNT(*)::int count FROM manufacturer_links WHERE id=${manufacturerLinkId}`)[0]?.count||0);
const productBefore=(await db`
  SELECT status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];

const serviceRelease=await api("/v1/internal/production-runs/"+runId+"/release",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({note:"Servicio no debe poder liberar"})
});
ok(
  serviceRelease.response.status===403 &&
  serviceRelease.body.error==="human_release_required",
  "release exige StaffUser humano"
);

const readerRelease=await api("/v1/internal/production-runs/"+runId+"/release",{
  method:"POST",
  headers:staffHeaders(inventoryReader),
  body:JSON.stringify({note:"Reader no debe liberar"})
});
ok(
  readerRelease.response.status===403&&readerRelease.body.error==="forbidden",
  "Inventory Operator no puede liberar"
);

const released=await api("/v1/internal/production-runs/"+runId+"/release",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Plan validado para fabricación"})
});
ok(released.response.status===200&&released.body.run?.status==="RELEASED","manager libera run");
ok(released.body.inventoryChanged===false,"release no cambia inventario");

const editAfterRelease=await api("/v1/internal/production-runs/"+runId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({externalReference:"SHOULD-NOT-CHANGE"})
});
ok(
  editAfterRelease.response.status===409 &&
  editAfterRelease.body.error==="run_configuration_locked",
  "release bloquea configuración del run"
);

const editLotAfterRelease=await api("/v1/internal/production-lots/"+lotId,{
  method:"PATCH",
  headers:staffHeaders(manager),
  body:JSON.stringify({plannedQuantity:8})
});
ok(
  editLotAfterRelease.response.status===409 &&
  editLotAfterRelease.body.error==="run_configuration_locked",
  "release bloquea configuración del lote"
);

const startedRun=await api("/v1/internal/production-runs/"+runId+"/start",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Inicio real de fabricación"})
});
ok(startedRun.response.status===200&&startedRun.body.run?.status==="IN_PRODUCTION","inicia run");

const startedLot=await api("/v1/internal/production-lots/"+lotId+"/start",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Lote entra a línea"})
});
ok(startedLot.response.status===200&&startedLot.body.lot?.status==="IN_PRODUCTION","inicia lote");

const prematureRunComplete=await api("/v1/internal/production-runs/"+runId+"/complete",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Aún no"})
});
ok(
  prematureRunComplete.response.status===409 &&
  prematureRunComplete.body.error==="lots_not_closed",
  "run no completa mientras lote sigue abierto"
);

const completedLot=await api("/v1/internal/production-lots/"+lotId+"/complete",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({
    producedQuantity:7,
    note:"Fabricación física terminada; pendiente QC/recepción"
  })
});
ok(completedLot.response.status===200&&completedLot.body.lot?.status==="COMPLETED","completa lote");
ok(Number(completedLot.body.lot?.producedQuantity)===7,"registra cantidad producida");
ok(completedLot.body.inventoryChanged===false,"lote completado no recibe inventario");
ok(completedLot.body.qualityApproved===false,"lote completado no aprueba QC");

const completedRun=await api("/v1/internal/production-runs/"+runId+"/complete",{
  method:"POST",
  headers:staffHeaders(manager),
  body:JSON.stringify({note:"Fabricación finalizada; pendiente QC/costos/recepción"})
});
ok(completedRun.response.status===200&&completedRun.body.run?.status==="COMPLETED","completa run");
ok(completedRun.body.inventoryChanged===false,"run completo no cambia inventario");
ok(completedRun.body.productionReceiptCreated===false,"run completo no crea receipt");
ok(completedRun.body.landedCostCalculated===false,"run completo no calcula landed cost");
ok(completedRun.body.qualityApproved===false,"run completo no aprueba calidad");

const runDetail=await api("/v1/internal/production-runs/"+runId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(runDetail.response.status===200,"detalle de run responde");
const runActions=(runDetail.body.history||[]).map((x:any)=>x.action);
ok(runActions.includes("CREATED"),"historial conserva CREATED");
ok(runActions.includes("RELEASED"),"historial conserva RELEASED");
ok(runActions.includes("STARTED"),"historial conserva STARTED");
ok(runActions.includes("COMPLETED"),"historial conserva COMPLETED");

const lotDetail=await api("/v1/internal/production-lots/"+lotId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(lotDetail.response.status===200,"detalle de lote responde");
const lotActions=(lotDetail.body.history||[]).map((x:any)=>x.action);
ok(lotActions.includes("CREATED"),"historial lote conserva CREATED");
ok(lotActions.includes("STARTED"),"historial lote conserva STARTED");
ok(lotActions.includes("COMPLETED"),"historial lote conserva COMPLETED");

const inventoryAfter=(await db`
  SELECT
    COALESCE(SUM(quantity),0)::int AS quantity,
    COALESCE(SUM(reserved),0)::int AS reserved
  FROM inventory
  WHERE variant_id IN (${variantAId},${variantBId})`)[0];
const movementsAfter=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id IN (${variantAId},${variantBId})`)[0]?.count||0);
const sourcesAfter=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_sources
  WHERE variant_id IN (${variantAId},${variantBId})`)[0]?.count||0);
const poAfter=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const receiptsAfter=Number((await db`SELECT COUNT(*)::int count FROM goods_receipts`)[0]?.count||0);
const manufacturerLinksAfter=Number((await db`
  SELECT COUNT(*)::int count FROM manufacturer_links WHERE id=${manufacturerLinkId}`)[0]?.count||0);
const productAfter=(await db`
  SELECT status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];
const v2After=(await db`
  SELECT status FROM product_specification_versions WHERE id=${v2Id}`)[0];

ok(
  Number(inventoryAfter.quantity)===Number(inventoryBefore.quantity) &&
  Number(inventoryAfter.reserved)===Number(inventoryBefore.reserved),
  "producción no cambia quantity/reserved"
);
ok(movementsAfter===movementsBefore,"producción no crea inventory_movements");
ok(sourcesAfter===sourcesBefore,"producción no crea InventorySource");
ok(poAfter===poBefore,"producción no crea PurchaseOrder");
ok(receiptsAfter===receiptsBefore,"producción no crea GoodsReceipt");
ok(manufacturerLinksAfter===manufacturerLinksBefore,"producción no modifica ManufacturerLink");
ok(
  productAfter.status===productBefore.status &&
  productAfter.commercial_model===productBefore.commercial_model &&
  productAfter.default_condition===productBefore.default_condition,
  "producción no cambia catálogo/clasificación"
);
ok(v2After.status==="APPROVED","run no altera estado de specification aprobada");

const audits=await db`
  SELECT action
  FROM audit_events
  WHERE (
    resource_type='ProductionRun' AND resource_id=${String(runId)}
  ) OR (
    resource_type='ProductionLot' AND resource_id=${String(lotId)}
  )
  ORDER BY id`;
ok(audits.some((x:any)=>x.action==="production_run.created"),"audit registra run.created");
ok(audits.some((x:any)=>x.action==="production_run.released"),"audit registra run.released");
ok(audits.some((x:any)=>x.action==="production_run.completed"),"audit registra run.completed");
ok(audits.some((x:any)=>x.action==="production_lot.completed"),"audit registra lot.completed");

const unauth=await api("/v1/internal/production-runs");
ok(unauth.response.status===401,"production runs internos exigen autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Production Run / Lot v1");
await db.close();
