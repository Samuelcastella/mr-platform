// Prueba de humo del storefront (solo Node, sin dependencias): node test/smoke.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), http = require('http');
const root = path.join(__dirname, '..'), port = 4590 + Math.floor(Math.random() * 200), apiPort = port + 700, base = 'http://127.0.0.1:' + port;
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL', m); } else console.log('ok  ', m); };
const get = (p, o) => fetch(base + p, o);

(async () => {
  const fakeApi = http.createServer((req,res)=>{ if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return} if(req.url==='/v1/inquiries'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let j={};try{j=JSON.parse(body)}catch{};res.writeHead(j.kind&&j.name&&j.contact?201:400,{'content-type':'application/json'});res.end(JSON.stringify(j.kind&&j.name&&j.contact?{ok:true,inquiry:{id:77,token:'tok-demo-77',status:'new',createdAt:new Date().toISOString()}}:{error:'invalid'}))});return} if(req.url.startsWith('/v1/inquiries/77?token=tok-demo-77')&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({inquiry:{id:77,kind:'supplier',status:'reviewing',updatedAt:new Date().toISOString()}}));return} if(req.url==='/v1/events'&&req.method==='POST'){res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return} if(req.url.startsWith('/v1/products')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[]}));return} res.writeHead(404);res.end() }); await new Promise(resolve=>fakeApi.listen(apiPort,'127.0.0.1',resolve));
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), CATALOG_API_URL: 'http://127.0.0.1:'+apiPort }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { await get('/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const home = await get('/');
    const html = await home.text();
    ok(home.status === 200 && /text\/html/.test(home.headers.get('content-type')), 'GET / → 200 html');
    ok(/<title>MR עדולם/.test(html), 'título de marca');
    ok(/<meta name="description"/.test(html) && /og:image/.test(html), 'meta description y Open Graph');
    ok(home.headers.get('x-content-type-options') === 'nosniff' && /default-src 'self'/.test(home.headers.get('content-security-policy') || ''), 'cabeceras de seguridad (nosniff + CSP)');
    ok((await (await get('/health')).text()) === 'ok', '/health → ok');

    // el script inline debe parsear (el despliegue anterior lo rompió con comillas sin escapar)
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    let parses = true; try { new vm.Script(m[1]); } catch (e) { parses = false; console.error(e.message); }
    ok(parses, 'script inline sin errores de sintaxis');

    // crown3d.js es un módulo ES
    const tmp = path.join(os.tmpdir(), 'crown3d-check.mjs');
    fs.writeFileSync(tmp, fs.readFileSync(path.join(root, 'crown3d.js')));
    ok(spawnSync(process.execPath, ['--check', tmp]).status === 0, 'crown3d.js sintaxis válida');

    // todos los assets referenciados responden
    const refs = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(x => x[1]).filter(x => /^\/(assets\/|manifest|crown3d)/.test(x)))];
    for (const r of refs) ok((await get(r)).status === 200, 'asset ' + r);
    for (const r of ['/assets/crown-albedo.webp', '/assets/crown-normal.webp', '/assets/crown-shapes.json', '/robots.txt']) ok((await get(r)).status === 200, 'asset ' + r);

    // manifest PWA válido y con iconos existentes
    const man = await (await get('/manifest.webmanifest')).json();
    ok(man.name && man.icons.length >= 3, 'manifest válido');
    for (const i of man.icons) ok((await get(i.src)).status === 200, 'icono PWA ' + i.src);

    // compresión
    const gz = await get('/', { headers: { 'accept-encoding': 'gzip' } });
    ok(gz.headers.get('content-encoding') === 'gzip' || gz.headers.get('content-encoding') === 'br', 'respuesta comprimida');
    ok((await (await get('/', { headers: { 'accept-encoding': 'gzip' } })).text()).includes('Descubre') && html.includes('function brandView()') && html.includes('function requestsView()') && html.includes('function trackEvent('), 'Commerce First + marca + solicitudes + analytics presentes');

    // etag / 304
    const et = home.headers.get('etag');
    ok((await get('/', { headers: { 'if-none-match': et } })).status === 304, 'ETag → 304');

    // Readiness y proxy de intención pública
    ok((await get('/ready')).status === 200, '/ready con catálogo saludable → 200');
    const inquiry = await get('/api/v1/inquiries', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({kind:'supplier',name:'Proveedor Demo',contact:'demo@example.com',message:'Catálogo de prueba'}) });
    const inquiryBody = await inquiry.json();
    ok(inquiry.status === 201 && inquiryBody.inquiry?.id === 77 && inquiryBody.inquiry?.token === 'tok-demo-77', 'POST /api/v1/inquiries → proxy funcional con token público');
    const tracked = await get('/api/v1/inquiries/77?token=tok-demo-77');
    const trackedBody = await tracked.json();
    ok(tracked.status === 200 && trackedBody.inquiry?.status === 'reviewing', 'GET /api/v1/inquiries/:id?token → seguimiento funcional');
    const eventResp = await get('/api/v1/events', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({eventName:'cta_click',sessionId:'s-demo',route:'#/connect',metadata:{intent:'supplier'}}) });
    ok(eventResp.status === 201, 'POST /api/v1/events → analytics funcional');
    ok((await get('/api/v1/products')).status === 200, 'GET /api/v1/products → proxy funcional');
    ok((await get('/', { method: 'POST' })).status === 405, 'POST → 405');
    const trav = await (await get('/assets/..%2fserver.js')).text();
    ok(!trav.includes('createServer'), 'path traversal no expone server.js');
    ok((await get('/ruta/inexistente')).status === 200, 'SPA fallback para rutas desconocidas');
  } finally { srv.kill(); await new Promise(resolve=>fakeApi.close(resolve)); }
  if (failed) { console.error(failed + ' fallo(s)'); process.exit(1); }
  console.log('Todo correcto');
})();
