import { SQL } from "bun";
import { permissionAllowed } from "../auth";

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
const internalKey = Bun.env.INTERNAL_API_TOKEN || "ci-internal-token";
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
  const raw = response.headers.get("set-cookie") || "";
  return raw.split(";")[0] || "";
}

await db.unsafe(
  "TRUNCATE TABLE audit_events, staff_sessions, user_role_assignments, staff_users RESTART IDENTITY CASCADE"
);

const unauthBootstrap = await api("/v1/security/bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "admin@example.com",
    displayName: "Admin CI",
    password: "CI-Strong-Password-2026"
  })
});
ok(unauthBootstrap.response.status === 401, "bootstrap requiere credencial técnica");

const bootstrap = await api("/v1/security/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-key": internalKey
  },
  body: JSON.stringify({
    email: "Admin@Example.com",
    displayName: "Admin CI",
    password: "CI-Strong-Password-2026"
  })
});
ok(bootstrap.response.status === 201, "bootstrap crea primer administrador");
ok(bootstrap.body.user?.email === "admin@example.com", "email se normaliza");

const stored = await db`
  SELECT id, password_hash, status
  FROM staff_users
  WHERE email_normalized = 'admin@example.com'
  LIMIT 1`;
ok(stored.length === 1 && stored[0].status === "ACTIVE", "StaffUser queda ACTIVE");
ok(
  String(stored[0].password_hash).startsWith("$argon2id$"),
  "password se almacena con Argon2id"
);
ok(
  !JSON.stringify(bootstrap.body).includes("password_hash") &&
  !JSON.stringify(bootstrap.body).includes("CI-Strong-Password-2026"),
  "bootstrap no expone password ni hash"
);

const secondBootstrap = await api("/v1/security/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-key": internalKey
  },
  body: JSON.stringify({
    email: "other@example.com",
    displayName: "Other",
    password: "Another-Strong-Password-2026"
  })
});
ok(
  secondBootstrap.response.status === 409 &&
  secondBootstrap.body.error === "bootstrap_already_completed",
  "bootstrap es de un solo uso"
);

const wrong = await api("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "admin@example.com",
    password: "wrong-password"
  })
});
ok(
  wrong.response.status === 401 && wrong.body.error === "invalid_credentials",
  "credencial incorrecta devuelve error genérico"
);

const login = await api("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "mr-ci-security" },
  body: JSON.stringify({
    email: "admin@example.com",
    password: "CI-Strong-Password-2026"
  })
});
const cookie = cookieFrom(login.response);
const csrf = String(login.body.csrfToken || "");
ok(login.response.status === 200, "login válido crea sesión");
ok(cookie.startsWith("mrstaff="), "login emite cookie de sesión opaca");
const setCookie = login.response.headers.get("set-cookie") || "";
ok(
  setCookie.includes("HttpOnly") &&
  setCookie.includes("SameSite=Strict") &&
  setCookie.includes("Secure"),
  "cookie aplica HttpOnly Secure SameSite=Strict"
);
ok(csrf.length > 20, "login entrega token CSRF separado");
ok(
  login.body.user?.roles?.some((r: any) => r.code === "ADMIN" && r.scopeType === "GLOBAL"),
  "bootstrap asigna ADMIN global"
);
ok(
  login.body.user?.permissions?.includes("users.manage") &&
  login.body.user?.permissions?.includes("inventory.adjust"),
  "ADMIN recibe permisos efectivos"
);

const me = await api("/v1/auth/me", {
  headers: { cookie }
});
ok(me.response.status === 200 && me.body.user?.displayName === "Admin CI", "/auth/me valida sesión");

const noCookie = await api("/v1/auth/me");
ok(noCookie.response.status === 401, "/auth/me rechaza petición sin sesión");

const noCsrf = await api("/v1/auth/logout", {
  method: "POST",
  headers: { cookie }
});
ok(noCsrf.response.status === 403 && noCsrf.body.error === "csrf_required", "mutación con cookie exige CSRF");

const logout = await api("/v1/auth/logout", {
  method: "POST",
  headers: {
    cookie,
    "x-csrf-token": csrf
  }
});
ok(logout.response.status === 200 && logout.body.ok === true, "logout revoca sesión");

const replay = await api("/v1/auth/me", {
  headers: { cookie }
});
ok(replay.response.status === 401, "sesión revocada no puede reutilizarse");

const login2 = await api("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "admin@example.com",
    password: "CI-Strong-Password-2026"
  })
});
const cookie2 = cookieFrom(login2.response);
ok(login2.response.status === 200, "usuario puede crear nueva sesión válida");

await db`
  UPDATE staff_users
  SET status = 'DISABLED', updated_at = NOW()
  WHERE email_normalized = 'admin@example.com'`;

const disabledMe = await api("/v1/auth/me", {
  headers: { cookie: cookie2 }
});
ok(disabledMe.response.status === 401, "usuario deshabilitado pierde sesión activa");

const sessionState = await db`
  SELECT status
  FROM staff_sessions
  WHERE user_id = ${Number(stored[0].id)}
  ORDER BY id DESC
  LIMIT 1`;
ok(sessionState[0]?.status === "REVOKED", "sesión de usuario deshabilitado se revoca server-side");

const roleSeed = await db`
  SELECT COUNT(*)::int AS role_count
  FROM roles
  WHERE code IN ('ADMIN','MANAGER','CASHIER','INVENTORY_OPERATOR','FULFILLMENT_OPERATOR','CUSTOMER_SUPPORT','ANALYST')`;
ok(Number(roleSeed[0]?.role_count) === 7, "roles iniciales están seedados");

const permissionSeed = await db`SELECT COUNT(*)::int AS permission_count FROM permissions`;
ok(Number(permissionSeed[0]?.permission_count) >= 20, "vocabulario de permisos está seedado");

// Regression: inventory operators must use governed adjustment requests,
// not the legacy direct-stock mutation permission.
const inventoryOperatorGrants = await db`
  SELECT rp.permission_code
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  WHERE r.code = 'INVENTORY_OPERATOR'`;
const inventoryOperatorPermissions = new Set(inventoryOperatorGrants.map((row: any) => String(row.permission_code)));
ok(!inventoryOperatorPermissions.has("inventory.adjust"),
  "INVENTORY_OPERATOR no tiene permiso de ajuste directo de existencias");
ok(inventoryOperatorPermissions.has("inventory_adjustments.create") &&
   inventoryOperatorPermissions.has("inventory_adjustments.submit"),
  "INVENTORY_OPERATOR conserva flujo supervisado de ajustes");
ok(!inventoryOperatorPermissions.has("inventory_adjustments.approve") &&
   !inventoryOperatorPermissions.has("inventory_adjustments.post"),
  "INVENTORY_OPERATOR no puede aprobar ni contabilizar ajustes");
const managerGrants = await db`
  SELECT rp.permission_code
  FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
  WHERE r.code = 'MANAGER'`;
const managerPermissions = new Set(managerGrants.map((row: any) => String(row.permission_code)));
ok(!managerPermissions.has("users.manage") && !managerPermissions.has("roles.manage"),
  "MANAGER no administra identidades ni asignaciones de roles");


ok(
  permissionAllowed(
    [{ permission: "inventory.adjust", scopeType: "LOCATION", locationId: 10 }],
    "inventory.adjust",
    10
  ),
  "permiso LOCATION autoriza su ubicación"
);
ok(
  !permissionAllowed(
    [{ permission: "inventory.adjust", scopeType: "LOCATION", locationId: 10 }],
    "inventory.adjust",
    11
  ),
  "permiso LOCATION no cruza a otra ubicación"
);
ok(
  permissionAllowed(
    [{ permission: "inventory.adjust", scopeType: "GLOBAL", locationId: null }],
    "inventory.adjust",
    11
  ),
  "permiso GLOBAL cubre ubicación"
);

const audits = await db`
  SELECT action, outcome
  FROM audit_events
  ORDER BY id`;
ok(
  audits.some((x: any) => x.action === "security.bootstrap_admin" && x.outcome === "SUCCESS"),
  "bootstrap produce auditoría"
);
ok(
  audits.some((x: any) => x.action === "security.login" && x.outcome === "FAILURE") &&
  audits.some((x: any) => x.action === "security.login" && x.outcome === "SUCCESS"),
  "login exitoso y fallido producen auditoría"
);
ok(
  audits.some((x: any) => x.action === "security.logout" && x.outcome === "SUCCESS"),
  "logout produce auditoría"
);

await db`
  UPDATE staff_users
  SET status = 'ACTIVE', updated_at = NOW()
  WHERE email_normalized = 'admin@example.com'`;

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — identity/RBAC/sessions");
await db.close();
