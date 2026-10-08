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

function staffHeaders(
  session: { cookie: string; csrf: string },
  idempotencyKey?: string
) {
  const headers: Record<string,string> = {
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    "content-type": "application/json"
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return headers;
}

async function createStaff(
  email: string,
  displayName: string,
  roleCode: string,
  scopeType: "GLOBAL" | "LOCATION" = "GLOBAL",
  scopeLocationId: number | null = null
) {
  const password = "PROC-" + crypto.randomUUID() + "-Q9!";
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

await db.unsafe(
  "TRUNCATE TABLE goods_receipt_items, goods_receipts, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE"
);

const locationRows = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES
    (${"Procurement Main " + crypto.randomUUID().slice(0, 6)}, 'HN', 'store', TRUE),
    (${"Procurement Other " + crypto.randomUUID().slice(0, 6)}, 'HN', 'warehouse', TRUE)
  RETURNING id`;
const locationId = Number(locationRows[0].id);
const otherLocationId = Number(locationRows[1].id);

const productRows = await db`
  INSERT INTO products(name, slug, category, brand, status)
  VALUES(
    'Producto Procurement CI',
    ${"procurement-ci-" + crypto.randomUUID()},
    'Prueba',
    'MR',
    'active'
  )
  RETURNING id`;
const productId = Number(productRows[0].id);

const variantRows = await db`
  INSERT INTO product_variants(
    product_id, sku, size, color, cost, price, currency, active
  )
  VALUES
    (
      ${productId},
      ${"PROC-CI-A-" + crypto.randomUUID().slice(0, 8)},
      'M', 'Negro', 0, 500.00, 'HNL', TRUE
    ),
    (
      ${productId},
      ${"PROC-CI-B-" + crypto.randomUUID().slice(0, 8)},
      'L', 'Azul', 0, 650.00, 'HNL', TRUE
    )
  RETURNING id, sku`;
const variantA = Number(variantRows[0].id);
const variantB = Number(variantRows[1].id);

const manager = await createStaff(
  "proc-manager-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Procurement Manager CI",
  "MANAGER"
);
ok(manager.session.response.status === 200, "MANAGER inicia sesión");

const receiver = await createStaff(
  "proc-receiver-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Procurement Receiver CI",
  "INVENTORY_OPERATOR",
  "LOCATION",
  locationId
);
ok(receiver.session.response.status === 200, "Inventory Operator scoped inicia sesión");

const wrongReceiver = await createStaff(
  "proc-wrong-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Procurement Wrong Location CI",
  "INVENTORY_OPERATOR",
  "LOCATION",
  otherLocationId
);
ok(wrongReceiver.session.response.status === 200, "segundo operador scoped inicia sesión");

const supplierHN = await api("/v1/internal/suppliers", {
  method: "POST",
  headers: staffHeaders(manager.session),
  body: JSON.stringify({
    name: "Proveedor Honduras CI",
    countryCode: "HN",
    defaultCurrency: "HNL",
    leadTimeDays: 3
  })
});
ok(
  supplierHN.response.status === 201 &&
  supplierHN.body.supplier?.countryCode === "HN",
  "crea proveedor de Honduras"
);
const supplierId = Number(supplierHN.body.supplier?.id);

const supplierUS = await api("/v1/internal/suppliers", {
  method: "POST",
  headers: staffHeaders(manager.session),
  body: JSON.stringify({
    name: "Proveedor Internacional CI",
    countryCode: "US",
    defaultCurrency: "USD",
    leadTimeDays: 12
  })
});
ok(
  supplierUS.response.status === 201 &&
  supplierUS.body.supplier?.countryCode === "US",
  "proveedor puede pertenecer a otro país"
);
const inactiveSupplierId = Number(supplierUS.body.supplier?.id);

const deactivate = await api("/v1/internal/suppliers/" + inactiveSupplierId, {
  method: "PATCH",
  headers: staffHeaders(manager.session),
  body: JSON.stringify({ active: false })
});
ok(
  deactivate.response.status === 200 &&
  deactivate.body.supplier?.active === false,
  "proveedor puede desactivarse"
);

const poBody = {
  supplierId,
  destinationLocationId: locationId,
  currency: "HNL",
  supplierReference: "SUP-CI-PO",
  shippingEstimateMinor: 1500,
  taxEstimateMinor: 2500,
  otherCostsMinor: 500,
  grandTotalMinor: 1,
  items: [
    {
      variantId: variantA,
      quantityOrdered: 10,
      unitCostMinor: 10000,
      supplierSku: "SUP-A",
      originCountryCode: "VN"
    },
    {
      variantId: variantB,
      quantityOrdered: 4,
      unitCostMinor: 20000,
      supplierSku: "SUP-B",
      originCountryCode: "CN"
    }
  ]
};

const createKey = "proc-po-" + crypto.randomUUID();
const poCreated = await api("/v1/internal/procurement/purchase-orders", {
  method: "POST",
  headers: staffHeaders(manager.session, createKey),
  body: JSON.stringify(poBody)
});
ok(poCreated.response.status === 201, "MANAGER crea Purchase Order");
const po = poCreated.body.purchaseOrder;
const poId = Number(po?.id);
ok(po?.status === "DRAFT", "PO inicia DRAFT");
ok(
  po?.subtotalMinor === 180000 &&
  po?.grandTotalMinor === 184500,
  "totales de PO se calculan server-side e ignoran grandTotal del cliente"
);
ok(
  po?.items?.find((x: any) => Number(x.variantId) === variantA)?.originCountryCode === "VN",
  "país de origen del artículo es independiente del país del proveedor"
);

const poReplay = await api("/v1/internal/procurement/purchase-orders", {
  method: "POST",
  headers: staffHeaders(manager.session, createKey),
  body: JSON.stringify(poBody)
});
ok(
  poReplay.response.status === 200 &&
  poReplay.body.replayed === true &&
  Number(poReplay.body.purchaseOrder?.id) === poId,
  "retry de PO es idempotente"
);

const poConflict = await api("/v1/internal/procurement/purchase-orders", {
  method: "POST",
  headers: staffHeaders(manager.session, createKey),
  body: JSON.stringify({
    ...poBody,
    shippingEstimateMinor: 9999
  })
});
ok(
  poConflict.response.status === 409 &&
  poConflict.body.error === "idempotency_conflict",
  "misma clave con payload distinto entra en conflicto"
);

const inactivePo = await api("/v1/internal/procurement/purchase-orders", {
  method: "POST",
  headers: staffHeaders(manager.session, "proc-inactive-" + crypto.randomUUID()),
  body: JSON.stringify({
    ...poBody,
    supplierId: inactiveSupplierId
  })
});
ok(
  inactivePo.response.status === 409 &&
  inactivePo.body.error === "supplier_inactive",
  "no crea PO para proveedor inactivo"
);

const receiverApprove = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/approve`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session),
    body: "{}"
  }
);
ok(
  receiverApprove.response.status === 403 &&
  receiverApprove.body.error === "forbidden",
  "Inventory Operator no puede aprobar PO"
);

const approved = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/approve`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: "{}"
  }
);
ok(
  approved.response.status === 200 &&
  approved.body.purchaseOrder?.status === "APPROVED",
  "MANAGER aprueba PO"
);

const ordered = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/order`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: "{}"
  }
);
ok(
  ordered.response.status === 200 &&
  ordered.body.purchaseOrder?.status === "ORDERED",
  "PO aprobada pasa a ORDERED"
);

const itemAId = Number(
  ordered.body.purchaseOrder?.items?.find(
    (x: any) => Number(x.variantId) === variantA
  )?.id
);
const itemBId = Number(
  ordered.body.purchaseOrder?.items?.find(
    (x: any) => Number(x.variantId) === variantB
  )?.id
);

const wrongScopeReceipt = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/receipts`,
  {
    method: "POST",
    headers: staffHeaders(
      wrongReceiver.session,
      "proc-wrong-scope-" + crypto.randomUUID()
    ),
    body: JSON.stringify({
      items: [{ purchaseOrderItemId: itemAId, quantityReceived: 1 }]
    })
  }
);
ok(
  wrongScopeReceipt.response.status === 403 &&
  wrongScopeReceipt.body.error === "forbidden",
  "LOCATION scope impide recibir inventario en otra ubicación"
);

const receiptKey = "proc-gr-" + crypto.randomUUID();
const partial = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/receipts`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, receiptKey),
    body: JSON.stringify({
      supplierDeliveryReference: "DELIVERY-1",
      items: [
        { purchaseOrderItemId: itemAId, quantityReceived: 6 },
        { purchaseOrderItemId: itemBId, quantityReceived: 2 }
      ]
    })
  }
);
ok(partial.response.status === 201, "operador recibe mercancía parcialmente");
ok(
  partial.body.purchaseOrder?.status === "PARTIALLY_RECEIVED",
  "recepción parcial cambia PO a PARTIALLY_RECEIVED"
);

const invAfterPartial = await db`
  SELECT variant_id, quantity, reserved
  FROM inventory
  WHERE location_id = ${locationId}
    AND variant_id IN (${variantA}, ${variantB})
  ORDER BY variant_id`;
const qtyA = Number(
  invAfterPartial.find((x: any) => Number(x.variant_id) === variantA)?.quantity || 0
);
const qtyB = Number(
  invAfterPartial.find((x: any) => Number(x.variant_id) === variantB)?.quantity || 0
);
ok(qtyA === 6 && qtyB === 2, "recepción incrementa inventario por cantidades exactas");
ok(
  invAfterPartial.every((x: any) => Number(x.reserved) === 0),
  "recepción preserva reserved sin violar invariant"
);

const movementsPartial = await db`
  SELECT variant_id, movement_type, quantity, reference
  FROM inventory_movements
  WHERE reference = ${"goods_receipt:" + partial.body.goodsReceipt?.receiptNumber}
  ORDER BY variant_id`;
ok(
  movementsPartial.length === 2 &&
  movementsPartial.every((x: any) => x.movement_type === "PURCHASE_RECEIPT"),
  "cada línea recibida crea movimiento PURCHASE_RECEIPT"
);

const replayReceipt = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/receipts`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, receiptKey),
    body: JSON.stringify({
      supplierDeliveryReference: "DELIVERY-1",
      items: [
        { purchaseOrderItemId: itemAId, quantityReceived: 6 },
        { purchaseOrderItemId: itemBId, quantityReceived: 2 }
      ]
    })
  }
);
ok(
  replayReceipt.response.status === 200 &&
  replayReceipt.body.replayed === true,
  "retry de GoodsReceipt devuelve receipt existente"
);

const invAfterReplay = await db`
  SELECT variant_id, quantity
  FROM inventory
  WHERE location_id = ${locationId}
    AND variant_id IN (${variantA}, ${variantB})
  ORDER BY variant_id`;
ok(
  Number(invAfterReplay.find((x: any) => Number(x.variant_id) === variantA)?.quantity) === 6 &&
  Number(invAfterReplay.find((x: any) => Number(x.variant_id) === variantB)?.quantity) === 2,
  "retry idempotente no duplica inventario"
);

const movementCount = await db`
  SELECT COUNT(*)::int AS count
  FROM inventory_movements
  WHERE reference = ${"goods_receipt:" + partial.body.goodsReceipt?.receiptNumber}`;
ok(
  Number(movementCount[0]?.count) === 2,
  "retry idempotente no duplica movimientos"
);

const receiptConflict = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/receipts`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, receiptKey),
    body: JSON.stringify({
      supplierDeliveryReference: "DELIVERY-1",
      items: [{ purchaseOrderItemId: itemAId, quantityReceived: 1 }]
    })
  }
);
ok(
  receiptConflict.response.status === 409 &&
  receiptConflict.body.error === "idempotency_conflict",
  "GoodsReceipt detecta conflicto de clave idempotente"
);

const overReceipt = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/receipts`,
  {
    method: "POST",
    headers: staffHeaders(
      receiver.session,
      "proc-over-" + crypto.randomUUID()
    ),
    body: JSON.stringify({
      items: [{ purchaseOrderItemId: itemAId, quantityReceived: 5 }]
    })
  }
);
ok(
  overReceipt.response.status === 409 &&
  overReceipt.body.error === "over_receipt" &&
  Number(overReceipt.body.remaining) === 4,
  "sobre-recepción se rechaza antes de tocar inventario"
);

const cancelPartial = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/cancel`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: "{}"
  }
);
ok(
  cancelPartial.response.status === 409 &&
  cancelPartial.body.error === "invalid_transition",
  "PO parcialmente recibida no puede cancelarse"
);

const complete = await api(
  `/v1/internal/procurement/purchase-orders/${poId}/receipts`,
  {
    method: "POST",
    headers: staffHeaders(
      receiver.session,
      "proc-complete-" + crypto.randomUUID()
    ),
    body: JSON.stringify({
      supplierDeliveryReference: "DELIVERY-2",
      items: [
        { purchaseOrderItemId: itemAId, quantityReceived: 4 },
        { purchaseOrderItemId: itemBId, quantityReceived: 2 }
      ]
    })
  }
);
ok(
  complete.response.status === 201 &&
  complete.body.purchaseOrder?.status === "RECEIVED",
  "segunda recepción completa PO"
);

const finalInventory = await db`
  SELECT variant_id, quantity
  FROM inventory
  WHERE location_id = ${locationId}
    AND variant_id IN (${variantA}, ${variantB})
  ORDER BY variant_id`;
ok(
  Number(finalInventory.find((x: any) => Number(x.variant_id) === variantA)?.quantity) === 10 &&
  Number(finalInventory.find((x: any) => Number(x.variant_id) === variantB)?.quantity) === 4,
  "inventario final coincide exactamente con cantidades ordenadas"
);

const audits = await db`
  SELECT action, actor_type, actor_user_id, resource_type
  FROM audit_events
  WHERE action IN (
    'supplier.created',
    'supplier.updated',
    'purchase_order.created',
    'purchase_order.approved',
    'purchase_order.ordered',
    'goods_receipt.posted'
  )
  ORDER BY id`;
ok(
  audits.some((x: any) => x.action === "purchase_order.created") &&
  audits.some((x: any) => x.action === "purchase_order.approved") &&
  audits.filter((x: any) => x.action === "goods_receipt.posted").length === 2,
  "procurement crítico produce auditoría"
);
ok(
  audits
    .filter((x: any) => x.action === "goods_receipt.posted")
    .every((x: any) => Number(x.actor_user_id) === receiver.userId),
  "recepciones quedan atribuidas al Inventory Operator"
);

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — suppliers/procurement/goods receipts");
await db.close();
