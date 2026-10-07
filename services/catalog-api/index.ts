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

await db`
CREATE TABLE IF NOT EXISTS public_inquiries (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  country_code TEXT,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind IN ('supplier','product_request','support','partnership','notify'))
)`;

await db`
CREATE INDEX IF NOT EXISTS idx_public_inquiries_status_created
ON public_inquiries(status, created_at DESC)`;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      const result = await db`SELECT NOW() AS db_time`;
      return json({ ok: true, service: "MR עדולם Catalog API", database: "connected", dbTime: result[0].db_time });
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
      return json({ data: rows });
    }

    if (url.pathname === "/v1/inquiries" && req.method === "POST") {
      const length = Number(req.headers.get("content-length") || 0);
      if (length > 16384) return json({ error: "payload_too_large" }, 413);

      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      if (clean(body.website, 120)) return json({ ok: true }, 202);

      const allowed = new Set(["supplier", "product_request", "support", "partnership", "notify"]);
      const kind = clean(body.kind, 32);
      const name = clean(body.name, 120);
      const contact = clean(body.contact, 180);
      const countryCode = clean(body.countryCode, 2).toUpperCase() || null;
      const message = clean(body.message, 2000) || null;
      const rawProductId = Number(body.productId);
      const productId = Number.isSafeInteger(rawProductId) && rawProductId > 0 ? rawProductId : null;
      const metadata =
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? JSON.stringify(body.metadata).slice(0, 4000)
          : "{}";

      if (!allowed.has(kind)) return json({ error: "invalid_kind" }, 400);
      if (name.length < 2) return json({ error: "name_required" }, 400);
      if (contact.length < 4) return json({ error: "contact_required" }, 400);
      if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) return json({ error: "invalid_country" }, 400);

      const rows = await db`
        INSERT INTO public_inquiries
          (kind, name, contact, country_code, product_id, message, metadata)
        VALUES
          (${kind}, ${name}, ${contact}, ${countryCode}, ${productId}, ${message}, ${metadata}::jsonb)
        RETURNING id, status, created_at`;

      return json({
        ok: true,
        inquiry: {
          id: rows[0].id,
          status: rows[0].status,
          createdAt: rows[0].created_at
        }
      }, 201);
    }

    if (url.pathname === "/v1/inquiries") {
      return json({ error: "method_not_allowed" }, 405);
    }

    return json({
      service: "MR עדולם Catalog API",
      version: "0.2.0",
      endpoints: ["/health", "/v1/products", "/v1/inquiries"]
    });
  }
});
