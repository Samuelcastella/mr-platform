// Prueba de humo del storefront (solo Node, sin dependencias): node test/smoke.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'), port = 4590 + Math.floor(Math.random() * 300), base = 'http://127.0.0.1:' + port;
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL', m); } else console.log('ok  ', m); };
const get = (p, o) => fetch(base + p, o);

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), CATALOG_API_URL: '' }, stdio: 'ignore' });
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
    ok((await (await get('/', { headers: { 'accept-encoding': 'gzip' } })).text()).includes('Una tienda'), 'contenido íntegro tras descompresión');

    // etag / 304
    const et = home.headers.get('etag');
    ok((await get('/', { headers: { 'if-none-match': et } })).status === 304, 'ETag → 304');

    // API sin configurar, método no permitido y path traversal
    ok((await get('/api/v1/products')).status === 503, '/api sin CATALOG_API_URL → 503');
    ok((await get('/', { method: 'POST' })).status === 405, 'POST → 405');
    const trav = await (await get('/assets/..%2fserver.js')).text();
    ok(!trav.includes('createServer'), 'path traversal no expone server.js');
    ok((await get('/ruta/inexistente')).status === 200, 'SPA fallback para rutas desconocidas');
  } finally { srv.kill(); }
  if (failed) { console.error(failed + ' fallo(s)'); process.exit(1); }
  console.log('Todo correcto');
})();
