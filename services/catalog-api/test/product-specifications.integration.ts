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
  const password="SPEC-"+crypto.randomUUID()+"-R9!";
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
    name:"Product Specification CI",
    category:"Vestuario",
    brand:"MR",
    commercialModel:"private_label",
    defaultCondition:"new",
    status:"draft",
    variants:[{
      sku:"SPEC-CI-"+crypto.randomUUID().slice(0,8),
      size:"M",
      color:"Negro",
      price:1400,
      currency:"HNL",
      stock:6
    }]
  })
});
ok(product.response.status===201,"crea producto base para specification");
const productId=Number(product.body.product?.id);
const variantId=Number(product.body.variants?.[0]?.id);

const manager=await createStaff("MANAGER","Product Specification Manager");
const reader=await createStaff("INVENTORY_OPERATOR","Product Specification Reader");
const analyst=await createStaff("ANALYST","Product Specification Analyst");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(reader.login.response.status===200,"inventory operator inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const poBefore=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${variantId}`)[0]?.count||0);
const movementsBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${variantId}`)[0]?.count||0);
const inventoryBefore=(await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${variantId}`)[0];
const manufacturerLinksBefore=Number((await db`
  SELECT COUNT(*)::int count
  FROM manufacturer_links
  WHERE product_id=${productId} OR variant_id=${variantId}`)[0]?.count||0);
const productBefore=(await db`
  SELECT name,status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];

const readerList=await api("/v1/internal/product-specifications",{
  headers:{cookie:reader.cookie}
});
ok(readerList.response.status===200,"Inventory Operator puede leer specifications");

const analystList=await api("/v1/internal/product-specifications",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystList.response.status===403&&analystList.body.error==="forbidden",
  "reports.read no concede product_specs.read"
);

const readerCreate=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:headers(reader),
  body:JSON.stringify({
    code:"SPEC-UNAUTHORIZED",
    title:"No autorizado",
    targetType:"PRODUCT",
    targetId:productId
  })
});
ok(
  readerCreate.response.status===403&&readerCreate.body.error==="forbidden",
  "product_specs.read no concede manage"
);

const created=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    code:"TECH-DRESS-CI-001",
    title:"Ficha técnica vestido CI",
    targetType:"PRODUCT",
    targetId:productId
  })
});
ok(created.response.status===201,"manager crea specification");
const specificationId=Number(created.body.specification?.id);
ok(created.body.specification?.targetType==="PRODUCT","spec conserva target PRODUCT");
ok(created.body.catalogChanged===false,"crear spec no cambia catálogo");
ok(created.body.productionRunCreated===false,"crear spec no crea ProductionRun");

const duplicateTarget=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    code:"TECH-DRESS-CI-002",
    title:"Segunda ficha activa",
    targetType:"PRODUCT",
    targetId:productId
  })
});
ok(
  duplicateTarget.response.status===409&&duplicateTarget.body.error==="specification_exists",
  "solo una specification activa por target exacto"
);

const variantSpec=await api("/v1/internal/product-specifications",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    code:"TECH-DRESS-CI-M",
    title:"Ficha técnica variante M",
    targetType:"VARIANT",
    targetId:variantId
  })
});
ok(variantSpec.response.status===201,"producto y variante pueden tener series separadas");

const v1=await api("/v1/internal/product-specifications/"+specificationId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    changeSummary:"Versión inicial de construcción y materiales",
    sections:{
      materials:{shell:"95% cotton / 5% elastane",lining:"100% polyester"},
      measurements:{chestCm:92,waistCm:76,lengthCm:110},
      construction:{seamAllowanceMm:10,stitch:"lockstitch"},
      packaging:{bag:"recyclable polybag",unitsPerCarton:20},
      labeling:{countryOfOrigin:true,sizeLabel:"M"},
      qualityRequirements:{aql:"2.5",colorfastness:"4+"}
    },
    notes:"Tech pack CI initial."
  })
});
ok(v1.response.status===201,"crea versión 1 DRAFT");
const v1Id=Number(v1.body.version?.id);
ok(v1.body.version?.versionNo===1,"primera versión es v1");
ok(v1.body.version?.status==="DRAFT","nueva versión nace DRAFT");
ok(v1.body.version?.technicalContentMutable===true,"DRAFT es editable");

const v1Update=await api("/v1/internal/product-specification-versions/"+v1Id,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    sections:{
      measurements:{chestCm:94,waistCm:78,lengthCm:110}
    },
    changeSummary:"Versión inicial ajustada tras medición de muestra",
    changeNote:"Ajuste de pecho y cintura."
  })
});
ok(v1Update.response.status===200,"edita versión DRAFT");
ok(v1Update.body.version?.sections?.measurements?.chestCm===94,"actualiza sección medida");
ok(v1Update.body.version?.sections?.materials?.shell==="95% cotton / 5% elastane","patch conserva otras secciones");
ok(Array.isArray(v1Update.body.history)&&v1Update.body.history.length===2,"historial v1 conserva CREATED + UPDATED");

const serviceApprove=await api("/v1/internal/product-specification-versions/"+v1Id+"/approve",{
  method:"POST",
  headers:{
    "content-type":"application/json",
    "x-internal-key":serviceKey
  },
  body:JSON.stringify({note:"Service should not approve"})
});
ok(
  serviceApprove.response.status===403&&serviceApprove.body.error==="human_approval_required",
  "aprobación exige StaffUser humano"
);

const approvedV1=await api("/v1/internal/product-specification-versions/"+v1Id+"/approve",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Aprobada para referencia técnica."})
});
ok(approvedV1.response.status===200,"manager aprueba v1");
ok(approvedV1.body.version?.status==="APPROVED","v1 queda APPROVED");
ok(approvedV1.body.version?.technicalContentMutable===false,"APPROVED es inmutable");
ok(approvedV1.body.version?.approvedBy?.userId===manager.userId,"aprobación conserva actor humano");

const immutable=await api("/v1/internal/product-specification-versions/"+v1Id,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    sections:{materials:{shell:"changed"}},
    changeSummary:"Cambio no permitido"
  })
});
ok(
  immutable.response.status===409&&immutable.body.error==="approved_version_immutable",
  "versión aprobada no admite edición técnica in-place"
);

const v2=await api("/v1/internal/product-specifications/"+specificationId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    cloneVersionId:v1Id,
    changeSummary:"Revisión de empaque para producción",
    sections:{
      packaging:{bag:"paper sleeve",unitsPerCarton:16}
    },
    notes:"Clon de v1 con empaque revisado."
  })
});
ok(v2.response.status===201,"crea v2 clonando v1");
const v2Id=Number(v2.body.version?.id);
ok(v2.body.version?.versionNo===2,"numeración avanza a v2");
ok(v2.body.version?.sections?.materials?.shell==="95% cotton / 5% elastane","clone conserva materiales v1");
ok(v2.body.version?.sections?.measurements?.chestCm===94,"clone conserva mediciones ajustadas");
ok(v2.body.version?.sections?.packaging?.bag==="paper sleeve","override reemplaza empaque");

const approvedV2=await api("/v1/internal/product-specification-versions/"+v2Id+"/approve",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"v2 reemplaza la especificación anterior."})
});
ok(approvedV2.response.status===200,"aprueba v2");
ok(approvedV2.body.version?.status==="APPROVED","v2 queda APPROVED");
ok(
  Array.isArray(approvedV2.body.supersededVersionIds)&&
  approvedV2.body.supersededVersionIds.includes(v1Id),
  "aprobar v2 supersede v1 explícitamente"
);

const v1After=await api("/v1/internal/product-specification-versions/"+v1Id,{
  headers:{cookie:reader.cookie}
});
ok(v1After.response.status===200,"v1 superseded sigue legible");
ok(v1After.body.version?.status==="SUPERSEDED","v1 queda SUPERSEDED");
ok(v1After.body.version?.sections?.measurements?.chestCm===94,"contenido técnico v1 permanece intacto");

const approvedCount=Number((await db`
  SELECT COUNT(*)::int count
  FROM product_specification_versions
  WHERE specification_id=${specificationId}
    AND status='APPROVED'`)[0]?.count||0);
ok(approvedCount===1,"solo existe una versión APPROVED actual");

const withdrawOld=await api("/v1/internal/product-specification-versions/"+v1Id+"/withdraw",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"No debe retirarse una superseded."})
});
ok(
  withdrawOld.response.status===409&&withdrawOld.body.error==="version_not_withdrawable",
  "SUPERSEDED no se trata como APPROVED actual"
);

const withdrawMissingNote=await api("/v1/internal/product-specification-versions/"+v2Id+"/withdraw",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({})
});
ok(
  withdrawMissingNote.response.status===400&&withdrawMissingNote.body.error==="withdrawal_note_required",
  "retirar versión exige motivo"
);

const withdrawn=await api("/v1/internal/product-specification-versions/"+v2Id+"/withdraw",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({note:"Retirada por cambio de material pendiente."})
});
ok(withdrawn.response.status===200,"retira versión aprobada");
ok(withdrawn.body.version?.status==="WITHDRAWN","v2 queda WITHDRAWN");

const detail=await api("/v1/internal/product-specifications/"+specificationId,{
  headers:{cookie:reader.cookie}
});
ok(detail.response.status===200,"detalle specification responde");
ok(Array.isArray(detail.body.versions)&&detail.body.versions.length===2,"detalle expone historial de versiones");
ok(detail.body.automaticallyAppliedToProduction===false,"detalle explicita cero aplicación automática");

const deactivate=await api("/v1/internal/product-specifications/"+specificationId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    active:false,
    changeNote:"Serie pausada temporalmente."
  })
});
ok(deactivate.response.status===200,"desactiva specification");
ok(deactivate.body.specification?.active===false,"serie queda inactiva");

const versionOnInactive=await api("/v1/internal/product-specifications/"+specificationId+"/versions",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    changeSummary:"No debe crearse mientras esté inactiva"
  })
});
ok(
  versionOnInactive.response.status===409&&versionOnInactive.body.error==="specification_inactive",
  "serie inactiva bloquea nuevas versiones"
);

const poAfter=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${variantId}`)[0]?.count||0);
const movementsAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${variantId}`)[0]?.count||0);
const inventoryAfter=(await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${variantId}`)[0];
const manufacturerLinksAfter=Number((await db`
  SELECT COUNT(*)::int count
  FROM manufacturer_links
  WHERE product_id=${productId} OR variant_id=${variantId}`)[0]?.count||0);
const productAfter=(await db`
  SELECT name,status,commercial_model,default_condition
  FROM products WHERE id=${productId}`)[0];

ok(poAfter===poBefore,"Product Specification no crea PurchaseOrder");
ok(sourcesAfter===sourcesBefore,"Product Specification no crea InventorySource");
ok(movementsAfter===movementsBefore,"Product Specification no crea movimientos de inventario");
ok(
  Number(inventoryAfter.quantity)===Number(inventoryBefore.quantity)&&
  Number(inventoryAfter.reserved)===Number(inventoryBefore.reserved),
  "Product Specification no cambia quantity/reserved"
);
ok(manufacturerLinksAfter===manufacturerLinksBefore,"Product Specification no cambia ManufacturerLink");
ok(
  productAfter.name===productBefore.name&&
  productAfter.status===productBefore.status&&
  productAfter.commercial_model===productBefore.commercial_model&&
  productAfter.default_condition===productBefore.default_condition,
  "Product Specification no modifica catálogo base"
);

const versionAudits=await db`
  SELECT action
  FROM audit_events
  WHERE resource_type='ProductSpecificationVersion'
    AND resource_id IN (${String(v1Id)},${String(v2Id)})
  ORDER BY id`;
ok(versionAudits.some((x:any)=>x.action==="product_specification_version.created"),"creación de versión queda auditada");
ok(versionAudits.some((x:any)=>x.action==="product_specification_version.updated"),"edición draft queda auditada");
ok(versionAudits.filter((x:any)=>x.action==="product_specification_version.approved").length===2,"aprobaciones quedan auditadas");
ok(versionAudits.some((x:any)=>x.action==="product_specification_version.withdrawn"),"retiro queda auditado");

const unauth=await api("/v1/internal/product-specifications");
ok(unauth.response.status===401,"product specifications exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Product Specification v1");
await db.close();
