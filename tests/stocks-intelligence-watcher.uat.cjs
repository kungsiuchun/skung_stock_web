const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium, expect } = require("@playwright/test");

const rootDir = path.resolve(__dirname, "..");
const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotPath = path.join(rootDir, "uat_screenshots", "stocks-intelligence-watcher-uat-fixes.png");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stopProcessTree = (processToStop) => new Promise((resolve) => {
  if (!processToStop || processToStop.killed) {
    resolve();
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
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
    } catch {
      await wait(250);
    }
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

const expiries = ["2026-05-29", "2026-06-01", "2026-06-03", "2026-06-05"];
const uatSymbols = [
  "NVDA", "GOOG", "GOOGL", "AAPL", "MSFT", "AMZN", "AVGO", "TSM", "TSLA", "META",
  "MU", "BRK-B", "LLY", "WMT", "AMD", "JPM", "V", "XOM", "INTC", "JNJ",
  "ORCL", "CSCO", "COST", "MA", "CAT", "LRCX", "QCOM", "ASML", "NFLX", "CRM",
  "ADBE", "NOW", "SHOP", "PLTR", "UBER", "PFE", "MRK", "TMO", "HD", "MCD",
  "KO", "PEP", "BAC", "GS", "CVX", "SLB", "QQQI", "FEPI", "NTSX", "IREN",
];

const buildOptionToolResponse = (tool, params = {}) => {
  if (tool === "get_watchlist") {
    return {
      ok: true,
      tool,
      params,
      text: JSON.stringify({
        symbols: uatSymbols,
        stocks: uatSymbols.map((symbol) => ({ symbol })),
      }),
      raw: {
        source: "native_yahoo",
        symbols: uatSymbols,
        stocks: uatSymbols.map((symbol) => ({ symbol })),
      },
      calledAt: "2026-05-28T21:00:01.000Z",
    };
  }

  if (!/options|greeks|dex|iv|pcr|sweeps|mispricing/i.test(tool)) {
    return {
      ok: true,
      tool,
      params,
      text: `Native ${tool} dashboard data`,
      raw: { source: "native_yahoo", ok: true },
      calledAt: "2026-05-28T21:00:01.000Z",
    };
  }

  const expiry = params.expiry || expiries[0];
  const expiryIndex = Math.max(0, expiries.indexOf(expiry));
  const spot = 181.8;
  const strikes = Array.from({ length: 26 }, (_, index) => 150 + index * 2.5);
  const calls = strikes.map((strike, index) => ({
    contractSymbol: `NVDA${expiry.replaceAll("-", "").slice(2)}C${strike}`,
    strike,
    bid: Math.max(0.05, spot - strike + 1).toFixed ? Number(Math.max(0.05, spot - strike + 1).toFixed(2)) : 0,
    ask: Number(Math.max(0.1, spot - strike + 1.35).toFixed(2)),
    volume: 400 + expiryIndex * 120 + index * 18,
    openInterest: 0,
    impliedVolatility: 44 + index * 0.2,
  }));
  const puts = strikes.map((strike, index) => ({
    contractSymbol: `NVDA${expiry.replaceAll("-", "").slice(2)}P${strike}`,
    strike,
    bid: Number(Math.max(0.05, strike - spot + 1).toFixed(2)),
    ask: Number(Math.max(0.1, strike - spot + 1.35).toFixed(2)),
    volume: 360 + expiryIndex * 90 + index * 14,
    openInterest: 0,
    impliedVolatility: 46 + index * 0.18,
  }));
  const chain = { symbol: "NVDA", spot, expiries, selectedExpiry: expiry, calls, puts };
  const exposures = strikes.slice(2, 22).map((strike, index) => ({
    strike,
    call: calls[index + 2],
    put: puts[index + 2],
    callOpenInterest: 0,
    putOpenInterest: 0,
    callVolume: calls[index + 2].volume,
    putVolume: puts[index + 2].volume,
    callEffectiveOpenInterest: calls[index + 2].volume,
    putEffectiveOpenInterest: puts[index + 2].volume,
    openInterestSource: "volume_proxy",
    callIv: calls[index + 2].impliedVolatility,
    putIv: puts[index + 2].impliedVolatility,
    callGex: 1_000_000 + expiryIndex * 350_000 + index * 110_000,
    putGex: -780_000 - expiryIndex * 220_000 - index * 70_000,
    netGex: 220_000 + expiryIndex * 130_000 + index * 40_000,
    callDex: 30_000 + index * 2_000,
    putDex: -22_000 - index * 1_500,
    netDex: 8_000 + index * 500,
    avgIv: 45 + index * 0.2,
  }));

  const raw = tool === "get_options_pcr"
    ? { source: "native_yahoo", ticker: "NVDA", expiry, putCallOpenInterest: 0.87, putCallVolume: 0.76, callOi: 10000, putOi: 8700, callVol: 4000, putVol: 3040 }
    : { source: "native_yahoo", chain, exposures, rows: exposures };

  return {
    ok: true,
    tool,
    params,
    text: `Native ${tool} dashboard data for ${expiry}`,
    raw,
    calledAt: "2026-05-28T21:00:01.000Z",
  };
};

const buildSnapshot = (symbol) => {
  const quoteBySymbol = {
    NVDA: { price: 181.8, change: 2.14, changePercent: 1.19, companyName: "NVIDIA Corporation" },
    GOOG: { price: 365.76, change: -10.67, changePercent: -2.83, companyName: "Alphabet Inc." },
    IREN: { price: 64.05, change: -3.79, changePercent: -0.53, companyName: "Iris Energy" },
    QQQI: { price: 50.42, change: 0.18, changePercent: 0.36, companyName: "NEOS Nasdaq-100 High Income ETF" },
    FEPI: { price: 55.18, change: -0.22, changePercent: -0.4, companyName: "REX FANG & Innovation Equity Premium Income ETF" },
    NTSX: { price: 45.76, change: 0.11, changePercent: 0.24, companyName: "WisdomTree U.S. Efficient Core Fund" },
    UNH: { price: 297.34, change: 1.37, changePercent: 0.46, companyName: "UnitedHealth Group" },
  };
  const quote = quoteBySymbol[symbol] || quoteBySymbol.NVDA;
  const strikes = Array.from({ length: 29 }, (_, index) => {
    const strike = quote.price - 35 + index * 2.5;
    const distance = Math.abs(strike - quote.price);
    const callVolume = Math.max(20, Math.round(1800 - distance * 22));
    const putVolume = Math.max(18, Math.round(1200 - distance * 16));
    return {
      strike,
      callOpenInterest: callVolume * 4,
      putOpenInterest: putVolume * 4,
      callVolume,
      putVolume,
      callGex: callVolume * 10_000,
      putGex: -putVolume * 8_000,
      netGex: callVolume * 10_000 - putVolume * 8_000,
    };
  });

  return {
    generatedAt: "2026-05-28T21:00:00.000Z",
    symbol,
    quote: {
      symbol,
      companyName: quote.companyName,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      asOf: "05/28, 04:00 PM",
    },
    spot: quote.price,
    atm: quote.price,
    selectedTimeLabel: "live",
    gexRegime: "Pinning",
    putCallOpenInterest: 0.67,
    putCallVolume: 0.72,
    sweeps: 0,
    availableExpiries: expiries,
    selectedExpiry: expiries[0],
    expiryRows: expiries.map((expiry, index) => ({
      expiry,
      openInterest: [426_000, 56_000, 19_000, 154_000][index],
      primaryStrike: [180, 177.5, 182.5, 185][index],
      strike: [180, 177.5, 182.5, 185][index],
      volume: [98_400, 17_500, 2_800, 12_000][index],
      dominantType: index === 2 ? "P" : "C",
      type: index === 2 ? "P" : "C",
    })),
    expiries: expiries.map((expiry, index) => ({
      expiry,
      openInterest: [426_000, 56_000, 19_000, 154_000][index],
      primaryStrike: [180, 177.5, 182.5, 185][index],
      strike: [180, 177.5, 182.5, 185][index],
      volume: [98_400, 17_500, 2_800, 12_000][index],
      dominantType: index === 2 ? "P" : "C",
      type: index === 2 ? "P" : "C",
    })),
    strikes,
    history: [
      { label: "9AM", price: 438.1 },
      { label: "11AM", price: 440.2 },
      { label: "2PM", price: 441.7 },
      { label: "4PM", price: quote.price },
    ],
    marketContext: {
      breadth: "market_breadth returned a controlled UAT response.",
      relativeStrength: "basket_relative_strength returned a controlled UAT response.",
    },
    availableTools: [
      { name: "get_quotes", description: "Quotes", inputKeys: ["ticker"] },
      { name: "get_options", description: "Options", inputKeys: ["ticker"] },
    ],
    toolRuns: [
      { name: "get_quotes", status: "ok", detail: "ok" },
      { name: "get_options", status: "ok", detail: "ok" },
    ],
    warnings: [],
    source: "native_yahoo",
  };
};

(async () => {
  let server;
  let browser;
  const requestCounts = {};
  const toolCalls = [];
  const summaryCalls = [];

  try {
    const serverCommand = process.platform === "win32" ? "cmd.exe" : "npx";
    const serverArgs = process.platform === "win32"
      ? ["/c", "npx", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
    server = spawn(serverCommand, serverArgs, { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });

    server.stdout.on("data", (data) => process.stdout.write(data));
    server.stderr.on("data", (data) => process.stderr.write(data));
    await waitForServer();
    console.log(`Vite ready at ${baseUrl}`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
    await context.addInitScript(() => window.localStorage.clear());
    const page = await context.newPage();

    await page.route("**/api/stocks-intelligence-watcher**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("stocks-intelligence-watcher-summary")) {
        summaryCalls.push(route.request().postDataJSON());
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Summary endpoint should not be called in deterministic mode" }),
        });
        return;
      }

      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        toolCalls.push(body);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildOptionToolResponse(body.tool, body.params)),
        });
        return;
      }

      const requested = (url.searchParams.get("symbol") || "NVDA").toUpperCase();
      const symbol = /^[A-Z0-9.^-]{1,12}$/.test(requested) ? requested : "NVDA";
      requestCounts[symbol] = (requestCounts[symbol] || 0) + 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildSnapshot(symbol)),
      });
    });

    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "NVDA" })).toBeVisible();
    await expect(page.locator("[data-watchlist-row]")).toHaveCount(50);
    await expect(page.locator('[data-watchlist-row="GOOG"]')).toBeVisible();
    await expect(page.locator('[data-watchlist-row="NVDA"]')).toContainText("$181.80");

    await page.locator('[data-watchlist-row="GOOG"]').click();
    await expect(page.getByRole("heading", { name: "GOOG" })).toBeVisible();
    await expect(page.locator('[data-watchlist-row="GOOG"]')).toContainText("$365.76");
    await expect(page.locator('[data-watchlist-row="NVDA"]')).toContainText("$181.80");

    await page.locator('[data-watchlist-row="NVDA"]').click();
    await expect(page.getByRole("heading", { name: "NVDA" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Favorite GOOG", exact: true }).check();
    await expect(page.getByRole("heading", { name: "NVDA" })).toBeVisible();
    await wait(150);
    assert.ok(toolCalls.some((call) => call.tool === "save_memory" && String(call.params?.value || "").includes("GOOG")), "favorite checkbox must persist GOOG through save_memory");

    await page.getByRole("button", { name: /FAV/ }).click();
    await expect(page.locator("[data-watchlist-row]")).toHaveCount(1);
    await expect(page.locator('[data-watchlist-row="GOOG"]')).toBeVisible();

    await page.getByRole("button", { name: "All Stocks" }).click();
    await page.locator('input[placeholder*="ticker"]').fill("Apple");
    await page.getByLabel("Sector filter").selectOption("Technology");
    await page.getByLabel("Type filter").selectOption("Stock");
    await expect(page.locator("[data-watchlist-row]")).toHaveCount(1);
    await expect(page.locator('[data-watchlist-row="AAPL"]')).toBeVisible();

    await page.locator('input[placeholder*="ticker"]').fill("");
    await page.getByLabel("Sector filter").selectOption("All Sectors");
    await page.getByLabel("Type filter").selectOption("All Types");
    await expect(page.locator("[data-watchlist-row]")).toHaveCount(50);

    await page.locator('input[placeholder*="ticker"]').fill("SOFI");
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.getByRole("heading", { name: "SOFI" })).toBeVisible();
    await expect(page.locator('[data-watchlist-row="SOFI"]')).toBeVisible();
    assert.equal(requestCounts.SOFI || 0, 1, "loading a typed custom ticker should fetch and append it to the visible list");

    await expect(page.locator('[data-options-chart-viewport]').locator('text="Spot $181.80"')).toHaveCount(1);
    await expect(page.locator("[data-ai-summary-panel]")).toBeVisible();
    await expect(page.locator("[data-ai-summary-panel]")).toContainText("Deterministic rules readout");
    await expect(page.locator("[data-ai-summary-panel]")).toContainText("SOFI options tape shows");
    await expect(page.locator("[data-ai-summary-panel]")).toContainText("2026-05-29");
    assert.equal(summaryCalls.length, 0, "deterministic AI summary must not call the summary endpoint");
    await page.locator('input[placeholder*="ticker"]').fill("");
    await expect(page.locator('[data-expiry-chip]')).toHaveCount(0);
    await expect(page.locator('[data-expiry-row="2026-05-29"]')).toContainText("26-05-29");
    await expect(page.getByText(/May 29, 2026/)).toBeVisible();
    const may29Class = await page.locator('[data-expiry-row="2026-05-29"]').getAttribute("class");
    assert.match(may29Class || "", /bg-blue-500/);

    await page.locator('[data-expiry-row="2026-06-01"]').click();
    await expect(page.getByText(/Jun 1, 2026/)).toBeVisible();
    const jun1Class = await page.locator('[data-expiry-row="2026-06-01"]').getAttribute("class");
    assert.match(jun1Class || "", /bg-blue-500/);
    assert.ok(toolCalls.some((call) => call.tool === "get_options" && call.params?.expiry === "2026-06-01"), "expiry row click must request get_options for clicked expiry");
    assert.ok(toolCalls.some((call) => call.tool === "get_options_gex" && call.params?.expiry === "2026-06-01"), "expiry row click must request get_options_gex for clicked expiry");
    assert.ok(toolCalls.some((call) => call.tool === "get_options_pcr" && call.params?.expiry === "2026-06-01"), "expiry row click must request get_options_pcr for clicked expiry");
    await expect(page.locator("[data-ai-summary-panel]")).toContainText("2026-06-01");
    assert.equal(summaryCalls.length, 0, "expiry changes must refresh deterministic summary without network calls");

    await page.getByRole("button", { name: "OI", exact: true }).click();
    await expect(page.getByText(/Jun 1, 2026/)).toBeVisible();
    await page.locator("[data-chart-bar]").nth(4).hover();
    await expect(page.getByText(/^Call (?!0$)/)).toBeVisible();
    await page.getByLabel("Strike zoom").fill("9");
    await expect(page.locator("[data-chart-bar]")).toHaveCount(9);
    await page.getByRole("button", { name: "Vol", exact: true }).click();
    await expect(page.getByText(/Jun 1, 2026/)).toBeVisible();
    await page.getByRole("button", { name: "GEX", exact: true }).click();
    await expect(page.getByText(/Jun 1, 2026/)).toBeVisible();
    await expect(page.getByText("26-06-01").first()).toBeVisible();
    await page.getByRole("button", { name: "IV", exact: true }).click();
    await expect(page.getByText("Call OI/Vol").first()).toBeVisible();
    await expect(page.getByText(/45\.\d%/).first()).toBeVisible();
    await page.getByRole("button", { name: "GEX", exact: true }).click();
    assert.equal(await page.locator("pre").filter({ hasText: '"source"' }).count(), 0, "options dashboard must not expose raw JSON");
    await page.getByRole("button", { name: "OI", exact: true }).click();
    await page.getByRole("button", { name: "GEX", exact: true }).click();
    await wait(150);
    assert.equal(summaryCalls.length, 0, "switching Options modes must not call an AI summary endpoint");
    await expect(page.locator("[data-ai-summary-panel]").getByRole("button", { name: "Refresh" })).toHaveCount(0);
    const desktopDetailGaps = await page.evaluate(() => {
      const primary = document.querySelector('[data-primary-tab-panel="Options"]')?.getBoundingClientRect();
      const summary = document.querySelector("[data-ai-summary-panel]")?.getBoundingClientRect();
      const bottom = document.querySelector("[data-bottom-panels]")?.getBoundingClientRect();
      if (!primary || !summary || !bottom) return null;
      return {
        top: summary.top - primary.bottom,
        bottom: bottom.top - summary.bottom,
      };
    });
    assert.ok(desktopDetailGaps, "desktop detail stack must render primary panel, AI summary, and bottom panels");
    assert.ok(
      Math.abs(desktopDetailGaps.top - desktopDetailGaps.bottom) <= 1.5,
      `AI summary spacing should be balanced above and below; got top=${desktopDetailGaps.top}, bottom=${desktopDetailGaps.bottom}`,
    );

    const fepiRequestsBeforeRemove = requestCounts.FEPI || 0;
    await page.getByLabel("Remove FEPI").click();
    await expect(page.getByLabel("Remove FEPI")).toHaveCount(0);
    await wait(250);
    assert.equal(requestCounts.FEPI || 0, fepiRequestsBeforeRemove, "removing FEPI must not load FEPI");

    const irenRow = page.locator('div[role="button"]').filter({ hasText: "IREN" }).first();
    await irenRow.click();
    await expect(page.getByRole("heading", { name: "IREN" })).toBeVisible();
    assert.equal(requestCounts.IREN || 0, 1, "first IREN click should fetch once");
    await irenRow.click();
    await wait(350);
    assert.equal(requestCounts.IREN || 0, 1, "second cached IREN click should not refetch");

    await page.locator('input[placeholder*="ticker"]').fill("TSLA");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "TSLA" })).toBeVisible();
    assert.equal(requestCounts.TSLA || 0, 1, "searching a curated ticker should load that ticker once");

    await page.locator("[data-chart-bar]").nth(4).hover();
    await expect(page.getByText(/^Strike \d/)).toBeVisible();
    await expect(page.getByText(/^Call /)).toBeVisible();
    await expect(page.getByText(/^Put /)).toBeVisible();

    await page.setViewportSize({ width: 414, height: 896 });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${baseUrl}/?mobile-uat=1#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-watchlist-row]")).toHaveCount(50);
    await page.locator('[data-watchlist-row="MCD"]').click();
    await expect(page.getByRole("heading", { name: "MCD" })).toBeVisible();
    await wait(150);
    const headingBox = await page.getByRole("heading", { name: "MCD" }).boundingBox();
    assert.ok(headingBox && headingBox.y >= 0 && headingBox.y < 260, "mobile stock click must bring the detail panel into view");
    const chartBox = await page.locator("[data-options-chart-viewport]").boundingBox();
    const summaryBox = await page.locator("[data-ai-summary-panel]").boundingBox();
    const bottomBox = await page.locator("[data-bottom-panels]").boundingBox();
    assert.ok(chartBox && summaryBox && bottomBox, "mobile chart, AI summary, and bottom panels must all render");
    assert.ok(chartBox.y + chartBox.height <= summaryBox.y, "mobile options chart must not overlap AI summary");
    assert.ok(summaryBox.y + summaryBox.height <= bottomBox.y, "mobile AI summary must not overlap bottom cards");

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved ${screenshotPath}`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
