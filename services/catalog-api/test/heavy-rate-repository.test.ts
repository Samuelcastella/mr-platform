import { test, expect } from "bun:test";
import { quoteHeavyDelivery } from "../heavy-rate-repository";

const input = { variantId: 7, department: "Cortés", serviceType: "COURIER" as const };
const profile = { weight_grams: 10000, length_cm: 50, width_cm: 40, height_cm: 30 };
const rate = { id: 9, provider: "INTERNAL", base_minor: 20000, included_grams: 10000, additional_minor_per_kg: 1000, volumetric_divisor: 5000, max_billable_grams: null, currency: "HNL" };
function mockDB(profiles: any[], rates: any[]) {
  let calls = 0;
  return Object.assign((_strings: TemplateStringsArray, ..._values: any[]) => Promise.resolve(++calls === 1 ? profiles : rates), { calls: () => calls });
}
test("returns manual quotation when profile is missing", async () => {
  const db = mockDB([], []);
  expect(await quoteHeavyDelivery(db, input)).toEqual({ quoteRequired: true, reason: "shipping_profile_missing" });
  expect(db.calls()).toBe(1);
});
test("refuses automatic pricing for items needing special handling", async () => {
  const db = mockDB([{ ...profile, requires_special_handling: true }], [rate]);
  expect(await quoteHeavyDelivery(db, input)).toEqual({
    quoteRequired: true, reason: "special_handling_requires_manual_quote"
  });
  expect(db.calls()).toBe(1);
});
test("returns manual quotation when active rate is missing", async () => {
  expect(await quoteHeavyDelivery(mockDB([profile], []), input)).toEqual({ quoteRequired: true, reason: "rate_not_configured" });
});
test("returns auditable selected rate and price", async () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const result = await quoteHeavyDelivery(mockDB([profile], [rate]), input, now);
  expect(result.quoteRequired).toBe(false);
  if (result.quoteRequired) return;
  expect(result.selection.rateId).toBe(9);
  expect(result.selection.provider).toBe("INTERNAL");
  expect(result.selection.quotedAt).toBe(now.toISOString());
  expect(result.selection.quote.shippingMinor).toBe(22000);
});
test("includes fee, minimum and size limits from the selected carrier row", async () => {
  const result = await quoteHeavyDelivery(mockDB([profile], [{
    ...rate, handling_minor: 300, minimum_minor: 26000, max_edge_cm: 50
  }]), input);
  expect(result.quoteRequired).toBe(false);
  if (result.quoteRequired) return;
  expect(result.selection.quote.shippingMinor).toBe(26000);
});
test("rejects invalid variant id", async () => {
  await expect(quoteHeavyDelivery(mockDB([], []), { ...input, variantId: -1 })).rejects.toThrow("invalid_variant");
});
