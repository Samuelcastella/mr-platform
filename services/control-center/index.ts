const API_BASE = (Bun.env.CATALOG_API_URL || "").replace(/\/+$/, "");
const SESSION_COOKIE = "mrstaff";
const CSRF_COOKIE = "mrcc_csrf";
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
    "content-security-policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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
    body?:unknown;
  }={}
){
  if(!API_BASE) return {response:null,body:{error:"api_not_configured"} as any};
  const headers:Record<string,string>={"accept":"application/json"};
  if(options.cookieHeader)headers.cookie=options.cookieHeader;
  if(options.csrf)headers["x-csrf-token"]=options.csrf;
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
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MR עדולם Control Center</title><style>${css}</style></head><body><header><b>MR עדולם · Control Center</b><span class="user">${esc(session.actor)}</span><form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(session.csrf)}"><button class="ghost">Salir</button></form></header><main class="wrap">${content}</main></body></html>`;
}

function loginPage(message=""){
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso · MR עדולם</title><style>${css}</style></head><body><main class="login"><div class="eyebrow">Acceso privado</div><h1>MR עדולם Control Center</h1><p class="meta">Usa tu identidad individual de StaffUser. Las acciones quedan vinculadas a tu usuario y permisos.</p>${message?`<div class="notice">${esc(message)}</div>`:""}<form method="post" action="/login"><label>Correo<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Contraseña<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button>Entrar</button></form></main></body></html>`;
}

function setupPage(){
  return loginPage("El Control Center requiere CATALOG_API_URL para usar la identidad de StaffUser del Commerce Core.");
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

    if(url.pathname==="/login"&&req.method==="GET"){
      const existing=await readSession(req);
      return existing?redirect("/"):html(loginPage());
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
