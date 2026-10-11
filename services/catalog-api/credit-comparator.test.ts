import { expect, test } from "bun:test";
import { comparePlans, type CreditPlan } from "./credit-comparator";
test("unverified plans cannot appear as comparable quotes", () => {
  const plan: CreditPlan = { provider: "Example", plan: "Example", amountMin: 100, amountMax: 2000, termsMonths: [12], annualRate: 12, monthlyFee: 0, downPaymentMin: 0, verifiedAt: null, sourceUrl: null };
  expect(comparePlans([plan], 1000, 12)).toEqual([]);
  const quotes = comparePlans([{ ...plan, verifiedAt: "2026-10-10", sourceUrl: "https://example.org/terms" }], 1000, 12);
  expect(quotes).toHaveLength(1);
  expect(quotes[0].totalPayable).toBeGreaterThan(1000);
});
