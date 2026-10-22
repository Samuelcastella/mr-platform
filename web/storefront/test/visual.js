// Browser-based responsive screenshots for MR עדולם (Playwright).
// Run against a local storefront server: BASE_URL=http://127.0.0.1:3000 node test/visual.js
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const output = path.join(__dirname, '..', 'visual-artifacts');
const sizes = [{name:'mobile',width:390,height:844},{name:'tablet',width:768,height:1024},{name:'desktop',width:1440,height:900}];
(async () => {
  fs.mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const report = [];
  try {
    for (const size of sizes) {
      const page = await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1});
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      const response = await page.goto(base, {waitUntil:'domcontentloaded',timeout:30000});
      await page.locator('body').waitFor({state:'visible',timeout:10000});
      await page.waitForTimeout(1500);
      await page.screenshot({path:path.join(output,size.name+'.png'),fullPage:true,animations:'disabled'});
      const metrics = await page.evaluate(() => ({
        title:document.title,
        horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 2,
        scrollWidth:document.documentElement.scrollWidth,
        viewportWidth:innerWidth,
        heroVisible:!![...document.querySelectorAll('.store-hero,.hero')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}),
        mobileNavVisible:(()=>{const e=document.querySelector('.mobile-nav');return !!e&&getComputedStyle(e).display!=='none'})(),
        brandPresent:document.body.textContent.includes('עדולם')||document.title.includes('עדולם')
      }));
      report.push({...size,screen:'home',httpStatus:response.status(),...metrics,pageErrors:errors});

      // Product-detail screenshots use an explicitly DEMO fixture intercepted in the browser.
      // No fake product data is written to the public catalog or served in production.
      const demoProduct = {
        id:101,name:'Blusa DEMO · Prueba visual',category:'Ropa',price:400,currency:'HNL',
        status:'active',defaultCondition:'new',stock:5,images:[],
        variants:[
          {id:1101,sku:'DEMO-ARENA-S',size:'S',color:'Arena',price:400,currency:'HNL',available:2},
          {id:1102,sku:'DEMO-NEGRO-M',size:'M',color:'Negro',price:540,currency:'HNL',available:3},
          {id:1103,sku:'DEMO-NEGRO-L',size:'L',color:'Negro',price:540,currency:'HNL',available:0}
        ]
      };
      await page.route('**/api/v1/products*', route => route.fulfill({
        status:200,contentType:'application/json',body:JSON.stringify({data:[demoProduct]})
      }));
      await page.route('**/api/v1/fulfillment/options*', route => route.fulfill({
        status:200,contentType:'application/json',
        body:JSON.stringify({options:[{quoteRequired:false,etaMinDays:2,etaMaxDays:4,shippingMinor:8500,currency:'HNL'}]})
      }));
      await page.goto(base+'/index.html?visual-qa='+encodeURIComponent(size.name)+'#/product/c101',{waitUntil:'domcontentloaded',timeout:30000});
      // Changing only #hash is same-document navigation and does not invoke syncCatalog().
      // A distinct URL forces a document load so the mock API is consumed before assertions.
      await page.waitForFunction(()=>!!document.querySelector('.pd-info')?.textContent.includes('Blusa DEMO'),null,{timeout:12000});
      await page.locator('.pd-option[data-color="Negro"]').click();
      await page.locator('.pd-option[data-size="M"]').click();
      await page.locator('#pd-department').selectOption('Cortés');
      await page.waitForFunction(()=>document.querySelector('#pd-delivery-result')?.textContent.includes('2–4 días'));
      const selected=await page.evaluate(()=>({
        color:document.querySelector('.pd-option[data-color="Negro"]')?.getAttribute('aria-pressed'),
        size:document.querySelector('.pd-option[data-size="M"]')?.getAttribute('aria-pressed'),
        overflow:document.documentElement.scrollWidth>innerWidth+2,
        reviews:document.body.textContent.includes('opiniones verificadas todavía no están habilitadas'),
        price:document.querySelector('.pd-price')?.textContent,
        estimate:document.querySelector('#pd-delivery-result')?.textContent
      }));
      if(selected.color!=='true'||selected.size!=='true'||selected.overflow||!selected.reviews||!selected.price.includes('540')||!selected.estimate.includes('85'))throw new Error('Product detail visual/selection assertion failed: '+JSON.stringify(selected));
      await page.locator('.pd-option[data-size="L"]').click();
      const disabled=await page.locator('.pd-primary').isDisabled();
      if(!disabled)throw new Error('Out-of-stock variant must not be purchasable');
      await page.locator('.pd-option[data-size="M"]').click();
      await page.locator('.pd-primary').click();
      const line=await page.evaluate(()=>JSON.parse(localStorage.mrCart||'[]').find(x=>x.id==='c101'));
      if(line?.variantId!==1102)throw new Error('Wrong variant added from product detail');
      await page.evaluate(()=>{location.hash='#/cart'});
      await page.locator('.cart-line').waitFor();
      if(!(await page.locator('.cart-line').innerText()).includes('Negro'))throw new Error('Variant missing from cart');

      // Persistent visible labeling for all screenshots using synthetic catalog data.
      await page.evaluate(()=>{
        location.hash='#/product/c101';
      });
      await page.locator('.pd-info').waitFor();
      await page.evaluate(()=>{
        const sign=document.createElement('div');
        sign.textContent='DEMO · Datos ficticios exclusivos de la prueba visual';
        Object.assign(sign.style,{position:'fixed',top:'0',left:'0',right:'0',zIndex:'9999',background:'#171513',color:'#fff',padding:'8px 14px',fontWeight:'bold',fontSize:'13px',textAlign:'center'});
        document.body.prepend(sign);
      });
      await page.screenshot({path:path.join(output,'product-'+size.name+'.png'),fullPage:true,animations:'disabled'});
      report.push({...size,screen:'product-detail-demo',httpStatus:200,horizontalOverflow:selected.overflow,brandPresent:true,pageErrors:errors.slice(),variantId:line.variantId,shippingEstimate:selected.estimate});
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.some(r=>r.httpStatus!==200||r.horizontalOverflow||!r.brandPresent||r.pageErrors.length))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
