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

function headers(session:{cookie:string;csrf:string}){
  return {
    cookie:session.cookie,
    "x-csrf-token":session.csrf,
    "content-type":"application/json"
  };
}

const product=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:{
    "content-type":"application/json",
    "x-internal-key":serviceKey
  },
  body:JSON.stringify({
    name:"Production Run CI Product",
    category:"Vestuario",
    brand:"MR",
    commercialModel:"private_label",
    defaultCondition:"new",
    status:"draft",
    variants:[
      {
        sku:"PROD-CI-M-"+crypto.randomUUID().slice(0,6),
        size:"M",color:"Negro",price:1600,currency:"HNL",stock:5
      },
      {
        sku:"PROD-CI-L-"+crypto.randomUUID().slice(0,6),
        size:"L",color:"Negro",price:1600,currency:"HNL",stock:6
      }
    ]
  })
});
ok(product.response.status===201,"crea producto base con dos variantes");
const productId=Number(product.body.product?.id);
const variantM=Number(product.body.variants?.[0]?.id);
const variantL=Number(product.body.variants?.[1]?.id);

const manager=await createStaff("MANAGER","Production Run Manager");
const reader=await createStaff("INVENTORY_OPERATOR","Production Run Reader");
const analyst=await createStaff("ANALYST","Production Run Analyst");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(reader.login.response.status===200,"inventory operator inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const manufacturer=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    name:"Production Factory CI",
    countryCode:"HN",
    city:"San Pedro Sula"
  })
});
ok(manufacturer.response.status===201,"crea fabricante");
const manufacturerId=Number(manufacturer.body.manufacturer?.id);

const productLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId,
    targetType:"PRODUCT",
    targetId:productId,
    manufacturerReference:"FACTORY-PROD"
  })
});
ok(productLink.response.status===201,"crea ManufacturerLink de producto");
const productLinkId=Number(productLink.body.link?.id);

const variantLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId,
    targetType:"VARIANT",
    targetId:variantM,
    manufacturerReference:"FACTORY-M"
  })
});
ok(variantLink.response.status===201,"crea ManufacturerLink de variante M");
const variantLinkId=Number(variantLink.body.link?.id);

const productSpec=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    code:"PROD-SPEC-CI",
    title:"Production product spec",
    targetType:"PRODUCT",
    targetId:productId
  })
});
const productSpecId=Number(productSpec.body.specification?.id);
const productSpecV1=await api("/v1/internal/product-specifications/"+productSpecId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    changeSummary:"Production approved baseline",
    sections:{materials:{shell:"cotton"},qualityRequirements:{visual:"pass"}}
  })
});
const productSpecV1Id=Number(productSpecV1.body.version?.id);
const productSpecApprove=await api("/v1/internal/product-specification-versions/"+productSpecV1Id+"/approve",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Approved for production"})
});
ok(productSpecApprove.response.status===200,"aprueba specification de producto");

const draftSpec=await api("/v1/internal/product-specifications/"+productSpecId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    cloneVersionId:productSpecV1Id,
    changeSummary:"Draft should not release production"
  })
});
const draftSpecId=Number(draftSpec.body.version?.id);
ok(draftSpec.response.status===201,"crea versión DRAFT para guard");

const variantSpec=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    code:"PROD-SPEC-CI-M",
    title:"Production variant M spec",
    targetType:"VARIANT",
    targetId:variantM
  })
});
const variantSpecId=Number(variantSpec.body.specification?.id);
const variantSpecV1=await api("/v1/internal/product-specifications/"+variantSpecId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    changeSummary:"Variant M approved spec",
    sections:{measurements:{size:"M"}}
  })
});
const variantSpecV1Id=Number(variantSpecV1.body.version?.id);
const variantSpecApprove=await api("/v1/internal/product-specification-versions/"+variantSpecV1Id+"/approve",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Approved variant M"})
});
ok(variantSpecApprove.response.status===200,"aprueba specification de variante M");

const poBefore=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources
  WHERE variant_id IN (${variantM},${variantL})`)[0]?.count||0);
const movementsBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements
  WHERE variant_id IN (${variantM},${variantL})`)[0]?.count||0);
const inventoryBefore=await db`
  SELECT variant_id,quantity,reserved
  FROM inventory
  WHERE variant_id IN (${variantM},${variantL})
  ORDER BY variant_id`;
const qcBefore=Number((await db`SELECT COUNT(*)::int count FROM quality_inspections`)[0]?.count||0);
const productBefore=(await db`
  SELECT name,status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];
const linkBefore=await db`
  SELECT id,active,manufacturer_id,target_type,product_id,variant_id
  FROM manufacturer_links
  WHERE id IN (${productLinkId},${variantLinkId})
  ORDER BY id`;

const readerList=await api("/v1/internal/production-runs",{
  headers:{cookie:reader.cookie}
});
ok(readerList.response.status===200,"Inventory Operator puede leer production runs");

const readerCreate=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:headers(reader),
  body:JSON.stringify({
    runCode:"RUN-UNAUTHORIZED",
    productSpecificationVersionId:productSpecV1Id,
    manufacturerLinkId:productLinkId
  })
});
ok(
  readerCreate.response.status===403&&readerCreate.body.error==="forbidden",
  "production_runs.read no concede manage"
);

const analystRead=await api("/v1/internal/production-runs",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystRead.response.status===403&&analystRead.body.error==="forbidden",
  "reports.read no concede production_runs.read"
);

const draftRun=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    runCode:"RUN-DRAFT-SPEC",
    productSpecificationVersionId:draftSpecId,
    manufacturerLinkId:productLinkId
  })
});
ok(
  draftRun.response.status===409&&draftRun.body.error==="approved_specification_required",
  "run exige specification APPROVED"
);

const run=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    runCode:"RUN-CI-001",
    productSpecificationVersionId:productSpecV1Id,
    manufacturerLinkId:productLinkId,
    externalReference:"FACTORY-ORDER-001",
    notes:"Pilot production run."
  })
});
ok(run.response.status===201,"crea production run PLANNED");
const runId=Number(run.body.productionRun?.id);
ok(run.body.productionRun?.status==="PLANNED","run nace PLANNED");
ok(run.body.inventoryChanged===false,"crear run no cambia inventario");

const releaseEmpty=await api("/v1/internal/production-runs/"+runId+"/release",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({})
});
ok(
  releaseEmpty.response.status===409&&releaseEmpty.body.error==="lot_required",
  "release exige al menos un lote"
);

const lotM=await api("/v1/internal/production-runs/"+runId+"/lots",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    lotCode:"LOT-CI-M-001",
    variantId:variantM,
    plannedQuantity:20,
    notes:"Size M"
  })
});
ok(lotM.response.status===201,"crea lote M");
const lotMId=Number(lotM.body.lot?.id);

const lotL=await api("/v1/internal/production-runs/"+runId+"/lots",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    lotCode:"LOT-CI-L-001",
    variantId:variantL,
    plannedQuantity:15,
    notes:"Size L"
  })
});
ok(lotL.response.status===201,"product-level run acepta segunda variante");
const lotLId=Number(lotL.body.lot?.id);

const lotUpdate=await api("/v1/internal/production-lots/"+lotLId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    plannedQuantity:16,
    changeNote:"Factory confirms one additional unit."
  })
});
ok(lotUpdate.response.status===200,"edita lote mientras run PLANNED");
ok(lotUpdate.body.lot?.plannedQuantity===16,"actualiza cantidad planificada");

const serviceRelease=await api("/v1/internal/production-runs/"+runId+"/release",{
  method:"POST",
  headers:{
    "content-type":"application/json",
    "x-internal-key":serviceKey
  },
  body:JSON.stringify({})
});
ok(
  serviceRelease.response.status===403&&serviceRelease.body.error==="human_lifecycle_action_required",
  "release exige StaffUser humano"
);

const released=await api("/v1/internal/production-runs/"+runId+"/release",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Plan de lotes confirmado."})
});
ok(released.response.status===200,"libera run");
ok(released.body.productionRun?.status==="RELEASED","run queda RELEASED");

const lateLot=await api("/v1/internal/production-runs/"+runId+"/lots",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    lotCode:"LOT-LATE",
    variantId:variantM,
    plannedQuantity:1
  })
});
ok(
  lateLot.response.status===409&&lateLot.body.error==="run_not_editable",
  "después de release no agrega lotes"
);

const started=await api("/v1/internal/production-runs/"+runId+"/start",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Factory confirmed start."})
});
ok(started.response.status===200,"inicia production run");
ok(started.body.productionRun?.status==="IN_PRODUCTION","run queda IN_PRODUCTION");

const completeTooEarly=await api("/v1/internal/production-runs/"+runId+"/complete",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({})
});
ok(
  completeTooEarly.response.status===409&&completeTooEarly.body.error==="lots_not_terminal",
  "run no completa con lotes no terminales"
);

const startM=await api("/v1/internal/production-lots/"+lotMId+"/start",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({})
});
ok(startM.response.status===200&&startM.body.lot?.status==="IN_PRODUCTION","inicia lote M");

const completeM=await api("/v1/internal/production-lots/"+lotMId+"/complete",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    producedQuantity:21,
    note:"One-unit overrun accepted in production record."
  })
});
ok(completeM.response.status===200,"completa lote M");
ok(completeM.body.lot?.status==="COMPLETED","lote M queda COMPLETED");
ok(completeM.body.lot?.producedQuantity===21,"registra produced_quantity sin limitar a plan");
ok(completeM.body.inventoryChanged===false,"completar lote no recibe inventario");

const cancelL=await api("/v1/internal/production-lots/"+lotLId+"/cancel",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Talla L se posterga a otro run."})
});
ok(cancelL.response.status===200&&cancelL.body.lot?.status==="CANCELLED","cancela lote L explícitamente");

const completed=await api("/v1/internal/production-runs/"+runId+"/complete",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Run cerrado con lote M completado."})
});
ok(completed.response.status===200,"completa run");
ok(completed.body.productionRun?.status==="COMPLETED","run queda COMPLETED");
ok(completed.body.goodsReceiptCreated===false,"run COMPLETED no crea GoodsReceipt");
ok(completed.body.inventoryChanged===false,"run COMPLETED no cambia inventario");
ok(completed.body.landedCostCalculated===false,"run COMPLETED no calcula landed cost");

const editCompleted=await api("/v1/internal/production-runs/"+runId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({notes:"No debe editarse"})
});
ok(
  editCompleted.response.status===409&&editCompleted.body.error==="run_not_editable",
  "run completado no permite editar planificación"
);

const variantRun=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    runCode:"RUN-CI-VARIANT-M",
    productSpecificationVersionId:variantSpecV1Id,
    manufacturerLinkId:productLinkId
  })
});
ok(variantRun.response.status===201,"variant spec acepta ManufacturerLink de producto");
const variantRunId=Number(variantRun.body.productionRun?.id);

const wrongVariantBySpec=await api("/v1/internal/production-runs/"+variantRunId+"/lots",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    lotCode:"LOT-WRONG-SPEC-L",
    variantId:variantL,
    plannedQuantity:2
  })
});
ok(
  wrongVariantBySpec.response.status===409&&wrongVariantBySpec.body.error==="variant_specification_mismatch",
  "variant specification restringe lote a variante exacta"
);

const manufacturerVariantRun=await api("/v1/internal/production-runs",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    runCode:"RUN-CI-MFG-M",
    productSpecificationVersionId:productSpecV1Id,
    manufacturerLinkId:variantLinkId
  })
});
ok(manufacturerVariantRun.response.status===201,"product spec acepta ManufacturerLink de variante");
const manufacturerVariantRunId=Number(manufacturerVariantRun.body.productionRun?.id);

const wrongVariantByManufacturer=await api("/v1/internal/production-runs/"+manufacturerVariantRunId+"/lots",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    lotCode:"LOT-WRONG-MFG-L",
    variantId:variantL,
    plannedQuantity:2
  })
});
ok(
  wrongVariantByManufacturer.response.status===409&&wrongVariantByManufacturer.body.error==="variant_manufacturer_link_mismatch",
  "ManufacturerLink de variante restringe lote"
);

const correctVariant=await api("/v1/internal/production-runs/"+manufacturerVariantRunId+"/lots",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    lotCode:"LOT-CORRECT-MFG-M",
    variantId:variantM,
    plannedQuantity:3
  })
});
ok(correctVariant.response.status===201,"ManufacturerLink de variante acepta variante exacta");

const poAfter=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources
  WHERE variant_id IN (${variantM},${variantL})`)[0]?.count||0);
const movementsAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements
  WHERE variant_id IN (${variantM},${variantL})`)[0]?.count||0);
const inventoryAfter=await db`
  SELECT variant_id,quantity,reserved
  FROM inventory
  WHERE variant_id IN (${variantM},${variantL})
  ORDER BY variant_id`;
const qcAfter=Number((await db`SELECT COUNT(*)::int count FROM quality_inspections`)[0]?.count||0);
const productAfter=(await db`
  SELECT name,status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];
const linkAfter=await db`
  SELECT id,active,manufacturer_id,target_type,product_id,variant_id
  FROM manufacturer_links
  WHERE id IN (${productLinkId},${variantLinkId})
  ORDER BY id`;

ok(poAfter===poBefore,"Production Run no cambia PurchaseOrder");
ok(sourcesAfter===sourcesBefore,"Production Run no crea InventorySource");
ok(movementsAfter===movementsBefore,"Production Run no crea inventory_movements");
ok(
  JSON.stringify(inventoryAfter.map((x:any)=>({
    variantId:Number(x.variant_id),quantity:Number(x.quantity),reserved:Number(x.reserved)
  })))===
  JSON.stringify(inventoryBefore.map((x:any)=>({
    variantId:Number(x.variant_id),quantity:Number(x.quantity),reserved:Number(x.reserved)
  }))),
  "produced_quantity no cambia inventory quantity/reserved"
);
ok(qcAfter===qcBefore,"Production Run no crea ni aprueba QualityInspection");
ok(
  productAfter.name===productBefore.name&&
  productAfter.status===productBefore.status&&
  productAfter.commercial_model===productBefore.commercial_model&&
  productAfter.default_condition===productBefore.default_condition,
  "Production Run no modifica Product"
);
ok(
  JSON.stringify(linkAfter.map((x:any)=>({
    id:Number(x.id),active:Boolean(x.active),manufacturerId:Number(x.manufacturer_id),
    targetType:x.target_type,productId:x.product_id==null?null:Number(x.product_id),
    variantId:x.variant_id==null?null:Number(x.variant_id)
  })))===
  JSON.stringify(linkBefore.map((x:any)=>({
    id:Number(x.id),active:Boolean(x.active),manufacturerId:Number(x.manufacturer_id),
    targetType:x.target_type,productId:x.product_id==null?null:Number(x.product_id),
    variantId:x.variant_id==null?null:Number(x.variant_id)
  }))),
  "Production Run no modifica ManufacturerLink"
);

const detail=await api("/v1/internal/production-runs/"+runId,{
  headers:{cookie:reader.cookie}
});
ok(detail.response.status===200,"detalle run responde");
ok(Array.isArray(detail.body.lots)&&detail.body.lots.length===2,"detalle conserva lotes");
ok(detail.body.productionRun?.status==="COMPLETED","detalle conserva lifecycle final");
ok(detail.body.inventoryChanged===false&&detail.body.goodsReceiptCreated===false,"detalle explicita boundary inventario");

const audits=await db`
  SELECT action
  FROM audit_events
  WHERE resource_type='ProductionRun'
    AND resource_id=${String(runId)}
  ORDER BY id`;
ok(audits.some((x:any)=>x.action==="production_run.created"),"creación run queda auditada");
ok(audits.some((x:any)=>x.action==="production_run.released"),"release queda auditado");
ok(audits.some((x:any)=>x.action==="production_run.started"),"start queda auditado");
ok(audits.some((x:any)=>x.action==="production_run.completed"),"completion queda auditado");

const unauth=await api("/v1/internal/production-runs");
ok(unauth.response.status===401,"Production Runs exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Production Run / Lot v1");
await db.close();
