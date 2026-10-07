// Servidor estático del storefront (sin dependencias). Railway: root dir web/storefront, `npm start`.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = __dirname, port = Number(process.env.PORT || 3000);
const api = (process.env.CATALOG_API_URL || '').split('/').filter((x, i, a) => i < a.length - 1 || x).join('/');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const compressible = new Set(['.html', '.js', '.json', '.svg', '.txt', '.webmanifest']);
const root_files = new Set(['/index.html', '/crown3d.js', '/robots.txt', '/manifest.webmanifest']);
const assetsDir = path.join(root, 'assets') + path.sep;
// Solo los archivos listados o los que, ya normalizada la ruta, quedan dentro de /assets (evita ..%2f)
const resolveAllowed = p => { const f = path.resolve(root, '.' + p); return (root_files.has(p) && f === path.join(root, p)) || (p.startsWith('/assets/') && f.startsWith(assetsDir)) ? f : null; };
const SEC = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};
const cache = new Map(); // ruta -> { buf, gz, br, type, etag }

function load(file, ext) {
  const st = fs.statSync(file), key = file + st.mtimeMs;
  if (cache.has(key)) return cache.get(key);
  const buf = fs.readFileSync(file);
  const e = { buf, type: types[ext] || 'application/octet-stream', etag: '"' + require('crypto').createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"' };
  if (compressible.has(ext) && buf.length > 512) { e.gz = zlib.gzipSync(buf, { level: 9 }); e.br = zlib.brotliCompressSync(buf); }
  cache.set(key, e);
  return e;
}

function send(req, res, e, cc) {
  const ae = String(req.headers['accept-encoding'] || '');
  const headers = { ...SEC, 'content-type': e.type, 'cache-control': cc, etag: e.etag, vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); res.end(); return; }
  let body = e.buf;
  if (e.br && /\bbr\b/.test(ae)) { headers['content-encoding'] = 'br'; body = e.br; }
  else if (e.gz && /\bgzip\b/.test(ae)) { headers['content-encoding'] = 'gzip'; body = e.gz; }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400, SEC); res.end('bad request'); return; }
  if (p === '/health') { res.writeHead(200, { ...SEC, 'cache-control': 'no-store' }); res.end('ok'); return; }
  if (p.startsWith('/api/')) {
    const h = { ...SEC, 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (!api || req.method !== 'GET') { res.writeHead(503, h); res.end('{"error":"catalog unavailable"}'); return; }
    try {
      const r = await fetch(api + p.slice(4) + new URL(req.url, 'http://x').search, { signal: AbortSignal.timeout(5000) });
      res.writeHead(r.status, { ...h, 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502, h); res.end('{"error":"catalog unreachable"}'); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...SEC, allow: 'GET, HEAD' }); res.end(); return; }
  const file = resolveAllowed(p);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    // index/JS sin caché larga (cambian con cada deploy); texturas y logos 7 días
    const cc = (p === '/index.html' || p === '/crown3d.js' || p === '/manifest.webmanifest') ? 'no-cache' : 'public, max-age=604800';
    send(req, res, load(file, ext), cc);
    return;
  }
  // SPA: cualquier otra ruta sirve index.html
  send(req, res, load(path.join(root, 'index.html'), '.html'), 'no-cache');
}).listen(port, () => console.log('storefront en :' + port));
