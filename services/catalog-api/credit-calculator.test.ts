import { describe, expect, test } from "bun:test";
import { calculateCredit } from "./credit-calculator";
describe("credit amortization", () => {
  test("zero-interest installments settle exactly", () => {
    const result = calculateCredit({ amount: 1200, downPayment: 200, annualRate: 0, months: 3 });
    expect(result.financed).toBe(1000);
    expect(result.totalInterest).toBe(0);
    expect(result.schedule.at(-1)?.balance).toBe(0);
    expect(result.totalPayable).toBe(1200);
  });
  test("interest increases total payable", () => {
    const result = calculateCredit({ amount: 15000, downPayment: 0, annualRate: 24, months: 12 });
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.schedule.at(-1)?.balance).toBe(0);
  });
  test("rejects invalid values", () => {
    expect(() => calculateCredit({ amount: 100, downPayment: 101, annualRate: 0, months: 12 })).toThrow();
    expect(() => calculateCredit({ amount: 100, downPayment: 0, annualRate: 0, months: 0 })).toThrow();
  });
});
