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
    const raw = JSON.stringify({ eventId, paymentId, type: "payment.succeeded", providerReference: "ci-capture-cash-001", amountMinor: cashCheckout.amountMinor, currency: cashCheckout.currency });
    const signature = signatureOverride ?? await signSimulatedWebhook(webhookSecret, raw);
    return api("/v1/webhooks/payments/simulated", {
      method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": signature }, body: raw
    });
  };
  const successPaymentId = Number(codCheckout.payment.id);
  await db`UPDATE payments SET provider = 'SIMULATED' WHERE id = ${successPaymentId}`;
  const successRaw = JSON.stringify({ eventId: "ci-webhook-success-001", paymentId: successPaymentId, type: "payment.succeeded", providerReference: "ci-capture-cod-001", amountMinor: codCheckout.amountMinor, currency: codCheckout.currency });
  const successSignature = await signSimulatedWebhook(webhookSecret, successRaw);
  const successRequest = () => api("/v1/webhooks/payments/simulated", {
    method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": successSignature }, body: successRaw
  });
  const [successA, successB] = await Promise.all([successRequest(), successRequest()]);
  ok(successA.response.status === 200 && successB.response.status === 200 &&
     successA.body.outcome === "PAID" && successB.body.outcome === "PAID" &&
     [successA.body.replayed, successB.body.replayed].filter(Boolean).length === 1,
    "dos webhooks concurrentes confirman un pago PENDING exactamente una vez");
  const successPayment = await db`SELECT status FROM payments WHERE id = ${successPaymentId}`;
  ok(successPayment[0]?.status === "PAID", "confirmación webhook persiste pago PAID");
  const successHistory = await db`SELECT COUNT(*)::int AS total FROM payment_status_history WHERE payment_id = ${successPaymentId} AND actor = 'webhook:simulated'`;
  ok(Number(successHistory[0]?.total) === 1, "confirmación webhook registra historial una vez");
  const successAudit = await db`SELECT COUNT(*)::int AS total FROM audit_events WHERE correlation_id = 'ci-webhook-success-001' AND action = 'payment.webhook_confirmed'`;
  ok(Number(successAudit[0]?.total) === 1, "confirmación webhook concurrente genera una sola auditoría");
  const signedMismatch = JSON.stringify({
    eventId: "ci-webhook-mismatch-001", paymentId: successPaymentId, type: "payment.succeeded",
    providerReference: "ci-capture-mismatch-001", amountMinor: codCheckout.amountMinor + 1,
    currency: codCheckout.currency
  });
  const mismatchSignature = await signSimulatedWebhook(webhookSecret, signedMismatch);
  const mismatch = await api("/v1/webhooks/payments/simulated", {
    method: "POST",
    headers: { "content-type": "application/json", "x-simulated-signature": mismatchSignature },
    body: signedMismatch
  });
  ok(mismatch.response.status === 200 && mismatch.body.outcome === "PAYMENT_AMOUNT_MISMATCH",
    "captura con importe distinto se pone en excepción");
  const mismatchException = await db`
    SELECT COUNT(*)::int AS total FROM payment_webhook_exceptions
    WHERE event_id = 'ci-webhook-mismatch-001' AND code = 'PAYMENT_AMOUNT_MISMATCH'`;
  ok(Number(mismatchException[0]?.total) === 1, "discrepancia de importe queda en conciliación");
  const capturedEvidence = await db`
    SELECT provider_reference, captured_amount_minor, captured_currency FROM simulated_payment_events
    WHERE event_id = 'ci-webhook-success-001'`;
  ok(capturedEvidence[0]?.provider_reference === "ci-capture-cod-001" &&
     Number(capturedEvidence[0]?.captured_amount_minor) === codCheckout.amountMinor &&
     String(capturedEvidence[0]?.captured_currency).trim() === codCheckout.currency,
    "webhook conserva referencia e importe capturado para conciliación");
  const unsigned = await sendEvent("ci-webhook-invalid-001", "0".repeat(64));
  ok(unsigned.response.status === 401, "webhook simulado rechaza firma inválida");
  const [firstWebhook, replayWebhook] = await Promise.all([
    sendEvent("ci-webhook-paid-001"), sendEvent("ci-webhook-paid-001")
  ]);
  ok(firstWebhook.response.status === 200 && replayWebhook.response.status === 200,
    "webhooks concurrentes reciben respuesta idempotente");
  const conflictingRaw = JSON.stringify({ eventId: "ci-webhook-paid-001", paymentId: successPaymentId, type: "payment.succeeded", providerReference: "ci-capture-cod-001", amountMinor: codCheckout.amountMinor, currency: codCheckout.currency });
  const conflictingSignature = await signSimulatedWebhook(webhookSecret, conflictingRaw);
  const conflicting = await api("/v1/webhooks/payments/simulated", {
    method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": conflictingSignature },
    body: conflictingRaw
  });
  ok(conflicting.response.status === 409 && conflicting.body.error === "event_id_conflict",
    "mismo eventId con payload diferente rechaza conflicto");
  const eventCount = await db`SELECT COUNT(*)::int AS total FROM simulated_payment_events WHERE event_id = 'ci-webhook-paid-001'`;
  ok(Number(eventCount[0]?.total) === 1, "evento concurrente se persiste una vez");
  const paidHistory = await db`SELECT COUNT(*)::int AS total FROM payment_status_history WHERE payment_id = ${paymentId} AND actor = 'webhook:simulated'`;
  ok(Number(paidHistory[0]?.total) === 0, "pago manual previo no se vuelve a confirmar por webhook");
  // Distinct signed provider events may race to confirm the same pending payment.
  // Both receipts are retained, but there must be exactly one PAID transition and audit.
  const raceOrderResp = await createOrder("ci-checkout-order-webhook-race", transferVariant);
  ok(raceOrderResp.response.status === 201, "crea pedido para carrera entre dos eventIds");
  const raceCheckoutResp = await createCheckout("ci-checkout-webhook-race-001", raceOrderResp.body.order, "BANK_TRANSFER");
  ok(raceCheckoutResp.response.status === 201, "crea pago PENDING para carrera entre eventos distintos");
  const racePaymentId = Number(raceCheckoutResp.body.checkout.payment.id);
  await db`UPDATE payments SET provider = 'SIMULATED' WHERE id = ${racePaymentId}`;
  const differentEventRequest = async (eventId: string) => {
    const raw = JSON.stringify({
      eventId, paymentId: racePaymentId, type: "payment.succeeded",
      providerReference: "ci-capture-race-001", amountMinor: raceCheckoutResp.body.checkout.amountMinor,
      currency: raceCheckoutResp.body.checkout.currency
    });
    return api("/v1/webhooks/payments/simulated", {
      method: "POST",
      headers: { "content-type": "application/json", "x-simulated-signature": await signSimulatedWebhook(webhookSecret, raw) },
      body: raw
    });
  };
  const [raceA, raceB] = await Promise.all([
    differentEventRequest("ci-webhook-race-event-A"), differentEventRequest("ci-webhook-race-event-B")
  ]);
  const raceOutcomes = [raceA.body.outcome, raceB.body.outcome].sort();
  ok(raceA.response.status === 200 && raceB.response.status === 200 &&
     raceOutcomes.join(",") === "ALREADY_PAID,PAID",
    "distintos eventIds concurrentes hacen una sola confirmación");
  const racePaymentHistory = await db`
    SELECT COUNT(*)::int AS total FROM payment_status_history
    WHERE payment_id = ${racePaymentId} AND actor = 'webhook:simulated'`;
  ok(Number(racePaymentHistory[0]?.total) === 1, "carrera entre eventIds deja una transición PAID");
  const raceAudit = await db`
    SELECT COUNT(*)::int AS total FROM audit_events
    WHERE action = 'payment.webhook_confirmed' AND resource_id = ${String(racePaymentId)}`;
  ok(Number(raceAudit[0]?.total) === 1, "carrera entre eventIds deja una auditoría");
  const raceEvents = await db`
    SELECT COUNT(*)::int AS total FROM simulated_payment_events
    WHERE payment_id = ${racePaymentId}`;
  ok(Number(raceEvents[0]?.total) === 2, "carrera conserva ambas notificaciones firmadas");

  // Simulate provider capture after reservation/order cancellation.
  const lateOrderResp = await createOrder("ci-checkout-order-late-webhook", cashVariant);
  ok(lateOrderResp.response.status === 201, "crea pedido exclusivo para pago tardío");
  const lateOrder = lateOrderResp.body.order;
  const lateCheckoutResp = await createCheckout("ci-checkout-late-webhook-001", lateOrder, "CASH");
  ok(lateCheckoutResp.response.status === 201, "crea pago pendiente exclusivo para captura tardía");
  const latePaymentId = Number(lateCheckoutResp.body.checkout.payment.id);
  await db`UPDATE payments SET provider = 'SIMULATED' WHERE id = ${latePaymentId}`;
  // Deliberately emulate the cancelled/expired state before the asynchronous provider delivery.
  await db`UPDATE orders SET status = 'CANCELLED', cancellation_reason = 'reservation_expired' WHERE id = ${lateOrder.id}`;
  await db`UPDATE inventory_reservations SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 minute' WHERE order_id = ${lateOrder.id}`;
  const lateRaw = JSON.stringify({ eventId: "ci-webhook-late-001", paymentId: latePaymentId, type: "payment.succeeded", providerReference: "ci-capture-late-001", amountMinor: lateCheckoutResp.body.checkout.amountMinor, currency: lateCheckoutResp.body.checkout.currency });
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
  const anonymousQueue = await api("/v1/internal/payments/webhook-exceptions");
  ok([401, 403].includes(anonymousQueue.response.status),
    "cola de excepciones exige autenticación interna");
  const exceptionQueue = await api("/v1/internal/payments/webhook-exceptions", {
    headers: { "x-internal-key": internalKey }
  });
  ok(exceptionQueue.response.status === 200 &&
     Array.isArray(exceptionQueue.body.data) &&
     exceptionQueue.body.data.some((item: any) =>
       item.event_id === "ci-webhook-late-001" &&
       item.code === "LATE_PAYMENT_EXPIRED_RESERVATION" &&
       item.provider_reference === "ci-capture-late-001" &&
       item.resolution_status === "PENDING_REVIEW"),
    "cola interna autorizada expone excepción de captura tardía y evidencia");
  const invalidQueue = await api("/v1/internal/payments/webhook-exceptions?status=INVALID", {
    headers: { "x-internal-key": internalKey }
  });
  ok(invalidQueue.response.status === 400 && invalidQueue.body.error === "invalid_status",
    "cola de excepciones rechaza filtros inválidos");
  const lateAudit = await db`SELECT COUNT(*)::int AS total FROM audit_events WHERE correlation_id = 'ci-webhook-late-001' AND action = 'payment.webhook_exception'`;
  ok(Number(lateAudit[0]?.total) === 1, "webhooks tardíos concurrentes dejan una sola auditoría");
  const latePaymentState = await db`SELECT status FROM payments WHERE id = ${latePaymentId}`;
  ok(latePaymentState[0]?.status === "PENDING", "captura tardía no confirma ni liquida automáticamente el pago");
  const latePaymentHistory = await db`SELECT COUNT(*)::int AS total FROM payment_status_history WHERE payment_id = ${latePaymentId} AND actor = 'webhook:simulated'`;
  ok(Number(latePaymentHistory[0]?.total) === 0, "captura tardía no genera transición PAID");
  const unknownPaymentId = 999999999;
  const unknownRaw = JSON.stringify({ eventId: "ci-webhook-unknown-001", paymentId: unknownPaymentId, type: "payment.succeeded", providerReference: "ci-capture-unknown-001", amountMinor: cashCheckout.amountMinor, currency: cashCheckout.currency });
  const unknownSignature = await signSimulatedWebhook(webhookSecret, unknownRaw);
  const unknown = await api("/v1/webhooks/payments/simulated", {
    method: "POST", headers: { "content-type": "application/json", "x-simulated-signature": unknownSignature },
    body: unknownRaw
  });
  ok(unknown.response.status === 404, "webhook para pago inexistente se rechaza");
  const unknownStored = await db`SELECT COUNT(*)::int AS total FROM simulated_payment_events WHERE event_id = 'ci-webhook-unknown-001'`;
  ok(Number(unknownStored[0]?.total) === 0, "pago inexistente no deja evento PROCESSING huérfano");
  const lateSales = await db`SELECT COUNT(*)::int AS total FROM inventory_movements WHERE reference = ${"order:" + lateOrder.id} AND movement_type = 'SALE'`;
  ok(Number(lateSales[0]?.total) === 0, "pago tardío no genera salida Kardex");
  const lateOrderState = await db`SELECT status FROM orders WHERE id = ${lateOrder.id}`;
  ok(lateOrderState[0]?.status === "CANCELLED", "webhook tardío no reactiva venta");

// Governed refund requests use human staff sessions, CSRF and dual control.
// They never execute a refund with the external provider.
const reviewerPassword = "Manager-" + crypto.randomUUID() + "-Strong9!";
const approverPassword = "Admin-" + crypto.randomUUID() + "-Strong9!";
const reviewerHash = await Bun.password.hash(reviewerPassword, { algorithm: "argon2id" });
const approverHash = await Bun.password.hash(approverPassword, { algorithm: "argon2id" });
const reviewerRows = await db`
  INSERT INTO staff_users(email_normalized, display_name, password_hash, status, email_verified_at)
  VALUES('webhook-reviewer-ci@example.test', 'Webhook Manager CI', ${reviewerHash}, 'ACTIVE', NOW())
  RETURNING id`;
const approverRows = await db`
  INSERT INTO staff_users(email_normalized, display_name, password_hash, status, email_verified_at)
  VALUES('webhook-approver-ci@example.test', 'Webhook Admin CI', ${approverHash}, 'ACTIVE', NOW())
  RETURNING id`;
const managerRole = await db`SELECT id FROM roles WHERE code = 'MANAGER'`;
const adminRole = await db`SELECT id FROM roles WHERE code = 'ADMIN'`;
await db`
  INSERT INTO user_role_assignments(user_id, role_id, scope_type, scope_location_id)
  VALUES
    (${Number(reviewerRows[0].id)}, ${Number(managerRole[0].id)}, 'GLOBAL', NULL),
    (${Number(approverRows[0].id)}, ${Number(adminRole[0].id)}, 'GLOBAL', NULL)`;
const loginReviewStaff = async (email: string, password: string) => {
  const login = await api("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return {
    status: login.response.status,
    cookie: (login.response.headers.get("set-cookie") || "").split(";")[0],
    csrf: String(login.body.csrfToken || "")
  };
};
const reviewer = await loginReviewStaff("webhook-reviewer-ci@example.test", reviewerPassword);
const approver = await loginReviewStaff("webhook-approver-ci@example.test", approverPassword);
ok(reviewer.status === 200 && approver.status === 200 &&
   reviewer.cookie.startsWith("mrstaff=") && approver.cookie.startsWith("mrstaff="),
   "gestión de excepciones utiliza dos sesiones humanas");
const lateExceptionRows = await db`
  SELECT id FROM payment_webhook_exceptions WHERE event_id = 'ci-webhook-late-001'`;
ok(lateExceptionRows.length === 1, "excepción tardía identificada para resolución");
const lateExceptionId = Number(lateExceptionRows[0]?.id);
const reviewPath = "/v1/internal/payments/webhook-exceptions/" + lateExceptionId + "/review";
const sendReview = (staff: { cookie: string; csrf: string }, action: string, key: string,
                    reason: string, includeCsrf = true) =>
  api(reviewPath, {
    method: "PATCH",
    headers: {
      cookie: staff.cookie, "content-type": "application/json",
      "idempotency-key": key,
      ...(includeCsrf ? { "x-csrf-token": staff.csrf } : {})
    },
    body: JSON.stringify({ action, reason })
  });
const reviewReason = "Revisión del comprobante de pago tardío en conciliación";
const anonymousReview = await api(reviewPath, {
  method: "PATCH",
  headers: { "content-type": "application/json", "idempotency-key": "ci-review-unauthorized" },
  body: JSON.stringify({ action: "START_REVIEW", reason: reviewReason })
});
ok(anonymousReview.response.status === 401, "revisión rechaza solicitudes anónimas");
const serviceReview = await api(reviewPath, {
  method: "PATCH",
  headers: {
    "content-type": "application/json", "idempotency-key": "ci-review-service",
    "x-internal-key": internalKey
  },
  body: JSON.stringify({ action: "START_REVIEW", reason: reviewReason })
});
ok(serviceReview.response.status === 403 && serviceReview.body.error === "staff_approval_required",
   "token de servicio no sustituye aprobación humana");
const missingCsrf = await sendReview(reviewer, "START_REVIEW", "ci-review-no-csrf", reviewReason, false);
ok(missingCsrf.response.status === 403 && missingCsrf.body.error === "csrf_required",
   "mutación de excepción exige CSRF");
const [reviewA, reviewB] = await Promise.all([
  sendReview(reviewer, "START_REVIEW", "ci-review-start-001", reviewReason),
  sendReview(reviewer, "START_REVIEW", "ci-review-start-001", reviewReason)
]);
ok(reviewA.response.status === 200 && reviewB.response.status === 200 &&
   reviewA.body.status === "IN_REVIEW" && reviewB.body.status === "IN_REVIEW" &&
   [reviewA.body.replayed, reviewB.body.replayed].filter(Boolean).length === 1,
   "inicio de revisión concurrente es idempotente");
const managerRefundAttempt = await sendReview(reviewer, "REQUEST_REFUND", "ci-review-manager-refund",
  "Solicitar devolución tras comprobar la captura de fondos");
ok(managerRefundAttempt.response.status === 403, "MANAGER no puede autorizar reembolso");
const refundReason = "Aprobar solicitud de reembolso por captura de reserva expirada";
const [refundA, refundB] = await Promise.all([
  sendReview(approver, "REQUEST_REFUND", "ci-review-refund-001", refundReason),
  sendReview(approver, "REQUEST_REFUND", "ci-review-refund-001", refundReason)
]);
ok(refundA.response.status === 200 && refundB.response.status === 200 &&
   refundA.body.status === "REFUND_REQUESTED" && refundB.body.status === "REFUND_REQUESTED" &&
   [refundA.body.replayed, refundB.body.replayed].filter(Boolean).length === 1,
   "solicitud de reembolso queda pendiente sin duplicarse");
const changedPayload = await sendReview(approver, "REQUEST_REFUND", "ci-review-refund-001",
  "Diferente motivo para igual clave de idempotencia de reembolso");
ok(changedPayload.response.status === 409 && changedPayload.body.error === "idempotency_conflict",
   "clave de aprobación con distinto motivo genera conflicto");
const invalidTransition = await sendReview(reviewer, "REQUEST_REVALIDATION", "ci-review-revalidate-after-refund",
  "Intento de revalidación tras aprobar la solicitud de reembolso");
ok(invalidTransition.response.status === 409 && invalidTransition.body.error === "invalid_transition",
   "resolución de reembolso impide transición contradictoria");
const reviewRows = await db`
  SELECT resolution_status, reviewed_by_user_id, last_action_by_user_id
  FROM payment_webhook_exceptions WHERE id = ${lateExceptionId}`;
ok(reviewRows[0]?.resolution_status === "REFUND_REQUESTED" &&
   Number(reviewRows[0]?.reviewed_by_user_id) === Number(reviewerRows[0].id) &&
   Number(reviewRows[0]?.last_action_by_user_id) === Number(approverRows[0].id),
   "doble control conserva revisor y aprobador distintos");
const reviewActions = await db`
  SELECT action FROM payment_webhook_exception_review_actions
  WHERE exception_id = ${lateExceptionId} ORDER BY id`;
ok(reviewActions.length === 2 &&
   reviewActions[0].action === "START_REVIEW" && reviewActions[1].action === "REQUEST_REFUND",
   "reintentos no duplican acciones de revisión");
const reviewAudits = await db`
  SELECT COUNT(*)::int AS total FROM audit_events
  WHERE action = 'payment.webhook_exception_reviewed'
    AND resource_id = ${String(lateExceptionId)}`;
ok(Number(reviewAudits[0]?.total) === 2, "doble control registra exactamente dos auditorías");
const pendingRefundRequests = await db`
  SELECT COUNT(*)::int AS total, MAX(status) AS status
  FROM payment_exception_refund_requests WHERE payment_id = ${latePaymentId}`;
ok(Number(pendingRefundRequests[0]?.total) === 1 &&
   pendingRefundRequests[0]?.status === "APPROVED_NOT_SUBMITTED",
   "aprobación produce solicitud de reembolso única y sin ejecución externa");
const refundPayment = await db`SELECT status FROM payments WHERE id = ${latePaymentId}`;
ok(refundPayment[0]?.status === "PENDING", "solicitar reembolso no altera estado de pago");
const refundSales = await db`
  SELECT COUNT(*)::int AS total FROM inventory_movements
  WHERE reference = ${"order:" + lateOrder.id} AND movement_type = 'SALE'`;
ok(Number(refundSales[0]?.total) === 0, "revisión de reembolso no consume Kardex");

// An ADMIN cannot both review and approve their own refund request.
const mismatchRows = await db`
  SELECT id FROM payment_webhook_exceptions WHERE event_id = 'ci-webhook-mismatch-001'`;
const mismatchExceptionId = Number(mismatchRows[0]?.id);
const mismatchPath = "/v1/internal/payments/webhook-exceptions/" + mismatchExceptionId + "/review";
const selfReview = await api(mismatchPath, {
  method: "PATCH",
  headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf,
    "content-type": "application/json", "idempotency-key": "ci-self-review-start" },
  body: JSON.stringify({ action: "START_REVIEW", reason: "Revisión de discrepancia firmada con importe diferente" })
});
ok(selfReview.response.status === 200 && selfReview.body.status === "IN_REVIEW",
   "administrador puede iniciar revisión");
const selfRefund = await api(mismatchPath, {
  method: "PATCH",
  headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf,
    "content-type": "application/json", "idempotency-key": "ci-self-refund-approval" },
  body: JSON.stringify({ action: "REQUEST_REFUND", reason: "Aprobación de reembolso propio prohibida" })
});
ok(selfRefund.response.status === 403 && selfRefund.body.error === "separate_refund_approver_required",
   "revisor no puede aprobar su propio reembolso");
const revalidation = await api(mismatchPath, {
  method: "PATCH",
  headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf,
    "content-type": "application/json", "idempotency-key": "ci-mismatch-revalidate-001" },
  body: JSON.stringify({ action: "REQUEST_REVALIDATION", reason: "Verificar monto y referencia antes de revalidación manual" })
});
ok(revalidation.response.status === 200 && revalidation.body.status === "REVALIDATION_REQUESTED",
   "revalidación queda solicitada sin activar venta ni modificar Kardex");
// A different event ID for the same captured payment cannot create a second refund request.
const duplicateCaptureRaw = JSON.stringify({
  eventId: "ci-webhook-late-002", paymentId: latePaymentId, type: "payment.succeeded",
  providerReference: "ci-capture-late-001",
  amountMinor: lateCheckoutResp.body.checkout.amountMinor,
  currency: lateCheckoutResp.body.checkout.currency
});
const duplicateCapture = await api("/v1/webhooks/payments/simulated", {
  method: "POST",
  headers: { "content-type": "application/json",
    "x-simulated-signature": await signSimulatedWebhook(webhookSecret, duplicateCaptureRaw) },
  body: duplicateCaptureRaw
});
ok(duplicateCapture.response.status === 200 &&
   duplicateCapture.body.outcome === "LATE_PAYMENT_EXPIRED_RESERVATION",
   "otro eventId puede registrar misma captura tardía para investigación");
const secondException = await db`
  SELECT id FROM payment_webhook_exceptions WHERE event_id = 'ci-webhook-late-002'`;
ok(secondException.length === 1, "captura tardía duplicada deja segunda excepción trazable");
const secondPath = "/v1/internal/payments/webhook-exceptions/" + Number(secondException[0].id) + "/review";
const secondReview = await api(secondPath, {
  method: "PATCH",
  headers: { cookie: reviewer.cookie, "x-csrf-token": reviewer.csrf,
    "content-type": "application/json", "idempotency-key": "ci-second-review-start" },
  body: JSON.stringify({ action: "START_REVIEW", reason: "Revisar segundo aviso de captura tardía del mismo pago" })
});
ok(secondReview.response.status === 200 && secondReview.body.status === "IN_REVIEW",
   "segundo evento puede iniciar investigación");
const duplicateRefundRequest = await api(secondPath, {
  method: "PATCH",
  headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf,
    "content-type": "application/json", "idempotency-key": "ci-second-refund-request" },
  body: JSON.stringify({ action: "REQUEST_REFUND", reason: "Intentar duplicar solicitud sobre el mismo pago capturado" })
});
ok(duplicateRefundRequest.response.status === 409 &&
   duplicateRefundRequest.body.error === "refund_already_requested",
   "la misma captura no genera segundo reembolso solicitado con otro eventId");
const stillOneRefundRequest = await db`
  SELECT COUNT(*)::int AS total FROM payment_exception_refund_requests WHERE payment_id = ${latePaymentId}`;
ok(Number(stillOneRefundRequest[0]?.total) === 1, "solo existe una solicitud de reembolso por pago");
}

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — checkout/payments");
await db.close();
