import {
  auditActor,
  authorizeInternal,
  writeAuditEvent,
  type InternalActor
} from "./auth";

type DB = any;

const CUSTOMER_TYPES = new Set(["PERSON", "BUSINESS"]);
const CUSTOMER_STATUSES = new Set(["ACTIVE", "ARCHIVED"]);
const CONTACT_TYPES = new Set(["PHONE", "EMAIL", "WHATSAPP", "OTHER"]);
const PREF_CHANNELS = new Set(["EMAIL", "SMS", "WHATSAPP", "PUSH", "PHONE"]);
const PREF_PURPOSES = new Set(["MARKETING", "ORDER_UPDATES", "SERVICE_MESSAGES"]);
const PREF_STATUSES = new Set(["UNKNOWN", "GRANTED", "DENIED", "WITHDRAWN"]);

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

function normalizeContact(type: string, raw: string) {
  const value = raw.trim();
  if (type === "EMAIL") return value.toLowerCase();
  if (type === "PHONE" || type === "WHATSAPP") {
    const leadingPlus = value.startsWith("+");
    const digits = value.replace(/\D/g, "");
    return (leadingPlus ? "+" : "") + digits;
  }
  return value.toLowerCase();
}

function actorLabel(actor: InternalActor) {
  return actor.type === "USER" ? "staff:" + actor.userId : "service:" + actor.service;
}

function mapCustomer(row: any) {
  return {
    id: Number(row.id),
    displayName: row.display_name,
    customerType: row.customer_type,
    status: row.status,
    preferredLanguage: row.preferred_language || null,
    mergedIntoCustomerId:
      row.merged_into_customer_id == null ? null : Number(row.merged_into_customer_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapContact(row: any) {
  return {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    type: row.type,
    value: row.raw_value,
    normalizedValue: row.normalized_value,
    label: row.label || null,
    isPrimary: Boolean(row.is_primary),
    verifiedAt: row.verified_at || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAddress(row: any) {
  return {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    label: row.label || null,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone || null,
    countryCode: row.country_code,
    departmentOrState: row.department_or_state || null,
    municipalityOrCity: row.municipality_or_city || null,
    locality: row.locality || null,
    addressLine: row.address_line,
    reference: row.reference || null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    isDefaultShipping: Boolean(row.is_default_shipping),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadCustomer(db: DB, id: number) {
  const rows = await db`
    SELECT id, display_name, customer_type, status, preferred_language,
           merged_into_customer_id, created_at, updated_at
    FROM customers
    WHERE id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;

  const contacts = await db`
    SELECT id, customer_id, type, raw_value, normalized_value, label,
           is_primary, verified_at, active, created_at, updated_at
    FROM customer_contacts
    WHERE customer_id = ${id}
    ORDER BY active DESC, is_primary DESC, id`;

  const addresses = await db`
    SELECT id, customer_id, label, recipient_name, recipient_phone,
           country_code, department_or_state, municipality_or_city,
           locality, address_line, reference, latitude, longitude,
           is_default_shipping, active, created_at, updated_at
    FROM customer_addresses
    WHERE customer_id = ${id}
    ORDER BY active DESC, is_default_shipping DESC, id`;

  const notes = await db`
    SELECT id, author_user_id, author_service, note, visibility, created_at
    FROM customer_notes
    WHERE customer_id = ${id}
    ORDER BY created_at DESC
    LIMIT 50`;

  const preferences = await db`
    SELECT id, channel, purpose, status, source, evidence_reference,
           captured_by_user_id, captured_at, updated_at
    FROM customer_preferences
    WHERE customer_id = ${id}
    ORDER BY channel, purpose`;

  const tags = await db`
    SELECT tag, source, created_by_user_id, created_at
    FROM customer_tags
    WHERE customer_id = ${id}
    ORDER BY tag`;

  return {
    ...mapCustomer(rows[0]),
    contacts: contacts.map(mapContact),
    addresses: addresses.map(mapAddress),
    notes: notes.map((row: any) => ({
      id: Number(row.id),
      authorUserId: row.author_user_id == null ? null : Number(row.author_user_id),
      authorService: row.author_service || null,
      note: row.note,
      visibility: row.visibility,
      createdAt: row.created_at
    })),
    preferences: preferences.map((row: any) => ({
      id: Number(row.id),
      channel: row.channel,
      purpose: row.purpose,
      status: row.status,
      source: row.source,
      evidenceReference: row.evidence_reference || null,
      capturedByUserId:
        row.captured_by_user_id == null ? null : Number(row.captured_by_user_id),
      capturedAt: row.captured_at,
      updatedAt: row.updated_at
    })),
    tags: tags.map((row: any) => ({
      tag: row.tag,
      source: row.source,
      createdByUserId:
        row.created_by_user_id == null ? null : Number(row.created_by_user_id),
      createdAt: row.created_at
    }))
  };
}

export async function ensureCustomersSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      display_name TEXT NOT NULL,
      customer_type TEXT NOT NULL DEFAULT 'PERSON',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      preferred_language TEXT,
      notes_summary TEXT,
      merged_into_customer_id BIGINT REFERENCES customers(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (customer_type IN ('PERSON','BUSINESS')),
      CHECK (status IN ('ACTIVE','ARCHIVED','MERGED')),
      CHECK (
        (status = 'MERGED' AND merged_into_customer_id IS NOT NULL) OR
        (status <> 'MERGED' AND merged_into_customer_id IS NULL)
      ),
      CHECK (merged_into_customer_id IS NULL OR merged_into_customer_id <> id)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_customers_status_name
    ON customers(status, lower(display_name))`;

  await db`
    CREATE TABLE IF NOT EXISTS customer_contacts (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      label TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (type IN ('PHONE','EMAIL','WHATSAPP','OTHER'))
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_customer_contacts_normalized
    ON customer_contacts(type, normalized_value)
    WHERE active = TRUE`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
    ON customer_contacts(customer_id, active, is_primary DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      label TEXT,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT,
      country_code CHAR(2) NOT NULL,
      department_or_state TEXT,
      municipality_or_city TEXT,
      locality TEXT,
      address_line TEXT NOT NULL,
      reference TEXT,
      latitude NUMERIC(9,6),
      longitude NUMERIC(9,6),
      is_default_shipping BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer
    ON customer_addresses(customer_id, active, is_default_shipping DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS customer_notes (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      author_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      author_service TEXT,
      note TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'INTERNAL',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (visibility IN ('INTERNAL')),
      CHECK (
        (author_user_id IS NOT NULL AND author_service IS NULL) OR
        (author_user_id IS NULL AND author_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS customer_preferences (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      channel TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      source TEXT NOT NULL,
      evidence_reference TEXT,
      captured_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(customer_id, channel, purpose),
      CHECK (channel IN ('EMAIL','SMS','WHATSAPP','PUSH','PHONE')),
      CHECK (purpose IN ('MARKETING','ORDER_UPDATES','SERVICE_MESSAGES')),
      CHECK (status IN ('UNKNOWN','GRANTED','DENIED','WITHDRAWN'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS customer_tags (
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      tag TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(customer_id, tag),
      CHECK (source IN ('MANUAL','SYSTEM'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS customer_duplicate_candidates (
      id BIGSERIAL PRIMARY KEY,
      left_customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      right_customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL,
      score NUMERIC(5,2),
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      CHECK (left_customer_id <> right_customer_id),
      CHECK (status IN ('OPEN','DUPLICATE','NOT_DUPLICATE','IGNORED'))
    )`;
}

async function createCustomer(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const displayName = clean(body?.displayName, 160);
  const customerType = clean(body?.customerType, 20).toUpperCase() || "PERSON";
  const preferredLanguage = clean(body?.preferredLanguage, 20) || null;

  if (!displayName) return json({ error: "display_name_required" }, 400);
  if (!CUSTOMER_TYPES.has(customerType)) return json({ error: "invalid_customer_type" }, 400);

  const rows = await db`
    INSERT INTO customers(display_name, customer_type, preferred_language)
    VALUES(${displayName}, ${customerType}, ${preferredLanguage})
    RETURNING id, display_name, customer_type, status, preferred_language,
              merged_into_customer_id, created_at, updated_at`;

  const customer = rows[0];
  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "customer.created",
    resourceType: "Customer",
    resourceId: Number(customer.id),
    outcome: "SUCCESS",
    metadata: { customerType }
  });

  return json({ customer: mapCustomer(customer) }, 201);
}

async function listCustomers(req: Request, url: URL, db: DB) {
  const auth = await authorizeInternal(req, db, "customers.read");
  if (!auth.ok) return auth.response;

  const q = clean(url.searchParams.get("q"), 160);
  const status = clean(url.searchParams.get("status"), 20).toUpperCase();
  if (status && !["ACTIVE", "ARCHIVED", "MERGED"].includes(status)) {
    return json({ error: "invalid_status" }, 400);
  }

  const rows = await db`
    SELECT
      c.id, c.display_name, c.customer_type, c.status, c.preferred_language,
      c.merged_into_customer_id, c.created_at, c.updated_at,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'type', cc.type,
              'value', cc.raw_value,
              'normalizedValue', cc.normalized_value,
              'isPrimary', cc.is_primary
            )
            ORDER BY cc.is_primary DESC, cc.id
          )
          FROM customer_contacts cc
          WHERE cc.customer_id = c.id AND cc.active = TRUE
        ),
        '[]'::json
      ) AS contacts
    FROM customers c
    WHERE (${status || null}::text IS NULL OR c.status = ${status || null}::text)
      AND (
        ${q || null}::text IS NULL OR
        c.display_name ILIKE '%' || ${q || null}::text || '%' OR
        c.id::text = ${q || null}::text OR
        EXISTS (
          SELECT 1
          FROM customer_contacts cc
          WHERE cc.customer_id = c.id
            AND cc.active = TRUE
            AND (
              cc.raw_value ILIKE '%' || ${q || null}::text || '%' OR
              cc.normalized_value ILIKE '%' || ${q || null}::text || '%'
            )
        )
      )
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 100`;

  return json({
    data: rows.map((row: any) => ({
      ...mapCustomer(row),
      contacts: Array.isArray(row.contacts) ? row.contacts : []
    }))
  });
}

async function updateCustomer(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const current = await db`
    SELECT id, display_name, customer_type, status, preferred_language
    FROM customers
    WHERE id = ${id}
    LIMIT 1`;
  if (!current.length) return json({ error: "not_found" }, 404);
  if (current[0].status === "MERGED") return json({ error: "customer_merged" }, 409);

  const displayName =
    body?.displayName === undefined ? current[0].display_name : clean(body.displayName, 160);
  const customerType =
    body?.customerType === undefined
      ? current[0].customer_type
      : clean(body.customerType, 20).toUpperCase();
  const preferredLanguage =
    body?.preferredLanguage === undefined
      ? current[0].preferred_language
      : clean(body.preferredLanguage, 20) || null;
  const status =
    body?.status === undefined
      ? current[0].status
      : clean(body.status, 20).toUpperCase();

  if (!displayName) return json({ error: "display_name_required" }, 400);
  if (!CUSTOMER_TYPES.has(customerType)) return json({ error: "invalid_customer_type" }, 400);
  if (!CUSTOMER_STATUSES.has(status)) return json({ error: "invalid_status" }, 400);

  const rows = await db`
    UPDATE customers
    SET display_name = ${displayName},
        customer_type = ${customerType},
        preferred_language = ${preferredLanguage},
        status = ${status},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, display_name, customer_type, status, preferred_language,
              merged_into_customer_id, created_at, updated_at`;

  const changedFields = Object.keys(body || {}).filter(key =>
    ["displayName", "customerType", "preferredLanguage", "status"].includes(key)
  );

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: status === "ARCHIVED" ? "customer.archived" : "customer.updated",
    resourceType: "Customer",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { changedFields }
  });

  return json({ customer: mapCustomer(rows[0]) });
}

async function addContact(req: Request, db: DB, customerId: number) {
  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const customer = await db`
    SELECT id, status
    FROM customers
    WHERE id = ${customerId}
    LIMIT 1`;
  if (!customer.length) return json({ error: "not_found" }, 404);
  if (customer[0].status === "MERGED") return json({ error: "customer_merged" }, 409);

  const type = clean(body?.type, 20).toUpperCase();
  const rawValue = clean(body?.value, 320);
  const label = clean(body?.label, 80) || null;
  const isPrimary = body?.isPrimary === true;

  if (!CONTACT_TYPES.has(type)) return json({ error: "invalid_contact_type" }, 400);
  if (!rawValue) return json({ error: "contact_value_required" }, 400);
  const normalized = normalizeContact(type, rawValue);
  if (!normalized) return json({ error: "invalid_contact_value" }, 400);

  const row: any = await db.begin(async (tx: DB) => {
    if (isPrimary) {
      await tx`
        UPDATE customer_contacts
        SET is_primary = FALSE, updated_at = NOW()
        WHERE customer_id = ${customerId}
          AND type = ${type}
          AND active = TRUE`;
    }

    const rows = await tx`
      INSERT INTO customer_contacts(
        customer_id, type, raw_value, normalized_value, label, is_primary
      )
      VALUES(
        ${customerId}, ${type}, ${rawValue}, ${normalized}, ${label}, ${isPrimary}
      )
      RETURNING id, customer_id, type, raw_value, normalized_value, label,
                is_primary, verified_at, active, created_at, updated_at`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "customer.contact_added",
      resourceType: "CustomerContact",
      resourceId: Number(rows[0].id),
      outcome: "SUCCESS",
      metadata: { customerId, type, isPrimary }
    });

    return rows[0];
  });

  return json({ contact: mapContact(row) }, 201);
}

async function updateContact(req: Request, db: DB, contactId: number) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const current = await db`
    SELECT id, customer_id, type, raw_value, label, is_primary, active
    FROM customer_contacts
    WHERE id = ${contactId}
    LIMIT 1`;
  if (!current.length) return json({ error: "not_found" }, 404);

  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  const type =
    body?.type === undefined ? current[0].type : clean(body.type, 20).toUpperCase();
  const rawValue =
    body?.value === undefined ? current[0].raw_value : clean(body.value, 320);
  const label =
    body?.label === undefined ? current[0].label : clean(body.label, 80) || null;
  const isPrimary =
    body?.isPrimary === undefined ? Boolean(current[0].is_primary) : body.isPrimary === true;
  const active =
    body?.active === undefined ? Boolean(current[0].active) : body.active === true;

  if (!CONTACT_TYPES.has(type)) return json({ error: "invalid_contact_type" }, 400);
  if (!rawValue) return json({ error: "contact_value_required" }, 400);
  const normalized = normalizeContact(type, rawValue);

  const row: any = await db.begin(async (tx: DB) => {
    if (isPrimary && active) {
      await tx`
        UPDATE customer_contacts
        SET is_primary = FALSE, updated_at = NOW()
        WHERE customer_id = ${Number(current[0].customer_id)}
          AND type = ${type}
          AND id <> ${contactId}
          AND active = TRUE`;
    }

    const rows = await tx`
      UPDATE customer_contacts
      SET type = ${type},
          raw_value = ${rawValue},
          normalized_value = ${normalized},
          label = ${label},
          is_primary = ${active ? isPrimary : false},
          active = ${active},
          updated_at = NOW()
      WHERE id = ${contactId}
      RETURNING id, customer_id, type, raw_value, normalized_value, label,
                is_primary, verified_at, active, created_at, updated_at`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "customer.contact_updated",
      resourceType: "CustomerContact",
      resourceId: contactId,
      outcome: "SUCCESS",
      metadata: {
        customerId: Number(current[0].customer_id),
        changedFields: Object.keys(body || {})
      }
    });

    return rows[0];
  });

  return json({ contact: mapContact(row) });
}

async function addAddress(req: Request, db: DB, customerId: number) {
  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const customer = await db`
    SELECT id, status
    FROM customers
    WHERE id = ${customerId}
    LIMIT 1`;
  if (!customer.length) return json({ error: "not_found" }, 404);
  if (customer[0].status === "MERGED") return json({ error: "customer_merged" }, 409);

  const recipientName = clean(body?.recipientName, 160);
  const recipientPhone = clean(body?.recipientPhone, 80) || null;
  const countryCode = clean(body?.countryCode, 2).toUpperCase();
  const departmentOrState = clean(body?.departmentOrState, 120) || null;
  const municipalityOrCity = clean(body?.municipalityOrCity, 120) || null;
  const locality = clean(body?.locality, 120) || null;
  const addressLine = clean(body?.addressLine, 500);
  const reference = clean(body?.reference, 500) || null;
  const label = clean(body?.label, 80) || null;
  const isDefault = body?.isDefaultShipping === true;
  const latitude = body?.latitude == null ? null : Number(body.latitude);
  const longitude = body?.longitude == null ? null : Number(body.longitude);

  if (!recipientName) return json({ error: "recipient_name_required" }, 400);
  if (!/^[A-Z]{2}$/.test(countryCode)) return json({ error: "invalid_country_code" }, 400);
  if (!addressLine) return json({ error: "address_line_required" }, 400);
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return json({ error: "invalid_latitude" }, 400);
  }
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return json({ error: "invalid_longitude" }, 400);
  }

  const row: any = await db.begin(async (tx: DB) => {
    if (isDefault) {
      await tx`
        UPDATE customer_addresses
        SET is_default_shipping = FALSE, updated_at = NOW()
        WHERE customer_id = ${customerId}
          AND active = TRUE`;
    }

    const rows = await tx`
      INSERT INTO customer_addresses(
        customer_id, label, recipient_name, recipient_phone, country_code,
        department_or_state, municipality_or_city, locality, address_line,
        reference, latitude, longitude, is_default_shipping
      )
      VALUES(
        ${customerId}, ${label}, ${recipientName}, ${recipientPhone}, ${countryCode},
        ${departmentOrState}, ${municipalityOrCity}, ${locality}, ${addressLine},
        ${reference}, ${latitude}, ${longitude}, ${isDefault}
      )
      RETURNING id, customer_id, label, recipient_name, recipient_phone,
                country_code, department_or_state, municipality_or_city,
                locality, address_line, reference, latitude, longitude,
                is_default_shipping, active, created_at, updated_at`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "customer.address_added",
      resourceType: "CustomerAddress",
      resourceId: Number(rows[0].id),
      outcome: "SUCCESS",
      metadata: { customerId, countryCode, isDefaultShipping: isDefault }
    });

    return rows[0];
  });

  return json({ address: mapAddress(row) }, 201);
}

async function updateAddress(req: Request, db: DB, addressId: number) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const current = await db`
    SELECT *
    FROM customer_addresses
    WHERE id = ${addressId}
    LIMIT 1`;
  if (!current.length) return json({ error: "not_found" }, 404);

  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  const row0 = current[0];
  const recipientName =
    body?.recipientName === undefined ? row0.recipient_name : clean(body.recipientName, 160);
  const recipientPhone =
    body?.recipientPhone === undefined
      ? row0.recipient_phone
      : clean(body.recipientPhone, 80) || null;
  const countryCode =
    body?.countryCode === undefined
      ? row0.country_code
      : clean(body.countryCode, 2).toUpperCase();
  const departmentOrState =
    body?.departmentOrState === undefined
      ? row0.department_or_state
      : clean(body.departmentOrState, 120) || null;
  const municipalityOrCity =
    body?.municipalityOrCity === undefined
      ? row0.municipality_or_city
      : clean(body.municipalityOrCity, 120) || null;
  const locality =
    body?.locality === undefined ? row0.locality : clean(body.locality, 120) || null;
  const addressLine =
    body?.addressLine === undefined ? row0.address_line : clean(body.addressLine, 500);
  const reference =
    body?.reference === undefined ? row0.reference : clean(body.reference, 500) || null;
  const label =
    body?.label === undefined ? row0.label : clean(body.label, 80) || null;
  const isDefault =
    body?.isDefaultShipping === undefined
      ? Boolean(row0.is_default_shipping)
      : body.isDefaultShipping === true;
  const active =
    body?.active === undefined ? Boolean(row0.active) : body.active === true;
  const latitude =
    body?.latitude === undefined
      ? row0.latitude
      : body.latitude == null
        ? null
        : Number(body.latitude);
  const longitude =
    body?.longitude === undefined
      ? row0.longitude
      : body.longitude == null
        ? null
        : Number(body.longitude);

  if (!recipientName) return json({ error: "recipient_name_required" }, 400);
  if (!/^[A-Z]{2}$/.test(countryCode)) return json({ error: "invalid_country_code" }, 400);
  if (!addressLine) return json({ error: "address_line_required" }, 400);

  const row: any = await db.begin(async (tx: DB) => {
    if (isDefault && active) {
      await tx`
        UPDATE customer_addresses
        SET is_default_shipping = FALSE, updated_at = NOW()
        WHERE customer_id = ${Number(row0.customer_id)}
          AND id <> ${addressId}
          AND active = TRUE`;
    }

    const rows = await tx`
      UPDATE customer_addresses
      SET label = ${label},
          recipient_name = ${recipientName},
          recipient_phone = ${recipientPhone},
          country_code = ${countryCode},
          department_or_state = ${departmentOrState},
          municipality_or_city = ${municipalityOrCity},
          locality = ${locality},
          address_line = ${addressLine},
          reference = ${reference},
          latitude = ${latitude},
          longitude = ${longitude},
          is_default_shipping = ${active ? isDefault : false},
          active = ${active},
          updated_at = NOW()
      WHERE id = ${addressId}
      RETURNING id, customer_id, label, recipient_name, recipient_phone,
                country_code, department_or_state, municipality_or_city,
                locality, address_line, reference, latitude, longitude,
                is_default_shipping, active, created_at, updated_at`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "customer.address_updated",
      resourceType: "CustomerAddress",
      resourceId: addressId,
      outcome: "SUCCESS",
      metadata: {
        customerId: Number(row0.customer_id),
        changedFields: Object.keys(body || {})
      }
    });

    return rows[0];
  });

  return json({ address: mapAddress(row) });
}

async function addNote(req: Request, db: DB, customerId: number) {
  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const note = clean(body?.note, 4000);
  if (!note) return json({ error: "note_required" }, 400);

  const customer = await db`SELECT id FROM customers WHERE id = ${customerId} LIMIT 1`;
  if (!customer.length) return json({ error: "not_found" }, 404);

  const userId = auth.actor.type === "USER" ? auth.actor.userId : null;
  const service = auth.actor.type === "SERVICE" ? auth.actor.service : null;

  const rows = await db`
    INSERT INTO customer_notes(
      customer_id, author_user_id, author_service, note, visibility
    )
    VALUES(${customerId}, ${userId}, ${service}, ${note}, 'INTERNAL')
    RETURNING id, created_at`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "customer.note_added",
    resourceType: "CustomerNote",
    resourceId: Number(rows[0].id),
    outcome: "SUCCESS",
    metadata: { customerId }
  });

  return json({
    note: {
      id: Number(rows[0].id),
      customerId,
      visibility: "INTERNAL",
      createdAt: rows[0].created_at
    }
  }, 201);
}

async function setPreference(
  req: Request,
  db: DB,
  customerId: number,
  channel: string,
  purpose: string
) {
  const auth = await authorizeInternal(req, db, "customers.write", { mutation: true });
  if (!auth.ok) return auth.response;

  if (!PREF_CHANNELS.has(channel)) return json({ error: "invalid_channel" }, 400);
  if (!PREF_PURPOSES.has(purpose)) return json({ error: "invalid_purpose" }, 400);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const status = clean(body?.status, 24).toUpperCase();
  const source = clean(body?.source, 80) || "STAFF";
  const evidenceReference = clean(body?.evidenceReference, 240) || null;

  if (!PREF_STATUSES.has(status)) return json({ error: "invalid_preference_status" }, 400);

  const customer = await db`SELECT id FROM customers WHERE id = ${customerId} LIMIT 1`;
  if (!customer.length) return json({ error: "not_found" }, 404);

  const before = await db`
    SELECT status
    FROM customer_preferences
    WHERE customer_id = ${customerId}
      AND channel = ${channel}
      AND purpose = ${purpose}
    LIMIT 1`;
  const previousStatus = before[0]?.status || "UNKNOWN";
  const capturedBy = auth.actor.type === "USER" ? auth.actor.userId : null;

  const rows = await db`
    INSERT INTO customer_preferences(
      customer_id, channel, purpose, status, source,
      evidence_reference, captured_by_user_id, captured_at, updated_at
    )
    VALUES(
      ${customerId}, ${channel}, ${purpose}, ${status}, ${source},
      ${evidenceReference}, ${capturedBy}, NOW(), NOW()
    )
    ON CONFLICT(customer_id, channel, purpose)
    DO UPDATE SET
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      evidence_reference = EXCLUDED.evidence_reference,
      captured_by_user_id = EXCLUDED.captured_by_user_id,
      captured_at = NOW(),
      updated_at = NOW()
    RETURNING id, channel, purpose, status, source, evidence_reference,
              captured_by_user_id, captured_at, updated_at`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "customer.preference_changed",
    resourceType: "CustomerPreference",
    resourceId: Number(rows[0].id),
    outcome: "SUCCESS",
    metadata: {
      customerId,
      channel,
      purpose,
      fromStatus: previousStatus,
      toStatus: status
    }
  });

  return json({
    preference: {
      id: Number(rows[0].id),
      customerId,
      channel: rows[0].channel,
      purpose: rows[0].purpose,
      status: rows[0].status,
      source: rows[0].source,
      evidenceReference: rows[0].evidence_reference || null,
      capturedByUserId:
        rows[0].captured_by_user_id == null ? null : Number(rows[0].captured_by_user_id),
      capturedAt: rows[0].captured_at,
      updatedAt: rows[0].updated_at
    }
  });
}

async function mergeCustomer(req: Request, db: DB, sourceId: number) {
  const auth = await authorizeInternal(req, db, "customers.merge", { mutation: true });
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const targetId = Number(body?.targetCustomerId);
  const reason = clean(body?.reason, 500) || null;

  if (!Number.isSafeInteger(targetId) || targetId < 1) {
    return json({ error: "invalid_target_customer" }, 400);
  }
  if (targetId === sourceId) return json({ error: "cannot_merge_self" }, 400);

  const result: any = await db.begin(async (tx: DB) => {
    const ids = [sourceId, targetId].sort((a, b) => a - b);
    const locked = await tx`
      SELECT id, status, merged_into_customer_id
      FROM customers
      WHERE id IN (${ids[0]}, ${ids[1]})
      ORDER BY id
      FOR UPDATE`;
    if (locked.length !== 2) return { error: "not_found", status: 404 };

    const source = locked.find((row: any) => Number(row.id) === sourceId);
    const target = locked.find((row: any) => Number(row.id) === targetId);
    if (!source || !target) return { error: "not_found", status: 404 };
    if (source.status === "MERGED") {
      return {
        error: "source_already_merged",
        status: 409,
        mergedIntoCustomerId:
          source.merged_into_customer_id == null
            ? null
            : Number(source.merged_into_customer_id)
      };
    }
    if (target.status !== "ACTIVE" || target.merged_into_customer_id != null) {
      return { error: "target_not_canonical_active", status: 409 };
    }

    await tx`
      UPDATE customers
      SET status = 'MERGED',
          merged_into_customer_id = ${targetId},
          updated_at = NOW()
      WHERE id = ${sourceId}`;

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "customer.merged",
      resourceType: "Customer",
      resourceId: sourceId,
      outcome: "SUCCESS",
      reason,
      metadata: { targetCustomerId: targetId }
    });

    return { ok: true };
  });

  if (result.error) return json(result, result.status || 409);
  return json({
    sourceCustomerId: sourceId,
    targetCustomerId: targetId,
    source: await loadCustomer(db, sourceId),
    target: await loadCustomer(db, targetId)
  });
}

export async function handleCustomers(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/customers" && req.method === "POST") {
    return createCustomer(req, db);
  }

  if (url.pathname === "/v1/internal/customers" && req.method === "GET") {
    return listCustomers(req, url, db);
  }

  const customerRoute = url.pathname.match(/^\/v1\/internal\/customers\/(\d+)$/);
  if (customerRoute && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "customers.read");
    if (!auth.ok) return auth.response;
    const customer = await loadCustomer(db, Number(customerRoute[1]));
    return customer ? json({ customer }) : json({ error: "not_found" }, 404);
  }

  if (customerRoute && req.method === "PATCH") {
    return updateCustomer(req, db, Number(customerRoute[1]));
  }

  const contactsRoute = url.pathname.match(/^\/v1\/internal\/customers\/(\d+)\/contacts$/);
  if (contactsRoute && req.method === "POST") {
    return addContact(req, db, Number(contactsRoute[1]));
  }

  const contactRoute = url.pathname.match(/^\/v1\/internal\/customer-contacts\/(\d+)$/);
  if (contactRoute && req.method === "PATCH") {
    return updateContact(req, db, Number(contactRoute[1]));
  }

  const addressesRoute = url.pathname.match(/^\/v1\/internal\/customers\/(\d+)\/addresses$/);
  if (addressesRoute && req.method === "POST") {
    return addAddress(req, db, Number(addressesRoute[1]));
  }

  const addressRoute = url.pathname.match(/^\/v1\/internal\/customer-addresses\/(\d+)$/);
  if (addressRoute && req.method === "PATCH") {
    return updateAddress(req, db, Number(addressRoute[1]));
  }

  const notesRoute = url.pathname.match(/^\/v1\/internal\/customers\/(\d+)\/notes$/);
  if (notesRoute && req.method === "POST") {
    return addNote(req, db, Number(notesRoute[1]));
  }

  const prefRoute = url.pathname.match(
    /^\/v1\/internal\/customers\/(\d+)\/preferences\/([A-Z_]+)\/([A-Z_]+)$/
  );
  if (prefRoute && req.method === "PUT") {
    return setPreference(
      req,
      db,
      Number(prefRoute[1]),
      prefRoute[2],
      prefRoute[3]
    );
  }

  const mergeRoute = url.pathname.match(/^\/v1\/internal\/customers\/(\d+)\/merge$/);
  if (mergeRoute && req.method === "POST") {
    return mergeCustomer(req, db, Number(mergeRoute[1]));
  }

  if (
    url.pathname.startsWith("/v1/internal/customers") ||
    url.pathname.startsWith("/v1/internal/customer-contacts") ||
    url.pathname.startsWith("/v1/internal/customer-addresses")
  ) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
