const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');
const { startVite, stopProcessTree, waitForServer } = require('./helpers/browser-uat.cjs');

const rootDir = path.resolve(__dirname, '..');
const baseUrl = 'http://127.0.0.1:5192';
const screenshotDir = path.join(rootDir, 'uat_screenshots', 'sector-rotation');

async function fixture() {
  if (process.env.SECTOR_ROTATION_UAT_FIXTURE) {
    return JSON.parse(fs.readFileSync(process.env.SECTOR_ROTATION_UAT_FIXTURE, 'utf8'));
  }
  const { buildSectorRotationSnapshot } = await import(pathToFileURL(path.join(rootDir, 'src/lib/sector-rotation.ts')).href);
  const { MARKET_BREADTH_SECTORS } = await import(pathToFileURL(path.join(rootDir, 'src/lib/market-breadth.ts')).href);
  const { isNyseTradingDay } = await import(pathToFileURL(path.join(rootDir, 'src/lib/nyse-calendar.ts')).href);
  const dates = [];
  for (let date = new Date('2026-09-25T12:00:00Z'); dates.length < 420; date.setUTCDate(date.getUTCDate() - 1)) {
    const value = date.toISOString().slice(0, 10);
    if (isNyseTradingDay(value)) dates.unshift(value);
  }
  const sectorWeights = MARKET_BREADTH_SECTORS.map((row, i) => ({ ...row, weightPct: i === 10 ? 10 : 9, holdingCount: 5 }));
  const holdings = sectorWeights.flatMap((row, sector) => Array.from({ length: 5 }, (_, stock) => ({
    ticker: `TEST${sector}-${stock}`, name: `Fixture stock ${sector}-${stock}`,
    sector: row.sector, sectorEtf: row.etf, weightPct: row.weightPct / 5,
  })));
  const series = new Map();
  const bars = (slope, wave = 0) => dates.map((date, i) => ({ date, close: 100 * Math.exp(slope * i + wave * Math.sin(i / 18)) }));
  series.set('SPY', bars(0.0006));
  sectorWeights.forEach((row, i) => series.set(row.etf, bars(0.0002 + i * 0.00009, 0.025)));
  holdings.forEach((row, i) => series.set(row.ticker, bars(0.0001 + (i % 9) * 0.00012, 0.035)));
  const snapshot = buildSectorRotationSnapshot({
    universe: { holdingsAsOf: '2026-09-24', holdings, sectorWeights, universeCount: holdings.length, totalWeightPct: 100 },
    priceSeries: series, priceAsOf: '2026-09-25', generatedAt: '2026-09-26T17:18:00.000Z',
    sourceSnapshotId: 'market-breadth-v1-2026-09-25-uat',
  });
  return { ...snapshot, status: 'READY', freshness: { status: 'FRESH', reason: 'CURRENT' } };
}

async function clickButton(page, text) {
  const found = await page.$$eval('button', (buttons, expected) => {
    const target = buttons.find(button => button.textContent.trim() === expected);
    if (!target) return false;
    target.click();
    return true;
  }, text);
  assert.equal(found, true, `Missing button: ${text}`);
}

async function assertRelativeSectors(page, payload, windowKey, windowLabel) {
  await page.waitForFunction(label => document.querySelector('[aria-label="Return window"] button[aria-pressed="true"]').textContent.trim() === label, {}, windowLabel);
  const available = payload.sectors.filter(row => row.performance[windowKey].length > 0);
  const rendered = await page.$eval('[data-testid="relative-performance-chart"]', chart => ({
    lines: Array.from(chart.querySelectorAll('polyline')).map(line => ({
      sector: line.querySelector('title').textContent.split(': ')[0],
      points: line.getAttribute('points').trim().split(/\s+/).length,
    })),
    labels: Array.from(chart.parentElement.querySelectorAll('[aria-label="Relative strength plotted sectors"] button')).map(button => button.textContent.trim()),
  }));
  assert.deepEqual(rendered.lines, available.map(row => ({ sector: row.sector, points: row.performance[windowKey].length })), `${windowLabel} must plot every available sector's full relative line`);
  assert.deepEqual(rendered.labels, available.map(row => row.etf), `${windowLabel} legend must include every plotted sector`);
}

(async () => {
  let server;
  let browser;
  let mode = 'READY';
  const errors = [];
  const payload = await fixture();
  fs.mkdirSync(screenshotDir, { recursive: true });
  try {
    server = startVite({ rootDir, port: 5192, host: '127.0.0.1' });
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('status of 503')) errors.push(message.text()); });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (!request.url().includes('/api/sector-rotation')) return request.continue();
      const body = mode === 'ERROR'
        ? { status: 'ERROR', errorCode: 'SOURCE_UNAVAILABLE', message: 'Fixture source unavailable.' }
        : mode === 'INVALID' ? { ...payload, holdings: [] }
          : mode === 'STALE' ? { ...payload, freshness: { status: 'STALE', reason: 'LATEST_REFRESH_FAILED', errorClass: 'PROVIDER_UNAVAILABLE' } }
            : payload;
      return request.respond({ status: mode === 'ERROR' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('button[aria-label*="SPY Sector Rotation"]');
    await page.click('button[aria-label*="SPY Sector Rotation"]');
    await page.waitForFunction(() => location.hash === '#/work/sector-rotation');
    await page.waitForSelector('[data-testid="sector-ranking"]');
    assert.equal(await page.$$eval('[data-testid="sector-ranking"] tbody tr', rows => rows.length), 11);
    await page.waitForSelector('[data-testid="rotation-chart"]');
    await page.waitForSelector('[data-testid="relative-performance-chart"]');
    await assertRelativeSectors(page, payload, 'oneMonth', '1M');
    await clickButton(page, 'RS 1M');
    const ranking = await page.$$eval('[data-testid="sector-ranking"] tbody tr', rows => rows.map(row => row.getAttribute('data-sector-etf')));
    const expectedRanking = [...payload.sectors].sort((a, b) => a.relativeToSpy.oneMonth === null ? 1 : b.relativeToSpy.oneMonth === null ? -1 : a.relativeToSpy.oneMonth - b.relativeToSpy.oneMonth).map(row => row.etf);
    assert.deepEqual(ranking, expectedRanking, 'Sector sorting must change numerical order');
    const utilityDot = await page.$('[data-testid="rotation-chart"] circle[data-etf="XLU"]');
    await utilityDot.evaluate(circle => circle.focus());
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="selected-sector"]').textContent.includes('Utilities'));
    assert.equal(await page.$eval('[data-testid="rotation-chart"] circle[data-etf="XLU"]', circle => circle.getAttribute('aria-pressed')), 'true');
    await assertRelativeSectors(page, payload, 'oneMonth', '1M');
    await page.screenshot({ path: path.join(screenshotDir, 'desktop.png'), fullPage: true });

    const sector = payload.sectors.find(row => row.etf === 'XLK');
    await page.click('[data-testid="sector-ranking"] tr[data-sector-etf="XLK"] button');
    await page.waitForFunction(name => document.querySelector('[data-testid="selected-sector"]').textContent.includes(name), {}, sector.sector);
    await assertRelativeSectors(page, payload, 'oneMonth', '1M');
    const selectedHoldings = payload.holdings.filter(row => row.sector === sector.sector);
    const search = await page.$('input[aria-label="Search stocks"]');
    assert.ok(search, 'Stock search must have an accessible label');
    await search.type(selectedHoldings[0].ticker);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="stock-table"] tbody tr').length === 1);
    assert.match(await page.$eval('[data-testid="stock-table"]', table => table.textContent), new RegExp(selectedHoldings[0].ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await search.click({ clickCount: 3 });
    await search.press('Backspace');
    await clickButton(page, 'Stock');
    await clickButton(page, 'Stock');
    const stockOrder = await page.$$eval('[data-testid="stock-table"] tbody tr th strong', rows => rows.map(row => row.textContent));
    assert.deepEqual(stockOrder, selectedHoldings.map(row => row.ticker).sort((a, b) => a.localeCompare(b)), 'Stock sorting must change ticker order');
    await clickButton(page, '12M');
    await assertRelativeSectors(page, payload, 'twelveMonths', '12M');
    await clickButton(page, '4w');
    await page.screenshot({ path: path.join(screenshotDir, 'selected-sector.png'), fullPage: true });
    await page.$eval('.sr-drilldown', section => section.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(screenshotDir, 'desktop-drilldown.png') });

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.screenshot({ path: path.join(screenshotDir, 'mobile.png'), fullPage: true });
    const scroll = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    assert.ok(scroll.width <= scroll.viewport + 1, `Page horizontal overflow: ${JSON.stringify(scroll)}`);
    assert.ok(scroll.height > 844, 'Mobile page should permit vertical scrolling');
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.evaluate(() => window.scrollBy(0, 600));
    assert.ok(await page.evaluate(() => scrollY) > scrollBefore, 'Mobile scrolling is blocked');

    mode = 'STALE';
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="stale-banner"]');
    assert.equal(await page.$$eval('[data-testid="sector-ranking"] tbody tr', rows => rows.length), 11);
    mode = 'INVALID';
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="rotation-error"]');
    assert.equal(await page.$('[data-testid="sector-ranking"]'), null, 'Corrupt response must not display data');
    mode = 'ERROR';
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="rotation-error"]');
    mode = 'READY';
    await clickButton(page, 'Retry');
    await page.waitForSelector('[data-testid="sector-ranking"]');
    assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
    process.stdout.write(`${JSON.stringify({ status: 'PASS', sectors: 11, constituents: payload.holdings.length, desktop: true, mobile: true, selection: true, search: true, windows: true, stale: true, invalid: true, retry: true, consoleErrors: 0 })}\n`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
