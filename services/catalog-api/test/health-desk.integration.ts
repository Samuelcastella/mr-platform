import { SQL } from "bun";

if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true") {
  throw new Error("Refusing destructive integration test without ALLOW_DESTRUCTIVE_TEST_DB=true");
}

const db = new SQL({
  hostname:Bun.env.PGHOST!, port:Number(Bun.env.PGPORT||5432),
  username:Bun.env.PGUSER!, password:Bun.env.PGPASSWORD!,
  database:Bun.env.PGDATABASE!, tls:false, max:5
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

async function login(email:string,password:string){
  const result=await api("/v1/auth/login",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({email,password})
  });
  return {...result,cookie:cookieFrom(result.response),csrf:String(result.body.csrfToken||"")};
}

function headers(session:{cookie:string;csrf:string}){
  return {
    cookie:session.cookie,
    "x-csrf-token":session.csrf,
    "content-type":"application/json"
  };
}

async function createStaff(email:string,name:string,roleCode:string){
  const password="M14-"+crypto.randomUUID()+"-R9!";
  const hash=await Bun.password.hash(password,{algorithm:"argon2id"});
  const users=await db`
    INSERT INTO staff_users(email_normalized,display_name,password_hash,status,email_verified_at)
    VALUES(${email},${name},${hash},'ACTIVE',NOW())
    RETURNING id`;
  const roles=await db`SELECT id FROM roles WHERE code=${roleCode} LIMIT 1`;
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(roles[0].id)},'GLOBAL',NULL)`;
  return {userId:Number(users[0].id),session:await login(email,password)};
}

const locations=await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"M14 CI "+crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId=Number(locations[0].id);

const products=await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES('Producto M14 CI',${"m14-ci-"+crypto.randomUUID()},'Prueba','MR','active')
  RETURNING id`;
const productId=Number(products[0].id);

const variants=await db`
  INSERT INTO product_variants(product_id,sku,size,color,cost,price,currency,active)
  VALUES(
    ${productId},${"M14-CI-"+crypto.randomUUID().slice(0,8)},
    'M','Negro',100.00,150.00,'HNL',TRUE
  )
  RETURNING id`;
const variantId=Number(variants[0].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES(${variantId},${locationId},10,1)`;

const orders=await db`
  INSERT INTO orders(
    order_number,public_token,channel,status,currency,
    subtotal_minor,discount_total_minor,tax_total_minor,shipping_total_minor,grand_total_minor,
    location_id,customer_name,customer_phone,idempotency_key,idempotency_hash
  )
  VALUES(
    ${"MR-M14-"+crypto.randomUUID().slice(0,8)},${crypto.randomUUID()},
    'WEB','PENDING_CONFIRMATION','HNL',15000,0,0,0,15000,
    ${locationId},'Cliente M14','5555-1414',
    ${"m14-order-"+crypto.randomUUID()},${crypto.randomUUID()}
  )
  RETURNING id`;
const orderId=Number(orders[0].id);

await db`
  INSERT INTO inventory_reservations(
    order_id,variant_id,location_id,quantity,status,expires_at
  )
  VALUES(
    ${orderId},${variantId},${locationId},1,'ACTIVE',NOW()-INTERVAL '2 hours'
  )`;

const checkouts=await db`
  INSERT INTO checkout_sessions(
    public_token,order_id,status,payment_method,currency,amount_minor,
    idempotency_key,idempotency_hash,updated_at
  )
  VALUES(
    ${crypto.randomUUID()},${orderId},'COMPLETED','BANK_TRANSFER','HNL',15000,
    ${"m14-checkout-"+crypto.randomUUID()},${crypto.randomUUID()},NOW()-INTERVAL '48 hours'
  )
  RETURNING id`;
const checkoutId=Number(checkouts[0].id);

const payments=await db`
  INSERT INTO payments(
    checkout_session_id,order_id,provider,method,status,amount_minor,currency,updated_at
  )
  VALUES(
    ${checkoutId},${orderId},'OFFLINE','BANK_TRANSFER','PENDING',15000,'HNL',
    NOW()-INTERVAL '48 hours'
  )
  RETURNING id`;
const paymentId=Number(payments[0].id);

await db`
  INSERT INTO fulfillments(
    public_token,order_id,type,status,provider,tracking_reference,
    quoted_shipping_minor,currency,idempotency_key,idempotency_hash
  )
  VALUES(
    ${crypto.randomUUID()},${orderId},'LOCAL_DELIVERY','FAILED','MANUAL',
    ${"M14-TRACK-"+crypto.randomUUID().slice(0,8)},0,'HNL',
    ${"m14-fulfillment-"+crypto.randomUUID()},${crypto.randomUUID()}
  )`;

const manager=await createStaff(
  "m14-manager-"+crypto.randomUUID().slice(0,6)+"@example.test",
  "M14 Manager","MANAGER"
);
const analyst=await createStaff(
  "m14-analyst-"+crypto.randomUUID().slice(0,6)+"@example.test",
  "M14 Analyst","ANALYST"
);

ok(manager.session.response.status===200,"Manager inicia sesión");
ok(analyst.session.response.status===200,"Analyst inicia sesión");

const analystRefresh=await api("/v1/internal/health-desk/refresh",{
  method:"POST",headers:headers(analyst.session),body:"{}"
});
ok(analystRefresh.response.status===403,"Analyst no puede refrescar/mutar incidentes");

const first=await api("/v1/internal/health-desk/refresh",{
  method:"POST",headers:headers(manager.session),body:"{}"
});
ok(first.response.status===200,"Manager refresca señales");
ok(Number(first.body.opened)>=3,"refresh abre incidentes por condiciones reales");

const snapshot1=await api("/v1/internal/health-desk",{headers:headers(manager.session)});
ok(snapshot1.response.status===200,"Health Desk se consulta");
ok(snapshot1.body.overall==="DOWN","condiciones críticas degradan estado general");
ok(Number(snapshot1.body.summary?.activeSignals)>=3,"señales activas visibles");
ok(
  snapshot1.body.signals?.some((s:any)=>s.signalType==="fiscal_authority_state"&&s.status==="UNKNOWN"),
  "fiscal permanece UNKNOWN"
);

const count1=await db`SELECT COUNT(*)::int AS count FROM operational_incidents`;

const second=await api("/v1/internal/health-desk/refresh",{
  method:"POST",headers:headers(manager.session),body:"{}"
});
ok(second.response.status===200,"segundo refresh funciona");
const count2=await db`SELECT COUNT(*)::int AS count FROM operational_incidents`;
ok(Number(count2[0].count)===Number(count1[0].count),"refresh repetido no duplica incidentes");

const openIncident=snapshot1.body.incidents?.find((i:any)=>i.status==="OPEN");
ok(Boolean(openIncident),"existe incidente OPEN");

if(openIncident){
  const ack=await api("/v1/internal/health-desk/incidents/"+openIncident.id+"/acknowledge",{
    method:"POST",headers:headers(manager.session),body:JSON.stringify({note:"CI acknowledge"})
  });
  ok(ack.response.status===200,"incidente puede reconocerse");
}

await db`
  UPDATE inventory_reservations
  SET status='RELEASED',updated_at=NOW()
  WHERE order_id=${orderId} AND status='ACTIVE'`;
await db`UPDATE payments SET status='PAID',updated_at=NOW() WHERE id=${paymentId}`;
await db`UPDATE fulfillments SET status='DELIVERED',updated_at=NOW() WHERE order_id=${orderId}`;

const healthyRefresh=await api("/v1/internal/health-desk/refresh",{
  method:"POST",headers:headers(manager.session),body:"{}"
});
ok(healthyRefresh.response.status===200,"refresh saludable funciona");
ok(Number(healthyRefresh.body.autoResolved)>=3,"condiciones sanas auto-resuelven incidentes");

const snapshot2=await api("/v1/internal/health-desk",{headers:headers(analyst.session)});
ok(snapshot2.response.status===200,"Analyst puede leer Health Desk");
ok(snapshot2.body.overall==="HEALTHY","estado general vuelve HEALTHY");

const activeBusiness=await db`
  SELECT
    (SELECT COUNT(*)::int FROM inventory_reservations WHERE order_id=${orderId} AND status='ACTIVE') reservations,
    (SELECT status FROM payments WHERE id=${paymentId}) payment_status,
    (SELECT status FROM fulfillments WHERE order_id=${orderId}) fulfillment_status`;
ok(Number(activeBusiness[0].reservations)===0,"Health Desk no recrea reservas");
ok(activeBusiness[0].payment_status==="PAID","Health Desk no revierte Payment");
ok(activeBusiness[0].fulfillment_status==="DELIVERED","Health Desk no revierte Fulfillment");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}
console.log("Todo correcto — M14 Health Desk");
await db.close();
