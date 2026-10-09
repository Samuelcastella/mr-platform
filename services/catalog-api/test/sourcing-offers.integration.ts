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
  const password="SOURCING-"+crypto.randomUUID()+"-R9!";
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
    'Sourcing CI Product',
    ${"sourcing-ci-"+crypto.randomUUID()},
    'Calzado',
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
    ${productId},${"SRC-"+crypto.randomUUID().slice(0,10)},
    '38','Negro',NULL,120.00,'HNL',NULL,TRUE
  )
  RETURNING id,sku,supplier_id`;
const variantId=Number(variantRows[0].id);

const manager=await createStaff("MANAGER","Sourcing Manager");
const operator=await createStaff("INVENTORY_OPERATOR","Sourcing Operator");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(operator.login.response.status===200,"inventory operator inicia sesión");

async function createSupplier(name:string,countryCode:string,defaultCurrency:string){
  return api("/v1/internal/suppliers",{
    method:"POST",
    headers:headers(manager),
    body:JSON.stringify({name,countryCode,defaultCurrency})
  });
}

const supplierHN=await createSupplier("Proveedor HN "+crypto.randomUUID().slice(0,5),"HN","HNL");
const supplierUS=await createSupplier("Proveedor US "+crypto.randomUUID().slice(0,5),"US","USD");
ok(supplierHN.response.status===201,"crea proveedor HNL");
ok(supplierUS.response.status===201,"crea proveedor USD");
const supplierHNId=Number(supplierHN.body.supplier?.id);
const supplierUSId=Number(supplierUS.body.supplier?.id);

const beforePO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const beforeSources=Number((await db`SELECT COUNT(*)::int count FROM inventory_sources`)[0]?.count||0);

const operatorList=await api("/v1/internal/sourcing/offers",{headers:{cookie:operator.cookie}});
ok(operatorList.response.status===200,"supplier-read role puede consultar sourcing");

const operatorWrite=await api("/v1/internal/sourcing/offers",{
  method:"POST",
  headers:headers(operator),
  body:JSON.stringify({
    supplierId:supplierHNId,
    variantId,
    quotedCostMinor:8000,
    currency:"HNL"
  })
});
ok(
  operatorWrite.response.status===403&&operatorWrite.body.error==="forbidden",
  "supplier-read role no puede modificar sourcing"
);

const hnOffer=await api("/v1/internal/sourcing/offers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    supplierId:supplierHNId,
    variantId,
    supplierSku:"HN-38-BLK",
    quotedCostMinor:8000,
    currency:"HNL",
    moq:12,
    leadTimeDays:5,
    originCountryCode:"HN",
    preferred:true,
    note:"Cotización local de prueba"
  })
});
ok(hnOffer.response.status===201,"registra oferta HNL");
ok(hnOffer.body.createsPurchaseOrder===false,"crear oferta no crea PO");
ok(hnOffer.body.inventoryChanged===false,"crear oferta no cambia inventario");
const hnOfferId=Number(hnOffer.body.offer?.id);
ok(Number(hnOffer.body.offer?.retailSpreadMinor)===4000,"spread retail se calcula en misma moneda");
ok(hnOffer.body.offer?.retailSpreadComparable===true,"HNL es comparable con retail HNL");

const usdOffer=await api("/v1/internal/sourcing/offers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    supplierId:supplierUSId,
    variantId,
    supplierSku:"US-38-BLK",
    quotedCostMinor:3000,
    currency:"USD",
    moq:24,
    leadTimeDays:18,
    originCountryCode:"US",
    preferred:false,
    note:"Cotización exterior de prueba"
  })
});
ok(usdOffer.response.status===201,"registra segunda oferta para misma variante");
ok(usdOffer.body.offer?.retailSpreadMinor==null,"moneda distinta no recibe spread inventado");
ok(usdOffer.body.offer?.retailSpreadComparable===false,"USD no se marca comparable con retail HNL");

const duplicate=await api("/v1/internal/sourcing/offers",{
  method:"POST",
  headers:headers(manager),
  body:JSON.stringify({
    supplierId:supplierHNId,
    variantId,
    quotedCostMinor:7900,
    currency:"HNL"
  })
});
ok(
  duplicate.response.status===409&&duplicate.body.error==="supplier_variant_exists",
  "supplier + variant conserva una relación actual única"
);

const list=await api("/v1/internal/sourcing/offers?variantId="+variantId,{
  headers:{cookie:operator.cookie}
});
ok(list.response.status===200&&Array.isArray(list.body.data),"lista por variante responde");
ok(list.body.data.length===2,"una variante admite múltiples proveedores");

const comparison=await api("/v1/internal/sourcing/comparison?variantId="+variantId,{
  headers:{cookie:operator.cookie}
});
ok(comparison.response.status===200,"comparación por variante responde");
ok(Number(comparison.body.offerCount)===2,"comparación incluye dos ofertas");
ok(comparison.body.comparisonRules?.fxConversionApplied===false,"comparación no aplica FX");
ok(comparison.body.comparisonRules?.automaticSupplierSelection===false,"comparación no elige proveedor");
ok(comparison.body.createsPurchaseOrder===false,"comparación no crea PO");

const hnlGroup=comparison.body.currencyGroups?.find((g:any)=>g.currency==="HNL");
const usdGroup=comparison.body.currencyGroups?.find((g:any)=>g.currency==="USD");
ok(hnlGroup?.comparableToRetail===true,"grupo HNL es comparable con retail");
ok(usdGroup?.comparableToRetail===false,"grupo USD queda separado");
ok(Number(hnlGroup?.offers?.[0]?.retailSpreadMinor)===4000,"grupo HNL conserva spread");
ok(usdGroup?.offers?.[0]?.retailSpreadMinor==null,"grupo USD no tiene spread");

const update=await api("/v1/internal/sourcing/offers/"+hnOfferId,{
  method:"PATCH",
  headers:headers(manager),
  body:JSON.stringify({
    quotedCostMinor:7500,
    currency:"HNL",
    moq:10,
    leadTimeDays:4,
    preferred:true,
    active:true,
    note:"Proveedor mejoró términos"
  })
});
ok(update.response.status===200,"actualiza términos de sourcing");
ok(Number(update.body.offer?.quotedCostMinor)===7500,"quote actual queda actualizado");
ok(Number(update.body.offer?.retailSpreadMinor)===4500,"spread se recalcula sin tratarlo como margen");
ok(Array.isArray(update.body.history)&&update.body.history.length===2,"historial conserva create + update");
ok(update.body.history?.[0]?.snapshot?.quotedCostMinor===8000,"historial preserva quote anterior");
ok(update.body.history?.[1]?.snapshot?.quotedCostMinor===7500,"historial preserva quote nuevo");

const afterPO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const afterSources=Number((await db`SELECT COUNT(*)::int count FROM inventory_sources`)[0]?.count||0);
ok(afterPO===beforePO,"sourcing offers no crea PurchaseOrder");
ok(afterSources===beforeSources,"sourcing offers no crea InventorySource");

const legacyVariant=await db`
  SELECT supplier_id
  FROM product_variants
  WHERE id=${variantId}`;
ok(legacyVariant[0]?.supplier_id==null,"many-to-many no sobrescribe supplier_id legacy");

const audit=await db`
  SELECT action
  FROM audit_events
  WHERE resource_type='SupplierVariant'
    AND resource_id=${String(hnOfferId)}
  ORDER BY id`;
ok(audit.some((x:any)=>x.action==="supplier_variant.created"),"creación queda auditada");
ok(audit.some((x:any)=>x.action==="supplier_variant.updated"),"actualización queda auditada");

const unauth=await api("/v1/internal/sourcing/offers");
ok(unauth.response.status===401,"sourcing interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — SupplierVariant sourcing offers v1");
await db.close();
