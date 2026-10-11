import { test, expect } from "bun:test";
import { calculateHeavyOrderQuote } from "../heavy-order-quote";

const rate = { baseMinor: 1000, includedGrams: 5000, additionalMinorPerKg: 100,
  volumetricDivisor: 5000, currency: "HNL" as const };
const parcel = { weightGrams: 6000, lengthCm: 20, widthCm: 20, heightCm: 20 };

test("quotes every item and quantity with carrier base per parcel", () => {
  expect(calculateHeavyOrderQuote([
    { variantId: 1, quantity: 2, parcel },
    { variantId: 2, quantity: 1, parcel }
  ], rate)).toEqual({
    quoteRequired: false, shippingMinor: 3300, currency: "HNL",
    actualGrams: 18000, volumetricGrams: 4800, billableGrams: 18000,
    lineCount: 2, unitCount: 3
  });
});
test("requires manual quote when carrier rate is missing", () => {
  expect(calculateHeavyOrderQuote([{ variantId: 1, quantity: 1, parcel }], null))
    .toEqual({ quoteRequired: true, reason: "rate_not_configured" });
});
test("rejects duplicate variants and invalid quantities", () => {
  expect(() => calculateHeavyOrderQuote([
    { variantId: 1, quantity: 1, parcel }, { variantId: 1, quantity: 1, parcel }
  ], rate)).toThrow("invalid_order_line");
  expect(() => calculateHeavyOrderQuote([{ variantId: 1, quantity: 0, parcel }], rate))
    .toThrow("invalid_order_line");
});
test("rejects unsafe multiplied monetary totals", () => {
  const expensive = { ...rate, baseMinor: Number.MAX_SAFE_INTEGER };
  expect(() => calculateHeavyOrderQuote([{ variantId: 1, quantity: 2, parcel }], expensive))
    .toThrow("order_weight_overflow");
});
