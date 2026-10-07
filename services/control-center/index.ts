import { SQL } from "bun";

let db: SQL | null = null;
let schemaReady = false;
const attempts = new Map<string,{count:number,reset:number}>();
const enc = new TextEncoder();
const statuses = new Set(["new","reviewing","contacted","qualified","converted","closed","rejected"]);
const labels: Record<string,string> = {
  new:"Nueva", reviewing:"En revisión", contacted:"Contactada", qualified:"Calificada",
  converted:"Convertida", closed:"Cerrada", rejected:"No procede",
  supplier:"Proveedor", product_request:"Solicitud de producto", support:"Soporte",
  partnership:"Alianza", notify:"Disponibilidad"
};

function getDb() {
  if (db) return db;
  db = new SQL({
    hostname: Bun.env.PGHOST!,
    port: Number(Bun.env.PGPORT || 5432),
    username: Bun.env.PGUSER!,
    password: Bun.env.PGPASSWORD!,
    database: Bun.env.PGDATABASE!,
    tls: false,
    max: 4
  });
  return db;
}

async function ensureSchema() {
  if (schemaReady) return;
  const sql = getDb();
  await sql`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS assigned_to TEXT`;
  await sql`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS internal_notes TEXT`;
  await sql`ALTER TABLE public_inquiries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`
    CREATE TABLE IF NOT EXISTS inquiry_history (
      id BIGSERIAL PRIMARY KEY,
      inquiry_id BIGINT NOT NULL REFERENCES public_inquiries(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_inquiry_history_inquiry_created ON inquiry_history(inquiry_id, created_at DESC)`;
  schemaReady = true;
}

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as any)[c]);
}

function securityHeaders(extra: Record<string,string> = {}) {
  return {
    "x-content-type-options":"nosniff",
    "x-frame-options":"DENY",
    "referrer-policy":"no-referrer",
    "permissions-policy":"camera=(), microphone=(), geolocation=()",
    "content-security-policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...extra
  };
}

function html(body:string, status=200, headers:Record<string,string>={}) {
  return new Response(body,{status,headers:securityHeaders({"content-type":"text/html; charset=utf-8","cache-control":"no-store",...headers})});
}
function json(body:unknown,status=200){return Response.json(body,{status,headers:securityHeaders({"cache-control":"no-store"})});}
function redirect(path:string, cookie?:string){const h:Record<string,string>={location:path}; if(cookie)h["set-cookie"]=cookie; return new Response(null,{status:303,headers:securityHeaders(h)});}

function b64url(data: Uint8Array|string) {
  return Buffer.from(typeof data === "string" ? enc.encode(data) : data).toString("base64url");
}
async function hmacKey() {
  const secret = Bun.env.CONTROL_CENTER_SESSION_SECRET || "";
  return crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function signPayload(payload:string) {
  const sig = await crypto.subtle.sign("HMAC",await hmacKey(),enc.encode(payload));
  return Buffer.from(sig).toString("base64url");
}
async function makeSession() {
  const payload = b64url(JSON.stringify({
    exp:Date.now()+8*60*60*1000,
    csrf:crypto.randomUUID(),
    actor:Bun.env.CONTROL_CENTER_OPERATOR || "operator"
  }));
  return payload+"."+await signPayload(payload);
}
async function readSession(req:Request) {
  const raw=(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("mrcc="))?.slice(5);
  if(!raw)return null;
  const [payload,sig]=raw.split(".");
  if(!payload||!sig)return null;
  try{
    const ok=await crypto.subtle.verify("HMAC",await hmacKey(),Buffer.from(sig,"base64url"),enc.encode(payload));
    if(!ok)return null;
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!data.exp||Date.now()>data.exp)return null;
    return data;
  }catch{return null}
}
function sessionCookie(token:string){return `mrcc=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;}
function clearCookie(){return "mrcc=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";}

async function safePasswordEqual(a:string,b:string){
  const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(a)),crypto.subtle.digest("SHA-256",enc.encode(b))]);
  const xa=new Uint8Array(x),ya=new Uint8Array(y); let d=0; for(let i=0;i<xa.length;i++)d|=xa[i]^ya[i]; return d===0;
}
function clientKey(req:Request){return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";}
function loginAllowed(req:Request){const k=clientKey(req),now=Date.now(),v=attempts.get(k);if(!v||v.reset<now){attempts.set(k,{count:0,reset:now+15*60*1000});return true}return v.count<5;}
function recordFailure(req:Request){const k=clientKey(req),now=Date.now(),v=attempts.get(k)||{count:0,reset:now+15*60*1000};v.count++;attempts.set(k,v);}
function resetFailures(req:Request){attempts.delete(clientKey(req));}

const css=`
:root{--ink:#171513;--cream:#f4efe7;--gold:#b7923b;--line:#ded5c8;--muted:#6c645a}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:Inter,system-ui,sans-serif}
header{background:#111;color:white;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:3}
header b{font:400 22px Georgia,serif;color:#e7cf89}.wrap{max-width:1280px;margin:auto;padding:30px 20px 60px}
h1,h2,h3{font-family:Georgia,serif;font-weight:400}.eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:900;color:#947127}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric,.panel{background:white;border:1px solid var(--line);border-radius:18px;padding:18px}
.metric span{display:block;color:var(--muted);font-size:12px}.metric b{display:block;font:400 28px Georgia,serif;margin-top:8px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}.toolbar input,.toolbar select,input,select,textarea{border:1px solid #d8cfc2;border-radius:11px;padding:10px 11px;background:white;color:var(--ink)}
.toolbar input{min-width:240px}.queue{display:grid;gap:10px}.item{background:white;border:1px solid var(--line);border-radius:18px;padding:18px}
.item-head{display:flex;justify-content:space-between;gap:18px}.pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:#f1eadf;font-size:11px;font-weight:800}.pill.high{background:#fff0e7;color:#8f3d1c}
.meta{font-size:12px;color:var(--muted);line-height:1.6}.message{padding:12px 0;line-height:1.6}.actions{display:grid;grid-template-columns:1fr 90px 1fr 1.4fr auto;gap:8px;align-items:end;border-top:1px solid #eee5d9;padding-top:14px;margin-top:10px}
label{display:grid;gap:5px;font-size:11px;font-weight:800}textarea{min-height:70px;resize:vertical}
button{border:0;border-radius:999px;padding:11px 14px;font-weight:900;cursor:pointer;background:#171513;color:white}.ghost{background:#eee6db;color:#171513}
.login{max-width:430px;margin:10vh auto;background:white;border:1px solid var(--line);border-radius:24px;padding:28px}.login input{width:100%;margin:10px 0 16px}.login button{width:100%}
.notice{padding:12px 14px;border-radius:12px;background:#fff6dc;margin:12px 0;color:#725817}.empty{text-align:center;padding:45px;color:var(--muted)}
@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}.actions{grid-template-columns:1fr 1fr}.actions label:nth-child(4){grid-column:1/-1}.item-head{flex-direction:column}}
@media(max-width:600px){.grid{grid-template-columns:1fr}.toolbar{display:grid}.toolbar input{min-width:0;width:100%}}
`;

function shell(content:string, session:any){
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MR עדולם Control Center</title><style>${css}</style></head><body><header><b>MR עדולם · Control Center</b><form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(session.csrf)}"><button class="ghost">Salir</button></form></header><main class="wrap">${content}</main></body></html>`;
}
function loginPage(message=""){
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso · MR עדולם</title><style>${css}</style></head><body><main class="login"><div class="eyebrow">Acceso privado</div><h1>MR עדולם Control Center</h1><p class="meta">Operación interna. El acceso requiere credenciales del equipo.</p>${message?`<div class="notice">${esc(message)}</div>`:""}<form method="post" action="/login"><label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label><button>Entrar</button></form></main></body></html>`;
}
function setupPage(){return loginPage("El acceso aún no ha sido habilitado. Configure CONTROL_CENTER_PASSWORD en Railway antes de abrir este panel al equipo.");}

async function dashboard(url:URL, session:any){
  await ensureSchema(); const sql=getDb();
  const status=(url.searchParams.get("status")||"").slice(0,32),kind=(url.searchParams.get("kind")||"").slice(0,32),q=(url.searchParams.get("q")||"").slice(0,120);
  const summary=await sql`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE status='new')::int new_count, COUNT(*) FILTER(WHERE kind='product_request')::int product_requests, COUNT(*) FILTER(WHERE kind='supplier')::int suppliers, COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '24 hours')::int last_24h FROM public_inquiries`;
  const events=await sql`SELECT event_name,COUNT(*)::int count FROM public_events WHERE created_at>=NOW()-INTERVAL '7 days' GROUP BY event_name`;
  const rows=await sql`
    SELECT i.id,i.kind,i.name,i.contact,i.country_code,i.product_id,i.message,i.metadata,i.status,i.priority,i.assigned_to,i.internal_notes,i.created_at,i.updated_at,p.name product_name
    FROM public_inquiries i LEFT JOIN products p ON p.id=i.product_id
    WHERE (${status||null}::text IS NULL OR i.status=${status||null}::text)
      AND (${kind||null}::text IS NULL OR i.kind=${kind||null}::text)
      AND (${q||null}::text IS NULL OR i.name ILIKE '%'||${q||null}::text||'%' OR i.contact ILIKE '%'||${q||null}::text||'%' OR COALESCE(i.message,'') ILIKE '%'||${q||null}::text||'%')
    ORDER BY i.priority DESC,i.created_at DESC LIMIT 100`;
  const ev=Object.fromEntries(events.map((x:any)=>[x.event_name,x.count])); const s=summary[0];
  const metrics=`
    <div class="grid">
      <div class="metric"><span>Nuevas</span><b>${s.new_count}</b></div>
      <div class="metric"><span>Solicitudes producto</span><b>${s.product_requests}</b></div>
      <div class="metric"><span>Proveedores</span><b>${s.suppliers}</b></div>
      <div class="metric"><span>Últimas 24 h</span><b>${s.last_24h}</b></div>
    </div>
    <div class="panel" style="margin-top:12px"><div class="eyebrow">Embudo · 7 días</div><p class="meta">Vistas ${ev.page_view||0} · CTA ${ev.cta_click||0} · Intenciones ${ev.intent_submit||0} · Carrito ${ev.add_to_cart||0} · Checkout ${ev.checkout_start||0}</p></div>`;
  const opts=(set:string[],value:string)=>set.map(x=>`<option value="${x}" ${x===value?"selected":""}>${esc(labels[x]||x)}</option>`).join("");
  const items=rows.length?rows.map((r:any)=>`
    <article class="item">
      <div class="item-head"><div><span class="pill ${r.priority>=2?"high":""}">${esc(labels[r.kind]||r.kind)}</span><h3>#${r.id} · ${esc(r.name)}</h3><div class="meta">${esc(r.contact)} · ${esc(r.country_code||"Sin país")} · ${new Date(r.created_at).toLocaleString("es-HN")}${r.product_name?" · "+esc(r.product_name):""}</div></div><span class="pill">${esc(labels[r.status]||r.status)}</span></div>
      <div class="message">${esc(r.message||"Sin mensaje")}</div>
      <details><summary class="meta">Datos estructurados</summary><pre class="meta">${esc(JSON.stringify(r.metadata||{},null,2))}</pre></details>
      <form class="actions" method="post" action="/inquiries/${r.id}/update">
        <input type="hidden" name="csrf" value="${esc(session.csrf)}">
        <label>Estado<select name="status">${opts([...statuses],r.status)}</select></label>
        <label>Prioridad<select name="priority">${[0,1,2,3].map(x=>`<option value="${x}" ${x===r.priority?"selected":""}>${x}</option>`).join("")}</select></label>
        <label>Asignado a<input name="assigned_to" maxlength="120" value="${esc(r.assigned_to||"")}"></label>
        <label>Notas internas<textarea name="internal_notes" maxlength="4000">${esc(r.internal_notes||"")}</textarea></label>
        <button>Guardar</button>
      </form>
    </article>`).join(""):`<div class="panel empty">No hay intenciones con estos filtros.</div>`;
  return shell(`
    <div class="eyebrow">Bandeja de Intenciones</div><h1>Señales del mercado convertidas en trabajo.</h1><p class="meta">Clientes, proveedores, reposición, soporte y alianzas en una cola operativa.</p>
    ${metrics}
    <form class="toolbar" method="get"><input type="search" name="q" value="${esc(q)}" placeholder="Buscar nombre, contacto o mensaje"><select name="kind"><option value="">Todos los tipos</option>${["product_request","notify","supplier","partnership","support"].map(x=>`<option value="${x}" ${x===kind?"selected":""}>${esc(labels[x])}</option>`).join("")}</select><select name="status"><option value="">Todos los estados</option>${opts([...statuses],status)}</select><button>Filtrar</button></form>
    <section class="queue">${items}</section>`,session);
}

Bun.serve({
  port:Number(Bun.env.PORT||3000),
  async fetch(req){
    const url=new URL(req.url), configured=Boolean(Bun.env.CONTROL_CENTER_PASSWORD&&Bun.env.CONTROL_CENTER_SESSION_SECRET&&Bun.env.PGHOST);
    if(url.pathname==="/health")return json({ok:true,service:"MR עדולם Control Center",configured});
    if(url.pathname==="/ready"){
      if(!configured)return json({ok:false,reason:"setup_required"},503);
      try{await ensureSchema();await getDb()`SELECT 1`;return json({ok:true,database:"connected"});}catch{return json({ok:false,database:"unavailable"},503)}
    }
    if(!configured)return html(setupPage(),503);
    if(url.pathname==="/login"&&req.method==="GET")return html(loginPage());
    if(url.pathname==="/login"&&req.method==="POST"){
      if(!loginAllowed(req))return html(loginPage("Demasiados intentos. Intenta más tarde."),429);
      const fd=await req.formData(),pass=String(fd.get("password")||"");
      if(!await safePasswordEqual(pass,Bun.env.CONTROL_CENTER_PASSWORD||"")){recordFailure(req);return html(loginPage("Credenciales incorrectas."),401)}
      resetFailures(req);return redirect("/",sessionCookie(await makeSession()));
    }
    const session=await readSession(req);
    if(!session)return html(loginPage("Inicia sesión para continuar."),401);
    if(url.pathname==="/logout"&&req.method==="POST"){const fd=await req.formData();if(String(fd.get("csrf")||"")!==session.csrf)return html("Solicitud inválida",403);return redirect("/login",clearCookie())}
    if(url.pathname==="/"&&req.method==="GET")return html(await dashboard(url,session));
    const m=url.pathname.match(/^\/inquiries\/(\d+)\/update$/);
    if(m&&req.method==="POST"){
      const fd=await req.formData();if(String(fd.get("csrf")||"")!==session.csrf)return html("Solicitud inválida",403);
      const status=String(fd.get("status")||"").slice(0,32);if(!statuses.has(status))return html("Estado inválido",400);
      const priority=Math.min(3,Math.max(0,Number(fd.get("priority")||0)||0)),assigned=String(fd.get("assigned_to")||"").trim().slice(0,120),notes=String(fd.get("internal_notes")||"").trim().slice(0,4000);
      await ensureSchema();const sql=getDb();const before=await sql`SELECT status FROM public_inquiries WHERE id=${Number(m[1])} LIMIT 1`;if(!before.length)return html("Solicitud no encontrada",404);
      await sql`UPDATE public_inquiries SET status=${status},priority=${priority},assigned_to=${assigned||null},internal_notes=${notes||null},updated_at=NOW() WHERE id=${Number(m[1])}`;
      await sql`INSERT INTO inquiry_history(inquiry_id,actor,action,from_status,to_status,note) VALUES(${Number(m[1])},${session.actor},"update",${before[0].status},${status},${notes||null})`;
      return redirect("/");
    }
    return html("No encontrado",404);
  }
});