// Servidor local que ejecuta function.ts con un shim mínimo de Bun (node dev-server.js [puerto]). Recarga function.ts en cada petición.
const http=require('http'),fs=require('fs'),vm=require('vm');
const port=+process.argv[2]||4173;
function load(){let handler;const Bun={env:process.env,serve:o=>{handler=o.fetch}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/function.ts','utf8'),{Bun,Response,URL,Buffer,Number,JSON});return handler}
http.createServer(async(q,r)=>{const res=await load()(new Request('http://x'+q.url));r.writeHead(res.status,Object.fromEntries(res.headers));r.end(Buffer.from(await res.arrayBuffer()))}).listen(port,()=>console.log('http://localhost:'+port));
