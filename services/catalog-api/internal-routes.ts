import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const statuses = new Set([
  "new",
  "reviewing",
  "contacted",
  "qualified",
  "converted",
  "closed",
  "rejected"
]);

function actorLabel(actor: any) {
  return actor.type === "USER" ? "staff:" + actor.userId : "service:" + actor.service;
}

export async function ensureInternalOpsSchema(db: any) {
  await db`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0`;
  await db`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS assigned_to TEXT`;
  await db`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS internal_notes TEXT`;
  await db`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

  await db`
    CREATE TABLE IF NOT EXISTS inquiry_history (
      id BIGSERIAL PRIMARY KEY,
      inquiry_id BIGINT NOT NULL REFERENCES public_inquiries(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_inquiry_history_inquiry_created
    ON inquiry_history(inquiry_id, created_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS sourcing_opportunities (
      id BIGSERIAL PRIMARY KEY,
      inquiry_id BIGINT UNIQUE REFERENCES public_inquiries(id) ON DELETE SET NULL,
      opportunity_type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority SMALLINT NOT NULL DEFAULT 1,
      owner TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_sourcing_opportunities_status_created
    ON sourcing_opportunities(status, created_at DESC)`;
}

export async function handleInternal(
  req: Request,
  url: URL,
  db: any,
  clean: (v: unknown, max: number) => string
) {
  if (!url.pathname.startsWith("/v1/internal/")) return null;

  if (url.pathname === "/v1/internal/control-center/dashboard" && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "inquiries.read");
    if (!auth.ok) return auth.response;

    const status = clean(url.searchParams.get("status"), 32);
    const kind = clean(url.searchParams.get("kind"), 32);
    const q = clean(url.searchParams.get("q"), 120);

    const summary = await db`
      SELECT
        COUNT(*)::int total,
        COUNT(*) FILTER(WHERE status='new')::int new_count,
        COUNT(*) FILTER(WHERE kind='product_request')::int product_requests,
        COUNT(*) FILTER(WHERE kind='supplier')::int suppliers,
        COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '24 hours')::int last_24h,
        COUNT(*) FILTER(
          WHERE assigned_to IS NULL AND status NOT IN ('closed','rejected','converted')
        )::int unassigned,
        COUNT(*) FILTER(
          WHERE status='new' AND created_at<NOW()-INTERVAL '24 hours'
        )::int overdue_new
      FROM public_inquiries`;

    const events = await db`
      SELECT event_name, COUNT(*)::int count
      FROM public_events
      WHERE created_at>=NOW()-INTERVAL '7 days'
      GROUP BY event_name`;

    const demand = await db`
      SELECT
        COALESCE(NULLIF(i.metadata->>'requestedProduct',''),p.name,'Sin especificar') item,
        COUNT(*)::int count
      FROM public_inquiries i
      LEFT JOIN products p ON p.id=i.product_id
      WHERE i.kind='product_request'
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 5`;

    const restock = await db`
      SELECT COALESCE(p.name,'Producto sin relación') item, COUNT(*)::int count
      FROM public_inquiries i
      LEFT JOIN products p ON p.id=i.product_id
      WHERE i.kind='notify'
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 5`;

    const supplierCategories = await db`
      SELECT
        COALESCE(NULLIF(metadata->>'categories',''),'Sin categoría') item,
        COUNT(*)::int count
      FROM public_inquiries
      WHERE kind='supplier'
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 5`;

    const history = await db`
      SELECT inquiry_id, actor, action, from_status, to_status, note, created_at
      FROM inquiry_history
      ORDER BY created_at DESC
      LIMIT 500`;

    const opportunitySummary = await db`
      SELECT
        COUNT(*)::int total,
        COUNT(*) FILTER(WHERE status='open')::int open_count
      FROM sourcing_opportunities`;

    const opportunities = await db`
      SELECT id, inquiry_id, opportunity_type, title, status, priority,
             owner, notes, created_at
      FROM sourcing_opportunities
      WHERE status='open'
      ORDER BY priority DESC, created_at DESC
      LIMIT 12`;

    const inquiries = await db`
      SELECT
        i.id, i.kind, i.name, i.contact, i.country_code, i.product_id,
        i.message, i.metadata, i.status, i.priority, i.assigned_to,
        i.internal_notes, i.created_at, i.updated_at,
        p.name AS product_name
      FROM public_inquiries i
      LEFT JOIN products p ON p.id=i.product_id
      WHERE (${status || null}::text IS NULL OR i.status=${status || null}::text)
        AND (${kind || null}::text IS NULL OR i.kind=${kind || null}::text)
        AND (
          ${q || null}::text IS NULL OR
          i.name ILIKE '%'||${q || null}::text||'%' OR
          i.contact ILIKE '%'||${q || null}::text||'%' OR
          COALESCE(i.message,'') ILIKE '%'||${q || null}::text||'%'
        )
      ORDER BY i.priority DESC, i.created_at DESC
      LIMIT 100`;

    return json({
      summary: summary[0],
      events,
      demand,
      restock,
      supplierCategories,
      history,
      opportunitySummary: opportunitySummary[0],
      opportunities,
      inquiries
    });
  }

  if (url.pathname === "/v1/internal/inquiries/summary" && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "inquiries.read");
    if (!auth.ok) return auth.response;

    const totals = await db`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'new')::int AS new_count,
        COUNT(*) FILTER (WHERE status = 'reviewing')::int AS reviewing_count,
        COUNT(*) FILTER (WHERE status = 'contacted')::int AS contacted_count,
        COUNT(*) FILTER (WHERE status = 'qualified')::int AS qualified_count,
        COUNT(*) FILTER (WHERE status = 'converted')::int AS converted_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h
      FROM public_inquiries`;
    const byKind = await db`
      SELECT kind, COUNT(*)::int AS count
      FROM public_inquiries
      GROUP BY kind
      ORDER BY count DESC, kind`;
    return json({ summary: totals[0], byKind });
  }

  if (url.pathname === "/v1/internal/inquiries/export" && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "inquiries.read");
    if (!auth.ok) return auth.response;

    const rows = await db`
      SELECT
        i.id, i.kind, i.status, i.priority, i.name, i.contact,
        i.country_code, p.name AS product_name, i.created_at
      FROM public_inquiries i
      LEFT JOIN products p ON p.id=i.product_id
      ORDER BY i.created_at DESC
      LIMIT 5000`;
    return json({ data: rows });
  }

  if (url.pathname === "/v1/internal/inquiries" && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "inquiries.read");
    if (!auth.ok) return auth.response;

    const status = clean(url.searchParams.get("status"), 32);
    const kind = clean(url.searchParams.get("kind"), 32);
    const q = clean(url.searchParams.get("q"), 120);
    const rows = await db`
      SELECT
        i.id, i.kind, i.name, i.contact, i.country_code, i.product_id,
        i.message, i.metadata, i.status, i.priority, i.assigned_to,
        i.internal_notes, i.created_at, i.updated_at,
        p.name AS product_name, p.slug AS product_slug
      FROM public_inquiries i
      LEFT JOIN products p ON p.id = i.product_id
      WHERE (${status || null}::text IS NULL OR i.status = ${status || null}::text)
        AND (${kind || null}::text IS NULL OR i.kind = ${kind || null}::text)
        AND (
          ${q || null}::text IS NULL OR
          i.name ILIKE '%' || ${q || null}::text || '%' OR
          i.contact ILIKE '%' || ${q || null}::text || '%' OR
          COALESCE(i.message,'') ILIKE '%' || ${q || null}::text || '%'
        )
      ORDER BY i.priority DESC, i.created_at DESC
      LIMIT 100`;
    return json({ data: rows });
  }

  const opportunityMatch = url.pathname.match(
    /^\/v1\/internal\/inquiries\/(\d+)\/opportunity$/
  );
  if (opportunityMatch && req.method === "POST") {
    const auth = await authorizeInternal(req, db, "inquiries.write", { mutation: true });
    if (!auth.ok) return auth.response;

    const id = Number(opportunityMatch[1]);
    const result: any = await db.begin(async (tx: any) => {
      const inquiry = await tx`
        SELECT id, kind, name, message, metadata
        FROM public_inquiries
        WHERE id=${id}
        FOR UPDATE`;
      if (!inquiry.length) return { error: "not_found", status: 404 };

      const row: any = inquiry[0];
      const meta =
        row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const title = String(
        meta.requestedProduct ||
        meta.categories ||
        row.message ||
        row.name ||
        ("Solicitud #" + row.id)
      ).slice(0, 180);
      const type =
        row.kind === "supplier"
          ? "supplier_lead"
          : row.kind === "partnership"
            ? "partnership"
            : row.kind === "notify"
              ? "restock"
              : "product_demand";
      const owner = actorLabel(auth.actor);

      const opportunities = await tx`
        INSERT INTO sourcing_opportunities(
          inquiry_id, opportunity_type, title, priority, owner, notes
        )
        VALUES(
          ${row.id}, ${type}, ${title}, 1, ${owner}, ${row.message || null}
        )
        ON CONFLICT(inquiry_id)
        DO UPDATE SET
          opportunity_type=EXCLUDED.opportunity_type,
          title=EXCLUDED.title,
          owner=EXCLUDED.owner,
          notes=EXCLUDED.notes,
          updated_at=NOW()
        RETURNING id, inquiry_id, opportunity_type, title, status,
                  priority, owner, notes, created_at, updated_at`;

      await tx`
        INSERT INTO inquiry_history(
          inquiry_id, actor, action, from_status, to_status, note
        )
        VALUES(
          ${row.id}, ${owner}, 'create_opportunity',
          NULL, NULL, 'Converted to sourcing opportunity'
        )`;

      await writeAuditEvent(tx, {
        ...auditActor(auth.actor),
        action: "inquiry.opportunity_created",
        resourceType: "Inquiry",
        resourceId: row.id,
        outcome: "SUCCESS",
        metadata: {
          opportunityId: Number(opportunities[0].id),
          opportunityType: type
        }
      });

      return { opportunity: opportunities[0] };
    });

    if (result.error) return json({ error: result.error }, result.status || 409);
    return json(result, 201);
  }

  const match = url.pathname.match(/^\/v1\/internal\/inquiries\/(\d+)$/);
  if (match && req.method === "PATCH") {
    const auth = await authorizeInternal(req, db, "inquiries.write", { mutation: true });
    if (!auth.ok) return auth.response;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const status = clean(body.status, 32);
    if (!statuses.has(status)) return json({ error: "invalid_status" }, 400);

    const rawPriority = body?.priority == null ? null : Number(body.priority);
    if (
      rawPriority != null &&
      (!Number.isInteger(rawPriority) || rawPriority < 0 || rawPriority > 3)
    ) {
      return json({ error: "invalid_priority" }, 400);
    }

    const assignedTo =
      body?.assignedTo == null ? undefined : clean(body.assignedTo, 120) || null;
    const internalNotes =
      body?.internalNotes == null ? undefined : clean(body.internalNotes, 4000) || null;
    const id = Number(match[1]);

    const result: any = await db.begin(async (tx: any) => {
      const prior = await tx`
        SELECT id, kind, status, priority, assigned_to, internal_notes
        FROM public_inquiries
        WHERE id = ${id}
        FOR UPDATE`;
      if (!prior.length) return { error: "not_found", status: 404 };

      const before = prior[0];
      const nextPriority = rawPriority == null ? Number(before.priority || 0) : rawPriority;
      const nextAssigned = assignedTo === undefined ? before.assigned_to : assignedTo;
      const nextNotes = internalNotes === undefined ? before.internal_notes : internalNotes;
      const owner = actorLabel(auth.actor);

      const rows = await tx`
        UPDATE public_inquiries
        SET status = ${status},
            priority = ${nextPriority},
            assigned_to = ${nextAssigned},
            internal_notes = ${nextNotes},
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, kind, status, priority, assigned_to,
                  internal_notes, updated_at`;

      await tx`
        INSERT INTO inquiry_history(
          inquiry_id, actor, action, from_status, to_status, note
        )
        VALUES(
          ${id}, ${owner}, 'update',
          ${before.status}, ${status}, ${nextNotes || null}
        )`;

      await writeAuditEvent(tx, {
        ...auditActor(auth.actor),
        action: "inquiry.updated",
        resourceType: "Inquiry",
        resourceId: id,
        outcome: "SUCCESS",
        reason: nextNotes || null,
        metadata: {
          kind: before.kind,
          fromStatus: before.status,
          toStatus: status,
          fromPriority: Number(before.priority || 0),
          toPriority: nextPriority,
          assignedTo: nextAssigned
        }
      });

      return { inquiry: rows[0] };
    });

    if (result.error) return json({ error: result.error }, result.status || 409);
    return json({ inquiry: result.inquiry });
  }

  return null;
}
