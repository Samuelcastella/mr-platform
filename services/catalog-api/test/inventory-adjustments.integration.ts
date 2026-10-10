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

function headers(session: { cookie: string; csrf: string }, idempotencyKey?: string) {
  const out: Record<string,string> = {
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    "content-type": "application/json"
  };
  if (idempotencyKey) out["idempotency-key"] = idempotencyKey;
  return out;
}

async function createStaff(
  email: string,
  displayName: string,
  roleCode: string,
  scopeType: "GLOBAL" | "LOCATION" = "GLOBAL",
  scopeLocationId: number | null = null
) {
  const password = "M12-" + crypto.randomUUID() + "-R9!";
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const users = await db`
    INSERT INTO staff_users(
      email_normalized, display_name, password_hash, status, email_verified_at
    )
    VALUES(${email}, ${displayName}, ${hash}, 'ACTIVE', NOW())
    RETURNING id`;
  const role = await db`SELECT id FROM roles WHERE code = ${roleCode} LIMIT 1`;
  await db`
    INSERT INTO user_role_assignments(
      user_id, role_id, scope_type, scope_location_id
    )
    VALUES(
      ${Number(users[0].id)}, ${Number(role[0].id)},
      ${scopeType}, ${scopeLocationId}
    )`;
  return {
    userId: Number(users[0].id),
    password,
    session: await login(email, password)
  };
}

const loc = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES(${"M12 CI " + crypto.randomUUID().slice(0, 6)}, 'HN', 'store', TRUE)
  RETURNING id`;
const locationId = Number(loc[0].id);

const product = await db`
  INSERT INTO products(name, slug, category, brand, status)
  VALUES(
    'Producto M12 CI',
    ${"m12-ci-" + crypto.randomUUID()},
    'Prueba',
    'MR',
    'active'
  )
  RETURNING id`;
const productId = Number(product[0].id);

const variant = await db`
  INSERT INTO product_variants(
    product_id, sku, size, color, cost, price, currency, active
  )
  VALUES(
    ${productId},
    ${"M12-CI-" + crypto.randomUUID().slice(0, 8)},
    'M', 'Negro', 100.00, 150.00, 'HNL', TRUE
  )
  RETURNING id`;
const variantId = Number(variant[0].id);

await db`
  INSERT INTO inventory(variant_id, location_id, quantity, reserved)
  VALUES(${variantId}, ${locationId}, 10, 2)`;

const operator = await createStaff(
  "m12-operator-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "M12 Inventory Operator",
  "INVENTORY_OPERATOR",
  "LOCATION",
  locationId
);
const manager = await createStaff(
  "m12-manager-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "M12 Manager",
  "MANAGER"
);

ok(operator.session.response.status === 200, "Inventory Operator inicia sesión");
ok(manager.session.response.status === 200, "Manager inicia sesión");

const directStock = await api("/v1/internal/catalog/variants/" + variantId + "/stock", {
  method: "POST",
  headers: headers(manager.session),
  body: JSON.stringify({ quantity: 99 })
});
ok(
  directStock.response.status === 409 &&
  directStock.body.error === "governed_adjustment_required",
  "flag M12 bloquea ajuste directo de stock"
);

const created = await api("/v1/internal/inventory-adjustments", {
  method: "POST",
  headers: headers(operator.session),
  body: JSON.stringify({
    locationId,
    reasonCode: "COUNT_VARIANCE_NEGATIVE",
    reasonText: "Conteo físico CI",
    lines: [{ variantId, quantityDelta: -3, notes: "faltante CI" }]
  })
});
ok(created.response.status === 201, "crea solicitud M12");
ok(created.body.adjustment?.status === "DRAFT", "solicitud inicia DRAFT");
const adjustmentId = Number(created.body.adjustment?.id);

const submitted = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/submit", {
  method: "POST",
  headers: headers(operator.session),
  body: "{}"
});
ok(submitted.response.status === 200, "operador somete ajuste");
ok(submitted.body.adjustment?.status === "SUBMITTED", "ajuste queda SUBMITTED");

// Negative RBAC: location-scoped operator cannot approve, post, or cross locations.
const operatorApproveDenied = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/approve", {
  method: "POST", headers: headers(operator.session), body: "{}"
});
ok(operatorApproveDenied.response.status === 403 && operatorApproveDenied.body.error === "forbidden",
  "operador sin permiso no aprueba ajustes");
const operatorPostDenied = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/post", {
  method: "POST", headers: headers(operator.session, "m12-negative-post"), body: "{}"
});
ok(operatorPostDenied.response.status === 403 && operatorPostDenied.body.error === "forbidden",
  "operador sin permiso no contabiliza ajustes");
const locOther = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES(${"M12 OTHER " + crypto.randomUUID().slice(0, 6)}, 'HN', 'store', TRUE)
  RETURNING id`;
const otherLocationId = Number(locOther[0].id);
const crossLocationCreate = await api("/v1/internal/inventory-adjustments", {
  method: "POST", headers: headers(operator.session),
  body: JSON.stringify({ locationId: otherLocationId, reasonCode: "COUNT_VARIANCE_NEGATIVE",
    lines: [{ variantId, quantityDelta: -1 }] })
});
ok(crossLocationCreate.response.status === 403 && crossLocationCreate.body.error === "forbidden",
  "operador no crea ajuste en otra sucursal");
const crossLocationRead = await api("/v1/internal/inventory-adjustments?locationId=" + otherLocationId, {
  headers: { cookie: operator.session.cookie }
});
ok(crossLocationRead.response.status === 403 && crossLocationRead.body.error === "forbidden",
  "operador no lista ajustes de otra sucursal");
const missingCsrf = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/approve", {
  method: "POST", headers: { cookie: manager.session.cookie, "content-type": "application/json" }, body: "{}"
});
ok(missingCsrf.response.status === 403 && missingCsrf.body.error === "csrf_required",
  "aprobación sin CSRF es rechazada");

const approved = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/approve", {
  method: "POST",
  headers: headers(manager.session),
  body: "{}"
});
ok(approved.response.status === 200, "manager aprueba ajuste");
ok(approved.body.adjustment?.status === "APPROVED", "ajuste queda APPROVED");

const posted = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/post", {
  method: "POST",
  headers: headers(manager.session, "m12-post-001"),
  body: "{}"
});
ok(posted.response.status === 200, "manager postea ajuste");
ok(posted.body.adjustment?.status === "POSTED", "ajuste queda POSTED");
ok(posted.body.replayed === false, "primer post no es replay");

const inv = await db`
  SELECT quantity, reserved
  FROM inventory
  WHERE variant_id = ${variantId} AND location_id = ${locationId}`;
ok(Number(inv[0].quantity) === 7, "posting aplica delta exactamente una vez");
ok(Number(inv[0].reserved) === 2, "posting preserva reserved");

const movements = await db`
  SELECT movement_type, quantity, reference
  FROM inventory_movements
  WHERE reference = ${"inventory_adjustment:" + created.body.adjustment.requestNumber}
  ORDER BY id`;
ok(movements.length === 1, "posting crea un solo movimiento");
ok(movements[0]?.movement_type === "ADJUSTMENT", "movimiento usa ADJUSTMENT");
ok(Number(movements[0]?.quantity) === -3, "movimiento conserva delta");

const replay = await api("/v1/internal/inventory-adjustments/" + adjustmentId + "/post", {
  method: "POST",
  headers: headers(manager.session, "m12-post-001"),
  body: "{}"
});
ok(replay.response.status === 200 && replay.body.replayed === true, "retry idempotente devuelve replay");

const invReplay = await db`
  SELECT quantity, reserved
  FROM inventory
  WHERE variant_id = ${variantId} AND location_id = ${locationId}`;
ok(Number(invReplay[0].quantity) === 7, "retry no vuelve a modificar inventario");

const self = await api("/v1/internal/inventory-adjustments", {
  method: "POST",
  headers: headers(manager.session),
  body: JSON.stringify({
    locationId,
    reasonCode: "COUNT_VARIANCE_POSITIVE",
    lines: [{ variantId, quantityDelta: 1 }]
  })
});
const selfId = Number(self.body.adjustment?.id);
await api("/v1/internal/inventory-adjustments/" + selfId + "/submit", {
  method: "POST",
  headers: headers(manager.session),
  body: "{}"
});
const selfApprove = await api("/v1/internal/inventory-adjustments/" + selfId + "/approve", {
  method: "POST",
  headers: headers(manager.session),
  body: "{}"
});
ok(
  selfApprove.response.status === 409 && selfApprove.body.error === "self_approval_forbidden",
  "manager no puede autoaprobar su propia solicitud"
);

const theft = await api("/v1/internal/inventory-adjustments", {
  method: "POST",
  headers: headers(operator.session),
  body: JSON.stringify({
    locationId,
    reasonCode: "THEFT_CONFIRMED",
    reasonText: "CI evidencia requerida",
    lines: [{ variantId, quantityDelta: -1 }]
  })
});
const theftId = Number(theft.body.adjustment?.id);
await api("/v1/internal/inventory-adjustments/" + theftId + "/submit", {
  method: "POST",
  headers: headers(operator.session),
  body: "{}"
});
const noEvidence = await api("/v1/internal/inventory-adjustments/" + theftId + "/approve", {
  method: "POST",
  headers: headers(manager.session),
  body: "{}"
});
ok(
  noEvidence.response.status === 409 && noEvidence.body.error === "evidence_required",
  "motivo de robo exige evidencia"
);

const evidence = await api("/v1/internal/inventory-adjustments/" + theftId + "/evidence", {
  method: "POST",
  headers: headers(operator.session),
  body: JSON.stringify({
    evidenceType: "DOCUMENT",
    objectReference: "private://ci/m12/evidence-001",
    description: "Documento de prueba CI"
  })
});
ok(evidence.response.status === 201, "operador adjunta evidencia");

const theftApproved = await api("/v1/internal/inventory-adjustments/" + theftId + "/approve", {
  method: "POST",
  headers: headers(manager.session),
  body: "{}"
});
ok(theftApproved.response.status === 200, "evidencia habilita aprobación");
ok(theftApproved.body.adjustment?.status === "APPROVED", "robo queda APPROVED tras evidencia");

const protectedAdjustment = await api("/v1/internal/inventory-adjustments", {
  method: "POST",
  headers: headers(operator.session),
  body: JSON.stringify({
    locationId,
    reasonCode: "COUNT_VARIANCE_NEGATIVE",
    lines: [{ variantId, quantityDelta: -6 }]
  })
});
const protectedId = Number(protectedAdjustment.body.adjustment?.id);
await api("/v1/internal/inventory-adjustments/" + protectedId + "/submit", {
  method: "POST",
  headers: headers(operator.session),
  body: "{}"
});
await api("/v1/internal/inventory-adjustments/" + protectedId + "/approve", {
  method: "POST",
  headers: headers(manager.session),
  body: "{}"
});
const protectedPost = await api("/v1/internal/inventory-adjustments/" + protectedId + "/post", {
  method: "POST",
  headers: headers(manager.session, "m12-post-reserved"),
  body: "{}"
});
ok(
  protectedPost.response.status === 409 &&
  protectedPost.body.error === "reserved_exceeds_quantity",
  "posting no puede dejar quantity por debajo de reserved"
);

const finalInventory = await db`
  SELECT quantity, reserved
  FROM inventory
  WHERE variant_id = ${variantId} AND location_id = ${locationId}`;
ok(Number(finalInventory[0].quantity) === 7, "fallo de posting hace rollback completo");
ok(Number(finalInventory[0].reserved) === 2, "rollback preserva reservas");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — M12 inventory adjustments");
await db.close();
