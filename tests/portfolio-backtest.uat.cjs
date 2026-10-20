const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");
const { startVite, stopProcessTree, wait, waitForServer } = require("./helpers/browser-uat.cjs");

const rootDir = path.resolve(__dirname, "..");
const port = 5188;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotsDir = path.join(rootDir, "uat_screenshots", "portfolio-backtest");
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
const isBacktestRequest = (request) => {
  const url = new URL(request.url());
  if (url.pathname !== "/api/portfolio-backtest" || request.method() !== "POST") return false;
  const input = JSON.parse(request.postData() || "{}");
  return input.operation !== "validate";
};
const successResponse = (input, requestId) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ data: backtestResult(input), cache: { status: "refreshed" }, requestId }),
});

(async () => {
  let server;
  let browser;
  let apiMode = "success";
  let delayedApiMode = null;
  let requestCount = 0;
  const policyRequests = new Set();
  const consoleErrors = [];
  fs.mkdirSync(screenshotsDir, { recursive: true });
  try {
    server = startVite({ rootDir, port, host: "127.0.0.1" });
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    page.on("console", (message) => {
      const expectedApiFailure = /^Failed to load resource: the server responded with a status of (503|504) \(/.test(message.text())
        && message.location().url?.split("?")[0] === `${baseUrl}/api/portfolio-backtest`;
      if (message.type() === "error" && !expectedApiFailure) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/portfolio-backtest") return request.continue();
      requestCount += 1;
        const input = JSON.parse(request.postData() || "{}");
        if (input.operation === "validate") {
          if (delayedApiMode === "verification") return;
          if (apiMode === "verification-error") return request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "VERIFICATION_UNAVAILABLE", message: "ETF verification provider is temporarily unavailable." } }) });
          return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { instruments: input.tickers.map((ticker) => ({ ticker, displayName: `${ticker} Fund`, eligibility: "verified_us_etf", exchange: "NMS" })), warnings: [] }, cache: { status: "refreshed" }, requestId: "portfolio-uat-validate" }) });
       }
       policyRequests.add(`${input.rebalancePolicy}:${input.dividendPolicy}`);
       if (delayedApiMode === "backtest") return;
       if (apiMode === "error") return request.respond({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "REQUEST_TIMEOUT", message: "The portfolio backtest exceeded its allowed market-data deadline." } }) });
       if (apiMode === "stale") {
         const result = backtestResult(input);
         result.warnings = ["Historical data is stale because a refresh failed; retry before relying on this comparison."];
         return request.respond({ status: 206, contentType: "application/json", body: JSON.stringify({ data: result, cache: { status: "stale" }, requestId: "portfolio-uat-stale" }) });
       }
       return request.respond(successResponse(input, "portfolio-uat"));
    });

    await page.goto(`${baseUrl}/#/work/portfolio-backtest?v=1&capital=10000&start=2021-01-01&end=2026-08-21&rebalance=quarterly&dividend=reinvest&asset=VTI:6000&asset=BND:4000`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("form[name='portfolio-backtest']");
    assert.equal(requestCount, 0, "opening a shared setup must not call the API");
    assert.deepEqual(await page.$$eval("input[name$='-ticker']", (inputs) => inputs.map((input) => input.value)), ["VTI", "BND"]);
    assert.deepEqual(await page.$$eval("input[name$='-weight']", (inputs) => inputs.map((input) => input.value)), ["60.00", "40.00"]);
    assert.equal(await page.title(), "Portfolio vs SPY — Siu");

    await page.evaluate(() => {
      window.location.hash = "#/work/portfolio-backtest?v=1&capital=20000&start=2022-01-01&end=2026-08-21&rebalance=monthly&dividend=cash&asset=VOO:7000&asset=VXUS:3000";
    });
    await page.waitForFunction(() => document.querySelector("input[name='capital']")?.value === "20000");
    assert.deepEqual(await page.$$eval("input[name$='-ticker']", (inputs) => inputs.map((input) => input.value)), ["VOO", "VXUS"]);
    assert.deepEqual(await page.$$eval("input[name$='-weight']", (inputs) => inputs.map((input) => input.value)), ["70.00", "30.00"]);
    assert.equal(requestCount, 0, "changing a shared setup hash must not call the backtest API");
    await page.evaluate(() => {
      window.location.hash = "#/work/portfolio-backtest?v=1&capital=10000&start=2021-01-01&end=2026-08-21&rebalance=quarterly&dividend=reinvest&asset=VTI:6000&asset=BND:4000";
    });
    await page.waitForFunction(() => document.querySelector("input[name='capital']")?.value === "10000");

    await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Portfolio vs SPY"));
    const clicked = await page.$$eval("article", (cards) => {
      const card = cards.find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Portfolio vs SPY");
      const action = card?.querySelector("a[aria-label='Run backtest: Portfolio vs SPY']");
      if (!(action instanceof HTMLAnchorElement)) return false;
      action.click();
      return true;
    });
    assert.equal(clicked, true, "Portfolio vs SPY card should be clickable from Market Lab");
    await page.waitForFunction(() => window.location.hash === "#/work/portfolio-backtest");
    await page.waitForFunction(() => document.body.innerText.includes("PORTFOLIO VS SPY"));
    assert.match(await page.$eval("body", (body) => body.innerText), /PORTFOLIO VS SPY/);

     const tickerInputs = await page.$$("input[name$='-ticker']");
     const weightInputs = await page.$$("input[name$='-weight']");
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
    const secondTicker = (await page.$$("input[name$='-ticker']"))[1];
    const secondWeight = (await page.$$("input[name$='-weight']"))[1];
     await secondTicker.type("BND");
     await secondWeight.type("40");
     const copySetupButtonText = () => page.$$eval("form[name='portfolio-backtest'] button", (buttons) => buttons.find((candidate) => (candidate.textContent || "").toLowerCase().includes("setup link"))?.textContent?.trim() || "");
     await page.evaluate(() => {
       Object.defineProperty(navigator, "clipboard", {
         configurable: true,
         value: {
           writeText: () => new Promise((resolve) => {
             window.__shareCopyPending = true;
             window.__resolveShareCopy = () => {
               window.__shareCopyPending = false;
               resolve();
             };
           }),
         },
       });
     });
     await page.$$eval("form[name='portfolio-backtest'] button", (buttons) => {
       const button = buttons.find((candidate) => (candidate.textContent || "").includes("Copy setup link"));
       if (!button) throw new Error("Missing Copy setup link button");
       button.click();
     });
     await page.waitForFunction(() => window.__shareCopyPending === true);
     await tickerInputs[0].click({ clickCount: 3 });
     await tickerInputs[0].type("VOO");
     await page.evaluate(() => window.__resolveShareCopy?.());
     await wait(100);
     assert.equal(await copySetupButtonText(), "Copy setup link", "an older clipboard result must not restore copied status after editing");
     assert.equal(await page.$("input[name='share-url']"), null, "an older clipboard result must not restore the old manual URL");
     await tickerInputs[0].click({ clickCount: 3 });
     await tickerInputs[0].type("VTI");
     await page.evaluate(() => {
       window.__copyRequests = [];
       Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
         writeText: () => new Promise((resolve, reject) => window.__copyRequests.push({ resolve, reject })),
       } });
     });
     for (let index = 0; index < 2; index++) {
       await page.$$eval("form[name='portfolio-backtest'] button", (buttons) => buttons.find((button) => button.textContent.includes("Copy setup link")).click());
     }
     await page.waitForFunction(() => window.__copyRequests.length === 2);
     await page.evaluate(() => window.__copyRequests[1].resolve());
     await page.waitForFunction(() => document.querySelector("form[name='portfolio-backtest']").textContent.includes("Setup link copied"));
     await page.evaluate(() => window.__copyRequests[0].reject(new Error("older clipboard failure")));
     await wait(50);
     assert.equal(await copySetupButtonText(), "Setup link copied", "older clipboard rejection must not overwrite the latest copy success");
     assert.equal(await page.$("input[name='share-url']"), null, "older clipboard rejection must not restore manual fallback");
     await page.evaluate(() => {
       Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });
     });
     const setupRequestCount = requestCount;
     await page.$$eval("form[name='portfolio-backtest'] button", (buttons) => {
       const button = buttons.find((candidate) => (candidate.textContent || "").toLowerCase().includes("setup link"));
       if (!button) throw new Error("Missing Copy setup link button");
       button.click();
     });
      try {
        await page.waitForFunction(() => [...document.querySelectorAll("form[name='portfolio-backtest'] button")]
          .some((candidate) => (candidate.textContent || "").trim() === "Setup link copied"));
      } catch (copyError) {
        const copyState = await page.evaluate(() => ({
          buttonText: [...document.querySelectorAll("form[name='portfolio-backtest'] button")]
            .find((candidate) => (candidate.textContent || "").toLowerCase().includes("setup link"))?.textContent?.trim() || "",
          alertText: document.querySelector("[role='alert']")?.textContent?.trim() || "",
          tickers: [...document.querySelectorAll("input[name$='-ticker']")].map((input) => input.value),
        }));
        throw new Error(`Copy setup link did not complete: ${JSON.stringify(copyState)}`, { cause: copyError });
      }
     assert.equal(requestCount, setupRequestCount, "copying a setup link must not call the backtest API");
     await tickerInputs[0].click({ clickCount: 3 });
     await tickerInputs[0].type("VOO");
     assert.equal(await copySetupButtonText(), "Copy setup link", "editing the setup must invalidate the copied status");
     assert.equal(await page.$("input[name='share-url']"), null, "editing the setup must clear the old manual URL");
     await tickerInputs[0].click({ clickCount: 3 });
     await tickerInputs[0].type("VTI");
      delayedApiMode = "verification";
      const delayedVerificationRequestPromise = page.waitForRequest((request) => {
        const url = new URL(request.url());
        if (url.pathname !== "/api/portfolio-backtest" || request.method() !== "POST") return false;
        return JSON.parse(request.postData() || "{}").operation === "validate";
      });
      await page.$$eval("button", (buttons) => {
       const button = buttons.find((candidate) => (candidate.textContent || "").includes("Verify ETF tickers"));
       if (!button) return false;
       button.click();
       return true;
      });
      const delayedVerificationRequest = await delayedVerificationRequestPromise;
      await page.waitForFunction(() => [...document.querySelectorAll("form[name='portfolio-backtest'] button")]
        .some((candidate) => (candidate.textContent || "").includes("Verifying ETF tickers")));
      const verificationTicker = await page.$("input[name='asset-1-ticker']");
      await verificationTicker.click({ clickCount: 3 });
      await verificationTicker.type("VOO");
      await page.waitForFunction(() => document.querySelector("[data-testid='verified-etf-tickers']") === null
        && ![...document.querySelectorAll("form[name='portfolio-backtest'] button")]
          .some((candidate) => (candidate.textContent || "").includes("Verifying ETF tickers")));
      delayedApiMode = null;
      const delayedVerificationInput = JSON.parse(delayedVerificationRequest.postData() || "{}");
      await delayedVerificationRequest.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { instruments: delayedVerificationInput.tickers.map((ticker) => ({ ticker, displayName: `${ticker} Fund`, eligibility: "verified_us_etf", exchange: "NMS" })), warnings: [] }, cache: { status: "refreshed" }, requestId: "portfolio-uat-delayed-validate" }) });
      await wait(100);
      assert.equal(await page.$("[data-testid='verified-etf-tickers']"), null, "an older verification response must not appear after editing the setup");
      assert.equal(await page.$("[role='alert']"), null, "an older verification response must not create an error after editing the setup");
      assert.equal(await page.$$eval("form[name='portfolio-backtest'] button", (buttons) => buttons.some((candidate) => (candidate.textContent || "").includes("Verifying ETF tickers"))), false, "an older verification finally must not restore loading after editing the setup");
      const restoredTicker = await page.$("input[name='asset-1-ticker']");
      await restoredTicker.click({ clickCount: 3 });
      await restoredTicker.type("VTI");
       const verified = await page.$$eval("button", (buttons) => {
       const button = buttons.find((candidate) => (candidate.textContent || "").includes("Verify ETF tickers"));
       if (!button) return false;
       button.click();
       return true;
     });
     assert.equal(verified, true, "ETF verification must be available before the backtest");
      await page.waitForSelector("[data-testid='verified-etf-tickers']");
      assert.match(await page.$eval("[data-testid='verified-etf-tickers']", (node) => node.textContent || ""), /VTI[\s\S]*VTI Fund[\s\S]*BND[\s\S]*verified US ETF/);

      delayedApiMode = "backtest";
      const concurrentBacktestRequestPromise = page.waitForRequest(isBacktestRequest);
      await page.$eval("button[type='submit']", (button) => button.click());
      const concurrentBacktestRequest = await concurrentBacktestRequestPromise;
      await page.waitForFunction(() => {
        const verify = [...document.querySelectorAll("button")].find((button) => (button.textContent || "").includes("Verify ETF tickers"));
        return document.querySelector("button[type='submit']")?.disabled === true && verify?.disabled === true;
      });
      const beforeBlockedVerification = requestCount;
      await page.$$eval("button", (buttons) => {
        const verify = buttons.find((button) => (button.textContent || "").includes("Verify ETF tickers"));
        if (!verify) throw new Error("Missing Verify ETF tickers button");
        verify.click();
      });
      await wait(100);
      assert.equal(requestCount, beforeBlockedVerification, "Verify must not start while a backtest is pending");
      delayedApiMode = null;
      await concurrentBacktestRequest.respond(successResponse(JSON.parse(concurrentBacktestRequest.postData() || "{}"), "portfolio-uat-serialized-backtest"));
      await page.waitForSelector("[data-testid='portfolio-performance-chart']");
      assert.equal(await page.$("[role='alert']"), null, "a blocked verification must not create a mismatched backtest error");

      delayedApiMode = "verification";
      const concurrentVerificationRequestPromise = page.waitForRequest((request) => {
        const url = new URL(request.url());
        if (url.pathname !== "/api/portfolio-backtest" || request.method() !== "POST") return false;
        return JSON.parse(request.postData() || "{}").operation === "validate";
      });
      await page.$$eval("button", (buttons) => {
        const verify = buttons.find((button) => (button.textContent || "").includes("Verify ETF tickers"));
        if (!verify) throw new Error("Missing Verify ETF tickers button");
        verify.click();
      });
      const concurrentVerificationRequest = await concurrentVerificationRequestPromise;
      await page.waitForFunction(() => {
        const verify = [...document.querySelectorAll("button")].find((button) => (button.textContent || "").includes("Verifying ETF tickers"));
        return document.querySelector("button[type='submit']")?.disabled === true && verify?.disabled === true;
      });
      const beforeBlockedBacktest = requestCount;
      await page.$eval("button[type='submit']", (button) => button.click());
      await wait(100);
      assert.equal(requestCount, beforeBlockedBacktest, "Run must not start while ETF verification is pending");
      delayedApiMode = null;
      const concurrentVerificationInput = JSON.parse(concurrentVerificationRequest.postData() || "{}");
      await concurrentVerificationRequest.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { instruments: concurrentVerificationInput.tickers.map((ticker) => ({ ticker, displayName: `${ticker} Fund`, eligibility: "verified_us_etf", exchange: "NMS" })), warnings: [] }, cache: { status: "refreshed" }, requestId: "portfolio-uat-serialized-validate" }) });
      await page.waitForSelector("[data-testid='verified-etf-tickers']");
      assert.equal(await page.$("[role='alert']"), null, "a blocked backtest must not create a mismatched error after verification");

     for (const rebalancePolicy of ["none", "monthly", "quarterly", "annual"]) {
      for (const dividendPolicy of ["reinvest", "cash"]) {
        await page.select("select[aria-label='Rebalancing policy']", rebalancePolicy);
        await page.select("select[aria-label='Dividend policy']", dividendPolicy);
        await page.$eval("button[type='submit']", (button) => button.click());
        await page.waitForSelector("[data-testid='portfolio-performance-chart']");
        assert.match(await page.$eval("body", (body) => body.innerText), new RegExp(`${rebalancePolicy} rebalancing`, "i"));
     }
    }
    apiMode = "verification-error";
    await page.$$eval("button", (buttons) => {
      const verify = buttons.find((button) => (button.textContent || "").includes("Verify ETF tickers"));
      if (!verify) throw new Error("Missing Verify ETF tickers button");
      verify.click();
    });
    await page.waitForSelector("[role='alert']");
    const verificationErrorText = await page.$eval("[role='alert']", (node) => node.textContent || "");
    assert.match(verificationErrorText, /ETF verification unavailable[\s\S]*temporarily unavailable/i);
    await page.$$eval("form[name='portfolio-backtest'] button", (buttons) => buttons.find((button) => button.textContent.toLowerCase().includes("setup link")).click());
    await wait(50);
    assert.match(await page.$eval("[role='alert']", (node) => node.textContent), /ETF verification unavailable/, "copying must preserve the API error and its retry action");
    assert.notEqual(await page.$("[data-testid='portfolio-performance-chart']"), null, "verification failure must preserve the valid backtest result");
    assert.equal(await page.$$eval("button", (buttons) => buttons.some((button) => (button.textContent || "").includes("Retry last backtest"))), false, "verification failure must not expose a backtest retry");
    assert.equal(await page.$$eval("button", (buttons) => buttons.some((button) => (button.textContent || "").includes("Retry ETF verification"))), true, "verification failure must expose the verification retry");
    apiMode = "success";
    await page.$$eval("button", (buttons) => {
      const retry = buttons.find((button) => (button.textContent || "").includes("Retry ETF verification"));
      if (!retry) throw new Error("Missing retry ETF verification button");
      retry.click();
    });
    await page.waitForSelector("[data-testid='verified-etf-tickers']");
    assert.equal(policyRequests.size, 8, "each rebalancing/dividend policy pair must reach the API seam");
    const downloadLink = await page.waitForSelector("a[download$='.csv']");
    const downloadState = await downloadLink.evaluate((node) => ({ filename: node.download, href: node.href }));
    assert.equal(downloadState.filename, "portfolio-vs-spy-2021-08-23-to-2026-08-21.csv");
    const comparisonCsv = decodeURIComponent(downloadState.href.split(",").slice(1).join(","));
    assert.match(comparisonCsv, /^date,portfolio_value_usd,spy_value_usd,portfolio_index_base_100,spy_index_base_100,/);
    assert.match(comparisonCsv, /"2026-08-21",16900,15700,169,157,"annual","cash","2026-08-21","refreshed","v1",""/);
    const downloadsDir = path.join(screenshotsDir, "downloads");
    fs.mkdirSync(downloadsDir, { recursive: true });
    const downloadSession = await page.createCDPSession();
    await downloadSession.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir, eventsEnabled: true });
    const completedDownload = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Comparison CSV download did not complete")), 10000);
      downloadSession.on("Browser.downloadProgress", (event) => {
        if (event.state === "completed") { clearTimeout(timeout); resolve(); }
        if (event.state === "canceled") { clearTimeout(timeout); reject(new Error("Comparison CSV download canceled")); }
      });
    });
    const beforeExport = requestCount;
    await downloadLink.focus();
    await page.keyboard.press("Enter");
    await completedDownload;
    assert.equal(fs.readFileSync(path.join(downloadsDir, downloadState.filename), "utf8"), comparisonCsv, "the actual downloaded CSV must match the displayed result without recomputation");
    assert.equal(requestCount, beforeExport, "export must not call the backtest API");
    for (const width of [390, 768]) {
      await page.setViewport({ width, height: 844 });
      await downloadLink.evaluate((node) => node.scrollIntoView({ block: "center" }));
      const exportBounds = await downloadLink.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.ok(exportBounds.width >= 44 && exportBounds.height >= 44 && exportBounds.overflow <= 1, `CSV link must fit mobile and remain touch accessible: ${JSON.stringify(exportBounds)}`);
      await page.screenshot({ path: path.join(screenshotsDir, `comparison-csv-${width}.png`) });
    }
    await page.setViewport({ width: 1440, height: 1000 });
    assert.equal(await page.$$("[data-testid='portfolio-performance-chart']").then((nodes) => nodes.length), 1);
     assert.match(await page.$eval("body", (body) => body.innerText), /Requested:[\s\S]*Effective:[\s\S]*Yahoo Finance chart API[\s\S]*Excluded sessions:[\s\S]*None[\s\S]*No taxes, trading costs/i);
     await page.screenshot({ path: path.join(screenshotsDir, "desktop-success.png"), fullPage: true });

     apiMode = "stale";
     await page.$eval("button[type='submit']", (button) => button.click());
     await wait(250);
     const staleText = await page.$eval("body", (body) => body.innerText);
     assert.match(staleText, /Cache: stale[\s\S]*Data warning[\s\S]*Historical data is stale because a refresh failed/i);
     const staleCsv = await page.$eval("a[download$='.csv']", (node) => decodeURIComponent(node.href.split(",").slice(1).join(",")));
     assert.match(staleCsv, /"stale","v1","Historical data is stale because a refresh failed/);
     apiMode = "success";

     const beforeInvalidRun = requestCount;
      const firstWeight = (await page.$$("input[name$='-weight']"))[0];
      await firstWeight.click({ clickCount: 3 });
      await firstWeight.type("60.001");
      await page.waitForFunction(() => document.querySelector("input[name='asset-1-weight']")?.value === "60.001");
      await page.$$eval("form[name='portfolio-backtest'] button", (buttons) => {
        const copy = buttons.find((button) => (button.textContent || "").includes("Copy setup link"));
        if (!copy) throw new Error("Missing Copy setup link button");
        copy.click();
      });
      await page.waitForSelector("[role='alert']");
      const shareErrorText = await page.$eval("[role='alert']", (node) => node.textContent || "");
      assert.match(shareErrorText, /Setup link unavailable/i);
      assert.doesNotMatch(shareErrorText, /Backtest unavailable|Retry last backtest/i, "share failure must not use the backtest error banner or retry");
      assert.equal(requestCount, beforeInvalidRun, "invalid setup sharing must not call the backtest API");
      await page.$eval("button[type='submit']", (button) => button.click());
     await page.waitForFunction(() => [...document.querySelectorAll("[role='alert']")].some((node) => /0\.01% increments[\s\S]*100\.00%/.test(node.textContent || "")));
     assert.equal(requestCount, beforeInvalidRun, "sub-basis-point allocation must not call the backtest API");

    await firstWeight.click({ clickCount: 3 });
    await firstWeight.type("60");
    apiMode = "error";
    await page.$eval("button[type='submit']", (button) => button.click());
    await page.waitForSelector("[role='alert']");
     assert.match(await page.$eval("[role='alert']", (node) => node.textContent || ""), /Backtest unavailable[\s\S]*deadline/i);
     assert.equal(await page.$("[data-testid='portfolio-performance-chart']"), null, "provider failure must not retain a successful chart");
     assert.equal(await page.$("a[download$='.csv']"), null, "provider failure must not retain an old result export");
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

    apiMode = "success";
    delayedApiMode = "backtest";
    const delayedBacktestARequestPromise = page.waitForRequest(isBacktestRequest);
    await page.$eval("button[type='submit']", (button) => button.click());
    const delayedBacktestARequest = await delayedBacktestARequestPromise;
    const delayedBacktestAInput = JSON.parse(delayedBacktestARequest.postData() || "{}");
    await page.waitForFunction(() => document.querySelector("button[type='submit']")?.textContent?.includes("Fetching and simulating EOD history"));
    await page.evaluate(() => {
      window.location.hash = "#/work/portfolio-backtest?v=1&capital=20000&start=2022-01-01&end=2026-08-21&rebalance=monthly&dividend=cash&asset=VOO:7000&asset=VXUS:3000";
    });
    await page.waitForFunction(() => document.querySelector("input[name='capital']")?.value === "20000");
    assert.equal(await page.$("[data-testid='portfolio-performance-chart']"), null, "loading a new shared setup must clear the old result");
    assert.equal(await page.$("[role='alert']"), null, "loading a new shared setup must clear the old error");
    assert.equal(await page.$eval("button[type='submit']", (button) => button.textContent?.includes("Fetching and simulating EOD history")), false, "loading a new shared setup must clear the old loading state");
    const delayedBacktestBRequestPromise = page.waitForRequest(isBacktestRequest);
    await page.$eval("button[type='submit']", (button) => button.click());
    const delayedBacktestBRequest = await delayedBacktestBRequestPromise;
    const delayedBacktestBInput = JSON.parse(delayedBacktestBRequest.postData() || "{}");
    await page.waitForFunction(() => document.querySelector("button[type='submit']")?.textContent?.includes("Fetching and simulating EOD history"));
    delayedApiMode = null;
    await delayedBacktestARequest.respond(successResponse(delayedBacktestAInput, "portfolio-uat-delayed-a"));
    await wait(100);
    assert.equal(await page.$("[data-testid='portfolio-performance-chart']"), null, "an older backtest result must not overwrite a newer loading setup");
    assert.equal(await page.$("[role='alert']"), null, "an older backtest response must not create an error for a newer setup");
    assert.equal(await page.$eval("button[type='submit']", (button) => button.textContent?.includes("Fetching and simulating EOD history")), true, "an older backtest finally must not clear a newer request's loading state");
    await delayedBacktestBRequest.respond(successResponse(delayedBacktestBInput, "portfolio-uat-delayed-b"));
    await page.waitForSelector("[data-testid='portfolio-performance-chart']");
    assert.match(await page.$eval("body", (body) => body.innerText), /VOO ETF[\s\S]*VXUS ETF/, "the newer backtest result must win");

    delayedApiMode = "backtest";
    const delayedBacktestErrorRequestPromise = page.waitForRequest(isBacktestRequest);
    await page.$eval("button[type='submit']", (button) => button.click());
    const delayedBacktestErrorRequest = await delayedBacktestErrorRequestPromise;
    await page.waitForFunction(() => document.querySelector("button[type='submit']")?.textContent?.includes("Fetching and simulating EOD history"));
    await page.evaluate(() => {
      window.location.hash = "#/work/portfolio-backtest?v=1&capital=30000&start=2023-01-01&end=2026-08-21&rebalance=none&dividend=reinvest&asset=VTI:10000";
    });
    await page.waitForFunction(() => document.querySelector("input[name='capital']")?.value === "30000");
    delayedApiMode = null;
    await delayedBacktestErrorRequest.respond({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "REQUEST_TIMEOUT", message: "The delayed A request must not surface on the new setup." } }) });
    await wait(100);
    assert.equal(await page.$("[data-testid='portfolio-performance-chart']"), null, "a stale backtest error must not restore the old result");
    assert.equal(await page.$("[role='alert']"), null, "a stale backtest error must not surface after loading a new setup");
    assert.equal(await page.$eval("button[type='submit']", (button) => button.textContent?.includes("Fetching and simulating EOD history")), false, "a stale backtest finally must not leave a loading state on the new setup");
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
