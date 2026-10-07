const sharp=require('sharp'),fs=require('fs');
const R='C:/Users/SEMSEproject/mr-platform/';const B=R+'brand/',A=R+'web/storefront/assets/';
const P=require('./out/brand-paths.json');
const COL={ink:'#1c1b19',cream:'#f5f0e7',gold:'#d4af37'};
const sil=fs.readFileSync('out/crown-silhouette.svg','utf8').match(/ d="([^"]+)"/)[1].replace(/(\d+\.\d)\d+/g,'$1');
const g=(name,tx,ty,col,sc=1)=>`<g transform="translate(${tx} ${ty}) scale(${sc})"><path fill="${col}" fill-rule="evenodd" d="${P[name].d}"/></g>`;
// ---- lockup compacto (corona + MR + עדולם con menos aire)
const D=330;
const compact=col=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="31 19 1250 2201" role="img"><title>MR עדולם</title>${g('crown',64,0,col)}${g('monogram',0,668,col)}${g('wordmark',144,1976-D,col)}</svg>\n`;
for(const [n,c] of Object.entries(COL))fs.writeFileSync(`${B}svg/lockup-compact-${n}.svg`,compact(c));
// ---- favicon svg (silueta, ligero)
const fav=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${COL.cream}"/><g transform="translate(22 14) scale(.0517)"><path fill="${COL.ink}" fill-rule="evenodd" d="${sil}"/></g><g transform="translate(17 49) scale(.0527)"><path fill="${COL.ink}" fill-rule="evenodd" d="${P.monogram.d}" transform="translate(-37 2)"/></g></svg>\n`;
fs.writeFileSync(A+'favicon.svg',fav);fs.writeFileSync(B+'svg/favicon.svg',fav);
// ---- icono de app: corona + MR centrados
function iconSvg(size,bg,col,scale,transparentBg=false){
  const cw=P.crown.bb[2]*0.46*scale,ch=P.crown.bb[3]*0.46*scale,mw=P.monogram.bb[2]*0.40*scale,mh=P.monogram.bb[3]*0.40*scale,gap=14*scale;
  const total=ch+gap+mh,top=(size-total)/2;
  const cx=(size-cw)/2-P.crown.bb[0]*0.46*scale,cy=top-P.crown.bb[1]*0.46*scale;
  const mx=(size-mw)/2-P.monogram.bb[0]*0.40*scale,my=top+ch+gap-P.monogram.bb[1]*0.40*scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${transparentBg?'':`<rect width="${size}" height="${size}" fill="${bg}"/>`}${g('crown',cx,cy,col,0.46*scale)}${g('monogram',mx,my,col,0.40*scale)}</svg>`}
(async()=>{
const png=(svg,file,size)=>sharp(Buffer.from(svg),{density:72}).resize(size,size).png({compressionLevel:9}).toFile(file);
await png(iconSvg(1024,COL.cream,COL.ink,1.2),B+'app/icon-1024.png',1024);
await png(iconSvg(1024,'#0b0b0b',COL.gold,1.2),B+'app/icon-1024-dark.png',1024);
await png(iconSvg(1024,'',COL.ink,0.78,true),B+'app/adaptive-icon-foreground.png',1024);
await png(iconSvg(1024,'',COL.gold,0.78,true),B+'app/adaptive-icon-foreground-gold.png',1024);
await png(iconSvg(1024,'',COL.ink,0.55,true),B+'app/splash-icon.png',1024);
await png(iconSvg(1024,COL.cream,COL.ink,0.86),A+'apple-touch-icon.png',1024).then(()=>sharp(A+'apple-touch-icon.png').resize(180,180).toBuffer()).then(b=>fs.writeFileSync(A+'apple-touch-icon.png',b));
for(const s of [48,192,512])await sharp(Buffer.from(fav),{density:300}).resize(s,s).png().toFile(`${B}app/favicon-${s}.png`);
// ---- PNGs transparentes por variante
for(const [n,c] of Object.entries(COL)){
  for(const part of ['lockup','lockup-compact','crown','monogram','wordmark']){
    await sharp(`${B}svg/${part}-${n}.svg`,{density:36}).resize({height:part.startsWith('lockup')?2000:part==='crown'?600:700,withoutEnlargement:false}).png({compressionLevel:9}).toFile(`${B}png/${part}-${n}.png`);
  }
}
// ---- activos del storefront
await sharp(B+'png/crown-ink.png').resize({width:640}).png({compressionLevel:9}).toFile(A+'crown.png');
fs.copyFileSync(B+'svg/monogram-ink.svg',A+'monogram.svg');fs.copyFileSync(B+'svg/wordmark-ink.svg',A+'wordmark.svg');
// splash completo 1284x2778
const sp=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1284 2778"><rect width="1284" height="2778" fill="${COL.cream}"/><g transform="translate(${(1284-1250*0.34)/2-31*0.34} ${(2778-2201*0.34)/2-19*0.34}) scale(.34)">${g('crown',64,0,COL.ink)}${g('monogram',0,668,COL.ink)}${g('wordmark',144,1976-D,COL.ink)}</g></svg>`;
await sharp(Buffer.from(sp),{density:72}).png({compressionLevel:9}).toFile(B+'app/splash-1284x2778.png');
for(const d of ['svg','png','app'])console.log(d,fs.readdirSync(B+d).map(f=>f+':'+(fs.statSync(B+d+'/'+f).size/1024|0)+'K').join(' '));
console.log('assets',fs.readdirSync(A).map(f=>f+':'+(fs.statSync(A+f).size/1024|0)+'K').join(' '));
})();
