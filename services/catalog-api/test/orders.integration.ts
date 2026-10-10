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

async function createOrder(key: string, variantId: number, quantity = 1) {
  return api("/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key
    },
    body: JSON.stringify({
      channel: "WEB",
      customer: { name: "Cliente CI", phone: "9999-0000" },
      items: [{ variantId, quantity }]
    })
  });
}

await db.unsafe("TRUNCATE TABLE order_status_history, inventory_reservations, order_items, orders, inventory_movements, inventory, product_variants, products, locations RESTART IDENTITY CASCADE");

const loc = await db`
  INSERT INTO locations(name, country_code, type, active)
  VALUES('Tienda CI', 'HN', 'store', TRUE)
  RETURNING id`;
const locationId = Number(loc[0].id);

const product = await db`
  INSERT INTO products(name, slug, category, brand, status)
  VALUES('Camiseta CI', 'camiseta-ci', 'Ropa', 'MR', 'active')
  RETURNING id`;
const productId = Number(product[0].id);

const variants = await db`
  INSERT INTO product_variants(product_id, sku, size, color, price, currency, active)
  VALUES
    (${productId}, 'CI-CAM-M-NEG', 'M', 'Negro', 320.00, 'HNL', TRUE),
    (${productId}, 'CI-CAM-L-AZU', 'L', 'Azul', 350.00, 'HNL', TRUE),
    (${productId}, 'CI-CAM-S-BLA', 'S', 'Blanco', 300.00, 'HNL', TRUE)
  RETURNING id, sku`;
const v1 = Number(variants[0].id), v2 = Number(variants[1].id), v3 = Number(variants[2].id);

await db`
  INSERT INTO inventory(variant_id, location_id, quantity, reserved)
  VALUES
    (${v1}, ${locationId}, 1, 0),
    (${v2}, ${locationId}, 1, 0),
    (${v3}, ${locationId}, 1, 0)`;

const first = await createOrder("ci-order-0001", v1, 1);
ok(first.response.status === 201, "crea orden server-side");
ok(first.body.order?.status === "PENDING_CONFIRMATION", "orden inicia PENDING_CONFIRMATION");
ok(first.body.order?.items?.[0]?.sku === "CI-CAM-M-NEG", "snapshot conserva SKU");
ok(first.body.order?.items?.[0]?.unitPriceMinor === 32000, "precio se congela en minor units");
const firstId = Number(first.body.order?.id);
const firstToken = String(first.body.order?.token || "");

const catalogReserved = await api("/v1/products?status=active");
const item1 = catalogReserved.body.data?.find((p: any) => Number(p.id) === productId)?.variants?.find((v: any) => Number(v.id) === v1);
ok(item1?.available === 0, "reserva reduce disponibilidad autoritativa");

const replay = await createOrder("ci-order-0001", v1, 1);
ok(replay.response.status === 200 && replay.body.replayed === true, "retry idempotente devuelve orden existente");
ok(Number(replay.body.order?.id) === firstId, "retry no crea una segunda orden");

const conflict = await createOrder("ci-order-0001", v1, 2);
ok(conflict.response.status === 409 && conflict.body.error === "idempotency_conflict", "misma clave con payload distinto entra en conflicto");

const oversell = await createOrder("ci-order-0002", v1, 1);
ok(oversell.response.status === 409 && oversell.body.error === "insufficient_stock", "no permite reservar última unidad dos veces");

await db`UPDATE products SET name = 'Nombre cambiado' WHERE id = ${productId}`;
await db`UPDATE product_variants SET price = 999.99 WHERE id = ${v1}`;
const historical = await api("/v1/orders/" + firstId + "?token=" + encodeURIComponent(firstToken));
ok(historical.response.status === 200, "consulta orden con token público");
ok(historical.body.order?.items?.[0]?.productName === "Camiseta CI", "nombre histórico no cambia");
ok(historical.body.order?.items?.[0]?.unitPriceMinor === 32000, "precio histórico no cambia");

const cancelled = await api("/v1/orders/" + firstId + "/cancel?token=" + encodeURIComponent(firstToken), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
ok(cancelled.response.status === 200 && cancelled.body.order?.status === "CANCELLED", "cancelación pública valida transición");

const invAfterCancel = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${v1} AND location_id = ${locationId}`;
ok(Number(invAfterCancel[0].quantity) === 1 && Number(invAfterCancel[0].reserved) === 0, "cancelación libera reserva");

await db`UPDATE products SET name = 'Camiseta CI', status='active' WHERE id = ${productId}`;
await db`UPDATE product_variants SET price = 320.00 WHERE id = ${v1}`;
const lifecycle = await createOrder("ci-order-0003", v1, 1);
const lifecycleId = Number(lifecycle.body.order?.id);
const lifecycleToken = String(lifecycle.body.order?.token || "");
const confirmed = await api("/v1/orders/" + lifecycleId + "/confirm?token=" + encodeURIComponent(lifecycleToken), { method: "POST" });
ok(confirmed.response.status === 200 && confirmed.body.order?.status === "CONFIRMED", "confirmación pública fija reserva");

for (const status of ["PROCESSING", "READY", "COMPLETED"]) {
  const step = await api("/v1/internal/orders/" + lifecycleId + "/status", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-internal-key": internalKey },
    body: JSON.stringify({ status })
  });
  ok(step.response.status === 200 && step.body.order?.status === status, "transición interna a " + status);
}

const invConsumed = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${v1} AND location_id = ${locationId}`;
ok(Number(invConsumed[0].quantity) === 0 && Number(invConsumed[0].reserved) === 0, "COMPLETED desde READY consume inventario");
const movement = await db`SELECT movement_type, quantity FROM inventory_movements WHERE reference = ${"order:" + lifecycleId} ORDER BY id DESC LIMIT 1`;
ok(movement[0]?.movement_type === "SALE" && Number(movement[0]?.quantity) === -1, "consumo genera movimiento SALE");

const invalid = await api("/v1/internal/orders/" + lifecycleId + "/status", {
  method: "PATCH",
  headers: { "content-type": "application/json", "x-internal-key": internalKey },
  body: JSON.stringify({ status: "PROCESSING" })
});
ok(invalid.response.status === 409 && invalid.body.error === "invalid_transition", "rechaza transición inválida");

const concurrent = await Promise.all([
  createOrder("ci-order-0004", v2, 1),
  createOrder("ci-order-0005", v2, 1)
]);
const statuses = concurrent.map(x => x.response.status).sort();
ok(statuses[0] === 201 && statuses[1] === 409, "concurrencia permite un solo ganador por última unidad");
const invConcurrent = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${v2} AND location_id = ${locationId}`;
ok(Number(invConcurrent[0].quantity) - Number(invConcurrent[0].reserved) === 0, "concurrencia nunca produce disponibilidad negativa");

// Stress regression: 50 independent buyers race for one unit in the isolated CI database.
// This file TRUNCATEs fixtures above; NEVER run it against production PostgreSQL.
const stress = await Promise.all(
  Array.from({ length: 50 }, (_, i) => createOrder("ci-stress-" + i, v2, 1))
);
const stressSuccess = stress.filter(x => x.response.status === 201);
const stressRejected = stress.filter(x => x.response.status === 409 && x.body.error === "insufficient_stock");
// v2 was already reserved by the two-buyer test; release its winner before this
// separate stress test, or all 50 should correctly be rejected.
ok(stressSuccess.length === 0 && stressRejected.length === 50,
  "50 compras adicionales no pueden reservar una unidad ya agotada");
const stressInventory = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${v2} AND location_id = ${locationId}`;
ok(Number(stressInventory[0].quantity) === 1 &&
   Number(stressInventory[0].reserved) === 1,
  "50 solicitudes no alteran el saldo ni generan disponibilidad negativa");

const expiring = await createOrder("ci-order-0006", v3, 1);
const expiringId = Number(expiring.body.order?.id);
const expiringToken = String(expiring.body.order?.token || "");
await db`UPDATE inventory_reservations SET expires_at = NOW() - INTERVAL '1 minute' WHERE order_id = ${expiringId} AND status = 'ACTIVE'`;
const expire = await api("/v1/internal/reservations/expire", {
  method: "POST",
  headers: { "x-internal-key": internalKey }
});
ok(expire.response.status === 200 && Number(expire.body.expired) >= 1, "expiración libera reservas vencidas");
const expiredOrder = await api("/v1/orders/" + expiringId + "?token=" + encodeURIComponent(expiringToken));
ok(expiredOrder.body.order?.status === "CANCELLED", "orden vencida queda CANCELLED");
const invExpired = await db`SELECT quantity, reserved FROM inventory WHERE variant_id = ${v3} AND location_id = ${locationId}`;
ok(Number(invExpired[0].quantity) === 1 && Number(invExpired[0].reserved) === 0, "expiración devuelve disponibilidad");

const unauth = await api("/v1/internal/orders");
ok(unauth.response.status === 401, "rutas internas requieren autenticación");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — orders/reservations/idempotency");
await db.close();
