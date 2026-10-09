import { SQL } from "bun";

if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true") {
  throw new Error("Refusing destructive integration test without ALLOW_DESTRUCTIVE_TEST_DB=true");
}

const db = new SQL({
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
  const password="EVAL-"+crypto.randomUUID()+"-R9!";
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

const productRows=await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Evaluation CI Product',
    ${"eval-ci-"+crypto.randomUUID()},
    'Vestuario',
    'MR Test',
    'active'
  )
  RETURNING id`;
const productId=Number(productRows[0].id);

const variantRows=await db`
  INSERT INTO product_variants(
    product_id,sku,size,color,cost,price,currency,supplier_id,active
  )
  VALUES(
    ${productId},${"EVAL-"+crypto.randomUUID().slice(0,10)},
    'M','Negro',NULL,850.00,'HNL',NULL,TRUE
  )
  RETURNING id`;
const variantId=Number(variantRows[0].id);

const locationRows=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Eval CI "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId=Number(locationRows[0].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES(${variantId},${locationId},9,2)`;

const manager=await createStaff("MANAGER","Supplier Evaluation Manager");
const operator=await createStaff("INVENTORY_OPERATOR","Supplier Evaluation Reader");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(operator.login.response.status===200,"inventory operator inicia sesión");

const supplier=await api("/v1/internal/suppliers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    name:"Evaluation Supplier "+crypto.randomUUID().slice(0,5),
    countryCode:"HN",
    defaultCurrency:"HNL"
  })
});
ok(supplier.response.status===201,"crea proveedor de evaluación");
const supplierId=Number(supplier.body.supplier?.id);

const otherSupplier=await api("/v1/internal/suppliers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    name:"Evaluation Other "+crypto.randomUUID().slice(0,5),
    countryCode:"HN",
    defaultCurrency:"HNL"
  })
});
ok(otherSupplier.response.status===201,"crea segundo proveedor");
const otherSupplierId=Number(otherSupplier.body.supplier?.id);

const offer=await api("/v1/internal/sourcing/offers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    supplierId,
    variantId,
    quotedCostMinor:40000,
    currency:"HNL",
    moq:12,
    leadTimeDays:5,
    preferred:false,
    note:"Oferta para evaluación CI"
  })
});
ok(offer.response.status===201,"crea oferta para evaluar");
const offerId=Number(offer.body.offer?.id);

const beforePO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const beforeSources=Number((await db`SELECT COUNT(*)::int count FROM inventory_sources`)[0]?.count||0);
const beforeInventory=(await db`
  SELECT quantity,reserved
  FROM inventory
  WHERE variant_id=${variantId} AND location_id=${locationId}`)[0];
const beforeMovements=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id=${variantId}`)[0]?.count||0);
const beforeOffer=(await db`
  SELECT preferred,active
  FROM supplier_variants
  WHERE id=${offerId}`)[0];
const beforeSupplier=(await db`
  SELECT active
  FROM suppliers
  WHERE id=${supplierId}`)[0];

const readerList=await api("/v1/internal/sourcing/evaluations",{
  headers:{cookie:operator.cookie}
});
ok(readerList.response.status===200,"suppliers.read permite leer evaluaciones");

const readerWrite=await api("/v1/internal/sourcing/evaluations",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    type:"SUPPLIER",
    supplierId,
    decision:"CONTINUE",
    rationale:"Reader should not mutate this module."
  })
});
ok(
  readerWrite.response.status===403&&readerWrite.body.error==="forbidden",
  "suppliers.read no concede suppliers.write"
);

const missingSampleTarget=await api("/v1/internal/sourcing/evaluations",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    type:"SAMPLE",
    supplierId,
    decision:"CONTINUE",
    rationale:"Muestra sin referencia ni oferta debe rechazarse."
  })
});
ok(
  missingSampleTarget.response.status===400 &&
  missingSampleTarget.body.error==="sample_reference_or_offer_required",
  "muestra exige oferta o referencia"
);

const mismatch=await api("/v1/internal/sourcing/evaluations",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    type:"SAMPLE",
    supplierId:otherSupplierId,
    supplierVariantId:offerId,
    decision:"CONTINUE",
    rationale:"La oferta pertenece a otro proveedor y debe rechazarse."
  })
});
ok(
  mismatch.response.status===409 &&
  mismatch.body.error==="sourcing_offer_supplier_mismatch",
  "oferta debe pertenecer al proveedor evaluado"
);

const invalidCriterion=await api("/v1/internal/sourcing/evaluations",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    type:"SUPPLIER",
    supplierId,
    decision:"CONTINUE",
    criteria:{quality:"EXCELLENT"},
    rationale:"Criterio fuera del vocabulario se rechaza."
  })
});
ok(
  invalidCriterion.response.status===400 &&
  invalidCriterion.body.error==="invalid_criterion",
  "criterios usan vocabulario explícito"
);

const sample=await api("/v1/internal/sourcing/evaluations",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    type:"SAMPLE",
    supplierId,
    supplierVariantId:offerId,
    sampleReference:"SAMPLE-CI-001",
    decision:"REQUEST_REVISION",
    criteria:{
      quality:"CONCERN",
      consistency:"NOT_REVIEWED",
      communication:"ACCEPTABLE",
      leadTimeConfidence:"ACCEPTABLE",
      packaging:"CONCERN"
    },
    rationale:"La muestra es funcional, pero costuras y empaque requieren corrección.",
    evidenceReference:"CI sample photos"
  })
});
ok(sample.response.status===201,"registra evaluación de muestra");
const evaluationId=Number(sample.body.evaluation?.id);
ok(sample.body.evaluation?.type==="SAMPLE","conserva tipo SAMPLE");
ok(sample.body.evaluation?.decision==="REQUEST_REVISION","conserva decisión humana");
ok(sample.body.evaluation?.compositeScore==null,"no calcula score compuesto");
ok(sample.body.evaluation?.automaticSupplierSelection===false,"no selecciona proveedor automáticamente");
ok(sample.body.createsPurchaseOrder===false,"crear evaluación no crea PO");
ok(sample.body.inventoryChanged===false,"crear evaluación no cambia inventario");
ok(sample.body.supplierPreferenceChanged===false,"crear evaluación no cambia preferencia");

const supplierReview=await api("/v1/internal/sourcing/evaluations",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    type:"SUPPLIER",
    supplierId,
    decision:"CONTINUE",
    criteria:{
      communication:"ACCEPTABLE",
      leadTimeConfidence:"CONCERN"
    },
    rationale:"Proveedor responde bien, pero el lead time todavía requiere validación."
  })
});
ok(supplierReview.response.status===201,"registra evaluación general de proveedor");

const listSample=await api("/v1/internal/sourcing/evaluations?type=SAMPLE&supplierId="+supplierId,{
  headers:{cookie:operator.cookie}
});
ok(listSample.response.status===200,"filtro type + supplier responde");
ok(
  Array.isArray(listSample.body.data) &&
  listSample.body.data.some((x:any)=>Number(x.id)===evaluationId) &&
  listSample.body.data.every((x:any)=>x.type==="SAMPLE"),
  "lista filtrada conserva evaluación SAMPLE"
);

const update=await api("/v1/internal/sourcing/evaluations/"+evaluationId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    status:"FINAL",
    decision:"SHORTLIST",
    criteria:{
      quality:"ACCEPTABLE",
      consistency:"ACCEPTABLE",
      communication:"ACCEPTABLE",
      leadTimeConfidence:"ACCEPTABLE",
      packaging:"ACCEPTABLE"
    },
    sampleReference:"SAMPLE-CI-001",
    rationale:"La segunda revisión cumple criterios operativos para preselección humana.",
    evidenceReference:"CI sample second review",
    note:"Se corrigieron costuras y empaque."
  })
});
ok(update.response.status===200,"actualiza y finaliza evaluación");
ok(update.body.evaluation?.status==="FINAL","lifecycle pasa a FINAL");
ok(update.body.evaluation?.decision==="SHORTLIST","decisión cambia a SHORTLIST");
ok(update.body.evaluation?.criteria?.quality==="ACCEPTABLE","criterios quedan explícitos");
ok(update.body.evaluation?.compositeScore==null,"FINAL sigue sin score compuesto");
ok(Array.isArray(update.body.history)&&update.body.history.length===2,"historial conserva CREATED + UPDATED");

const detail=await api("/v1/internal/sourcing/evaluations/"+evaluationId,{
  headers:{cookie:operator.cookie}
});
ok(detail.response.status===200,"detalle e historial son legibles");
ok(detail.body.history?.[0]?.action==="CREATED","historial inicia con CREATED");
ok(detail.body.history?.[1]?.action==="UPDATED","historial agrega UPDATED");
ok(detail.body.automaticSupplierSelection===false,"detalle explicita no selección automática");

const archive=await api("/v1/internal/sourcing/evaluations/"+evaluationId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    status:"ARCHIVED",
    note:"Evaluación archivada tras revisión."
  })
});
ok(
  archive.response.status===200&&archive.body.evaluation?.status==="ARCHIVED",
  "evaluación puede archivarse"
);

const reopen=await api("/v1/internal/sourcing/evaluations/"+evaluationId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    status:"OPEN",
    note:"Intento inválido"
  })
});
ok(
  reopen.response.status===409&&reopen.body.error==="evaluation_archived",
  "ARCHIVED es terminal"
);

const afterPO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const afterSources=Number((await db`SELECT COUNT(*)::int count FROM inventory_sources`)[0]?.count||0);
const afterInventory=(await db`
  SELECT quantity,reserved
  FROM inventory
  WHERE variant_id=${variantId} AND location_id=${locationId}`)[0];
const afterMovements=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id=${variantId}`)[0]?.count||0);
const afterOffer=(await db`
  SELECT preferred,active
  FROM supplier_variants
  WHERE id=${offerId}`)[0];
const afterSupplier=(await db`
  SELECT active
  FROM suppliers
  WHERE id=${supplierId}`)[0];

ok(afterPO===beforePO,"evaluaciones no crean PurchaseOrder");
ok(afterSources===beforeSources,"evaluaciones no crean InventorySource");
ok(
  Number(afterInventory.quantity)===Number(beforeInventory.quantity) &&
  Number(afterInventory.reserved)===Number(beforeInventory.reserved),
  "evaluaciones no cambian inventory quantity/reserved"
);
ok(afterMovements===beforeMovements,"evaluaciones no crean movimientos de inventario");
ok(
  Boolean(afterOffer.preferred)===Boolean(beforeOffer.preferred) &&
  Boolean(afterOffer.active)===Boolean(beforeOffer.active),
  "evaluaciones no cambian preferencia/actividad de SupplierVariant"
);
ok(
  Boolean(afterSupplier.active)===Boolean(beforeSupplier.active),
  "evaluaciones no activan/desactivan Supplier"
);

const audits=await db`
  SELECT action
  FROM audit_events
  WHERE resource_type='SupplierEvaluation'
    AND resource_id=${String(evaluationId)}
  ORDER BY id`;
ok(audits.some((x:any)=>x.action==="supplier_evaluation.created"),"creación queda auditada");
ok(audits.filter((x:any)=>x.action==="supplier_evaluation.updated").length>=2,"cambios quedan auditados");

const unauth=await api("/v1/internal/sourcing/evaluations");
ok(unauth.response.status===401,"evaluaciones internas exigen autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — Supplier & Sample Evaluation v1");
await db.close();
