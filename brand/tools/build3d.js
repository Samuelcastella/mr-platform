const sharp=require('sharp'),fs=require('fs');
const OUT='C:/Users/SEMSEproject/mr-platform/web/storefront/assets/';
const W=1160,H=668;
// ---------- shapes from potrace svg ----------
const d=fs.readFileSync('out/crown-silhouette.svg','utf8').match(/ d="([^"]+)"/)[1];
const toks=d.match(/[MCLZ]|-?\d*\.?\d+/g);
let i=0,rings=[],cur=null,pos=[0,0];
const num=()=>parseFloat(toks[i++]);
function bez(p0,p1,p2,p3,n=7){const o=[];for(let k=1;k<=n;k++){const t=k/n,u=1-t;o.push([u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]])}return o}
let cmd=null;
while(i<toks.length){
  if(/[MCLZ]/.test(toks[i]))cmd=toks[i++];
  if(cmd==='M'){cur=[];rings.push(cur);pos=[num(),num()];cur.push(pos);cmd='L'}
  else if(cmd==='L'){pos=[num(),num()];cur.push(pos)}
  else if(cmd==='C'){const p1=[num(),num()],p2=[num(),num()],p3=[num(),num()];cur.push(...bez(pos,p1,p2,p3));pos=p3}
  else if(cmd==='Z'){cmd=null}
}
const area=r=>{let a=0;for(let k=0;k<r.length;k++){const p=r[k],q=r[(k+1)%r.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2};
function simplify(pts,eps){ // Douglas-Peucker on closed ring
  const dp=(a,lo,hi,keep)=>{let md=0,idx=-1;const A=a[lo],B=a[hi];for(let k=lo+1;k<hi;k++){const dx=B[0]-A[0],dy=B[1]-A[1],L=Math.hypot(dx,dy)||1e-9;const dist=Math.abs(dy*(a[k][0]-A[0])-dx*(a[k][1]-A[1]))/L;if(dist>md){md=dist;idx=k}}
    if(md>eps){keep[idx]=1;dp(a,lo,idx,keep);dp(a,idx,hi,keep)}};
  let far=0,fd=0;for(let k=1;k<pts.length;k++){const dd=Math.hypot(pts[k][0]-pts[0][0],pts[k][1]-pts[0][1]);if(dd>fd){fd=dd;far=k}}const a=pts.concat([pts[0]]),keep=new Uint8Array(a.length);keep[0]=keep[a.length-1]=keep[far]=1;dp(a,0,far,keep);dp(a,far,a.length-1,keep);
  return a.filter((_,k)=>keep[k]).slice(0,-1)}
const pip=(pt,r)=>{let c=false;for(let a=0,b=r.length-1;a<r.length;b=a++){if((r[a][1]>pt[1])!==(r[b][1]>pt[1])&&pt[0]<(r[b][0]-r[a][0])*(pt[1]-r[a][1])/(r[b][1]-r[a][1])+r[a][0])c=!c}return c};
// drop potrace's full-frame rectangle if present
rings=rings.filter(r=>Math.abs(area(r))<W*H*0.9);
const depth=rings.map((r,k)=>rings.reduce((n,q,j)=>n+(j!==k&&pip(r[0],q)?1:0),0));
const outers=rings.filter((r,k)=>depth[k]%2===0).map(r=>({o:simplify(r,0.5),h:[]}));
const holes=rings.filter((r,k)=>depth[k]%2===1);
for(const h of holes){const c=h[0];let best=null;for(const o of outers){if(pip(c,o.o)&&(!best||Math.abs(area(o.o))<Math.abs(area(best.o))))best=o}if(best)best.h.push(simplify(h,0.5))}
const r1=p=>Math.round(p*10)/10;
const shapes=outers.map(o=>({o:o.o.flat().map(r1),h:o.h.map(h=>h.flat().map(r1))}));
fs.writeFileSync(OUT+'crown-shapes.json',JSON.stringify({w:W,h:H,shapes}));
console.log('outers',outers.length,'holes',holes.length,'bytes',fs.statSync(OUT+'crown-shapes.json').size);
// ---------- textures ----------
(async()=>{
const {data}=await sharp('out/crown-ink.png').ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject:true}); // ink alpha 0..255
const mask=await sharp('out/crown-mask-smooth.png').greyscale().negate().raw().toBuffer();
// tone: 1 = bright metal, 0 = ink groove
const tone=new Float32Array(W*H);for(let k=0;k<W*H;k++)tone[k]=1-data[k]/255;
// blur height for normal
const hb=await sharp(Buffer.from(tone.map(v=>Math.round(v*255))),{raw:{width:W,height:H,channels:1}}).blur(2.0).raw().toBuffer();
const nrm=Buffer.alloc(W*H*3),S=2.4;
const hh=(x,y)=>hb[Math.min(H-1,Math.max(0,y))*W+Math.min(W-1,Math.max(0,x))]/255;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const dx=(hh(x+1,y)-hh(x-1,y))*S,dyi=(hh(x,y+1)-hh(x,y-1))*S;let nx=-dx,ny=dyi,nz=1;const l=Math.hypot(nx,ny,nz);nx/=l;ny/=l;nz/=l;const k=(y*W+x)*3;nrm[k]=Math.round((nx*.5+.5)*255);nrm[k+1]=Math.round((ny*.5+.5)*255);nrm[k+2]=Math.round((nz*.5+.5)*255)}
await sharp(nrm,{raw:{width:W,height:H,channels:3}}).webp({quality:90}).toFile(OUT+'crown-normal.webp');
// albedo (gray): grooves dark, keep a floor so ink isn't pure black on metal
const alb=Buffer.alloc(W*H);for(let k=0;k<W*H;k++){const t=tone[k];alb[k]=mask[k]?Math.round(255*(0.16+0.84*Math.pow(t,0.7))):128}
await sharp(alb,{raw:{width:W,height:H,channels:1}}).webp({quality:90}).toFile(OUT+'crown-albedo.webp');
for(const f of ['crown-normal.webp','crown-albedo.webp','crown-shapes.json'])console.log(f,fs.statSync(OUT+f).size);
})();
