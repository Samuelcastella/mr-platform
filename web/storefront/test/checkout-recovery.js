// Reproducible failure-injection coverage of the actual storefront purchase state machine.
// DEMO records stay inside this Node VM; no requests reach live APIs.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1].split('brand.onclick=')[0];
const pendingKey='mrPurchaseAttemptV1';
function harness(){
 const storage=()=>({removeItem(key){delete this[key]}});
 const localStorage=storage(),sessionStorage=storage();
 const status={hidden:true,textContent:''},app={dataset:{},innerHTML:'',focus(){}};
 const document={querySelector(){return null},querySelectorAll(){return []},getElementById(id){return id==='status'?status:null}};
 const context=vm.createContext({
  console,URL,Intl,TextEncoder,document,localStorage,sessionStorage,app,
  location:{hash:'#/review',origin:'https://qa.example'},crypto:require('node:crypto').webcrypto,
  window:{scrollTo(){},setTimeout(){}},setTimeout(){},clearTimeout(){},
  addEventListener(){},removeEventListener(){},fetch:async()=>{throw Error('unexpected request')}
 });
 vm.runInContext(source,context);
 const run=src=>vm.runInContext(src,context);
 run("catalogState='ready';products.push({id:'c1',name:'Blusa DEMO',dept:'Ropa',price:300,currency:'HNL',variants:[{id:11,size:'S',color:'Arena',price:300,currency:'HNL',available:2},{id:22,size:'M',color:'Negro',price:540,currency:'HNL',available:1}]});authoritativeStock.c1=3");
 const checkout={
  name:'Cliente DEMO',phone:'0000-0000',delivery:'Retiro en tienda',fulfillmentType:'STORE_PICKUP',
  payment:'CASH',department:'',municipality:'',address:'',reference:''
 };
 localStorage.mrCart=JSON.stringify([{id:'c1',variantId:22,q:1}]);
 sessionStorage.mrCheckout=JSON.stringify(checkout);
 return {context,run,localStorage,sessionStorage,checkout,status};
}
function fixture(stage){
 if(stage==='order')return {order:{id:88,token:'token-order-demo',orderNumber:'MR-DEMO-88',status:'PENDING_CONFIRMATION',createdAt:'2026-10-21T10:00:00Z'}};
 if(stage==='fulfillment')return {fulfillment:{id:77,token:'token-fulfillment-demo',orderId:88,type:'STORE_PICKUP',status:'PENDING',destination:{department:null}}};
 if(stage==='checkout')return {checkout:{id:99,token:'token-checkout-demo',orderStatus:'CONFIRMED',amountMinor:54000,currency:'HNL',paymentMethod:'CASH',payment:{status:'PENDING'}}};
 throw Error('bad fixture stage');
}
function fakeServer(h,{failStage=null, failCount=1, promiseOnOrder=null}={}){
 const calls=[];let failures=0;
 h.context.fetch=async(url,options={})=>{
  const stage=url==='/api/v1/orders'?'order':url==='/api/v1/fulfillments'?'fulfillment':url==='/api/v1/checkouts'?'checkout':null;
  if(!stage){if(url==='/api/v1/events')return {ok:true};throw Error('bad POST '+url)}
  calls.push({stage,key:options.headers['idempotency-key'],body:JSON.parse(options.body)});
  if(promiseOnOrder&&stage==='order')await promiseOnOrder();
  if(stage===failStage&&failures<failCount){failures++;throw Error('Connection closed after the server may have committed the write');}
  return {ok:true,json:async()=>fixture(stage)};
 };
 return calls;
}
(async()=>{
 // A. Lost Fulfillment response: replay exactly Fulfillment key, NOT Order.
 {
  const h=harness(),calls=fakeServer(h,{failStage:'fulfillment'});
  await h.run('confirmOrder()');
  const pending=JSON.parse(h.sessionStorage[pendingKey]);
  assert.equal(pending.order.id,88);
  assert.equal(pending.fulfillment,null);
  assert.equal(JSON.parse(h.localStorage.mrOrderRefs)[0].id,88,'known Order is trackable even when delivery fails');
  assert.match(h.run('reviewView()'),/Compra pendiente de conciliación/);
  h.run("products[0].variants[1].available=0");
  await h.run('confirmOrder()'); // Existing reserved Order does not require unreserved display stock.
  assert.deepEqual(calls.map(x=>x.stage),['order','fulfillment','fulfillment','checkout']);
  assert.equal(calls[1].key,calls[2].key,'delivery replay uses identical idempotency key');
  assert.deepEqual(calls[1].body,calls[2].body,'delivery replay uses identical body');
  assert.equal(h.localStorage.mrCart,undefined);
  assert.equal(h.sessionStorage[pendingKey],undefined);
  assert.equal(JSON.parse(h.sessionStorage.mrLastCheckout).payment.status,'PENDING');
 }
 // B. Lost Order response and cart mutation: do NOT change variant, nor reuse key with different payload.
 {
  const h=harness(),calls=fakeServer(h,{failStage:'order'});
  await h.run('confirmOrder()');
  const pending=JSON.parse(h.sessionStorage[pendingKey]);
  assert.equal(pending.order,null);
  assert.deepEqual(pending.items,[{id:'c1',variantId:22,q:1}]);
  h.localStorage.mrCart=JSON.stringify([{id:'c1',variantId:11,q:1}]);
  assert.match(h.run('cartView()'),/Compra pendiente de conciliación/);
  await h.run('confirmOrder()');
  assert.equal(calls.length,1,'modified cart must not create a new Order');
  h.run('restorePendingCart()');
  assert.equal(JSON.parse(h.localStorage.mrCart)[0].variantId,22);
  await h.run('confirmOrder()');
  assert.equal(calls.filter(x=>x.stage==='order').length,2,'only identical Order retried');
  assert.equal(calls[0].key,calls[1].key);
  assert.deepEqual(calls[0].body,calls[1].body);
  assert.deepEqual(calls[1].body.items,[{variantId:22,quantity:1}]);
 }
 // C. Lost Checkout response: no fresh Order/Fulfillment on retry.
 {
  const h=harness(),calls=fakeServer(h,{failStage:'checkout'});
  await h.run('confirmOrder()');
  let pending=JSON.parse(h.sessionStorage[pendingKey]);
  assert.equal(pending.order.id,88);
  assert.equal(pending.fulfillment.id,77);
  assert.equal(pending.checkout,null);
  await h.run('confirmOrder()');
  assert.deepEqual(calls.map(x=>x.stage),['order','fulfillment','checkout','checkout']);
  assert.equal(calls[2].key,calls[3].key);
  assert.deepEqual(calls[2].body,calls[3].body);
  assert.equal(JSON.parse(h.localStorage.mrOrderRefs)[0].checkoutId,99);
 }
 // D. Buyer contact changed after lost response: fingerprint prevents hidden reuse.
 {
  const h=harness(),calls=fakeServer(h,{failStage:'order'});
  await h.run('confirmOrder()');
  h.sessionStorage.mrCheckout=JSON.stringify({...h.checkout,name:'Cliente modificado'});
  await h.run('confirmOrder()');
  assert.equal(calls.length,1,'contact change must not silently reuse key/new order');
  assert.ok(h.sessionStorage[pendingKey]);
  assert.match(h.status.textContent,/Cambiaste datos/);
 }
 // E. Older pending keys with no payload binding must not be reused.
 {
  const h=harness(),calls=fakeServer(h);
  h.sessionStorage.mrOrderIdempotency='unknown-earlier-payload';
  assert.match(h.run('checkoutView()'),/compra pendiente|Compra pendiente/i);
  await h.run('confirmOrder()');
  assert.equal(calls.length,0);
  assert.ok(h.sessionStorage.mrOrderIdempotency,'legacy key retained for manual reconciliation');
 }
 // F. Rapid repeated checkout taps: only one request sequence in flight.
 {
  const h=harness(),calls=fakeServer(h);
  await Promise.all([h.run('confirmOrder()'),h.run('confirmOrder()')]);
  assert.deepEqual(calls.map(x=>x.stage),['order','fulfillment','checkout']);
 }
 console.log('Checkout recovery checks passed: lost Order/Fulfillment/Checkout response, immutable variants/contact, replay keys, stage resume, legacy key and double tap.');
})().catch(err=>{console.error(err);process.exitCode=1});
