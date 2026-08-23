const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const puppeteer = require("puppeteer");

const rootDir = path.resolve(__dirname, "..");
const port = 5188;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotsDir = path.join(rootDir, "uat_screenshots", "portfolio-backtest");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const stopProcessTree = (processToStop) => new Promise((resolve) => {
  if (!processToStop || processToStop.killed) return resolve();
  const killer = spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" });
  killer.on("close", resolve);
  killer.on("error", resolve);
});

const waitForServer = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

const backtestResult = (input) => ({
  schemaVersion: "v1",
  benchmark: "SPY",
  dataSource: { provider: "Yahoo Finance chart API", role: "US ETF and SPY completed EOD history" },
  requestedRange: { start: input.startDate, end: input.endDate },
  effectiveRange: { start: "2021-08-23", end: "2026-08-21", sessionCount: 1258 },
  startingCapital: input.startingCapital,
  rebalancePolicy: input.rebalancePolicy,
  dividendPolicy: input.dividendPolicy,
  sourceAsOf: "2026-08-21",
  curve: [
    { date: "2021-08-23", portfolioValue: input.startingCapital, portfolioIndexed: 100, benchmarkValue: input.startingCapital, benchmarkIndexed: 100 },
    { date: "2023-08-21", portfolioValue: 12150, portfolioIndexed: 121.5, benchmarkValue: 11800, benchmarkIndexed: 118 },
    { date: "2026-08-21", portfolioValue: 16900, portfolioIndexed: 169, benchmarkValue: 15700, benchmarkIndexed: 157 },
  ],
  metrics: { endingValue: 16900, cumulativeReturn: 0.69, cagr: 0.11, annualizedVolatility: 0.16, sharpeRatio: 0.69, maxDrawdown: -0.18 },
  benchmarkMetrics: { endingValue: 15700, cumulativeReturn: 0.57, cagr: 0.094, annualizedVolatility: 0.17, sharpeRatio: 0.55, maxDrawdown: -0.2 },
  endingValue: 16900,
  benchmarkEndingValue: 15700,
  excessCumulativeReturn: 0.12,
  positions: input.positions.map((position) => ({ ticker: position.ticker, displayName: `${position.ticker} ETF`, targetWeightPct: position.basisPoints / 100, endingWeightPct: position.basisPoints / 100, endingValue: 16900 * position.basisPoints / 10_000, cashDividendValue: input.dividendPolicy === "cash" ? 120 : 0 })),
  rebalancedOn: input.rebalancePolicy === "none" ? [] : ["2026-08-21"],
  excludedSessions: [],
  warnings: [],
  methodologyVersion: "v1",
});

(async () => {
  let server;
  let browser;
  let apiMode = "success";
  let requestCount = 0;
  const policyRequests = new Set();
  const consoleErrors = [];
  fs.mkdirSync(screenshotsDir, { recursive: true });
  try {
    server = spawn("cmd.exe", ["/c", "npx", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    await waitForServer();
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("status of 504")) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/portfolio-backtest") return request.continue();
      requestCount += 1;
       const input = JSON.parse(request.postData() || "{}");
       if (input.operation === "validate") return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { instruments: input.tickers.map((ticker) => ({ ticker, displayName: `${ticker} Fund`, eligibility: "verified_us_etf", exchange: "NMS" })), warnings: [] }, cache: { status: "refreshed" }, requestId: "portfolio-uat-validate" }) });
       policyRequests.add(`${input.rebalancePolicy}:${input.dividendPolicy}`);
       if (apiMode === "error") return request.respond({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "REQUEST_TIMEOUT", message: "The portfolio backtest exceeded its allowed market-data deadline." } }) });
       if (apiMode === "stale") {
         const result = backtestResult(input);
         result.warnings = ["Historical data is stale because a refresh failed; retry before relying on this comparison."];
         return request.respond({ status: 206, contentType: "application/json", body: JSON.stringify({ data: result, cache: { status: "stale" }, requestId: "portfolio-uat-stale" }) });
       }
       return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: backtestResult(input), cache: { status: "refreshed" }, requestId: "portfolio-uat" }) });
    });

    await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Portfolio vs SPY"));
    const clicked = await page.$$eval("button", (buttons) => {
      const card = buttons.find((button) => (button.textContent || "").includes("Portfolio vs SPY"));
      if (!card) return false;
      card.click();
      return true;
    });
    assert.equal(clicked, true, "Portfolio vs SPY card should be clickable from Market Lab");
    await page.waitForFunction(() => window.location.hash === "#/work/portfolio-backtest");
    assert.match(await page.$eval("body", (body) => body.innerText), /PORTFOLIO VS SPY/);

     const tickerInputs = await page.$$("input[aria-label='ETF ticker']");
     const weightInputs = await page.$$("input[aria-label='ETF allocation percent']");
     await tickerInputs[0].type("vti");
     assert.equal(await tickerInputs[0].evaluate((input) => input.value), "VTI", "ticker input should normalize to uppercase");
    await weightInputs[0].type("60");
    const addClicked = await page.$$eval("button", (buttons) => {
      const add = buttons.find((button) => (button.textContent || "").includes("Add ETF"));
      if (!add) return false;
      add.click();
      return true;
    });
    assert.equal(addClicked, true);
    const secondTicker = (await page.$$("input[aria-label='ETF ticker']"))[1];
    const secondWeight = (await page.$$("input[aria-label='ETF allocation percent']"))[1];
     await secondTicker.type("BND");
     await secondWeight.type("40");
     const verified = await page.$$eval("button", (buttons) => {
       const button = buttons.find((candidate) => (candidate.textContent || "").includes("Verify ETF tickers"));
       if (!button) return false;
       button.click();
       return true;
     });
     assert.equal(verified, true, "ETF verification must be available before the backtest");
     await page.waitForSelector("[data-testid='verified-etf-tickers']");
     assert.match(await page.$eval("[data-testid='verified-etf-tickers']", (node) => node.textContent || ""), /VTI[\s\S]*VTI Fund[\s\S]*BND[\s\S]*verified US ETF/);

    for (const rebalancePolicy of ["none", "monthly", "quarterly", "annual"]) {
      for (const dividendPolicy of ["reinvest", "cash"]) {
        await page.select("select[aria-label='Rebalancing policy']", rebalancePolicy);
        await page.select("select[aria-label='Dividend policy']", dividendPolicy);
        await page.$eval("button[type='submit']", (button) => button.click());
        await page.waitForSelector("[data-testid='portfolio-performance-chart']");
        assert.match(await page.$eval("body", (body) => body.innerText), new RegExp(`${rebalancePolicy} rebalancing`, "i"));
      }
    }
    assert.equal(policyRequests.size, 8, "each rebalancing/dividend policy pair must reach the API seam");
    assert.equal(await page.$$("[data-testid='portfolio-performance-chart']").then((nodes) => nodes.length), 1);
     assert.match(await page.$eval("body", (body) => body.innerText), /Requested:[\s\S]*Effective:[\s\S]*Yahoo Finance chart API[\s\S]*Excluded sessions:[\s\S]*None[\s\S]*No taxes, trading costs/i);
     await page.screenshot({ path: path.join(screenshotsDir, "desktop-success.png"), fullPage: true });

     apiMode = "stale";
     await page.$eval("button[type='submit']", (button) => button.click());
     await wait(250);
     const staleText = await page.$eval("body", (body) => body.innerText);
     assert.match(staleText, /Cache: stale[\s\S]*Data warning[\s\S]*Historical data is stale because a refresh failed/i);
     apiMode = "success";

     const beforeInvalidRun = requestCount;
     const firstWeight = (await page.$$("input[aria-label='ETF allocation percent']"))[0];
     await firstWeight.click({ clickCount: 3 });
     await firstWeight.type("60.001");
     await page.$eval("button[type='submit']", (button) => button.click());
     await page.waitForSelector("[role='alert']");
     assert.match(await page.$eval("[role='alert']", (node) => node.textContent || ""), /0\.01% increments[\s\S]*100\.00%/);
     assert.equal(requestCount, beforeInvalidRun, "sub-basis-point allocation must not call the backtest API");

    await firstWeight.click({ clickCount: 3 });
    await firstWeight.type("60");
    apiMode = "error";
    await page.$eval("button[type='submit']", (button) => button.click());
    await page.waitForSelector("[role='alert']");
     assert.match(await page.$eval("[role='alert']", (node) => node.textContent || ""), /Backtest unavailable[\s\S]*deadline/i);
     assert.equal(await page.$("[data-testid='portfolio-performance-chart']"), null, "provider failure must not retain a successful chart");
     assert.equal(await page.$$eval("button", (buttons) => buttons.some((button) => (button.textContent || "").includes("Retry last backtest"))), true, "provider failure must expose a retry action");
     const beforeRetry = requestCount;
     await page.$$eval("button", (buttons) => {
       const retry = buttons.find((button) => (button.textContent || "").includes("Retry last backtest"));
       if (!retry) throw new Error("Missing retry backtest button");
       retry.click();
     });
     await wait(100);
     assert.equal(requestCount, beforeRetry + 1, "retry must resubmit the last valid backtest configuration");

     await page.screenshot({ path: path.join(screenshotsDir, "desktop-error.png"), fullPage: true });
    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join("; ")}`);
    console.log(`Portfolio backtest UAT passed. Screenshots: ${screenshotsDir}`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
