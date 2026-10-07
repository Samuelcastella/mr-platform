const sharp=require('sharp');
(async()=>{
const {data,info}=await sharp('out/crown-ink.png').ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height;
const T=+process.argv[2]||11, BANDY=+process.argv[3]||455;
let m=new Uint8Array(W*H);for(let i=0;i<W*H;i++)m[i]=data[i]>100?1:0;
// chamfer distance to ink for background pixels
const INF=1e9,d=new Float32Array(W*H);for(let i=0;i<W*H;i++)d[i]=m[i]?0:INF;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!d[i])continue;let v=d[i];if(x>0)v=Math.min(v,d[i-1]+1);if(y>0){v=Math.min(v,d[i-W]+1);if(x>0)v=Math.min(v,d[i-W-1]+1.414);if(x<W-1)v=Math.min(v,d[i-W+1]+1.414)}d[i]=v}
for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;let v=d[i];if(x<W-1)v=Math.min(v,d[i+1]+1);if(y<H-1){v=Math.min(v,d[i+W]+1);if(x<W-1)v=Math.min(v,d[i+W+1]+1.414);if(x>0)v=Math.min(v,d[i+W-1]+1.414)}d[i]=v}
const lab=new Int32Array(W*H);let id=0;const info2=[null];
for(let s=0;s<W*H;s++){if(m[s]||lab[s])continue;id++;let st=[s],n=0,b=0,mx=0,sy=0,sx=0;lab[s]=id;while(st.length){const p=st.pop();n++;const x=p%W,y=(p/W)|0;sy+=y;sx+=x;if(d[p]>mx)mx=d[p];if(x==0||y==0||x==W-1||y==H-1)b=1;for(const q of [p-1,p+1,p-W,p+W]){if(q<0||q>=W*H)continue;if((q==p-1&&x==0)||(q==p+1&&x==W-1))continue;if(!m[q]&&!lab[q]){lab[q]=id;st.push(q)}}}info2[id]={n,b,mx,cy:sy/n,cx:sx/n}}
const fill=new Uint8Array(id+1);let kept=[];
for(let l=1;l<=id;l++){const c=info2[l];if(c.b||c.n<3)continue;if(c.mx<T||c.cy>BANDY||[[309,268],[574,299]].some(([x,y])=>Math.hypot(c.cx-x,c.cy-y)<12))fill[l]=1;else kept.push(`(${c.cx|0},${c.cy|0}) r=${c.mx.toFixed(1)} n=${c.n}`)}
console.log('kept voids:\n'+kept.join('\n'));
for(let i=0;i<W*H;i++){const l=lab[i];if(l&&fill[l])m[i]=1}
const out=Buffer.alloc(W*H);for(let i=0;i<W*H;i++)out[i]=m[i]?255:0;
await sharp(out,{raw:{width:W,height:H,channels:1}}).png().toFile('out/crown-mask.png');
})();
