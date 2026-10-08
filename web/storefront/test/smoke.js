// Prueba de humo del storefront (solo Node, sin dependencias): node test/smoke.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), http = require('http');
const root = path.join(__dirname, '..'), port = 4590 + Math.floor(Math.random() * 200), apiPort = port + 700, base = 'http://127.0.0.1:' + port;
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL', m); } else console.log('ok  ', m); };
const get = (p, o) => fetch(base + p, o);

(async () => {
  const fakeApi = http.createServer((req,res)=>{ if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return} if(req.url==='/v1/inquiries'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let j={};try{j=JSON.parse(body)}catch{};res.writeHead(j.kind&&j.name&&j.contact?201:400,{'content-type':'application/json'});res.end(JSON.stringify(j.kind&&j.name&&j.contact?{ok:true,inquiry:{id:77,token:'tok-demo-77',status:'new',createdAt:new Date().toISOString()}}:{error:'invalid'}))});return} if(req.url.startsWith('/v1/inquiries/77?token=tok-demo-77')&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({inquiry:{id:77,kind:'supplier',status:'reviewing',updatedAt:new Date().toISOString()}}));return} if(req.url==='/v1/events'&&req.method==='POST'){res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return} if(req.url==='/v1/orders'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let j={};try{j=JSON.parse(body)}catch{};let good=req.headers['idempotency-key']==='smoke-order-1'&&j.items?.[0]?.variantId===11;res.writeHead(good?201:400,{'content-type':'application/json'});res.end(JSON.stringify(good?{order:{id:88,orderNumber:'MR-SMOKE-88',token:'order-token-88',status:'PENDING_CONFIRMATION',currency:'HNL',grandTotalMinor:32000,createdAt:new Date().toISOString()}}:{error:'invalid'}))});return} if(req.url==='/v1/orders/88/confirm?token=order-token-88'&&req.method==='POST'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({order:{id:88,orderNumber:'MR-SMOKE-88',token:'order-token-88',status:'CONFIRMED',currency:'HNL',grandTotalMinor:32000,createdAt:new Date().toISOString()}}));return} if(req.url==='/v1/fulfillment/options?department=Cort%C3%A9s'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({department:'Cortés',options:[{type:'LOCAL_DELIVERY',provider:'MR',shippingMinor:6000,currency:'HNL',etaMinDays:1,etaMaxDays:2,quoteRequired:false}]}));return} if(req.url==='/v1/fulfillments'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let j={};try{j=JSON.parse(body)}catch{};let good=req.headers['idempotency-key']==='smoke-fulfillment-1'&&j.orderId===88&&j.orderToken==='order-token-88'&&j.type==='LOCAL_DELIVERY'&&j.department==='Cortés'&&j.shippingMinor==null;res.writeHead(good?201:400,{'content-type':'application/json'});res.end(JSON.stringify(good?{fulfillment:{id:77,token:'fulfillment-token-77',orderId:88,orderNumber:'MR-SMOKE-88',orderStatus:'PENDING_CONFIRMATION',type:'LOCAL_DELIVERY',status:'PENDING',provider:'MR',destination:{department:'Cortés',municipality:'Puerto Cortés'},quote:{shippingMinor:6000,currency:'HNL',etaMinDays:1,etaMaxDays:2},events:[{eventType:'FULFILLMENT_CREATED',status:'PENDING'}]}}:{error:'invalid'}))});return} if(req.url==='/v1/fulfillments/77?token=fulfillment-token-77'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({fulfillment:{id:77,token:'fulfillment-token-77',orderId:88,type:'LOCAL_DELIVERY',status:'PENDING',destination:{department:'Cortés'},quote:{shippingMinor:6000,currency:'HNL',etaMinDays:1,etaMaxDays:2},events:[{eventType:'FULFILLMENT_CREATED',status:'PENDING'}]}}));return} if(req.url==='/v1/checkouts'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let j={};try{j=JSON.parse(body)}catch{};let good=req.headers['idempotency-key']==='smoke-checkout-1'&&j.orderId===88&&j.orderToken==='order-token-88'&&j.paymentMethod==='CASH_ON_DELIVERY'&&j.amountMinor==null;res.writeHead(good?201:400,{'content-type':'application/json'});res.end(JSON.stringify(good?{checkout:{id:99,token:'checkout-token-99',orderId:88,orderNumber:'MR-SMOKE-88',orderStatus:'CONFIRMED',status:'COMPLETED',paymentMethod:'CASH_ON_DELIVERY',currency:'HNL',amountMinor:38000,payment:{id:111,provider:'OFFLINE',method:'CASH_ON_DELIVERY',status:'PENDING',amountMinor:38000,currency:'HNL'}}}:{error:'invalid'}))});return} if(req.url.startsWith('/v1/products')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:1,name:'Camiseta',slug:'camiseta',category:'Ropa',brand:'MR',status:'active',price:320,currency:'HNL',stock:3,variants:[{id:11,sku:'CAM-M-NEG',barcode:null,size:'M',color:'Negro',price:320,currency:'HNL',available:3}]}]}));return} res.writeHead(404);res.end() }); await new Promise(resolve=>fakeApi.listen(apiPort,'127.0.0.1',resolve));
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
    const compressedHome = await (await get('/', { headers: { 'accept-encoding': 'gzip' } })).text();
    ok(
      compressedHome.includes('Encuentra') &&
      html.includes('function brandView()') &&
      html.includes('function requestsView()') &&
      html.includes('function trackEvent(') &&
      !html.includes('La boutique es el inicio') &&
      !/Private label/i.test(html),
      'storefront product-first + marca breve + solicitudes + analytics presentes'
    );

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
    const productsResp = await get('/api/v1/products?status=active');
    const productsBody = await productsResp.json();
    ok(productsResp.status === 200, 'GET /api/v1/products → proxy funcional');
    ok(productsBody.data?.[0]?.stock === 3 && productsBody.data?.[0]?.variants?.[0]?.sku === 'CAM-M-NEG', 'catálogo conserva stock y variantes autoritativas');
    ok(html.includes('const authoritativeStock={}') && !html.includes('localStorage.mrStock') && html.includes('variants:Array.isArray(x.variants)'), 'storefront usa autoridad de stock/variantes del API');
    ok(!html.includes('localStorage.mrOrders') && html.includes('function orderRefs()') && html.includes("fetch('/api/v1/orders'"), 'storefront usa órdenes server-side y solo guarda referencias');
    const orderResp = await get('/api/v1/orders', { method:'POST', headers:{'content-type':'application/json','idempotency-key':'smoke-order-1'}, body:JSON.stringify({channel:'WEB',items:[{variantId:11,quantity:1}]}) });
    const orderBody = await orderResp.json();
    ok(orderResp.status === 201 && orderBody.order?.id === 88, 'POST /api/v1/orders → proxy funcional con Idempotency-Key');
    const confirmResp = await get('/api/v1/orders/88/confirm?token=order-token-88', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    const confirmBody = await confirmResp.json();
    ok(confirmResp.status === 200 && confirmBody.order?.status === 'CONFIRMED', 'POST confirm order → proxy funcional');
    const deliveryOptions = await get('/api/v1/fulfillment/options?department='+encodeURIComponent('Cortés'));
    const deliveryOptionsBody = await deliveryOptions.json();
    ok(deliveryOptions.status === 200 && deliveryOptionsBody.options?.[0]?.shippingMinor === 6000 && deliveryOptionsBody.options?.[0]?.etaMaxDays === 2, 'GET fulfillment/options → tarifa y ETA por departamento');
    const fulfillmentResp = await get('/api/v1/fulfillments', { method:'POST', headers:{'content-type':'application/json','idempotency-key':'smoke-fulfillment-1'}, body:JSON.stringify({orderId:88,orderToken:'order-token-88',type:'LOCAL_DELIVERY',department:'Cortés',municipality:'Puerto Cortés',addressLine:'Dirección smoke',addressReference:'Referencia smoke',recipientName:'Cliente Smoke',recipientPhone:'9999-0000'}) });
    const fulfillmentBody = await fulfillmentResp.json();
    ok(fulfillmentResp.status === 201 && fulfillmentBody.fulfillment?.id === 77 && fulfillmentBody.fulfillment?.quote?.shippingMinor === 6000, 'POST /api/v1/fulfillments → snapshot logístico server-side');
    const trackedFulfillment = await get('/api/v1/fulfillments/77?token=fulfillment-token-77');
    const trackedFulfillmentBody = await trackedFulfillment.json();
    ok(trackedFulfillment.status === 200 && trackedFulfillmentBody.fulfillment?.events?.length === 1, 'GET fulfillment → tracking público por token');
    const checkoutResp = await get('/api/v1/checkouts', { method:'POST', headers:{'content-type':'application/json','idempotency-key':'smoke-checkout-1'}, body:JSON.stringify({orderId:88,orderToken:'order-token-88',paymentMethod:'CASH_ON_DELIVERY'}) });
    const checkoutBody = await checkoutResp.json();
    ok(checkoutResp.status === 201 && checkoutBody.checkout?.payment?.status === 'PENDING' && checkoutBody.checkout?.amountMinor === 38000, 'POST /api/v1/checkouts → total incluye entrega server-side y COD PENDING');
    ok(html.includes('CASH_ON_DELIVERY') && html.includes("fetch('/api/v1/checkouts'") && html.includes("fetch('/api/v1/fulfillments'") && html.includes('HN_DEPARTMENTS') && html.includes('Cortés'), 'storefront integra checkout, fulfillment y selector de departamentos');
    ok((await get('/api/v1/internal/orders')).status === 404, 'proxy bloquea rutas internas del Commerce Core');
    ok((await get('/', { method: 'POST' })).status === 405, 'POST → 405');
    const trav = await (await get('/assets/..%2fserver.js')).text();
    ok(!trav.includes('createServer'), 'path traversal no expone server.js');
    ok((await get('/ruta/inexistente')).status === 200, 'SPA fallback para rutas desconocidas');
  } finally { srv.kill(); await new Promise(resolve=>fakeApi.close(resolve)); }
  if (failed) { console.error(failed + ' fallo(s)'); process.exit(1); }
  console.log('Todo correcto');
})();
