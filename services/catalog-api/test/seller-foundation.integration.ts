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

async function createStaff(email: string, displayName: string) {
  const password = "M11-" + crypto.randomUUID() + "-R9!";
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const users = await db`
    INSERT INTO staff_users(
      email_normalized, display_name, password_hash, status, email_verified_at
    )
    VALUES(${email}, ${displayName}, ${hash}, 'ACTIVE', NOW())
    RETURNING id`;
  const roles = await db`SELECT id FROM roles WHERE code='MANAGER' LIMIT 1`;
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(roles[0].id)},'GLOBAL',NULL)`;
  return {
    userId: Number(users[0].id),
    session: await login(email, password)
  };
}

async function createOrder(key: string, variantId: number, locationId: number) {
  return api("/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key
    },
    body: JSON.stringify({
      channel: "WEB",
      locationId,
      customer: { name: "Cliente M11", phone: "9999-1111" },
      items: [{ variantId, quantity: 1 }]
    })
  });
}

const loc = await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"M11 CI " + crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const locationId = Number(loc[0].id);

const product = await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Producto M11 CI',
    ${"m11-ci-" + crypto.randomUUID()},
    'Prueba','MR','active'
  )
  RETURNING id`;
const productId = Number(product[0].id);

const variants = await db`
  INSERT INTO product_variants(product_id,sku,size,color,cost,price,currency,active)
  VALUES
    (${productId},${"M11-OWN-" + crypto.randomUUID().slice(0,8)},'M','Negro',100.00,150.00,'HNL',TRUE),
    (${productId},${"M11-THIRD-" + crypto.randomUUID().slice(0,8)},'L','Azul',90.00,160.00,'HNL',TRUE),
    (${productId},${"M11-LEGACY-" + crypto.randomUUID().slice(0,8)},'S','Blanco',80.00,140.00,'HNL',TRUE)
  RETURNING id`;
const ownedVariantId = Number(variants[0].id);
const thirdVariantId = Number(variants[1].id);
const legacyVariantId = Number(variants[2].id);

await db`
  INSERT INTO inventory(variant_id,location_id,quantity,reserved)
  VALUES
    (${ownedVariantId},${locationId},5,0),
    (${thirdVariantId},${locationId},5,0),
    (${legacyVariantId},${locationId},5,0)`;

const manager1 = await createStaff(
  "m11-manager1-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "M11 Manager One"
);
const manager2 = await createStaff(
  "m11-manager2-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "M11 Manager Two"
);

ok(manager1.session.response.status === 200, "Manager 1 inicia sesión");
ok(manager2.session.response.status === 200, "Manager 2 inicia sesión");

const sellerCreate = await api("/v1/internal/sellers", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    legalName: "Seller M11 CI",
    displayName: "Seller CI",
    status: "ACTIVE",
    countryCode: "HN"
  })
});
ok(sellerCreate.response.status === 201, "crea SellerAccount separado de Supplier");
const sellerId = Number(sellerCreate.body.seller?.id);

const agreementCreate = await api("/v1/internal/sellers/" + sellerId + "/agreements", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    commercialMode: "COMMISSION",
    agreementVersion: 1,
    currency: "HNL",
    commissionBasis: "NET_SALES",
    commissionRateBps: 1500,
    settlementDelayDays: 7
  })
});
ok(agreementCreate.response.status === 201, "crea SellerAgreement DRAFT");
const agreementId = Number(agreementCreate.body.agreement?.id);

const selfApprove = await api("/v1/internal/seller-agreements/" + agreementId + "/approve", {
  method: "POST",
  headers: headers(manager1.session),
  body: "{}"
});
ok(
  selfApprove.response.status === 409 && selfApprove.body.error === "self_approval_forbidden",
  "creador no puede autoaprobar acuerdo"
);

const approve = await api("/v1/internal/seller-agreements/" + agreementId + "/approve", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(approve.response.status === 200, "segundo manager aprueba acuerdo");

const activate = await api("/v1/internal/seller-agreements/" + agreementId + "/activate", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(activate.response.status === 200, "acuerdo aprobado puede activarse");

const ownedSource = await api("/v1/internal/inventory-sources", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    variantId: ownedVariantId,
    locationId,
    sourceType: "PROCUREMENT",
    commercialMode: "OWNED",
    economicOwnerType: "MR"
  })
});
ok(ownedSource.response.status === 201, "crea InventorySource MR-owned");
ok(ownedSource.body.inventorySource?.sellerId == null, "MR-owned no tiene Seller");

const thirdSource = await api("/v1/internal/inventory-sources", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    variantId: thirdVariantId,
    locationId,
    sourceType: "CONSIGNMENT",
    commercialMode: "COMMISSION",
    economicOwnerType: "THIRD_PARTY",
    sellerId,
    sellerAgreementId: agreementId,
    costBasisMinor: 9000
  })
});
ok(thirdSource.response.status === 201, "crea InventorySource de tercero con Seller/Agreement");

const invalidThird = await api("/v1/internal/inventory-sources", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    variantId: legacyVariantId,
    locationId,
    sourceType: "THIRD_PARTY",
    commercialMode: "COMMISSION",
    economicOwnerType: "THIRD_PARTY"
  })
});
ok(
  invalidThird.response.status === 409 &&
  invalidThird.body.error === "third_party_requires_seller_agreement",
  "THIRD_PARTY exige Seller y Agreement"
);

const ownedOrder = await createOrder("m11-owned-order", ownedVariantId, locationId);
ok(ownedOrder.response.status === 201, "crea orden MR-owned");
const ownedOrderId = Number(ownedOrder.body.order?.id);

const thirdOrder = await createOrder("m11-third-order", thirdVariantId, locationId);
ok(thirdOrder.response.status === 201, "crea orden THIRD_PARTY");
const thirdOrderId = Number(thirdOrder.body.order?.id);

const legacyOrder = await createOrder("m11-legacy-order", legacyVariantId, locationId);
ok(legacyOrder.response.status === 201, "inventario legacy sin clasificación sigue vendible");
const legacyOrderId = Number(legacyOrder.body.order?.id);

const ownedSnapshot = await db`
  SELECT seller_id,seller_agreement_id,seller_agreement_version,commercial_mode,
         economic_owner_type,inventory_source_id,unit_cost_basis_minor,
         commission_basis,commission_rate_bps,fixed_fee_minor,commercial_snapshot_at
  FROM order_items WHERE order_id=${ownedOrderId} LIMIT 1`;
ok(ownedSnapshot[0]?.economic_owner_type === "MR", "orden propia snapshottea owner MR");
ok(ownedSnapshot[0]?.commercial_mode === "OWNED", "orden propia snapshottea modo OWNED");
ok(ownedSnapshot[0]?.seller_id == null, "orden propia no inventa seller");
ok(Number(ownedSnapshot[0]?.unit_cost_basis_minor) === 10000, "orden propia congela cost basis");

const thirdSnapshot = await db`
  SELECT seller_id,seller_agreement_id,seller_agreement_version,commercial_mode,
         economic_owner_type,inventory_source_id,unit_cost_basis_minor,
         commission_basis,commission_rate_bps,fixed_fee_minor,commercial_snapshot_at
  FROM order_items WHERE order_id=${thirdOrderId} LIMIT 1`;
ok(Number(thirdSnapshot[0]?.seller_id) === sellerId, "orden tercero conserva seller");
ok(Number(thirdSnapshot[0]?.seller_agreement_id) === agreementId, "orden tercero conserva agreement");
ok(Number(thirdSnapshot[0]?.seller_agreement_version) === 1, "orden tercero conserva versión de acuerdo");
ok(thirdSnapshot[0]?.commercial_mode === "COMMISSION", "orden tercero conserva modo COMMISSION");
ok(thirdSnapshot[0]?.economic_owner_type === "THIRD_PARTY", "orden tercero conserva owner THIRD_PARTY");
ok(Number(thirdSnapshot[0]?.commission_rate_bps) === 1500, "orden tercero congela comisión");
ok(Number(thirdSnapshot[0]?.unit_cost_basis_minor) === 9000, "orden tercero congela cost basis");

const legacySnapshot = await db`
  SELECT seller_id,seller_agreement_id,commercial_mode,economic_owner_type,inventory_source_id
  FROM order_items WHERE order_id=${legacyOrderId} LIMIT 1`;
ok(legacySnapshot[0]?.inventory_source_id == null, "legacy no inventa InventorySource");
ok(legacySnapshot[0]?.economic_owner_type == null, "legacy no inventa ownership");
ok(legacySnapshot[0]?.commercial_mode == null, "legacy no inventa commercial mode");

const agreementV2 = await api("/v1/internal/sellers/" + sellerId + "/agreements", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    commercialMode: "COMMISSION",
    agreementVersion: 2,
    currency: "HNL",
    commissionBasis: "NET_SALES",
    commissionRateBps: 2200,
    settlementDelayDays: 7
  })
});
ok(agreementV2.response.status === 201, "nueva versión de acuerdo puede coexistir");

const thirdHistorical = await db`
  SELECT seller_agreement_version,commission_rate_bps
  FROM order_items WHERE order_id=${thirdOrderId} LIMIT 1`;
ok(Number(thirdHistorical[0]?.seller_agreement_version) === 1, "snapshot histórico no cambia de versión");
ok(Number(thirdHistorical[0]?.commission_rate_bps) === 1500, "snapshot histórico no recalcula comisión");

const publicThird = JSON.stringify(thirdOrder.body.order || {});
ok(!publicThird.includes("commissionRate"), "respuesta pública no expone comisión");
ok(!publicThird.includes("sellerAgreement"), "respuesta pública no expone agreement");
ok(!publicThird.includes("unitCostBasis"), "respuesta pública no expone cost basis");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — M11 seller ownership foundation");
await db.close();
