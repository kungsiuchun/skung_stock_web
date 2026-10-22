const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.NEWSROOM_UAT_PORT || 5193);
const baseUrl = `http://127.0.0.1:${port}`;
const requests = [];
let newsMode = "success";
let pulseFails = false;
let delayedResponse;
const stock = (symbol) => ({ symbol, companyName: `${symbol} fixture company`, sector: "Technology", type: "Stock", price: 200, change: 2, changePercent: 1, asOf: "2026-10-20T20:00:00Z" });
const snapshot = (symbol) => ({
  symbol, generatedAt: "2026-10-20T20:00:00Z", quote: stock(symbol), spot: 200, atm: 200,
  selectedTimeLabel: "close", gexRegime: "Unavailable", putCallOpenInterest: 0, putCallVolume: 0, sweeps: 0,
  availableExpiries: [], selectedExpiry: null, expiryRows: [], expiries: [], strikes: [], history: [], recentNews: [],
  earnings: { source: "Fixture", nextEarningsDate: null }, valuation: null, financials: null,
  marketContext: { breadth: "Fixture", relativeStrength: "Fixture" }, availableTools: [], toolRuns: [], warnings: [],
});
const articles = (symbol) => Array.from({ length: 12 }, (_, index) => ({
  title: `${symbol} article ${index + 1}${index === 11 ? ": " + "Long headline without losing context ".repeat(5) : ""}`,
  publisher: index % 2 ? "Source Two" : "Source One",
  link: `https://example.com/${symbol}/${index + 1}`,
  publishedAt: `2026-10-20T${String(index).padStart(2, "0")}:00:00Z`,
}));
const reply = (res, data, status = 200) => {
  if (res.destroyed) return;
  res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data));
};

(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({ root: rootDir, server: { host: "127.0.0.1", port, strictPort: true }, plugins: [{
    name: "newsroom-mock-api",
    configureServer(vite) {
      vite.middlewares.use("/api", (req, res) => {
        const url = new URL(req.url, baseUrl);
        if (url.pathname !== "/stocks-intelligence-watcher") return reply(res, { status: "EMPTY", errorCode: "MOCK_NOT_IN_SCOPE", message: "Outside this mock's scope" });
        if (req.method === "GET") return reply(res, snapshot(url.searchParams.get("symbol") || "NVDA"));
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          const { tool, params = {} } = JSON.parse(body);
          const symbol = params.ticker || params.symbol || "NVDA";
          requests.push({ tool, params });
          let raw = {};
          if (tool === "get_watchlist") raw = { stocks: [stock("NVDA"), stock("AAPL")] };
          if (tool === "get_quotes") raw = { quotes: [stock("NVDA"), stock("AAPL")] };
          if (tool === "morning_briefing") {
            if (pulseFails) return reply(res, { ok: false, error: "Fixture market pulse unavailable" }, 503);
            raw = { briefingQuotes: [stock("NVDA"), { ...stock("AAPL"), changePercent: -2 }], focus: "market watch" };
          }
          if (tool === "pre_event_brief") {
            if (newsMode === "error") return reply(res, { ok: false, error: "Fixture news unavailable" }, 503);
            raw = { source: "native_yahoo", news: newsMode === "empty" ? [] : articles(symbol), oneMonthReturn: -5.42,
              stats: { quote: { ...stock(symbol), exchange: "NMS" }, summary: { defaultKeyStatistics: { forwardPE: { raw: 13.6 }, beta: { raw: 2.216 } } } } };
            if (newsMode === "malformed") raw.news = { invalid: true };
            if (newsMode === "differentSource") raw.news = raw.news.map(article => ({ ...article, publisher: 'Source Three' }));
            if (newsMode === "mismatch") raw.stats.quote.symbol = "WRONG";
            if (newsMode === "mixed") raw.news.push(raw.news[0], null, { title: {} }, {
              title: "Unsafe target with missing metadata", link: "javascript:alert(1)", publishedAt: "2026-02-30T12:00:00Z",
            });
            if (newsMode === "delay" && symbol === "NVDA") { delayedResponse = () => reply(res, { ok: true, tool, raw, text: "raw delayed NVDA" }); return; }
          }
          reply(res, { ok: true, tool, raw, text: `raw ${tool} fixture report` });
        });
      });
    },
  }] });
  await server.listen();
  if (process.argv.includes("--serve")) { console.log(`Mock-only Newsroom preview: ${baseUrl}/#/work/stocks-intelligence-watcher`); return; }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      const fixtureFailure = /Failed to load resource:.*status of 503/.test(message.text()) && message.location().url?.includes('/api/stocks-intelligence-watcher');
      if (message.type() === 'error' && !fixtureFailure) errors.push(message.text());
    });
    await page.setViewport({ width: 1562, height: 956 });
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".siw-main-tabs");
    await page.$eval(".siw-main-tabs", node => Array.from(node.querySelectorAll("button")).find(button => button.textContent.trim() === "News").click());
    await page.waitForSelector("[data-newsroom] [data-news-article]", { timeout: 5000 });
    assert.equal(await page.$$eval("[data-news-article]", nodes => nodes.length), 12, "Show all twelve source headlines, not raw tool reports or Overview's three-item subset");
    assert.equal(requests.filter(item => item.tool === "morning_briefing").length, 0, "Opening News must not fetch universe quotes");
    const click = async (text) => {
      const handles = await page.$$('[data-newsroom] button');
      for (const handle of handles) {
        if ((await handle.evaluate(node => node.textContent)).trim() === text) { await handle.click(); return; }
      }
      throw new Error(`Visible button missing: ${text}`);
    };
    const count = () => page.$$eval("[data-news-article]", nodes => nodes.length);
    const ready = () => page.waitForFunction(() => document.querySelectorAll('[data-news-article]').length === 12);
    const content = () => page.$eval('[data-newsroom]', node => node.innerText);
    assert.doesNotMatch(await content(), /raw pre_event_brief|raw morning_briefing/, "Raw reports must stay behind closed data details");
    assert.match(await page.$eval('[data-news-article] h4', node => node.textContent), /NVDA article 12/);
    const beforeFilters = requests.length;
    await page.type('input[name="news-search"]', 'article 4');
    assert.equal(await count(), 1);
    await page.select('select[name="news-source"]', 'Source Two');
    await page.$eval('input[name="news-search"]', node => node.focus());
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
    assert.equal(await count(), 6);
    await click('Compact');
    assert.equal(await page.$eval('[data-newsroom] button[aria-pressed="true"]', node => node.textContent), 'Compact');
    await page.type('input[name="news-search"]', 'no matching example');
    assert.match(await content(), /No matching headlines/);
    const clear = await page.waitForSelector('button::-p-text(Clear filters)');
    await clear.focus(); await page.keyboard.press('Enter');
    await ready();
    await click('Cards');
    assert.equal(requests.length, beforeFilters, "Search, source filtering and layout changes must not fetch any APIs");

    pulseFails = true;
    await page.click('.siw-newsroom-context > details > summary');
    await page.waitForFunction(() => document.querySelector('[data-newsroom]').innerText.includes('Fixture market pulse unavailable'));
    assert.equal(await count(), 12, "A failed briefing must not remove the article feed");
    pulseFails = false;
    const articleRequestsBeforePulseRetry = requests.filter(item => item.tool === 'pre_event_brief').length;
    await click('Retry market pulse');
    await page.waitForFunction(() => document.querySelector('.siw-newsroom-pulse')?.innerText.includes('2 supplied assets'));
    assert.equal(requests.filter(item => item.tool === 'pre_event_brief').length, articleRequestsBeforePulseRetry);
    const pulseRequests = requests.filter(item => item.tool === 'morning_briefing').length;
    await page.click('.siw-newsroom-context > details > summary');
    await page.click('.siw-newsroom-context > details > summary');
    await page.waitForFunction(() => document.querySelector('.siw-newsroom-pulse')?.innerText.includes('2 supplied assets'));
    assert.equal(requests.filter(item => item.tool === 'morning_briefing').length, pulseRequests, 'Reopening the briefing should use the existing page cache');
    await page.click('.siw-newsroom-context > details > summary');

    const screenshots = path.join(rootDir, 'uat_screenshots', 'watcher-newsroom');
    fs.mkdirSync(screenshots, { recursive: true });
    for (const width of [390, 768, 1440, 1562]) {
      await page.setViewport({ width, height: width === 1562 ? 956 : 844 });
      await page.$eval('[data-newsroom]', node => node.scrollIntoView({ block: 'start' }));
      const proof = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        controls: Array.from(document.querySelectorAll('[data-newsroom] button,[data-newsroom] input,[data-newsroom] select,[data-newsroom] summary,[data-news-article] footer a'))
          .filter(node => node.getClientRects().length).every(node => node.getBoundingClientRect().height >= 44 && node.getBoundingClientRect().width >= 44),
        named: Array.from(document.querySelectorAll('[data-newsroom] input,[data-newsroom] select')).every(node => node.name && node.labels.length),
        urls: Array.from(document.querySelectorAll('[data-news-article] a')).every(node => node.target === '_blank' && node.rel.includes('noopener') && node.rel.includes('noreferrer')),
      }));
      assert.deepEqual(proof, { overflow: false, controls: true, named: true, urls: true }, `Responsive navigation and touch targets at ${width}px`);
      await page.focus('input[name="news-search"]'); await page.keyboard.press('Tab');
      assert.equal(await page.$eval('select[name="news-source"]', node => node === document.activeElement), true);
      await page.screenshot({ path: path.join(screenshots, `newsroom-${width}.png`) });
      if (width === 390) {
        for (let tab = 0; tab < 28; tab += 1) {
          await page.keyboard.press('Tab');
          const focused = await page.evaluate(() => {
            const node = document.activeElement;
            if (!node.matches('[data-news-article] footer a')) return null;
            return { bottom: node.getBoundingClientRect().bottom, navTop: document.querySelector('.siw-mobile-nav').getBoundingClientRect().top };
          });
          if (focused) assert.ok(focused.bottom <= focused.navTop, 'A keyboard-focused original-article link must not be hidden behind mobile navigation');
        }
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.select('select[name="news-source"]', 'Source Two');
    newsMode = 'differentSource'; await click('Refresh news');
    await page.waitForFunction(() => document.querySelector('[data-newsroom]').innerText.includes('No matching headlines'));
    assert.match(await page.$eval('select[name="news-source"]', node => node.selectedOptions[0].textContent), /Source Two \(no articles\)/, 'A selected source missing after refresh must remain visible, not falsely show All sources');
    await click('Clear filters'); await ready();
    for (const mode of ['error', 'empty', 'malformed', 'mismatch', 'mixed']) {
      newsMode = mode;
      await click('Refresh news');
      if (mode === 'error') {
        await page.waitForFunction(() => document.querySelector('[data-newsroom]').innerText.includes('Fixture news unavailable'));
        assert.equal(await count(), 0);
        newsMode = 'success'; await click('Retry news'); await ready();
      } else if (mode === 'empty') {
        await page.waitForFunction(() => document.querySelector('[data-newsroom]').innerText.includes('No headlines received'));
      } else if (mode === 'malformed') {
        await page.waitForFunction(() => document.querySelector('[data-newsroom]').innerText.includes('did not return structured news'));
      } else if (mode === 'mismatch') {
        await page.waitForFunction(() => document.querySelector('[data-newsroom]').innerText.includes('different ticker'));
      } else {
        await page.waitForFunction(() => document.querySelectorAll('[data-news-article]').length === 13);
        assert.equal(await page.$('[data-newsroom] a[href^="javascript:"]'), null);
        assert.match(await content(), /Publication time unavailable/);
        assert.match(await content(), /2 malformed entries/);
        assert.doesNotMatch(await content(), /Invalid Date/);
      }
    }
    newsMode = 'delay';
    await click('Refresh news');
    await page.waitForFunction(() => document.querySelector('[data-newsroom]').getAttribute('aria-busy') === 'true' || document.querySelector('.siw-newsroom-feed').getAttribute('aria-busy') === 'true');
    const delayedDeadline = Date.now() + 5000;
    while (!delayedResponse && Date.now() < delayedDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(typeof delayedResponse, 'function', 'The bounded NVDA request must reach the mock API');
    await page.click('[data-watchlist-row="AAPL"]');
    await page.waitForFunction(() => document.querySelector('#siw-newsroom-title')?.textContent === 'AAPL Newsroom');
    await ready();
    const delayedDone = page.waitForResponse(response => {
      try { const body = JSON.parse(response.request().postData() || '{}'); return body.tool === 'pre_event_brief' && body.params.ticker === 'NVDA'; }
      catch { return false; }
    });
    delayedResponse(); await delayedDone;
    await page.waitForNetworkIdle({ idleTime: 100 });
    assert.match(await content(), /AAPL article 12/);
    assert.doesNotMatch(await content(), /NVDA article|raw delayed NVDA/, 'A late NVDA result must not repaint the current AAPL feed');
    assert.deepEqual(errors, []);
    console.log("Newsroom UAT passed: twelve cards, filters/layout without API calls, isolated pulse/retries/cache, malformed/empty/unsafe data, ticker races and 390/768/1440/1562px keyboard/touch/overflow checks.");
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
