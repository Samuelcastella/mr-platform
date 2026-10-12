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
