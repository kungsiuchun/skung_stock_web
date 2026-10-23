const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot, candles } = require('./finance-workspace-fixture.cjs');

module.exports = async function verifyWorkspace(browser, baseUrl, screenshots) {
  fs.mkdirSync(screenshots, { recursive: true });
  const page = await browser.newPage();
  const errors = [], requests = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/finance-dashboard/snapshot') {
      const { symbol } = JSON.parse(request.postData()); requests.push(symbol);
      const payload = snapshot(symbol === 'WRONG' ? 'OTHER' : symbol);
      if (symbol === 'STALE') { payload.cache.status = 'stale'; payload.cache.ageSeconds = 180; payload.cache.refreshError = 'UAT source timeout'; }
      if (symbol === 'PARTIAL') { payload.data.technicalData = { error: 'UAT technical unavailable' }; payload.data.valuationData = { error: 'UAT valuation unavailable' }; }
      if (symbol === 'BADBAR') payload.data.data.chartData[payload.data.data.chartData.length-1].price = 0;
      setTimeout(() => { void request.respond({ status: symbol === 'FAIL' ? 503 : symbol === 'PARTIAL' ? 206 : 200, contentType: 'application/json',
        body: JSON.stringify(symbol === 'FAIL' ? { error: 'UAT controlled failure' } : payload) }).catch(error => { if (!/invalid|closed|interception|Target/i.test(error.message)) errors.push(error.message); }); }, symbol === 'MSFT' ? 400 : 20);
    } else if (url.pathname === '/api/candlestick-patterns') {
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(candles(url.searchParams.get('symbol'), url.searchParams.get('interval'))) });
    } else if (url.pathname.startsWith('/api/')) void request.respond({status: 503, contentType:'application/json', body:'{"error":"UAT unused endpoint"}'});
    else if (url.hostname !== 'localhost') { externalRequests.push(url.hostname); void request.abort(); }
    else void request.continue();
  });
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.setViewport({width:1440,height:900});
  await page.goto(`${baseUrl}/#/work/finance-analyzer`, {waitUntil:'networkidle0'});
  await page.waitForSelector('input[name="finance-symbol"]');
  await page.screenshot({path:path.join(screenshots,'empty-1440.png')});
  const search = async symbol => {
    await page.$eval('input[name="finance-symbol"]', input => input.focus());
    await page.click('input[name="finance-symbol"]', {clickCount:3});
    await page.keyboard.press('Backspace'); await page.type('input[name="finance-symbol"]', symbol); await page.keyboard.press('Enter');
  };
  const selected = async symbol => page.waitForFunction(symbol => document.querySelector('[aria-label="標的摘要"]')?.getAttribute('data-symbol') === symbol, {}, symbol);
  await search('AAPL'); await selected('AAPL');
  await page.waitForSelector('[data-price-chart] canvas');
  await page.evaluate(() => { window.financeChartCanvas = document.querySelector('[data-price-chart] canvas'); });
  assert.match(await page.$eval('[aria-label="標的摘要"]', node => node.textContent), /快照來源時間：時間未提供/);
  assert.doesNotMatch(await page.$eval('[data-finance-workspace]', node => node.textContent), /ALL API NOMINAL|AI AGENT ACTIVE|多模態金融/);
  for (const [width,height] of [[390,844],[768,1024],[1159,804],[1440,900]]) {
    await page.setViewport({width,height});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(() => { window.scrollTo(0,0); document.querySelector('[data-finance-workspace]').scrollTo(0,0); document.activeElement?.blur(); });
    const layout = await page.evaluate(() => {
      const chart = document.querySelector('[data-price-chart]').getBoundingClientRect();
      const search = document.querySelector('input[name="finance-symbol"]').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, chartHeight: chart.height, chartTop:chart.top, chartBottom:chart.bottom,
        searchFits: search.left >= 0 && search.right <= innerWidth,
        overflowing: [...document.querySelectorAll('[data-finance-workspace] *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,5).map(node=>({tag:node.tagName,width:node.getBoundingClientRect().width,right:node.getBoundingClientRect().right})),
        undersized: [...document.querySelectorAll('[data-finance-workspace] button, [role="tab"]')].filter(node => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 44).map(node=>node.textContent) };
    });
    assert.equal(layout.overflow,false,`No horizontal overflow at ${width}: ${JSON.stringify(layout)}`); assert.equal(layout.searchFits,true);
    assert.ok(layout.chartHeight >= 360); assert.deepEqual(layout.undersized,[]);
    if(width===1440) assert.ok(layout.chartBottom <= height,`Complete chart must be visible: ${JSON.stringify(layout)}`);
    if(width===1159) assert.ok(layout.chartTop < height,'Chart must be visible at 1159');
    await page.screenshot({path:path.join(screenshots,`fixture-${width}.png`),fullPage:true});
  }
  for (const tab of ['options','fundamentals','news','ai','technical']) {
    await page.click(`#research-tab-${tab}`);
    await page.waitForSelector(`#research-panel-${tab}`);
    assert.equal(await page.$eval('[aria-label="研究資料"]',node=>node.dataset.symbol),'AAPL');
  }
  assert.equal(await page.evaluate(()=>document.querySelector('[data-price-chart] canvas')===window.financeChartCanvas),true,'Tabs preserve chart instance');
  assert.deepEqual(requests,['AAPL'],'Tabs do not start another analysis');
  assert.equal(externalRequests.some(host=>host.includes('financialjuice')),false,'Collapsed external feed must not load');
  for (const [width,height] of [[390,844],[1440,900]]) {
    await page.setViewport({width,height});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(width===390) assert.ok(await page.evaluate(()=>document.querySelector('[aria-label="研究資料"]').getBoundingClientRect().top < document.querySelector('[aria-label="研究快覽"]').getBoundingClientRect().top),'Mobile research tabs precede secondary risk details');
    for(const tab of ['options','fundamentals','news','ai']) {
      await page.click(`#research-tab-${tab}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${tab} fits at ${width}`);
      await page.evaluate(() => { window.scrollTo(0,0); document.querySelector('[data-finance-workspace]').scrollTo(0,0); document.activeElement?.blur(); });
      await page.screenshot({path:path.join(screenshots,`${tab}-${width}.png`),fullPage:true});
    }
  }
  await page.focus('#research-tab-technical'); await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('[role="tab"][aria-selected="true"]',node=>node.id),'research-tab-options');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'research-tab-options');
  assert.equal(await page.$eval('#research-tab-options',node=>getComputedStyle(node).outlineStyle),'solid');
  await page.click('#research-tab-news');
  assert.match(await page.$eval('#research-panel-news',node=>node.textContent),/Fixture publisher.*2026-09-23/s,'News preserves publisher and publication time');
  assert.match(await page.$eval('#research-panel-news',node=>node.textContent),/發布時間未提供/,'Undated news must expose missing time instead of hiding or fabricating it');
  await page.click('#research-tab-options');
  assert.ok(await page.$eval('#research-panel-options a[href*="stocks-intelligence-watcher"]',node=>node.getBoundingClientRect().height>=44),'Watcher action must have a touch-sized target');
  await page.click('#research-tab-news');
  const externalDetails = await page.$('#research-panel-news summary'); await externalDetails.click();
  await page.waitForSelector('iframe[title="FinancialJuice real-time news feed"]');
  await page.click('details[aria-label="資料來源與方法"] summary');
  assert.equal(await page.$eval('details[aria-label="資料來源與方法"]',node=>node.open),true);
  assert.match(await page.$eval('details[aria-label="資料來源與方法"]',node=>node.textContent),/並非連線狀態/);
  await page.click('button::-p-text(顯示型態)');
  await page.waitForSelector('[aria-label="K 線型態分析"]');
  await page.click('[aria-label="K 線時段"] button::-p-text(週線)');
  await page.waitForFunction(()=>document.querySelector('[aria-label="K 線型態分析"]')?.textContent.includes('週線型態分析'));
  await page.click('button::-p-text(隱藏型態)');
  await page.click('button::-p-text(AI 對話)'); await page.waitForSelector('input[name="finance-question"]');
  await page.click('button::-p-text(返回研究)'); await selected('AAPL');
  await search('MSFT'); await page.waitForFunction(()=>document.querySelector('[aria-label="Finance Analyzer loading"]'));
  await page.focus('input[name="finance-symbol"]'); await page.keyboard.press('Enter');
  await search('NVDA'); await selected('NVDA');
  await new Promise(resolve=>setTimeout(resolve,500)); await selected('NVDA');
  assert.equal(requests.filter(s=>s==='MSFT').length,1,'Repeated submit for the same pending ticker is deduplicated');
  await page.click('[aria-label="最近研究"] button::-p-text(AAPL)'); await selected('AAPL');
  assert.match(await page.$eval('[aria-label="標的摘要"]',node=>node.textContent),/已儲存研究/);
  assert.match(await page.$eval('#research-panel-technical',node=>node.textContent),/技術指標未提供/,'History clears unrelated technical context');
  await page.click('button[aria-label="刷新 AAPL"]'); await selected('AAPL');
  await search('STALE'); await selected('STALE');
  assert.match(await page.$eval('[aria-label="標的摘要"]',node=>node.textContent),/180 秒前資料.*UAT source timeout/);
  await search('PARTIAL'); await selected('PARTIAL');
  assert.match(await page.$eval('#research-panel-technical',node=>node.textContent),/UAT technical unavailable/);
  await page.click('#research-tab-fundamentals');
  assert.match(await page.$eval('#research-panel-fundamentals',node=>node.textContent),/UAT valuation unavailable/);
  await search('BADBAR'); await selected('BADBAR');
  assert.match(await page.$eval('[aria-label="研究快覽"]',node=>node.textContent),/風險指標已停止計算/);
  assert.match(await page.$eval('[aria-label="BADBAR 價格與成交量"]',node=>node.textContent),/1 筆日線價量資料無效/);
  assert.doesNotMatch(await page.$eval('[aria-label="研究快覽"]',node=>node.textContent),/\$0|-[0-9]+%/);
  await search('WRONG'); await page.waitForFunction(()=>document.body.textContent.includes('回傳標的與查詢不符'));
  assert.equal(await page.$('[aria-label="標的摘要"]'),null,'Mismatched ticker must not render');
  await search('FAIL'); await page.waitForFunction(()=>document.body.textContent.includes('UAT controlled failure'));
  await search('NVDA'); await selected('NVDA');
  await page.click('a[aria-label="Back to Market Lab"]');
  await page.waitForFunction(()=>location.hash==='#/market-lab');
  assert.deepEqual(errors,[],'No uncaught page errors');
  fs.writeFileSync(path.join(screenshots,'evidence.json'),JSON.stringify({fixture:true,viewports:[390,768,1159,1440],requests,uncaughtErrors:errors,verified:['success','tabs-no-analysis','chart-retained','keyboard-focus','news-provenance','deferred-feed','chart-interval','chat-return','request-race','pending-deduplication','history','refresh','stale','partial','invalid-bar-visible-no-risk-metrics','mismatch','failure-retry','gallery-return']},null,2));
  await page.close();
};
