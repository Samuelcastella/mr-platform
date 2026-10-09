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
const serviceKey = Bun.env.INTERNAL_API_TOKEN || "ci-internal-token";
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

const internalHeaders = {
  "content-type": "application/json",
  "x-internal-key": serviceKey
};

await db.unsafe(
  "TRUNCATE TABLE vendor_sessions, vendor_invitations, vendor_users, product_images, inventory_movements, inventory, product_variants, products, suppliers, locations RESTART IDENTITY CASCADE"
);

const supplierOne = await api("/v1/internal/suppliers", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({
    name: "Boutique Aliada CI",
    countryCode: "HN",
    defaultCurrency: "HNL",
    email: "aliada@example.com"
  })
});
ok(supplierOne.response.status === 201, "crea proveedor aliado");
const supplierOneId = Number(supplierOne.body?.supplier?.id);
ok(supplierOneId > 0, "proveedor aliado recibe id");

const invite = await api("/v1/internal/vendor-invitations", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({
    supplierId: supplierOneId,
    email: "vendor1@example.com",
    expiresHours: 24
  })
});
ok(invite.response.status === 201, "crea invitación privada de proveedor");
const token = String(invite.body?.invitation?.token || "");
ok(token.length > 30, "invitación entrega token de un solo uso");

const inspect = await api("/v1/vendor/invitation?token=" + encodeURIComponent(token));
ok(inspect.response.status === 200 && inspect.body?.invitation?.valid === true, "proveedor puede validar invitación");

const accepted = await api("/v1/vendor/invitation/accept", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    token,
    email: "vendor1@example.com",
    displayName: "Proveedor Uno",
    password: "Vendor-Strong-Password-2026"
  })
});
ok(accepted.response.status === 201, "proveedor activa su cuenta");

const reused = await api("/v1/vendor/invitation/accept", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    token,
    email: "vendor1@example.com",
    displayName: "Proveedor Uno",
    password: "Vendor-Strong-Password-2026"
  })
});
ok(reused.response.status === 410, "invitación no puede reutilizarse");

const login = await api("/v1/vendor/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "vendor1@example.com",
    password: "Vendor-Strong-Password-2026"
  })
});
const vendorCookie = cookieFrom(login.response);
const vendorCsrf = String(login.body?.csrfToken || "");
ok(login.response.status === 200, "proveedor inicia sesión");
ok(vendorCookie.startsWith("mrvendor="), "portal emite cookie separada de StaffUser");
ok(vendorCsrf.length > 20, "portal emite CSRF");

const noCsrf = await api("/v1/vendor/catalog/products", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: vendorCookie
  },
  body: JSON.stringify({
    name: "Producto sin CSRF",
    sku: "VENDOR-NO-CSRF",
    price: 100
  })
});
ok(noCsrf.response.status === 403, "mutación de proveedor exige CSRF");

const product = await api("/v1/vendor/catalog/products", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: vendorCookie,
    "x-csrf-token": vendorCsrf
  },
  body: JSON.stringify({
    name: "Vestido Aliado CI",
    category: "Ropa",
    brand: "Boutique Aliada",
    sku: "ALIADA-CI-001",
    price: 950,
    cost: 450,
    stock: 4,
    size: "M",
    color: "Azul",
    imageUrl: "https://example.com/aliada-ci-001.jpg"
  })
});
ok(product.response.status === 201, "proveedor crea producto en borrador");
const productId = Number(product.body?.product?.id);
ok(product.body?.product?.review_status === "DRAFT", "producto externo nace en DRAFT");

const hidden = await api("/v1/products?status=active");
ok(
  !Array.isArray(hidden.body?.data) || !hidden.body.data.some((p: any) => Number(p.id) === productId),
  "producto externo no aparece público antes de aprobación"
);

const submit = await api("/v1/vendor/catalog/products/" + productId + "/submit", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: vendorCookie,
    "x-csrf-token": vendorCsrf
  },
  body: "{}"
});
ok(submit.response.status === 200, "proveedor envía producto a revisión");
ok(submit.body?.product?.review_status === "SUBMITTED", "revisión queda SUBMITTED");

const reviewQueue = await api("/v1/internal/vendor-products?status=SUBMITTED", {
  headers: { "x-internal-key": serviceKey }
});
ok(
  reviewQueue.response.status === 200 &&
  reviewQueue.body?.data?.some((p: any) => Number(p.id) === productId),
  "Control Center recibe producto enviado"
);
const queuedProduct = reviewQueue.body?.data?.find((p: any) => Number(p.id) === productId);
ok(queuedProduct?.commercialModel == null, "producto proveedor llega sin commercialModel inferido");
ok(queuedProduct?.defaultCondition == null, "producto proveedor llega sin condición inferida");

const approvalWithoutClassification = await api("/v1/internal/vendor-products/" + productId + "/review", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({ decision: "APPROVE", note: "Intento sin clasificación" })
});
ok(
  approvalWithoutClassification.response.status === 409 &&
  approvalWithoutClassification.body?.error === "classification_required",
  "aprobación exige clasificación explícita del staff"
);

const approved = await api("/v1/internal/vendor-products/" + productId + "/review", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({
    decision: "APPROVE",
    note: "Aprobado por CI",
    commercialModel: "curated",
    defaultCondition: "new"
  })
});
ok(approved.response.status === 200, "administrador clasifica y aprueba producto externo");
ok(
  approved.body?.product?.review_status === "APPROVED" &&
  approved.body?.product?.status === "active",
  "aprobación publica producto"
);
ok(
  approved.body?.product?.commercial_model === "curated" &&
  approved.body?.product?.default_condition === "new",
  "aprobación persiste clasificación del revisor"
);

const visible = await api("/v1/products?status=active");
const publicProduct = Array.isArray(visible.body?.data)
  ? visible.body.data.find((p: any) => Number(p.id) === productId)
  : null;
ok(Boolean(publicProduct), "producto aprobado llega al catálogo público");
ok(Number(publicProduct?.stock) === 4, "stock del proveedor llega al catálogo");

const vendorLocation = await db`
  SELECT supplier_id, type
  FROM locations
  WHERE supplier_id = ${supplierOneId}
  LIMIT 1`;
ok(
  vendorLocation.length === 1 &&
  Number(vendorLocation[0].supplier_id) === supplierOneId &&
  vendorLocation[0].type === "vendor",
  "inventario externo queda aislado en ubicación del proveedor"
);

const supplierTwo = await api("/v1/internal/suppliers", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({
    name: "Segunda Boutique CI",
    countryCode: "HN",
    defaultCurrency: "HNL"
  })
});
const supplierTwoId = Number(supplierTwo.body?.supplier?.id);
const inviteTwo = await api("/v1/internal/vendor-invitations", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({
    supplierId: supplierTwoId,
    email: "vendor2@example.com"
  })
});
const tokenTwo = String(inviteTwo.body?.invitation?.token || "");
await api("/v1/vendor/invitation/accept", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    token: tokenTwo,
    email: "vendor2@example.com",
    displayName: "Proveedor Dos",
    password: "Vendor-Two-Password-2026"
  })
});
const loginTwo = await api("/v1/vendor/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "vendor2@example.com",
    password: "Vendor-Two-Password-2026"
  })
});
const catalogTwo = await api("/v1/vendor/catalog", {
  headers: { cookie: cookieFrom(loginTwo.response) }
});
ok(
  catalogTwo.response.status === 200 &&
  !catalogTwo.body?.data?.some((p: any) => Number(p.id) === productId),
  "un proveedor no puede ver el catálogo privado de otro"
);

await db.end();

if (failures) {
  console.error("\nVendor portal integration failures:", failures);
  process.exit(1);
}
console.log("\nVendor portal integration OK");
