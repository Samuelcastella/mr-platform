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
  const password = "RET-" + crypto.randomUUID() + "-R9!";
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

const locations = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES
    (${"Returns Main " + crypto.randomUUID().slice(0, 6)}, 'HN', 'store', TRUE),
    (${"Returns Other " + crypto.randomUUID().slice(0, 6)}, 'HN', 'warehouse', TRUE)
  RETURNING id`;
const locationId = Number(locations[0].id);
const otherLocationId = Number(locations[1].id);

const product = await db`
  INSERT INTO products(name, slug, category, brand, status)
  VALUES(
    'Producto Return CI',
    ${"return-ci-" + crypto.randomUUID()},
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
    ${"RET-CI-" + crypto.randomUUID().slice(0, 8)},
    'M', 'Negro', 100.00, 150.00, 'HNL', TRUE
  )
  RETURNING id, sku`;
const variantId = Number(variant[0].id);
const sku = String(variant[0].sku);

async function insertOrder(status: string, quantity: number) {
  const orders = await db`
    INSERT INTO orders(
      order_number, public_token, channel, status, currency,
      subtotal_minor, discount_total_minor, tax_total_minor,
      shipping_total_minor, grand_total_minor, location_id,
      customer_name, customer_phone, idempotency_key, idempotency_hash
    )
    VALUES(
      ${"MR-RET-CI-" + crypto.randomUUID().slice(0, 8)},
      ${crypto.randomUUID()}, 'STORE', ${status}, 'HNL',
      ${quantity * 15000}, 0, 0, 0, ${quantity * 15000},
      ${locationId}, 'Cliente Return CI', '5555-2020',
      ${"return-order-" + crypto.randomUUID()}, ${crypto.randomUUID()}
    )
    RETURNING id`;
  const orderId = Number(orders[0].id);

  const items = await db`
    INSERT INTO order_items(
      order_id, variant_id, sku_snapshot, product_name_snapshot,
      variant_snapshot, quantity, unit_price_minor, currency, line_total_minor
    )
    VALUES(
      ${orderId}, ${variantId}, ${sku}, 'Producto Return CI',
      ${JSON.stringify({ size: "M", color: "Negro" })}::jsonb,
      ${quantity}, 15000, 'HNL', ${quantity * 15000}
    )
    RETURNING id`;

  return { orderId, orderItemId: Number(items[0].id) };
}

const eligible = await insertOrder("COMPLETED", 3);
const ineligible = await insertOrder("CONFIRMED", 1);

const checkout = await db`
  INSERT INTO checkout_sessions(
    public_token, order_id, status, payment_method,
    currency, amount_minor, idempotency_key, idempotency_hash
  )
  VALUES(
    ${crypto.randomUUID()}, ${eligible.orderId}, 'COMPLETED', 'CASH',
    'HNL', 45000, ${"ret-checkout-" + crypto.randomUUID()}, ${crypto.randomUUID()}
  )
  RETURNING id`;
const checkoutId = Number(checkout[0].id);

const payment = await db`
  INSERT INTO payments(
    checkout_session_id, order_id, provider, method, status,
    amount_minor, currency, external_reference
  )
  VALUES(
    ${checkoutId}, ${eligible.orderId}, 'OFFLINE', 'CASH', 'PAID',
    45000, 'HNL', 'RETURN-CI-PAID'
  )
  RETURNING id`;
const paymentId = Number(payment[0].id);

const manager = await createStaff(
  "ret-manager-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Returns Manager CI",
  "MANAGER"
);
const support = await createStaff(
  "ret-support-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Returns Support CI",
  "CUSTOMER_SUPPORT"
);
const receiver = await createStaff(
  "ret-receiver-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Returns Inventory CI",
  "INVENTORY_OPERATOR",
  "LOCATION",
  locationId
);
const wrongReceiver = await createStaff(
  "ret-wrong-" + crypto.randomUUID().slice(0, 6) + "@example.test",
  "Returns Wrong Location CI",
  "INVENTORY_OPERATOR",
  "LOCATION",
  otherLocationId
);

ok(manager.session.response.status === 200, "MANAGER inicia sesión");
ok(support.session.response.status === 200, "Customer Support inicia sesión");
ok(receiver.session.response.status === 200, "Inventory Operator scoped inicia sesión");

const ineligibleReturn = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(
    support.session,
    "ret-ineligible-" + crypto.randomUUID()
  ),
  body: JSON.stringify({
    orderId: ineligible.orderId,
    requestedResolution: "REFUND",
    reasonCode: "SIZE",
    items: [{ orderItemId: ineligible.orderItemId, quantity: 1 }]
  })
});
ok(
  ineligibleReturn.response.status === 409 &&
  ineligibleReturn.body.error === "order_not_returnable",
  "orden no entregada no admite Customer Return"
);

const releaseCase = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(
    support.session,
    "ret-release-" + crypto.randomUUID()
  ),
  body: JSON.stringify({
    orderId: eligible.orderId,
    requestedResolution: "NONE",
    reasonCode: "TEST_RELEASE",
    items: [{ orderItemId: eligible.orderItemId, quantity: 1 }]
  })
});
ok(releaseCase.response.status === 201, "Customer Support crea ReturnCase");

const reject = await api(
  `/v1/internal/returns/${Number(releaseCase.body.returnCase?.id)}/reject`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: JSON.stringify({ reason: "Solicitud duplicada de prueba" })
  }
);
ok(
  reject.response.status === 200 &&
  reject.body.returnCase?.status === "REJECTED",
  "MANAGER rechaza ReturnCase"
);

const activeKey = "ret-active-" + crypto.randomUUID();
const active = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(support.session, activeKey),
  body: JSON.stringify({
    orderId: eligible.orderId,
    requestedResolution: "REFUND",
    reasonCode: "FIT",
    reasonNote: "Solicitud de prueba",
    items: [{ orderItemId: eligible.orderItemId, quantity: 2 }]
  })
});
ok(active.response.status === 201, "cantidad rechazada vuelve a estar disponible");
const returnCaseId = Number(active.body.returnCase?.id);
const returnItemId = Number(active.body.returnCase?.items?.[0]?.id);
ok(
  active.body.returnCase?.requestedResolution === "REFUND" &&
  active.body.returnCase?.resolutionStatus === "PENDING_HANDOFF",
  "REFUND queda como handoff pendiente, no como refund ejecutado"
);

const replayCreate = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(support.session, activeKey),
  body: JSON.stringify({
    orderId: eligible.orderId,
    requestedResolution: "REFUND",
    reasonCode: "FIT",
    reasonNote: "Solicitud de prueba",
    items: [{ orderItemId: eligible.orderItemId, quantity: 2 }]
  })
});
ok(
  replayCreate.response.status === 200 &&
  replayCreate.body.replayed === true &&
  Number(replayCreate.body.returnCase?.id) === returnCaseId,
  "creación de ReturnCase es idempotente"
);

const overReturn = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(
    support.session,
    "ret-over-" + crypto.randomUUID()
  ),
  body: JSON.stringify({
    orderId: eligible.orderId,
    requestedResolution: "REFUND",
    reasonCode: "OTHER",
    items: [{ orderItemId: eligible.orderItemId, quantity: 2 }]
  })
});
ok(
  overReturn.response.status === 409 &&
  overReturn.body.error === "return_quantity_exceeded" &&
  Number(overReturn.body.available) === 1,
  "cantidad acumulada no puede superar unidades vendidas"
);

const supportApprove = await api(
  `/v1/internal/returns/${returnCaseId}/approve`,
  {
    method: "POST",
    headers: staffHeaders(support.session),
    body: "{}"
  }
);
ok(
  supportApprove.response.status === 403 &&
  supportApprove.body.error === "forbidden",
  "Customer Support no puede aprobar devoluciones"
);

const approve = await api(
  `/v1/internal/returns/${returnCaseId}/approve`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: "{}"
  }
);
ok(
  approve.response.status === 200 &&
  approve.body.returnCase?.status === "APPROVED",
  "MANAGER aprueba ReturnCase"
);

const wrongReceive = await api(
  `/v1/internal/returns/${returnCaseId}/receive`,
  {
    method: "POST",
    headers: staffHeaders(
      wrongReceiver.session,
      "ret-wrong-location-" + crypto.randomUUID()
    ),
    body: JSON.stringify({ locationId })
  }
);
ok(
  wrongReceive.response.status === 403 &&
  wrongReceive.body.error === "forbidden",
  "scope LOCATION bloquea recepción en otra ubicación"
);

const receiveKey = "ret-receive-" + crypto.randomUUID();
const receive = await api(
  `/v1/internal/returns/${returnCaseId}/receive`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, receiveKey),
    body: JSON.stringify({ locationId })
  }
);
ok(
  receive.response.status === 201 &&
  receive.body.returnCase?.status === "RECEIVED" &&
  Number(receive.body.returnCase?.items?.[0]?.quantityReceived) === 2,
  "Inventory Operator recibe físicamente la devolución"
);

const invBeforeInspection = await db`
  SELECT quantity
  FROM inventory
  WHERE variant_id = ${variantId}
    AND location_id = ${locationId}
  LIMIT 1`;
ok(
  invBeforeInspection.length === 0 ||
  Number(invBeforeInspection[0].quantity) === 0,
  "RECEIVED no incrementa stock vendible"
);

const receiveReplay = await api(
  `/v1/internal/returns/${returnCaseId}/receive`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, receiveKey),
    body: JSON.stringify({ locationId })
  }
);
ok(
  receiveReplay.response.status === 200 &&
  receiveReplay.body.replayed === true,
  "recepción física es idempotente"
);

const mismatch = await api(
  `/v1/internal/returns/${returnCaseId}/inspect`,
  {
    method: "POST",
    headers: staffHeaders(
      receiver.session,
      "ret-inspect-invalid-" + crypto.randomUUID()
    ),
    body: JSON.stringify({
      items: [{
        returnItemId,
        dispositions: [{
          disposition: "RESTOCK",
          quantity: 1
        }]
      }]
    })
  }
);
ok(
  mismatch.response.status === 409 &&
  mismatch.body.error === "disposition_quantity_mismatch",
  "inspección exige clasificar toda la cantidad recibida"
);

const inspectKey = "ret-inspect-" + crypto.randomUUID();
const inspect = await api(
  `/v1/internal/returns/${returnCaseId}/inspect`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, inspectKey),
    body: JSON.stringify({
      items: [{
        returnItemId,
        dispositions: [
          {
            disposition: "RESTOCK",
            quantity: 1,
            notes: "Unidad vendible"
          },
          {
            disposition: "DAMAGED",
            quantity: 1,
            notes: "Daño detectado"
          }
        ]
      }]
    })
  }
);
ok(
  inspect.response.status === 201 &&
  inspect.body.returnCase?.status === "INSPECTED",
  "inspección acepta disposiciones mixtas"
);

const invAfterInspection = await db`
  SELECT quantity, reserved
  FROM inventory
  WHERE variant_id = ${variantId}
    AND location_id = ${locationId}
  LIMIT 1`;
ok(
  Number(invAfterInspection[0]?.quantity) === 1 &&
  Number(invAfterInspection[0]?.reserved) === 0,
  "solo RESTOCK incrementa inventario vendible"
);

const returnNumber = String(inspect.body.returnCase?.returnNumber || "");
const movements = await db`
  SELECT movement_type, quantity, reference
  FROM inventory_movements
  WHERE reference = ${"return:" + returnNumber + ":item:" + returnItemId}
  ORDER BY id`;
ok(
  movements.length === 1 &&
  movements[0].movement_type === "CUSTOMER_RETURN" &&
  Number(movements[0].quantity) === 1,
  "RESTOCK crea exactamente un movimiento CUSTOMER_RETURN"
);

const inspectReplay = await api(
  `/v1/internal/returns/${returnCaseId}/inspect`,
  {
    method: "POST",
    headers: staffHeaders(receiver.session, inspectKey),
    body: JSON.stringify({
      items: [{
        returnItemId,
        dispositions: [
          {
            disposition: "RESTOCK",
            quantity: 1,
            notes: "Unidad vendible"
          },
          {
            disposition: "DAMAGED",
            quantity: 1,
            notes: "Daño detectado"
          }
        ]
      }]
    })
  }
);
ok(
  inspectReplay.response.status === 200 &&
  inspectReplay.body.replayed === true,
  "inspección es idempotente"
);

const invAfterReplay = await db`
  SELECT quantity
  FROM inventory
  WHERE variant_id = ${variantId}
    AND location_id = ${locationId}`;
ok(
  Number(invAfterReplay[0]?.quantity) === 1,
  "retry de inspección no duplica stock"
);

const movementCount = await db`
  SELECT COUNT(*)::int AS count
  FROM inventory_movements
  WHERE reference = ${"return:" + returnNumber + ":item:" + returnItemId}`;
ok(
  Number(movementCount[0]?.count) === 1,
  "retry de inspección no duplica movement"
);

const paymentAfterReturn = await db`
  SELECT status
  FROM payments
  WHERE id = ${paymentId}
  LIMIT 1`;
ok(
  paymentAfterReturn[0]?.status === "PAID",
  "ReturnCase no cambia Payment a REFUNDED automáticamente"
);

const complete = await api(
  `/v1/internal/returns/${returnCaseId}/complete`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: "{}"
  }
);
ok(
  complete.response.status === 200 &&
  complete.body.returnCase?.status === "COMPLETED" &&
  complete.body.returnCase?.resolutionStatus === "PENDING_HANDOFF",
  "cierre físico conserva resolución financiera pendiente"
);

const cancelCandidate = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(
    support.session,
    "ret-cancel-" + crypto.randomUUID()
  ),
  body: JSON.stringify({
    orderId: eligible.orderId,
    requestedResolution: "NONE",
    reasonCode: "REMAINDER",
    items: [{ orderItemId: eligible.orderItemId, quantity: 1 }]
  })
});
ok(cancelCandidate.response.status === 201, "crea ReturnCase por unidad restante");

const cancelId = Number(cancelCandidate.body.returnCase?.id);
const cancelled = await api(
  `/v1/internal/returns/${cancelId}/cancel`,
  {
    method: "POST",
    headers: staffHeaders(manager.session),
    body: JSON.stringify({ reason: "Cliente desistió" })
  }
);
ok(
  cancelled.response.status === 200 &&
  cancelled.body.returnCase?.status === "CANCELLED",
  "cancelación libera la cantidad solicitada"
);

const afterCancel = await api("/v1/internal/returns", {
  method: "POST",
  headers: staffHeaders(
    support.session,
    "ret-after-cancel-" + crypto.randomUUID()
  ),
  body: JSON.stringify({
    orderId: eligible.orderId,
    requestedResolution: "NONE",
    reasonCode: "REMAINDER_RETRY",
    items: [{ orderItemId: eligible.orderItemId, quantity: 1 }]
  })
});
ok(
  afterCancel.response.status === 201,
  "cantidad CANCELLED vuelve a estar disponible"
);

const audits = await db`
  SELECT action, actor_type, actor_user_id
  FROM audit_events
  WHERE action IN (
    'return.requested','return.approved','return.rejected',
    'return.cancelled','return.received','return.inspected','return.completed'
  )
  ORDER BY id`;
ok(
  audits.some((x: any) => x.action === "return.received") &&
  audits.some((x: any) => x.action === "return.inspected") &&
  audits.some((x: any) => x.action === "return.completed"),
  "workflow de devolución produce auditoría"
);
ok(
  audits
    .filter((x: any) => ["return.received", "return.inspected"].includes(x.action))
    .every((x: any) => Number(x.actor_user_id) === receiver.userId),
  "recepción e inspección quedan atribuidas al Inventory Operator"
);

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — returns/after-sales");
await db.close();
