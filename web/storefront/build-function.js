// Genera function.ts (Railway Function / Bun) a partir de index.html + crown3d.js + assets/.
// Uso: node build-function.js  →  function.ts   (sin sintaxis TS: también corre en node con un shim de Bun)
const fs=require('fs'),path=require('path');
const dir=__dirname;
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const files={};
const types={'.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const add=(url,file)=>{const ext=path.extname(file),buf=fs.readFileSync(file),text=ext==='.js'||ext==='.json'||ext==='.svg';files[url]=[types[ext],text?buf.toString('utf8'):buf.toString('base64'),text?0:1]};
add('/crown3d.js',path.join(dir,'crown3d.js'));
for(const f of fs.readdirSync(path.join(dir,'assets')))add('/assets/'+f,path.join(dir,'assets',f));
const out=`const html = ${JSON.stringify(html)};
const files = ${JSON.stringify(files)};
Bun.serve({port:Number(Bun.env.PORT||3000),fetch(req){let u=new URL(req.url);if(u.pathname==='/health')return new Response('ok');const f=files[u.pathname];if(f)return new Response(f[2]?Buffer.from(f[1],'base64'):f[1],{headers:{'content-type':f[0],'cache-control':'public, max-age=300'}});return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})}});
`;
fs.writeFileSync(path.join(dir,'function.ts'),out);
console.log('function.ts',(out.length/1024).toFixed(0)+'KB',Object.keys(files).length,'archivos');
