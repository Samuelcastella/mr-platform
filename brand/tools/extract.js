const sharp=require('sharp');
const SRC='C:/Users/SEMSEproject/Downloads/4DE433C7-B240-4E4A-8F20-E33E6D815246.png';
const S=4;
const parts={
  crown:{left:116,top:56,width:290,height:167},   // y 56..223
  monogram:{left:100,top:223,width:330,height:227},
  wordmark:{left:136,top:550,width:250,height:156},
  lockup:{left:100,top:56,width:330,height:650}
};
async function lumRaw(box){
  const {data,info}=await sharp(SRC).extract(box).greyscale().resize(box.width*S,box.height*S,{kernel:'lanczos3'}).raw().toBuffer({resolveWithObject:true});
  return {data,w:info.width,h:info.height};
}
// alpha from darkness: paper ~229, ink ~25
function toAlpha(L){const lo=70,hi=205;let a=(hi-L)/(hi-lo);a=Math.max(0,Math.min(1,a));return a*a*(3-2*a)}
async function write(name,box,rgb,file){
  const {data,w,h}=await lumRaw(box);
  const out=Buffer.alloc(w*h*4);
  for(let i=0;i<w*h;i++){out[i*4]=rgb[0];out[i*4+1]=rgb[1];out[i*4+2]=rgb[2];out[i*4+3]=Math.round(toAlpha(data[i])*255)}
  await sharp(out,{raw:{width:w,height:h,channels:4}}).png({compressionLevel:9}).toFile(file);
  console.log(file,w,h);
}
(async()=>{
for(const [k,b] of Object.entries(parts)){
  await write(k,b,[28,27,25],`out/${k}-ink.png`);
}
// preview on cream and dark
const prev=async(f,bg,o)=>sharp({create:{width:1320,height:2600,channels:3,background:bg}}).composite([{input:f}]).png().toFile(o);
await sharp({create:{width:1320,height:2600,channels:3,background:{r:245,g:240,b:231}}}).composite([{input:'out/lockup-ink.png'}]).resize(330).png().toFile('out/prev-cream.png');
})();
