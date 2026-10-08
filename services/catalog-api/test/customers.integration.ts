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

function staffHeaders(session: { cookie: string; csrf: string }, json = true) {
  const headers: Record<string,string> = {
    cookie: session.cookie,
    "x-csrf-token": session.csrf
  };
  if (json) headers["content-type"] = "application/json";
  return headers;
}

await db.unsafe(
  "TRUNCATE TABLE customer_duplicate_candidates, customer_tags, customer_preferences, customer_notes, customer_addresses, customer_contacts, customers RESTART IDENTITY CASCADE"
);
await db.unsafe(
  "TRUNCATE TABLE audit_events, staff_sessions, user_role_assignments, staff_users RESTART IDENTITY CASCADE"
);

const adminPassword = "CRM-" + crypto.randomUUID() + "-A9!";
const bootstrap = await api("/v1/security/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-key": serviceKey
  },
  body: JSON.stringify({
    email: "crm-admin@example.test",
    displayName: "CRM Admin CI",
    password: adminPassword
  })
});
ok(bootstrap.response.status === 201, "bootstrap crea ADMIN para CRM");

const admin = await login("crm-admin@example.test", adminPassword);
ok(admin.response.status === 200, "ADMIN inicia sesión");

const noAuth = await api("/v1/internal/customers");
ok(noAuth.response.status === 401, "búsqueda de clientes requiere autenticación");

const noCsrf = await api("/v1/internal/customers", {
  method: "POST",
  headers: {
    cookie: admin.cookie,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    displayName: "Sin CSRF",
    customerType: "PERSON"
  })
});
ok(
  noCsrf.response.status === 403 && noCsrf.body.error === "csrf_required",
  "alta humana de Customer exige CSRF"
);

const first = await api("/v1/internal/customers", {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    displayName: "María Cliente",
    customerType: "PERSON",
    preferredLanguage: "es-HN"
  })
});
ok(first.response.status === 201, "crea Customer PERSON");
const firstId = Number(first.body.customer?.id);

const second = await api("/v1/internal/customers", {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    displayName: "Familia Compartida",
    customerType: "PERSON"
  })
});
ok(second.response.status === 201, "crea segundo Customer");
const secondId = Number(second.body.customer?.id);

const business = await api("/v1/internal/customers", {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    displayName: "Empresa Cliente",
    customerType: "BUSINESS"
  })
});
ok(
  business.response.status === 201 &&
  business.body.customer?.customerType === "BUSINESS",
  "crea Customer BUSINESS"
);

const invalidType = await api("/v1/internal/customers", {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    displayName: "Tipo inválido",
    customerType: "UNKNOWN"
  })
});
ok(invalidType.response.status === 400, "rechaza customer_type inválido");

const contact1 = await api(`/v1/internal/customers/${firstId}/contacts`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    type: "WHATSAPP",
    value: "+504 9999-1111",
    label: "Principal",
    isPrimary: true
  })
});
ok(contact1.response.status === 201, "agrega contacto WhatsApp primario");

const contact2 = await api(`/v1/internal/customers/${secondId}/contacts`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    type: "WHATSAPP",
    value: "+504 9999-1111",
    label: "Teléfono familiar",
    isPrimary: true
  })
});
ok(
  contact2.response.status === 201,
  "contacto compartido no fuerza merge ni viola unicidad"
);

const email = await api(`/v1/internal/customers/${firstId}/contacts`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    type: "EMAIL",
    value: "Maria.Cliente@Example.COM",
    isPrimary: true
  })
});
ok(
  email.response.status === 201 &&
  email.body.contact?.normalizedValue === "maria.cliente@example.com",
  "email se normaliza para búsqueda"
);

const search = await api("/v1/internal/customers?q=99991111", {
  headers: { cookie: admin.cookie }
});
ok(
  search.response.status === 200 &&
  Array.isArray(search.body.data) &&
  search.body.data.filter((x: any) => [firstId, secondId].includes(Number(x.id))).length === 2,
  "búsqueda por contacto compartido devuelve candidatos sin auto-merge"
);

const address1 = await api(`/v1/internal/customers/${firstId}/addresses`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    label: "Casa",
    recipientName: "María Cliente",
    recipientPhone: "+504 9999-1111",
    countryCode: "HN",
    departmentOrState: "Cortés",
    municipalityOrCity: "San Pedro Sula",
    addressLine: "Barrio de prueba, bloque 1",
    reference: "Frente a punto de referencia",
    isDefaultShipping: true
  })
});
ok(address1.response.status === 201, "agrega dirección predeterminada");

const address2 = await api(`/v1/internal/customers/${firstId}/addresses`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    label: "Trabajo",
    recipientName: "María Cliente",
    countryCode: "HN",
    departmentOrState: "Cortés",
    municipalityOrCity: "San Pedro Sula",
    addressLine: "Zona de oficina",
    isDefaultShipping: true
  })
});
ok(address2.response.status === 201, "agrega segunda dirección y la hace predeterminada");

const detail = await api(`/v1/internal/customers/${firstId}`, {
  headers: { cookie: admin.cookie }
});
const defaults = (detail.body.customer?.addresses || []).filter(
  (x: any) => x.active && x.isDefaultShipping
);
ok(
  detail.response.status === 200 && defaults.length === 1 &&
  Number(defaults[0].id) === Number(address2.body.address?.id),
  "solo una dirección activa queda como default"
);

const note = await api(`/v1/internal/customers/${firstId}/notes`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    note: "Prefiere coordinar entrega por WhatsApp."
  })
});
ok(note.response.status === 201, "agrega nota interna");

const noteRow = await db`
  SELECT author_user_id, author_service, note
  FROM customer_notes
  WHERE id = ${Number(note.body.note?.id)}
  LIMIT 1`;
ok(
  Number(noteRow[0]?.author_user_id) === Number(bootstrap.body.user.id) &&
  noteRow[0]?.author_service == null,
  "nota queda atribuida al StaffUser"
);

const grant = await api(
  `/v1/internal/customers/${firstId}/preferences/WHATSAPP/MARKETING`,
  {
    method: "PUT",
    headers: staffHeaders(admin),
    body: JSON.stringify({
      status: "GRANTED",
      source: "STORE_CONFIRMATION",
      evidenceReference: "crm-ci-1"
    })
  }
);
ok(
  grant.response.status === 200 &&
  grant.body.preference?.status === "GRANTED",
  "registra preferencia GRANTED explícita"
);

const withdraw = await api(
  `/v1/internal/customers/${firstId}/preferences/WHATSAPP/MARKETING`,
  {
    method: "PUT",
    headers: staffHeaders(admin),
    body: JSON.stringify({
      status: "WITHDRAWN",
      source: "CUSTOMER_REQUEST"
    })
  }
);
ok(
  withdraw.response.status === 200 &&
  withdraw.body.preference?.status === "WITHDRAWN",
  "preferencia puede retirarse sin borrar historial de auditoría"
);

const supportPassword = "SUP-" + crypto.randomUUID() + "-B8!";
const supportHash = await Bun.password.hash(supportPassword, { algorithm: "argon2id" });
const supportRows = await db`
  INSERT INTO staff_users(
    email_normalized, display_name, password_hash, status, email_verified_at
  )
  VALUES(
    'crm-support@example.test', 'CRM Support CI',
    ${supportHash}, 'ACTIVE', NOW()
  )
  RETURNING id`;
const supportId = Number(supportRows[0].id);
const supportRole = await db`SELECT id FROM roles WHERE code = 'CUSTOMER_SUPPORT' LIMIT 1`;
await db`
  INSERT INTO user_role_assignments(
    user_id, role_id, scope_type, scope_location_id
  )
  VALUES(
    ${supportId}, ${Number(supportRole[0].id)}, 'GLOBAL', NULL
  )`;

const support = await login("crm-support@example.test", supportPassword);
ok(support.response.status === 200, "Customer Support inicia sesión");

const supportWrite = await api(`/v1/internal/customers/${firstId}`, {
  method: "PATCH",
  headers: staffHeaders(support),
  body: JSON.stringify({
    preferredLanguage: "es"
  })
});
ok(supportWrite.response.status === 200, "Customer Support puede editar Customer");

const supportMerge = await api(`/v1/internal/customers/${secondId}/merge`, {
  method: "POST",
  headers: staffHeaders(support),
  body: JSON.stringify({
    targetCustomerId: firstId,
    reason: "duplicate_test"
  })
});
ok(
  supportMerge.response.status === 403 &&
  supportMerge.body.error === "forbidden",
  "Customer Support no posee customers.merge"
);

const selfMerge = await api(`/v1/internal/customers/${firstId}/merge`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    targetCustomerId: firstId,
    reason: "invalid_self"
  })
});
ok(selfMerge.response.status === 400, "merge no permite source=target");

const merge = await api(`/v1/internal/customers/${secondId}/merge`, {
  method: "POST",
  headers: staffHeaders(admin),
  body: JSON.stringify({
    targetCustomerId: firstId,
    reason: "confirmed_duplicate"
  })
});
ok(
  merge.response.status === 200 &&
  merge.body.source?.status === "MERGED" &&
  Number(merge.body.source?.mergedIntoCustomerId) === firstId,
  "ADMIN ejecuta merge no destructivo hacia Customer canónico"
);

const mergedDb = await db`
  SELECT status, merged_into_customer_id
  FROM customers
  WHERE id = ${secondId}
  LIMIT 1`;
ok(
  mergedDb[0]?.status === "MERGED" &&
  Number(mergedDb[0]?.merged_into_customer_id) === firstId,
  "source permanece en DB como MERGED"
);

const audits = await db`
  SELECT action, actor_type, actor_user_id, metadata
  FROM audit_events
  WHERE action LIKE 'customer.%'
  ORDER BY id`;
ok(
  audits.some((x: any) => x.action === "customer.created") &&
  audits.some((x: any) => x.action === "customer.contact_added") &&
  audits.some((x: any) => x.action === "customer.address_added") &&
  audits.some((x: any) => x.action === "customer.note_added") &&
  audits.some((x: any) => x.action === "customer.preference_changed") &&
  audits.some((x: any) => x.action === "customer.merged"),
  "acciones CRM críticas producen auditoría"
);

const noteAudit = audits.find((x: any) => x.action === "customer.note_added");
ok(
  noteAudit && !JSON.stringify(noteAudit.metadata || {}).includes("Prefiere coordinar"),
  "auditoría no copia contenido de nota interna"
);

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — customer/CRM core");
await db.close();
