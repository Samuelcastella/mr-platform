export interface ParcelDimensions { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }
export interface HeavyRate { baseMinor: number; includedGrams: number; additionalMinorPerKg: number; volumetricDivisor: number; maxBillableGrams?: number | null; currency: "HNL" }
export type HeavyQuote = { quoteRequired: true; reason: string } | { quoteRequired: false; shippingMinor: number; currency: "HNL"; actualGrams: number; volumetricGrams: number; billableGrams: number };
const valid = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function calculateHeavyQuote(parcel: ParcelDimensions, rate: HeavyRate | null): HeavyQuote {
  if (![parcel.weightGrams, parcel.lengthCm, parcel.widthCm, parcel.heightCm].every(valid) ||
      parcel.weightGrams === 0 || parcel.lengthCm === 0 || parcel.widthCm === 0 || parcel.heightCm === 0)
    throw new RangeError("invalid_parcel_dimensions");
  if (!rate) return { quoteRequired: true, reason: "rate_not_configured" };
  if (![rate.baseMinor, rate.includedGrams, rate.additionalMinorPerKg, rate.volumetricDivisor].every(valid) ||
      rate.volumetricDivisor === 0 || (rate.maxBillableGrams != null && (!valid(rate.maxBillableGrams) || rate.maxBillableGrams === 0)) || rate.currency !== "HNL")
    throw new RangeError("invalid_rate");
  const volumetricGrams = Math.ceil(parcel.lengthCm * parcel.widthCm * parcel.heightCm * 1000 / rate.volumetricDivisor);
  if (!Number.isSafeInteger(volumetricGrams)) throw new RangeError("parcel_too_large");
  const billableGrams = Math.max(parcel.weightGrams, volumetricGrams);
  if (rate.maxBillableGrams != null && billableGrams > rate.maxBillableGrams)
    return { quoteRequired: true, reason: "exceeds_carrier_limit" };
  const extraKg = Math.ceil(Math.max(0, billableGrams - rate.includedGrams) / 1000);
  const shippingMinor = rate.baseMinor + extraKg * rate.additionalMinorPerKg;
  if (!Number.isSafeInteger(shippingMinor)) throw new RangeError("quote_overflow");
  return { quoteRequired: false, shippingMinor, currency: rate.currency, actualGrams: parcel.weightGrams, volumetricGrams, billableGrams };
}
