// bootstrap-ui-v2
const API_BASE = (Bun.env.CATALOG_API_URL || "").replace(/\/+$/, "");
const SESSION_COOKIE = "mrstaff";
const CSRF_COOKIE = "mrcc_csrf";
const VENDOR_COOKIE = "mrvendor";
const VENDOR_CSRF_COOKIE = "mrvc_csrf";
const statuses = new Set(["new","reviewing","contacted","qualified","converted","closed","rejected"]);

const labels: Record<string,string> = {
  new:"Nueva", reviewing:"En revisión", contacted:"Contactada", qualified:"Calificada",
  converted:"Convertida", closed:"Cerrada", rejected:"No procede",
  supplier:"Proveedor", product_request:"Solicitud de producto", support:"Soporte",
  partnership:"Alianza", notify:"Disponibilidad"
};

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as any)[c]
  );
}

function securityHeaders(extra: Record<string,string> = {}) {
  return {
    "x-content-type-options":"nosniff",
    "x-frame-options":"DENY",
    "referrer-policy":"no-referrer",
    "permissions-policy":"camera=(), microphone=(), geolocation=()",
    "content-security-policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...extra
  };
}

function html(body:string, status=200, headers:Record<string,string>={}) {
  return new Response(body,{
    status,
    headers:securityHeaders({
      "content-type":"text/html; charset=utf-8",
      "cache-control":"no-store",
      ...headers
    })
  });
}

function json(body:unknown,status=200){
  return Response.json(body,{
    status,
    headers:securityHeaders({"cache-control":"no-store"})
  });
}

function redirect(path:string,cookies:string[]=[]){
  const headers=new Headers(securityHeaders({location:path}));
  for(const cookie of cookies) headers.append("set-cookie",cookie);
  return new Response(null,{status:303,headers});
}

function cookie(req:Request,name:string){
  const header=req.headers.get("cookie")||"";
  for(const item of header.split(";")){
    const [key,...rest]=item.trim().split("=");
    if(key===name)return rest.join("=");
  }
  return "";
}

function sessionCookieHeader(req:Request){
  const token=cookie(req,SESSION_COOKIE);
  return token ? `${SESSION_COOKIE}=${token}` : "";
}

function csrfCookie(value:string,maxAge=28800){
  return `${CSRF_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function vendorCsrfCookie(value:string,maxAge=28800){
  return `${VENDOR_CSRF_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function vendorSessionCookieHeader(req:Request){
  const token=cookie(req,VENDOR_COOKIE);
  return token ? `${VENDOR_COOKIE}=${token}` : "";
}

function clearCookie(name:string){
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function safeEqual(a:string,b:string){
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

async function api(
  path:string,
  options:{
    method?:string;
    cookieHeader?:string;
    csrf?:string;
    idempotencyKey?:string;
    body?:unknown;
  }={}
){
  if(!API_BASE) return {response:null,body:{error:"api_not_configured"} as any};
  const headers:Record<string,string>={"accept":"application/json"};
  if(options.cookieHeader)headers.cookie=options.cookieHeader;
  if(options.csrf)headers["x-csrf-token"]=options.csrf;
  if(options.idempotencyKey)headers["idempotency-key"]=options.idempotencyKey;
  if(options.body!==undefined)headers["content-type"]="application/json";

  try{
    const response=await fetch(API_BASE+path,{
      method:options.method||"GET",
      headers,
      body:options.body===undefined?undefined:JSON.stringify(options.body),
      redirect:"manual"
    });
    const body=await response.json().catch(()=>({}));
    return {response,body};
  }catch{
    return {response:null,body:{error:"api_unavailable"} as any};
  }
}

type Session = {
  csrf:string;
  actor:string;
  user:any;
  cookieHeader:string;
};

async function readSession(req:Request):Promise<Session|null>{
  const cookieHeader=sessionCookieHeader(req);
  const csrf=cookie(req,CSRF_COOKIE);
  if(!cookieHeader||!csrf)return null;

  const result=await api("/v1/auth/me",{cookieHeader});
  if(!result.response?.ok||!result.body?.user)return null;

  return {
    csrf,
    actor:String(result.body.user.displayName||result.body.user.email||"staff"),
    user:result.body.user,
    cookieHeader
  };
}

function requireFormCsrf(fd:FormData,session:Session){
  const supplied=String(fd.get("csrf")||"");
  return Boolean(supplied)&&safeEqual(supplied,session.csrf);
}

type VendorSession = {
  csrf:string;
  cookieHeader:string;
  user:any;
};

async function readVendorSession(req:Request):Promise<VendorSession|null>{
  const cookieHeader=vendorSessionCookieHeader(req);
  const csrf=cookie(req,VENDOR_CSRF_COOKIE);
  if(!cookieHeader||!csrf)return null;

  const result=await api("/v1/vendor/auth/me",{cookieHeader});
  if(!result.response?.ok||!result.body?.user)return null;

  return {csrf,cookieHeader,user:result.body.user};
}

function requireVendorCsrf(fd:FormData,session:VendorSession){
  const supplied=String(fd.get("csrf")||"");
  return Boolean(supplied)&&safeEqual(supplied,session.csrf);
}

const css=`
:root{--ink:#171513;--cream:#f4efe7;--gold:#b7923b;--line:#ded5c8;--muted:#6c645a}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:Inter,system-ui,sans-serif}
header{background:#111;color:white;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;gap:16px;position:sticky;top:0;z-index:3}
header b{font:400 22px Georgia,serif;color:#e7cf89}.user{font-size:12px;color:#cfc5b8;margin-left:auto}
.wrap{max-width:1280px;margin:auto;padding:30px 20px 60px}
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
.intel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}.intel-card{background:#171513;color:white;border-radius:18px;padding:18px}.intel-card h3{margin:7px 0 12px;color:#efd98b}.intel-card ol{margin:0;padding-left:20px}.intel-card li{padding:6px 0;color:#ddd3c4}.score{display:inline-flex;padding:4px 8px;border-radius:999px;background:#d4af3722;color:#efd98b;font-size:11px;font-weight:900;margin-left:6px}.suggest{font-size:12px;color:#705b27;background:#fbf3dd;border-radius:10px;padding:8px 10px;margin-top:10px}
@media(max-width:900px){.intel-grid{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.actions{grid-template-columns:1fr 1fr}.actions label:nth-child(4){grid-column:1/-1}.item-head{flex-direction:column}}
@media(max-width:600px){.grid{grid-template-columns:1fr}.toolbar{display:grid}.toolbar input{min-width:0;width:100%}.user{display:none}}
`;

function shell(content:string,session:Session){
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MR עדולם Control Center</title><style>${css}</style></head><body><header><b>MR עדולם · Control Center</b><nav style="display:flex;gap:10px;flex-wrap:wrap"><a href="/" style="color:#e7cf89;text-decoration:none;font-weight:800">Operación</a><a href="/catalog" style="color:#e7cf89;text-decoration:none;font-weight:800">Catálogo</a><a href="/orders" style="color:#e7cf89;text-decoration:none;font-weight:800">Pedidos</a><a href="/customers" style="color:#e7cf89;text-decoration:none;font-weight:800">Clientes</a><a href="/suppliers" style="color:#e7cf89;text-decoration:none;font-weight:800">Proveedores</a><a href="/vendor-review" style="color:#e7cf89;text-decoration:none;font-weight:800">Revisión</a><a href="/purchases" style="color:#e7cf89;text-decoration:none;font-weight:800">Compras</a><a href="/fulfillment" style="color:#e7cf89;text-decoration:none;font-weight:800">Entregas</a><a href="/returns" style="color:#e7cf89;text-decoration:none;font-weight:800">Devoluciones</a><a href="/inventory-adjustments" style="color:#e7cf89;text-decoration:none;font-weight:800">Ajustes</a><a href="/health-desk" style="color:#e7cf89;text-decoration:none;font-weight:800">Health Desk</a></nav><span class="user">${esc(session.actor)}</span><form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(session.csrf)}"><button class="ghost">Salir</button></form></header><main class="wrap">${content}</main></body></html>`;
}

function loginPage(message=""){
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso · MR עדולם</title><style>${css}</style></head><body><main class="login"><div class="eyebrow">Acceso privado</div><h1>MR עדולם Control Center</h1><p class="meta">Usa tu identidad individual de StaffUser. Las acciones quedan vinculadas a tu usuario y permisos.</p>${message?`<div class="notice">${esc(message)}</div>`:""}<form method="post" action="/login"><label>Correo<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Contraseña<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button>Entrar</button></form></main></body></html>`;
}

function setupPage(){
  return loginPage("El Control Center requiere CATALOG_API_URL para usar la identidad de StaffUser del Commerce Core.");
}

function vendorLoginPage(message=""){
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portal de proveedor · MR</title><style>'+css+'</style></head><body><main class="login"><div class="eyebrow">Portal de proveedor</div><h1>Tu catálogo en MR</h1><p class="meta">Este acceso es independiente del Control Center administrativo.</p>'+(message?'<div class="notice">'+esc(message)+'</div>':'')+'<form method="post" action="/vendor/login"><label>Correo<input type="email" name="email" required maxlength="254"></label><label>Contraseña<input type="password" name="password" required maxlength="256"></label><button>Entrar</button></form></main></body></html>';
}

function vendorAcceptPage(token:string,invitation:any,message=""){
  const email=String(invitation?.email||"");
  const supplier=String(invitation?.supplierName||"Proveedor");
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activar catálogo · MR</title><style>'+css+'</style></head><body><main class="login"><div class="eyebrow">Invitación de proveedor</div><h1>'+esc(supplier)+'</h1><p class="meta">Crea tu acceso para administrar únicamente el catálogo de tu negocio.</p>'+(message?'<div class="notice">'+esc(message)+'</div>':'')+'<form method="post" action="/vendor/accept"><input type="hidden" name="token" value="'+esc(token)+'"><label>Correo<input type="email" name="email" value="'+esc(email)+'" required maxlength="254"></label><label>Nombre<input name="displayName" required maxlength="120"></label><label>Contraseña<input type="password" name="password" required minlength="12" maxlength="256"></label><label>Confirmar contraseña<input type="password" name="confirmPassword" required minlength="12" maxlength="256"></label><button>Crear acceso</button></form></main></body></html>';
}

async function vendorCatalogPage(url:URL,session:VendorSession){
  const result=await api("/v1/vendor/catalog",{cookieHeader:session.cookieHeader});
  if(!result.response?.ok)return vendorLoginPage("No se pudo cargar tu catálogo.");
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const n=url.searchParams.get("n")||"";
  const msg=n==="created"?"Producto guardado como borrador.":n==="submitted"?"Producto enviado a revisión.":n==="error"?"No se pudo completar la acción.":"";
  const cards=rows.length?rows.map((p:any)=>{
    const variants=Array.isArray(p.variants)?p.variants:[];
    const images=Array.isArray(p.images)?p.images:[];
    const first=variants[0]||{};
    const submit=(p.review_status==="DRAFT"||p.review_status==="REJECTED")
      ?'<form method="post" action="/vendor/products/'+Number(p.id)+'/submit"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button>Enviar a revisión</button></form>'
      :"";
    return '<article class="item"><div class="item-head"><div><div class="eyebrow">'+esc(session.user.supplierName||"Proveedor")+'</div><h3>'+esc(p.name)+'</h3><div class="meta">'+esc(p.category||"Sin categoría")+' · '+esc(p.brand||"Sin marca")+' · SKU '+esc(first.sku||"—")+' · '+esc(first.currency||"HNL")+' '+esc(first.price||"0")+'</div><div class="meta">'+images.length+' imagen(es)</div></div><span class="pill">'+esc(p.review_status||p.status)+'</span></div>'+(p.review_note?'<div class="notice">'+esc(p.review_note)+'</div>':'')+'<div style="margin-top:10px">'+submit+'</div></article>';
  }).join(""):'<div class="panel empty">Todavía no has agregado productos.</div>';

  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mi catálogo · MR</title><style>'+css+'</style></head><body><header><b>MR · Portal de proveedor</b><span class="user">'+esc(session.user.displayName||session.user.email)+'</span><form method="post" action="/vendor/logout"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button class="ghost">Salir</button></form></header><main class="wrap"><div class="eyebrow">Mi catálogo</div><h1>'+esc(session.user.supplierName||"Proveedor")+'</h1>'+(msg?'<div class="notice">'+esc(msg)+'</div>':'')+'<section class="panel" style="margin-bottom:14px"><h3>Agregar producto</h3><p class="meta">Se guarda como borrador. Al enviarlo a revisión, MR decide si se publica.</p><form method="post" action="/vendor/products" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Nombre<input name="name" required maxlength="180"></label><label>Categoría<input name="category" maxlength="120"></label><label>Marca<input name="brand" maxlength="120"></label><label>SKU<input name="sku" required maxlength="100"></label><label>Precio HNL<input name="price" type="number" min="0" step=".01" required></label><label>Costo<input name="cost" type="number" min="0" step=".01"></label><label>Talla<input name="size" maxlength="80"></label><label>Color<input name="color" maxlength="80"></label><label>Stock<input name="stock" type="number" min="0" step="1" value="0"></label><label>Imagen (URL)<input name="imageUrl" type="url" required maxlength="1000" placeholder="https://..."></label><button>Guardar borrador</button></form></section><section class="queue">'+cards+'</section></main></body></html>';
}


function bootstrapPage(message=""){
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crear administrador · MR עדולם</title><style>'+css+'</style></head><body><main class="login"><div class="eyebrow">Configuración inicial</div><h1>Crear primer administrador</h1><p class="meta">Este formulario funciona una sola vez. Tu contraseña se envía directamente al Commerce Core y no se guarda en el Control Center.</p>'+(message?'<div class="notice">'+esc(message)+'</div>':'')+'<form method="post"><label>Correo<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Nombre<input type="text" name="displayName" autocomplete="name" required maxlength="120"></label><label>Contraseña de administrador<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><label>Confirmar contraseña<input type="password" name="confirmPassword" autocomplete="new-password" required minlength="12" maxlength="256"></label><button>Crear administrador</button></form><p class="meta" style="margin-top:16px"><a href="/login">Volver al inicio de sesión</a></p></main></body></html>';
}

function suggestedAction(kind:string){
  return ({
    product_request:"Buscar disponibilidad, comparar proveedores y evaluar incorporación al catálogo.",
    notify:"Revisar reposición y contactar cuando exista stock.",
    supplier:"Evaluar catálogo, precios, MOQ, tiempos y confiabilidad.",
    partnership:"Clasificar propuesta y asignar responsable comercial.",
    support:"Responder, resolver y cerrar con trazabilidad."
  } as Record<string,string>)[kind]||"Revisar y clasificar.";
}

function csvCell(v:unknown){
  const x=String(v??"");
  return /[",\n]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;
}

async function dashboard(url:URL,session:Session){
  const query=new URLSearchParams();
  for(const key of ["status","kind","q"]){
    const value=(url.searchParams.get(key)||"").slice(0,key==="q"?120:32);
    if(value)query.set(key,value);
  }

  const result=await api(
    "/v1/internal/control-center/dashboard"+(query.size?"?"+query.toString():""),
    {cookieHeader:session.cookieHeader}
  );

  if(result.response?.status===403){
    return shell(`<div class="panel empty"><h2>Acceso insuficiente</h2><p>Tu usuario no tiene el permiso <b>inquiries.read</b>.</p></div>`,session);
  }
  if(!result.response?.ok){
    return shell(`<div class="panel empty"><h2>Servicio no disponible</h2><p>No se pudo consultar el Commerce Core.</p></div>`,session);
  }

  const data=result.body||{};
  const rows:any[]=Array.isArray(data.inquiries)?data.inquiries:[];
  const events:any[]=Array.isArray(data.events)?data.events:[];
  const demand:any[]=Array.isArray(data.demand)?data.demand:[];
  const restock:any[]=Array.isArray(data.restock)?data.restock:[];
  const supplierCats:any[]=Array.isArray(data.supplierCategories)?data.supplierCategories:[];
  const historyRows:any[]=Array.isArray(data.history)?data.history:[];
  const opportunities:any[]=Array.isArray(data.opportunities)?data.opportunities:[];
  const s:any=data.summary||{};
  const opp:any=data.opportunitySummary||{};

  const ev=Object.fromEntries(events.map((x:any)=>[x.event_name,Number(x.count)||0]));
  const historyBy=new Map<number,any[]>();
  for(const h of historyRows){
    const id=Number(h.inquiry_id);
    const arr=historyBy.get(id)||[];
    if(arr.length<8){arr.push(h);historyBy.set(id,arr)}
  }

  const list=(items:any[])=>items.length
    ?`<ol>${items.map(x=>`<li><b>${esc(x.item)}</b><span class="score">${esc(x.count)}</span></li>`).join("")}</ol>`
    :`<p class="meta">Aún sin señales suficientes.</p>`;

  const ctaRate=(ev.cta_click||0)?Math.round((ev.intent_submit||0)/(ev.cta_click||1)*100):0;
  const checkoutRate=(ev.add_to_cart||0)?Math.round((ev.checkout_start||0)/(ev.add_to_cart||1)*100):0;

  const intelligence=`<div class="intel-grid"><section class="intel-card"><div class="eyebrow" style="color:#d8b96d">Demanda no cubierta</div><h3>Productos solicitados</h3>${list(demand)}</section><section class="intel-card"><div class="eyebrow" style="color:#d8b96d">Reposición</div><h3>Interés por disponibilidad</h3>${list(restock)}</section><section class="intel-card"><div class="eyebrow" style="color:#d8b96d">Sourcing</div><h3>Oferta de proveedores</h3>${list(supplierCats)}</section></div><div class="panel" style="margin-top:12px"><div class="eyebrow">Conversión de intención</div><p class="meta">CTA → solicitud: <b>${ctaRate}%</b> · Carrito → checkout: <b>${checkoutRate}%</b>.</p></div>`;

  const metrics=`
    <div class="grid">
      <div class="metric"><span>Nuevas</span><b>${Number(s.new_count)||0}</b></div>
      <div class="metric"><span>Solicitudes producto</span><b>${Number(s.product_requests)||0}</b></div>
      <div class="metric"><span>Proveedores</span><b>${Number(s.suppliers)||0}</b></div>
      <div class="metric"><span>Últimas 24 h</span><b>${Number(s.last_24h)||0}</b></div>
      <div class="metric"><span>Sin asignar</span><b>${Number(s.unassigned)||0}</b></div>
      <div class="metric"><span>Nuevas &gt;24h</span><b>${Number(s.overdue_new)||0}</b></div>
      <div class="metric"><span>Oportunidades abiertas</span><b>${Number(opp.open_count)||0}</b></div>
    </div>
    <div class="panel" style="margin-top:12px"><div class="eyebrow">Embudo · 7 días</div><p class="meta">Vistas ${ev.page_view||0} · CTA ${ev.cta_click||0} · Intenciones ${ev.intent_submit||0} · Carrito ${ev.add_to_cart||0} · Checkout ${ev.checkout_start||0}</p></div>`;

  const opts=(set:string[],value:string)=>set
    .map(x=>`<option value="${x}" ${x===value?"selected":""}>${esc(labels[x]||x)}</option>`)
    .join("");

  const items=rows.length?rows.map((r:any)=>`
    <article class="item">
      <div class="item-head"><div><span class="pill ${Number(r.priority)>=2?"high":""}">${esc(labels[r.kind]||r.kind)}</span><h3>#${r.id} · ${esc(r.name)}</h3><div class="meta">${esc(r.contact)} · ${esc(r.country_code||"Sin país")} · ${new Date(r.created_at).toLocaleString("es-HN")}${r.product_name?" · "+esc(r.product_name):""}</div></div><span class="pill">${esc(labels[r.status]||r.status)}</span></div>
      <div class="message">${esc(r.message||"Sin mensaje")}</div>
      <div class="suggest"><b>Acción sugerida:</b> ${esc(suggestedAction(r.kind))}</div>
      <details><summary class="meta">Datos estructurados</summary><pre class="meta">${esc(JSON.stringify(r.metadata||{},null,2))}</pre></details>
      ${(historyBy.get(Number(r.id))||[]).length?`<details><summary class="meta">Historial interno</summary>${(historyBy.get(Number(r.id))||[]).map((h:any)=>`<div class="meta" style="padding:6px 0;border-bottom:1px solid #eee5d9"><b>${esc(h.actor)}</b> · ${esc(labels[h.from_status]||h.from_status||"—")} → ${esc(labels[h.to_status]||h.to_status||"—")} · ${new Date(h.created_at).toLocaleString("es-HN")}${h.note?`<br>${esc(h.note)}`:""}</div>`).join("")}</details>`:""}
      <form class="actions" method="post" action="/inquiries/${r.id}/update">
        <input type="hidden" name="csrf" value="${esc(session.csrf)}">
        <label>Estado<select name="status">${opts([...statuses],r.status)}</select></label>
        <label>Prioridad<select name="priority">${[0,1,2,3].map(x=>`<option value="${x}" ${x===Number(r.priority)?"selected":""}>${x}</option>`).join("")}</select></label>
        <label>Asignado a<input name="assigned_to" maxlength="120" value="${esc(r.assigned_to||"")}"></label>
        <label>Notas internas<textarea name="internal_notes" maxlength="4000">${esc(r.internal_notes||"")}</textarea></label>
        <button>Guardar</button>
      </form>
      ${["product_request","notify","supplier","partnership"].includes(r.kind)?`<form method="post" action="/inquiries/${r.id}/opportunity" style="margin-top:10px"><input type="hidden" name="csrf" value="${esc(session.csrf)}"><button class="ghost">Crear oportunidad</button></form>`:""}
    </article>`).join(""):`<div class="panel empty">No hay intenciones con estos filtros.</div>`;

  const q=(url.searchParams.get("q")||"").slice(0,120);
  const kind=(url.searchParams.get("kind")||"").slice(0,32);
  const status=(url.searchParams.get("status")||"").slice(0,32);

  const opportunityPanel=opportunities.length
    ?`<div class="panel" style="margin-top:12px"><div class="eyebrow">Oportunidades abiertas</div>${opportunities.map((o:any)=>`<p class="meta"><b>${esc(o.title)}</b> · ${esc(o.opportunity_type)} · ${esc(o.owner||"sin asignar")}</p>`).join("")}</div>`
    :"";

  return shell(`
    <div class="eyebrow">Bandeja de Intenciones</div>
    <h1>Señales del mercado convertidas en trabajo.</h1>
    <p class="meta">Sesión individual StaffUser · permisos efectivos del Commerce Core.</p>
    ${metrics}${intelligence}${opportunityPanel}
    <form class="toolbar" method="get">
      <a href="/export/inquiries.csv" style="align-self:center;text-decoration:none;font-weight:900;color:#705b27">Exportar CSV ↓</a>
      <input type="search" name="q" value="${esc(q)}" placeholder="Buscar nombre, contacto o mensaje">
      <select name="kind"><option value="">Todos los tipos</option>${["product_request","notify","supplier","partnership","support"].map(x=>`<option value="${x}" ${x===kind?"selected":""}>${esc(labels[x])}</option>`).join("")}</select>
      <select name="status"><option value="">Todos los estados</option>${opts([...statuses],status)}</select>
      <button>Filtrar</button>
    </form>
    <section class="queue">${items}</section>
  `,session);
}


function opsNotice(url:URL){
  const n=url.searchParams.get("n")||"";
  const messages:Record<string,string>={
    created:"Creado correctamente.",
    updated:"Actualizado correctamente.",
    action:"Acción completada.",
    error:"No se pudo completar la acción."
  };
  return messages[n]?'<div class="notice">'+esc(messages[n])+'</div>':"";
}

function hnlMinor(value:unknown,currency="HNL"){
  const amount=(Number(value)||0)/100;
  return (currency==="HNL"?"L ":currency+" ")+amount.toLocaleString("es-HN",{minimumFractionDigits:2,maximumFractionDigits:2});
}

async function ordersPage(url:URL,session:Session){
  const result=await api("/v1/internal/orders",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso orders.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Pedidos no disponibles</h2></div>',session);
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const next:Record<string,string[]>={
    PENDING_CONFIRMATION:["CONFIRMED","CANCELLED"],
    CONFIRMED:["PROCESSING","CANCELLED"],
    PROCESSING:["READY","CANCELLED"],
    READY:["SHIPPED","COMPLETED","CANCELLED"],
    SHIPPED:["DELIVERED"],
    DELIVERED:["COMPLETED"],
    COMPLETED:[],
    CANCELLED:[]
  };
  const cards=rows.length?rows.map((r:any)=>{
    const targets=next[String(r.status)]||[];
    const form=targets.length
      ?'<form method="post" action="/orders/'+Number(r.id)+'/status" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Nuevo estado<select name="status">'+targets.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("")+'</select></label><label>Motivo<input name="reason" maxlength="240" placeholder="Opcional"></label><button>Actualizar</button></form>'
      :"";
    return '<article class="item"><div class="item-head"><div><div class="eyebrow">'+esc(r.channel||"WEB")+'</div><h3>'+esc(r.order_number||("#"+r.id))+'</h3><div class="meta">'+esc(r.customer_name||"Cliente sin nombre")+' · '+esc(r.customer_phone||"Sin teléfono")+'</div></div><div><span class="pill">'+esc(r.status)+'</span><div style="margin-top:8px">'+esc(hnlMinor(r.grand_total_minor,r.currency||"HNL"))+'</div></div></div>'+form+'</article>';
  }).join(""):'<div class="panel empty">Todavía no hay pedidos.</div>';
  return shell('<div class="eyebrow">Pedidos</div><h1>Ventas y estados de pedido</h1>'+opsNotice(url)+'<section class="queue">'+cards+'</section>',session);
}

async function customersPage(url:URL,session:Session){
  const result=await api("/v1/internal/customers",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso customers.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Clientes no disponibles</h2></div>',session);
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const cards=rows.length?rows.map((r:any)=>{
    const contacts=Array.isArray(r.contacts)?r.contacts:[];
    return '<article class="item"><h3>'+esc(r.displayName)+'</h3><div class="meta">Cliente #'+esc(r.id)+' · '+esc(r.customerType||"PERSON")+' · '+esc(r.status)+'</div><div class="meta">'+(contacts.length?contacts.map((x:any)=>esc(x.type)+": "+esc(x.value)).join(" · "):"Sin contactos registrados")+'</div></article>';
  }).join(""):'<div class="panel empty">Todavía no hay clientes.</div>';
  return shell('<div class="eyebrow">Clientes</div><h1>Directorio de clientes</h1>'+opsNotice(url)+'<section class="panel" style="margin-bottom:14px"><h3>Nuevo cliente</h3><form method="post" action="/customers" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Nombre<input name="displayName" required maxlength="160"></label><label>Tipo<select name="customerType"><option value="PERSON">Persona</option><option value="BUSINESS">Empresa</option></select></label><button>Crear cliente</button></form></section><section class="queue">'+cards+'</section>',session);
}

async function suppliersPage(url:URL,session:Session){
  const result=await api("/v1/internal/suppliers",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso suppliers.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Proveedores no disponibles</h2></div>',session);
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const invite=url.searchParams.get("invite")||"";
  const cards=rows.length?rows.map((r:any)=>{
    return '<article class="item"><div class="item-head"><div><h3>'+esc(r.name)+'</h3><div class="meta">'+esc(r.contactName||"Sin contacto")+' · '+esc(r.phone||"Sin teléfono")+' · '+esc(r.email||"Sin correo")+'</div></div><span class="pill">'+(r.active?"Activo":"Inactivo")+'</span></div><form method="post" action="/suppliers/'+Number(r.id)+'/invite" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Correo de invitación<input name="email" type="email" maxlength="254" placeholder="Opcional"></label><button>Crear enlace de catálogo</button></form></article>';
  }).join(""):'<div class="panel empty">Todavía no hay proveedores.</div>';
  return shell('<div class="eyebrow">Proveedores</div><h1>Abastecimiento y catálogos externos</h1>'+opsNotice(url)+(invite?'<div class="notice"><b>Enlace de proveedor:</b><br><span style="word-break:break-all">'+esc(invite)+'</span></div>':"")+'<section class="panel" style="margin-bottom:14px"><h3>Nuevo proveedor</h3><form method="post" action="/suppliers" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Nombre<input name="name" required maxlength="180"></label><label>Contacto<input name="contactName" maxlength="160"></label><label>Teléfono<input name="phone" maxlength="80"></label><label>Correo<input name="email" type="email" maxlength="254"></label><label>País<input name="countryCode" value="HN" maxlength="2"></label><label>Moneda<input name="defaultCurrency" value="HNL" maxlength="3"></label><button>Crear proveedor</button></form></section><section class="queue">'+cards+'</section>',session);
}

async function vendorReviewPage(url:URL,session:Session){
  const result=await api("/v1/internal/vendor-products",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso catalog.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Revisión de proveedores no disponible</h2></div>',session);
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const cards=rows.length?rows.map((r:any)=>{
    const actions=r.reviewStatus==="SUBMITTED"
      ?'<div class="toolbar"><form method="post" action="/vendor-review/'+Number(r.id)+'/approve"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button> Aprobar y publicar </button></form><form method="post" action="/vendor-review/'+Number(r.id)+'/reject" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input name="note" maxlength="2000" placeholder="Motivo de rechazo" required><button class="ghost">Rechazar</button></form></div>'
      :"";
    return '<article class="item"><div class="item-head"><div><div class="eyebrow">'+esc(r.supplierName)+'</div><h3>'+esc(r.name)+'</h3><div class="meta">'+esc(r.category||"Sin categoría")+' · '+esc(r.brand||"Sin marca")+' · '+esc(r.variantCount)+' variantes · '+esc(r.imageCount)+' imágenes</div></div><span class="pill">'+esc(r.reviewStatus)+'</span></div>'+actions+'</article>';
  }).join(""):'<div class="panel empty">No hay productos de proveedores para revisar.</div>';
  return shell('<div class="eyebrow">Revisión</div><h1>Catálogos de terceros</h1>'+opsNotice(url)+'<p class="meta">Los productos externos permanecen en borrador hasta que el equipo los apruebe.</p><section class="queue">'+cards+'</section>',session);
}

async function purchasesPage(url:URL,session:Session){
  const [ordersResult,suppliersResult,catalogResultApi,locationsResult]=await Promise.all([
    api("/v1/internal/procurement/purchase-orders",{cookieHeader:session.cookieHeader}),
    api("/v1/internal/suppliers?active=true",{cookieHeader:session.cookieHeader}),
    api("/v1/internal/catalog",{cookieHeader:session.cookieHeader}),
    api("/v1/internal/locations",{cookieHeader:session.cookieHeader})
  ]);

  if(ordersResult.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso procurement.read.</p></div>',session);
  if(!ordersResult.response?.ok)return shell('<div class="panel empty"><h2>Compras no disponibles</h2></div>',session);

  const rows:any[]=Array.isArray(ordersResult.body?.data)?ordersResult.body.data:[];
  const suppliers:any[]=Array.isArray(suppliersResult.body?.data)?suppliersResult.body.data:[];
  const products:any[]=Array.isArray(catalogResultApi.body?.data)?catalogResultApi.body.data:[];
  const locations:any[]=Array.isArray(locationsResult.body?.data)?locationsResult.body.data:[];
  const variants:any[]=products.flatMap((p:any)=>
    (Array.isArray(p.variants)?p.variants:[]).map((v:any)=>({...v,productName:p.name}))
  );

  const receivable=rows.filter((r:any)=>["ORDERED","PARTIALLY_RECEIVED"].includes(r.status));
  const detailPairs=await Promise.all(receivable.map(async(r:any)=>{
    const x=await api("/v1/internal/procurement/purchase-orders/"+Number(r.id),{cookieHeader:session.cookieHeader});
    return [Number(r.id),x.response?.ok?x.body?.purchaseOrder:null] as const;
  }));
  const detailById=new Map<number,any>(detailPairs);

  const supplierOptions=suppliers.map((s:any)=>'<option value="'+Number(s.id)+'">'+esc(s.name)+'</option>').join("");
  const locationOptions=locations.map((l:any)=>'<option value="'+Number(l.id)+'">'+esc(l.name)+' · '+esc(l.type)+'</option>').join("");
  const variantOptions=variants.map((v:any)=>'<option value="'+Number(v.id)+'">'+esc(v.productName)+' · '+esc(v.sku)+' · '+esc(v.size||"Sin talla")+' · '+esc(v.color||"Sin color")+'</option>').join("");

  const createForm=suppliers.length&&locations.length&&variants.length
    ?'<section class="panel" style="margin-bottom:18px"><h3>Registrar compra de mercadería</h3><p class="meta">Crea la orden, apruébala y luego registra la recepción. Al recibir, el inventario aumenta automáticamente.</p><form method="post" action="/purchases" class="actions"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Proveedor<select name="supplierId" required>'+supplierOptions+'</select></label><label>Destino<select name="destinationLocationId" required>'+locationOptions+'</select></label><label>Producto / variante<select name="variantId" required>'+variantOptions+'</select></label><label>Cantidad<input name="quantityOrdered" type="number" min="1" step="1" required></label><label>Costo unitario HNL<input name="unitCost" type="number" min="0" step="0.01" required></label><label>SKU proveedor<input name="supplierSku" maxlength="160"></label><label>País origen<input name="originCountryCode" maxlength="2" placeholder="HN"></label><label>Referencia proveedor<input name="supplierReference" maxlength="180"></label><label>Flete estimado HNL<input name="shippingEstimate" type="number" min="0" step="0.01" value="0"></label><label>Impuestos estimados HNL<input name="taxEstimate" type="number" min="0" step="0.01" value="0"></label><label>Otros costos HNL<input name="otherCosts" type="number" min="0" step="0.01" value="0"></label><button>Crear orden</button></form></section>'
    :'<div class="notice">Para registrar una compra necesitas un proveedor activo, una ubicación operativa y al menos una variante creada en Catálogo.</div>';

  const cards=rows.length?rows.map((r:any)=>{
    const actions:any[]=[];
    if(r.status==="DRAFT")actions.push(["approve","Aprobar"],["cancel","Cancelar"]);
    if(r.status==="APPROVED")actions.push(["order","Marcar ordenada"],["cancel","Cancelar"]);
    if(r.status==="ORDERED")actions.push(["cancel","Cancelar"]);

    const detail=detailById.get(Number(r.id));
    let receipt="";
    if(detail&&["ORDERED","PARTIALLY_RECEIVED"].includes(r.status)){
      const remaining=(Array.isArray(detail.items)?detail.items:[]).filter((i:any)=>Number(i.quantityRemaining)>0);
      if(remaining.length){
        receipt='<details style="margin-top:12px"><summary>Recibir mercadería</summary><form method="post" action="/purchases/'+Number(r.id)+'/receive" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Referencia entrega<input name="supplierDeliveryReference" maxlength="200"></label>'+remaining.map((i:any)=>'<label>'+esc(i.productName)+' · '+esc(i.sku)+'<input name="qty_'+Number(i.id)+'" type="number" min="0" max="'+Number(i.quantityRemaining)+'" step="1" value="'+Number(i.quantityRemaining)+'"></label>').join("")+'<button>Registrar recepción</button></form></details>';
      }
    }

    return '<article class="item"><div class="item-head"><div><h3>'+esc(r.poNumber)+'</h3><div class="meta">'+esc(r.supplierName)+' · Destino #'+esc(r.destinationLocationId)+'</div></div><div><span class="pill">'+esc(r.status)+'</span><div>'+esc(hnlMinor(r.grandTotalMinor,r.currency))+'</div></div></div><div class="toolbar">'+actions.map((a:any)=>'<form method="post" action="/purchases/'+Number(r.id)+'/'+esc(a[0])+'"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button class="'+(a[0]==="cancel"?"ghost":"")+'">'+esc(a[1])+'</button></form>').join("")+'</div>'+receipt+'</article>';
  }).join(""):'<div class="panel empty">Todavía no hay órdenes de compra.</div>';

  return shell('<div class="eyebrow">Compras</div><h1>Órdenes y recepción de mercadería</h1>'+opsNotice(url)+createForm+'<section class="queue">'+cards+'</section>',session);
}

async function fulfillmentPage(url:URL,session:Session){
  const result=await api("/v1/internal/fulfillments",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso fulfillment.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Entregas no disponibles</h2></div>',session);
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const next:Record<string,string[]>={
    PENDING:["PREPARING","CANCELLED"],
    PREPARING:["READY","CANCELLED"],
    READY:["DISPATCHED","DELIVERED","CANCELLED"],
    DISPATCHED:["OUT_FOR_DELIVERY","FAILED"],
    OUT_FOR_DELIVERY:["DELIVERED","FAILED"],
    FAILED:["OUT_FOR_DELIVERY","RETURNING"],
    RETURNING:["RETURNED"]
  };
  const cards=rows.length?rows.map((r:any)=>{
    const targets=next[String(r.status)]||[];
    const form=targets.length?'<form method="post" action="/fulfillment/'+Number(r.id)+'/status" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Nuevo estado<select name="status">'+targets.map(x=>'<option>'+esc(x)+'</option>').join("")+'</select></label><label>Motivo<input name="reason" maxlength="300"></label><button>Actualizar</button></form>':"";
    return '<article class="item"><div class="item-head"><div><h3>'+esc(r.order_number)+'</h3><div class="meta">'+esc(r.type)+' · '+esc(r.department||"")+' · '+esc(r.municipality||"")+' · '+esc(r.provider||"Sin proveedor")+'</div></div><span class="pill">'+esc(r.status)+'</span></div>'+form+'</article>';
  }).join(""):'<div class="panel empty">Todavía no hay entregas.</div>';
  return shell('<div class="eyebrow">Entregas</div><h1>Preparación y despacho</h1>'+opsNotice(url)+'<section class="queue">'+cards+'</section>',session);
}

async function returnsPage(url:URL,session:Session){
  const result=await api("/v1/internal/returns",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso returns.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Devoluciones no disponibles</h2></div>',session);
  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const cards=rows.length?rows.map((r:any)=>{
    let actions="";
    if(r.status==="REQUESTED")actions='<div class="toolbar"><form method="post" action="/returns/'+Number(r.id)+'/approve"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button>Aprobar</button></form><form method="post" action="/returns/'+Number(r.id)+'/reject" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input name="reason" maxlength="500" placeholder="Motivo" required><button class="ghost">Rechazar</button></form></div>';
    if(r.status==="INSPECTED")actions='<form method="post" action="/returns/'+Number(r.id)+'/complete"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button>Completar</button></form>';
    return '<article class="item"><div class="item-head"><div><h3>'+esc(r.returnNumber)+'</h3><div class="meta">Pedido '+esc(r.orderNumber)+' · '+esc(r.requestedResolution)+' · '+esc(r.reasonCode)+'</div></div><span class="pill">'+esc(r.status)+'</span></div>'+actions+'</article>';
  }).join(""):'<div class="panel empty">Todavía no hay devoluciones.</div>';
  return shell('<div class="eyebrow">Devoluciones</div><h1>Cambios y devoluciones</h1>'+opsNotice(url)+'<section class="queue">'+cards+'</section>',session);
}


async function inventoryAdjustmentsPage(url:URL,session:Session){
  const roles:any[]=Array.isArray(session.user?.roles)?session.user.roles:[];
  const permissions=new Set(Array.isArray(session.user?.permissions)?session.user.permissions:[]);
  const scopedLocationIds=roles
    .filter((r:any)=>r?.scopeType==="LOCATION"&&Number(r?.locationId)>0)
    .map((r:any)=>Number(r.locationId));
  const hasGlobal=roles.some((r:any)=>r?.scopeType==="GLOBAL");

  const [locationsResult,catalogResultApi]=await Promise.all([
    api("/v1/internal/locations",{cookieHeader:session.cookieHeader}),
    api("/v1/internal/catalog",{cookieHeader:session.cookieHeader})
  ]);

  if(locationsResult.response?.status===403||catalogResultApi.response?.status===403){
    return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Faltan permisos de inventario/procurement para operar ajustes.</p></div>',session);
  }
  if(!locationsResult.response?.ok||!catalogResultApi.response?.ok){
    return shell('<div class="panel empty"><h2>Ajustes no disponibles</h2><p>No se pudo consultar ubicaciones o catálogo.</p></div>',session);
  }

  const allLocations:any[]=Array.isArray(locationsResult.body?.data)?locationsResult.body.data:[];
  const locations=hasGlobal?allLocations:allLocations.filter((l:any)=>scopedLocationIds.includes(Number(l.id)));
  const requestedLocation=Number(url.searchParams.get("locationId")||0);
  const selectedLocationId=
    requestedLocation&&locations.some((l:any)=>Number(l.id)===requestedLocation)
      ?requestedLocation
      :Number(locations[0]?.id||0);

  if(!selectedLocationId){
    return shell('<div class="panel empty"><h2>Sin ubicación autorizada</h2><p>Tu usuario no tiene una ubicación operativa disponible para ajustes.</p></div>',session);
  }

  const adjustmentsResult=await api(
    "/v1/internal/inventory-adjustments?locationId="+selectedLocationId,
    {cookieHeader:session.cookieHeader}
  );
  if(adjustmentsResult.response?.status===403){
    return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso inventory_adjustments.read para esta ubicación.</p></div>',session);
  }

  const adjustments:any[]=Array.isArray(adjustmentsResult.body?.data)?adjustmentsResult.body.data:[];
  const products:any[]=Array.isArray(catalogResultApi.body?.data)?catalogResultApi.body.data:[];
  const variants=products.flatMap((p:any)=>
    (Array.isArray(p.variants)?p.variants:[]).map((v:any)=>({
      id:Number(v.id),
      label:String(v.sku||("Variante "+v.id))+" · "+String(p.name||"Producto"),
      available:Number(v.available||0)
    }))
  );

  const selectedVariantId=Number(url.searchParams.get("variantId")||0);
  const n=url.searchParams.get("n")||"";
  const messages:any={
    created:"Solicitud de ajuste creada.",
    submitted:"Solicitud enviada a aprobación.",
    approved:"Ajuste aprobado.",
    rejected:"Ajuste rechazado.",
    posted:"Ajuste aplicado al Kardex.",
    evidence:"Evidencia registrada.",
    cancelled:"Solicitud cancelada.",
    error:"No se pudo completar la acción."
  };
  const notice=messages[n]?'<div class="notice">'+esc(messages[n])+'</div>':"";

  const locationOptions=locations.map((l:any)=>
    '<option value="'+Number(l.id)+'" '+(Number(l.id)===selectedLocationId?'selected':'')+'>'+esc(l.name)+' · '+esc(l.type||"")+'</option>'
  ).join("");

  const variantOptions=variants.map((v:any)=>
    '<option value="'+v.id+'" '+(v.id===selectedVariantId?'selected':'')+'>'+esc(v.label)+' · disp. '+v.available+'</option>'
  ).join("");

  const canApprove=permissions.has("inventory_adjustments.approve");
  const canPost=permissions.has("inventory_adjustments.post");

  const cards=adjustments.length?adjustments.map((a:any)=>{
    let actions="";
    if(a.status==="DRAFT"){
      actions='<form method="post" action="/inventory-adjustments/'+Number(a.id)+'/submit"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input type="hidden" name="locationId" value="'+selectedLocationId+'"><button>Enviar a aprobación</button></form>';
    }else if(a.status==="SUBMITTED"&&canApprove){
      actions='<div class="toolbar"><form method="post" action="/inventory-adjustments/'+Number(a.id)+'/approve"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input type="hidden" name="locationId" value="'+selectedLocationId+'"><button>Aprobar</button></form><form method="post" action="/inventory-adjustments/'+Number(a.id)+'/reject" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input type="hidden" name="locationId" value="'+selectedLocationId+'"><input name="reason" maxlength="500" placeholder="Motivo de rechazo" required><button class="ghost">Rechazar</button></form></div>';
    }else if(a.status==="APPROVED"&&canPost){
      actions='<form method="post" action="/inventory-adjustments/'+Number(a.id)+'/post"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input type="hidden" name="locationId" value="'+selectedLocationId+'"><button>Aplicar al Kardex</button></form>';
    }

    const evidenceForm=(a.status==="DRAFT"||a.status==="SUBMITTED")
      ?'<details style="margin-top:12px"><summary>Agregar evidencia</summary><form method="post" action="/inventory-adjustments/'+Number(a.id)+'/evidence" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input type="hidden" name="locationId" value="'+selectedLocationId+'"><label>Tipo<select name="evidenceType"><option>DOCUMENT</option><option>PHOTO</option><option>COUNT_SHEET</option><option>COURIER_REPORT</option><option>POLICE_REPORT_REFERENCE</option><option>OTHER</option></select></label><label>Referencia privada<input name="objectReference" maxlength="1000" required placeholder="private://..."></label><label>Descripción<input name="description" maxlength="500"></label><button>Registrar evidencia</button></form></details>'
      :"";

    return '<article class="item"><div class="item-head"><div><h3>'+esc(a.requestNumber)+'</h3><div class="meta">'+esc(a.reasonCode)+' · riesgo '+esc(a.riskLevel)+' · ubicación '+Number(a.locationId)+'</div></div><span class="pill '+(a.riskLevel==="HIGH"||a.riskLevel==="CRITICAL"?'high':'')+'">'+esc(a.status)+'</span></div>'+actions+evidenceForm+'</article>';
  }).join(""):'<div class="panel empty">Todavía no hay solicitudes de ajuste en esta ubicación.</div>';

  return shell(
    '<div class="eyebrow">Inventario</div><h1>Ajustes y merma</h1><p class="meta">Los cambios excepcionales pasan por solicitud, aprobación y posting auditable antes de modificar el Kardex.</p>'+
    notice+
    '<section class="panel" style="margin-bottom:18px"><form method="get" action="/inventory-adjustments" class="toolbar"><label>Ubicación<select name="locationId">'+locationOptions+'</select></label><button>Ver ubicación</button></form></section>'+
    '<section class="panel" style="margin-bottom:18px"><h3>Nueva solicitud</h3><form method="post" action="/inventory-adjustments" class="actions"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><label>Ubicación<select name="locationId">'+locationOptions+'</select></label><label>Variante<select name="variantId" required>'+variantOptions+'</select></label><label>Delta<input name="quantityDelta" type="number" step="1" required placeholder="-1 o 1"></label><label>Motivo<select name="reasonCode"><option>COUNT_VARIANCE_NEGATIVE</option><option>COUNT_VARIANCE_POSITIVE</option><option>DAMAGE</option><option>THEFT_SUSPECTED</option><option>THEFT_CONFIRMED</option><option>LOSS_IN_TRANSIT</option><option>LOST_IN_STORE</option><option>EXPIRED</option><option>CONTAMINATED</option><option>DESTRUCTION</option><option>ADMIN_CORRECTION</option><option>RECOVERY_FOUND</option><option>OTHER</option></select></label><label>Detalle<input name="reasonText" maxlength="500"></label><button>Crear solicitud</button></form></section>'+
    '<section class="queue">'+cards+'</section>',
    session
  );
}


async function healthDeskPage(url:URL,session:Session){
  const result=await api("/v1/internal/health-desk",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403){
    return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso health.read.</p></div>',session);
  }
  if(!result.response?.ok){
    return shell('<div class="panel empty"><h2>Health Desk no disponible</h2><p>No se pudo consultar el Commerce Core.</p></div>',session);
  }

  const summary=result.body?.summary||{};
  const signals:any[]=Array.isArray(result.body?.signals)?result.body.signals:[];
  const incidents:any[]=Array.isArray(result.body?.incidents)?result.body.incidents:[];
  const permissions=new Set(Array.isArray(session.user?.permissions)?session.user.permissions:[]);
  const canManage=permissions.has("health.incidents.manage");
  const canResolve=permissions.has("health.incidents.resolve");
  const n=url.searchParams.get("n")||"";
  const messages:any={
    refreshed:"Señales actualizadas.",
    acknowledged:"Incidente reconocido.",
    investigating:"Incidente en investigación.",
    resolved:"Incidente resuelto.",
    error:"No se pudo completar la acción."
  };
  const notice=messages[n]?'<div class="notice">'+esc(messages[n])+'</div>':"";

  const metrics='<section class="grid" style="margin-bottom:18px">'+
    '<div class="metric"><span>Estado</span><b>'+esc(result.body?.overall||"UNKNOWN")+'</b></div>'+
    '<div class="metric"><span>Señales activas</span><b>'+Number(summary.activeSignals||0)+'</b></div>'+
    '<div class="metric"><span>Críticas</span><b>'+Number(summary.criticalSignals||0)+'</b></div>'+
    '<div class="metric"><span>Incidentes abiertos</span><b>'+Number(summary.openIncidents||0)+'</b></div>'+
  '</section>';

  const signalCards=signals.length?signals.map((s:any)=>
    '<article class="item"><div class="item-head"><div><h3>'+esc(s.signalType)+'</h3>'+
    '<div class="meta">'+esc(s.sourceType)+' · '+esc(s.message)+'</div></div>'+
    '<span class="pill '+(s.severity==="CRITICAL"?'high':'')+'">'+esc(s.status)+' · '+esc(s.severity)+'</span></div>'+
    '<div class="meta">Valor: '+(s.observedValue==null?'—':Number(s.observedValue))+
    (s.unit?' '+esc(s.unit):'')+' · Última lectura: '+esc(String(s.lastSeenAt||"—"))+'</div></article>'
  ).join(""):'<div class="panel empty">Todavía no hay señales. Usa Actualizar señales.</div>';

  const incidentCards=incidents.length?incidents.map((i:any)=>{
    let actions="";
    if(["OPEN","ACKNOWLEDGED","INVESTIGATING"].includes(i.status)){
      const parts:string[]=[];
      if(canManage&&i.status==="OPEN"){
        parts.push('<form method="post" action="/health-desk/incidents/'+Number(i.id)+'/acknowledge"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button>Reconocer</button></form>');
      }
      if(canManage&&i.status!=="INVESTIGATING"){
        parts.push('<form method="post" action="/health-desk/incidents/'+Number(i.id)+'/investigate"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button class="ghost">Investigar</button></form>');
      }
      if(canResolve){
        parts.push('<form method="post" action="/health-desk/incidents/'+Number(i.id)+'/resolve" class="toolbar"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><input name="note" maxlength="500" placeholder="Resolución / nota"><button>Resolver</button></form>');
      }
      actions='<div class="toolbar">'+parts.join("")+'</div>';
    }
    return '<article class="item"><div class="item-head"><div><h3>'+esc(i.incidentNumber)+'</h3>'+
      '<div class="meta">'+esc(i.incidentType)+' · '+esc(i.summary)+'</div></div>'+
      '<span class="pill '+(i.severity==="CRITICAL"?'high':'')+'">'+esc(i.status)+' · '+esc(i.severity)+'</span></div>'+
      actions+'</article>';
  }).join(""):'<div class="panel empty">No hay incidentes persistidos.</div>';

  const refresh=canManage
    ?'<form method="post" action="/health-desk/refresh" style="margin:14px 0"><input type="hidden" name="csrf" value="'+esc(session.csrf)+'"><button>Actualizar señales</button></form>'
    :'';

  return shell(
    '<div class="eyebrow">Operación</div><h1>Health Desk</h1>'+
    '<p class="meta">Observabilidad operativa. Esta pantalla no modifica inventario, pagos, pedidos ni fulfillment.</p>'+
    notice+refresh+metrics+
    '<section style="margin-bottom:24px"><h2>Señales</h2><div class="queue">'+signalCards+'</div></section>'+
    '<section><h2>Incidentes</h2><div class="queue">'+incidentCards+'</div></section>',
    session
  );
}

async function catalogPage(url:URL,session:Session){
  const result=await api("/v1/internal/catalog",{cookieHeader:session.cookieHeader});
  if(result.response?.status===403)return shell('<div class="panel empty"><h2>Acceso insuficiente</h2><p>Falta permiso catalog.read.</p></div>',session);
  if(!result.response?.ok)return shell('<div class="panel empty"><h2>Catálogo no disponible</h2><p>No se pudo consultar el Commerce Core.</p></div>',session);

  const rows:any[]=Array.isArray(result.body?.data)?result.body.data:[];
  const n=url.searchParams.get("n")||"";
  const messages:any={created:"Producto creado.",updated:"Estado actualizado.",variant:"Variante agregada.",stock:"Stock actualizado.",image:"Imagen agregada.",error:"No se pudo completar la acción."};
  const notice=messages[n]?'<div class="notice">'+esc(messages[n])+'</div>':"";

  const cards=rows.length?rows.map((p:any)=>{
    const variants=Array.isArray(p.variants)?p.variants:[];
    const images=Array.isArray(p.images)?p.images:[];
    const primaryImage=images[0]?.url||"";
    const vars=variants.length?variants.map((v:any)=>`
      <div class="item" style="margin-top:10px">
        <div class="item-head"><div><b>${esc(v.sku)}</b><div class="meta">${esc(v.size||"Sin talla")} · ${esc(v.color||"Sin color")} · L ${Number(v.price||0).toFixed(2)} · Stock ${Number(v.available||0)}</div></div>
        <a class="ghost" href="/inventory-adjustments?variantId=${Number(v.id)}" style="display:inline-flex;align-items:center;text-decoration:none;border-radius:999px;padding:11px 14px;font-weight:900">Solicitar ajuste</a></div>
      </div>`).join(""):'<p class="meta">Sin variantes.</p>';

    return `<section class="panel" style="margin-bottom:14px">
      <div class="item-head">
        <div style="display:flex;gap:12px;align-items:center">
          ${primaryImage?'<img src="'+esc(primaryImage)+'" alt="'+esc(p.name)+'" style="width:88px;height:88px;object-fit:cover;border-radius:14px;border:1px solid #ded5c8">':""}
          <div><div class="eyebrow">${esc(p.category||"Sin categoría")}</div><h3>${esc(p.name)}</h3><p class="meta">${esc(p.brand||"Sin marca")} · ${p.status==="active"?"Publicado":"Borrador"} · ${images.length} imagen(es)</p></div>
        </div>
        <form method="post" action="/catalog/products/${Number(p.id)}/status">
          <input type="hidden" name="csrf" value="${esc(session.csrf)}">
          <input type="hidden" name="status" value="${p.status==="active"?"draft":"active"}">
          <button class="ghost">${p.status==="active"?"Pasar a borrador":"Publicar"}</button>
        </form>
      </div>
      ${vars}
      <details style="margin-top:12px"><summary>Agregar imagen</summary>
        <form method="post" action="/catalog/products/${Number(p.id)}/images" class="toolbar" style="margin-top:10px">
          <input type="hidden" name="csrf" value="${esc(session.csrf)}">
          <label>URL HTTPS de imagen<input name="url" type="url" required maxlength="1000" placeholder="https://..."></label>
          <label>Texto alternativo<input name="altText" maxlength="240" value="${esc(p.name)}"></label>
          <button>Agregar imagen</button>
        </form>
      </details>
      <details style="margin-top:12px"><summary>Agregar variante</summary>
        <form method="post" action="/catalog/products/${Number(p.id)}/variants" class="actions" style="margin-top:10px">
          <input type="hidden" name="csrf" value="${esc(session.csrf)}">
          <label>SKU<input name="sku" required></label>
          <label>Precio HNL<input name="price" type="number" min="0" step="0.01" required></label>
          <label>Talla<input name="size"></label>
          <label>Color<input name="color"></label>
          <label>Costo HNL<input name="cost" type="number" min="0" step="0.01"></label>
          <label>Stock<input name="stock" type="number" min="0" step="1" value="0" required></label>
          <button>Agregar</button>
        </form>
      </details>
    </section>`;
  }).join(""):'<div class="panel empty"><h3>Aún no hay productos</h3></div>';

  return shell(`
    <div class="head"><div><div class="eyebrow">Catálogo</div><h2>Productos e inventario</h2><p>Crea en borrador y publica cuando esté listo.</p></div></div>
    ${notice}
    <section class="panel" style="margin-bottom:18px">
      <h3>Nuevo producto</h3>
      <form method="post" action="/catalog/products" class="actions">
        <input type="hidden" name="csrf" value="${esc(session.csrf)}">
        <label>Nombre<input name="name" required maxlength="180"></label>
        <label>Categoría<input name="category" maxlength="120"></label>
        <label>Marca<input name="brand" maxlength="120" value="MR עדולם"></label>
        <label>Estado<select name="status"><option value="draft">Borrador</option><option value="active">Publicar ahora</option></select></label>
        <label>SKU<input name="sku" required maxlength="100"></label>
        <label>Precio HNL<input name="price" type="number" min="0" step="0.01" required></label>
        <label>Talla<input name="size"></label>
        <label>Color<input name="color"></label>
        <label>Costo HNL<input name="cost" type="number" min="0" step="0.01"></label>
        <label>Stock inicial<input name="stock" type="number" min="0" step="1" value="0" required></label>
        <label>Imagen principal (URL HTTPS)<input name="imageUrl" type="url" maxlength="1000" placeholder="https://..."></label>
        <button>Crear producto</button>
      </form>
    </section>
    ${cards}
  `,session);
}

function catalogResult(result:any,ok:string){
  return result.response?.ok?ok:"error";
}

Bun.serve({
  port:Number(Bun.env.PORT||3000),
  async fetch(req){
    const url=new URL(req.url);
    const configured=Boolean(API_BASE);

    if(url.pathname==="/health"){
      return json({ok:true,service:"MR עדולם Control Center",configured,identity:"StaffUser"});
    }

    if(url.pathname==="/ready"){
      if(!configured)return json({ok:false,reason:"setup_required"},503);
      const result=await api("/health");
      return result.response?.ok
        ?json({ok:true,commerceCore:"connected"})
        :json({ok:false,commerceCore:"unavailable"},503);
    }

    if(!configured)return html(setupPage(),503);

    const setupSegment=String(Bun.env.CONTROL_CENTER_SETUP_PATH||"").split("/").filter(Boolean).join("");
    const setupPath=setupSegment?"/"+setupSegment:"";
    if(setupPath!=="/"&&url.pathname===setupPath&&req.method==="GET"){
      const existing=await readSession(req);
      return existing?redirect("/"):html(bootstrapPage());
    }

    if(setupPath!=="/"&&url.pathname===setupPath&&req.method==="POST"){
      const fd=await req.formData();
      const email=String(fd.get("email")||"").trim().slice(0,254);
      const displayName=String(fd.get("displayName")||"").trim().slice(0,120);
      const password=String(fd.get("password")||"").slice(0,256);
      const confirmPassword=String(fd.get("confirmPassword")||"").slice(0,256);
      const bootstrapToken=String(Bun.env.BOOTSTRAP_API_TOKEN||"");

      if(!bootstrapToken)return html(bootstrapPage("La configuración inicial no está habilitada."),503);
      if(!displayName)return html(bootstrapPage("Escribe tu nombre."),400);
      if(password!==confirmPassword)return html(bootstrapPage("Las contraseñas no coinciden."),400);
      if(password.length<12)return html(bootstrapPage("La contraseña debe tener al menos 12 caracteres."),400);

      let response:Response;
      let body:any={};
      try{
        response=await fetch(API_BASE+"/v1/security/bootstrap",{
          method:"POST",
          headers:{
            "accept":"application/json",
            "content-type":"application/json",
            "x-internal-key":bootstrapToken
          },
          body:JSON.stringify({email,displayName,password}),
          redirect:"manual"
        });
        body=await response.json().catch(()=>({}));
      }catch{
        return html(bootstrapPage("No se pudo conectar con el Commerce Core."),502);
      }

      if(response.status===201)return redirect("/login?created=1");
      if(response.status===409)return html(loginPage("El administrador inicial ya fue creado. Inicia sesión."),200);

      const messages:Record<string,string>={
        invalid_email:"El correo no es válido.",
        display_name_required:"Escribe tu nombre.",
        invalid_password_length:"La contraseña debe tener entre 12 y 256 caracteres.",
        bootstrap_failed:"No se pudo crear el administrador."
      };
      const key=String(body&&body.error||"");
      return html(bootstrapPage(messages[key]||"No se pudo completar la configuración inicial."),response.status||400);
    }

    if(url.pathname==="/vendor/accept"&&req.method==="GET"){
      const token=String(url.searchParams.get("token")||"").slice(0,256);
      if(!token)return html(vendorLoginPage("Invitación inválida."),400);
      const result=await api("/v1/vendor/invitation?token="+encodeURIComponent(token));
      if(!result.response?.ok)return html(vendorLoginPage("La invitación no existe, venció o ya fue utilizada."),result.response?.status||400);
      return html(vendorAcceptPage(token,result.body?.invitation||{}));
    }

    if(url.pathname==="/vendor/accept"&&req.method==="POST"){
      const fd=await req.formData();
      const token=String(fd.get("token")||"").slice(0,256);
      const email=String(fd.get("email")||"").trim().slice(0,254);
      const displayName=String(fd.get("displayName")||"").trim().slice(0,120);
      const password=String(fd.get("password")||"").slice(0,256);
      const confirm=String(fd.get("confirmPassword")||"").slice(0,256);
      if(password!==confirm){
        const inv=await api("/v1/vendor/invitation?token="+encodeURIComponent(token));
        return html(vendorAcceptPage(token,inv.body?.invitation||{},"Las contraseñas no coinciden."),400);
      }
      const result=await api("/v1/vendor/invitation/accept",{method:"POST",body:{token,email,displayName,password}});
      if(!result.response?.ok){
        const inv=await api("/v1/vendor/invitation?token="+encodeURIComponent(token));
        return html(vendorAcceptPage(token,inv.body?.invitation||{},"No se pudo crear el acceso."),result.response?.status||400);
      }
      return redirect("/vendor/login?created=1");
    }

    if(url.pathname==="/vendor/login"&&req.method==="GET"){
      const existing=await readVendorSession(req);
      if(existing)return redirect("/vendor/catalog");
      return html(vendorLoginPage(url.searchParams.get("created")==="1"?"Acceso creado. Ya puedes iniciar sesión.":""));
    }

    if(url.pathname==="/vendor/login"&&req.method==="POST"){
      const fd=await req.formData();
      const result=await api("/v1/vendor/auth/login",{
        method:"POST",
        body:{email:String(fd.get("email")||"").trim(),password:String(fd.get("password")||"")}
      });
      if(!result.response?.ok)return html(vendorLoginPage("Credenciales incorrectas o acceso no disponible."),401);
      const upstream=result.response.headers.get("set-cookie")||"";
      const csrf=String(result.body?.csrfToken||"");
      if(!upstream.startsWith(VENDOR_COOKIE+"=")||!csrf)return html(vendorLoginPage("No se pudo establecer la sesión."),502);
      return redirect("/vendor/catalog",[upstream,vendorCsrfCookie(csrf)]);
    }

    if(url.pathname==="/vendor/catalog"&&req.method==="GET"){
      const vendor=await readVendorSession(req);
      if(!vendor)return redirect("/vendor/login");
      return html(await vendorCatalogPage(url,vendor));
    }

    if(url.pathname==="/vendor/logout"&&req.method==="POST"){
      const vendor=await readVendorSession(req);
      if(!vendor)return redirect("/vendor/login");
      const fd=await req.formData();
      if(!requireVendorCsrf(fd,vendor))return html("Solicitud inválida",403);
      await api("/v1/vendor/auth/logout",{method:"POST",cookieHeader:vendor.cookieHeader,csrf:vendor.csrf,body:{}});
      return redirect("/vendor/login",[clearCookie(VENDOR_COOKIE),clearCookie(VENDOR_CSRF_COOKIE)]);
    }

    if(url.pathname==="/vendor/products"&&req.method==="POST"){
      const vendor=await readVendorSession(req);
      if(!vendor)return redirect("/vendor/login");
      const fd=await req.formData();
      if(!requireVendorCsrf(fd,vendor))return html("Solicitud inválida",403);
      const cost=String(fd.get("cost")||"").trim();
      const result=await api("/v1/vendor/catalog/products",{
        method:"POST",cookieHeader:vendor.cookieHeader,csrf:vendor.csrf,
        body:{
          name:String(fd.get("name")||"").trim(),
          category:String(fd.get("category")||"").trim()||null,
          brand:String(fd.get("brand")||"").trim()||null,
          sku:String(fd.get("sku")||"").trim(),
          price:Number(fd.get("price")||0),
          cost:cost?Number(cost):null,
          size:String(fd.get("size")||"").trim()||null,
          color:String(fd.get("color")||"").trim()||null,
          stock:Number(fd.get("stock")||0),
          imageUrl:String(fd.get("imageUrl")||"").trim()
        }
      });
      return redirect("/vendor/catalog?n="+(result.response?.ok?"created":"error"));
    }

    const vendorSubmit=url.pathname.match(/^\/vendor\/products\/(\d+)\/submit$/);
    if(vendorSubmit&&req.method==="POST"){
      const vendor=await readVendorSession(req);
      if(!vendor)return redirect("/vendor/login");
      const fd=await req.formData();
      if(!requireVendorCsrf(fd,vendor))return html("Solicitud inválida",403);
      const result=await api("/v1/vendor/catalog/products/"+Number(vendorSubmit[1])+"/submit",{
        method:"POST",cookieHeader:vendor.cookieHeader,csrf:vendor.csrf,body:{}
      });
      return redirect("/vendor/catalog?n="+(result.response?.ok?"submitted":"error"));
    }

    if(url.pathname==="/login"&&req.method==="GET"){
      const existing=await readSession(req);
      if(existing)return redirect("/");
      const created=url.searchParams.get("created")==="1";
      return html(loginPage(created?"Administrador creado. Inicia sesión con tu correo y contraseña.":""));
    }

    if(url.pathname==="/login"&&req.method==="POST"){
      const fd=await req.formData();
      const email=String(fd.get("email")||"").trim().slice(0,254);
      const password=String(fd.get("password")||"").slice(0,256);

      const result=await api("/v1/auth/login",{
        method:"POST",
        body:{email,password}
      });

      if(!result.response?.ok){
        const message=result.response?.status===429
          ?"Demasiados intentos. Intenta más tarde."
          :"Credenciales incorrectas o acceso no disponible.";
        return html(loginPage(message),result.response?.status===429?429:401);
      }

      const upstreamCookie=result.response.headers.get("set-cookie")||"";
      const csrf=String(result.body?.csrfToken||"");
      if(!upstreamCookie.startsWith(`${SESSION_COOKIE}=`)||!csrf){
        return html(loginPage("No se pudo establecer la sesión."),502);
      }

      return redirect("/",[
        upstreamCookie,
        csrfCookie(csrf)
      ]);
    }

    const session=await readSession(req);
    if(!session){
      return html(loginPage("Inicia sesión con tu usuario del equipo para continuar."),401,{
        "set-cookie":clearCookie(SESSION_COOKIE)
      });
    }

    if(url.pathname==="/logout"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);

      await api("/v1/auth/logout",{
        method:"POST",
        cookieHeader:session.cookieHeader,
        csrf:session.csrf
      });

      return redirect("/login",[
        clearCookie(SESSION_COOKIE),
        clearCookie(CSRF_COOKIE)
      ]);
    }

    if(url.pathname==="/"&&req.method==="GET"){
      return html(await dashboard(url,session));
    }


    if(url.pathname==="/orders"&&req.method==="GET")return html(await ordersPage(url,session));
    if(url.pathname==="/customers"&&req.method==="GET")return html(await customersPage(url,session));
    if(url.pathname==="/suppliers"&&req.method==="GET")return html(await suppliersPage(url,session));
    if(url.pathname==="/vendor-review"&&req.method==="GET")return html(await vendorReviewPage(url,session));
    if(url.pathname==="/purchases"&&req.method==="GET")return html(await purchasesPage(url,session));
    if(url.pathname==="/fulfillment"&&req.method==="GET")return html(await fulfillmentPage(url,session));
    if(url.pathname==="/returns"&&req.method==="GET")return html(await returnsPage(url,session));
    if(url.pathname==="/inventory-adjustments"&&req.method==="GET")return html(await inventoryAdjustmentsPage(url,session));
    if(url.pathname==="/health-desk"&&req.method==="GET")return html(await healthDeskPage(url,session));



    if(url.pathname==="/health-desk/refresh"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/health-desk/refresh",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,body:{}
      });
      return redirect("/health-desk?n="+catalogResult(result,"refreshed"));
    }

    const healthAction=url.pathname.match(/^\/health-desk\/incidents\/(\d+)\/(acknowledge|investigate|resolve)$/);
    if(healthAction&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const id=Number(healthAction[1]);
      const action=healthAction[2];
      const result=await api("/v1/internal/health-desk/incidents/"+id+"/"+action,{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{note:String(fd.get("note")||"").trim()||null}
      });
      const ok=action==="acknowledge"?"acknowledged":action==="investigate"?"investigating":"resolved";
      return redirect("/health-desk?n="+catalogResult(result,ok));
    }

    if(url.pathname==="/inventory-adjustments"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const locationId=Number(fd.get("locationId")||0);
      const result=await api("/v1/internal/inventory-adjustments",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{
          locationId,
          reasonCode:String(fd.get("reasonCode")||""),
          reasonText:String(fd.get("reasonText")||"").trim()||null,
          lines:[{
            variantId:Number(fd.get("variantId")||0),
            quantityDelta:Number(fd.get("quantityDelta")||0)
          }]
        }
      });
      return redirect("/inventory-adjustments?locationId="+locationId+"&n="+catalogResult(result,"created"));
    }

    const adjustmentAction=url.pathname.match(/^\/inventory-adjustments\/(\d+)\/(submit|approve|post)$/);
    if(adjustmentAction&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const id=Number(adjustmentAction[1]);
      const action=adjustmentAction[2];
      const locationId=Number(fd.get("locationId")||0);
      const result=await api("/v1/internal/inventory-adjustments/"+id+"/"+action,{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        idempotencyKey:action==="post"?"cc-m12-post-"+id:undefined,
        body:{}
      });
      return redirect("/inventory-adjustments?locationId="+locationId+"&n="+catalogResult(result,action==="submit"?"submitted":action==="approve"?"approved":"posted"));
    }

    const adjustmentReject=url.pathname.match(/^\/inventory-adjustments\/(\d+)\/reject$/);
    if(adjustmentReject&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const id=Number(adjustmentReject[1]);
      const locationId=Number(fd.get("locationId")||0);
      const result=await api("/v1/internal/inventory-adjustments/"+id+"/reject",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{reason:String(fd.get("reason")||"").trim()}
      });
      return redirect("/inventory-adjustments?locationId="+locationId+"&n="+catalogResult(result,"rejected"));
    }

    const adjustmentEvidence=url.pathname.match(/^\/inventory-adjustments\/(\d+)\/evidence$/);
    if(adjustmentEvidence&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const id=Number(adjustmentEvidence[1]);
      const locationId=Number(fd.get("locationId")||0);
      const result=await api("/v1/internal/inventory-adjustments/"+id+"/evidence",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{
          evidenceType:String(fd.get("evidenceType")||"OTHER"),
          objectReference:String(fd.get("objectReference")||"").trim(),
          description:String(fd.get("description")||"").trim()||null
        }
      });
      return redirect("/inventory-adjustments?locationId="+locationId+"&n="+catalogResult(result,"evidence"));
    }

    if(url.pathname==="/catalog"&&req.method==="GET"){
      return html(await catalogPage(url,session));
    }

    if(url.pathname==="/catalog/products"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const cost=String(fd.get("cost")||"").trim();
      const result=await api("/v1/internal/catalog/products",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{
          name:String(fd.get("name")||"").trim(),
          category:String(fd.get("category")||"").trim(),
          brand:String(fd.get("brand")||"").trim(),
          imageUrl:String(fd.get("imageUrl")||"").trim()||null,
          status:String(fd.get("status")||"draft"),
          variants:[{
            sku:String(fd.get("sku")||"").trim(),
            price:Number(fd.get("price")||0),
            cost:cost?Number(cost):null,
            size:String(fd.get("size")||"").trim(),
            color:String(fd.get("color")||"").trim(),
            currency:"HNL",
            stock:Number(fd.get("stock")||0)
          }]
        }
      });
      return redirect("/catalog?n="+catalogResult(result,"created"));
    }

    const cps=url.pathname.match(/^\/catalog\/products\/(\d+)\/status$/);
    if(cps&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/catalog/products/"+Number(cps[1]),{
        method:"PATCH",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{status:String(fd.get("status")||"draft")}
      });
      return redirect("/catalog?n="+catalogResult(result,"updated"));
    }

    const cpi=url.pathname.match(/^\/catalog\/products\/(\d+)\/images$/);
    if(cpi&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/catalog/products/"+Number(cpi[1])+"/images",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{
          url:String(fd.get("url")||"").trim(),
          altText:String(fd.get("altText")||"").trim()||null
        }
      });
      return redirect("/catalog?n="+catalogResult(result,"image"));
    }

    const cpv=url.pathname.match(/^\/catalog\/products\/(\d+)\/variants$/);
    if(cpv&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const cost=String(fd.get("cost")||"").trim();
      const result=await api("/v1/internal/catalog/products/"+Number(cpv[1])+"/variants",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{
          sku:String(fd.get("sku")||"").trim(),
          price:Number(fd.get("price")||0),
          cost:cost?Number(cost):null,
          size:String(fd.get("size")||"").trim(),
          color:String(fd.get("color")||"").trim(),
          currency:"HNL",
          stock:Number(fd.get("stock")||0)
        }
      });
      return redirect("/catalog?n="+catalogResult(result,"variant"));
    }

    const csv=url.pathname.match(/^\/catalog\/variants\/(\d+)\/stock$/);
    if(csv&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/catalog/variants/"+Number(csv[1])+"/stock",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{quantity:Number(fd.get("quantity")||0)}
      });
      return redirect("/catalog?n="+catalogResult(result,"stock"));
    }

    const orderStatus=url.pathname.match(/^\/orders\/(\d+)\/status$/);
    if(orderStatus&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/orders/"+Number(orderStatus[1])+"/status",{
        method:"PATCH",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{status:String(fd.get("status")||""),reason:String(fd.get("reason")||"").trim()||null}
      });
      return redirect("/orders?n="+catalogResult(result,"action"));
    }

    if(url.pathname==="/customers"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/customers",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{displayName:String(fd.get("displayName")||"").trim(),customerType:String(fd.get("customerType")||"PERSON")}
      });
      return redirect("/customers?n="+catalogResult(result,"created"));
    }

    if(url.pathname==="/suppliers"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/suppliers",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{
          name:String(fd.get("name")||"").trim(),
          contactName:String(fd.get("contactName")||"").trim()||null,
          phone:String(fd.get("phone")||"").trim()||null,
          email:String(fd.get("email")||"").trim()||null,
          countryCode:String(fd.get("countryCode")||"HN").trim().toUpperCase(),
          defaultCurrency:String(fd.get("defaultCurrency")||"HNL").trim().toUpperCase()
        }
      });
      return redirect("/suppliers?n="+catalogResult(result,"created"));
    }

    const inviteSupplier=url.pathname.match(/^\/suppliers\/(\d+)\/invite$/);
    if(inviteSupplier&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/vendor-invitations",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{supplierId:Number(inviteSupplier[1]),email:String(fd.get("email")||"").trim()||null}
      });
      if(!result.response?.ok)return redirect("/suppliers?n=error");
      const token=String(result.body?.invitation?.token||"");
      const link=url.origin+"/vendor/accept?token="+encodeURIComponent(token);
      return redirect("/suppliers?invite="+encodeURIComponent(link));
    }

    const vendorReview=url.pathname.match(/^\/vendor-review\/(\d+)\/(approve|reject)$/);
    if(vendorReview&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const action=vendorReview[2]==="approve"?"APPROVE":"REJECT";
      const result=await api("/v1/internal/vendor-products/"+Number(vendorReview[1])+"/review",{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{decision:action,note:String(fd.get("note")||"").trim()||null}
      });
      return redirect("/vendor-review?n="+catalogResult(result,"action"));
    }

    if(url.pathname==="/purchases"&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);

      const toMinor=(v:FormDataEntryValue|null)=>Math.max(0,Math.round((Number(v)||0)*100));
      const result=await api("/v1/internal/procurement/purchase-orders",{
        method:"POST",
        cookieHeader:session.cookieHeader,
        csrf:session.csrf,
        idempotencyKey:"cc-po-"+crypto.randomUUID(),
        body:{
          supplierId:Number(fd.get("supplierId")),
          destinationLocationId:Number(fd.get("destinationLocationId")),
          currency:"HNL",
          supplierReference:String(fd.get("supplierReference")||"").trim()||null,
          shippingEstimateMinor:toMinor(fd.get("shippingEstimate")),
          taxEstimateMinor:toMinor(fd.get("taxEstimate")),
          otherCostsMinor:toMinor(fd.get("otherCosts")),
          items:[{
            variantId:Number(fd.get("variantId")),
            quantityOrdered:Number(fd.get("quantityOrdered")),
            unitCostMinor:toMinor(fd.get("unitCost")),
            supplierSku:String(fd.get("supplierSku")||"").trim()||null,
            originCountryCode:String(fd.get("originCountryCode")||"").trim().toUpperCase()||null
          }]
        }
      });
      return redirect("/purchases?n="+catalogResult(result,"created"));
    }

    const receivePurchase=url.pathname.match(/^\/purchases\/(\d+)\/receive$/);
    if(receivePurchase&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);

      const items:any[]=[];
      for(const [key,value] of fd.entries()){
        const match=String(key).match(/^qty_(\d+)$/);
        if(!match)continue;
        const quantity=Number(value);
        if(Number.isSafeInteger(quantity)&&quantity>0){
          items.push({purchaseOrderItemId:Number(match[1]),quantityReceived:quantity});
        }
      }
      if(!items.length)return redirect("/purchases?n=error");

      const result=await api("/v1/internal/procurement/purchase-orders/"+Number(receivePurchase[1])+"/receipts",{
        method:"POST",
        cookieHeader:session.cookieHeader,
        csrf:session.csrf,
        idempotencyKey:"cc-gr-"+crypto.randomUUID(),
        body:{
          supplierDeliveryReference:String(fd.get("supplierDeliveryReference")||"").trim()||null,
          items
        }
      });
      return redirect("/purchases?n="+catalogResult(result,"action"));
    }

    const purchaseAction=url.pathname.match(/^\/purchases\/(\d+)\/(approve|order|cancel)$/);
    if(purchaseAction&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/procurement/purchase-orders/"+Number(purchaseAction[1])+"/"+purchaseAction[2],{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,body:{}
      });
      return redirect("/purchases?n="+catalogResult(result,"action"));
    }

    const fulfillmentStatus=url.pathname.match(/^\/fulfillment\/(\d+)\/status$/);
    if(fulfillmentStatus&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/fulfillments/"+Number(fulfillmentStatus[1])+"/status",{
        method:"PATCH",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{status:String(fd.get("status")||""),reason:String(fd.get("reason")||"").trim()||null}
      });
      return redirect("/fulfillment?n="+catalogResult(result,"action"));
    }

    const returnAction=url.pathname.match(/^\/returns\/(\d+)\/(approve|reject|complete)$/);
    if(returnAction&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);
      const result=await api("/v1/internal/returns/"+Number(returnAction[1])+"/"+returnAction[2],{
        method:"POST",cookieHeader:session.cookieHeader,csrf:session.csrf,
        body:{reason:String(fd.get("reason")||"").trim()||null}
      });
      return redirect("/returns?n="+catalogResult(result,"action"));
    }

    if(url.pathname==="/export/inquiries.csv"&&req.method==="GET"){
      const result=await api("/v1/internal/inquiries/export",{
        cookieHeader:session.cookieHeader
      });
      if(result.response?.status===403)return html("Permiso insuficiente",403);
      if(!result.response?.ok)return html("No se pudo exportar",502);

      const rows=Array.isArray(result.body?.data)?result.body.data:[];
      const head=["id","kind","status","priority","name","contact","country","product","created_at"];
      const csv=[
        head.join(","),
        ...rows.map((r:any)=>[
          r.id,r.kind,r.status,r.priority,r.name,r.contact,
          r.country_code,r.product_name,r.created_at
        ].map(csvCell).join(","))
      ].join("\n");

      return new Response(csv,{
        headers:securityHeaders({
          "content-type":"text/csv; charset=utf-8",
          "content-disposition":"attachment; filename=mr-intenciones.csv",
          "cache-control":"no-store"
        })
      });
    }

    const opportunityMatch=url.pathname.match(/^\/inquiries\/(\d+)\/opportunity$/);
    if(opportunityMatch&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);

      const result=await api(
        `/v1/internal/inquiries/${Number(opportunityMatch[1])}/opportunity`,
        {
          method:"POST",
          cookieHeader:session.cookieHeader,
          csrf:session.csrf,
          body:{}
        }
      );

      if(result.response?.status===403)return html("Permiso insuficiente",403);
      if(result.response?.status===404)return html("Solicitud no encontrada",404);
      if(!result.response?.ok)return html("No se pudo crear la oportunidad",502);
      return redirect("/");
    }

    const updateMatch=url.pathname.match(/^\/inquiries\/(\d+)\/update$/);
    if(updateMatch&&req.method==="POST"){
      const fd=await req.formData();
      if(!requireFormCsrf(fd,session))return html("Solicitud inválida",403);

      const status=String(fd.get("status")||"").slice(0,32);
      if(!statuses.has(status))return html("Estado inválido",400);

      const priority=Math.min(
        3,
        Math.max(0,Number(fd.get("priority")||0)||0)
      );
      const assignedTo=String(fd.get("assigned_to")||"").trim().slice(0,120);
      const internalNotes=String(fd.get("internal_notes")||"").trim().slice(0,4000);

      const result=await api(`/v1/internal/inquiries/${Number(updateMatch[1])}`,{
        method:"PATCH",
        cookieHeader:session.cookieHeader,
        csrf:session.csrf,
        body:{
          status,
          priority,
          assignedTo:assignedTo||null,
          internalNotes:internalNotes||null
        }
      });

      if(result.response?.status===403)return html("Permiso insuficiente",403);
      if(result.response?.status===404)return html("Solicitud no encontrada",404);
      if(!result.response?.ok)return html("No se pudo guardar",502);
      return redirect("/");
    }

    return html("No encontrado",404);
  }
});
