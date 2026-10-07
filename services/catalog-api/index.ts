import { SQL } from "bun";

const db = new SQL({
  hostname: Bun.env.PGHOST!,
  port: Number(Bun.env.PGPORT || 5432),
  username: Bun.env.PGUSER!,
  password: Bun.env.PGPASSWORD!,
  database: Bun.env.PGDATABASE!,
  tls: false,
  max: 5
});

await db`
CREATE TABLE IF NOT EXISTS locations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'store',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await db`
CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country_code TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await db`
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT,
  brand TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await db`
CREATE TABLE IF NOT EXISTS product_variants (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT,
  size TEXT,
  color TEXT,
  cost NUMERIC(12,2),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'HNL',
  supplier_id BIGINT REFERENCES suppliers(id),
  origin_country_code TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

await db`
CREATE TABLE IF NOT EXISTS inventory (
  variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (variant_id, location_id),
  CHECK (quantity >= 0),
  CHECK (reserved >= 0)
)`;

await db`
CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  variant_id BIGINT NOT NULL REFERENCES product_variants(id),
  location_id BIGINT NOT NULL REFERENCES locations(id),
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      const result = await db`SELECT NOW() AS db_time`;
      return Response.json({ ok: true, service: "MR עדולם Catalog API", database: "connected", dbTime: result[0].db_time });
    }
    if (url.pathname === "/v1/products" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const rows = await db`
        SELECT p.id, p.name, p.slug, p.category, p.brand, p.status, p.created_at,
               MIN(v.price) AS price, MIN(v.currency) AS currency,
               COALESCE(SUM(i.quantity - i.reserved), 0)::int AS stock
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id AND v.active
        LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE (${status}::text IS NULL OR p.status = ${status}::text)
        GROUP BY p.id
        ORDER BY p.id DESC LIMIT 100`;
      return Response.json({ data: rows });
    }
    return Response.json({ service: "MR עדולם Catalog API", version: "0.1.0", endpoints: ["/health", "/v1/products"] });
  }
});
