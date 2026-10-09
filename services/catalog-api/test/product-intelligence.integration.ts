import { SQL } from "bun";

if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true") {
  throw new Error("Refusing destructive integration test without ALLOW_DESTRUCTIVE_TEST_DB=true");
}

const db = new SQL({
  hostname: Bun.env.PGHOST!,
  port: Number(Bun.env.PGPORT || 5432),
  username: Bun.env.PGUSER!,
  password: Bun.env.PGPASSWORD!,
  database: Bun.env.PGDATABASE!,
  tls: false,
  max: 5
});

const base = Bun.env.API_BASE_URL || "http://127.0.0.1:3011";
let failures = 0;

function ok(condition: unknown, message: string) {
  if (!condition) {
    failures++;
    console.error("FAIL", message);
  } else {
    console.log("ok  ", message);
  }
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(base + path, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function cookieFrom(response: Response) {
  return (response.headers.get("set-cookie") || "").split(";")[0] || "";
}

async function createAnalyst() {
  const email = "product-intel-" + crypto.randomUUID().slice(0,8) + "@example.test";
  const password = "ProductIntel-" + crypto.randomUUID() + "-R9!";
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });

  const users = await db`
    INSERT INTO staff_users(
      email_normalized,display_name,password_hash,status,email_verified_at
    )
    VALUES(${email},'Product Intelligence Analyst',${hash},'ACTIVE',NOW())
    RETURNING id`;
  const role = await db`SELECT id FROM roles WHERE code='ANALYST' LIMIT 1`;
  if (!role.length) throw new Error("analyst_role_missing");
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(role[0].id)},'GLOBAL',NULL)`;

  const login = await api("/v1/auth/login", {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({email,password})
  });

  return {
    userId:Number(users[0].id),
    cookie:cookieFrom(login.response),
    login
  };
}

const locationRows = await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Product Intel CI " + crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId = Number(locationRows[0].id);

const products = await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES
    ('Zapato prueba',${"zapato-intel-"+crypto.randomUUID()},'Calzado','Marca A','active'),
    ('Vestido prueba',${"vestido-intel-"+crypto.randomUUID()},'Vestuario','Marca B','active')
  RETURNING id,name,category`;
const productA = Number(products[0].id);
const productB = Number(products[1].id);

const variants = await db`
  INSERT INTO product_variants(product_id,sku,size,color,cost,price,currency,active)
  VALUES
    (${productA},${"INT-A-"+crypto.randomUUID().slice(0,8)},'38','Negro',100.00,200.00,'HNL',TRUE),
    (${productB},${"INT-B-"+crypto.randomUUID().slice(0,8)},'M','Rojo',NULL,150.00,'HNL',TRUE)
  RETURNING id`;
const variantA = Number(variants[0].id);
const variantB = Number(variants[1].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES
    (${variantA},${locationId},4,0),
    (${variantB},${locationId},7,1)`;

const orderRows = await db`
  INSERT INTO orders(
    order_number,public_token,channel,status,currency,
    subtotal_minor,discount_total_minor,tax_total_minor,shipping_total_minor,grand_total_minor,
    location_id,customer_name,customer_phone,idempotency_key,idempotency_hash
  )
  VALUES(
    ${"MR-INTEL-"+crypto.randomUUID().slice(0,8)},
    ${crypto.randomUUID()},'WEB','COMPLETED','HNL',
    90000,0,0,0,90000,
    ${locationId},'Cliente Intel','9999-7575',
    ${"intel-order-"+crypto.randomUUID()},
    ${"hash-"+crypto.randomUUID()}
  )
  RETURNING id`;
const orderId = Number(orderRows[0].id);

const items = await db`
  INSERT INTO order_items(
    order_id,variant_id,sku_snapshot,product_name_snapshot,variant_snapshot,
    quantity,unit_price_minor,currency,line_total_minor,
    commercial_mode,economic_owner_type,unit_cost_basis_minor,commercial_snapshot_at
  )
  VALUES
    (
      ${orderId},${variantA},'INT-A-SNAP','Zapato prueba','{}'::jsonb,
      3,20000,'HNL',60000,
      'OWNED','MR',10000,NOW()
    ),
    (
      ${orderId},${variantB},'INT-B-SNAP','Vestido prueba','{}'::jsonb,
      2,15000,'HNL',30000,
      'COMMISSION','THIRD_PARTY',NULL,NOW()
    )
  RETURNING id,variant_id`;
const itemA = Number(items.find((x:any)=>Number(x.variant_id)===variantA)?.id);

await db`
  INSERT INTO order_status_history(order_id,from_status,to_status,actor,reason,created_at)
  VALUES(${orderId},'DELIVERED','COMPLETED','ci','analytics fixture',NOW()-INTERVAL '1 day')`;

const cancelledRows = await db`
  INSERT INTO orders(
    order_number,public_token,channel,status,currency,
    subtotal_minor,discount_total_minor,tax_total_minor,shipping_total_minor,grand_total_minor,
    location_id,idempotency_key,idempotency_hash
  )
  VALUES(
    ${"MR-CANCEL-"+crypto.randomUUID().slice(0,8)},
    ${crypto.randomUUID()},'WEB','CANCELLED','HNL',
    180000,0,0,0,180000,
    ${locationId},
    ${"intel-cancel-"+crypto.randomUUID()},
    ${"hash-"+crypto.randomUUID()}
  )
  RETURNING id`;
const cancelledOrderId = Number(cancelledRows[0].id);

await db`
  INSERT INTO order_items(
    order_id,variant_id,sku_snapshot,product_name_snapshot,variant_snapshot,
    quantity,unit_price_minor,currency,line_total_minor,
    commercial_mode,economic_owner_type,unit_cost_basis_minor
  )
  VALUES(
    ${cancelledOrderId},${variantA},'INT-A-CANCEL','Zapato prueba','{}'::jsonb,
    9,20000,'HNL',180000,'OWNED','MR',10000
  )`;

const returnRows = await db`
  INSERT INTO return_cases(
    return_number,order_id,status,requested_resolution,resolution_status,
    reason_code,idempotency_key,idempotency_hash,
    requested_by_service,completed_by_service,
    requested_at,completed_at
  )
  VALUES(
    ${"MR-RET-INT-"+crypto.randomUUID().slice(0,8)},${orderId},'COMPLETED',
    'REFUND','RESOLVED','SIZE',
    ${"intel-return-"+crypto.randomUUID()},${"hash-"+crypto.randomUUID()},
    'ci','ci',NOW()-INTERVAL '12 hours',NOW()-INTERVAL '2 hours'
  )
  RETURNING id`;
const returnId = Number(returnRows[0].id);

await db`
  INSERT INTO return_items(
    return_case_id,order_item_id,variant_id,sku_snapshot,product_name_snapshot,
    quantity_requested,quantity_received
  )
  VALUES(${returnId},${itemA},${variantA},'INT-A-SNAP','Zapato prueba',1,1)`;

await db`
  INSERT INTO public_inquiries(
    kind,name,contact,country_code,product_id,message,metadata,status,created_at
  )
  VALUES
    ('notify','Cliente 1','1','HN',${productA},'Avisar','{}'::jsonb,'new',NOW()-INTERVAL '1 day'),
    ('notify','Cliente 2','2','HN',${productA},'Avisar','{}'::jsonb,'new',NOW()-INTERVAL '2 days'),
    ('product_request','Cliente 3','3','HN',${productB},'Quiero este','{}'::jsonb,'new',NOW()-INTERVAL '3 days'),
    ('product_request','Cliente 4','4','HN',NULL,'Busco bolso',
      '{"requestedProduct":"Bolso artesanal"}'::jsonb,'new',NOW()-INTERVAL '4 days')`;

const analyst = await createAnalyst();
ok(analyst.login.response.status === 200, "analyst inicia sesión");

const result = await api("/v1/internal/product-intelligence?days=90", {
  headers:{cookie:analyst.cookie}
});
ok(result.response.status === 200, "endpoint de inteligencia responde");

const summary = result.body?.summary || {};
ok(Number(summary.completedOrders) === 1, "solo cuenta orden realmente COMPLETED");
ok(Number(summary.completedUnits) === 5, "agrega unidades completadas");
ok(Number(summary.returnedUnits) === 1, "agrega unidades devueltas completadas");
ok(Number(summary.currentAvailableUnits) === 10, "agrega stock disponible actual");
ok(Number(summary.costKnownUnits) === 3, "mide cobertura de cost basis");
ok(Number(summary.costCoveragePct) === 60, "calcula cobertura de cost basis");
ok(Number(summary.completedGrossByCurrency?.HNL) === 90000, "agrega venta bruta en minor units");
ok(Number(summary.knownGrossMarginProxyByCurrency?.HNL) === 30000, "calcula margin proxy solo con costo conocido");

const productRows:any[] = Array.isArray(result.body?.products) ? result.body.products : [];
const a = productRows.find((x:any)=>Number(x.productId)===productA);
const b = productRows.find((x:any)=>Number(x.productId)===productB);
ok(Number(a?.completedUnits) === 3, "producto A conserva unidades completadas");
ok(Number(a?.returnedUnits) === 1, "producto A conserva devolución");
ok(Number(a?.restockInterest) === 2, "producto A conserva interés de reposición");
ok(Number(a?.ownershipMix?.mrOwnedUnits) === 3, "producto A refleja ownership MR");
ok(Number(b?.completedUnits) === 2, "producto B conserva unidades completadas");
ok(Number(b?.productRequests) === 1, "producto B conserva demanda vinculada");
ok(Number(b?.ownershipMix?.thirdPartyUnits) === 2, "producto B refleja ownership tercero");

const categories:any[] = Array.isArray(result.body?.categories) ? result.body.categories : [];
const footwear = categories.find((x:any)=>x.category==="Calzado");
const apparel = categories.find((x:any)=>x.category==="Vestuario");
ok(Number(footwear?.completedUnits) === 3, "rollup de categoría Calzado");
ok(Number(apparel?.completedUnits) === 2, "rollup de categoría Vestuario");

const missing:any[] = Array.isArray(result.body?.missingDemand) ? result.body.missingDemand : [];
ok(
  missing.some((x:any)=>x.item==="Bolso artesanal" && Number(x.count)===1),
  "muestra demanda no cubierta"
);

ok(
  result.body?.methodology?.ranking?.includes("No private-label score"),
  "metodología declara que no existe score automático"
);

const invalid = await api("/v1/internal/product-intelligence?days=2", {
  headers:{cookie:analyst.cookie}
});
ok(invalid.response.status === 400 && invalid.body.error === "invalid_days", "rechaza ventana inválida");

const unauth = await api("/v1/internal/product-intelligence?days=90");
ok(unauth.response.status === 401, "endpoint interno requiere autenticación");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — Product Intelligence v1");
await db.close();
