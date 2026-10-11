import { requireStaffPermission } from "./auth";
import { simulateCredit, compareOffers, type CreditOffer } from "./credit-finance";

/**
 * M15 admin-only indicative financial simulation. No originations, loans, checkout mutation.
 * No public access; enforce an existing StaffUser permission at the API boundary.
 */
const RATE_LIMIT=new Map<string,{start:number,count:number}>();
const LIMIT=60;
function restricted(req:Request){
 const key=req.headers.get("cookie")?.slice(0,180)||"anonymous";
 const now=Date.now(),item=RATE_LIMIT.get(key);
 if(RATE_LIMIT.size>10000)RATE_LIMIT.clear();
 if(!item||now-item.start>60000){RATE_LIMIT.set(key,{start:now,count:1});return false;}
 item.count++;return item.count>LIMIT;
}
const allowed=new Set(["GET","POST"]);
function parseIntBound(v:unknown,min:number,max:number):number|null{
 return typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:null;
}
function parseOffer(o:any,purchase:number):CreditOffer|null{
 if(!o||typeof o!=="object"||Array.isArray(o))return null;
 const months=parseIntBound(o.months,1,120);
 const bps=parseIntBound(o.annualNominalBps,0,100000);
 const down=parseIntBound(o.downPaymentMinor,0,purchase);
 const setup=parseIntBound(o.setupFeeMinor,0,100000000);
 const recurring=parseIntBound(o.recurringFeeMinor,0,100000000);
 const insurance=parseIntBound(o.insurancePerMonthMinor,0,100000000);
 if([months,bps,down,setup,recurring,insurance].some(v=>v===null))return null;
 return {
  providerCode:String(o.providerCode||"SIMULATED").slice(0,30),
  providerName:String(o.providerName||"Escenario hipotético").slice(0,100),
  months:months!,annualNominalBps:bps!,downPaymentMinor:down!,
  setupFeeMinor:setup!,recurringFeeMinor:recurring!,insurancePerMonthMinor:insurance!,
  verifiedAt:null,validUntil:null,sourceUrl:null,indicative:true
 };
}
function response(body:any,status=200){return Response.json(body,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}})}
export async function handleCredit(req:Request,url:URL,db:any):Promise<Response|null>{
 if(!url.pathname.startsWith("/v1/internal/credit/"))return null;
 if(!allowed.has(req.method))return response({error:"method_not_allowed"},405);
 const auth=await requireStaffPermission(req,db,"reports.read",{requireCsrf:req.method==="POST"});
 if(!auth.ok)return auth.response;
 if(restricted(req))return response({error:"rate_limited"},429);
 if(url.pathname==="/v1/internal/credit/capabilities"&&req.method==="GET")
  return response({enabled:true,mode:"INDICATIVE_ONLY",currency:"HNL",lendingEnabled:false,providerIntegrationsEnabled:false,termsVerified:false});
 if(url.pathname==="/v1/internal/credit/simulate"&&req.method==="POST"){
  if(Number(req.headers.get("content-length")||0)>8192)return response({error:"payload_too_large"},413);
  let body:any;
  try{const text=await req.text();if(text.length>8192)return response({error:"payload_too_large"},413);body=JSON.parse(text);}
  catch{return response({error:"invalid_json"},400);}
  const purchase=parseIntBound(body?.purchaseMinor,1,1000000000);
  if(purchase===null)return response({error:"invalid_purchase"},400);
  if(!Array.isArray(body.offers)||body.offers.length===0||body.offers.length>5)return response({error:"invalid_offers"},400);
  const offers=body.offers.map((o:any)=>parseOffer(o,purchase));
  if(offers.some((o:any)=>o===null))return response({error:"invalid_offer"},400);
  try{
   const comparison=compareOffers(purchase,offers as CreditOffer[]);
   return response({mode:"INDICATIVE_ONLY",currency:"HNL",purchaseMinor:purchase,comparison,disclaimer:"Escenarios hipotéticos; no son cotizaciones ni aprobaciones de prestamistas."});
  }catch{return response({error:"invalid_simulation"},400);}
 }
 return response({error:"not_found"},404);
}
