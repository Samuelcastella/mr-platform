import { createHeavyOrderQuoteInTx } from "./heavy-order-quote-repository";
import { HONDURAS_DEPARTMENTS } from "./fulfillment";

type DB = any;
export async function handleHeavyOrderQuote(req: Request, url: URL, db: DB) {
  if (url.pathname !== "/v1/heavy-logistics/order-quotes") return null;
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (Number(req.headers.get("content-length") || 0) > 8192)
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      body.shippingMinor != null || body.lines != null || body.rateId != null)
    return Response.json({ error: "client_quote_not_allowed" }, { status: 400 });
  const department = HONDURAS_DEPARTMENTS.find(
    d => d.toLocaleLowerCase("es") === String(body.department || "").trim().toLocaleLowerCase("es")
  );
  if (!department) return Response.json({ error: "invalid_department" }, { status: 400 });
  const result = await db.begin((tx: DB) => createHeavyOrderQuoteInTx(tx, {
    orderId: Number(body.orderId), orderToken: String(body.orderToken || ""),
    department, serviceType: body.serviceType
  }));
  return Response.json(result, {
    status: "error" in result ? result.status : result.quoteRequired ? 409 : 201,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
