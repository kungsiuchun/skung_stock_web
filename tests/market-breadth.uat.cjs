const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const puppeteer = require("puppeteer");

const rootDir = path.resolve(__dirname, "..");
const port = 5187;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotsDir = path.join(rootDir, "uat_screenshots", "market-breadth");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickButtonText = async (page, text, scope = "body") => {
  const clicked = await page.$$eval(`${scope} button`, (buttons, expected) => {
    const button = buttons.find((node) => (node.textContent || "").includes(expected));
    if (!button) return false;
    button.click();
    return true;
  }, text);
  assert.equal(clicked, true, `button containing "${text}" was not found in ${scope}`);
};

const stopProcessTree = (processToStop) => new Promise((resolve) => {
  if (!processToStop || processToStop.killed) return resolve();
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" });
    killer.on("close", resolve);
    killer.on("error", resolve);
    return;
  }
  processToStop.kill();
  resolve();
});

const waitForServer = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

const sectors = [
  ["Information Technology", "XLK", 37.61],
  ["Financials", "XLF", 12.26],
  ["Communication Services", "XLC", 9.81],
  ["Consumer Discretionary", "XLY", 9.29],
  ["Health Care", "XLV", 8.77],
  ["Industrials", "XLI", 8.7],
  ["Consumer Staples", "XLP", 4.51],
  ["Energy", "XLE", 3.19],
  ["Utilities", "XLU", 2.07],
  ["Real Estate", "XLRE", 1.83],
  ["Materials", "XLB", 1.96],
];

const readyPayload = (stale = false) => ({
  status: "READY",
  schemaVersion: 1,
  snapshotId: "market-breadth-v1-2026-08-11-uat",
  generatedAt: "2026-08-11T23:30:00.000Z",
  holdingsAsOf: "2026-08-11",
  priceAsOf: "2026-08-11",
  universeCount: 504,
  freshness: stale
    ? { status: "STALE", reason: "LATEST_REFRESH_FAILED", failedAt: "2026-08-12T23:30:00.000Z", errorClass: "PROVIDER_UNAVAILABLE" }
    : { status: "FRESH", reason: "CURRENT" },
  sectorPerformance: {
    benchmark: { symbol: "SPY", oneDay: -0.16, oneWeek: 3.62, oneMonth: 3.11, threeMonths: 5, yearToDate: 13.3 },
    rows: sectors.map(([sector, etf, weightPct], index) => ({
      sector, etf, weightPct,
      contribution1dPctPoints: Number((((weightPct / 100) * (index % 3 === 0 ? 0.28 : -0.34))).toFixed(4)),
      oneDay: index % 3 === 0 ? 0.28 : -0.34 - index * 0.03,
      oneWeek: 5.43 - index * 0.6,
      oneMonth: 2.13 + index * 0.17,
      threeMonths: 9.09 - index * 0.91,
      yearToDate: 29 - index * 2.4,
    })),
    proxyContribution1dPctPoints: -0.12,
    reconciliationGapPctPoints: -0.04,
  },
  breadth: {
    rows: sectors.map(([sector], index) => ({
      sector,
      holdingCount: 18 + index * 5,
      windows: Object.fromEntries([5, 20, 50, 100, 200].map((period, offset) => {
        const total = 18 + index * 5;
        const pct = Math.max(8, Math.min(92, 74 - index * 4 + offset * 2));
        const above = Math.round(total * pct / 100);
        return [`sma${period}`, { above, eligible: total, total, pct }];
      })),
    })),
  },
  sma200Slope: {
    rows: sectors.map(([sector, etf], index) => ({
      sector, etf,
      windows: {
        session5: Number((0.5 - index * 0.07).toFixed(2)),
        session20: Number((2.4 - index * 0.31).toFixed(2)),
        session50: Number((10.35 - index * 0.82).toFixed(2)),
        session100: Number((24.27 - index * 1.9).toFixed(2)),
        session200: Number((54.41 - index * 4.6).toFixed(2)),
      },
    })),
  },
  coverage: { currentPriceCount: 504, constituent200DayCount: 503, constituent200DayPct: 99.8, totalConstituents: 504, sectorEtf400DayCount: 11, totalSectorEtfs: 11 },
  sources: [
    { id: "state-street", provider: "State Street Global Advisors", label: "SPY and Select Sector SPDR daily holdings", url: "https://www.ssga.com/", role: "Universe" },
    { id: "massive", provider: "Massive", label: "Adjusted U.S. stock daily aggregates", url: "https://massive.com/", role: "Prices" },
  ],
  warnings: [],
});

(async () => {
  let server;
  let browser;
  const consoleErrors = [];
  let apiMode = "READY";
  fs.mkdirSync(screenshotsDir, { recursive: true });
  try {
    const serverCommand = process.platform === "win32" ? "cmd.exe" : "npx";
    const serverArgs = process.platform === "win32"
      ? ["/c", "npx", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
    server = spawn(serverCommand, serverArgs, { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (data) => process.stdout.write(data));
    server.stderr.on("data", (data) => process.stderr.write(data));
    await waitForServer();

    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("status of 503")) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/market-breadth") return request.continue();
      if (apiMode === "ERROR") return request.respond({ status: 503, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ status: "ERROR", message: "Market breadth storage is unavailable." }) });
      return request.respond({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(readyPayload(apiMode === "STALE")) });
    });

    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("S&P 500 Market Breadth"));
    await clickButtonText(page, "S&P 500 Market Breadth");
    await page.waitForFunction(() => window.location.hash === "#/work/market-breadth");
    await page.waitForSelector("[data-testid='sector-performance-table']");
    assert.equal(await page.$$eval("table[data-testid]", (nodes) => nodes.length), 3);
    const layout = await page.evaluate(() => {
      const performance = document.querySelector("[data-testid='sector-performance-table']").closest("section").getBoundingClientRect();
      const breadth = document.querySelector("[data-testid='breadth-table']").closest("section").getBoundingClientRect();
      const slope = document.querySelector("[data-testid='sma-slope-table']").closest("section").getBoundingClientRect();
      return { performanceWidth: performance.width, breadthTop: breadth.top, slopeTop: slope.top, breadthWidth: breadth.width, slopeWidth: slope.width };
    });
    assert.ok(layout.performanceWidth > 1200, `performance panel should be full-width: ${JSON.stringify(layout)}`);
    assert.ok(Math.abs(layout.breadthTop - layout.slopeTop) < 3, `lower panels should align: ${JSON.stringify(layout)}`);
    assert.ok(layout.breadthWidth > 550 && layout.slopeWidth > 550);

    const firstSectorBefore = await page.$eval("[data-testid='sector-performance-table'] tbody tr:nth-child(2) th", (node) => node.textContent);
    await clickButtonText(page, "1D", "[data-testid='sector-performance-table']");
    await clickButtonText(page, "1D", "[data-testid='sector-performance-table']");
    const firstSectorAfter = await page.$eval("[data-testid='sector-performance-table'] tbody tr:nth-child(2) th", (node) => node.textContent);
    assert.notEqual(firstSectorBefore, firstSectorAfter, "sorting should reorder sector rows");
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-ready.png"), fullPage: true });

    await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });
    await wait(200);
    const mobile = await page.$eval("[data-testid='breadth-table']", (table) => {
      const scroller = table.parentElement;
      const sticky = table.querySelector("tbody th");
      return {
        tableWidth: table.scrollWidth,
        scrollerWidth: scroller.clientWidth,
        overflowX: getComputedStyle(scroller).overflowX,
        stickyPosition: getComputedStyle(sticky).position,
      };
    });
    assert.ok(mobile.tableWidth > mobile.scrollerWidth, `mobile table must scroll: ${JSON.stringify(mobile)}`);
    assert.equal(mobile.overflowX, "auto");
    assert.equal(mobile.stickyPosition, "sticky");
    await page.screenshot({ path: path.join(screenshotsDir, "mobile-ready.png"), fullPage: true });

    apiMode = "STALE";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("STALE SNAPSHOT"));
    assert.match(await page.$eval("body", (node) => node.innerText), /PROVIDER_UNAVAILABLE/);

    apiMode = "ERROR";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(800);
    const errorBody = await page.$eval("body", (node) => node.innerText);
    assert.match(errorBody, /Market breadth unavailable/i);
    assert.match(errorBody, /storage is unavailable/i);

    apiMode = "READY";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='sector-performance-table']");
    await clickButtonText(page, "Market Lab");
    await page.waitForFunction(() => window.location.hash === "#/market-lab");
    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join("; ")}`);
    console.log(`Market breadth UAT passed. Screenshots: ${screenshotsDir}`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
