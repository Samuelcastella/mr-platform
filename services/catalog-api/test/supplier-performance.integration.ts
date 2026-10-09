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
  const password="PERF-"+crypto.randomUUID()+"-R9!";
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
  return {cookie:cookieFrom(login.response),csrf:String(login.body.csrfToken||""),login};
}

const locationRows=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Supplier Perf CI "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId=Number(locationRows[0].id);

const productRows=await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES('Supplier Perf Product',${"supplier-perf-"+crypto.randomUUID()},'Accesorios','MR','active')
  RETURNING id`;
const productId=Number(productRows[0].id);

const variantRows=await db`
  INSERT INTO product_variants(product_id,sku,price,currency,active)
  VALUES(${productId},${"PERF-"+crypto.randomUUID().slice(0,10)},100.00,'HNL',TRUE)
  RETURNING id,sku`;
const variantId=Number(variantRows[0].id);
const sku=String(variantRows[0].sku);

const suppliers=await db`
  INSERT INTO suppliers(name,country_code,default_currency,active)
  VALUES
    (${"Proveedor Performance HN "+crypto.randomUUID().slice(0,5)},'HN','HNL',TRUE),
    (${"Proveedor Performance US "+crypto.randomUUID().slice(0,5)},'US','USD',TRUE)
  RETURNING id,name,default_currency`;
const supplier1Id=Number(suppliers[0].id);
const supplier2Id=Number(suppliers[1].id);

await db`
  INSERT INTO supplier_variants(
    supplier_id,variant_id,supplier_sku,quoted_cost_minor,currency,
    moq,lead_time_days,origin_country_code,preferred,active,last_verified_at
  )
  VALUES
    (${supplier1Id},${variantId},'HN-PERF',5000,'HNL',10,5,'HN',TRUE,TRUE,NOW()),
    (${supplier2Id},${variantId},'US-PERF',2500,'USD',20,12,'US',FALSE,TRUE,NOW())`;

async function insertPO(args:{
  supplierId:number;
  status:string;
  currency:string;
  quantityOrdered:number;
  quantityReceived:number;
  unitCostMinor:number;
  orderedDaysAgo:number;
  expectedDaysAgo:number|null;
  receiptDaysAgo:number|null;
}){
  const subtotal=args.quantityOrdered*args.unitCostMinor;
  const poRows=await db`
    INSERT INTO purchase_orders(
      po_number,supplier_id,supplier_name_snapshot,supplier_country_code_snapshot,
      destination_location_id,status,currency,subtotal_minor,
      shipping_estimate_minor,tax_estimate_minor,other_costs_minor,grand_total_minor,
      expected_at,ordered_at,created_by_service,idempotency_key,idempotency_hash
    )
    SELECT
      ${"PERF-PO-"+crypto.randomUUID().slice(0,8)},s.id,s.name,s.country_code,
      ${locationId},${args.status},${args.currency},${subtotal},
      0,0,0,${subtotal},
      CASE WHEN ${args.expectedDaysAgo}::int IS NULL THEN NULL
           ELSE NOW()-(${args.expectedDaysAgo}::text||' days')::interval END,
      NOW()-(${args.orderedDaysAgo}::text||' days')::interval,
      'ci',${"perf-po-"+crypto.randomUUID()},${crypto.randomUUID()}
    FROM suppliers s
    WHERE s.id=${args.supplierId}
    RETURNING id,ordered_at,expected_at`;
  const poId=Number(poRows[0].id);

  const itemRows=await db`
    INSERT INTO purchase_order_items(
      purchase_order_id,variant_id,sku_snapshot,product_name_snapshot,
      quantity_ordered,quantity_received,unit_cost_minor,currency,line_total_minor
    )
    VALUES(
      ${poId},${variantId},${sku},'Supplier Perf Product',
      ${args.quantityOrdered},${args.quantityReceived},${args.unitCostMinor},
      ${args.currency},${subtotal}
    )
    RETURNING id`;
  const itemId=Number(itemRows[0].id);

  if(args.receiptDaysAgo!=null&&args.quantityReceived>0){
    const grRows=await db`
      INSERT INTO goods_receipts(
        receipt_number,purchase_order_id,location_id,status,
        idempotency_key,idempotency_hash,received_by_service,received_at
      )
      VALUES(
        ${"PERF-GR-"+crypto.randomUUID().slice(0,8)},${poId},${locationId},'POSTED',
        ${"perf-gr-"+crypto.randomUUID()},${crypto.randomUUID()},'ci',
        NOW()-(${args.receiptDaysAgo}::text||' days')::interval
      )
      RETURNING id`;
    await db`
      INSERT INTO goods_receipt_items(
        goods_receipt_id,purchase_order_item_id,variant_id,
        quantity_received,unit_cost_minor,currency
      )
      VALUES(
        ${Number(grRows[0].id)},${itemId},${variantId},
        ${args.quantityReceived},${args.unitCostMinor},${args.currency}
      )`;
  }

  return poId;
}

await insertPO({
  supplierId:supplier1Id,status:"RECEIVED",currency:"HNL",
  quantityOrdered:10,quantityReceived:10,unitCostMinor:5000,
  orderedDaysAgo:5,expectedDaysAgo:2,receiptDaysAgo:3
});
await insertPO({
  supplierId:supplier1Id,status:"PARTIALLY_RECEIVED",currency:"HNL",
  quantityOrdered:8,quantityReceived:3,unitCostMinor:6000,
  orderedDaysAgo:3,expectedDaysAgo:null,receiptDaysAgo:2
});
await insertPO({
  supplierId:supplier2Id,status:"ORDERED",currency:"USD",
  quantityOrdered:4,quantityReceived:0,unitCostMinor:2500,
  orderedDaysAgo:2,expectedDaysAgo:null,receiptDaysAgo:null
});

const manager=await createStaff("MANAGER","Supplier Performance Manager");
const operator=await createStaff("INVENTORY_OPERATOR","Supplier Performance Operator");
const analyst=await createStaff("ANALYST","Supplier Performance Analyst");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(operator.login.response.status===200,"inventory operator inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const beforePO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const beforeReceipts=Number((await db`SELECT COUNT(*)::int count FROM goods_receipts`)[0]?.count||0);

const analystDenied=await api("/v1/internal/supplier-performance?days=90",{
  headers:{cookie:analyst.cookie}
});
ok(analystDenied.response.status===403,"reports-only Analyst no recibe supplier private data");

const response=await api("/v1/internal/supplier-performance?days=90",{
  headers:{cookie:operator.cookie}
});
ok(response.response.status===200,"inventory/procurement read role consulta performance");
ok(response.body.methodology?.supplierScoreCalculated===false,"no calcula supplier score");
ok(response.body.methodology?.automaticSupplierDecision===false,"no toma decisión automática");
ok(response.body.methodology?.fxConversionApplied===false,"no aplica FX");

ok(Number(response.body.summary?.purchaseOrders)===3,"summary cuenta POs ordenadas");
ok(Number(response.body.summary?.received)===1,"summary cuenta PO recibida");
ok(Number(response.body.summary?.partiallyReceived)===1,"summary cuenta parcial");
ok(Number(response.body.summary?.orderedOpen)===1,"summary cuenta abierta");
ok(Number(response.body.summary?.orderedUnits)===22,"summary unidades ordenadas");
ok(Number(response.body.summary?.receivedUnits)===13,"summary unidades recibidas");
ok(Number(response.body.summary?.receiptProgressPct)===59.1,"summary progreso de recepción");
ok(Number(response.body.summary?.receivedCostByCurrency?.HNL)===68000,"costo recibido se agrega por moneda");

const supplier1=response.body.suppliers?.find((x:any)=>Number(x.supplier?.id)===supplier1Id);
const supplier2=response.body.suppliers?.find((x:any)=>Number(x.supplier?.id)===supplier2Id);
ok(supplier1!=null&&supplier2!=null,"incluye ambos proveedores");
ok(Number(supplier1?.purchaseOrders?.total)===2,"proveedor HN tiene dos POs");
ok(Number(supplier1?.units?.ordered)===18,"proveedor HN unidades ordenadas");
ok(Number(supplier1?.units?.received)===13,"proveedor HN unidades recibidas");
ok(Number(supplier1?.units?.receiptProgressPct)===72.2,"proveedor HN progreso calculado");
ok(Number(supplier1?.timing?.avgDaysToFirstReceipt)===1.5,"promedia tiempo a primera recepción");
ok(Number(supplier1?.timing?.avgDaysToCompleteReceipt)===2,"mide tiempo de recepción completa");
ok(Number(supplier1?.timing?.onTimeEligibleOrders)===1,"solo expected_at completo entra a on-time");
ok(Number(supplier1?.timing?.onTimeOrders)===1,"PO completa llegó antes de expected_at");
ok(Number(supplier1?.timing?.onTimeCompletionPct)===100,"on-time explícito sobre muestra elegible");
ok(Number(supplier1?.receivedCostByCurrency?.HNL)===68000,"costo recibido HN se conserva en HNL");
ok(Number(supplier1?.sourcing?.activeOffers)===1,"contexto incluye oferta activa");
ok(Number(supplier1?.sourcing?.preferredOffers)===1,"contexto incluye oferta preferida");

ok(Number(supplier2?.purchaseOrders?.orderedOpen)===1,"proveedor US muestra PO abierta");
ok(supplier2?.timing?.avgDaysToFirstReceipt==null,"sin receipt no inventa lead time");
ok(supplier2?.timing?.onTimeCompletionPct==null,"sin muestra elegible no inventa on-time");
ok(Object.keys(supplier2?.receivedCostByCurrency||{}).length===0,"sin receipt no inventa costo recibido USD");

const invalid=await api("/v1/internal/supplier-performance?days=7",{
  headers:{cookie:manager.cookie}
});
ok(invalid.response.status===400&&invalid.body.error==="invalid_days","valida ventana mínima");

const afterPO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const afterReceipts=Number((await db`SELECT COUNT(*)::int count FROM goods_receipts`)[0]?.count||0);
ok(afterPO===beforePO,"analytics no crea ni modifica POs");
ok(afterReceipts===beforeReceipts,"analytics no crea receipts");

const unauth=await api("/v1/internal/supplier-performance?days=90");
ok(unauth.response.status===401,"performance interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — Supplier Performance Signals v1");
await db.close();
