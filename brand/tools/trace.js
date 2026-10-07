const sharp=require('sharp'),potrace=require('potrace'),fs=require('fs');
const tr=(buf,p)=>new Promise((res,rej)=>{const t=new potrace.Potrace(p);t.loadImage(buf,e=>e?rej(e):res(t))});
(async()=>{
const W=1160,H=668;
const a=await sharp('out/crown-mask.png').greyscale().raw().toBuffer();
const poly=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#000"/><polygon fill="#fff" points="582,30 614,82 616,128 580,152 546,128 548,84"/></svg>`;
const b=await sharp(Buffer.from(poly)).greyscale().raw().toBuffer();
const m=Buffer.alloc(W*H);for(let i=0;i<W*H;i++)m[i]=Math.max(a[i],b[i]);
const smooth=await sharp(m,{raw:{width:W,height:H,channels:1}}).blur(2.2).threshold(128).negate().png().toBuffer();
fs.writeFileSync('out/crown-mask-smooth.png',smooth);
const t=await tr(smooth,{turdSize:120,optTolerance:0.6,alphaMax:1.0,threshold:128});
fs.writeFileSync('out/crown-silhouette.svg',t.getSVG());
await sharp(Buffer.from(t.getSVG())).flatten({background:'#f5f0e7'}).png().toFile('out/prev-silhouette.png');
console.log('ok',(t.getSVG().match(/M /g)||[]).length);
})();
