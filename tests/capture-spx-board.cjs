const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
(async () => {
  const stage = process.argv[2] || 'before';
  const origin = process.argv[3] || 'http://localhost:5173';
  const dir = path.resolve('.tmp/spx-board-redesign');
  mkdirSync(dir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  const results = [];
  try {
    for (const [name, width, height] of [['desktop',1440,900],['mobile',390,844]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const requests = [], logs = [];
      page.on('pageerror', e => logs.push({ level:'error', text:e.message }));
      page.on('console', m => { if (['error','warn'].includes(m.type())) logs.push({level:m.type(),text:m.text()}); });
      const reads = [];
      page.on('response', response => {
        if (new URL(response.url()).pathname.startsWith('/api/spx-')) reads.push((async () => {
          try { const body = await response.buffer(); requests.push({path:new URL(response.url()).pathname+new URL(response.url()).search,status:response.status(),bytes:body.length,type:response.headers()['content-type']}); } catch { requests.push({path:new URL(response.url()).pathname,status:response.status(),cancelled:true}); }
        })());
      });
      await page.goto(origin+'/#/work/spx-gex-heatmap?mode=latest', {waitUntil:'networkidle2',timeout:60000});
      await page.waitForSelector('[data-spx-gex-heatmap-board]', {timeout:30000});
      await new Promise(r=>setTimeout(r,5000));
      await page.screenshot({path:path.join(dir,stage+'-'+name+'.png')});
      await page.screenshot({path:path.join(dir,stage+'-'+name+'-full.png'),fullPage:true});
      const copy = await page.evaluate(() => {
        const root = document.querySelector('[data-spx-gex-navigation-mode]');
        const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        const sentences = [];
        while(walker.nextNode()) {
          const n=walker.currentNode, p=n.parentElement, t=n.textContent.trim();
          if(t.length>=45 && t.split(/\s+/).length>=6 && !p.closest('svg,table,button,select,[role=tooltip]') && p.checkVisibility({checkVisibilityCSS:true}) && p.getClientRects().length) sentences.push(t);
        }
        return {sentences,characters:sentences.join(' ').length,words:sentences.join(' ').split(/\s+/).filter(Boolean).length,headings:[...root.querySelectorAll('h1,h2')].map(e=>e.textContent),overflow:root.scrollWidth>root.clientWidth};
      });
      await Promise.all(reads);
      results.push({name,width,height,copy,requests,logs});
      await page.close();
    }
  } finally { await browser.close(); }
  writeFileSync(path.join(dir,stage+'.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(({name,copy,requests,logs})=>({name,copy,requests,logs})),null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
