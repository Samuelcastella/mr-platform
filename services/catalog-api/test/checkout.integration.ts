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
    headers: {
      "content-type": "application/json",
      "idempotency-key": key
    },
    body: JSON.stringify({
      channel: "WEB",
      customer: { name: "Cliente Checkout CI", phone: "9999-1111" },
      items: [{ variantId, quantity: 1 }]
    })
  });
}

async function createCheckout(key: string, order: any, method: string, evidence: any = {}) {
  return api("/v1/checkouts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key
    },
    body: JSON.stringify({
      orderId: order.id,
      orderToken: order.token,
      paymentMethod: method,
      evidence
    })
  });
}

await db.unsafe("TRUNCATE TABLE cod_collections, delivery_attempts, fulfillment_tracking_events, fulfillment_status_history, fulfillments, delivery_zones, payment_status_history, payment_attempts, payments, checkout_sessions, order_status_history, inventory_reservations, order_items, orders, inventory_movements, inventory, product_variants, products, locations RESTART IDENTITY CASCADE");

const loc = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES('Tienda Checkout CI', 'HN', 'store', TRUE)
  RETURNING id`;
const locationId = Number(loc[0].id);

const product = await db`
  INSERT INTO products(name, slug, category, brand, status)
  VALUES('Producto Checkout CI', 'producto-checkout-ci', 'Ropa', 'MR', 'active')
  RETURNING id`;
const productId = Number(product[0].id);

const variants = await db`
  INSERT INTO product_variants(product_id, sku, size, color, price, currency, active)
  VALUES
    (${productId}, 'CHK-CASH', 'M', 'Negro', 320.00, 'HNL', TRUE),
    (${productId}, 'CHK-TRANSFER', 'L', 'Azul', 450.00, 'HNL', TRUE),
    (${productId}, 'CHK-COD', 'S', 'Blanco', 275.00, 'HNL', TRUE)
  RETURNING id, sku`;
const cashVariant = Number(variants[0].id);
const transferVariant = Number(variants[1].id);
const codVariant = Number(variants[2].id);

await db`
  INSERT INTO inventory(variant_id, location_id, quantity, reserved)
  VALUES
    (${cashVariant}, ${locationId}, 3, 0),
    (${transferVariant}, ${locationId}, 3, 0),
    (${codVariant}, ${locationId}, 3, 0)`;

const cashOrderResp = await createOrder("ci-checkout-order-cash", cashVariant);
ok(cashOrderResp.response.status === 201, "crea orden para checkout CASH");
const cashOrder = cashOrderResp.body.order;

const tampered = await api("/v1/checkouts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": "ci-checkout-tampered"
  },
  body: JSON.stringify({
    orderId: cashOrder.id,
    orderToken: cashOrder.token,
    paymentMethod: "CASH",
    amountMinor: 1
  })
});
ok(tampered.response.status === 400 && tampered.body.error === "client_amount_not_allowed", "cliente no puede fijar monto");

const cashCheckoutResp = await createCheckout("ci-checkout-cash-001", cashOrder, "CASH");
ok(cashCheckoutResp.response.status === 201, "crea checkout CASH");
const cashCheckout = cashCheckoutResp.body.checkout;
ok(cashCheckout.amountMinor === 32000 && cashCheckout.currency === "HNL", "checkout usa monto autoritativo de Order");
ok(cashCheckout.payment?.status === "PENDING" && cashCheckout.payment?.method === "CASH", "CASH queda PENDING");
ok(cashCheckout.orderStatus === "CONFIRMED", "checkout confirma orden pendiente");

const reservationAfterCheckout = await db`
  SELECT expires_at, status
  FROM inventory_reservations
  WHERE order_id = ${cashOrder.id}
  LIMIT 1`;
ok(reservationAfterCheckout[0]?.status === "ACTIVE" && reservationAfterCheckout[0]?.expires_at == null, "checkout fija reserva activa sin expiración");

const cashReplay = await createCheckout("ci-checkout-cash-001", cashOrder, "CASH");
ok(cashReplay.response.status === 200 && cashReplay.body.replayed === true, "checkout retry es idempotente");
ok(Number(cashReplay.body.checkout?.payment?.id) === Number(cashCheckout.payment?.id), "retry no duplica Payment");

const attempts = await db`SELECT COUNT(*)::int AS count FROM payment_attempts WHERE payment_id = ${cashCheckout.payment.id}`;
ok(Number(attempts[0]?.count) === 1, "retry no duplica PaymentAttempt");

const cashConflict = await createCheckout("ci-checkout-cash-001", cashOrder, "CASH_ON_DELIVERY");
ok(cashConflict.response.status === 409 && cashConflict.body.error === "idempotency_conflict", "misma clave con payload distinto retorna conflicto");

const publicCash = await api("/v1/checkouts/" + cashCheckout.id + "?token=" + encodeURIComponent(cashCheckout.token));
ok(publicCash.response.status === 200 && publicCash.body.checkout?.payment?.status === "PENDING", "checkout público se consulta con token");

const unauthPayment = await api("/v1/internal/payments/" + cashCheckout.payment.id + "/status", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "PAID" })
});
ok(unauthPayment.response.status === 401, "cliente público no puede marcar pago como PAID");

const paid = await api("/v1/internal/payments/" + cashCheckout.payment.id + "/status", {
  method: "PATCH",
  headers: {
    "content-type": "application/json",
    "x-internal-key": internalKey
  },
  body: JSON.stringify({ status: "PAID", reason: "cash_received_ci" })
});
ok(paid.response.status === 200 && paid.body.payment?.status === "PAID", "operador autorizado confirma CASH");

const cashOrderAfterPaid = await api("/v1/orders/" + cashOrder.id + "?token=" + encodeURIComponent(cashOrder.token));
ok(cashOrderAfterPaid.body.order?.status === "CONFIRMED", "Payment PAID no reescribe estado de Order");

const transferOrderResp = await createOrder("ci-checkout-order-transfer", transferVariant);
const transferOrder = transferOrderResp.body.order;
const transferCheckoutResp = await createCheckout(
  "ci-checkout-transfer-001",
  transferOrder,
  "BANK_TRANSFER",
  { reference: "BAC-CI-12345", note: "comprobante informado por cliente" }
);
ok(transferCheckoutResp.response.status === 201, "crea checkout BANK_TRANSFER");
const transferCheckout = transferCheckoutResp.body.checkout;
ok(transferCheckout.payment?.status === "PENDING", "transferencia con evidencia sigue PENDING");

const internalTransfer = await api("/v1/internal/payments/" + transferCheckout.payment.id, {
  headers: { "x-internal-key": internalKey }
});
ok(internalTransfer.response.status === 200, "operador puede consultar evidencia de transferencia");
ok(internalTransfer.body.payment?.external_reference === "BAC-CI-12345", "referencia bancaria queda preservada como evidencia");
ok(internalTransfer.body.payment?.status === "PENDING", "evidencia no auto-confirma transferencia");

const transferPaid = await api("/v1/internal/payments/" + transferCheckout.payment.id + "/status", {
  method: "PATCH",
  headers: {
    "content-type": "application/json",
    "x-internal-key": internalKey
  },
  body: JSON.stringify({ status: "PAID", reason: "transferencia_verificada_ci" })
});
ok(transferPaid.response.status === 200 && transferPaid.body.payment?.status === "PAID", "transferencia solo se confirma mediante operación autorizada");

const transferOrderAfterPaid = await api("/v1/orders/" + transferOrder.id + "?token=" + encodeURIComponent(transferOrder.token));
ok(transferOrderAfterPaid.body.order?.status === "CONFIRMED", "confirmar pago no acopla Payment con Order");

const codOrderResp = await createOrder("ci-checkout-order-cod", codVariant);
const codOrder = codOrderResp.body.order;
await db`
  INSERT INTO delivery_zones(department, service_type, active, shipping_minor, currency, eta_min_days, eta_max_days, provider)
  VALUES('Cortés', 'LOCAL_DELIVERY', TRUE, 7500, 'HNL', 1, 2, 'MR')`;
const fulfillmentResp = await api("/v1/fulfillments", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": "ci-checkout-fulfillment-cod"
  },
  body: JSON.stringify({
    orderId: codOrder.id,
    orderToken: codOrder.token,
    type: "LOCAL_DELIVERY",
    department: "Cortés",
    municipality: "Puerto Cortés",
    addressLine: "Dirección CI",
    addressReference: "Referencia CI",
    recipientName: "Cliente COD",
    recipientPhone: "9999-2222"
  })
});
ok(fulfillmentResp.response.status === 201, "COD crea fulfillment antes del checkout");
const codCheckoutResp = await createCheckout("ci-checkout-cod-001", codOrder, "CASH_ON_DELIVERY");
ok(codCheckoutResp.response.status === 201, "crea checkout COD");
const codCheckout = codCheckoutResp.body.checkout;
ok(codCheckout.orderStatus === "CONFIRMED", "COD permite Order CONFIRMED");
ok(codCheckout.payment?.status === "PENDING" && codCheckout.payment?.method === "CASH_ON_DELIVERY", "COD mantiene Payment PENDING");
ok(codCheckout.amountMinor === 35000, "COD incluye tarifa server-side de entrega");
const codRows = await db`SELECT status, expected_amount_minor FROM cod_collections WHERE payment_id = ${codCheckout.payment.id}`;
ok(codRows[0]?.status === "PENDING" && Number(codRows[0]?.expected_amount_minor) === 35000, "CODCollection se crea separado del Payment");

const paymentRows = await db`SELECT COUNT(*)::int AS count FROM payments`;
const checkoutRows = await db`SELECT COUNT(*)::int AS count FROM checkout_sessions`;
ok(Number(paymentRows[0]?.count) === 3 && Number(checkoutRows[0]?.count) === 3, "un checkout produce exactamente un Payment");

// Multi-line order: one valid line must not mask another expired reservation.
const multiOrderResp = await api("/v1/orders", {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": "ci-checkout-partial-expiry-order" },
  body: JSON.stringify({
    channel: "WEB",
    customer: { name: "Cliente Partial Expiry", phone: "9999-4444" },
    items: [{ variantId: cashVariant, quantity: 1 }, { variantId: transferVariant, quantity: 1 }]
  })
});
ok(multiOrderResp.response.status === 201, "crea pedido multilínea para expiración parcial");
const multiOrder = multiOrderResp.body.order;
const multiReservations = await db`
  SELECT variant_id, status FROM inventory_reservations WHERE order_id = ${multiOrder.id} ORDER BY variant_id`;
ok(multiReservations.length === 2, "pedido multilínea tiene dos reservas");
await db`
  UPDATE inventory_reservations
  SET expires_at = NOW() - INTERVAL '1 minute'
  WHERE order_id = ${multiOrder.id} AND variant_id = ${transferVariant} AND status = 'ACTIVE'`;
const rejectedMulti = await createCheckout("ci-checkout-partial-expiry", multiOrder, "CASH");
ok(rejectedMulti.response.status === 409 && rejectedMulti.body.error === "reservation_not_active",
  "checkout rechaza pedido cuando solo una de dos reservas está vencida");
const multiState = await db`
  SELECT status FROM orders WHERE id = ${multiOrder.id}`;
ok(multiState[0]?.status === "PENDING_CONFIRMATION", "checkout rechazado no confirma pedido");
const multiPayments = await db`SELECT COUNT(*)::int AS count FROM payments WHERE order_id = ${multiOrder.id}`;
ok(Number(multiPayments[0]?.count) === 0, "checkout rechazado no crea pagos");
const multiReservationsAfter = await db`
  SELECT variant_id, expires_at FROM inventory_reservations
  WHERE order_id = ${multiOrder.id} AND status = 'ACTIVE'`;
ok(multiReservationsAfter.length === 2 && multiReservationsAfter.some((r: any) =>
  Number(r.variant_id) === transferVariant && r.expires_at != null),
  "checkout rechazado no extiende reservas vencidas");

// Signed simulated gateway events: concurrent replay, late payment exception, no SALE.
const webhookSecret = Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET;
if (!webhookSecret || webhookSecret.length < 32) {
  ok(false, "secreto de simulación requerido para regresión webhook");
} else {
  const { signSimulatedWebhook } = await import("../simulated-payment-webhook");
  const paymentId = Number(cashCheckout.payment.id);
  await db`UPDATE payments SET provider = 'SIMULATED' WHERE id = ${paymentId}`;
  const sendEvent = async (eventId: string, signatureOverride?: string) => {
    const raw = JSON.stringify({ eventId, paymentId, type: "payment.succeeded" });
    const signature = signatureOverride ?? await signSimulatedWebhook(webhookSecret, raw);
    return api("/v1/webhooks/payments/simulated", {
      method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": signature }, body: raw
    });
  };
  const successPaymentId = Number(codCheckout.payment.id);
  await db`UPDATE payments SET provider = 'SIMULATED' WHERE id = ${successPaymentId}`;
  const successRaw = JSON.stringify({ eventId: "ci-webhook-success-001", paymentId: successPaymentId, type: "payment.succeeded" });
  const successSignature = await signSimulatedWebhook(webhookSecret, successRaw);
  const successResponse = await api("/v1/webhooks/payments/simulated", {
    method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": successSignature }, body: successRaw
  });
  ok(successResponse.response.status === 200 && successResponse.body.outcome === "PAID",
    "webhook firmado confirma pago PENDING sin ruta manual");
  const successPayment = await db`SELECT status FROM payments WHERE id = ${successPaymentId}`;
  ok(successPayment[0]?.status === "PAID", "confirmación webhook persiste pago PAID");
  const successHistory = await db`SELECT COUNT(*)::int AS total FROM payment_status_history WHERE payment_id = ${successPaymentId} AND actor = 'webhook:simulated'`;
  ok(Number(successHistory[0]?.total) === 1, "confirmación webhook registra historial una vez");
  const unsigned = await sendEvent("ci-webhook-invalid-001", "0".repeat(64));
  ok(unsigned.response.status === 401, "webhook simulado rechaza firma inválida");
  const [firstWebhook, replayWebhook] = await Promise.all([
    sendEvent("ci-webhook-paid-001"), sendEvent("ci-webhook-paid-001")
  ]);
  ok(firstWebhook.response.status === 200 && replayWebhook.response.status === 200,
    "webhooks concurrentes reciben respuesta idempotente");
  const eventCount = await db`SELECT COUNT(*)::int AS total FROM simulated_payment_events WHERE event_id = 'ci-webhook-paid-001'`;
  ok(Number(eventCount[0]?.total) === 1, "evento concurrente se persiste una vez");
  const paidHistory = await db`SELECT COUNT(*)::int AS total FROM payment_status_history WHERE payment_id = ${paymentId} AND actor = 'webhook:simulated'`;
  ok(Number(paidHistory[0]?.total) === 0, "pago manual previo no se vuelve a confirmar por webhook");
  // Simulate provider capture after reservation/order cancellation.
  const latePaymentId = Number(cashCheckout.payment.id);
  // Reset the test fixture to a pending captured payment; CASH was confirmed earlier in this suite.
  await db`UPDATE payments SET provider = 'SIMULATED', status = 'PENDING' WHERE id = ${latePaymentId}`;
  await db`UPDATE orders SET status = 'CANCELLED', cancellation_reason = 'reservation_expired' WHERE id = ${cashOrder.id}`;
  await db`UPDATE inventory_reservations SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 minute' WHERE order_id = ${cashOrder.id}`;
  const lateRaw = JSON.stringify({ eventId: "ci-webhook-late-001", paymentId: latePaymentId, type: "payment.succeeded" });
  const lateSignature = await signSimulatedWebhook(webhookSecret, lateRaw);
  const lateRequest = () => api("/v1/webhooks/payments/simulated", {
    method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": lateSignature }, body: lateRaw
  });
  const [lateA, lateB] = await Promise.all([lateRequest(), lateRequest()]);
  ok(lateA.response.status === 200 && lateB.response.status === 200 &&
     lateA.body.outcome === "LATE_PAYMENT_EXPIRED_RESERVATION" &&
     lateB.body.outcome === "LATE_PAYMENT_EXPIRED_RESERVATION",
    "pago tardío concurrente genera excepción idempotente");
  const exceptions = await db`SELECT COUNT(*)::int AS total FROM payment_webhook_exceptions WHERE event_id = 'ci-webhook-late-001'`;
  ok(Number(exceptions[0]?.total) === 1, "pago tardío registra una excepción única");
  const lateSales = await db`SELECT COUNT(*)::int AS total FROM inventory_movements WHERE reference = ${"order:" + cashOrder.id} AND movement_type = 'SALE'`;
  ok(Number(lateSales[0]?.total) === 0, "pago tardío no genera salida Kardex");
  const lateOrderState = await db`SELECT status FROM orders WHERE id = ${cashOrder.id}`;
  ok(lateOrderState[0]?.status === "CANCELLED", "webhook tardío no reactiva venta");
}

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — checkout/payments");
await db.close();
