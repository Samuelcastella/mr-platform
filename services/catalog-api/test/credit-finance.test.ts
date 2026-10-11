import { test, expect } from "bun:test";
import { simulateCredit,compareOffers, type CreditOffer } from "../credit-finance";
const offer:CreditOffer={providerCode:"TEST",providerName:"Demo",months:12,annualNominalBps:3000,downPaymentMinor:0,setupFeeMinor:0,recurringFeeMinor:0,insurancePerMonthMinor:0,verifiedAt:null,validUntil:null,sourceUrl:null,indicative:true};
test("zero-interest schedule conserves all principal",()=>{
  const result=simulateCredit(1500000,{...offer,annualNominalBps:0});
  expect(result.rows.reduce((sum,r)=>sum+r.principalMinor,0)).toBe(1500000);
  expect(result.rows.at(-1)?.balanceMinor).toBe(0);
  expect(result.totalOutlayMinor).toBe(1500000);
});
test("amortization balances and totals reconcile",()=>{
  const r=simulateCredit(1500000,offer);
  expect(r.rows.length).toBe(12);
  expect(r.rows.at(-1)?.balanceMinor).toBe(0);
  expect(r.rows.reduce((s,x)=>s+x.principalMinor,0)).toBe(r.financedMinor);
  expect(r.rows.reduce((s,x)=>s+x.paymentMinor,0)+r.downPaymentMinor).toBe(r.totalOutlayMinor);
  expect(r.totalOutlayMinor).toBeGreaterThan(1500000);
});
test("reject invalid bounds and distinguish stale offers",()=>{
  expect(()=>simulateCredit(-1,offer)).toThrow();
  expect(()=>simulateCredit(500,{...offer,downPaymentMinor:600})).toThrow();
  expect(compareOffers(20000,[offer])[0].termsCurrent).toBe(false);
});
test("fees included in total and effective rate",()=>{
 const r=simulateCredit(500000,{...offer,setupFeeMinor:2000,insurancePerMonthMinor:500});
 expect(r.totalFeesMinor).toBe(8000);
 expect(r.effectiveAnnualRatePercent).toBeGreaterThan(30);
});
