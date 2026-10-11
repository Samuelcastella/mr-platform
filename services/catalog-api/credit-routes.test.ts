import { describe, expect, test } from "bun:test";
import { handleCredit } from "./credit-routes";
const url = new URL("http://localhost/v1/credit/simulate");
const request = (body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
describe("credit API", () => {
  test("returns amortization and illustration flag", async () => {
    const response = await handleCredit(request({ amount: 1200, downPayment: 200, annualRate: 0, months: 3 }), url);
    expect(response?.status).toBe(200);
    const result = await response!.json();
    expect(result.illustrative).toBe(true);
    expect(result.totalPayable).toBe(1200);
    expect(result.schedule).toHaveLength(3);
  });
  test("rejects malformed terms", async () => {
    expect((await handleCredit(request({ amount: -1, downPayment: 0, annualRate: 0, months: 12 }), url))?.status).toBe(400);
    expect((await handleCredit(request({ amount: "100", downPayment: 0, annualRate: 0, months: 12 }), url))?.status).toBe(400);
  });
  test("rejects unsupported methods", async () => {
    expect((await handleCredit(new Request(url), url))?.status).toBe(405);
  });
});
