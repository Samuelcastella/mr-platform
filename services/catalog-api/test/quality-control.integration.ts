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
  const password="QC-"+crypto.randomUUID()+"-R9!";
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

async function createProduct(name:string,skuPrefix:string){
  const result=await api("/v1/internal/catalog/products",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-internal-key":serviceKey
    },
    body:JSON.stringify({
      name,
      category:"Vestuario",
      brand:"MR",
      commercialModel:"private_label",
      defaultCondition:"new",
      status:"draft",
      variants:[{
        sku:skuPrefix+"-"+crypto.randomUUID().slice(0,8),
        size:"M",
        color:"Negro",
        price:1500,
        currency:"HNL",
        stock:7
      }]
    })
  });
  return {
    result,
    productId:Number(result.body.product?.id),
    variantId:Number(result.body.variants?.[0]?.id)
  };
}

const baseProduct=await createProduct("Quality Control CI Product","QC-CI");
ok(baseProduct.result.response.status===201,"crea producto base");
const productId=baseProduct.productId;
const variantId=baseProduct.variantId;

const otherProduct=await createProduct("Quality Control Other Product","QC-OTHER");
ok(otherProduct.result.response.status===201,"crea producto secundario");

const manager=await createStaff("MANAGER","Quality Manager CI");
const operator=await createStaff("INVENTORY_OPERATOR","Quality Operator CI");
const analyst=await createStaff("ANALYST","Quality Analyst CI");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(operator.login.response.status===200,"inventory operator inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const createSpec=async(code:string,title:string,targetId:number)=>{
  const spec=await api("/v1/internal/product-specifications",{
    method:"POST",
    headers:headers(manager),
    body:JSON.stringify({
      code,title,targetType:"PRODUCT",targetId
    })
  });
  const specId=Number(spec.body.specification?.id);
  const version=await api("/v1/internal/product-specifications/"+specId+"/versions",{
    method:"POST",
    headers:headers(manager),
    body:JSON.stringify({
      changeSummary:"Approved specification for quality control",
      sections:{
        materials:{shell:"cotton"},
        measurements:{lengthCm:100},
        qualityRequirements:{visual:"no major defects"}
      }
    })
  });
  const versionId=Number(version.body.version?.id);
  const approved=await api("/v1/internal/product-specification-versions/"+versionId+"/approve",{
    method:"POST",
    headers:headers(manager),
    body:JSON.stringify({note:"Approved for QC reference"})
  });
  return {spec,specId,version,versionId,approved};
};

const spec=await createSpec("QC-SPEC-CI-001","QC approved spec",productId);
ok(spec.spec.response.status===201&&spec.approved.response.status===200,"crea y aprueba specification base");

const otherSpec=await createSpec("QC-SPEC-OTHER","QC other spec",otherProduct.productId);
ok(otherSpec.spec.response.status===201&&otherSpec.approved.response.status===200,"crea specification de otro producto");

const draftVersion=await api("/v1/internal/product-specifications/"+spec.specId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    cloneVersionId:spec.versionId,
    changeSummary:"Draft specification not valid for final QC"
  })
});
ok(draftVersion.response.status===201,"crea specification DRAFT para prueba");
const draftVersionId=Number(draftVersion.body.version?.id);

const poBefore=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${variantId}`)[0]?.count||0);
const movementsBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${variantId}`)[0]?.count||0);
const inventoryBefore=(await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${variantId}`)[0];
const productBefore=(await db`
  SELECT name,status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];
const manufacturerLinksBefore=Number((await db`
  SELECT COUNT(*)::int count FROM manufacturer_links
  WHERE product_id=${productId} OR variant_id=${variantId}`)[0]?.count||0);
const specStatusBefore=(await db`
  SELECT status FROM product_specification_versions WHERE id=${spec.versionId}`)[0]?.status;

const operatorList=await api("/v1/internal/quality-inspections",{
  headers:{cookie:operator.cookie}
});
ok(operatorList.response.status===200,"Inventory Operator puede leer calidad");

const analystList=await api("/v1/internal/quality-inspections",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystList.response.status===403&&analystList.body.error==="forbidden",
  "reports.read no concede quality.read"
);

const draftSpecRejected=await api("/v1/internal/quality-inspections",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    inspectionType:"SAMPLE",
    targetType:"PRODUCT",
    targetId:productId,
    specificationVersionId:draftVersionId,
    inspectedQuantity:2
  })
});
ok(
  draftSpecRejected.response.status===409&&draftSpecRejected.body.error==="draft_specification_not_allowed",
  "inspección no acepta specification DRAFT"
);

const mismatch=await api("/v1/internal/quality-inspections",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    inspectionType:"SAMPLE",
    targetType:"PRODUCT",
    targetId:productId,
    specificationVersionId:otherSpec.versionId,
    inspectedQuantity:2
  })
});
ok(
  mismatch.response.status===409&&mismatch.body.error==="specification_target_mismatch",
  "inspección rechaza specification de otro producto"
);

const inspection=await api("/v1/internal/quality-inspections",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    inspectionType:"PRE_PRODUCTION",
    targetType:"PRODUCT",
    targetId:productId,
    specificationVersionId:spec.versionId,
    sampleReference:"SAMPLE-QC-001",
    inspectedQuantity:10,
    aqlReference:"AQL 2.5 / internal plan",
    evidenceReference:"qc://sample-001",
    rationale:"Inspección inicial antes de producción."
  })
});
ok(inspection.response.status===201,"Inventory Operator crea inspección DRAFT");
const inspectionId=Number(inspection.body.inspection?.id);
ok(inspection.body.inspection?.status==="DRAFT","inspección nace DRAFT");
ok(inspection.body.inspection?.result==="PENDING","inspección nace PENDING");
ok(inspection.body.resultCalculatedAutomatically===false,"resultado no se calcula automáticamente");
ok(inspection.body.inspection?.specificationVersion?.id===spec.versionId,"inspección conserva spec inmutable");

const variantInspection=await api("/v1/internal/quality-inspections",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    inspectionType:"IN_PROCESS",
    targetType:"VARIANT",
    targetId:variantId,
    specificationVersionId:spec.versionId,
    inspectedQuantity:3
  })
});
ok(
  variantInspection.response.status===201,
  "variante puede usar specification aprobada del producto padre"
);

const defectMajor=await api("/v1/internal/quality-inspections/"+inspectionId+"/defects",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    severity:"MAJOR",
    defectCode:"STITCH-001",
    description:"Costura lateral irregular",
    quantity:2,
    evidenceReference:"qc://defect-stitch"
  })
});
ok(defectMajor.response.status===201,"registra defecto MAJOR");
const majorId=Number(defectMajor.body.defect?.id);
ok(defectMajor.body.resultCalculatedAutomatically===false,"defecto no calcula resultado");

const defectCritical=await api("/v1/internal/quality-inspections/"+inspectionId+"/defects",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    severity:"CRITICAL",
    defectCode:"METAL-001",
    description:"Elemento metálico expuesto",
    quantity:1
  })
});
ok(defectCritical.response.status===201,"registra defecto CRITICAL");
const criticalId=Number(defectCritical.body.defect?.id);

const updatedDefect=await api("/v1/internal/quality-defects/"+majorId,{
  method:"PATCH",
  headers:headers(operator),
  body:JSON.stringify({
    severity:"MINOR",
    defectCode:"STITCH-001",
    description:"Costura lateral irregular corregible",
    quantity:1,
    active:true,
    changeNote:"Se reclasifica tras segunda revisión."
  })
});
ok(updatedDefect.response.status===200,"Inventory Operator edita defecto en DRAFT");
ok(updatedDefect.body.defect?.severity==="MINOR","actualiza severidad explícitamente");

const deactivateCritical=await api("/v1/internal/quality-defects/"+criticalId,{
  method:"PATCH",
  headers:headers(operator),
  body:JSON.stringify({
    active:false,
    changeNote:"Hallazgo descartado tras validar que era protector removible."
  })
});
ok(deactivateCritical.response.status===200,"puede desactivar defecto antes de finalizar");
ok(deactivateCritical.body.defect?.active===false,"defecto queda inactivo");

const updatedInspection=await api("/v1/internal/quality-inspections/"+inspectionId,{
  method:"PATCH",
  headers:headers(operator),
  body:JSON.stringify({
    inspectedQuantity:12,
    rationale:"Segunda pasada de inspección completada.",
    changeNote:"Se amplía muestra inspeccionada."
  })
});
ok(updatedInspection.response.status===200,"actualiza inspección DRAFT");
ok(updatedInspection.body.inspection?.inspectedQuantity===12,"actualiza cantidad inspeccionada");
ok(updatedInspection.body.inspection?.result==="PENDING","defectos no alteran PENDING automáticamente");

const operatorFinalize=await api("/v1/internal/quality-inspections/"+inspectionId+"/finalize",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    result:"FAIL",
    rationale:"Operator should not have finalize permission."
  })
});
ok(
  operatorFinalize.response.status===403&&operatorFinalize.body.error==="forbidden",
  "Inventory Operator no puede finalizar"
);

const serviceFinalize=await api("/v1/internal/quality-inspections/"+inspectionId+"/finalize",{
  method:"POST",
  headers:{
    "content-type":"application/json",
    "x-internal-key":serviceKey
  },
  body:JSON.stringify({
    result:"FAIL",
    rationale:"Service should not finalize quality decision."
  })
});
ok(
  serviceFinalize.response.status===403&&serviceFinalize.body.error==="human_finalization_required",
  "finalización exige StaffUser humano"
);

const missingRationale=await api("/v1/internal/quality-inspections/"+inspectionId+"/finalize",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({result:"CONDITIONAL",rationale:"short"})
});
ok(
  missingRationale.response.status===400&&missingRationale.body.error==="rationale_required",
  "finalización exige razonamiento suficiente"
);

const finalized=await api("/v1/internal/quality-inspections/"+inspectionId+"/finalize",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    result:"CONDITIONAL",
    rationale:"Se acepta como muestra condicional; corregir costura antes de producción.",
    note:"Decisión humana de QC."
  })
});
ok(finalized.response.status===200,"Manager finaliza inspección");
ok(finalized.body.inspection?.status==="FINAL","inspección queda FINAL");
ok(finalized.body.inspection?.result==="CONDITIONAL","resultado humano queda CONDITIONAL");
ok(finalized.body.inspection?.finalizedBy?.userId===manager.userId,"conserva finalizador humano");
ok(finalized.body.resultCalculatedAutomatically===false,"finalización declara cero cálculo automático");

const finalHistory=Array.isArray(finalized.body.history)
  ? finalized.body.history.find((h:any)=>h.action==="FINALIZED")
  : null;
ok(Boolean(finalHistory),"historial conserva snapshot FINALIZED");
ok(
  Array.isArray(finalHistory?.snapshot?.defects)&&finalHistory.snapshot.defects.length===2,
  "snapshot final conserva defectos activos e inactivos"
);

const immutableInspection=await api("/v1/internal/quality-inspections/"+inspectionId,{
  method:"PATCH",
  headers:headers(operator),
  body:JSON.stringify({
    inspectedQuantity:20,
    changeNote:"No debe editar FINAL"
  })
});
ok(
  immutableInspection.response.status===409&&immutableInspection.body.error==="final_inspection_immutable",
  "inspección FINAL es inmutable"
);

const immutableDefect=await api("/v1/internal/quality-defects/"+majorId,{
  method:"PATCH",
  headers:headers(operator),
  body:JSON.stringify({
    quantity:9,
    changeNote:"No debe editar defecto final"
  })
});
ok(
  immutableDefect.response.status===409&&immutableDefect.body.error==="final_inspection_immutable",
  "defectos de inspección FINAL son inmutables"
);

const poAfter=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${variantId}`)[0]?.count||0);
const movementsAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${variantId}`)[0]?.count||0);
const inventoryAfter=(await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${variantId}`)[0];
const productAfter=(await db`
  SELECT name,status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];
const manufacturerLinksAfter=Number((await db`
  SELECT COUNT(*)::int count FROM manufacturer_links
  WHERE product_id=${productId} OR variant_id=${variantId}`)[0]?.count||0);
const specStatusAfter=(await db`
  SELECT status FROM product_specification_versions WHERE id=${spec.versionId}`)[0]?.status;

ok(poAfter===poBefore,"Quality Control no cambia PurchaseOrder");
ok(sourcesAfter===sourcesBefore,"Quality Control no crea InventorySource");
ok(movementsAfter===movementsBefore,"Quality Control no crea movimientos de inventario");
ok(
  Number(inventoryAfter.quantity)===Number(inventoryBefore.quantity)&&
  Number(inventoryAfter.reserved)===Number(inventoryBefore.reserved),
  "Quality Control no cambia quantity/reserved"
);
ok(manufacturerLinksAfter===manufacturerLinksBefore,"Quality Control no cambia ManufacturerLink");
ok(
  productAfter.name===productBefore.name&&
  productAfter.status===productBefore.status&&
  productAfter.commercial_model===productBefore.commercial_model&&
  productAfter.default_condition===productBefore.default_condition,
  "Quality Control no modifica catálogo"
);
ok(specStatusAfter===specStatusBefore,"Quality Control no modifica ProductSpecificationVersion");

const audits=await db`
  SELECT action
  FROM audit_events
  WHERE resource_type='QualityInspection'
    AND resource_id=${String(inspectionId)}
  ORDER BY id`;
ok(audits.some((x:any)=>x.action==="quality_inspection.created"),"creación inspección queda auditada");
ok(audits.some((x:any)=>x.action==="quality_inspection.updated"),"edición inspección queda auditada");
ok(audits.some((x:any)=>x.action==="quality_inspection.finalized"),"finalización queda auditada");

const unauth=await api("/v1/internal/quality-inspections");
ok(unauth.response.status===401,"Quality Control exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Quality Control v1");
await db.close();
