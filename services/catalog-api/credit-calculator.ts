export type CreditInput = { amount: number; downPayment: number; annualRate: number; months: number; monthlyFee?: number };
export type Installment = { period: number; payment: number; principal: number; interest: number; balance: number };
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculateCredit(input: CreditInput) {
  const { amount, downPayment, annualRate, months, monthlyFee = 0 } = input;
  if (![amount, downPayment, annualRate, months, monthlyFee].every(Number.isFinite) ||
      amount <= 0 || downPayment < 0 || downPayment > amount ||
      annualRate < 0 || annualRate > 100 || !Number.isInteger(months) ||
      months < 1 || months > 120 || monthlyFee < 0) {
    throw new RangeError("Invalid credit terms");
  }
  const financed = round(amount - downPayment);
  const rate = annualRate / 1200;
  const regular = financed === 0 ? 0 : rate === 0 ? financed / months :
    financed * rate / (1 - Math.pow(1 + rate, -months));
  let balance = financed;
  const schedule: Installment[] = [];
  for (let period = 1; period <= months; period++) {
    const interest = round(balance * rate);
    const principal = period === months ? balance : Math.min(balance, round(regular - interest));
    const payment = round(principal + interest + monthlyFee);
    balance = round(balance - principal);
    schedule.push({ period, payment, principal, interest, balance });
  }
  const totalInstallments = round(schedule.reduce((sum, row) => sum + row.payment, 0));
  return { currency: "HNL", financed, downPayment, monthlyPaymentEstimate: round(regular + monthlyFee),
    totalInterest: round(schedule.reduce((sum, row) => sum + row.interest, 0)),
    totalFees: round(monthlyFee * months), totalPayable: round(downPayment + totalInstallments), schedule };
}
