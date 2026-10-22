import { calculateHeavyQuote, type HeavyQuote, type ParcelDimensions, type HeavyRate } from "./heavy-logistics";

type DB = any;
export interface HeavyRateSelection {
  provider: string;
  department: string;
  serviceType: "LOCAL_DELIVERY" | "COURIER";
  rateId: number;
  quotedAt: string;
  quote: Extract<HeavyQuote, { quoteRequired: false }>;
}
export type HeavyRateResult =
  | { quoteRequired: true; reason: string }
  | { quoteRequired: false; selection: HeavyRateSelection };

export async function quoteHeavyDelivery(
  db: DB,
  input: { variantId: number; department: string; serviceType: "LOCAL_DELIVERY" | "COURIER" },
  now = new Date()
): Promise<HeavyRateResult> {
  if (!Number.isSafeInteger(input.variantId) || input.variantId <= 0) throw new RangeError("invalid_variant");
  if (!input.department || !["LOCAL_DELIVERY", "COURIER"].includes(input.serviceType)) throw new RangeError("invalid_destination");
  const profiles = await db`
    SELECT weight_grams, length_cm, width_cm, height_cm, requires_special_handling
    FROM product_shipping_profiles
    WHERE variant_id = ${input.variantId}
    LIMIT 1`;
  if (!profiles.length) return { quoteRequired: true, reason: "shipping_profile_missing" };
  const p = profiles[0];
  if (p.requires_special_handling === true)
    return { quoteRequired: true, reason: "special_handling_requires_manual_quote" };
  const parcel: ParcelDimensions = {
    weightGrams: Number(p.weight_grams),
    lengthCm: Number(p.length_cm),
    widthCm: Number(p.width_cm),
    heightCm: Number(p.height_cm)
  };
  const rates = await db`
    SELECT id, provider, base_minor, included_grams, additional_minor_per_kg,
           volumetric_divisor, max_billable_grams, handling_minor, minimum_minor, max_edge_cm, currency
    FROM carrier_heavy_rates
    WHERE department = ${input.department}
      AND service_type = ${input.serviceType}
      AND active = TRUE
      AND effective_from <= ${now}
      AND (effective_until IS NULL OR effective_until > ${now})
    ORDER BY effective_from DESC, id DESC
    LIMIT 1`;
  if (!rates.length) return { quoteRequired: true, reason: "rate_not_configured" };
  const r = rates[0];
  const rate: HeavyRate = {
    baseMinor: Number(r.base_minor),
    includedGrams: Number(r.included_grams),
    additionalMinorPerKg: Number(r.additional_minor_per_kg),
    volumetricDivisor: Number(r.volumetric_divisor),
    maxBillableGrams: r.max_billable_grams == null ? null : Number(r.max_billable_grams),
    handlingMinor: Number(r.handling_minor),
    minimumMinor: Number(r.minimum_minor),
    maxEdgeCm: r.max_edge_cm == null ? null : Number(r.max_edge_cm),
    currency: r.currency
  };
  const quote = calculateHeavyQuote(parcel, rate);
  if (quote.quoteRequired) return quote;
  return {
    quoteRequired: false,
    selection: {
      provider: r.provider,
      department: input.department,
      serviceType: input.serviceType,
      rateId: Number(r.id),
      quotedAt: now.toISOString(),
      quote
    }
  };
}
