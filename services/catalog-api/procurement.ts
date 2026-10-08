import {
  auditActor,
  authorizeInternal,
  writeAuditEvent,
  type InternalActor
} from "./auth";

type DB = any;

const PO_STATUSES = new Set([
  "DRAFT",
  "APPROVED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED"
]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nonNegativeInt(value: unknown, fallback = 0) {
  const n = value == null ? fallback : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function requestHash(value: unknown) {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function poNumber() {
  return "MR-PO-" + Date.now().toString(36).toUpperCase() + "-" +
    crypto.randomUUID().slice(0, 6).toUpperCase();
}

function receiptNumber() {
  return "MR-GR-" + Date.now().toString(36).toUpperCase() + "-" +
    crypto.randomUUID().slice(0, 6).toUpperCase();
}

function actorFields(actor: InternalActor) {
  return actor.type === "USER"
    ? { userId: actor.userId, service: null }
    : { userId: null, service: actor.service };
}

function mapSupplier(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    legalName: row.legal_name || null,
    countryCode: row.country_code || null,
    contactName: row.contact_name || null,
    email: row.email || null,
    phone: row.phone || null,
    website: row.website || null,
    defaultCurrency: row.default_currency || null,
    paymentTermsDays:
      row.payment_terms_days == null ? null : Number(row.payment_terms_days),
    leadTimeDays:
      row.lead_time_days == null ? null : Number(row.lead_time_days),
    notes: row.notes || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadPurchaseOrder(db: DB, id: number) {
  const rows = await db`
    SELECT
      po.id, po.po_number, po.supplier_id, po.supplier_name_snapshot,
      po.supplier_country_code_snapshot, po.destination_location_id,
      po.status, po.currency, po.subtotal_minor, po.shipping_estimate_minor,
      po.tax_estimate_minor, po.other_costs_minor, po.grand_total_minor,
      po.supplier_reference, po.expected_at, po.ordered_at, po.approved_at,
      po.created_by_user_id, po.created_by_service, po.approved_by_user_id,
      po.created_at, po.updated_at
    FROM purchase_orders po
    WHERE po.id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;

  const items = await db`
    SELECT
      id, purchase_order_id, variant_id, sku_snapshot, product_name_snapshot,
      supplier_sku, origin_country_code, quantity_ordered, quantity_received,
      unit_cost_minor, currency, line_total_minor, created_at, updated_at
    FROM purchase_order_items
    WHERE purchase_order_id = ${id}
    ORDER BY id`;

  const receipts = await db`
    SELECT
      gr.id, gr.receipt_number, gr.location_id, gr.status,
      gr.supplier_delivery_reference, gr.received_by_user_id,
      gr.received_by_service, gr.received_at, gr.created_at
    FROM goods_receipts gr
    WHERE gr.purchase_order_id = ${id}
    ORDER BY gr.id`;

  return {
    id: Number(rows[0].id),
    poNumber: rows[0].po_number,
    supplierId: Number(rows[0].supplier_id),
    supplier: {
      name: rows[0].supplier_name_snapshot,
      countryCode: rows[0].supplier_country_code_snapshot || null
    },
    destinationLocationId: Number(rows[0].destination_location_id),
    status: rows[0].status,
    currency: rows[0].currency,
    subtotalMinor: Number(rows[0].subtotal_minor),
    shippingEstimateMinor: Number(rows[0].shipping_estimate_minor),
    taxEstimateMinor: Number(rows[0].tax_estimate_minor),
    otherCostsMinor: Number(rows[0].other_costs_minor),
    grandTotalMinor: Number(rows[0].grand_total_minor),
    supplierReference: rows[0].supplier_reference || null,
    expectedAt: rows[0].expected_at || null,
    orderedAt: rows[0].ordered_at || null,
    approvedAt: rows[0].approved_at || null,
    createdByUserId:
      rows[0].created_by_user_id == null
        ? null
        : Number(rows[0].created_by_user_id),
    createdByService: rows[0].created_by_service || null,
    approvedByUserId:
      rows[0].approved_by_user_id == null
        ? null
        : Number(rows[0].approved_by_user_id),
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
    items: items.map((row: any) => ({
      id: Number(row.id),
      variantId: Number(row.variant_id),
      sku: row.sku_snapshot,
      productName: row.product_name_snapshot,
      supplierSku: row.supplier_sku || null,
      originCountryCode: row.origin_country_code || null,
      quantityOrdered: Number(row.quantity_ordered),
      quantityReceived: Number(row.quantity_received),
      quantityRemaining:
        Number(row.quantity_ordered) - Number(row.quantity_received),
      unitCostMinor: Number(row.unit_cost_minor),
      currency: row.currency,
      lineTotalMinor: Number(row.line_total_minor),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    receipts: receipts.map((row: any) => ({
      id: Number(row.id),
      receiptNumber: row.receipt_number,
      locationId: Number(row.location_id),
      status: row.status,
      supplierDeliveryReference: row.supplier_delivery_reference || null,
      receivedByUserId:
        row.received_by_user_id == null ? null : Number(row.received_by_user_id),
      receivedByService: row.received_by_service || null,
      receivedAt: row.received_at,
      createdAt: row.created_at
    }))
  };
}

async function loadReceipt(db: DB, id: number) {
  const rows = await db`
    SELECT
      id, receipt_number, purchase_order_id, location_id, status,
      supplier_delivery_reference, received_by_user_id, received_by_service,
      received_at, created_at
    FROM goods_receipts
    WHERE id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;

  const items = await db`
    SELECT
      id, purchase_order_item_id, variant_id, quantity_received,
      unit_cost_minor, currency, created_at
    FROM goods_receipt_items
    WHERE goods_receipt_id = ${id}
    ORDER BY id`;

  return {
    id: Number(rows[0].id),
    receiptNumber: rows[0].receipt_number,
    purchaseOrderId: Number(rows[0].purchase_order_id),
    locationId: Number(rows[0].location_id),
    status: rows[0].status,
    supplierDeliveryReference: rows[0].supplier_delivery_reference || null,
    receivedByUserId:
      rows[0].received_by_user_id == null
        ? null
        : Number(rows[0].received_by_user_id),
    receivedByService: rows[0].received_by_service || null,
    receivedAt: rows[0].received_at,
    createdAt: rows[0].created_at,
    items: items.map((row: any) => ({
      id: Number(row.id),
      purchaseOrderItemId: Number(row.purchase_order_item_id),
      variantId: Number(row.variant_id),
      quantityReceived: Number(row.quantity_received),
      unitCostMinor: Number(row.unit_cost_minor),
      currency: row.currency,
      createdAt: row.created_at
    }))
  };
}

export async function ensureProcurementSchema(db: DB) {
  await db`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name TEXT`;
  await db`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website TEXT`;
  await db`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_currency CHAR(3)`;
  await db`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER`;
  await db`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER`;
  await db`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT`;
  await db`
    ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

  await db`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id BIGSERIAL PRIMARY KEY,
      po_number TEXT UNIQUE NOT NULL,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      supplier_name_snapshot TEXT NOT NULL,
      supplier_country_code_snapshot TEXT,
      destination_location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      currency CHAR(3) NOT NULL,
      subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
      shipping_estimate_minor BIGINT NOT NULL DEFAULT 0 CHECK (shipping_estimate_minor >= 0),
      tax_estimate_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_estimate_minor >= 0),
      other_costs_minor BIGINT NOT NULL DEFAULT 0 CHECK (other_costs_minor >= 0),
      grand_total_minor BIGINT NOT NULL CHECK (grand_total_minor >= 0),
      supplier_reference TEXT,
      expected_at TIMESTAMPTZ,
      ordered_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_by_service TEXT,
      approved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        status IN (
          'DRAFT','APPROVED','ORDERED',
          'PARTIALLY_RECEIVED','RECEIVED','CANCELLED'
        )
      ),
      CHECK (
        (created_by_user_id IS NOT NULL AND created_by_service IS NULL) OR
        (created_by_user_id IS NULL AND created_by_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_created
    ON purchase_orders(status, created_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_created
    ON purchase_orders(supplier_id, created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id BIGSERIAL PRIMARY KEY,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      sku_snapshot TEXT NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      supplier_sku TEXT,
      origin_country_code CHAR(2),
      quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
      quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
      unit_cost_minor BIGINT NOT NULL CHECK (unit_cost_minor >= 0),
      currency CHAR(3) NOT NULL,
      line_total_minor BIGINT NOT NULL CHECK (line_total_minor >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(purchase_order_id, variant_id),
      CHECK (quantity_received <= quantity_ordered)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id BIGSERIAL PRIMARY KEY,
      receipt_number TEXT UNIQUE NOT NULL,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
      location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      idempotency_key TEXT UNIQUE NOT NULL,
      idempotency_hash TEXT NOT NULL,
      supplier_delivery_reference TEXT,
      received_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      received_by_service TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('POSTED')),
      CHECK (
        (received_by_user_id IS NOT NULL AND received_by_service IS NULL) OR
        (received_by_user_id IS NULL AND received_by_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_created
    ON goods_receipts(purchase_order_id, created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS goods_receipt_items (
      id BIGSERIAL PRIMARY KEY,
      goods_receipt_id BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE RESTRICT,
      purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
      unit_cost_minor BIGINT NOT NULL CHECK (unit_cost_minor >= 0),
      currency CHAR(3) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(goods_receipt_id, purchase_order_item_id)
    )`;
}

async function listSuppliers(req: Request, url: URL, db: DB) {
  const auth = await authorizeInternal(req, db, "suppliers.read");
  if (!auth.ok) return auth.response;

  const q = clean(url.searchParams.get("q"), 160);
  const activeParam = clean(url.searchParams.get("active"), 8).toLowerCase();
  const active =
    activeParam === "true" ? true :
    activeParam === "false" ? false :
    null;

  const rows = await db`
    SELECT
      id, name, legal_name, country_code, contact_name, email, phone,
      website, default_currency, payment_terms_days, lead_time_days,
      notes, active, created_at, updated_at
    FROM suppliers
    WHERE (${active}::boolean IS NULL OR active = ${active}::boolean)
      AND (
        ${q || null}::text IS NULL OR
        name ILIKE '%' || ${q || null}::text || '%' OR
        COALESCE(legal_name,'') ILIKE '%' || ${q || null}::text || '%' OR
        COALESCE(contact_name,'') ILIKE '%' || ${q || null}::text || '%' OR
        COALESCE(email,'') ILIKE '%' || ${q || null}::text || '%'
      )
    ORDER BY active DESC, name
    LIMIT 100`;

  return json({ data: rows.map(mapSupplier) });
}

async function createSupplier(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "suppliers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const name = clean(body?.name, 180);
  const legalName = clean(body?.legalName, 220) || null;
  const countryCode = clean(body?.countryCode, 2).toUpperCase() || null;
  const contactName = clean(body?.contactName, 160) || null;
  const email = clean(body?.email, 254).toLowerCase() || null;
  const phone = clean(body?.phone, 80) || null;
  const website = clean(body?.website, 300) || null;
  const defaultCurrency = clean(body?.defaultCurrency, 3).toUpperCase() || null;
  const paymentTermsDays = body?.paymentTermsDays == null
    ? null
    : nonNegativeInt(body.paymentTermsDays);
  const leadTimeDays = body?.leadTimeDays == null
    ? null
    : nonNegativeInt(body.leadTimeDays);
  const notes = clean(body?.notes, 2000) || null;

  if (!name) return json({ error: "supplier_name_required" }, 400);
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    return json({ error: "invalid_country_code" }, 400);
  }
  if (defaultCurrency && !/^[A-Z]{3}$/.test(defaultCurrency)) {
    return json({ error: "invalid_currency" }, 400);
  }
  if (paymentTermsDays == null && body?.paymentTermsDays != null) {
    return json({ error: "invalid_payment_terms_days" }, 400);
  }
  if (leadTimeDays == null && body?.leadTimeDays != null) {
    return json({ error: "invalid_lead_time_days" }, 400);
  }

  const rows = await db`
    INSERT INTO suppliers(
      name, legal_name, country_code, contact_name, email, phone,
      website, default_currency, payment_terms_days, lead_time_days,
      notes, active
    )
    VALUES(
      ${name}, ${legalName}, ${countryCode}, ${contactName}, ${email}, ${phone},
      ${website}, ${defaultCurrency}, ${paymentTermsDays}, ${leadTimeDays},
      ${notes}, TRUE
    )
    RETURNING
      id, name, legal_name, country_code, contact_name, email, phone,
      website, default_currency, payment_terms_days, lead_time_days,
      notes, active, created_at, updated_at`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "supplier.created",
    resourceType: "Supplier",
    resourceId: Number(rows[0].id),
    outcome: "SUCCESS",
    metadata: { countryCode, defaultCurrency }
  });

  return json({ supplier: mapSupplier(rows[0]) }, 201);
}

async function updateSupplier(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "suppliers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const rows = await db`
    SELECT *
    FROM suppliers
    WHERE id = ${id}
    LIMIT 1`;
  if (!rows.length) return json({ error: "not_found" }, 404);
  const current = rows[0];

  const name =
    body?.name === undefined ? current.name : clean(body.name, 180);
  const legalName =
    body?.legalName === undefined
      ? current.legal_name
      : clean(body.legalName, 220) || null;
  const countryCode =
    body?.countryCode === undefined
      ? current.country_code
      : clean(body.countryCode, 2).toUpperCase() || null;
  const contactName =
    body?.contactName === undefined
      ? current.contact_name
      : clean(body.contactName, 160) || null;
  const email =
    body?.email === undefined
      ? current.email
      : clean(body.email, 254).toLowerCase() || null;
  const phone =
    body?.phone === undefined
      ? current.phone
      : clean(body.phone, 80) || null;
  const website =
    body?.website === undefined
      ? current.website
      : clean(body.website, 300) || null;
  const defaultCurrency =
    body?.defaultCurrency === undefined
      ? current.default_currency
      : clean(body.defaultCurrency, 3).toUpperCase() || null;
  const paymentTermsDays =
    body?.paymentTermsDays === undefined
      ? current.payment_terms_days
      : body.paymentTermsDays == null
        ? null
        : nonNegativeInt(body.paymentTermsDays);
  const leadTimeDays =
    body?.leadTimeDays === undefined
      ? current.lead_time_days
      : body.leadTimeDays == null
        ? null
        : nonNegativeInt(body.leadTimeDays);
  const notes =
    body?.notes === undefined
      ? current.notes
      : clean(body.notes, 2000) || null;
  const active =
    body?.active === undefined ? Boolean(current.active) : body.active === true;

  if (!name) return json({ error: "supplier_name_required" }, 400);
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    return json({ error: "invalid_country_code" }, 400);
  }
  if (defaultCurrency && !/^[A-Z]{3}$/.test(defaultCurrency)) {
    return json({ error: "invalid_currency" }, 400);
  }

  const updated = await db`
    UPDATE suppliers
    SET name = ${name},
        legal_name = ${legalName},
        country_code = ${countryCode},
        contact_name = ${contactName},
        email = ${email},
        phone = ${phone},
        website = ${website},
        default_currency = ${defaultCurrency},
        payment_terms_days = ${paymentTermsDays},
        lead_time_days = ${leadTimeDays},
        notes = ${notes},
        active = ${active},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id, name, legal_name, country_code, contact_name, email, phone,
      website, default_currency, payment_terms_days, lead_time_days,
      notes, active, created_at, updated_at`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "supplier.updated",
    resourceType: "Supplier",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { changedFields: Object.keys(body || {}), active }
  });

  return json({ supplier: mapSupplier(updated[0]) });
}

function normalizePoBody(body: any) {
  const supplierId = Number(body?.supplierId);
  const destinationLocationId = Number(body?.destinationLocationId);
  const currency = clean(body?.currency, 3).toUpperCase();
  const supplierReference = clean(body?.supplierReference, 180) || null;
  const expectedAt = clean(body?.expectedAt, 40) || null;
  const shippingEstimateMinor = nonNegativeInt(body?.shippingEstimateMinor, 0);
  const taxEstimateMinor = nonNegativeInt(body?.taxEstimateMinor, 0);
  const otherCostsMinor = nonNegativeInt(body?.otherCostsMinor, 0);

  if (!Number.isSafeInteger(supplierId) || supplierId < 1) {
    return { error: "invalid_supplier" as const };
  }
  if (!Number.isSafeInteger(destinationLocationId) || destinationLocationId < 1) {
    return { error: "invalid_location" as const };
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: "invalid_currency" as const };
  }
  if (
    shippingEstimateMinor == null ||
    taxEstimateMinor == null ||
    otherCostsMinor == null
  ) {
    return { error: "invalid_cost_estimate" as const };
  }
  if (expectedAt && !Number.isFinite(Date.parse(expectedAt))) {
    return { error: "invalid_expected_at" as const };
  }
  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 100) {
    return { error: "items_required" as const };
  }

  const seen = new Set<number>();
  const items: any[] = [];
  for (const raw of body.items) {
    const variantId = Number(raw?.variantId);
    const quantityOrdered = Number(raw?.quantityOrdered);
    const unitCostMinor = Number(raw?.unitCostMinor);
    const supplierSku = clean(raw?.supplierSku, 160) || null;
    const originCountryCode =
      clean(raw?.originCountryCode, 2).toUpperCase() || null;

    if (!Number.isSafeInteger(variantId) || variantId < 1) {
      return { error: "invalid_variant" as const };
    }
    if (seen.has(variantId)) return { error: "duplicate_variant" as const };
    seen.add(variantId);

    if (
      !Number.isSafeInteger(quantityOrdered) ||
      quantityOrdered < 1 ||
      quantityOrdered > 100000
    ) {
      return { error: "invalid_quantity" as const };
    }
    if (!Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) {
      return { error: "invalid_unit_cost" as const };
    }
    if (originCountryCode && !/^[A-Z]{2}$/.test(originCountryCode)) {
      return { error: "invalid_origin_country" as const };
    }

    items.push({
      variantId,
      quantityOrdered,
      unitCostMinor,
      supplierSku,
      originCountryCode
    });
  }

  items.sort((a, b) => a.variantId - b.variantId);

  return {
    value: {
      supplierId,
      destinationLocationId,
      currency,
      supplierReference,
      expectedAt,
      shippingEstimateMinor,
      taxEstimateMinor,
      otherCostsMinor,
      items
    }
  };
}

async function createPurchaseOrder(req: Request, db: DB) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) return json({ error: "idempotency_key_required" }, 400);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const normalized = normalizePoBody(body);
  if ("error" in normalized) return json({ error: normalized.error }, 400);

  const auth = await authorizeInternal(req, db, "procurement.create", {
    locationId: normalized.value.destinationLocationId,
    mutation: true
  });
  if (!auth.ok) return auth.response;

  const hash = requestHash(normalized.value);
  const existing = await db`
    SELECT id, idempotency_hash
    FROM purchase_orders
    WHERE idempotency_key = ${key}
    LIMIT 1`;
  if (existing.length) {
    if (existing[0].idempotency_hash !== hash) {
      return json({ error: "idempotency_conflict" }, 409);
    }
    return json({
      purchaseOrder: await loadPurchaseOrder(db, Number(existing[0].id)),
      replayed: true
    });
  }

  const supplier = await db`
    SELECT id, name, country_code, active
    FROM suppliers
    WHERE id = ${normalized.value.supplierId}
    LIMIT 1`;
  if (!supplier.length) return json({ error: "supplier_not_found" }, 404);
  if (!supplier[0].active) return json({ error: "supplier_inactive" }, 409);

  const location = await db`
    SELECT id, active
    FROM locations
    WHERE id = ${normalized.value.destinationLocationId}
    LIMIT 1`;
  if (!location.length || !location[0].active) {
    return json({ error: "location_unavailable" }, 409);
  }

  const variantIds = normalized.value.items.map(item => item.variantId);
  const variants = await db`
    SELECT v.id, v.sku, v.active, p.name AS product_name
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id IN (
      SELECT value::bigint
      FROM jsonb_array_elements_text(${JSON.stringify(variantIds)}::text::jsonb)
    )
    ORDER BY v.id`;
  if (variants.length !== variantIds.length || variants.some((v: any) => !v.active)) {
    return json({ error: "variant_unavailable" }, 409);
  }

  const variantById = new Map<number, any>(
    variants.map((row: any) => [Number(row.id), row])
  );
  const subtotalMinor = normalized.value.items.reduce(
    (sum, item) => sum + item.quantityOrdered * item.unitCostMinor,
    0
  );
  const grandTotalMinor =
    subtotalMinor +
    normalized.value.shippingEstimateMinor +
    normalized.value.taxEstimateMinor +
    normalized.value.otherCostsMinor;

  const actor = actorFields(auth.actor);

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`
      INSERT INTO purchase_orders(
        po_number, supplier_id, supplier_name_snapshot,
        supplier_country_code_snapshot, destination_location_id,
        status, currency, subtotal_minor, shipping_estimate_minor,
        tax_estimate_minor, other_costs_minor, grand_total_minor,
        supplier_reference, expected_at, created_by_user_id,
        created_by_service, idempotency_key, idempotency_hash
      )
      VALUES(
        ${poNumber()}, ${normalized.value.supplierId}, ${supplier[0].name},
        ${supplier[0].country_code || null},
        ${normalized.value.destinationLocationId},
        'DRAFT', ${normalized.value.currency}, ${subtotalMinor},
        ${normalized.value.shippingEstimateMinor},
        ${normalized.value.taxEstimateMinor},
        ${normalized.value.otherCostsMinor}, ${grandTotalMinor},
        ${normalized.value.supplierReference},
        ${normalized.value.expectedAt},
        ${actor.userId}, ${actor.service},
        ${key}, ${hash}
      )
      RETURNING id, po_number`;

    const poId = Number(rows[0].id);

    for (const item of normalized.value.items) {
      const variant = variantById.get(item.variantId);
      await tx`
        INSERT INTO purchase_order_items(
          purchase_order_id, variant_id, sku_snapshot, product_name_snapshot,
          supplier_sku, origin_country_code, quantity_ordered,
          quantity_received, unit_cost_minor, currency, line_total_minor
        )
        VALUES(
          ${poId}, ${item.variantId}, ${variant.sku}, ${variant.product_name},
          ${item.supplierSku}, ${item.originCountryCode},
          ${item.quantityOrdered}, 0, ${item.unitCostMinor},
          ${normalized.value.currency},
          ${item.quantityOrdered * item.unitCostMinor}
        )`;
    }

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "purchase_order.created",
      resourceType: "PurchaseOrder",
      resourceId: poId,
      locationId: normalized.value.destinationLocationId,
      outcome: "SUCCESS",
      metadata: {
        supplierId: normalized.value.supplierId,
        itemCount: normalized.value.items.length,
        subtotalMinor,
        grandTotalMinor,
        currency: normalized.value.currency
      }
    });

    return { poId };
  });

  return json({
    purchaseOrder: await loadPurchaseOrder(db, result.poId)
  }, 201);
}

async function listPurchaseOrders(req: Request, url: URL, db: DB) {
  const auth = await authorizeInternal(req, db, "procurement.read");
  if (!auth.ok) return auth.response;

  const status = clean(url.searchParams.get("status"), 32).toUpperCase();
  if (status && !PO_STATUSES.has(status)) {
    return json({ error: "invalid_status" }, 400);
  }

  const supplierIdRaw = url.searchParams.get("supplierId");
  const supplierId =
    supplierIdRaw == null || supplierIdRaw === ""
      ? null
      : Number(supplierIdRaw);
  if (supplierId != null && (!Number.isSafeInteger(supplierId) || supplierId < 1)) {
    return json({ error: "invalid_supplier" }, 400);
  }

  const rows = await db`
    SELECT
      id, po_number, supplier_id, supplier_name_snapshot,
      destination_location_id, status, currency, grand_total_minor,
      expected_at, ordered_at, created_at, updated_at
    FROM purchase_orders
    WHERE (${status || null}::text IS NULL OR status = ${status || null}::text)
      AND (${supplierId}::bigint IS NULL OR supplier_id = ${supplierId}::bigint)
    ORDER BY created_at DESC
    LIMIT 100`;

  return json({
    data: rows.map((row: any) => ({
      id: Number(row.id),
      poNumber: row.po_number,
      supplierId: Number(row.supplier_id),
      supplierName: row.supplier_name_snapshot,
      destinationLocationId: Number(row.destination_location_id),
      status: row.status,
      currency: row.currency,
      grandTotalMinor: Number(row.grand_total_minor),
      expectedAt: row.expected_at || null,
      orderedAt: row.ordered_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
}

async function transitionPurchaseOrder(
  req: Request,
  db: DB,
  id: number,
  target: "APPROVED" | "ORDERED" | "CANCELLED"
) {
  const rows = await db`
    SELECT id, status, destination_location_id
    FROM purchase_orders
    WHERE id = ${id}
    LIMIT 1`;
  if (!rows.length) return json({ error: "not_found" }, 404);

  const permission =
    target === "APPROVED"
      ? "procurement.approve"
      : target === "CANCELLED"
        ? "procurement.cancel"
        : "procurement.create";

  const auth = await authorizeInternal(req, db, permission, {
    locationId: Number(rows[0].destination_location_id),
    mutation: true
  });
  if (!auth.ok) return auth.response;

  const result: any = await db.begin(async (tx: DB) => {
    const locked = await tx`
      SELECT id, status, destination_location_id
      FROM purchase_orders
      WHERE id = ${id}
      FOR UPDATE`;
    if (!locked.length) return { error: "not_found", status: 404 };

    const current = locked[0].status;
    if (target === "APPROVED" && current !== "DRAFT") {
      return { error: "invalid_transition", status: 409, current, target };
    }
    if (target === "ORDERED" && current !== "APPROVED") {
      return { error: "invalid_transition", status: 409, current, target };
    }
    if (target === "CANCELLED") {
      if (!["DRAFT", "APPROVED", "ORDERED"].includes(current)) {
        return { error: "invalid_transition", status: 409, current, target };
      }
      const received = await tx`
        SELECT COALESCE(SUM(quantity_received),0)::bigint AS received
        FROM purchase_order_items
        WHERE purchase_order_id = ${id}`;
      if (Number(received[0]?.received || 0) > 0) {
        return { error: "cannot_cancel_received_po", status: 409 };
      }
    }

    const approvedBy =
      target === "APPROVED" && auth.actor.type === "USER"
        ? auth.actor.userId
        : null;

    await tx`
      UPDATE purchase_orders
      SET status = ${target},
          approved_at = CASE
            WHEN ${target} = 'APPROVED' THEN NOW()
            ELSE approved_at
          END,
          approved_by_user_id = CASE
            WHEN ${target} = 'APPROVED' THEN ${approvedBy}
            ELSE approved_by_user_id
          END,
          ordered_at = CASE
            WHEN ${target} = 'ORDERED' THEN NOW()
            ELSE ordered_at
          END,
          updated_at = NOW()
      WHERE id = ${id}`;

    const action =
      target === "APPROVED"
        ? "purchase_order.approved"
        : target === "ORDERED"
          ? "purchase_order.ordered"
          : "purchase_order.cancelled";

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action,
      resourceType: "PurchaseOrder",
      resourceId: id,
      locationId: Number(locked[0].destination_location_id),
      outcome: "SUCCESS",
      metadata: { fromStatus: current, toStatus: target }
    });

    return { ok: true };
  });

  if (result.error) return json(result, result.status || 409);
  return json({ purchaseOrder: await loadPurchaseOrder(db, id) });
}

function normalizeReceiptBody(body: any) {
  const supplierDeliveryReference =
    clean(body?.supplierDeliveryReference, 200) || null;

  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 100) {
    return { error: "items_required" as const };
  }

  const seen = new Set<number>();
  const items: any[] = [];
  for (const raw of body.items) {
    const purchaseOrderItemId = Number(raw?.purchaseOrderItemId);
    const quantityReceived = Number(raw?.quantityReceived);

    if (!Number.isSafeInteger(purchaseOrderItemId) || purchaseOrderItemId < 1) {
      return { error: "invalid_purchase_order_item" as const };
    }
    if (seen.has(purchaseOrderItemId)) {
      return { error: "duplicate_purchase_order_item" as const };
    }
    seen.add(purchaseOrderItemId);

    if (
      !Number.isSafeInteger(quantityReceived) ||
      quantityReceived < 1 ||
      quantityReceived > 100000
    ) {
      return { error: "invalid_quantity" as const };
    }

    items.push({ purchaseOrderItemId, quantityReceived });
  }

  items.sort((a, b) => a.purchaseOrderItemId - b.purchaseOrderItemId);

  return {
    value: {
      supplierDeliveryReference,
      items
    }
  };
}

async function postGoodsReceipt(req: Request, db: DB, purchaseOrderId: number) {
  const key = clean(req.headers.get("idempotency-key"), 128);
  if (key.length < 8) return json({ error: "idempotency_key_required" }, 400);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const normalized = normalizeReceiptBody(body);
  if ("error" in normalized) return json({ error: normalized.error }, 400);

  const poRows = await db`
    SELECT id, status, destination_location_id
    FROM purchase_orders
    WHERE id = ${purchaseOrderId}
    LIMIT 1`;
  if (!poRows.length) return json({ error: "not_found" }, 404);

  const locationId = Number(poRows[0].destination_location_id);
  const auth = await authorizeInternal(req, db, "procurement.receive", {
    locationId,
    mutation: true
  });
  if (!auth.ok) return auth.response;

  const hash = requestHash({
    purchaseOrderId,
    ...normalized.value
  });

  const existing = await db`
    SELECT id, idempotency_hash
    FROM goods_receipts
    WHERE idempotency_key = ${key}
    LIMIT 1`;
  if (existing.length) {
    if (existing[0].idempotency_hash !== hash) {
      return json({ error: "idempotency_conflict" }, 409);
    }
    return json({
      goodsReceipt: await loadReceipt(db, Number(existing[0].id)),
      purchaseOrder: await loadPurchaseOrder(db, purchaseOrderId),
      replayed: true
    });
  }

  const actor = actorFields(auth.actor);

  const result: any = await db.begin(async (tx: DB) => {
    const po = await tx`
      SELECT id, status, destination_location_id
      FROM purchase_orders
      WHERE id = ${purchaseOrderId}
      FOR UPDATE`;
    if (!po.length) return { error: "not_found", status: 404 };
    if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(po[0].status)) {
      return {
        error: "po_not_receivable",
        status: 409,
        purchaseOrderStatus: po[0].status
      };
    }
    if (Number(po[0].destination_location_id) !== locationId) {
      return { error: "location_changed", status: 409 };
    }

    const itemIds = normalized.value.items.map(item => item.purchaseOrderItemId);
    const items = await tx`
      SELECT
        id, purchase_order_id, variant_id, quantity_ordered,
        quantity_received, unit_cost_minor, currency
      FROM purchase_order_items
      WHERE id IN (
        SELECT value::bigint
        FROM jsonb_array_elements_text(${JSON.stringify(itemIds)}::text::jsonb)
      )
      ORDER BY id
      FOR UPDATE`;

    if (items.length !== itemIds.length) {
      return { error: "purchase_order_item_not_found", status: 404 };
    }

    const itemById = new Map<number, any>(
      items.map((row: any) => [Number(row.id), row])
    );

    for (const requested of normalized.value.items) {
      const item = itemById.get(requested.purchaseOrderItemId);
      if (Number(item.purchase_order_id) !== purchaseOrderId) {
        return { error: "item_not_in_purchase_order", status: 409 };
      }
      const remaining =
        Number(item.quantity_ordered) - Number(item.quantity_received);
      if (requested.quantityReceived > remaining) {
        return {
          error: "over_receipt",
          status: 409,
          purchaseOrderItemId: requested.purchaseOrderItemId,
          remaining
        };
      }
    }

    const number = receiptNumber();
    const receipts = await tx`
      INSERT INTO goods_receipts(
        receipt_number, purchase_order_id, location_id, status,
        idempotency_key, idempotency_hash, supplier_delivery_reference,
        received_by_user_id, received_by_service
      )
      VALUES(
        ${number}, ${purchaseOrderId}, ${locationId}, 'POSTED',
        ${key}, ${hash}, ${normalized.value.supplierDeliveryReference},
        ${actor.userId}, ${actor.service}
      )
      RETURNING id`;
    const receiptId = Number(receipts[0].id);

    let receivedUnits = 0;

    for (const requested of normalized.value.items) {
      const item = itemById.get(requested.purchaseOrderItemId);
      const variantId = Number(item.variant_id);
      const quantity = requested.quantityReceived;
      receivedUnits += quantity;

      await tx`
        INSERT INTO goods_receipt_items(
          goods_receipt_id, purchase_order_item_id, variant_id,
          quantity_received, unit_cost_minor, currency
        )
        VALUES(
          ${receiptId}, ${requested.purchaseOrderItemId}, ${variantId},
          ${quantity}, ${Number(item.unit_cost_minor)}, ${item.currency}
        )`;

      await tx`
        INSERT INTO inventory(
          variant_id, location_id, quantity, reserved, updated_at
        )
        VALUES(${variantId}, ${locationId}, ${quantity}, 0, NOW())
        ON CONFLICT(variant_id, location_id)
        DO UPDATE SET
          quantity = inventory.quantity + EXCLUDED.quantity,
          updated_at = NOW()`;

      await tx`
        INSERT INTO inventory_movements(
          variant_id, location_id, movement_type, quantity, reference, notes
        )
        VALUES(
          ${variantId}, ${locationId}, 'PURCHASE_RECEIPT', ${quantity},
          ${"goods_receipt:" + number},
          ${"Purchase order " + purchaseOrderId}
        )`;

      await tx`
        UPDATE purchase_order_items
        SET quantity_received = quantity_received + ${quantity},
            updated_at = NOW()
        WHERE id = ${requested.purchaseOrderItemId}`;
    }

    const remaining = await tx`
      SELECT COALESCE(SUM(quantity_ordered - quantity_received),0)::bigint AS remaining
      FROM purchase_order_items
      WHERE purchase_order_id = ${purchaseOrderId}`;

    const nextStatus =
      Number(remaining[0]?.remaining || 0) === 0
        ? "RECEIVED"
        : "PARTIALLY_RECEIVED";

    await tx`
      UPDATE purchase_orders
      SET status = ${nextStatus}, updated_at = NOW()
      WHERE id = ${purchaseOrderId}`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "goods_receipt.posted",
      resourceType: "GoodsReceipt",
      resourceId: receiptId,
      locationId,
      outcome: "SUCCESS",
      metadata: {
        purchaseOrderId,
        receiptNumber: number,
        receivedUnits,
        itemCount: normalized.value.items.length,
        purchaseOrderStatus: nextStatus
      }
    });

    return { receiptId };
  });

  if (result.error) return json(result, result.status || 409);

  return json({
    goodsReceipt: await loadReceipt(db, result.receiptId),
    purchaseOrder: await loadPurchaseOrder(db, purchaseOrderId)
  }, 201);
}

export async function handleProcurement(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/suppliers" && req.method === "GET") {
    return listSuppliers(req, url, db);
  }

  if (url.pathname === "/v1/internal/suppliers" && req.method === "POST") {
    return createSupplier(req, db);
  }

  const supplierRoute = url.pathname.match(/^\/v1\/internal\/suppliers\/(\d+)$/);
  if (supplierRoute && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "suppliers.read");
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT
        id, name, legal_name, country_code, contact_name, email, phone,
        website, default_currency, payment_terms_days, lead_time_days,
        notes, active, created_at, updated_at
      FROM suppliers
      WHERE id = ${Number(supplierRoute[1])}
      LIMIT 1`;
    return rows.length
      ? json({ supplier: mapSupplier(rows[0]) })
      : json({ error: "not_found" }, 404);
  }

  if (supplierRoute && req.method === "PATCH") {
    return updateSupplier(req, db, Number(supplierRoute[1]));
  }

  if (
    url.pathname === "/v1/internal/procurement/purchase-orders" &&
    req.method === "GET"
  ) {
    return listPurchaseOrders(req, url, db);
  }

  if (
    url.pathname === "/v1/internal/procurement/purchase-orders" &&
    req.method === "POST"
  ) {
    return createPurchaseOrder(req, db);
  }

  const poRoute = url.pathname.match(
    /^\/v1\/internal\/procurement\/purchase-orders\/(\d+)$/
  );
  if (poRoute && req.method === "GET") {
    const id = Number(poRoute[1]);
    const po = await loadPurchaseOrder(db, id);
    if (!po) return json({ error: "not_found" }, 404);

    const auth = await authorizeInternal(req, db, "procurement.read", {
      locationId: po.destinationLocationId
    });
    if (!auth.ok) return auth.response;

    return json({ purchaseOrder: po });
  }

  const approveRoute = url.pathname.match(
    /^\/v1\/internal\/procurement\/purchase-orders\/(\d+)\/approve$/
  );
  if (approveRoute && req.method === "POST") {
    return transitionPurchaseOrder(
      req,
      db,
      Number(approveRoute[1]),
      "APPROVED"
    );
  }

  const orderRoute = url.pathname.match(
    /^\/v1\/internal\/procurement\/purchase-orders\/(\d+)\/order$/
  );
  if (orderRoute && req.method === "POST") {
    return transitionPurchaseOrder(
      req,
      db,
      Number(orderRoute[1]),
      "ORDERED"
    );
  }

  const cancelRoute = url.pathname.match(
    /^\/v1\/internal\/procurement\/purchase-orders\/(\d+)\/cancel$/
  );
  if (cancelRoute && req.method === "POST") {
    return transitionPurchaseOrder(
      req,
      db,
      Number(cancelRoute[1]),
      "CANCELLED"
    );
  }

  const receiptRoute = url.pathname.match(
    /^\/v1\/internal\/procurement\/purchase-orders\/(\d+)\/receipts$/
  );
  if (receiptRoute && req.method === "POST") {
    return postGoodsReceipt(req, db, Number(receiptRoute[1]));
  }

  if (
    url.pathname.startsWith("/v1/internal/suppliers") ||
    url.pathname.startsWith("/v1/internal/procurement")
  ) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
