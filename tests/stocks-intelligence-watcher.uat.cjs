const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const puppeteer = require("puppeteer");

const rootDir = path.resolve(__dirname, "..");
const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshotsDir = path.join(rootDir, "uat_screenshots", "stocks-watcher-replica");

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

const expiries = ["2026-07-08", "2026-07-10", "2026-07-13", "2026-07-17", "2026-07-24"];
const uatStocks = [
  ["NVDA", "NVIDIA Corporation", "Semiconductors", "Stock", 204.12, 4.03, 2.01],
  ["GOOG", "Alphabet Inc.", "Communication Services", "Stock", 376.43, -9.69, -2.51],
  ["GOOGL", "Alphabet Inc.", "Communication Services", "Stock", 380.34, -9.79, -2.51],
  ["AAPL", "Apple Inc.", "Technology", "Stock", 312.06, -0.45, -0.14],
  ["MSFT", "Microsoft Corporation", "Technology", "Stock", 450.24, 23.25, 5.45],
  ["AMZN", "Amazon.com Inc.", "Consumer Discretionary", "Stock", 270.64, -3.36, -1.23],
  ["AVGO", "Broadcom Inc.", "Semiconductors", "Stock", 446.77, 20.19, 4.73],
  ["TSLA", "Tesla Inc.", "Consumer Discretionary", "Stock", 435.79, -6.31, -1.43],
  ["META", "Meta Platforms Inc.", "Communication Services", "Stock", 632.51, -2.78, -0.44],
  ["QQQI", "NEOS Nasdaq-100 High Income ETF", "Income ETFs", "ETF", 50.42, 0.18, 0.36],
];

const stockRecords = uatStocks.map(([symbol, companyName, sector, type, fallbackPrice, fallbackChange, fallbackChangePercent]) => ({
  symbol,
  companyName,
  sector,
  type,
  fallbackPrice,
  fallbackChange,
  fallbackChangePercent,
}));

const fmtDate = (date) => date.replaceAll("-", "").slice(2);

const buildSnapshot = (symbol) => {
  const stock = stockRecords.find((item) => item.symbol === symbol) || {
    symbol,
    companyName: `${symbol} custom stock`,
    sector: "Custom",
    type: "Stock",
    fallbackPrice: 88.42,
    fallbackChange: 1.18,
    fallbackChangePercent: 1.35,
  };
  const price = stock.fallbackPrice;
  const strikes = Array.from({ length: 29 }, (_, index) => {
    const strike = 170 + index * 2.5;
    const callVolume = Math.max(50, Math.round(2400 - Math.abs(strike - price) * 28));
    const putVolume = Math.max(45, Math.round(1800 - Math.abs(strike - price) * 21));
    return {
      strike,
      callOpenInterest: callVolume * 6,
      putOpenInterest: putVolume * 5,
      callVolume,
      putVolume,
      callGex: Math.round(callVolume * strike * 500),
      putGex: -Math.round(putVolume * strike * 430),
      netGex: Math.round(callVolume * strike * 500 - putVolume * strike * 430),
    };
  });

  return {
    generatedAt: "2026-07-08T21:33:00.000Z",
    symbol,
    quote: {
      symbol,
      companyName: stock.companyName,
      price,
      change: stock.fallbackChange,
      changePercent: stock.fallbackChangePercent,
      asOf: "2026-07-08T20:00:00.000Z",
    },
    spot: price,
    atm: Math.round(price / 5) * 5,
    selectedTimeLabel: "live",
    gexRegime: "Pinning",
    putCallOpenInterest: 0.82,
    putCallVolume: 0.78,
    sweeps: 0,
    availableExpiries: expiries,
    selectedExpiry: expiries[0],
    expiryRows: expiries.map((expiry, index) => ({
      expiry,
      openInterest: index === 0 ? 331_000 : 7_400,
      primaryStrike: index === 0 ? 200 : 235,
      strike: index === 0 ? 200 : 235,
      volume: index === 0 ? 2_800_000 : 1_400,
      dominantType: "C",
      type: "C",
    })),
    expiries: expiries.map((expiry, index) => ({
      expiry,
      openInterest: index === 0 ? 331_000 : 7_400,
      primaryStrike: index === 0 ? 200 : 235,
      strike: index === 0 ? 200 : 235,
      volume: index === 0 ? 2_800_000 : 1_400,
      dominantType: "C",
      type: "C",
    })),
    strikes,
    history: [
      { label: "9:30", price: price - 4.03 },
      { label: "10:30", price: price - 2.1 },
      { label: "11:30", price: price - 3.2 },
      { label: "12:30", price: price + 0.4 },
      { label: "1:00", price },
    ],
    marketContext: {
      breadth: "Watcher breadth mock response.",
      relativeStrength: "Relative strength mock response.",
    },
    availableTools: [
      { name: "quoteSummary", description: "Yahoo quote summary", inputKeys: ["ticker"] },
      { name: "financialData", description: "Yahoo financial data", inputKeys: ["ticker"] },
      { name: "get_intraday", description: "Yahoo intraday chart", inputKeys: ["ticker"] },
      { name: "get_options", description: "Yahoo options chain", inputKeys: ["ticker", "expiry"] },
      { name: "get_options_gex", description: "Local GEX proxy", inputKeys: ["ticker", "expiry"] },
      { name: "get_options_greeks", description: "Local Greek approximation", inputKeys: ["ticker", "expiry", "strike"] },
      { name: "get_options_iv_intraday", description: "IV snapshot", inputKeys: ["ticker", "expiry"] },
      { name: "get_options_mispricing", description: "Mispricing scan", inputKeys: ["ticker", "expiry"] },
    ],
    toolRuns: [
      { name: "get_quotes", status: "ok", detail: "mocked" },
      { name: "get_options", status: "ok", detail: "mocked" },
    ],
    warnings: [],
    source: "native_yahoo",
  };
};

const optionRows = (price = 204.12) => {
  return Array.from({ length: 13 }, (_, index) => {
    const strike = 190 + index * 2.5;
    const callVolume = Math.max(100, Math.round(3400 - Math.abs(strike - price) * 60));
    const putVolume = Math.max(80, Math.round(2800 - Math.abs(strike - price) * 54));
    const netGex = Math.round((callVolume - putVolume) * strike * 620);
    return {
      strike,
      callOpenInterest: callVolume * 6,
      putOpenInterest: putVolume * 5,
      callVolume,
      putVolume,
      callEffectiveOpenInterest: callVolume * 6,
      putEffectiveOpenInterest: putVolume * 5,
      callGex: Math.round(callVolume * strike * 640),
      putGex: -Math.round(putVolume * strike * 610),
      netGex,
      callDex: Math.round(callVolume * 43),
      putDex: -Math.round(putVolume * 39),
      netDex: Math.round(callVolume * 43 - putVolume * 39),
      callIv: 24 + index * 0.9,
      putIv: 25 + index * 0.8,
      avgIv: 25 + index * 0.85,
      call: { strike, bid: 10 + index, ask: 10.35 + index, volume: callVolume, openInterest: callVolume * 6, impliedVolatility: 24 + index * 0.9 },
      put: { strike, bid: 8 + index, ask: 8.35 + index, volume: putVolume, openInterest: putVolume * 5, impliedVolatility: 25 + index * 0.8 },
    };
  });
};

const historyRows = () => Array.from({ length: 90 }, (_, index) => ({
  date: `2026-07-${String(1 + Math.floor(index / 12)).padStart(2, "0")}T${String(9 + (index % 12)).padStart(2, "0")}:30:00.000Z`,
  open: 195 + Math.sin(index / 5) * 3 + index * 0.08,
  high: 196 + Math.sin(index / 5) * 3 + index * 0.08,
  low: 194 + Math.sin(index / 5) * 3 + index * 0.08,
  close: 195.5 + Math.sin(index / 5) * 3 + index * 0.08,
  volume: 1_000_000 + index * 12_000,
}));

const buildToolResponse = (tool, params = {}) => {
  if (tool === "get_watchlist") {
    return { ok: true, tool, params, text: "watchlist", raw: { stocks: stockRecords }, calledAt: "2026-07-08T21:33:01.000Z" };
  }

  if (tool === "save_memory") {
    return { ok: true, tool, params, text: "saved", raw: { saved: true }, calledAt: "2026-07-08T21:33:02.000Z" };
  }

  if (tool === "get_intraday" || tool === "get_stock_history") {
    return { ok: true, tool, params, text: "history", raw: { history: historyRows() }, calledAt: "2026-07-08T21:33:03.000Z" };
  }

  const rows = optionRows();
  if (tool === "get_options") {
    const chain = {
      symbol: params.ticker || "NVDA",
      spot: 204.12,
      expiries,
      selectedExpiry: params.expiry || expiries[0],
      calls: rows.map((row) => row.call),
      puts: rows.map((row) => row.put),
    };
    return { ok: true, tool, params, text: "options chain", raw: { chain }, calledAt: "2026-07-08T21:33:04.000Z" };
  }

  if (/options|greeks|dex|iv|pcr|sweeps|mispricing/i.test(tool)) {
    const raw = tool === "get_options_pcr"
      ? { putCallOpenInterest: 0.82, putCallVolume: 0.78 }
      : { rows, exposures: rows };
    return { ok: true, tool, params, text: `${tool} rows`, raw, calledAt: "2026-07-08T21:33:05.000Z" };
  }

  return { ok: true, tool, params, text: `${tool} native mocked response`, raw: { ok: true }, calledAt: "2026-07-08T21:33:06.000Z" };
};

const clickText = async (page, text, exact = false) => {
  const clicked = await page.evaluate(({ text, exact }) => {
    const buttons = [...document.querySelectorAll("[data-watcher-replica] button, [data-close-strike-detail]")];
    const button = buttons.find((item) => {
      const value = (item.textContent || "").trim();
      return exact ? value === text : value.includes(text);
    });
    if (!button) return false;
    button.click();
    return true;
  }, { text, exact });
  assert.equal(clicked, true, `button "${text}" should be clickable`);
};

const visibleText = (page) => page.$eval("[data-watcher-replica]", (node) => node.innerText);

(async () => {
  let server;
  let browser;
  const apiCalls = [];
  const consoleErrors = [];

  try {
    fs.mkdirSync(screenshotsDir, { recursive: true });
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
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!url.pathname.includes("/api/stocks-intelligence-watcher")) {
        request.continue();
        return;
      }

      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        apiCalls.push(body);
        request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildToolResponse(body.tool, body.params || {})),
        });
        return;
      }

      const symbol = (url.searchParams.get("symbol") || "NVDA").toUpperCase();
      apiCalls.push({ method: "GET", symbol });
      request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildSnapshot(symbol)),
      });
    });

    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-watcher-replica]");
    await wait(1000);
    await page.screenshot({ path: path.join(screenshotsDir, "uat-desktop-overview.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "01-entry-shell-desktop.png") });

    assert.equal(await page.$eval("body", (body) => body.innerText.includes("MARKET LAB")), false, "Watcher must hide portfolio navbar");
    assert.match(await visibleText(page), /Market Overview/i);
    assert.match(await page.$eval(".siw-main-tabs .is-active", (node) => node.textContent), /Overview/);
    assert.deepEqual(
      await page.$$eval("[data-market-index-label]", (nodes) => nodes.map((node) => node.textContent?.trim())),
      ["S&P 500", "NASDAQ 100", "DOW JONES"],
      "overview must render real market index cards",
    );
    assert.ok(
      await page.$eval("[data-hero-sparkline='true']", (node) => node.getBoundingClientRect().width >= 220),
      "hero price sparkline should be wide enough to show the full shape",
    );
    const logoBox = await page.$eval("[data-ticker-logo='NVDA']", (node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(Math.abs(logoBox.width - logoBox.height) <= 1, `ticker logo should be square; got ${logoBox.width}x${logoBox.height}`);
    const tertiaryBoxes = await page.$$eval("[data-overview-tertiary-panel]", (nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width };
      }),
    );
    assert.equal(tertiaryBoxes.length, 3, "overview must render news, earnings, and key metrics panels");
    assert.ok(
      tertiaryBoxes.every((box) => Math.abs(box.top - tertiaryBoxes[0].top) <= 2),
      `overview tertiary panels should share one row; got ${JSON.stringify(tertiaryBoxes)}`,
    );
    assert.ok(
      tertiaryBoxes[0].left < tertiaryBoxes[1].left && tertiaryBoxes[1].left < tertiaryBoxes[2].left,
      "overview tertiary panels should be side by side left-to-right",
    );

    await page.type('input[name="stock-search"]', "EOSE");
    await clickText(page, "LOAD");
    await wait(600);
    assert.match(await visibleText(page), /EOSE/);
    assert.equal(await page.$eval('input[name="stock-search"]', (input) => input.value), "");
    const rowsAfterCustomLoad = await page.$$eval("[data-watcher-replica] [data-watchlist-row]", (rows) =>
      rows.map((row) => row.getAttribute("data-watchlist-row")),
    );
    assert.ok(rowsAfterCustomLoad.includes("EOSE"), "custom ticker load should add the ticker row");
    assert.ok(rowsAfterCustomLoad.length > 1, "custom ticker load must keep the rest of the watchlist visible");

    await page.type('input[name="stock-search"]', "TSLA");
    await clickText(page, "LOAD");
    await wait(600);
    assert.match(await visibleText(page), /TSLA/);

    await page.click('input[name="stock-search"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.querySelector('input[name="stock-search"]')?.value === "");
    await page.select("select[aria-label='Sector filter']", "Technology");
    await page.select("select[aria-label='Type filter']", "Stock");
    await wait(150);
    assert.match(await visibleText(page), /MSFT|AAPL/);

    await page.select("select[aria-label='Sector filter']", "All Sectors");
    await page.select("select[aria-label='Type filter']", "All Types");
    await wait(150);
    await clickText(page, "All Stocks");
    await page.waitForFunction(() => document.querySelectorAll("[data-watcher-replica] [data-watchlist-row]").length > 0);

    await clickText(page, "⌯", true);
    assert.equal(await page.$("[data-filter-panel]") !== null, true, "filter icon should reveal filter panel");

    await page.click("[data-watcher-replica] button[aria-label='Collapse watchlist']");
    await wait(150);
    assert.equal(await page.$eval("[data-watcher-replica]", (node) => node.classList.contains("is-rail-collapsed")), true);
    await page.click("[data-watcher-replica] button[aria-label='Expand watchlist']");
    await page.waitForFunction(() => !document.querySelector("[data-watcher-replica]")?.classList.contains("is-rail-collapsed"));
    await page.waitForFunction(() => document.querySelectorAll("[data-watcher-replica] [data-watchlist-row]").length > 0);

    const favoriteSymbol = await page.$eval("[data-watchlist-scope] [data-watchlist-row]", (row) => row.getAttribute("data-watchlist-row"));
    await page.click(`[data-watchlist-scope] input[aria-label='Favorite ${favoriteSymbol}']`);
    await wait(150);
    assert.ok(apiCalls.some((call) => call.tool === "save_memory"), "favorite should persist through save_memory");
    await clickText(page, "FAV");
    await wait(150);
    assert.match(await visibleText(page), new RegExp(`\\b${favoriteSymbol}\\b`));
    await clickText(page, "All Stocks");

    const removableSymbol = await page.$$eval("[data-watcher-replica] [data-watchlist-row]", (rows) => {
      return rows.map((row) => row.getAttribute("data-watchlist-row")).find((symbol) => Boolean(symbol));
    });
    await page.click(`[data-watcher-replica] [data-watchlist-row="${removableSymbol}"]`);
    await wait(450);
    assert.match(await visibleText(page), new RegExp(`\\b${removableSymbol}\\b`));
    await page.click(`[data-watcher-replica] button[aria-label="Remove ${removableSymbol}"]`);
    await wait(150);
    assert.equal(await page.$(`[data-watcher-replica] [data-watchlist-row="${removableSymbol}"]`) === null, true, "remove should hide ticker row");

    await clickText(page, "Add ticker");
    assert.equal(await page.$eval('input[name="stock-search"]', (input) => input.value), "SOFI");
    await page.click('input[name="stock-search"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.querySelector('input[name="stock-search"]')?.value === "");
    await page.waitForFunction(() => document.querySelectorAll("[data-watcher-replica] [data-watchlist-row]").length > 0);
    await page.click("button[aria-label='Settings']");
    assert.equal(await page.$("[data-settings-panel]") !== null, true, "settings should open panel");
    await clickText(page, "Retry / refresh");
    await page.click("button[aria-label='Settings']");
    await wait(150);
    assert.equal(await page.$("[data-settings-panel]") === null, true, "settings should close before visual captures");

    await clickText(page, "Chart");
    await wait(700);
    assert.equal(await page.$("[data-price-chart-surface]") !== null, true, "chart tab should render chart surface");
    await page.screenshot({ path: path.join(screenshotsDir, "03-chart-tab-ohlc-volume-desktop.png") });

    await clickText(page, "Stats");
    await wait(700);
    assert.match(await visibleText(page), /Native Yahoo Stats/i);
    await page.screenshot({ path: path.join(screenshotsDir, "04-stats-fundamentals-earnings-desktop.png") });

    await clickText(page, "Options");
    await wait(900);
    await clickText(page, "GEX", true);
    await wait(500);
    assert.equal(await page.$$eval("[data-watcher-replica] [data-chart-bar]", (items) => items.length > 5), true);
    await page.screenshot({ path: path.join(screenshotsDir, "02-options-overview-gex-desktop.png") });
    await page.focus("[data-watcher-replica] input[aria-label='Strike zoom']");
    await page.keyboard.press("Home");
    await wait(250);
    assert.equal(await page.$$eval("[data-watcher-replica] [data-chart-bar]", (items) => items.length), 9);
    await page.hover("[data-watcher-replica] [data-chart-bar]");
    await wait(150);
    assert.match(await visibleText(page), /Strike|Call|Put/);
    await page.click("[data-watcher-replica] [data-chart-bar]");
    await wait(700);
    assert.match(await page.$eval("body", (body) => body.innerText), /Strike Detail/i);
    await page.screenshot({ path: path.join(screenshotsDir, "06-strike-detail-drawer-desktop.png") });
    await page.click("[data-close-strike-detail]");
    await wait(150);

    for (const subTab of ["OI", "Vol", "Greeks", "DEX", "Flow", "IV", "Mis$", "P/C", "Chain", "Sweeps", "0DTE"]) {
      await clickText(page, subTab, true);
      await wait(250);
      assert.match(await page.$eval(".siw-options-subtabs .is-active", (node) => node.textContent), new RegExp(subTab.replace("$", "\\$")));
      if (subTab === "Greeks") {
        await page.screenshot({ path: path.join(screenshotsDir, "05-options-greeks-chain-desktop.png") });
      }
    }

    await clickText(page, "GEX", true);
    await wait(300);
    await page.click("[data-expiry-row='2026-07-10']");
    await wait(250);
    assert.ok(apiCalls.some((call) => call.params?.expiry === "2026-07-10"), "expiry click should request selected expiry");
    const configWasOpen = await page.$("[data-settings-panel]") !== null;
    await clickText(page, "Config");
    await wait(150);
    const configIsOpen = await page.$("[data-settings-panel]") !== null;
    assert.notEqual(configIsOpen, configWasOpen, "config should toggle visible settings panel");
    await page.evaluate(() => {
      const detail = document.querySelector("[data-detail-stack]");
      detail?.scrollIntoView({ block: "start" });
    });
    await wait(250);
    await page.screenshot({ path: path.join(screenshotsDir, "07-ai-summary-audit-panels-desktop.png") });
    await page.evaluate(() => {
      const scroller = document.querySelector(".siw-main-scroll");
      scroller?.scrollTo({ top: 0 });
    });
    await wait(150);

    await clickText(page, "Overview");
    await clickText(page, "Open Yahoo news tool output");
    assert.match(await page.$eval(".siw-main-tabs .is-active", (node) => node.textContent), /News/);
    await clickText(page, "Overview");
    await clickText(page, "View earnings tools");
    assert.match(await page.$eval(".siw-main-tabs .is-active", (node) => node.textContent), /Earnings/);

    await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
    await wait(300);
    await page.screenshot({ path: path.join(screenshotsDir, "uat-tablet.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "08-responsive-tablet.png") });
    await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });
    await clickText(page, "Options");
    await wait(300);
    await page.screenshot({ path: path.join(screenshotsDir, "uat-mobile.png"), fullPage: true });
    await page.screenshot({ path: path.join(screenshotsDir, "08-responsive-mobile.png"), fullPage: true });
    await clickText(page, "Home");
    assert.match(await page.$eval(".siw-mobile-nav .is-active", (node) => node.textContent), /Home/);
    await clickText(page, "Watcher");
    assert.match(await page.$eval(".siw-mobile-nav .is-active", (node) => node.textContent), /Watcher/);

    assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join("; ")}`);
    console.log(`Stocks watcher replica UAT passed. Screenshots: ${screenshotsDir}`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
