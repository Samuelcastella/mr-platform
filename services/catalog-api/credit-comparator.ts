export type CreditPlan = {
  provider: string;
  plan: string;
  amountMin: number;
  amountMax: number;
  termsMonths: number[];
  annualRate: number | null;
  monthlyFee: number | null;
  downPaymentMin: number | null;
  verifiedAt: string | null;
  sourceUrl: string | null;
};
export type ComparableQuote = { provider: string; plan: string; monthlyPayment: number; totalPayable: number; totalInterest: number };
import { calculateCredit } from "./credit-calculator";

/** No comparison without verified financial terms and provenance. */
export function comparePlans(plans: CreditPlan[], amount: number, months: number): ComparableQuote[] {
  return plans.flatMap(plan => {
    if (!plan.verifiedAt || !plan.sourceUrl || plan.annualRate === null ||
        plan.monthlyFee === null || plan.downPaymentMin === null ||
        amount < plan.amountMin || amount > plan.amountMax || !plan.termsMonths.includes(months)) return [];
    try {
      const quote = calculateCredit({ amount, downPayment: plan.downPaymentMin, annualRate: plan.annualRate, months, monthlyFee: plan.monthlyFee });
      return [{ provider: plan.provider, plan: plan.plan, monthlyPayment: quote.monthlyPaymentEstimate, totalPayable: quote.totalPayable, totalInterest: quote.totalInterest }];
    } catch { return []; }
  }).sort((a, b) => a.totalPayable - b.totalPayable);
}
