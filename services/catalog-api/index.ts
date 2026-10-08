import { SQL } from "bun";
import { ensureOrdersSchema, handleOrders } from "./orders";
import { ensureCheckoutSchema, handleCheckout } from "./checkout";
import { ensureFulfillmentSchema, handleFulfillment } from "./fulfillment";
import { ensureAuthSchema, handleAuth } from "./auth";
import { ensureCustomersSchema, handleCustomers } from "./customers";
import { ensureProcurementSchema, handleProcurement } from "./procurement";
import { ensureReturnsSchema, handleReturns } from "./returns";
import { ensureInternalOpsSchema, handleInternal } from "./internal-routes";
import { handleInternalCatalog } from "./catalog-internal";
import { ensureVendorPortalSchema, handleVendorPortal } from "./vendor-portal";

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

await db`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS public_token TEXT`;
await db`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
await db`
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_inquiries_public_token
ON public_inquiries(public_token) WHERE public_token IS NOT NULL`;
await db`
CREATE INDEX IF NOT EXISTS idx_public_inquiries_status_created
ON public_inquiries(status, created_at DESC)`;

await db`
CREATE TABLE IF NOT EXISTS public_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  session_id TEXT,
  route TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_name IN ('page_view','cta_click','intent_submit','add_to_cart','checkout_start'))
)`;
await db`
CREATE INDEX IF NOT EXISTS idx_public_events_name_created
ON public_events(event_name, created_at DESC)`;

await ensureOrdersSchema(db);
await ensureCheckoutSchema(db);
await ensureFulfillmentSchema(db);
await ensureAuthSchema(db);
await ensureCustomersSchema(db);
await ensureProcurementSchema(db);
await ensureReturnsSchema(db);
await ensureInternalOpsSchema(db);
await ensureVendorPortalSchema(db);

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

const eventNames = new Set(["page_view","cta_click","intent_submit","add_to_cart","checkout_start"]);

Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      const result = await db`SELECT NOW() AS db_time`;
      return json({ ok: true, service: "MR עדולם Catalog API", database: "connected", dbTime: result[0].db_time });
    }

    const authResponse = await handleAuth(req, url, db);
    if (authResponse) return authResponse;

    const customersResponse = await handleCustomers(req, url, db);
    if (customersResponse) return customersResponse;

    const procurementResponse = await handleProcurement(req, url, db);
    if (procurementResponse) return procurementResponse;

    const returnsResponse = await handleReturns(req, url, db);
    if (returnsResponse) return returnsResponse;

    const vendorResponse = await handleVendorPortal(req, url, db);
    if (vendorResponse) return vendorResponse;

    if (url.pathname === "/v1/products" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const rows = await db`
        SELECT
          p.id, p.name, p.slug, p.category, p.brand, p.status, p.created_at,
          COALESCE(MIN(v.price), 0) AS price,
          COALESCE(MIN(v.currency), 'HNL') AS currency,
          COALESCE(SUM(v.available), 0)::int AS stock,
          COALESCE(
            json_agg(
              json_build_object(
                'id', v.id,
                'sku', v.sku,
                'barcode', v.barcode,
                'size', v.size,
                'color', v.color,
                'price', v.price,
                'currency', v.currency,
                'available', v.available
              )
              ORDER BY v.id
            ) FILTER (WHERE v.id IS NOT NULL),
            '[]'::json
          ) AS variants
        FROM products p
        LEFT JOIN (
          SELECT
            pv.id, pv.product_id, pv.sku, pv.barcode, pv.size, pv.color,
            pv.price, pv.currency,
            COALESCE(SUM(i.quantity - i.reserved), 0)::int AS available
          FROM product_variants pv
          LEFT JOIN inventory i ON i.variant_id = pv.id
          WHERE pv.active
          GROUP BY pv.id
        ) v ON v.product_id = p.id
        WHERE (${status}::text IS NULL OR p.status = ${status}::text)
        GROUP BY p.id
        ORDER BY p.id DESC
        LIMIT 100`;
      return json({ data: rows });
    }

    const orderResponse = await handleOrders(req, url, db, clean);
    if (orderResponse) return orderResponse;

    const fulfillmentResponse = await handleFulfillment(req, url, db, clean);
    if (fulfillmentResponse) return fulfillmentResponse;

    const checkoutResponse = await handleCheckout(req, url, db, clean);
    if (checkoutResponse) return checkoutResponse;

    const internalCatalogResponse = await handleInternalCatalog(req, url, db, clean);
    if (internalCatalogResponse) return internalCatalogResponse;

    const internalResponse = await handleInternal(req, url, db, clean);
    if (internalResponse) return internalResponse;

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

      const publicToken = crypto.randomUUID();
      const rows = await db`
        INSERT INTO public_inquiries
          (kind, name, contact, country_code, product_id, message, metadata, public_token)
        VALUES
          (${kind}, ${name}, ${contact}, ${countryCode}, ${productId}, ${message}, ${metadata}::jsonb, ${publicToken})
        RETURNING id, status, created_at, updated_at`;

      return json({
        ok: true,
        inquiry: {
          id: rows[0].id,
          token: publicToken,
          status: rows[0].status,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at
        }
      }, 201);
    }

    const publicInquiryMatch = url.pathname.match(/^\/v1\/inquiries\/(\d+)$/);
    if (publicInquiryMatch && req.method === "GET") {
      const id = Number(publicInquiryMatch[1]);
      const token = clean(url.searchParams.get("token"), 80);
      if (!token) return json({ error: "token_required" }, 401);

      const rows = await db`
        SELECT i.id, i.kind, i.status, i.created_at, i.updated_at,
               p.id AS product_id, p.name AS product_name, p.slug AS product_slug
        FROM public_inquiries i
        LEFT JOIN products p ON p.id = i.product_id
        WHERE i.id = ${id} AND i.public_token = ${token}
        LIMIT 1`;

      if (!rows.length) return json({ error: "not_found" }, 404);
      const row = rows[0];
      return json({
        inquiry: {
          id: row.id,
          kind: row.kind,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          product: row.product_id ? { id: row.product_id, name: row.product_name, slug: row.product_slug } : null
        }
      });
    }

    if (url.pathname === "/v1/events" && req.method === "POST") {
      const length = Number(req.headers.get("content-length") || 0);
      if (length > 8192) return json({ error: "payload_too_large" }, 413);
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

      const eventName = clean(body.eventName, 40);
      const sessionId = clean(body.sessionId, 80) || null;
      const route = clean(body.route, 180) || null;
      const metadata =
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? JSON.stringify(body.metadata).slice(0, 3000)
          : "{}";

      if (!eventNames.has(eventName)) return json({ error: "invalid_event" }, 400);

      await db`
        INSERT INTO public_events(event_name, session_id, route, metadata)
        VALUES(${eventName}, ${sessionId}, ${route}, ${metadata}::jsonb)`;
      return json({ ok: true }, 201);
    }

    if (url.pathname === "/v1/inquiries" || url.pathname === "/v1/events") {
      return json({ error: "method_not_allowed" }, 405);
    }

    return json({
      service: "MR עדולם Catalog API",
      version: "0.10.0",
      endpoints: ["/health", "/v1/auth/login", "/v1/auth/logout", "/v1/auth/me", "/v1/security/bootstrap", "/v1/products", "/v1/orders", "/v1/orders/:id", "/v1/checkouts", "/v1/checkouts/:id", "/v1/fulfillment/options", "/v1/fulfillments", "/v1/fulfillments/:id", "/v1/internal/catalog", "/v1/internal/catalog/products", "/v1/internal/catalog/products/:id", "/v1/internal/catalog/products/:id/variants", "/v1/internal/catalog/variants/:id/stock", "/v1/internal/customers", "/v1/internal/suppliers", "/v1/internal/procurement/purchase-orders", "/v1/inquiries", "/v1/inquiries/:id", "/v1/events"]
    });
  }
});
