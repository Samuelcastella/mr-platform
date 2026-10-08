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
  max: 4
});

const apiBase = Bun.env.API_BASE_URL || "http://127.0.0.1:3011";
const centerBase = "http://127.0.0.1:3022";
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

async function jsonApi(path: string, options: RequestInit = {}) {
  const response = await fetch(apiBase + path, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function setCookieValues(response: Response) {
  const headers: any = response.headers;
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function cookieHeaderFrom(response: Response) {
  return setCookieValues(response)
    .map((value: string) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function cookieValue(header: string, name: string) {
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

await db.unsafe(
  "TRUNCATE TABLE audit_events, staff_sessions, user_role_assignments, staff_users RESTART IDENTITY CASCADE"
);

const adminSecret = "CC-" + crypto.randomUUID() + "-9z!";
const bootstrap = await jsonApi("/v1/security/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-key": serviceKey
  },
  body: JSON.stringify({
    email: "control-center-ci@example.test",
    displayName: "Control Center CI",
    password: adminSecret
  })
});
ok(bootstrap.response.status === 201, "crea StaffUser para Control Center");

const inquiry = await db`
  INSERT INTO public_inquiries(
    kind, name, contact, message, status, public_token
  )
  VALUES(
    'product_request', 'Cliente Control CI', '5555-1010',
    'Necesito producto de prueba', 'new', ${crypto.randomUUID()}
  )
  RETURNING id`;
const inquiryId = Number(inquiry[0].id);

const child = Bun.spawn({
  cmd: ["bun", "run", "services/control-center/index.ts"],
  env: {
    ...Bun.env,
    PORT: "3022",
    CATALOG_API_URL: apiBase,
    CONTROL_CENTER_PASSWORD: "",
    CONTROL_CENTER_SESSION_SECRET: ""
  },
  stdout: "pipe",
  stderr: "pipe"
});

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(centerBase + "/ready");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(250);
  }
  ok(ready, "Control Center inicia usando Commerce Core sin contraseña compartida");

  const loginPage = await fetch(centerBase + "/login");
  const loginHtml = await loginPage.text();
  ok(
    loginPage.status === 200 &&
    loginHtml.includes('name="email"') &&
    loginHtml.includes("StaffUser"),
    "pantalla de acceso solicita identidad individual"
  );

  const loginResponse = await fetch(centerBase + "/login", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: "control-center-ci@example.test",
      password: adminSecret
    }).toString()
  });
  const cookies = cookieHeaderFrom(loginResponse);
  const csrf = cookieValue(cookies, "mrcc_csrf");
  ok(loginResponse.status === 303, "login del Control Center autentica contra Catalog API");
  ok(
    cookies.includes("mrstaff=") && Boolean(csrf),
    "Control Center establece sesión StaffUser y CSRF"
  );

  const dashboard = await fetch(centerBase + "/", {
    headers: { cookie: cookies }
  });
  const dashboardHtml = await dashboard.text();
  ok(
    dashboard.status === 200 &&
    dashboardHtml.includes("Control Center CI") &&
    dashboardHtml.includes("Cliente Control CI"),
    "dashboard consume datos autorizados del Commerce Core"
  );

  const invalidUpdate = await fetch(centerBase + "/inquiries/" + inquiryId + "/update", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      csrf: "invalid",
      status: "reviewing",
      priority: "2"
    }).toString()
  });
  ok(invalidUpdate.status === 403, "BFF rechaza formulario con CSRF inválido");

  const update = await fetch(centerBase + "/inquiries/" + inquiryId + "/update", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      csrf,
      status: "qualified",
      priority: "2",
      assigned_to: "Equipo CI",
      internal_notes: "Validado por integración"
    }).toString()
  });
  ok(update.status === 303, "mutación autorizada se procesa por API");

  const updated = await db`
    SELECT status, priority, assigned_to, internal_notes
    FROM public_inquiries
    WHERE id = ${inquiryId}`;
  ok(
    updated[0]?.status === "qualified" &&
    Number(updated[0]?.priority) === 2 &&
    updated[0]?.assigned_to === "Equipo CI",
    "API persiste campos operativos del Control Center"
  );

  const opportunity = await fetch(
    centerBase + "/inquiries/" + inquiryId + "/opportunity",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: cookies,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ csrf }).toString()
    }
  );
  ok(opportunity.status === 303, "StaffUser puede crear oportunidad con permiso");

  const opportunityRows = await db`
    SELECT inquiry_id, owner, status
    FROM sourcing_opportunities
    WHERE inquiry_id = ${inquiryId}`;
  ok(
    opportunityRows.length === 1 &&
    String(opportunityRows[0].owner).startsWith("staff:"),
    "oportunidad registra actor StaffUser"
  );

  const auditRows = await db`
    SELECT actor_type, actor_user_id, action
    FROM audit_events
    WHERE action IN ('inquiry.updated','inquiry.opportunity_created')
    ORDER BY id`;
  ok(
    auditRows.length >= 2 &&
    auditRows.every((row: any) => row.actor_type === "USER"),
    "acciones del panel quedan auditadas como usuario humano"
  );

  const logout = await fetch(centerBase + "/logout", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ csrf }).toString()
  });
  ok(logout.status === 303, "logout revoca sesión mediante Commerce Core");

  const afterLogout = await fetch(centerBase + "/", {
    headers: { cookie: cookies }
  });
  ok(afterLogout.status === 401, "sesión revocada ya no abre Control Center");
} finally {
  child.kill();
  await child.exited;
  await db.close();
}

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — Control Center StaffUser/BFF");
