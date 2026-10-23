const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { startVite, stopProcessTree, waitForServer } = require('./helpers/browser-uat.cjs');

(async () => {
  const rootDir = path.resolve(__dirname, '..');
  const base = 'http://localhost:5195';
  const server = startVite({ rootDir, port: 5195 });
  let browser;
  try {
    await waitForServer(base);
    const { buildSpxPriceActionCompassResponse } = await import('../src/lib/spx-price-action-compass.ts');
    const { buildSpxGexPressureMatrixFromFrames } = await import('../src/lib/spx-gex-pressure-matrix.ts');
    browser = await puppeteer.launch({ headless: true });
    for (const sample of ['2026-10-22T19:59:00Z', '2026-11-27T17:59:00Z']) {
      const date = sample.slice(0, 10), initial = Date.parse(sample);
      const page = await browser.newPage();
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.evaluateOnNewDocument(initial => {
        const RealDate = Date;
        let now = initial, timerId = -1;
        const timers = new Map();
        window.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [now])); }
          static now() { return now; }
        };
        const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
        window.setTimeout = (callback, delay = 0, ...args) => {
          if (delay < 1000) return set(callback, delay, ...args);
          const id = timerId--;
          timers.set(id, { at: now + delay, callback: () => callback(...args) });
          return id;
        };
        window.clearTimeout = id => id < 0 ? timers.delete(id) : clear(id);
        window.advanceClock = ms => {
          now += ms;
          for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
            if (timer.at <= now && timers.delete(id)) timer.callback();
          }
        };
      }, initial);
      await page.setRequestInterception(true);
      const candles = Array.from({ length: 60 }, (_, i) => ({ time: initial - (59 - i) * 60000, date_iso: date, open: 6000, high: 6002, low: 5998, close: 6001, volume: 100 }));
      const source = { provider: '0dtespx', label: 'Clock regression fixture', symbol: 'SPX', range: 'fixture', interval: '1m', fetchedAt: sample,
        sessionState: 'LIVE', sessionDate: date, status: 'READY', latestSampleAt: sample, note: 'Synthetic fixture',
        expectedMove: { status: 'READY', value: 25, sampleAt: sample, errorCode: null } };
      const pressure = buildSpxGexPressureMatrixFromFrames([{ tradingDate: date, snapshotMinuteEt: 570, snapshotTimeEt: '09:30', collectedMinuteEt: 585,
        collectedTimeEt: '09:45', spot: 6000, expiry: date, calculationEngineVersion: 2, provider: 'd1', fallbackFrom: null,
        sourceTimestamp: sample, snapshotId: 'clock-fixture', gexByStrike: [{ strike: 6000, netGex: 10 }] }], { includeAvailableStrikes: true });
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return void request.continue();
        requests.push(url.pathname + url.search);
        const payload = url.pathname === '/api/spx-gex-pressure'
          ? { status: 'READY', errorCode: null, selectedDate: date, pressure, invalidSnapshots: [], collectionAttempts: [], warnings: [] }
          : url.searchParams.get('view') === 'price-overlay'
            ? { ticker: 'SPX', timeframe: '1m', candles, source, warnings: [] }
            : buildSpxPriceActionCompassResponse({ timeframe: url.searchParams.get('timeframe') || '5m', candles, source });
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      });
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.evaluate(async date => {
        const React = (await import('/node_modules/.vite/deps/react.js')).default;
        const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
        const { SpxPriceActionCompass } = await import('/src/components/spx-price-action-compass.tsx');
        const { SpxGexPressureMatrix } = await import('/src/components/spx-gex-pressure-matrix.tsx');
        document.getElementById('root').style.display = 'none';
        const host = document.createElement('div'); document.body.append(host);
        function Harness() {
          const [spot, setSpot] = React.useState(null);
          return React.createElement('div', null,
            React.createElement('p', { 'data-overview-spot': true }, spot ? 'LIVE spot' : 'Canonical snapshot'),
            React.createElement(SpxPriceActionCompass, { selectedDate: date }),
            React.createElement(SpxGexPressureMatrix, { selectedDate: date, selectedMinute: 570, pressureRefreshKey: 0, controls: null, onSpotContextChange: setSpot }));
        }
        createRoot(host).render(React.createElement(Harness));
      }, date);
      await page.waitForSelector('[data-spx-gex-pressure-live-spot="true"]');
      await page.waitForFunction(() => document.querySelector('[data-pa-source-status]')?.dataset.paSourceStatus === 'READY');
      assert.equal(await page.$eval('[data-overview-spot]', el => el.textContent), 'LIVE spot');
      const initialReads = requests.length;
      await page.evaluate(() => advanceClock(60_000)); // 16:00 regular / 13:00 early close.
      assert.equal(await page.$eval('[data-pa-source-status]', el => el.dataset.paSourceStatus), 'READY');
      await page.evaluate(() => advanceClock(540_001));
      await page.waitForFunction(() => document.querySelector('[data-pa-source-status]')?.dataset.paSourceStatus === 'STALE');
      await page.waitForFunction(() => !document.querySelector('[data-spx-gex-pressure-live-spot="true"]'));
      await page.waitForFunction(() => document.querySelector('[data-overview-spot]')?.textContent === 'Canonical snapshot');
      assert.match(await page.$eval('[data-spx-price-action-compass]', el => el.textContent), /STALE price context/);
      assert.match(await page.$eval('[data-pa-source-panel]', el => el.textContent), /Status STALE/);
      assert.equal(await page.$('[data-spx-gex-pressure-expected-move-status="STALE"]') !== null, true, 'EM must age with spot');
      assert.equal(await page.$('.spx-spot-live-pulse'), null, 'Every live pulse must stop');
      assert.equal(requests.length, initialReads, 'Closing/expiry must not start extra requests');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('SPX close freshness DOM UAT passed: regular/early close, Compass/spot/EM/overview age together, no post-close API reads.');
  } finally {
    await browser?.close();
    await stopProcessTree(server);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
