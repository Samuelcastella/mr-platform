// Behavioral checks for the redesigned catalog and SPA journey lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Isolate startup; exercise the actual view functions and catalog synchronization.
source = source.slice(0, source.indexOf('brand.onclick='));
const storage = () => ({ removeItem(key) { delete this[key]; } });
const input = { value: '' }, app = { dataset: {}, innerHTML: '', focus() {} }, statusNode = {};
const nav = ['#/', '#/catalog', '#/brand'].map(href => ({
  attrs: { href }, getAttribute(key) { return this.attrs[key]; },
  setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
}));
const document = {
  querySelector(selector) { return selector === '#searchInput' ? input : null; },
  querySelectorAll(selector) { return selector === 'nav a' ? nav : []; },
  getElementById(id) { return id === 'status' ? statusNode : null; },
};
const context = vm.createContext({
  console, URL, Intl, document, app, location: { hash: '#/catalog', origin: 'https://example.com' },
  sessionStorage: storage(), localStorage: storage(),
  window: { scrollTo() {}, setTimeout() {} },
  setTimeout() {}, clearTimeout() {}, addEventListener() {}, removeEventListener() {},
  fetch: async () => ({ ok: false }), crypto: require('node:crypto').webcrypto,
});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);

(async () => {
  assert.match(run('cards()'), /Cargando productos/);
  assert.doesNotMatch(run('cards()'), /preparando la selección/);
  run("catalogState='ready'");
  assert.match(run('home()'), /preparando la selección/);
  assert.doesNotMatch(run('home()'), /Oferta|Popular/);
  run("catalogState='error'");
  assert.match(run('cards()'), /Volver a intentar/);

  // A customer's search must survive the asynchronous first catalog response.
  input.value = 'negra';
  run('searchProducts({preventDefault(){}})');
  context.fetch = async url => ({ ok: true, json: async () => ({ data: [
    { id: 1, name: 'Camisa negra', category: 'Ropa', price: 320, stock: 2, variants: [] },
    { id: 2, name: 'Bolso crema', category: 'Accesorios', price: 500, stock: 1, variants: [] },
  ] }) });
  await run('syncCatalog()');
  assert.equal(run('catalogState'), 'ready');
  assert.equal(run('filteredProducts().length'), 1);
  assert.match(app.innerHTML, /Camisa negra/);
  assert.doesNotMatch(app.innerHTML, /Bolso crema/);
  assert.equal(nav[1].attrs['aria-current'], 'page');
  assert.equal(nav[0].attrs['aria-current'], undefined);
  run("catalogQuery='';openCategory('Accesorios')");
  assert.equal(run('filteredProducts()[0].name'), 'Bolso crema');
  run("catalogQuery='inexistente'");
  assert.match(run('catalog()'), /No encontramos coincidencias/);
  run('resetCatalog()');
  assert.equal(run('filteredProducts().length'), 2);
  assert.equal(input.value, '');

  // API text is untrusted: neither names nor category values can become markup.
  run(`products[0].name='<img src=x onerror=alert(1)>';products[0].dept='Ropa" onclick="alert(1)';products[0].image='javascript:alert(1)'`);
  assert.match(run('cards()'), /&lt;img/);
  assert.doesNotMatch(run('cards()'), /src="javascript:|<img src=x/);
  assert.match(run('home()'), /data-category="Ropa&quot; onclick=&quot;alert\(1\)"/);
  run("location.hash='#app';render()");
  assert.match(app.innerHTML, /hero-title/); // Skip link must not route to Account.
  run("announce('Guardado')");
  assert.equal(statusNode.textContent, 'Guardado');


  // Exact-variant purchase behavior: no product-level auto-selection.
  context.fetch = async () => ({ ok: true, json: async () => ({ data: [
    { id: 1, name: 'Camisa negra', category: 'Ropa', price: 320, stock: 3,
      variants: [
        { id: 11, sku: 'CAM-M-NEG', size: 'M', color: 'Negro', price: 320, available: 2 },
        { id: 12, sku: 'CAM-L-NEG', size: 'L', color: 'Negro', price: 340, available: 1 },
      ] },
    { id: 2, name: 'Bolso crema', category: 'Accesorios', price: 500, stock: 1,
      variants: [{ id: 21, sku: 'BOL-UNI', color: 'Crema', price: 500, available: 1 }] },
  ] }) });
  await run('syncCatalog()');
  assert.match(run("productView('c1')"), /Seleccionar variante/);
  assert.match(run("cards()"), /Elegir opciones/);

  // Cart from before the rollout must require an explicit choice, even with
  // exactly one available server-side variant.
  run("localStorage.mrCart=JSON.stringify([{id:'c1',q:1}])");
  assert.equal(run('cartReady()'), false);
  assert.match(run('cartView()'), /Selecciona una variante disponible/);
  assert.match(run('checkoutView()'), /Revisa las variantes del carrito/);
  let requests = 0;
  context.fetch = async () => { requests++; throw new Error('Unexpected checkout request'); };
  await run('confirmOrder()');
  assert.equal(requests, 0, 'legacy line cannot submit an order');

  // Resolve the legacy line without silently assigning the first variant.
  run("chooseCartVariant('c1:legacy', '11')");
  assert.deepEqual(JSON.parse(run('JSON.stringify(cart())')), [{ id:'c1', q:1, variantId:11 }]);

  // Product detail accepts explicitly selected variant and keeps distinct
  // lines for M vs L, even if both belong to the same catalog product.
  const variantField = { value:'12', dataset:{ productId:'c1' } };
  const qtyField = { value:'1', innerHTML:'', disabled:false };
  const priceField = { textContent:'' }, availabilityField = { textContent:'' }, addButton = { disabled:true };
  document.querySelector = selector => ({
    '#searchInput': input, '#variant': variantField, '#qty': qtyField,
    '#variantPrice': priceField, '#variantAvailability': availabilityField,
    '#addVariantButton': addButton,
  })[selector] || null;
  context.fetch = async () => ({ ok:true, json:async()=>({}) });
  run('refreshVariantSelection()');
  assert.equal(addButton.disabled, false);
  assert.match(priceField.textContent, /340/);
  run("addQty('c1')");
  assert.deepEqual(JSON.parse(run('JSON.stringify(cart().map(x=>x.variantId))')), [11,12]);
  assert.equal(run('cartReady()'), true);
  assert.match(run('cartView()'), /M · Negro/);
  assert.match(run('cartView()'), /L · Negro/);
  assert.deepEqual(JSON.parse(run('JSON.stringify(orderItemsFromCart())')),
    [{variantId:11,quantity:1},{variantId:12,quantity:1}]);

  // Cannot increase beyond per-variant availability or merge over stock.
  run("changeQty('c1:11',1)");
  assert.equal(run('cart().find(x=>x.variantId===11).q'),2);
  run("changeQty('c1:11',1)");
  assert.equal(run('cart().find(x=>x.variantId===11).q'),2);
  run("chooseCartVariant('c1:12','11')");
  assert.equal(run('cart().length'),2);
  assert.match(run('reviewView()'), /Pedido no disponible/);
  run("sessionStorage.mrCheckout=JSON.stringify({name:'Test',phone:'9999',delivery:'Retiro en tienda',payment:'CASH'})");
  assert.match(run('reviewView()'), /L · Negro/);


  // The real checkout code must post the customer's exact chosen variant IDs.
  const savedCart = run('localStorage.mrCart'), postedOrders = [];
  context.fetch = async (url, options = {}) => {
    if (url === '/api/v1/orders') {
      postedOrders.push(JSON.parse(options.body));
      return { ok:true, json:async()=>({order:{id:88,token:'order-88',orderNumber:'MR-88',status:'PENDING_CONFIRMATION',createdAt:'2026-10-21T10:00:00Z'}}) };
    }
    if (url === '/api/v1/fulfillments')
      return { ok:true, json:async()=>({fulfillment:{id:77,token:'ful-77',type:'STORE_PICKUP',status:'PENDING',destination:{}}}) };
    if (url === '/api/v1/checkouts')
      return { ok:true, json:async()=>({checkout:{id:99,token:'chk-99',orderStatus:'CONFIRMED',paymentMethod:'CASH',currency:'HNL',amountMinor:100000,payment:{status:'PENDING'}}}) };
    return { ok:true, json:async()=>({}) };
  };
  await run('confirmOrder()');
  assert.equal(postedOrders.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(postedOrders[0].items)),
    [{variantId:11,quantity:2},{variantId:12,quantity:1}]);
  assert.equal(run('localStorage.mrCart'),undefined,'cart clears only after server checkout success');
  run('localStorage.mrCart='+JSON.stringify(savedCart));

  // A saved exact variant that disappears from the authoritative catalog
  // becomes blocked rather than being remapped to a different SKU.
  context.fetch = async () => ({ ok: true, json: async () => ({ data: [
    { id: 1, name:'Camisa negra', category:'Ropa', price:320, stock:2,
      variants:[{id:11,sku:'CAM-M-NEG',size:'M',color:'Negro',price:320,available:2}] },
  ] }) });
  await run('syncCatalog()');
  assert.equal(run('cartReady()'), false);
  assert.match(run('cartView()'), /Selecciona una variante disponible/);
  assert.match(run('checkoutView()'), /Revisa las variantes del carrito/);

  // Journey: scroll updates, no film requests, teardown removes pending work.
  const callbacks = new Map(); let next = 0, scroll = 0, fetches = 0;
  const motion = new EventTarget(); motion.matches = false;
  const small = new EventTarget(); small.matches = false;
  const win = new EventTarget(); win.innerHeight = 800;
  const visual = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
  const label = {}, counter = {};
  const steps = ['Descubre','Elige','Recibe'].map((name,i) => ({ dataset: { label: name, scene: name }, getBoundingClientRect() { return { top: 500+i*800-scroll, height: 800, bottom: 1300+i*800-scroll }; } }));
  const host = { querySelector(selector) { return selector === '.journey-visual' ? visual : selector === '[data-journey-label]' ? label : counter; }, querySelectorAll() { return steps; } };
  const container = { querySelector() { return host; } };
  const journey = vm.createContext({
    window: win, navigator: {}, document: { getElementById() { return null; } },
    matchMedia: query => query.includes('reduced') ? motion : small,
    AbortController, URL, fetch() { fetches++; throw new Error('Unexpected media request'); },
    requestAnimationFrame(fn) { callbacks.set(++next, fn); return next; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(root,'assets/brand-journey.js'),'utf8'),journey);
  const flush = () => { const tasks=[...callbacks.values()]; callbacks.clear();tasks.forEach(fn=>fn()); };
  win.mrJourney.mount(container); flush();
  assert.equal(label.textContent, 'Descubre');
  scroll=1100;win.dispatchEvent(new Event('scroll'));flush();
  assert.equal(label.textContent, 'Elige');
  assert.equal(fetches, 0);
  win.dispatchEvent(new Event('scroll'));win.mrJourney.unmount();
  assert.equal(callbacks.size, 0);
  win.dispatchEvent(new Event('scroll'));
  assert.equal(callbacks.size, 0);
  motion.matches=true;win.mrJourney.mount(container);flush();
  assert.equal(fetches, 0);win.mrJourney.unmount();
  small.matches=true;motion.matches=false;win.mrJourney.mount(container);flush();
  assert.equal(fetches, 0);win.mrJourney.unmount();
  console.log('Design checks passed: catalog states, async search, filters, escaping, navigation, journey cleanup.');
})().catch(error => { console.error(error); process.exitCode=1; });
