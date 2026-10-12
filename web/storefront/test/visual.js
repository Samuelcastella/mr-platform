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
      const response = await page.goto(base, {waitUntil:'networkidle',timeout:30000});
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
      report.push({...size,httpStatus:response.status(),...metrics,pageErrors:errors});
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.some(r=>r.httpStatus!==200||r.horizontalOverflow||!r.brandPresent||r.pageErrors.length))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
