import { calculateHeavyOrderQuote } from "./heavy-order-quote";
import { calculateHeavyQuote } from "./heavy-logistics";

type DB = any;
type ServiceType = "LOCAL_DELIVERY" | "COURIER";
const valid = (v: number) => Number.isSafeInteger(v) && v > 0;

/** Must be called only inside a db.begin transaction. Locks order before reading its lines. */
export async function createHeavyOrderQuoteInTx(
  tx: DB, input: { orderId: number; orderToken: string; department: string; serviceType: ServiceType },
  now = new Date()
) {
  if (!valid(input.orderId) || !input.orderToken || !input.department ||
      !["LOCAL_DELIVERY", "COURIER"].includes(input.serviceType))
    return { error: "invalid_input", status: 400 };
  const orders = await tx`SELECT id, public_token, status, currency FROM orders WHERE id = ${input.orderId} FOR UPDATE`;
  if (!orders.length || String(orders[0].public_token) !== input.orderToken)
    return { error: "order_not_found", status: 404 };
  if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(orders[0].status) || orders[0].currency !== "HNL")
    return { error: "order_not_eligible", status: 409 };
  if ((await tx`SELECT id FROM checkout_sessions WHERE order_id = ${input.orderId} LIMIT 1`).length ||
      (await tx`SELECT id FROM fulfillments WHERE order_id = ${input.orderId} LIMIT 1`).length ||
      (await tx`SELECT id FROM heavy_logistics_quotes WHERE order_id = ${input.orderId} AND status = 'ACCEPTED' LIMIT 1`).length)
    return { error: "order_already_processing", status: 409 };
  const lines = await tx`SELECT variant_id, quantity FROM order_items WHERE order_id = ${input.orderId} ORDER BY variant_id`;
  if (!lines.length || lines.length > 30) return { error: "invalid_order_lines", status: 409 };
  const rates = await tx`SELECT id, provider, base_minor, included_grams, additional_minor_per_kg,
    volumetric_divisor, max_billable_grams, currency FROM carrier_heavy_rates
    WHERE department = ${input.department} AND service_type = ${input.serviceType}
      AND active = TRUE AND effective_from <= ${now}
      AND (effective_until IS NULL OR effective_until > ${now})
    ORDER BY effective_from DESC, id DESC LIMIT 1`;
  if (!rates.length) return { quoteRequired: true, reason: "rate_not_configured" };
  const r = rates[0];
  const rate = {
    baseMinor: Number(r.base_minor), includedGrams: Number(r.included_grams),
    additionalMinorPerKg: Number(r.additional_minor_per_kg),
    volumetricDivisor: Number(r.volumetric_divisor),
    maxBillableGrams: r.max_billable_grams == null ? null : Number(r.max_billable_grams),
    currency: r.currency as "HNL"
  };
  const variants = lines.map((l: any) => Number(l.variant_id));
  const profiles = await tx`SELECT variant_id, weight_grams, length_cm, width_cm, height_cm
    FROM product_shipping_profiles WHERE variant_id = ANY(${variants})`;
  const byVariant = new Map(profiles.map((p: any) => [Number(p.variant_id), p]));
  if (byVariant.size !== variants.length) return { quoteRequired: true, reason: "shipping_profile_missing" };
  const quoteLines = lines.map((line: any) => {
    const variantId = Number(line.variant_id), p: any = byVariant.get(variantId);
    return { variantId, quantity: Number(line.quantity), parcel: {
      weightGrams: Number(p.weight_grams), lengthCm: Number(p.length_cm),
      widthCm: Number(p.width_cm), heightCm: Number(p.height_cm)
    } };
  });
  const quote = calculateHeavyOrderQuote(quoteLines, rate);
  if (quote.quoteRequired) return quote;
  const expiry = new Date(now.getTime() + 15 * 60 * 1000);
  const parent = await tx`INSERT INTO heavy_logistics_quotes
    (order_id, variant_id, rate_id, provider, department, service_type,
     actual_grams, volumetric_grams, billable_grams, shipping_minor, currency, expires_at)
    VALUES (${input.orderId}, ${quoteLines[0].variantId}, ${Number(r.id)}, ${r.provider},
      ${input.department}, ${input.serviceType}, ${quote.actualGrams},
      ${quote.volumetricGrams}, ${quote.billableGrams}, ${quote.shippingMinor}, 'HNL', ${expiry})
    RETURNING id, public_token`;
  for (const line of quoteLines) {
    const unit = calculateHeavyQuote(line.parcel, rate);
    if (unit.quoteRequired) throw new Error("unexpected_unpriced_line");
    const actual = unit.actualGrams * line.quantity;
    const volumetric = unit.volumetricGrams * line.quantity;
    const billable = unit.billableGrams * line.quantity;
    const shipping = unit.shippingMinor * line.quantity;
    await tx`INSERT INTO heavy_logistics_quote_lines
      (quote_id, variant_id, quantity, actual_grams, volumetric_grams, billable_grams, shipping_minor)
      VALUES (${parent[0].id}, ${line.variantId}, ${line.quantity}, ${actual}, ${volumetric},
        ${billable}, ${shipping})`;
  }
  return { created: true, quoteId: Number(parent[0].id), quoteToken: parent[0].public_token,
    shippingMinor: quote.shippingMinor, currency: "HNL", expiresAt: expiry.toISOString(),
    lineCount: quote.lineCount, unitCount: quote.unitCount };
}
