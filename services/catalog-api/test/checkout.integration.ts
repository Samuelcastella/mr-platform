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

await db.unsafe("TRUNCATE TABLE payment_status_history, payment_attempts, payments, checkout_sessions, order_status_history, inventory_reservations, order_items, orders, inventory_movements, inventory, product_variants, products, locations RESTART IDENTITY CASCADE");

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
const codCheckoutResp = await createCheckout("ci-checkout-cod-001", codOrder, "CASH_ON_DELIVERY");
ok(codCheckoutResp.response.status === 201, "crea checkout COD");
const codCheckout = codCheckoutResp.body.checkout;
ok(codCheckout.orderStatus === "CONFIRMED", "COD permite Order CONFIRMED");
ok(codCheckout.payment?.status === "PENDING" && codCheckout.payment?.method === "CASH_ON_DELIVERY", "COD mantiene Payment PENDING");

const paymentRows = await db`SELECT COUNT(*)::int AS count FROM payments`;
const checkoutRows = await db`SELECT COUNT(*)::int AS count FROM checkout_sessions`;
ok(Number(paymentRows[0]?.count) === 3 && Number(checkoutRows[0]?.count) === 3, "un checkout produce exactamente un Payment");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — checkout/payments");
await db.close();
