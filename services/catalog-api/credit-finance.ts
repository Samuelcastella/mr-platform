/**
 * M15 indicative financing comparator. No lender approval or disbursement is implied.
 * All monetary values are integer minor units (centavos), rates in basis points.
 */
export type CreditOffer = {
  providerCode:string; providerName:string; months:number;
  annualNominalBps:number; downPaymentMinor:number;
  setupFeeMinor:number; recurringFeeMinor:number;
  insurancePerMonthMinor:number;
  verifiedAt:string|null; validUntil:string|null; sourceUrl:string|null;
  indicative:boolean;
};
export type PaymentRow = { installment:number; paymentMinor:number; principalMinor:number; interestMinor:number; feesMinor:number; balanceMinor:number };
export type Simulation = { financedMinor:number; downPaymentMinor:number; regularPaymentMinor:number; totalInterestMinor:number; totalFeesMinor:number; totalOutlayMinor:number; effectiveAnnualRatePercent:number|null; rows:PaymentRow[]; indicative:true };

function int(n:unknown,label:string,min=0,max=1_000_000_000):number{
  if(typeof n!=="number" || !Number.isSafeInteger(n)||n<min||n>max)throw new Error("invalid_"+label);
  return n;
}
export function simulateCredit(purchaseMinor:number, offer:CreditOffer):Simulation {
  int(purchaseMinor,"purchase",1);
  const months=int(offer.months,"months",1,120);
  const down=int(offer.downPaymentMinor,"down_payment",0,purchaseMinor);
  const bps=int(offer.annualNominalBps,"rate",0,100_000);
  const setup=int(offer.setupFeeMinor,"setup_fee");
  const recurring=int(offer.recurringFeeMinor,"recurring_fee");
  const insurance=int(offer.insurancePerMonthMinor,"insurance");
  const financed=purchaseMinor-down;
  const rate=bps/120_000;
  const annuity=financed===0?0:rate===0?financed/months:financed*rate/(1-Math.pow(1+rate,-months));
  let balance=financed, interestTotal=0, feesTotal=setup;
  const rows:PaymentRow[]=[];
  for(let i=1;i<=months;i++){
    const interest=Math.round(balance*rate);
    const principal=i===months?balance:Math.min(balance,Math.max(0,Math.round(annuity)-interest));
    balance-=principal;
    const fee=recurring+insurance+(i===1?setup:0);
    rows.push({installment:i,principalMinor:principal,interestMinor:interest,feesMinor:fee,paymentMinor:principal+interest+fee,balanceMinor:balance});
    interestTotal+=interest;
    feesTotal+=recurring+insurance;
  }
  const outlay=down+rows.reduce((s,r)=>s+r.paymentMinor,0);
  // Equivalent annualized IRR including initial down payment and fees.
  const cashFlows=[financed,...rows.map(r=>-r.paymentMinor)];
  let effectiveAnnualRatePercent:number|null=null;
  if(financed>0){
    let lo=0,hi=1;
    const npv=(r:number)=>cashFlows.reduce((s,c,i)=>s+c/Math.pow(1+r,i),0);
    while(npv(hi)>0&&hi<1e6)hi*=2;
    for(let k=0;k<120;k++){const mid=(lo+hi)/2;if(npv(mid)>0)lo=mid;else hi=mid;}
    effectiveAnnualRatePercent=(Math.pow(1+(lo+hi)/2,12)-1)*100;
  }
  return {financedMinor:financed,downPaymentMinor:down,regularPaymentMinor:Math.round(annuity)+recurring+insurance,totalInterestMinor:interestTotal,totalFeesMinor:feesTotal,totalOutlayMinor:outlay,effectiveAnnualRatePercent,rows,indicative:true};
}
export function compareOffers(purchaseMinor:number,offers:CreditOffer[],today=new Date()):Array<{offer:CreditOffer;simulation:Simulation;termsCurrent:boolean}>{
  return offers.map(offer=>({
    offer,simulation:simulateCredit(purchaseMinor,offer),
    termsCurrent:!!offer.verifiedAt&&!!offer.validUntil&&Date.parse(offer.validUntil)>=today.getTime()
  })).sort((a,b)=>a.simulation.totalOutlayMinor-b.simulation.totalOutlayMinor);
}
