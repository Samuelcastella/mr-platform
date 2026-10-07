// Servidor estático del storefront (sin dependencias).
// Railway: root dir web/storefront, `npm start`.
//
// /health = liveness del proceso.
// /ready  = readiness del storefront + Catalog API.
// /api/*  = proxy de solo lectura hacia Catalog API; el navegador no recibe
//           la URL interna ni credenciales de servicios.
const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname,port=Number(process.env.PORT||3000);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const allowed=p=>p==='/index.html'||p==='/crown3d.js'||p.startsWith('/assets/');
const api=(process.env.CATALOG_API_URL||'').replace(/\/+$/,'');

const json=(res,status,body)=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(body));
};

async function catalogHealth(){
  if(!api) return {ok:false,status:503,error:'CATALOG_API_URL not configured'};
  try{
    const r=await fetch(api+'/health',{signal:AbortSignal.timeout(3000)});
    if(!r.ok) return {ok:false,status:502,error:'catalog health returned '+r.status};
    const body=await r.json().catch(()=>({}));
    return {ok:body?.ok!==false,status:200,upstream:body};
  }catch(err){
    return {ok:false,status:502,error:'catalog unreachable'};
  }
}

http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  const p=decodeURIComponent(url.pathname);

  if(p==='/health'){
    return json(res,200,{ok:true,service:'MR עדולם storefront'});
  }

  if(p==='/ready'){
    const upstream=await catalogHealth();
    return json(res,upstream.ok?200:upstream.status,{
      ok:upstream.ok,
      service:'MR עדולם storefront',
      catalog:upstream.ok?'connected':'unavailable'
    });
  }

  if(p.startsWith('/api/')){
    if(!api||req.method!=='GET'){
      return json(res,503,{error:'catalog unavailable'});
    }
    try{
      const target=api+p.slice(4)+url.search;
      const r=await fetch(target,{signal:AbortSignal.timeout(5000)});
      res.writeHead(r.status,{
        'content-type':r.headers.get('content-type')||'application/json',
        'cache-control':'no-store'
      });
      res.end(Buffer.from(await r.arrayBuffer()));
    }catch{
      return json(res,502,{error:'catalog unreachable'});
    }
    return;
  }

  const file=allowed(p)?path.join(root,p):null;
  if(file&&file.startsWith(root)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
    res.writeHead(200,{
      'content-type':types[path.extname(file)]||'application/octet-stream',
      'cache-control':p==='/index.html'?'no-store':'public, max-age=300'
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  res.writeHead(200,{'content-type':types['.html'],'cache-control':'no-store'});
  fs.createReadStream(path.join(root,'index.html')).pipe(res);
}).listen(port,()=>console.log('storefront en :'+port));
