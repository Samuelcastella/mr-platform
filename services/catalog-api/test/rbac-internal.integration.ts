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
const serviceKey = Bun.env.INTERNAL_API_TOKEN || "ci-service-token";
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

async function login(email: string, secret: string) {
  const result = await api("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: secret })
  });
  return {
    ...result,
    cookie: cookieFrom(result.response),
    csrf: String(result.body.csrfToken || "")
  };
}

await db.unsafe(
  "TRUNCATE TABLE audit_events, staff_sessions, user_role_assignments, staff_users RESTART IDENTITY CASCADE"
);

const adminSecret = "A-" + crypto.randomUUID() + "-9x!";
const bootstrap = await api("/v1/security/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-key": serviceKey
  },
  body: JSON.stringify({
    email: "rbac-admin@example.test",
    displayName: "RBAC Admin CI",
    password: adminSecret
  })
});
ok(bootstrap.response.status === 201, "crea administrador de prueba");

const admin = await login("rbac-admin@example.test", adminSecret);
ok(admin.response.status === 200, "admin inicia sesión");

const inquiryRows = await db`
  INSERT INTO public_inquiries(kind, name, contact, message, status, public_token)
  VALUES(
    'support', 'Cliente RBAC CI', '5555-0000',
    'Consulta RBAC', 'new', ${crypto.randomUUID()}
  )
  RETURNING id`;
const inquiryId = Number(inquiryRows[0].id);

const inquiryList = await api("/v1/internal/inquiries", {
  headers: { cookie: admin.cookie }
});
ok(inquiryList.response.status === 200, "StaffUser autorizado lee inquiries");

const inquiryNoCsrf = await api("/v1/internal/inquiries/" + inquiryId, {
  method: "PATCH",
  headers: {
    cookie: admin.cookie,
    "content-type": "application/json"
  },
  body: JSON.stringify({ status: "reviewing" })
});
ok(
  inquiryNoCsrf.response.status === 403 &&
  inquiryNoCsrf.body.error === "csrf_required",
  "mutación humana exige CSRF"
);

const inquiryUpdated = await api("/v1/internal/inquiries/" + inquiryId, {
  method: "PATCH",
  headers: {
    cookie: admin.cookie,
    "x-csrf-token": admin.csrf,
    "content-type": "application/json"
  },
  body: JSON.stringify({ status: "reviewing" })
});
ok(inquiryUpdated.response.status === 200, "admin actualiza inquiry con CSRF");

const locA = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES('RBAC A', 'HN', 'store', TRUE)
  RETURNING id`;
const locB = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES('RBAC B', 'HN', 'store', TRUE)
  RETURNING id`;
const locationA = Number(locA[0].id);
const locationB = Number(locB[0].id);

async function insertOrder(locationId: number, suffix: string) {
  const rows = await db`
    INSERT INTO orders(
      order_number, public_token, channel, status, currency,
      subtotal_minor, discount_total_minor, tax_total_minor,
      shipping_total_minor, grand_total_minor, location_id,
      idempotency_key, idempotency_hash
    )
    VALUES(
      ${"MR-RBAC-" + suffix + "-" + crypto.randomUUID().slice(0, 8)},
      ${crypto.randomUUID()}, 'STORE', 'PENDING_CONFIRMATION', 'HNL',
      10000, 0, 0, 0, 10000, ${locationId},
      ${"rbac-" + suffix + "-" + crypto.randomUUID()}, ${crypto.randomUUID()}
    )
    RETURNING id`;
  return Number(rows[0].id);
}

const orderAId = await insertOrder(locationA, "A");
const orderBId = await insertOrder(locationB, "B");

const cashierSecret = "C-" + crypto.randomUUID() + "-8y!";
const cashierHash = await Bun.password.hash(cashierSecret, { algorithm: "argon2id" });
const cashierRows = await db`
  INSERT INTO staff_users(
    email_normalized, display_name, password_hash, status, email_verified_at
  )
  VALUES(
    'rbac-cashier@example.test', 'RBAC Cashier CI',
    ${cashierHash}, 'ACTIVE', NOW()
  )
  RETURNING id`;
const cashierId = Number(cashierRows[0].id);
const cashierRole = await db`SELECT id FROM roles WHERE code = 'CASHIER' LIMIT 1`;
await db`
  INSERT INTO user_role_assignments(
    user_id, role_id, scope_type, scope_location_id
  )
  VALUES(
    ${cashierId}, ${Number(cashierRole[0].id)}, 'LOCATION', ${locationA}
  )`;

const cashier = await login("rbac-cashier@example.test", cashierSecret);
ok(cashier.response.status === 200, "cashier scoped inicia sesión");

const readA = await api("/v1/internal/orders/" + orderAId, {
  headers: { cookie: cashier.cookie }
});
ok(readA.response.status === 200, "scope LOCATION permite su Order");

const readB = await api("/v1/internal/orders/" + orderBId, {
  headers: { cookie: cashier.cookie }
});
ok(
  readB.response.status === 403 && readB.body.error === "forbidden",
  "scope LOCATION bloquea otra ubicación"
);

const confirmA = await api("/v1/internal/orders/" + orderAId + "/status", {
  method: "PATCH",
  headers: {
    cookie: cashier.cookie,
    "x-csrf-token": cashier.csrf,
    "content-type": "application/json"
  },
  body: JSON.stringify({ status: "CONFIRMED", reason: "rbac_ci" })
});
ok(confirmA.response.status === 200, "cashier usa orders.confirm en su ubicación");

const cancelA = await api("/v1/internal/orders/" + orderAId + "/status", {
  method: "PATCH",
  headers: {
    cookie: cashier.cookie,
    "x-csrf-token": cashier.csrf,
    "content-type": "application/json"
  },
  body: JSON.stringify({ status: "CANCELLED", reason: "rbac_ci" })
});
ok(
  cancelA.response.status === 403 && cancelA.body.error === "forbidden",
  "cashier sin orders.cancel no cancela"
);

const invalidMachineList = await api("/v1/internal/orders", {
  headers: { "x-internal-key": "invalid-ci-key" }
});
ok(
  invalidMachineList.response.status === 401,
  "credencial tecnica incorrecta no obtiene acceso"
);

const missingMachineList = await api("/v1/internal/orders");
ok(
  missingMachineList.response.status === 401,
  "solicitud interna sin credencial ni sesion se rechaza"
);

const machineList = await api("/v1/internal/orders", {
  headers: { "x-internal-key": serviceKey }
});
if (Bun.env.ALLOW_LEGACY_INTERNAL_TOKEN === "false") {
  ok(machineList.response.status === 401,
    "modo estricto rechaza credencial tecnica heredada");
} else {
  ok(machineList.response.status === 200, "credencial técnica sigue compatible");
}

const audits = await db`
  SELECT actor_type, actor_user_id, action, resource_id
  FROM audit_events
  WHERE action IN ('inquiry.updated','order.status_changed')
  ORDER BY id`;
ok(
  audits.some(
    (x: any) =>
      x.action === "inquiry.updated" &&
      x.actor_type === "USER" &&
      Number(x.actor_user_id) === Number(bootstrap.body.user.id)
  ),
  "inquiry audita StaffUser"
);
ok(
  audits.some(
    (x: any) =>
      x.action === "order.status_changed" &&
      x.actor_type === "USER" &&
      Number(x.actor_user_id) === cashierId &&
      String(x.resource_id) === String(orderAId)
  ),
  "Order audita StaffUser scoped"
);

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — internal RBAC/CSRF/location scope");
await db.close();
