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

async function login(email: string, password: string) {
  const result = await api("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return {
    ...result,
    cookie: cookieFrom(result.response),
    csrf: String(result.body.csrfToken || "")
  };
}

function headers(session: { cookie: string; csrf: string }) {
  return {
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    "content-type": "application/json"
  };
}

async function createStaff(email: string, displayName: string, roleCode: string) {
  const password = "M13-" + crypto.randomUUID() + "-R9!";
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const users = await db`
    INSERT INTO staff_users(
      email_normalized,display_name,password_hash,status,email_verified_at
    )
    VALUES(${email},${displayName},${hash},'ACTIVE',NOW())
    RETURNING id`;
  const roles = await db`SELECT id FROM roles WHERE code=${roleCode} LIMIT 1`;
  if (!roles.length) throw new Error("role_missing:" + roleCode);
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(roles[0].id)},'GLOBAL',NULL)`;
  return {
    userId: Number(users[0].id),
    session: await login(email, password)
  };
}

const location = await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"M13 CI " + crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId = Number(location[0].id);

const product = await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Producto M13 CI',
    ${"m13-ci-" + crypto.randomUUID()},
    'Prueba','MR','active'
  )
  RETURNING id`;
const productId = Number(product[0].id);

const variant = await db`
  INSERT INTO product_variants(product_id,sku,size,color,cost,price,currency,active)
  VALUES(
    ${productId},${"M13-CI-" + crypto.randomUUID().slice(0,8)},
    'M','Negro',100.00,175.00,'HNL',TRUE
  )
  RETURNING id`;
const variantId = Number(variant[0].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES(${variantId},${locationId},5,0)`;

const manager = await createStaff(
  "m13-manager-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "M13 Manager",
  "MANAGER"
);
const salesperson1 = await createStaff(
  "m13-sales1-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "M13 Sales One",
  "CASHIER"
);
const salesperson2 = await createStaff(
  "m13-sales2-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "M13 Sales Two",
  "CASHIER"
);

ok(manager.session.response.status === 200, "Manager inicia sesión");

const created = await api("/v1/orders", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": "m13-order-" + crypto.randomUUID()
  },
  body: JSON.stringify({
    channel: "STORE",
    locationId,
    customer: { name: "Cliente M13", phone: "9999-1313" },
    items: [{ variantId, quantity: 1 }]
  })
});
ok(created.response.status === 201, "crea orden base");
const orderId = Number(created.body.order?.id);
const orderToken = String(created.body.order?.token || "");
const originalGrandTotal = Number(created.body.order?.grandTotalMinor);

const primary = await api("/v1/internal/orders/" + orderId + "/staff-attributions", {
  method: "POST",
  headers: headers(manager.session),
  body: JSON.stringify({
    staffUserId: salesperson1.userId,
    attributionRole: "PRIMARY_SALESPERSON",
    sourceType: "STAFF_SESSION",
    sourceReference: "store-session-ci"
  })
});
ok(primary.response.status === 201, "asigna primary salesperson");
ok(
  Number(primary.body.attribution?.staffUserId) === salesperson1.userId,
  "primary queda ligado al StaffUser correcto"
);

const replay = await api("/v1/internal/orders/" + orderId + "/staff-attributions", {
  method: "POST",
  headers: headers(manager.session),
  body: JSON.stringify({
    staffUserId: salesperson1.userId,
    attributionRole: "PRIMARY_SALESPERSON",
    sourceType: "STAFF_SESSION",
    sourceReference: "store-session-ci"
  })
});
ok(replay.response.status === 200 && replay.body.replayed === true, "asignación repetida es idempotente");

const assist = await api("/v1/internal/orders/" + orderId + "/staff-attributions", {
  method: "POST",
  headers: headers(manager.session),
  body: JSON.stringify({
    staffUserId: salesperson2.userId,
    attributionRole: "ASSIST",
    sourceType: "STAFF_SESSION",
    sourceReference: "store-session-ci"
  })
});
ok(assist.response.status === 201, "registra assist sin reemplazar primary");

const confirm = await api(
  "/v1/orders/" + orderId + "/confirm?token=" + encodeURIComponent(orderToken),
  { method: "POST" }
);
ok(confirm.response.status === 200 && confirm.body.order?.status === "CONFIRMED", "orden queda comprometida");

const correctionWithoutReason = await api(
  "/v1/internal/orders/" + orderId + "/staff-attributions",
  {
    method: "POST",
    headers: headers(manager.session),
    body: JSON.stringify({
      staffUserId: salesperson2.userId,
      attributionRole: "PRIMARY_SALESPERSON"
    })
  }
);
ok(
  correctionWithoutReason.response.status === 409 &&
  correctionWithoutReason.body.error === "correction_reason_required",
  "corrección posterior al compromiso exige motivo"
);

const correction = await api("/v1/internal/orders/" + orderId + "/staff-attributions", {
  method: "POST",
  headers: headers(manager.session),
  body: JSON.stringify({
    staffUserId: salesperson2.userId,
    attributionRole: "PRIMARY_SALESPERSON",
    reason: "Corrección validada por supervisor en prueba CI"
  })
});
ok(correction.response.status === 201, "corrección auditada crea nueva atribución");
ok(correction.body.attribution?.sourceType === "MANUAL_OVERRIDE", "corrección comprometida queda MANUAL_OVERRIDE");

const active = await api("/v1/internal/orders/" + orderId + "/staff-attributions", {
  headers: { cookie: manager.session.cookie }
});
ok(active.response.status === 200, "manager puede leer atribuciones");
const activePrimary = active.body.data?.find(
  (x: any) => x.attributionRole === "PRIMARY_SALESPERSON" && x.status === "ACTIVE"
);
const activeAssist = active.body.data?.find(
  (x: any) => x.attributionRole === "ASSIST" && x.status === "ACTIVE"
);
ok(Number(activePrimary?.staffUserId) === salesperson2.userId, "primary activo refleja corrección");
ok(Number(activeAssist?.staffUserId) === salesperson2.userId, "assist permanece independiente");

const history = await api(
  "/v1/internal/orders/" + orderId + "/staff-attributions?history=true",
  { headers: { cookie: manager.session.cookie } }
);
const superseded = history.body.data?.find(
  (x: any) => x.attributionRole === "PRIMARY_SALESPERSON" && x.status === "SUPERSEDED"
);
ok(Number(superseded?.staffUserId) === salesperson1.userId, "historial conserva primary anterior");
ok(
  Number(correction.body.attribution?.supersedesAttributionId) === Number(superseded?.id),
  "corrección referencia la atribución reemplazada"
);

const orderAfter = await api(
  "/v1/orders/" + orderId + "?token=" + encodeURIComponent(orderToken)
);
ok(orderAfter.response.status === 200, "orden pública sigue consultable");
ok(orderAfter.body.order?.status === "CONFIRMED", "atribución no altera estado de orden");
ok(
  Number(orderAfter.body.order?.grandTotalMinor) === originalGrandTotal,
  "atribución no altera montos de orden"
);
const publicPayload = JSON.stringify(orderAfter.body.order || {});
ok(!publicPayload.includes("staffAttribution"), "respuesta pública no expone atribución interna");
ok(!publicPayload.includes("PRIMARY_SALESPERSON"), "respuesta pública no expone rol interno");

const audit = await db`
  SELECT action,resource_id
  FROM audit_events
  WHERE action IN ('commission_attribution.assigned','commission_attribution.corrected')
    AND resource_type='OrderStaffAttribution'
  ORDER BY id`;
ok(audit.length >= 3, "asignaciones y corrección quedan auditadas");
ok(
  audit.some((x: any) => x.action === "commission_attribution.corrected"),
  "auditoría distingue corrección"
);

const unauth = await api("/v1/internal/orders/" + orderId + "/staff-attributions");
ok(unauth.response.status === 401, "rutas de atribución requieren autenticación");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — M13 staff sales attribution foundation");
await db.close();
