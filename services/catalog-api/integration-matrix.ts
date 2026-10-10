import { authorizeInternal, auditActor, writeAuditEvent } from "./auth";
type DB=any;
const componentIds=new Set(["catalog","inventory","orders","payments","fiscal","reconciliation","logistics","notifications","credit","loyalty","outfits"]);
const statuses=new Set(["pending","implemented","verified","blocked"]);
const fields=["api","webhooks","authentication","inventorySync","fiscalCompliance","production"] as const;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
export async function ensureIntegrationMatrixSchema(db:DB){
  await db`CREATE TABLE IF NOT EXISTS integration_matrix_evaluations (
    component_id TEXT PRIMARY KEY,
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_url TEXT,
    note TEXT,
    updated_by BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0)
  )`;
  await db`CREATE TABLE IF NOT EXISTS integration_matrix_history (
    id BIGSERIAL PRIMARY KEY,
    component_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    checks JSONB NOT NULL,
    evidence_url TEXT,
    note TEXT,
    actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
export async function handleIntegrationMatrix(req:Request,url:URL,db:DB){
  if(url.pathname!=="/v1/internal/integration-matrix")return null;
  if(req.method!=="GET"&&req.method!=="PATCH")return json({error:"method_not_allowed"},405);
  const auth=await authorizeInternal(req,db,req.method==="GET"?"suppliers.read":"suppliers.write");
  if(!auth.ok)return auth.response;
  if(req.method==="GET"){
    const rows=await db`SELECT component_id,checks,evidence_url,note,updated_at,revision FROM integration_matrix_evaluations ORDER BY component_id`;
    return json({data:rows});
  }
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_body"},400);
  const id=body.componentId;
  if(typeof id!=="string"||!componentIds.has(id))return json({error:"invalid_component"},400);
  const checks=body.checks;
  if(!checks||typeof checks!=="object"||Array.isArray(checks)||Object.keys(checks).length!==fields.length||fields.some(k=>!statuses.has(checks[k])))return json({error:"invalid_checks"},400);
  const evidence=body.evidenceUrl;
  if(evidence!==undefined&&evidence!==null&&(typeof evidence!=="string"||evidence.length>1000||!/^https:\/\//.test(evidence)))return json({error:"invalid_evidence_url"},400);
  const note=body.note;
  if(note!==undefined&&note!==null&&(typeof note!=="string"||note.length>2000))return json({error:"invalid_note"},400);
  if(fields.some(k=>checks[k]==="verified")&&!evidence)return json({error:"verified_requires_evidence"},400);
  if(id==="fiscal"&&(checks.fiscalCompliance!=="blocked"||checks.production!=="blocked"))return json({error:"fiscal_requires_separate_authorization"},409);
  const actor=auth.actor;
  if(actor.type!=="USER")return json({error:"staff_user_required"},403);
  const result=await db.begin(async(tx:DB)=>{
    const existing=await tx`SELECT revision FROM integration_matrix_evaluations WHERE component_id=${id} FOR UPDATE`;
    const expected=body.expectedRevision;
    if(existing.length&&(!Number.isSafeInteger(expected)||expected!==existing[0].revision))return {conflict:true};
    if(!existing.length&&expected!==0)return {conflict:true};
    const revision=existing.length?existing[0].revision+1:1;
    await tx`INSERT INTO integration_matrix_evaluations(component_id,checks,evidence_url,note,updated_by,revision)
      VALUES(${id},${JSON.stringify(checks)}::jsonb,${evidence??null},${note??null},${actor.userId},${revision})
      ON CONFLICT(component_id) DO UPDATE SET checks=EXCLUDED.checks,evidence_url=EXCLUDED.evidence_url,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,revision=EXCLUDED.revision,updated_at=NOW()`;
    await tx`INSERT INTO integration_matrix_history(component_id,revision,checks,evidence_url,note,actor_user_id)
      VALUES(${id},${revision},${JSON.stringify(checks)}::jsonb,${evidence??null},${note??null},${actor.userId})`;
    await writeAuditEvent(tx,{...auditActor(actor),action:"integration_matrix.updated",resourceType:"IntegrationMatrix",resourceId:id,outcome:"SUCCESS",metadata:{revision}});
    return {revision};
  });
  return "conflict" in result?json({error:"revision_conflict"},409):json({ok:true,...result});
}
