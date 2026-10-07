const sharp=require('sharp'),potrace=require('potrace'),fs=require('fs'),path=require('path');
const B='C:/Users/SEMSEproject/mr-platform/brand/';
fs.mkdirSync(B+'svg',{recursive:true});fs.mkdirSync(B+'png',{recursive:true});fs.mkdirSync(B+'app',{recursive:true});
const tr=(buf,p)=>new Promise((res,rej)=>{const t=new potrace.Potrace(p);t.loadImage(buf,e=>e?rej(e):res(t))});
// binary black-on-white from ink alpha
async function bin(file,thr=118){const {data,info}=await sharp(file).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject:true});
  const o=Buffer.alloc(info.width*info.height);for(let i=0;i<o.length;i++)o[i]=data[i]>thr?0:255;
  let x0=1e9,y0=1e9,x1=0,y1=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(!o[y*info.width+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
  return {png:await sharp(o,{raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer(),w:info.width,h:info.height,bb:[x0,y0,x1-x0+1,y1-y0+1]}}
const COLORS={ink:'#1c1b19',cream:'#f5f0e7',gold:'#d4af37'};
const parts={crown:{turd:6,opt:0.4},monogram:{turd:20,opt:0.5},wordmark:{turd:8,opt:0.4},lockup:{turd:8,opt:0.45}};
(async()=>{
const out={};
for(const [name,p] of Object.entries(parts)){
  const {png,w,h,bb}=await bin(`out/${name}-ink.png`);
  const t=await tr(png,{turdSize:p.turd,optTolerance:p.opt,alphaMax:1.0,threshold:128});
  const dpath=t.getSVG().match(/ d="([^"]+)"/)[1].replace(/(\d+\.\d{2})\d/g,'$1');
  const PAD=6;const vb=[bb[0]-PAD,bb[1]-PAD,bb[2]+2*PAD,bb[3]+2*PAD];out[name]={w,h,bb:vb,d:dpath};
  for(const [cn,col] of Object.entries(COLORS)){
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" role="img"><title>${name==='wordmark'?'עדולם':name==='monogram'?'MR':'MR עדולם'}</title><path fill="${col}" fill-rule="evenodd" d="${dpath}"/></svg>\n`;
    fs.writeFileSync(`${B}svg/${name}-${cn}.svg`,svg);
  }
  console.log(name,w,h,(dpath.length/1024).toFixed(0)+'KB path');
}
fs.writeFileSync('out/brand-paths.json',JSON.stringify(out));
})();
