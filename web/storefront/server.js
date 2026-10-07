// Servidor estático del storefront (sin dependencias). Railway: root dir web/storefront, `npm start`.
const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname,port=Number(process.env.PORT||3000);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const allowed=p=>p==='/index.html'||p==='/crown3d.js'||p.startsWith('/assets/');
const api=(process.env.CATALOG_API_URL||'').split('/').filter((x,i,a)=>i<a.length-1||x).join('/');
http.createServer(async(req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  if(p==='/health'){res.end('ok');return}
  if(p.startsWith('/api/')){
    if(!api||req.method!=='GET'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"catalog unavailable"}');return}
    try{const r=await fetch(api+p.slice(4)+new URL(req.url,'http://x').search,{signal:AbortSignal.timeout(5000)});res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json','cache-control':'no-store'});res.end(Buffer.from(await r.arrayBuffer()))}
    catch{res.writeHead(502,{'content-type':'application/json'});res.end('{"error":"catalog unreachable"}')}
    return}
  const file=allowed(p)?path.join(root,p):null;
  if(file&&file.startsWith(root)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':p==='/index.html'?'no-store':'public, max-age=300'});
    fs.createReadStream(file).pipe(res);return}
  res.writeHead(200,{'content-type':types['.html'],'cache-control':'no-store'});
  fs.createReadStream(path.join(root,'index.html')).pipe(res);
}).listen(port,()=>console.log('storefront en :'+port));
