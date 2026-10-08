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

const internalHeaders = {
  "content-type": "application/json",
  "x-internal-key": serviceKey
};

await db.unsafe(
  "TRUNCATE TABLE inventory_movements, inventory, product_variants, products, locations RESTART IDENTITY CASCADE"
);

const created = await api("/v1/internal/catalog/products", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({
    name: "Vestido Prueba CI",
    category: "Ropa",
    brand: "MR",
    status: "draft",
    imageUrl: "https://example.com/vestido-prueba-ci.jpg",
    variants: [{
      sku: "MR-CI-VEST-001",
      size: "M",
      color: "Negro",
      cost: 400,
      price: 850,
      currency: "HNL",
      stock: 5
    }]
  })
});

ok(created.response.status === 201, "crea producto en borrador");
const productId = Number(created.body?.product?.id);
const variantId = Number(created.body?.variants?.[0]?.id);
ok(productId > 0, "producto recibe id");
ok(variantId > 0, "variante recibe id");
ok(Number(created.body?.variants?.[0]?.stock) === 5, "stock inicial registrado");

const hidden = await api("/v1/products?status=active");
ok(hidden.response.status === 200, "catálogo público responde");
ok(
  !Array.isArray(hidden.body?.data) || !hidden.body.data.some((p: any) => Number(p.id) === productId),
  "borrador no aparece públicamente"
);

const published = await api("/v1/internal/catalog/products/" + productId, {
  method: "PATCH",
  headers: internalHeaders,
  body: JSON.stringify({ status: "active" })
});
ok(published.response.status === 200, "publica producto");
ok(published.body?.product?.status === "active", "estado cambia a active");

const visible = await api("/v1/products?status=active");
const publicProduct = Array.isArray(visible.body?.data)
  ? visible.body.data.find((p: any) => Number(p.id) === productId)
  : null;
ok(Boolean(publicProduct), "producto publicado aparece en storefront API");
ok(Number(publicProduct?.stock) === 5, "storefront API expone stock autoritativo");
ok(publicProduct?.variants?.[0]?.sku === "MR-CI-VEST-001", "storefront API expone SKU");
ok(
  publicProduct?.images?.[0]?.url === "https://example.com/vestido-prueba-ci.jpg",
  "storefront API expone imagen principal"
);

const adjusted = await api("/v1/internal/catalog/variants/" + variantId + "/stock", {
  method: "POST",
  headers: internalHeaders,
  body: JSON.stringify({ quantity: 8 })
});
ok(adjusted.response.status === 200, "ajusta stock desde ruta interna");
ok(Number(adjusted.body?.quantity) === 8, "stock queda en 8");

const refreshed = await api("/v1/products?status=active");
const refreshedProduct = Array.isArray(refreshed.body?.data)
  ? refreshed.body.data.find((p: any) => Number(p.id) === productId)
  : null;
ok(Number(refreshedProduct?.stock) === 8, "nuevo stock llega al catálogo público");

const movements = await db`
  SELECT movement_type, quantity
  FROM inventory_movements
  WHERE variant_id=${variantId}
  ORDER BY id`;
ok(
  movements.some((x: any) => x.movement_type === "INITIAL_STOCK" && Number(x.quantity) === 5),
  "registra movimiento de stock inicial"
);
ok(
  movements.some((x: any) => x.movement_type === "ADJUSTMENT" && Number(x.quantity) === 3),
  "registra movimiento de ajuste"
);

await db.end();

if (failures) {
  console.error("\nCatalog integration failures:", failures);
  process.exit(1);
}
console.log("\nCatalog integration OK");
