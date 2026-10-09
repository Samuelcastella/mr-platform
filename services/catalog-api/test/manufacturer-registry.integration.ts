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
  const password="MFG-"+crypto.randomUUID()+"-R9!";
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
    name:"Manufacturer Registry CI Product",
    category:"Vestuario",
    brand:"MR",
    commercialModel:"private_label",
    defaultCondition:"new",
    status:"draft",
    variants:[{
      sku:"MFG-CI-"+crypto.randomUUID().slice(0,8),
      size:"M",
      color:"Negro",
      price:1200,
      currency:"HNL",
      stock:5
    }]
  })
});
ok(product.response.status===201,"crea producto clasificado para manufacturer registry");
const productId=Number(product.body.product?.id);
const variantId=Number(product.body.variants?.[0]?.id);
ok(productId>0&&variantId>0,"producto y variante reciben id");

const manager=await createStaff("MANAGER","Manufacturer Manager CI");
const inventoryReader=await createStaff("INVENTORY_OPERATOR","Manufacturer Reader CI");
const analyst=await createStaff("ANALYST","Manufacturer Analyst CI");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(inventoryReader.login.response.status===200,"inventory operator inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const suppliersBefore=Number((await db`SELECT COUNT(*)::int count FROM suppliers`)[0]?.count||0);
const supplierVariantsBefore=Number((await db`SELECT COUNT(*)::int count FROM supplier_variants`)[0]?.count||0);
const poBefore=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${variantId}`)[0]?.count||0);
const inventoryBefore=(await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${variantId}`)[0];
const movementsBefore=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${variantId}`)[0]?.count||0);
const classificationBefore=(await db`
  SELECT commercial_model,default_condition FROM products WHERE id=${productId}`)[0];

const readBefore=await api("/v1/internal/manufacturers",{
  headers:{cookie:inventoryReader.cookie}
});
ok(readBefore.response.status===200,"Inventory Operator puede leer fabricantes");

const analystRead=await api("/v1/internal/manufacturers",{
  headers:{cookie:analyst.cookie}
});
ok(
  analystRead.response.status===403&&analystRead.body.error==="forbidden",
  "reports.read no concede manufacturers.read"
);

const readerCreate=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:headers(inventoryReader),
  body:JSON.stringify({name:"No autorizado"})
});
ok(
  readerCreate.response.status===403&&readerCreate.body.error==="forbidden",
  "manufacturers.read no concede manage"
);

const manufacturerOne=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    name:"Taller Manufacturer CI Uno",
    legalName:"Manufacturas CI Uno S.A.",
    countryCode:"HN",
    city:"San Pedro Sula",
    contactName:"Contacto Uno",
    email:"factory1@example.test",
    phone:"+50422000001",
    website:"https://example.test/factory1",
    notes:"Fabricante candidato para prueba de integración."
  })
});
ok(manufacturerOne.response.status===201,"manager crea fabricante uno");
const manufacturerOneId=Number(manufacturerOne.body.manufacturer?.id);
ok(manufacturerOne.body.supplierCreated===false,"crear Manufacturer no crea Supplier");
ok(manufacturerOne.body.productionRunCreated===false,"crear Manufacturer no crea ProductionRun");

const manufacturerTwo=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    name:"Taller Manufacturer CI Dos",
    countryCode:"HN",
    city:"Tegucigalpa"
  })
});
ok(manufacturerTwo.response.status===201,"manager crea fabricante dos");
const manufacturerTwoId=Number(manufacturerTwo.body.manufacturer?.id);

const invalidWebsite=await api("/v1/internal/manufacturers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    name:"Bad Website Manufacturer",
    website:"javascript:alert(1)"
  })
});
ok(
  invalidWebsite.response.status===400&&invalidWebsite.body.error==="invalid_website",
  "registro valida website"
);

const productLinkOne=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId:manufacturerOneId,
    targetType:"PRODUCT",
    targetId:productId,
    manufacturerReference:"MFG-PRODUCT-001",
    notes:"Relación a nivel producto."
  })
});
ok(productLinkOne.response.status===201,"vincula fabricante uno al producto");
const productLinkOneId=Number(productLinkOne.body.link?.id);
ok(productLinkOne.body.link?.targetType==="PRODUCT","link conserva target PRODUCT");
ok(productLinkOne.body.link?.productId===productId,"link PRODUCT resuelve productId");
ok(productLinkOne.body.productionRunCreated===false,"link no crea ProductionRun");
ok(productLinkOne.body.inventoryChanged===false,"link no cambia inventario");

const productLinkTwo=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId:manufacturerTwoId,
    targetType:"PRODUCT",
    targetId:productId,
    manufacturerReference:"MFG2-PRODUCT-001"
  })
});
ok(productLinkTwo.response.status===201,"segundo fabricante puede vincularse al mismo producto");

const variantLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId:manufacturerOneId,
    targetType:"VARIANT",
    targetId:variantId,
    manufacturerReference:"MFG-VARIANT-M-BLK"
  })
});
ok(variantLink.response.status===201,"mismo fabricante puede vincular variante por separado");
const variantLinkId=Number(variantLink.body.link?.id);
ok(variantLink.body.link?.targetType==="VARIANT","link conserva target VARIANT");
ok(variantLink.body.link?.variantId===variantId,"link VARIANT conserva variantId");
ok(variantLink.body.link?.productId===productId,"link VARIANT resuelve contexto de producto");

const duplicate=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId:manufacturerOneId,
    targetType:"PRODUCT",
    targetId:productId
  })
});
ok(
  duplicate.response.status===409&&duplicate.body.error==="manufacturer_link_exists",
  "rechaza vínculo exacto duplicado"
);

const byProduct=await api("/v1/internal/manufacturer-links?productId="+productId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(byProduct.response.status===200,"lista links por producto");
ok(
  Array.isArray(byProduct.body.data)&&byProduct.body.data.length===3,
  "producto expone múltiples fabricantes y vínculo de variante"
);

const updateLink=await api("/v1/internal/manufacturer-links/"+variantLinkId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerReference:"MFG-VARIANT-M-BLK-V2",
    notes:"Referencia corregida.",
    active:false,
    changeNote:"Se pausa vínculo de variante."
  })
});
ok(updateLink.response.status===200,"actualiza vínculo");
ok(updateLink.body.link?.active===false,"vínculo queda inactivo");
ok(updateLink.body.link?.manufacturerReference==="MFG-VARIANT-M-BLK-V2","actualiza referencia");
ok(Array.isArray(updateLink.body.history)&&updateLink.body.history.length===2,"historial link conserva CREATED + UPDATED");

const updateManufacturer=await api("/v1/internal/manufacturers/"+manufacturerOneId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    city:"Choloma",
    active:false,
    changeNote:"Fabricante pausado durante revisión."
  })
});
ok(updateManufacturer.response.status===200,"actualiza fabricante");
ok(updateManufacturer.body.manufacturer?.active===false,"fabricante queda inactivo");
ok(updateManufacturer.body.manufacturer?.city==="Choloma","actualiza ciudad");
ok(Array.isArray(updateManufacturer.body.history)&&updateManufacturer.body.history.length===2,"historial manufacturer conserva CREATED + UPDATED");

const inactiveCreateLink=await api("/v1/internal/manufacturer-links",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    manufacturerId:manufacturerOneId,
    targetType:"VARIANT",
    targetId:variantId
  })
});
ok(
  inactiveCreateLink.response.status===409&&inactiveCreateLink.body.error==="manufacturer_inactive",
  "fabricante inactivo no acepta nuevos links"
);

const inactiveReactivate=await api("/v1/internal/manufacturer-links/"+variantLinkId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    active:true,
    changeNote:"Intento de reactivación mientras fabricante está inactivo."
  })
});
ok(
  inactiveReactivate.response.status===409&&inactiveReactivate.body.error==="manufacturer_inactive",
  "no reactiva link mientras fabricante está inactivo"
);

const existingProductLink=await api("/v1/internal/manufacturer-links/"+productLinkOneId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(existingProductLink.response.status===200,"link existente sigue legible tras desactivar fabricante");
ok(existingProductLink.body.link?.active===true,"desactivar fabricante no reescribe links silenciosamente");
ok(existingProductLink.body.link?.manufacturer?.active===false,"link refleja estado actual del fabricante");

const manufacturerDetail=await api("/v1/internal/manufacturers/"+manufacturerOneId,{
  headers:{cookie:inventoryReader.cookie}
});
ok(manufacturerDetail.response.status===200,"detalle de fabricante responde");
ok(
  Array.isArray(manufacturerDetail.body.links)&&manufacturerDetail.body.links.length===2,
  "detalle agrega vínculos del fabricante"
);
ok(manufacturerDetail.body.automaticManufacturerSelection===false,"detalle explicita cero selección automática");

const suppliersAfter=Number((await db`SELECT COUNT(*)::int count FROM suppliers`)[0]?.count||0);
const supplierVariantsAfter=Number((await db`SELECT COUNT(*)::int count FROM supplier_variants`)[0]?.count||0);
const poAfter=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const sourcesAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_sources WHERE variant_id=${variantId}`)[0]?.count||0);
const inventoryAfter=(await db`
  SELECT COALESCE(SUM(quantity),0)::int quantity,COALESCE(SUM(reserved),0)::int reserved
  FROM inventory WHERE variant_id=${variantId}`)[0];
const movementsAfter=Number((await db`
  SELECT COUNT(*)::int count FROM inventory_movements WHERE variant_id=${variantId}`)[0]?.count||0);
const classificationAfter=(await db`
  SELECT commercial_model,default_condition FROM products WHERE id=${productId}`)[0];

ok(suppliersAfter===suppliersBefore,"Manufacturer Registry no crea Supplier");
ok(supplierVariantsAfter===supplierVariantsBefore,"Manufacturer Registry no crea SupplierVariant");
ok(poAfter===poBefore,"Manufacturer Registry no crea PurchaseOrder");
ok(sourcesAfter===sourcesBefore,"Manufacturer Registry no crea InventorySource");
ok(
  Number(inventoryAfter.quantity)===Number(inventoryBefore.quantity)&&
  Number(inventoryAfter.reserved)===Number(inventoryBefore.reserved),
  "Manufacturer Registry no cambia quantity/reserved"
);
ok(movementsAfter===movementsBefore,"Manufacturer Registry no crea movimientos de inventario");
ok(
  classificationAfter.commercial_model===classificationBefore.commercial_model&&
  classificationAfter.default_condition===classificationBefore.default_condition,
  "Manufacturer Registry no cambia clasificación del producto"
);

const manufacturerAudits=await db`
  SELECT action FROM audit_events
  WHERE resource_type='Manufacturer'
    AND resource_id=${String(manufacturerOneId)}
  ORDER BY id`;
ok(manufacturerAudits.some((x:any)=>x.action==="manufacturer.created"),"creación manufacturer queda auditada");
ok(manufacturerAudits.some((x:any)=>x.action==="manufacturer.updated"),"update manufacturer queda auditado");

const linkAudits=await db`
  SELECT action FROM audit_events
  WHERE resource_type='ManufacturerLink'
    AND resource_id IN (${String(productLinkOneId)},${String(variantLinkId)})
  ORDER BY id`;
ok(linkAudits.some((x:any)=>x.action==="manufacturer_link.created"),"creación link queda auditada");
ok(linkAudits.some((x:any)=>x.action==="manufacturer_link.updated"),"update link queda auditado");

const unauth=await api("/v1/internal/manufacturers");
ok(unauth.response.status===401,"manufacturer registry exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — W8 Manufacturer Registry v1");
await db.close();
