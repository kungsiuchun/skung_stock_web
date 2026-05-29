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

const buildSnapshot = (symbol) => {
  const quoteBySymbol = {
    TSLA: { price: 442.1, change: 1.74, changePercent: 0.4, companyName: "Tesla Inc." },
    IREN: { price: 64.05, change: -3.79, changePercent: -0.53, companyName: "Iris Energy" },
    MU: { price: 123.52, change: -4.89, changePercent: -0.53, companyName: "Micron Technology" },
  };
  const quote = quoteBySymbol[symbol] || quoteBySymbol.TSLA;
  const strikes = Array.from({ length: 29 }, (_, index) => {
    const strike = 407.5 + index * 2.5;
    const distance = Math.abs(strike - 442.5);
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
    spot: 442.1,
    atm: 442.1,
    selectedTimeLabel: "live",
    gexRegime: "Pinning",
    putCallOpenInterest: 0.67,
    putCallVolume: 0.72,
    sweeps: 0,
    expiries: [
      { expiry: "2026-05-29", openInterest: 6600, strike: 432.5, volume: 726, type: "C" },
      { expiry: "2026-05-31", openInterest: 7300, strike: 440, volume: 636, type: "P" },
      { expiry: "2026-06-02", openInterest: 17_800, strike: 447.5, volume: 1700, type: "C" },
    ],
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
    source: "stocks_intelligence_mcp",
  };
};

(async () => {
  let server;
  let browser;
  const requestCounts = {};

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

    await page.route("**/api/stocks-intelligence-watcher?**", async (route) => {
      const url = new URL(route.request().url());
      const symbol = (url.searchParams.get("symbol") || "TSLA").toUpperCase();
      requestCounts[symbol] = (requestCounts[symbol] || 0) + 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildSnapshot(symbol)),
      });
    });

    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "TSLA" })).toBeVisible();

    await expect(page.locator('text="Spot $442.10"')).toHaveCount(1);

    const muRequestsBeforeRemove = requestCounts.MU || 0;
    await page.getByLabel("Remove MU").click();
    await expect(page.getByLabel("Remove MU")).toHaveCount(0);
    await wait(250);
    assert.equal(requestCounts.MU || 0, muRequestsBeforeRemove, "removing MU must not load MU");

    const irenRow = page.locator('div[role="button"]').filter({ hasText: "IREN" }).first();
    await irenRow.click();
    await expect(page.getByRole("heading", { name: "IREN" })).toBeVisible();
    assert.equal(requestCounts.IREN || 0, 1, "first IREN click should fetch once");
    await irenRow.click();
    await wait(350);
    assert.equal(requestCounts.IREN || 0, 1, "second cached IREN click should not refetch");

    await page.locator("[data-chart-bar]").nth(10).hover();
    await expect(page.getByText(/^Strike /)).toBeVisible();
    await expect(page.getByText(/^Call /)).toBeVisible();
    await expect(page.getByText(/^Put /)).toBeVisible();

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
