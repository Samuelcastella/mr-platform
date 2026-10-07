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

export async function handleInternal(
  req: Request,
  url: URL,
  db: any,
  clean: (v: unknown, max: number) => string
) {
  if (!url.pathname.startsWith("/v1/internal/")) return null;

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

  if (url.pathname === "/v1/internal/inquiries" && req.method === "GET") {
    const auth = await authorizeInternal(req, db, "inquiries.read");
    if (!auth.ok) return auth.response;

    const status = clean(url.searchParams.get("status"), 32);
    const kind = clean(url.searchParams.get("kind"), 32);
    const q = clean(url.searchParams.get("q"), 120);
    const rows = await db`
      SELECT
        i.id, i.kind, i.name, i.contact, i.country_code, i.product_id,
        i.message, i.metadata, i.status, i.created_at, i.updated_at,
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
      ORDER BY i.created_at DESC
      LIMIT 100`;
    return json({ data: rows });
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
    const id = Number(match[1]);

    const result: any = await db.begin(async (tx: any) => {
      const prior = await tx`
        SELECT id, kind, status
        FROM public_inquiries
        WHERE id = ${id}
        FOR UPDATE`;
      if (!prior.length) return { error: "not_found", status: 404 };

      const before = prior[0];
      const rows = await tx`
        UPDATE public_inquiries
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, kind, status, updated_at`;

      await writeAuditEvent(tx, {
        ...auditActor(auth.actor),
        action: "inquiry.status_changed",
        resourceType: "Inquiry",
        resourceId: id,
        outcome: "SUCCESS",
        metadata: {
          kind: before.kind,
          fromStatus: before.status,
          toStatus: status
        }
      });

      return { inquiry: rows[0] };
    });

    if (result.error) return json({ error: result.error }, result.status || 409);
    return json({ inquiry: result.inquiry });
  }

  return json({ error: "not_found" }, 404);
}
