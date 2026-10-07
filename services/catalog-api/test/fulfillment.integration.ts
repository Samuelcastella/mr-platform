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

async function createOrder(key: string, variantId: number) {
  return api("/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      channel: "WEB",
      customer: { name: "Cliente Fulfillment CI", phone: "9999-3333" },
      items: [{ variantId, quantity: 1 }]
    })
  });
}

async function createFulfillment(key: string, order: any, type = "LOCAL_DELIVERY") {
  const body: any = {
    orderId: order.id,
    orderToken: order.token,
    type,
    recipientName: "Cliente Fulfillment CI",
    recipientPhone: "9999-3333"
  };
  if (type !== "STORE_PICKUP") {
    body.department = "Cortés";
    body.municipality = "Puerto Cortés";
    body.addressLine = "Barrio CI, calle principal";
    body.addressReference = "Frente a referencia CI";
  }
  return api("/v1/fulfillments", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body)
  });
}

async function createCheckout(key: string, order: any, method: string) {
  return api("/v1/checkouts", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      orderId: order.id,
      orderToken: order.token,
      paymentMethod: method
    })
  });
}

async function transitionFulfillment(id: number, status: string, extra: any = {}) {
  return api("/v1/internal/fulfillments/" + id + "/status", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-internal-key": internalKey },
    body: JSON.stringify({ status, ...extra })
  });
}

await db.unsafe("TRUNCATE TABLE cod_collections, delivery_attempts, fulfillment_tracking_events, fulfillment_status_history, fulfillments, delivery_zones, payment_status_history, payment_attempts, payments, checkout_sessions, order_status_history, inventory_reservations, order_items, orders, inventory_movements, inventory, product_variants, products, locations RESTART IDENTITY CASCADE");

const loc = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES('Tienda Fulfillment CI', 'HN', 'store', TRUE)
  RETURNING id`;
const locationId = Number(loc[0].id);

const product = await db`
  INSERT INTO products(name, slug, category, brand, status)
  VALUES('Producto Fulfillment CI', 'producto-fulfillment-ci', 'Ropa', 'MR', 'active')
  RETURNING id`;
const productId = Number(product[0].id);

const variants = await db`
  INSERT INTO product_variants(product_id, sku, size, color, price, currency, active)
  VALUES
    (${productId}, 'FUL-DELIVERY', 'M', 'Negro', 300.00, 'HNL', TRUE),
    (${productId}, 'FUL-RETURN', 'L', 'Azul', 350.00, 'HNL', TRUE),
    (${productId}, 'FUL-COD', 'S', 'Blanco', 400.00, 'HNL', TRUE),
    (${productId}, 'FUL-PICKUP', 'XL', 'Gris', 250.00, 'HNL', TRUE)
  RETURNING id, sku`;
const deliveryVariant = Number(variants[0].id);
const returnVariant = Number(variants[1].id);
const codVariant = Number(variants[2].id);
const pickupVariant = Number(variants[3].id);

await db`
  INSERT INTO inventory(variant_id, location_id, quantity, reserved)
  VALUES
    (${deliveryVariant}, ${locationId}, 2, 0),
    (${returnVariant}, ${locationId}, 2, 0),
    (${codVariant}, ${locationId}, 2, 0),
    (${pickupVariant}, ${locationId}, 2, 0)`;

const noZone = await api("/v1/fulfillment/options?department=" + encodeURIComponent("Cortés"));
ok(noZone.response.status === 200 && noZone.body.options?.[0]?.quoteRequired === true, "departamento sin configuración retorna cotización requerida");

const unauthorizedZone = await api("/v1/internal/delivery-zones/" + encodeURIComponent("Cortés"), {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ serviceType: "LOCAL_DELIVERY", shippingMinor: 6000, etaMinDays: 1, etaMaxDays: 2 })
});
ok(unauthorizedZone.response.status === 401, "configuración de zona requiere autorización");

const zone = await api("/v1/internal/delivery-zones/" + encodeURIComponent("Cortés"), {
  method: "PUT",
  headers: { "content-type": "application/json", "x-internal-key": internalKey },
  body: JSON.stringify({
    serviceType: "LOCAL_DELIVERY",
    shippingMinor: 6000,
    currency: "HNL",
    etaMinDays: 1,
    etaMaxDays: 2,
    provider: "MR"
  })
});
ok(zone.response.status === 200, "operador configura zona de entrega");

const configured = await api("/v1/fulfillment/options?department=" + encodeURIComponent("Cortés"));
ok(configured.response.status === 200, "cliente consulta opciones por departamento");
ok(configured.body.options?.[0]?.shippingMinor === 6000 && configured.body.options?.[0]?.etaMinDays === 1, "API devuelve tarifa y ETA server-side");

const deliveryOrderResp = await createOrder("ci-fulfillment-order-delivery", deliveryVariant);
const deliveryOrder = deliveryOrderResp.body.order;

const tampered = await api("/v1/fulfillments", {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": "ci-fulfillment-tampered" },
  body: JSON.stringify({
    orderId: deliveryOrder.id,
    orderToken: deliveryOrder.token,
    type: "LOCAL_DELIVERY",
    department: "Cortés",
    municipality: "Puerto Cortés",
    addressLine: "Dirección CI",
    shippingMinor: 1
  })
});
ok(tampered.response.status === 400 && tampered.body.error === "client_delivery_quote_not_allowed", "cliente no puede fijar tarifa de entrega");

const deliveryFulfillmentResp = await createFulfillment("ci-fulfillment-delivery-001", deliveryOrder);
ok(deliveryFulfillmentResp.response.status === 201, "crea fulfillment con dirección snapshot");
const deliveryFulfillment = deliveryFulfillmentResp.body.fulfillment;
ok(deliveryFulfillment.quote?.shippingMinor === 6000 && deliveryFulfillment.quote?.etaMaxDays === 2, "fulfillment congela tarifa y ETA");
ok(deliveryFulfillment.destination?.department === "Cortés" && deliveryFulfillment.destination?.municipality === "Puerto Cortés", "fulfillment conserva destino");

const orderWithShipping = await api("/v1/orders/" + deliveryOrder.id + "?token=" + encodeURIComponent(deliveryOrder.token));
ok(orderWithShipping.body.order?.shippingTotalMinor === 6000, "selección de fulfillment actualiza shipping del Order");
ok(orderWithShipping.body.order?.grandTotalMinor === 36000, "Order recalcula total server-side con envío");

const replay = await createFulfillment("ci-fulfillment-delivery-001", deliveryOrder);
ok(replay.response.status === 200 && replay.body.replayed === true, "fulfillment creation es idempotente");
ok(Number(replay.body.fulfillment?.id) === Number(deliveryFulfillment.id), "retry no duplica fulfillment");

const publicTracking = await api("/v1/fulfillments/" + deliveryFulfillment.id + "?token=" + encodeURIComponent(deliveryFulfillment.token));
ok(publicTracking.response.status === 200 && publicTracking.body.fulfillment?.events?.length >= 1, "tracking público requiere token y expone eventos normalizados");

const deliveryCheckout = await createCheckout("ci-fulfillment-checkout-delivery", deliveryOrder, "CASH");
ok(deliveryCheckout.response.status === 201 && deliveryCheckout.body.checkout?.amountMinor === 36000, "checkout usa total con envío");

for (const status of ["PREPARING", "READY", "DISPATCHED", "OUT_FOR_DELIVERY"]) {
  const step = await transitionFulfillment(deliveryFulfillment.id, status);
  ok(step.response.status === 200 && step.body.fulfillment?.status === status, "fulfillment transiciona a " + status);
}

const consumed = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${deliveryVariant} AND location_id = ${locationId}`;
ok(Number(consumed[0].quantity) === 1 && Number(consumed[0].reserved) === 0, "DISPATCHED consume inventario reservado");

const trackingEvent = await api("/v1/internal/fulfillments/" + deliveryFulfillment.id + "/tracking-events", {
  method: "POST",
  headers: { "content-type": "application/json", "x-internal-key": internalKey },
  body: JSON.stringify({
    eventType: "COURIER_SCAN",
    status: "OUT_FOR_DELIVERY",
    description: "Escaneo CI",
    providerEventId: "provider-event-ci-1",
    locationText: "Puerto Cortés"
  })
});
ok(trackingEvent.response.status === 201, "agrega evento de tracking normalizado");

const trackingReplay = await api("/v1/internal/fulfillments/" + deliveryFulfillment.id + "/tracking-events", {
  method: "POST",
  headers: { "content-type": "application/json", "x-internal-key": internalKey },
  body: JSON.stringify({
    eventType: "COURIER_SCAN",
    status: "OUT_FOR_DELIVERY",
    description: "Escaneo CI",
    providerEventId: "provider-event-ci-1",
    locationText: "Puerto Cortés"
  })
});
ok(trackingReplay.response.status === 200 && trackingReplay.body.replayed === true, "evento externo duplicado se deduplica");

const attempt = await api("/v1/internal/fulfillments/" + deliveryFulfillment.id + "/attempts", {
  method: "POST",
  headers: { "content-type": "application/json", "x-internal-key": internalKey },
  body: JSON.stringify({ status: "FAILED", reason: "Cliente no disponible", actor: "courier-ci" })
});
ok(
  attempt.response.status === 201 &&
  attempt.body.fulfillment?.status === "FAILED" &&
  Number(attempt.body.fulfillment?.attempts?.[0]?.attemptNumber) === 1,
  "intento fallido queda auditado y mueve fulfillment a FAILED"
);

const retryDelivery = await transitionFulfillment(deliveryFulfillment.id, "OUT_FOR_DELIVERY");
ok(
  retryDelivery.response.status === 200 && retryDelivery.body.fulfillment?.status === "OUT_FOR_DELIVERY",
  "fulfillment fallido puede reintentarse"
);

const delivered = await transitionFulfillment(deliveryFulfillment.id, "DELIVERED", {
  proof: { receivedBy: "Cliente CI", note: "Entrega CI" }
});
ok(delivered.response.status === 200 && delivered.body.fulfillment?.status === "DELIVERED", "entrega finaliza fulfillment");
ok(delivered.body.fulfillment?.proofOfDelivery?.receivedBy === "Cliente CI", "proof of delivery se conserva como metadata");
ok(delivered.body.fulfillment?.orderStatus === "DELIVERED", "fulfillment avanza Order mediante transición controlada");

const returnOrderResp = await createOrder("ci-fulfillment-order-return", returnVariant);
const returnOrder = returnOrderResp.body.order;
const returnFulfillmentResp = await createFulfillment("ci-fulfillment-return-001", returnOrder);
const returnFulfillment = returnFulfillmentResp.body.fulfillment;
await createCheckout("ci-fulfillment-checkout-return", returnOrder, "CASH");
for (const status of ["PREPARING", "READY", "DISPATCHED", "FAILED", "RETURNING", "RETURNED"]) {
  const step = await transitionFulfillment(returnFulfillment.id, status);
  ok(step.response.status === 200, "ruta de retorno acepta " + status);
}
const returnedInventory = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${returnVariant} AND location_id = ${locationId}`;
ok(Number(returnedInventory[0].quantity) === 1 && Number(returnedInventory[0].reserved) === 0, "RETURNED no restockea automáticamente inventario vendido");

const pickupOrderResp = await createOrder("ci-fulfillment-order-pickup", pickupVariant);
const pickupOrder = pickupOrderResp.body.order;
const pickupFulfillmentResp = await createFulfillment("ci-fulfillment-pickup-001", pickupOrder, "STORE_PICKUP");
ok(pickupFulfillmentResp.response.status === 201 && pickupFulfillmentResp.body.fulfillment?.quote?.shippingMinor === 0, "store pickup funciona sin dirección ni envío");
const pickupFulfillment = pickupFulfillmentResp.body.fulfillment;
await createCheckout("ci-fulfillment-checkout-pickup", pickupOrder, "CASH");
for (const status of ["PREPARING", "READY", "DELIVERED"]) {
  const step = await transitionFulfillment(pickupFulfillment.id, status);
  ok(step.response.status === 200, "store pickup transiciona a " + status);
}
const pickupOrderDone = await api("/v1/orders/" + pickupOrder.id + "?token=" + encodeURIComponent(pickupOrder.token));
ok(pickupOrderDone.body.order?.status === "COMPLETED", "pickup entregado completa Order y consume inventario");

const codOrderResp = await createOrder("ci-fulfillment-order-cod", codVariant);
const codOrder = codOrderResp.body.order;
const codFulfillmentResp = await createFulfillment("ci-fulfillment-cod-001", codOrder);
const codFulfillment = codFulfillmentResp.body.fulfillment;
const codCheckoutResp = await createCheckout("ci-fulfillment-checkout-cod", codOrder, "CASH_ON_DELIVERY");
const codCheckout = codCheckoutResp.body.checkout;
ok(codCheckout.response !== false && codCheckout.payment?.status === "PENDING", "COD Payment inicia PENDING");
for (const status of ["PREPARING", "READY", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"]) {
  await transitionFulfillment(codFulfillment.id, status);
}
const codCollectionRows = await db`SELECT id, status, expected_amount_minor FROM cod_collections WHERE payment_id = ${codCheckout.payment.id}`;
ok(codCollectionRows[0]?.status === "PENDING", "CODCollection existe separado de Payment");
const codCollectionId = Number(codCollectionRows[0].id);

const collected = await api("/v1/internal/cod-collections/" + codCollectionId + "/status", {
  method: "PATCH",
  headers: { "content-type": "application/json", "x-internal-key": internalKey },
  body: JSON.stringify({
    status: "COLLECTED",
    collectedAmountMinor: Number(codCollectionRows[0].expected_amount_minor),
    collectorReference: "courier-ci-cash"
  })
});
ok(collected.response.status === 200 && collected.body.collection?.status === "COLLECTED", "COD collection registra efectivo cobrado");

const paymentAfterDelivery = await api("/v1/internal/payments/" + codCheckout.payment.id, {
  headers: { "x-internal-key": internalKey }
});
ok(paymentAfterDelivery.body.payment?.status === "PENDING", "DELIVERED/COLLECTED no marca Payment PAID automáticamente");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — fulfillment/logistics");
await db.close();
