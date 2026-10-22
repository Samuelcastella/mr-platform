import { test, expect } from "bun:test";
import { calculateHeavyQuote } from "../heavy-logistics";
const parcel = { weightGrams: 10000, lengthCm: 50, widthCm: 40, heightCm: 30 };
const rate = { baseMinor: 20000, includedGrams: 10000, additionalMinorPerKg: 1000, volumetricDivisor: 5000, currency: "HNL" as const };
test("uses volumetric weight and charges whole additional kilograms", () => {
  expect(calculateHeavyQuote(parcel, rate)).toEqual({ quoteRequired: false, shippingMinor: 22000, currency: "HNL", actualGrams: 10000, volumetricGrams: 12000, billableGrams: 12000 });
});
test("adds contracted handling fee and applies a per-unit minimum", () => {
  expect(calculateHeavyQuote(parcel, { ...rate, handlingMinor: 300, minimumMinor: 25000 }))
    .toMatchObject({ quoteRequired: false, shippingMinor: 25000 });
  expect(calculateHeavyQuote(parcel, { ...rate, handlingMinor: 300, minimumMinor: 100 }))
    .toMatchObject({ quoteRequired: false, shippingMinor: 22300 });
});
test("requires manual quotation when the longest edge exceeds carrier limit", () => {
  expect(calculateHeavyQuote(parcel, { ...rate, maxEdgeCm: 49 }))
    .toEqual({ quoteRequired: true, reason: "exceeds_carrier_dimensions" });
  expect(calculateHeavyQuote(parcel, { ...rate, maxEdgeCm: 50 }))
    .toMatchObject({ quoteRequired: false });
});
test("missing rate requires manual quotation", () => {
  expect(calculateHeavyQuote(parcel, null)).toEqual({ quoteRequired: true, reason: "rate_not_configured" });
});
test("carrier limit requires quotation", () => {
  expect(calculateHeavyQuote(parcel, { ...rate, maxBillableGrams: 11000 })).toEqual({ quoteRequired: true, reason: "exceeds_carrier_limit" });
});
test("rejects invalid measurements", () => {
  expect(() => calculateHeavyQuote({ ...parcel, weightGrams: -1 }, rate)).toThrow("invalid_parcel_dimensions");
});
test("rejects invalid rates", () => {
  expect(() => calculateHeavyQuote(parcel, { ...rate, volumetricDivisor: 0 })).toThrow("invalid_rate");
});

test("rejects invalid carrier maximum weight", () => {
  expect(() => calculateHeavyQuote(parcel, { ...rate, maxBillableGrams: -1 })).toThrow("invalid_rate");
  expect(() => calculateHeavyQuote(parcel, { ...rate, maxBillableGrams: 0 })).toThrow("invalid_rate");
});
test("rejects invalid dimensional and fee configuration", () => {
  expect(() => calculateHeavyQuote(parcel, { ...rate, maxEdgeCm: -10 })).toThrow("invalid_rate");
  expect(() => calculateHeavyQuote(parcel, { ...rate, handlingMinor: -1 })).toThrow("invalid_rate");
  expect(() => calculateHeavyQuote(parcel, { ...rate, minimumMinor: -1 })).toThrow("invalid_rate");
});
test("rejects monetary overflow", () => {
  expect(() => calculateHeavyQuote(parcel, { ...rate, baseMinor: Number.MAX_SAFE_INTEGER })).toThrow("quote_overflow");
});
