import { calculateHeavyQuote, type HeavyRate, type ParcelDimensions, type HeavyQuote } from "./heavy-logistics";

export interface HeavyOrderLine {
  variantId: number;
  quantity: number;
  parcel: ParcelDimensions;
}
export type HeavyOrderQuote = HeavyQuote & { lineCount?: number; unitCount?: number };

const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const safeSum = (a: number, b: number) => {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError("order_weight_overflow");
  return sum;
};

/**
 * Conservative separate-parcel model: each unit ships independently.
 * Do not combine dimensions into a fictitious box or discount the carrier's
 * base charge. One base charge is assessed per unit until a carrier-approved
 * consolidation/packaging rule is available.
 */
export function calculateHeavyOrderQuote(lines: HeavyOrderLine[], rate: HeavyRate | null): HeavyOrderQuote {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 30)
    throw new RangeError("invalid_order_lines");
  const seen = new Set<number>();
  let actualGrams = 0, volumetricGrams = 0, billableGrams = 0, shippingMinor = 0, unitCount = 0;
  for (const line of lines) {
    if (!positive(line.variantId) || !positive(line.quantity) || line.quantity > 99 || seen.has(line.variantId))
      throw new RangeError("invalid_order_line");
    seen.add(line.variantId);
    const unit = calculateHeavyQuote(line.parcel, rate);
    if (unit.quoteRequired) return unit;
    for (const [field, value] of Object.entries({
      actualGrams: unit.actualGrams, volumetricGrams: unit.volumetricGrams,
      billableGrams: unit.billableGrams, shippingMinor: unit.shippingMinor
    })) {
      const extended = value * line.quantity;
      if (!Number.isSafeInteger(extended)) throw new RangeError("order_weight_overflow");
      if (field === "actualGrams") actualGrams = safeSum(actualGrams, extended);
      else if (field === "volumetricGrams") volumetricGrams = safeSum(volumetricGrams, extended);
      else if (field === "billableGrams") billableGrams = safeSum(billableGrams, extended);
      else shippingMinor = safeSum(shippingMinor, extended);
    }
    unitCount = safeSum(unitCount, line.quantity);
  }
  return { quoteRequired: false, shippingMinor, currency: "HNL", actualGrams,
    volumetricGrams, billableGrams, lineCount: lines.length, unitCount };
}
