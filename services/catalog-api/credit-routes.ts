import { calculateCredit } from "./credit-calculator";

const response = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
});

/** Public, stateless illustrative calculation. Never implies a lender offer or approval. */
export async function handleCredit(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== "/v1/credit/simulate") return null;
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType))
    return response({ error: "unsupported_media_type" }, 415);
  if (Number(req.headers.get("content-length") || 0) > 4096)
    return response({ error: "payload_too_large" }, 413);
  let raw = "";
  try {
    if (!req.body) return response({ error: "invalid_json" }, 400);
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.length > 4096) { await reader.cancel(); return response({ error: "payload_too_large" }, 413); }
    }
    raw += decoder.decode();
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid");
    const keys = ["amount", "downPayment", "annualRate", "months", "monthlyFee"];
    if (Object.keys(body).some(key => !keys.includes(key))) throw Error("unknown_fields");
    for (const key of keys.slice(0, 4)) if (typeof body[key] !== "number") throw Error("invalid_types");
    if (body.monthlyFee !== undefined && typeof body.monthlyFee !== "number") throw Error("invalid_types");
    return response({ illustrative: true, ...calculateCredit(body) });
  } catch {
    return response({ error: "invalid_credit_input" }, 400);
  }
}
