import { test, expect } from "bun:test";
import { calculateHeavyOrderQuote } from "../heavy-order-quote";
import { createHeavyOrderQuoteInTx } from "../heavy-order-quote-repository";

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
test("order quote refuses special-handling profiles before persisting any snapshot", async () => {
  const queries: string[] = [];
  const tx = (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    queries.push(sql);
    if (sql.includes("FROM orders WHERE")) return Promise.resolve([{
      id: 2, public_token: "order-token", status: "PENDING_CONFIRMATION", currency: "HNL"
    }]);
    if (sql.includes("FROM order_items")) return Promise.resolve([{ variant_id: 1, quantity: 1 }]);
    if (sql.includes("FROM carrier_heavy_rates")) return Promise.resolve([{
      id: 3, provider: "INTERNAL", base_minor: 1000, included_grams: 5000,
      additional_minor_per_kg: 100, volumetric_divisor: 5000,
      max_billable_grams: null, handling_minor: 0, minimum_minor: 0,
      max_edge_cm: null, currency: "HNL"
    }]);
    if (sql.includes("FROM product_shipping_profiles")) return Promise.resolve([{
      variant_id: 1, weight_grams: 6000, length_cm: 20, width_cm: 20,
      height_cm: 20, requires_special_handling: true
    }]);
    return Promise.resolve([]);
  };
  const result = await createHeavyOrderQuoteInTx(tx, {
    orderId: 2, orderToken: "order-token", department: "Cortés", serviceType: "COURIER"
  });
  expect(result).toEqual({ quoteRequired: true, reason: "special_handling_requires_manual_quote" });
  expect(queries.some(q => q.includes("INSERT INTO heavy_logistics_quotes"))).toBe(false);
});
test("rejects unsafe multiplied monetary totals", () => {
  const expensive = { ...rate, baseMinor: Number.MAX_SAFE_INTEGER - 100 };
  expect(() => calculateHeavyOrderQuote([{ variantId: 1, quantity: 2, parcel }], expensive))
    .toThrow("order_weight_overflow");
});
