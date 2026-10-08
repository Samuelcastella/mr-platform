import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const VENDOR_COOKIE = "mrvendor";
const SESSION_HOURS = Math.max(1, Math.min(24, Number(Bun.env.VENDOR_SESSION_HOURS || 8)));

const json = (body: unknown, status = 200, extra: Record<string,string> = {}) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra
    }
  });

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const normalizeEmail = (value: unknown) => clean(value, 254).toLowerCase();
const validEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

function randomToken(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

function sha256(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(req: Request, name: string) {
  const header = req.headers.get("cookie") || "";
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function vendorCookie(token: string, maxAgeSeconds: number) {
  return [
    `${VENDOR_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ].join("; ");
}

function clearVendorCookie() {
  return [
    `${VENDOR_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

type VendorSession = {
  sessionId: number;
  vendorUserId: number;
  supplierId: number;
  supplierName: string;
  email: string;
  displayName: string;
  csrfHash: string;
};

async function readVendorSession(req: Request, db: DB): Promise<VendorSession | null> {
  const token = cookieValue(req, VENDOR_COOKIE);
  if (!token) return null;

  const rows = await db`
    SELECT
      s.id AS session_id, s.vendor_user_id, s.csrf_hash, s.status AS session_status,
      s.expires_at, u.supplier_id, u.email_normalized, u.display_name,
      u.status AS user_status, sp.name AS supplier_name
    FROM vendor_sessions s
    JOIN vendor_users u ON u.id = s.vendor_user_id
    JOIN suppliers sp ON sp.id = u.supplier_id
    WHERE s.token_hash = ${sha256(token)}
    LIMIT 1`;
  if (!rows.length) return null;

  const row = rows[0];
  if (row.session_status !== "ACTIVE" || row.user_status !== "ACTIVE") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db`UPDATE vendor_sessions SET status='EXPIRED' WHERE id=${Number(row.session_id)}`;
    return null;
  }

  await db`UPDATE vendor_sessions SET last_seen_at=NOW() WHERE id=${Number(row.session_id)}`;

  return {
    sessionId: Number(row.session_id),
    vendorUserId: Number(row.vendor_user_id),
    supplierId: Number(row.supplier_id),
    supplierName: row.supplier_name,
    email: row.email_normalized,
    displayName: row.display_name,
    csrfHash: row.csrf_hash
  };
}

async function requireVendor(req: Request, db: DB, mutation = false) {
  const actor = await readVendorSession(req, db);
  if (!actor) return { ok: false as const, response: json({ error: "unauthorized" }, 401) };
  if (mutation) {
    const csrf = req.headers.get("x-csrf-token") || "";
    if (!csrf || !safeEqual(sha256(csrf), actor.csrfHash)) {
      return { ok: false as const, response: json({ error: "csrf_required" }, 403) };
    }
  }
  return { ok: true as const, actor };
}

async function vendorLocation(db: DB, supplierId: number) {
  const existing = await db`
    SELECT id
    FROM locations
    WHERE active AND supplier_id=${supplierId}
    ORDER BY id
    LIMIT 1`;
  if (existing.length) return Number(existing[0].id);

  const suppliers = await db`
    SELECT name, COALESCE(country_code,'HN') AS country_code
    FROM suppliers
    WHERE id=${supplierId}
    LIMIT 1`;
  if (!suppliers.length) throw new Error("supplier_not_found");

  const created = await db`
    INSERT INTO locations(name,country_code,type,active,supplier_id)
    VALUES(
      ${"Proveedor: " + suppliers[0].name},
      ${suppliers[0].country_code},
      'vendor',
      TRUE,
      ${supplierId}
    )
    RETURNING id`;
  return Number(created[0].id);
}

export async function ensureVendorPortalSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS vendor_users (
      id BIGSERIAL PRIMARY KEY,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      email_normalized TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('ACTIVE','LOCKED','DISABLED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS vendor_invitations (
      id BIGSERIAL PRIMARY KEY,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      email_normalized TEXT,
      token_hash TEXT UNIQUE NOT NULL,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS vendor_sessions (
      id BIGSERIAL PRIMARY KEY,
      vendor_user_id BIGINT NOT NULL REFERENCES vendor_users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      csrf_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      CHECK (status IN ('ACTIVE','REVOKED','EXPIRED'))
    )`;

  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_supplier_id BIGINT REFERENCES suppliers(id) ON DELETE RESTRICT`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS submitted_by_vendor_user_id BIGINT REFERENCES vendor_users(id) ON DELETE SET NULL`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'APPROVED'`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS review_note TEXT`;
  await db`
    DO $$ BEGIN
      ALTER TABLE products
      ADD CONSTRAINT products_review_status_check
      CHECK (review_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;

  await db`
    CREATE TABLE IF NOT EXISTS product_images (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`ALTER TABLE locations ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES suppliers(id) ON DELETE RESTRICT`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_supplier_unique
    ON locations(supplier_id)
    WHERE supplier_id IS NOT NULL`;
  await db`CREATE INDEX IF NOT EXISTS idx_products_owner_supplier ON products(owner_supplier_id, updated_at DESC)`;
}

async function createInvitation(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "suppliers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const supplierId = Number(body?.supplierId);
  const email = normalizeEmail(body?.email) || null;
  const expiresHours = Math.max(1, Math.min(168, Number(body?.expiresHours || 72)));

  if (!Number.isSafeInteger(supplierId) || supplierId < 1) return json({ error: "invalid_supplier" }, 400);
  if (email && !validEmail(email)) return json({ error: "invalid_email" }, 400);

  const supplier = await db`SELECT id,name,active FROM suppliers WHERE id=${supplierId} LIMIT 1`;
  if (!supplier.length) return json({ error: "supplier_not_found" }, 404);
  if (!supplier[0].active) return json({ error: "supplier_inactive" }, 409);

  const token = randomToken(32);
  const rows = await db`
    INSERT INTO vendor_invitations(
      supplier_id,email_normalized,token_hash,created_by_user_id,expires_at
    )
    VALUES(
      ${supplierId},${email},${sha256(token)},
      ${auth.actor.type === "USER" ? auth.actor.userId : null},
      NOW() + (${expiresHours}::text || ' hours')::interval
    )
    RETURNING id,expires_at,created_at`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "vendor.invitation_created",
    resourceType: "Supplier",
    resourceId: supplierId,
    outcome: "SUCCESS",
    metadata: { invitationId: Number(rows[0].id), email }
  });

  return json({
    invitation: {
      id: Number(rows[0].id),
      supplierId,
      supplierName: supplier[0].name,
      email,
      token,
      expiresAt: rows[0].expires_at,
      createdAt: rows[0].created_at
    }
  }, 201);
}

async function inspectInvitation(req: Request, db: DB) {
  const url = new URL(req.url);
  const token = clean(url.searchParams.get("token"), 256);
  if (!token) return json({ error: "token_required" }, 400);

  const rows = await db`
    SELECT i.id,i.supplier_id,i.email_normalized,i.expires_at,i.accepted_at,i.revoked_at,s.name AS supplier_name
    FROM vendor_invitations i
    JOIN suppliers s ON s.id=i.supplier_id
    WHERE i.token_hash=${sha256(token)}
    LIMIT 1`;
  if (!rows.length) return json({ error: "invalid_invitation" }, 404);

  const row = rows[0];
  const valid = !row.accepted_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
  return json({
    invitation: {
      id: Number(row.id),
      supplierId: Number(row.supplier_id),
      supplierName: row.supplier_name,
      email: row.email_normalized || null,
      expiresAt: row.expires_at,
      valid
    }
  }, valid ? 200 : 410);
}

async function acceptInvitation(req: Request, db: DB) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const token = clean(body?.token, 256);
  const email = normalizeEmail(body?.email);
  const displayName = clean(body?.displayName, 120);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token) return json({ error: "token_required" }, 400);
  if (!validEmail(email)) return json({ error: "invalid_email" }, 400);
  if (!displayName) return json({ error: "display_name_required" }, 400);
  if (password.length < 12 || password.length > 256) return json({ error: "invalid_password_length" }, 400);

  const result: any = await db.begin(async (tx: DB) => {
    const invitations = await tx`
      SELECT id,supplier_id,email_normalized,expires_at,accepted_at,revoked_at
      FROM vendor_invitations
      WHERE token_hash=${sha256(token)}
      FOR UPDATE`;
    if (!invitations.length) return { error: "invalid_invitation", status: 404 };

    const invite = invitations[0];
    if (invite.accepted_at || invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      return { error: "invitation_unavailable", status: 410 };
    }
    if (invite.email_normalized && invite.email_normalized !== email) {
      return { error: "email_mismatch", status: 403 };
    }

    const existing = await tx`SELECT id FROM vendor_users WHERE email_normalized=${email} LIMIT 1`;
    if (existing.length) return { error: "email_exists", status: 409 };

    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const users = await tx`
      INSERT INTO vendor_users(supplier_id,email_normalized,display_name,password_hash,status)
      VALUES(${Number(invite.supplier_id)},${email},${displayName},${hash},'ACTIVE')
      RETURNING id,supplier_id,email_normalized,display_name,status,created_at`;

    await tx`UPDATE vendor_invitations SET accepted_at=NOW() WHERE id=${Number(invite.id)}`;
    return { user: users[0] };
  });

  if (result.error) return json({ error: result.error }, result.status || 409);
  return json({
    user: {
      id: Number(result.user.id),
      supplierId: Number(result.user.supplier_id),
      email: result.user.email_normalized,
      displayName: result.user.display_name,
      status: result.user.status,
      createdAt: result.user.created_at
    }
  }, 201);
}

async function login(req: Request, db: DB) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const rows = await db`
    SELECT id,supplier_id,email_normalized,display_name,password_hash,status
    FROM vendor_users
    WHERE email_normalized=${email}
    LIMIT 1`;

  if (!rows.length || rows[0].status !== "ACTIVE") return json({ error: "invalid_credentials" }, 401);

  let verified = false;
  try { verified = await Bun.password.verify(password, rows[0].password_hash); } catch {}
  if (!verified) return json({ error: "invalid_credentials" }, 401);

  const token = randomToken(32);
  const csrf = randomToken(24);
  const maxAge = SESSION_HOURS * 3600;

  const sessions = await db`
    INSERT INTO vendor_sessions(vendor_user_id,token_hash,csrf_hash,status,expires_at)
    VALUES(
      ${Number(rows[0].id)},${sha256(token)},${sha256(csrf)},'ACTIVE',
      NOW() + (${SESSION_HOURS}::text || ' hours')::interval
    )
    RETURNING id,expires_at`;

  await db`UPDATE vendor_users SET last_login_at=NOW(),updated_at=NOW() WHERE id=${Number(rows[0].id)}`;

  return json({
    user: {
      id: Number(rows[0].id),
      supplierId: Number(rows[0].supplier_id),
      email: rows[0].email_normalized,
      displayName: rows[0].display_name
    },
    csrfToken: csrf,
    expiresAt: sessions[0].expires_at
  }, 200, { "set-cookie": vendorCookie(token, maxAge) });
}

async function me(req: Request, db: DB) {
  const actor = await readVendorSession(req, db);
  if (!actor) return json({ error: "unauthorized" }, 401);
  return json({
    user: {
      id: actor.vendorUserId,
      supplierId: actor.supplierId,
      supplierName: actor.supplierName,
      email: actor.email,
      displayName: actor.displayName
    }
  });
}

async function logout(req: Request, db: DB) {
  const auth = await requireVendor(req, db, true);
  if (!auth.ok) return auth.response;
  await db`
    UPDATE vendor_sessions
    SET status='REVOKED',revoked_at=NOW()
    WHERE id=${auth.actor.sessionId} AND status='ACTIVE'`;
  return json({ ok: true }, 200, { "set-cookie": clearVendorCookie() });
}

async function listCatalog(req: Request, db: DB) {
  const auth = await requireVendor(req, db);
  if (!auth.ok) return auth.response;

  const rows = await db`
    SELECT
      p.id,p.name,p.slug,p.description,p.category,p.brand,p.status,
      p.review_status,p.review_note,p.created_at,p.updated_at,
      COALESCE(
        json_agg(
          json_build_object(
            'id',v.id,'sku',v.sku,'size',v.size,'color',v.color,
            'price',v.price,'currency',v.currency,'active',v.active
          ) ORDER BY v.id
        ) FILTER (WHERE v.id IS NOT NULL),
        '[]'::json
      ) AS variants,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id',pi.id,'url',pi.url,'altText',pi.alt_text,'sortOrder',pi.sort_order
        ) ORDER BY pi.sort_order,pi.id)
        FROM product_images pi
        WHERE pi.product_id=p.id AND pi.active),
        '[]'::json
      ) AS images
    FROM products p
    LEFT JOIN product_variants v ON v.product_id=p.id
    WHERE p.owner_supplier_id=${auth.actor.supplierId}
    GROUP BY p.id
    ORDER BY p.updated_at DESC,p.id DESC`;

  return json({ data: rows });
}

async function createProduct(req: Request, db: DB) {
  const auth = await requireVendor(req, db, true);
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const name = clean(body?.name, 180);
  const category = clean(body?.category, 120) || null;
  const brand = clean(body?.brand, 120) || null;
  const description = clean(body?.description, 4000) || null;
  const sku = clean(body?.sku, 100);
  const price = Number(body?.price);
  const cost = body?.cost == null || body?.cost === "" ? null : Number(body.cost);
  const stock = Number(body?.stock || 0);
  const size = clean(body?.size, 80) || null;
  const color = clean(body?.color, 80) || null;
  const imageUrl = clean(body?.imageUrl, 1000) || null;

  if (name.length < 2) return json({ error: "name_required" }, 400);
  if (!sku) return json({ error: "sku_required" }, 400);
  if (!Number.isFinite(price) || price < 0) return json({ error: "invalid_price" }, 400);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) return json({ error: "invalid_cost" }, 400);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) return json({ error: "invalid_stock" }, 400);
  if ((await db`SELECT id FROM product_variants WHERE sku=${sku} LIMIT 1`).length) {
    return json({ error: "sku_exists" }, 409);
  }

  let slug = slugify(clean(body?.slug,180) || name);
  if (!slug) return json({ error: "slug_required" }, 400);
  if ((await db`SELECT id FROM products WHERE slug=${slug} LIMIT 1`).length) {
    slug = slug + "-" + crypto.randomUUID().slice(0,8);
  }

  const result = await db.begin(async (tx: DB) => {
    const products = await tx`
      INSERT INTO products(
        name,slug,description,category,brand,status,
        owner_supplier_id,submitted_by_vendor_user_id,review_status
      )
      VALUES(
        ${name},${slug},${description},${category},${brand},'draft',
        ${auth.actor.supplierId},${auth.actor.vendorUserId},'DRAFT'
      )
      RETURNING id,name,slug,status,review_status,created_at`;
    const product = products[0];

    const variants = await tx`
      INSERT INTO product_variants(
        product_id,sku,size,color,cost,price,currency,supplier_id,active
      )
      VALUES(
        ${Number(product.id)},${sku},${size},${color},${cost},${price},
        'HNL',${auth.actor.supplierId},TRUE
      )
      RETURNING id,sku,size,color,cost,price,currency`;

    if (stock > 0) {
      const locationId = await vendorLocation(tx, auth.actor.supplierId);
      await tx`
        INSERT INTO inventory(variant_id,location_id,quantity,reserved)
        VALUES(${Number(variants[0].id)},${locationId},${stock},0)`;
      await tx`
        INSERT INTO inventory_movements(
          variant_id,location_id,movement_type,quantity,reference,notes
        )
        VALUES(
          ${Number(variants[0].id)},${locationId},'INITIAL_STOCK',${stock},
          'vendor-portal','Initial vendor catalog stock'
        )`;
    }

    if (imageUrl) {
      await tx`
        INSERT INTO product_images(product_id,url,alt_text,sort_order)
        VALUES(${Number(product.id)},${imageUrl},${name},0)`;
    }

    return { product, variant: variants[0], stock };
  });

  return json(result, 201);
}

async function submitProduct(req: Request, db: DB, productId: number) {
  const auth = await requireVendor(req, db, true);
  if (!auth.ok) return auth.response;

  const owned = await db`
    SELECT id,review_status
    FROM products
    WHERE id=${productId} AND owner_supplier_id=${auth.actor.supplierId}
    LIMIT 1`;
  if (!owned.length) return json({ error: "not_found" }, 404);
  if (!["DRAFT","REJECTED"].includes(owned[0].review_status)) {
    return json({ error: "product_not_submittable" }, 409);
  }

  const readiness = await db`
    SELECT
      (SELECT COUNT(*)::int FROM product_variants WHERE product_id=${productId} AND active) AS variants,
      (SELECT COUNT(*)::int FROM product_images WHERE product_id=${productId} AND active) AS images`;
  if (Number(readiness[0]?.variants || 0) < 1) return json({ error: "variant_required" }, 409);
  if (Number(readiness[0]?.images || 0) < 1) return json({ error: "image_required" }, 409);

  const rows = await db`
    UPDATE products
    SET review_status='SUBMITTED',review_note=NULL,status='draft',updated_at=NOW()
    WHERE id=${productId}
      AND owner_supplier_id=${auth.actor.supplierId}
    RETURNING id,name,review_status,status`;
  return json({ product: rows[0] });
}

async function listVendorProductsForReview(req: Request, url: URL, db: DB) {
  const auth = await authorizeInternal(req, db, "catalog.read");
  if (!auth.ok) return auth.response;

  const status = clean(url.searchParams.get("status"), 24).toUpperCase();
  const allowed = new Set(["DRAFT","SUBMITTED","APPROVED","REJECTED"]);
  if (status && !allowed.has(status)) return json({ error: "invalid_status" }, 400);

  const rows = await db`
    SELECT
      p.id,p.name,p.slug,p.category,p.brand,p.status,p.review_status,p.review_note,
      p.owner_supplier_id,s.name AS supplier_name,p.created_at,p.updated_at,
      COALESCE(
        (SELECT COUNT(*)::int FROM product_variants v WHERE v.product_id=p.id),
        0
      ) AS variant_count,
      COALESCE(
        (SELECT COUNT(*)::int FROM product_images i WHERE i.product_id=p.id AND i.active),
        0
      ) AS image_count
    FROM products p
    JOIN suppliers s ON s.id=p.owner_supplier_id
    WHERE p.owner_supplier_id IS NOT NULL
      AND (${status || null}::text IS NULL OR p.review_status=${status || null}::text)
    ORDER BY
      CASE p.review_status
        WHEN 'SUBMITTED' THEN 0
        WHEN 'REJECTED' THEN 1
        WHEN 'DRAFT' THEN 2
        ELSE 3
      END,
      p.updated_at DESC
    LIMIT 200`;

  return json({
    data: rows.map((row:any)=>({
      id:Number(row.id),
      name:row.name,
      slug:row.slug,
      category:row.category||null,
      brand:row.brand||null,
      publicationStatus:row.status,
      reviewStatus:row.review_status,
      reviewNote:row.review_note||null,
      supplierId:Number(row.owner_supplier_id),
      supplierName:row.supplier_name,
      variantCount:Number(row.variant_count),
      imageCount:Number(row.image_count),
      createdAt:row.created_at,
      updatedAt:row.updated_at
    }))
  });
}

async function reviewProduct(req: Request, db: DB, productId: number) {
  const auth = await authorizeInternal(req, db, "catalog.publish", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const decision = clean(body?.decision, 20).toUpperCase();
  const note = clean(body?.note, 2000) || null;
  if (!["APPROVE","REJECT"].includes(decision)) return json({ error: "invalid_decision" }, 400);

  const targetReview = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const targetStatus = decision === "APPROVE" ? "active" : "draft";

  const rows = await db`
    UPDATE products
    SET review_status=${targetReview},review_note=${note},status=${targetStatus},updated_at=NOW()
    WHERE id=${productId}
      AND owner_supplier_id IS NOT NULL
      AND review_status='SUBMITTED'
    RETURNING id,name,owner_supplier_id,status,review_status,review_note`;
  if (!rows.length) return json({ error: "product_not_reviewable" }, 409);

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: decision === "APPROVE" ? "vendor.product_approved" : "vendor.product_rejected",
    resourceType: "Product",
    resourceId: productId,
    outcome: "SUCCESS",
    metadata: { supplierId: Number(rows[0].owner_supplier_id), note }
  });

  return json({ product: rows[0] });
}

export async function handleVendorPortal(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/vendor-invitations" && req.method === "POST") {
    return createInvitation(req, db);
  }

  if (url.pathname === "/v1/internal/vendor-products" && req.method === "GET") {
    return listVendorProductsForReview(req, url, db);
  }

  const reviewMatch = url.pathname.match(/^\/v1\/internal\/vendor-products\/(\d+)\/review$/);
  if (reviewMatch && req.method === "POST") {
    return reviewProduct(req, db, Number(reviewMatch[1]));
  }

  if (url.pathname === "/v1/vendor/invitation" && req.method === "GET") {
    return inspectInvitation(req, db);
  }

  if (url.pathname === "/v1/vendor/invitation/accept" && req.method === "POST") {
    return acceptInvitation(req, db);
  }

  if (url.pathname === "/v1/vendor/auth/login" && req.method === "POST") {
    return login(req, db);
  }

  if (url.pathname === "/v1/vendor/auth/me" && req.method === "GET") {
    return me(req, db);
  }

  if (url.pathname === "/v1/vendor/auth/logout" && req.method === "POST") {
    return logout(req, db);
  }

  if (url.pathname === "/v1/vendor/catalog" && req.method === "GET") {
    return listCatalog(req, db);
  }

  if (url.pathname === "/v1/vendor/catalog/products" && req.method === "POST") {
    return createProduct(req, db);
  }

  const submitMatch = url.pathname.match(/^\/v1\/vendor\/catalog\/products\/(\d+)\/submit$/);
  if (submitMatch && req.method === "POST") {
    return submitProduct(req, db, Number(submitMatch[1]));
  }

  if (url.pathname.startsWith("/v1/vendor/") || url.pathname.startsWith("/v1/internal/vendor-")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
