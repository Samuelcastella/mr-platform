// Parchea index.html (copia exacta del storefront en vivo) con el logo real y la corona 3D.
const fs=require('fs');let s=fs.readFileSync('base.html','utf8');
function rep(a,b){const n=s.split(a).length-1;if(n!==1)throw new Error('target x'+n+': '+a.slice(0,70));s=s.replace(a,()=>b)}
// --- Corrección: el despliegue actual rompe el <script> por comillas sin escapar dentro de strings '...'
const BS=String.fromCharCode(92);
function repAll(a,b){if(!s.includes(a))throw new Error('missing: '+a.slice(0,60));s=s.split(a).join(b)}
repAll("go('checkout')\"","go("+BS+"'checkout"+BS+"')\"");
repAll("this.closest('[data-order-status]').querySelector('.admin-detail')","this.closest("+BS+"'[data-order-status]"+BS+"').querySelector("+BS+"'.admin-detail"+BS+"')");
repAll("'</p>':'')'+lines+'","'</p>':'')+lines+'");
// head: favicon + importmap three
rep('<head><meta charset="utf-8">','<head><meta charset="utf-8"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"><meta name="theme-color" content="#f5f0e7"><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>');
// header brand: arte real
const oldBrand=s.slice(s.indexOf('<div class="brand brand-signature"'),s.indexOf('<div class="actions">'));
rep(oldBrand,'<div class="brand brand-signature" id="brand" role="img" aria-label="MR עדולם"><img class="crown" src="/assets/crown.png" alt="" width="84" height="49"><img class="monogram" src="/assets/monogram.svg" alt="" height="44"><img class="he-mark" src="/assets/wordmark.svg" alt="" height="15"></div>');
// css header
rep('.crown{width:94px;height:48px;display:block;margin:auto auto -2px;','.crown{width:84px;height:auto;display:block;margin:auto auto 1px;');
rep('.monogram{width:98px;height:52px;display:block;margin:-3px auto 0;filter:drop-shadow(0 2px 2px #0002)}','.monogram{width:auto;height:44px;display:block;margin:0 auto}.he-mark{width:auto;height:15px;display:block;margin:7px auto 0}');
// css hero 3D
rep('.hero-display{position:absolute;right:5%;top:14%;width:40%;height:70%;z-index:1}','.hero-display{position:absolute;right:2%;top:8%;width:42%;height:78%;z-index:1}.crown3d{position:absolute;inset:0;display:grid;place-items:center}.crown3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:pan-y;opacity:0;transition:opacity .9s ease;outline:none}.crown3d canvas[data-ready]{opacity:1}.crown3d canvas.grabbing{cursor:grabbing}.crown3d canvas:focus-visible{outline:3px solid #fff;outline-offset:-6px;border-radius:24px}.crown3d-fallback{width:72%;height:auto;filter:invert(.92) drop-shadow(0 6px 18px #0008);transition:opacity .6s}.crown3d:has(canvas[data-ready]) .crown3d-fallback{opacity:0}.crown3d-hint{position:absolute;left:0;right:0;bottom:2%;text-align:center;color:#d8b96dcc;font-size:11px;letter-spacing:.22em;text-transform:uppercase;pointer-events:none;transition:opacity .6s}.crown3d.touched .crown3d-hint{opacity:0}');
rep('@media(max-width:760px){.hero-display{width:58%;right:-20%;opacity:.42}','@media(max-width:760px){.hero-display{width:100%;left:0;right:0;top:2%;height:38%}.hero{min-height:720px}');
rep('.hero{min-height:470px;padding:26px 20px;border-radius:22px}','.hero{min-height:710px;padding:26px 20px;border-radius:22px}');
// hero markup
rep('<div class="hero-display" aria-hidden="true"><div class="orb"></div><div class="showcase"><i>👜</i><i>✨</i><i>⌚</i><i>👟</i></div></div>','<div class="hero-display"><div class="orb" aria-hidden="true"></div><div class="crown3d" id="crown3d"><img class="crown3d-fallback" src="/assets/crown.png" alt="Corona de MR עדולם"><span class="crown3d-hint" aria-hidden="true">Arrastra para girar</span></div></div>');
// render hook
rep("app.innerHTML=!p?home():p==='catalog'?catalog()","crownHook();app.innerHTML=!p?home():p==='catalog'?catalog()");
const endRender=s.indexOf("p==='admin'?adminView():accountView()}",s.indexOf('function render(){'));
if(endRender<0)throw new Error('render end');
s=s.slice(0,endRender)+"p==='admin'?adminView():accountView();crownMount()}"+s.slice(endRender+"p==='admin'?adminView():accountView()}".length);
rep('brand.onclick=()=>','let crownOff=null;function crownHook(){if(crownOff){crownOff();crownOff=null}}function crownMount(){const box=document.querySelector("#crown3d");if(!box)return;box.addEventListener("pointerdown",()=>box.classList.add("touched"),{once:true});const go=()=>{crownOff=window.mrCrown.mount(box,{base:"/assets/"})};window.mrCrown?go():addEventListener("mrcrown:ready",go,{once:true})}\nbrand.onclick=()=>');
// módulo three
rep('</script><div class="footer"></div>','</script><script type="module" src="/crown3d.js"></script><div class="footer"></div>');
fs.writeFileSync('index.html',s);console.log('ok',s.length);
