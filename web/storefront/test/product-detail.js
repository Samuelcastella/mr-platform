// Regression tests for product-detail/variant purchase behavior (no DOM/network dependencies).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'expected storefront inline script');
const source = match[1].slice(0, match[1].indexOf('brand.onclick='));
assert.ok(source.includes('function productView('));
assert.ok(source.includes('function validCartItem('));
const storage = () => ({removeItem(key){delete this[key]}});
const localStorage = storage(),sessionStorage = storage();
const qty = {value:'1'},department={value:'Cortés'},delivery={textContent:''},status={hidden:true,textContent:''};
const app={dataset:{},innerHTML:'',focus(){}};
const document={
 querySelector(sel){return {'#pd-qty':qty,'#pd-department':department,'#pd-delivery-result':delivery}[sel]||null},
 querySelectorAll(){return []},
 getElementById(id){return id==='status'?status:null}
};
let events=[];
const context=vm.createContext({
 document,localStorage,sessionStorage,app,
 console, URL, Intl,
 location:{hash:'#/product/c1',origin:'https://mr.example'},
 window:{scrollTo(){},setTimeout(){}},
 setTimeout(){},clearTimeout(){},
 addEventListener(){},removeEventListener(){},
 crypto:require('node:crypto').webcrypto,
 fetch:async (url,options)=>{
  if(url==='/api/v1/events'){events.push(JSON.parse(options.body));return {ok:true}}
  if(String(url).includes('/fulfillment/options'))return {ok:true,json:async()=>({options:[{quoteRequired:true}]})};
  return {ok:false};
 }
});
vm.runInContext(source,context);
const run=src=>vm.runInContext(src,context);
run("catalogState='ready';products.push({id:'c1',name:'Blusa de prueba',dept:'Ropa',price:320,currency:'HNL',defaultCondition:'new',image:'',images:[],stock:6,variants:[{id:11,size:'S',color:'Arena',price:320,currency:'HNL',available:3},{id:12,size:'L',color:'Arena',price:320,currency:'HNL',available:0},{id:21,size:'S',color:'Negro',price:500,currency:'HNL',available:1},{id:22,size:'M',color:'Negro',price:500,currency:'HNL',available:2}]});authoritativeStock.c1=6");

const product=run("productView('c1')");
assert.match(product,/Blusa de prueba/);
assert.match(product,/Fotografía no publicada/);
assert.match(product,/Opiniones verificadas/);
assert.match(product,/todavía no están habilitadas/);
assert.match(product,/Ayuda gratuita para elegir talla/);
assert.doesNotMatch(product,/última oportunidad|reseñas de 5 estrellas|temporizador/i);
assert.doesNotMatch(product,/DEMO|L 890/);

run("selectProductColor('Negro');selectProductSize('M')");
assert.equal(run("selectedDetailVariant(products[0]).id"),22);
run("addQty('c1')");
assert.equal(JSON.parse(localStorage.mrCart)[0].variantId,22);
assert.equal(run("resolveVariantId(cart()[0])"),22);
assert.match(run("cartView()"),/Negro/);
assert.match(run("cartView()"),/500/);

run("selectProductColor('Arena');selectProductSize('S');addQty('c1')");
let c=JSON.parse(localStorage.mrCart);
assert.equal(c.length,2,'distinct product variants remain separate in cart');
assert.deepEqual(c.map(x=>x.variantId),[22,11]);
assert.equal(run("resolveVariantId(cart()[1])"),11);
assert.match(run("cartView()"),/820/,'variant prices should determine subtotal');
run("changeQty('c1','22',1)");
assert.equal(JSON.parse(localStorage.mrCart)[0].q,2);
run("changeQty('c1','22',1)");
assert.equal(JSON.parse(localStorage.mrCart)[0].q,2,'cannot exceed variant stock');
run("removeItem('c1','11')");
assert.deepEqual(JSON.parse(localStorage.mrCart).map(x=>x.variantId),[22]);

run("selectProductColor('Arena');selectProductSize('L')");
assert.match(run("productView('c1')"),/Variante agotada/);
const before=JSON.stringify(JSON.parse(localStorage.mrCart));
run("addQty('c1')");
assert.equal(JSON.stringify(JSON.parse(localStorage.mrCart)),before,'sold out variant cannot be added');

localStorage.mrCart=JSON.stringify([{id:'c1',q:1}]);
assert.match(run("cartView()"),/Variante sin confirmar/);
assert.match(run("checkoutView()"),/Revisa las variantes/);
assert.equal(run("resolveVariantId(cart()[0])"),null,'legacy multi-variant cart cannot silently pick a size');

localStorage.mrCart=JSON.stringify([{id:'c1',variantId:22,q:1}]);
context.location.hash='#/checkout';run('render()');run('render()');
assert.equal(events.filter(x=>x.eventName==='checkout_start').length,1,'route re-render must not count multiple checkouts');
assert.match(run("checkoutView()"),/Finalizar pedido/);

run("products[0].name='<img src=x onerror=alert(1)>';products[0].images=[{url:'javascript:alert(1)',altText:'Evil'}]");
const safe=run("productView('c1')");
assert.doesNotMatch(safe,/<img src=x|src=\"javascript:/);
assert.match(safe,/&lt;img/);

(async()=>{
 context.fetch=async()=>({ok:true,json:async()=>({options:[{quoteRequired:true}]})});
 await run("estimateProductDelivery()");
 assert.match(delivery.textContent,/Cotización por confirmar/);
 context.fetch=async()=>({ok:true,json:async()=>({options:[{quoteRequired:false,etaMinDays:2,etaMaxDays:4,shippingMinor:8500,currency:'HNL'}]})});
 await run("estimateProductDelivery()");
 assert.match(delivery.textContent,/2–4 días/);
 assert.match(delivery.textContent,/85/);
 console.log('Product-detail regression checks passed: variant selection, cart, stock, honesty, shipping, analytics and XSS.');
})().catch(error=>{console.error(error);process.exitCode=1});
