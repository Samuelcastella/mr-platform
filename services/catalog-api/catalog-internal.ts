import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";
import { validCommercialModel, validProductCondition } from "./product-classification";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });

const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? n : null;
};

const stock = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
};

const slugify = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);

function validImageUrl(value: string) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

async function readBody(req: Request) {
  try { return await req.json(); } catch { return null; }
}

async function defaultLocation(db: any) {
  const found = await db`
    SELECT id, name, country_code FROM locations
    WHERE active ORDER BY id LIMIT 1`;
  if (found.length) return found[0];

  const created = await db`
    INSERT INTO locations(name, country_code, type, active)
    VALUES('Puerto Cortés','HN','store',TRUE)
    RETURNING id, name, country_code`;
  return created[0];
}

async function ensureSkuFree(db: any, sku: string) {
  const rows = await db`SELECT id FROM product_variants WHERE sku=${sku} LIMIT 1`;
  return rows.length === 0;
}

export async function handleInternalCatalog(
  req: Request,
  url: URL,
  db: any,
  clean: (v: unknown, max: number) => string
) {
  if (!url.pathname.startsWith("/v1/internal/catalog")) return null;

  if (url.pathname === "/v1/internal/catalog" && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "catalog.read");
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT
        p.id, p.name, p.slug, p.description, p.category, p.brand,
        p.status, p.commercial_model, p.default_condition,
        p.created_at, p.updated_at,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', pi.id, 'url', pi.url, 'altText', pi.alt_text,
                'sortOrder', pi.sort_order
              )
              ORDER BY pi.sort_order, pi.id
            )
            FROM product_images pi
            WHERE pi.product_id=p.id AND pi.active
          ),
          '[]'::json
        ) AS images,
        COALESCE(
          json_agg(
            json_build_object(
              'id', v.id, 'sku', v.sku, 'barcode', v.barcode,
              'size', v.size, 'color', v.color, 'cost', v.cost,
              'price', v.price, 'currency', v.currency,
              'active', v.active, 'available', v.available
            ) ORDER BY v.id
          ) FILTER (WHERE v.id IS NOT NULL),
          '[]'::json
        ) AS variants
      FROM products p
      LEFT JOIN (
        SELECT pv.*,
          COALESCE(SUM(i.quantity - i.reserved),0)::int AS available
        FROM product_variants pv
        LEFT JOIN inventory i ON i.variant_id=pv.id
        GROUP BY pv.id
      ) v ON v.product_id=p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT 250`;

    return json({ data: rows });
  }

  if (url.pathname === "/v1/internal/catalog/products" && req.method === "POST") {
    const auth = await authorizeInternal(req, db, "catalog.write", { mutation: true });
    if (!auth.ok) return auth.response;

    const body: any = await readBody(req);
    if (!body) return json({ error: "invalid_json" }, 400);

    const name = clean(body.name, 180);
    const slug = slugify(clean(body.slug, 180) || name);
    const description = clean(body.description, 4000) || null;
    const category = clean(body.category, 120) || null;
    const brand = clean(body.brand, 120) || null;
    const imageUrl = clean(body.imageUrl, 1000) || null;
    const status = clean(body.status, 24) || "draft";
    const commercialModel = validCommercialModel(body.commercialModel);
    const defaultCondition = validProductCondition(body.defaultCondition);
    const rawVariants = Array.isArray(body.variants) ? body.variants.slice(0, 20) : [];

    if (name.length < 2) return json({ error: "name_required" }, 400);
    if (!slug) return json({ error: "slug_required" }, 400);
    if (!["draft","active"].includes(status)) return json({ error: "invalid_status" }, 400);
    if (!commercialModel) {
      return json({
        error: body.commercialModel == null ? "commercial_model_required" : "invalid_commercial_model"
      }, 400);
    }
    if (!defaultCondition) {
      return json({
        error: body.defaultCondition == null ? "default_condition_required" : "invalid_default_condition"
      }, 400);
    }
    if (!validImageUrl(imageUrl || "")) return json({ error: "invalid_image_url" }, 400);
    if (!rawVariants.length) return json({ error: "variant_required" }, 400);

    if (status === "active") {
      const publish = await authorizeInternal(req, db, "catalog.publish", { mutation: true });
      if (!publish.ok) return publish.response;
    }

    const variants: any[] = [];
    for (const raw of rawVariants) {
      const sku = clean(raw?.sku, 100);
      const price = money(raw?.price);
      const cost = raw?.cost === "" || raw?.cost == null ? null : money(raw.cost);
      const quantity = stock(raw?.stock ?? 0);
      const currency = (clean(raw?.currency, 3) || "HNL").toUpperCase();

      if (!sku) return json({ error: "sku_required" }, 400);
      if (price == null) return json({ error: "invalid_price", sku }, 400);
      if (cost === null && raw?.cost !== "" && raw?.cost != null)
        return json({ error: "invalid_cost", sku }, 400);
      if (quantity == null) return json({ error: "invalid_stock", sku }, 400);
      if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "invalid_currency", sku }, 400);

      variants.push({
        sku,
        barcode: clean(raw?.barcode, 100) || null,
        size: clean(raw?.size, 80) || null,
        color: clean(raw?.color, 80) || null,
        price, cost, stock: quantity, currency
      });
    }

    if (new Set(variants.map(v => v.sku)).size !== variants.length)
      return json({ error: "duplicate_sku_in_request" }, 409);

    if (variants.some(v => v.stock > 0)) {
      const inventory = await authorizeInternal(req, db, "inventory.adjust", { mutation: true });
      if (!inventory.ok) return inventory.response;
    }

    if ((await db`SELECT id FROM products WHERE slug=${slug} LIMIT 1`).length)
      return json({ error: "slug_exists" }, 409);

    for (const v of variants)
      if (!(await ensureSkuFree(db, v.sku))) return json({ error: "sku_exists", sku: v.sku }, 409);

    const result = await db.begin(async (tx: any) => {
      const productRows = await tx`
        INSERT INTO products(
          name,slug,description,category,brand,status,commercial_model,default_condition
        )
        VALUES(
          ${name},${slug},${description},${category},${brand},${status},
          ${commercialModel},${defaultCondition}
        )
        RETURNING
          id,name,slug,status,commercial_model,default_condition,created_at,updated_at`;
      const product = productRows[0];
      const location = variants.some(v => v.stock > 0) ? await defaultLocation(tx) : null;
      const created: any[] = [];

      for (const v of variants) {
        const rows = await tx`
          INSERT INTO product_variants(
            product_id,sku,barcode,size,color,cost,price,currency,active
          )
          VALUES(
            ${product.id},${v.sku},${v.barcode},${v.size},${v.color},
            ${v.cost},${v.price},${v.currency},TRUE
          )
          RETURNING id,sku,size,color,cost,price,currency,active`;
        const variant = rows[0];

        if (location && v.stock > 0) {
          await tx`
            INSERT INTO inventory(variant_id,location_id,quantity,reserved)
            VALUES(${variant.id},${location.id},${v.stock},0)`;
          await tx`
            INSERT INTO inventory_movements(
              variant_id,location_id,movement_type,quantity,reference,notes
            )
            VALUES(
              ${variant.id},${location.id},'INITIAL_STOCK',${v.stock},
              'control-center','Initial catalog stock'
            )`;
        }
        created.push({ ...variant, stock: v.stock });
      }

      if (imageUrl) {
        await tx`
          INSERT INTO product_images(product_id,url,alt_text,sort_order,active)
          VALUES(${product.id},${imageUrl},${name},0,TRUE)`;
      }

      await writeAuditEvent(tx, {
        ...auditActor(auth.actor),
        action: "catalog.product_created",
        resourceType: "Product",
        resourceId: product.id,
        outcome: "SUCCESS",
        metadata: {
          status,
          commercialModel,
          defaultCondition,
          variantCount: created.length,
          locationId: location?.id ?? null,
          economicOwnershipChanged: false
        }
      });

      return { product, variants: created, location };
    });

    return json(result, 201);
  }

  const productMatch = url.pathname.match(/^\/v1\/internal\/catalog\/products\/(\d+)$/);
  if (productMatch && req.method === "PATCH") {
    const auth = await authorizeInternal(req, db, "catalog.write", { mutation: true });
    if (!auth.ok) return auth.response;

    const body: any = await readBody(req);
    if (!body) return json({ error: "invalid_json" }, 400);

    const id = Number(productMatch[1]);
    const prior = await db`
      SELECT
        id,name,description,category,brand,status,commercial_model,default_condition
      FROM products WHERE id=${id} LIMIT 1`;
    if (!prior.length) return json({ error: "not_found" }, 404);

    const before = prior[0];
    const nextStatus = body.status == null ? before.status : clean(body.status, 24);
    if (!["draft","active"].includes(nextStatus)) return json({ error: "invalid_status" }, 400);

    const nextCommercialModel = body.commercialModel == null
      ? before.commercial_model
      : validCommercialModel(body.commercialModel);
    const nextDefaultCondition = body.defaultCondition == null
      ? before.default_condition
      : validProductCondition(body.defaultCondition);

    if (body.commercialModel != null && !nextCommercialModel) {
      return json({ error: "invalid_commercial_model" }, 400);
    }
    if (body.defaultCondition != null && !nextDefaultCondition) {
      return json({ error: "invalid_default_condition" }, 400);
    }

    if (
      nextStatus === "active" &&
      before.status !== "active" &&
      (!nextCommercialModel || !nextDefaultCondition)
    ) {
      return json({
        error: "classification_required",
        required: ["commercialModel","defaultCondition"]
      }, 409);
    }

    if (nextStatus === "active" && before.status !== "active") {
      const publish = await authorizeInternal(req, db, "catalog.publish", { mutation: true });
      if (!publish.ok) return publish.response;
    }

    const name = body.name == null ? before.name : clean(body.name, 180);
    if (name.length < 2) return json({ error: "name_required" }, 400);

    const rows = await db`
      UPDATE products SET
        name=${name},
        description=${body.description == null ? before.description : clean(body.description,4000) || null},
        category=${body.category == null ? before.category : clean(body.category,120) || null},
        brand=${body.brand == null ? before.brand : clean(body.brand,120) || null},
        status=${nextStatus},
        commercial_model=${nextCommercialModel},
        default_condition=${nextDefaultCondition},
        updated_at=NOW()
      WHERE id=${id}
      RETURNING
        id,name,slug,description,category,brand,status,
        commercial_model,default_condition,updated_at`;

    await writeAuditEvent(db, {
      ...auditActor(auth.actor),
      action: "catalog.product_updated",
      resourceType: "Product",
      resourceId: id,
      outcome: "SUCCESS",
      metadata: {
        fromStatus: before.status,
        toStatus: nextStatus,
        fromCommercialModel: before.commercial_model || null,
        toCommercialModel: nextCommercialModel || null,
        fromDefaultCondition: before.default_condition || null,
        toDefaultCondition: nextDefaultCondition || null,
        economicOwnershipChanged: false
      }
    });

    return json({ product: rows[0] });
  }

  const imageMatch = url.pathname.match(
    /^\/v1\/internal\/catalog\/products\/(\d+)\/images$/
  );
  if (imageMatch && req.method === "POST") {
    const auth = await authorizeInternal(req, db, "catalog.write", { mutation: true });
    if (!auth.ok) return auth.response;

    const body: any = await readBody(req);
    if (!body) return json({ error: "invalid_json" }, 400);

    const productId = Number(imageMatch[1]);
    const urlValue = clean(body.url, 1000);
    const altText = clean(body.altText, 240) || null;
    if (!urlValue || !validImageUrl(urlValue)) {
      return json({ error: "invalid_image_url" }, 400);
    }
    const product = await db`SELECT id,name FROM products WHERE id=${productId} LIMIT 1`;
    if (!product.length) return json({ error: "product_not_found" }, 404);

    const sortRows = await db`
      SELECT COALESCE(MAX(sort_order),-1)::int + 1 AS next
      FROM product_images
      WHERE product_id=${productId}`;
    const rows = await db`
      INSERT INTO product_images(product_id,url,alt_text,sort_order,active)
      VALUES(
        ${productId},${urlValue},${altText || product[0].name},
        ${Number(sortRows[0]?.next || 0)},TRUE
      )
      RETURNING id,product_id,url,alt_text,sort_order,active,created_at`;

    await writeAuditEvent(db, {
      ...auditActor(auth.actor),
      action: "catalog.product_image_added",
      resourceType: "Product",
      resourceId: productId,
      outcome: "SUCCESS",
      metadata: { imageId: Number(rows[0].id) }
    });

    return json({ image: rows[0] }, 201);
  }

  const variantMatch = url.pathname.match(
    /^\/v1\/internal\/catalog\/products\/(\d+)\/variants$/
  );
  if (variantMatch && req.method === "POST") {
    const auth = await authorizeInternal(req, db, "catalog.write", { mutation: true });
    if (!auth.ok) return auth.response;

    const body: any = await readBody(req);
    if (!body) return json({ error: "invalid_json" }, 400);

    const productId = Number(variantMatch[1]);
    if (!(await db`SELECT id FROM products WHERE id=${productId} LIMIT 1`).length)
      return json({ error: "product_not_found" }, 404);

    const sku = clean(body.sku, 100);
    const price = money(body.price);
    const cost = body.cost === "" || body.cost == null ? null : money(body.cost);
    const quantity = stock(body.stock ?? 0);
    const currency = (clean(body.currency,3) || "HNL").toUpperCase();

    if (!sku) return json({ error: "sku_required" }, 400);
    if (price == null) return json({ error: "invalid_price" }, 400);
    if (quantity == null) return json({ error: "invalid_stock" }, 400);
    if (!(await ensureSkuFree(db, sku))) return json({ error: "sku_exists" }, 409);

    if (quantity > 0) {
      const inventory = await authorizeInternal(req, db, "inventory.adjust", { mutation: true });
      if (!inventory.ok) return inventory.response;
    }

    const result = await db.begin(async (tx: any) => {
      const rows = await tx`
        INSERT INTO product_variants(
          product_id,sku,barcode,size,color,cost,price,currency,active
        )
        VALUES(
          ${productId},${sku},${clean(body.barcode,100)||null},
          ${clean(body.size,80)||null},${clean(body.color,80)||null},
          ${cost},${price},${currency},TRUE
        )
        RETURNING id,sku,size,color,cost,price,currency,active`;
      const variant = rows[0];
      const location = quantity > 0 ? await defaultLocation(tx) : null;

      if (location) {
        await tx`
          INSERT INTO inventory(variant_id,location_id,quantity,reserved)
          VALUES(${variant.id},${location.id},${quantity},0)`;
        await tx`
          INSERT INTO inventory_movements(
            variant_id,location_id,movement_type,quantity,reference,notes
          )
          VALUES(
            ${variant.id},${location.id},'INITIAL_STOCK',${quantity},
            'control-center','Initial variant stock'
          )`;
      }

      await writeAuditEvent(tx, {
        ...auditActor(auth.actor),
        action: "catalog.variant_created",
        resourceType: "ProductVariant",
        resourceId: variant.id,
        outcome: "SUCCESS",
        metadata: { productId, stock: quantity, locationId: location?.id ?? null }
      });

      return { variant: { ...variant, stock: quantity }, location };
    });

    return json(result, 201);
  }

  const stockMatch = url.pathname.match(
    /^\/v1\/internal\/catalog\/variants\/(\d+)\/stock$/
  );
  if (stockMatch && req.method === "POST") {
    if (Bun.env.ENFORCE_GOVERNED_INVENTORY_ADJUSTMENTS === "true") {
      return json({
        error: "governed_adjustment_required",
        workflow: "/v1/internal/inventory-adjustments"
      }, 409);
    }

    const auth = await authorizeInternal(req, db, "inventory.adjust", { mutation: true });
    if (!auth.ok) return auth.response;

    const body: any = await readBody(req);
    if (!body) return json({ error: "invalid_json" }, 400);
    const quantity = stock(body.quantity);
    if (quantity == null) return json({ error: "invalid_stock" }, 400);

    const variantId = Number(stockMatch[1]);
    const result: any = await db.begin(async (tx: any) => {
      const variant = await tx`
        SELECT id,product_id FROM product_variants WHERE id=${variantId} LIMIT 1`;
      if (!variant.length) return { error: "variant_not_found", status: 404 };

      const location = await defaultLocation(tx);
      const current = await tx`
        SELECT quantity FROM inventory
        WHERE variant_id=${variantId} AND location_id=${location.id}
        FOR UPDATE`;
      const before = current.length ? Number(current[0].quantity) : 0;
      const delta = quantity - before;

      await tx`
        INSERT INTO inventory(variant_id,location_id,quantity,reserved)
        VALUES(${variantId},${location.id},${quantity},0)
        ON CONFLICT(variant_id,location_id)
        DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=NOW()`;

      if (delta) await tx`
        INSERT INTO inventory_movements(
          variant_id,location_id,movement_type,quantity,reference,notes
        )
        VALUES(
          ${variantId},${location.id},'ADJUSTMENT',${delta},
          'control-center','Catalog stock adjustment'
        )`;

      await writeAuditEvent(tx, {
        ...auditActor(auth.actor),
        action: "inventory.stock_set",
        resourceType: "ProductVariant",
        resourceId: variantId,
        outcome: "SUCCESS",
        metadata: { locationId: Number(location.id), before, after: quantity, delta }
      });

      return { variantId, location, before, quantity, delta };
    });

    if (result.error) return json({ error: result.error }, result.status || 409);
    return json(result);
  }

  return null;
}
