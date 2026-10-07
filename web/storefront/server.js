// Servidor estático del storefront (sin dependencias). Railway: root dir web/storefront, `npm start`.
const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname,port=Number(process.env.PORT||3000);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const allowed=p=>p==='/index.html'||p==='/crown3d.js'||p.startsWith('/assets/');
http.createServer((req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  if(p==='/health'){res.end('ok');return}
  const file=allowed(p)?path.join(root,p):null;
  if(file&&file.startsWith(root)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':p==='/index.html'?'no-store':'public, max-age=300'});
    fs.createReadStream(file).pipe(res);return}
  res.writeHead(200,{'content-type':types['.html'],'cache-control':'no-store'});
  fs.createReadStream(path.join(root,'index.html')).pipe(res);
}).listen(port,()=>console.log('storefront en :'+port));
