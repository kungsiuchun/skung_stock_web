const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const puppeteer = require("puppeteer");
const { startVite, waitForServer, stopProcessTree } = require("./helpers/browser-uat.cjs");
const rootDir = path.resolve(__dirname, "..");
const baseUrl = "http://localhost:5191";
const history = [{ symbol: "SPY", timestamp: "10:00", score: 50 }];
const result = (symbol) => ({ symbol, price: 500, change: "+1.00%", algoRating: 50, marketSentiment: null,
  quantStrategySchemaVersion: "v3", strategyPoints: {}, chartData: [], news: [], quantStrategies: [],
  recommendedTrade: null, decision: { status: "unavailable", reason: "Fixture has no trading decision" },
});

(async () => {
  const server = startVite({ rootDir, port: 5191 });
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    const requests = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/finance-dashboard/snapshot") {
        requests.push(JSON.parse(request.postData()));
        void request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture source unavailable" }) });
      } else if (url.pathname.startsWith("/api/") || url.hostname !== "localhost") void request.abort();
      else void request.continue();
    });
    await page.evaluateOnNewDocument((initialHistory) => {
      if (!sessionStorage.getItem("finance-uat-seeded")) {
        localStorage.setItem("finance_dashboard_history", JSON.stringify(initialHistory));
        sessionStorage.setItem("finance-uat-seeded", "1");
      }
    }, history);
    await page.goto(`${baseUrl}/#/work/finance-analyzer`, { waitUntil: "networkidle0" });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("finance_dashboard_history"))), history,
      "Mounting in Strict Mode must not overwrite saved history with empty initial state");
    const input = await page.$("input[placeholder*='股票']");
    assert.ok(input, "Finance search input must be present");
    await input.type("NVDA");
    await input.focus();
    const row = await page.waitForSelector("button::-p-text(SPY)");
    await row.click();
    await page.waitForFunction(() => document.body.textContent.includes("Fixture source unavailable"));
    assert.deepEqual(requests, [{ symbol: "SPY" }], "Selecting SPY history must not analyze the prior NVDA input");
    await input.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await input.focus();
    await page.click("button::-p-text(SPY)");
    await page.waitForNetworkIdle();
    assert.deepEqual(requests, [{ symbol: "SPY" }, { symbol: "SPY" }], "An empty input must not block a history analysis");
    await page.close();

    const screenshots = path.join(rootDir, "uat_screenshots", "finance-reliability");
    fs.mkdirSync(screenshots, { recursive: true });
    for (const [width, mode] of [390, 768, 1440].flatMap((width) => ["blocked", "quota", "bad-json", "bad-fields"].map((mode) => [width, mode]))) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 844 });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const chatRequests = [];
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/finance-dashboard/snapshot") {
          const { symbol } = JSON.parse(request.postData());
          void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { data: result(symbol), technicalData: null, valuationData: null, vixData: null }, cache: { status: "hit", cachedAt: "2026-10-20T20:00:00Z", sourceAsOf: "2026-10-20T20:00:00Z" } }) });
        } else if (url.pathname === "/api/agent/chat") {
          chatRequests.push(JSON.parse(request.postData()));
          void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Fixture answer is available.", steps: [], history: [], new_memories: ["Prefers ETFs"] }) });
        } else if (url.pathname.startsWith("/api/") || url.hostname !== "localhost") void request.abort();
        else void request.continue();
      });
      await page.evaluateOnNewDocument((mode) => {
        localStorage.clear();
        localStorage.setItem("unrelated-key", "preserve");
        if (mode === "blocked") Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
        if (mode === "quota") Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
        if (mode === "bad-json") localStorage.setItem("finance_dashboard_history", "{broken JSON");
        if (mode === "bad-fields") {
          localStorage.setItem("finance_dashboard_history", JSON.stringify([{ symbol: {}, score: {}, timestamp: "10:00" }, { symbol: "SPY", score: 50, timestamp: "10:00", fullData: {} }]));
          localStorage.setItem("finance_dashboard_active_data", "{}");
          localStorage.setItem("finance_agent_user_memory", JSON.stringify([{}]));
        }
      }, mode);
      await page.goto(`${baseUrl}/#/work/finance-analyzer`, { waitUntil: "networkidle0" });
      await page.waitForSelector("input[name='finance-symbol']");
      assert.equal(await page.$eval("input[name='finance-symbol']", (node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      }), true, `Finance search must fit at ${width}px`);
      if (mode !== "quota") {
        await page.waitForSelector("[aria-label='Browser storage warning']");
        assert.equal(await page.$("[role='alert'] h1"), null, "Bad storage must not trip the route boundary");
      }
      if (mode === "bad-json") assert.equal(await page.evaluate(() => localStorage.getItem("finance_dashboard_history")), "{broken JSON", "Invalid history must not be silently overwritten on mount");
      if (mode === "bad-fields") assert.equal(await page.evaluate(() => localStorage.getItem("finance_dashboard_active_data")), "{}", "Invalid active data must not be silently deleted");
      if (mode === "quota" || mode === "blocked") {
        await page.type("input[name='finance-symbol']", "NVDA");
        await page.keyboard.press("Enter");
        await page.waitForSelector("h2::-p-text(NVDA)");
        await page.waitForSelector("[aria-label='Browser storage warning']");
        assert.match(await page.$eval("[aria-label='Browser storage warning']", (node) => node.textContent), /not.*preserved after reloading/i);
        if (mode === "quota") await page.screenshot({ path: path.join(screenshots, `quota-warning-${width}.png`) });
      }
      await page.click("button[title='Analyzer (Chat Bot)']");
      await page.waitForSelector("input[name='finance-question']");
      if (mode === "blocked" || mode === "bad-fields") await page.waitForSelector("[aria-label='Agent memory storage warning']");
      await page.type("input[name='finance-question']", "Test question");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("[role='log']")?.textContent.includes("Fixture answer is available."));
      await page.waitForNetworkIdle();
      assert.doesNotMatch(await page.$eval("[role='log']", (node) => node.textContent), /Error:/, "Memory persistence failure must not append a fake API error");
      assert.deepEqual(chatRequests[0].user_memories, [], "Invalid persisted memory must never be sent to the agent");
      if (mode === "quota" || mode === "blocked") await page.waitForSelector("[aria-label='Agent memory storage warning']");
      if (mode !== "blocked") assert.equal(await page.evaluate(() => localStorage.getItem("unrelated-key")), "preserve");
      assert.deepEqual(pageErrors, [], "Storage failures must not produce uncaught render errors");
      await page.close();
    }
    const cached = await browser.newPage();
    let automaticRequests = 0;
    await cached.setRequestInterception(true);
    cached.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/finance-dashboard/snapshot") { automaticRequests++; void request.abort(); }
      else if (url.pathname.startsWith("/api/") || url.hostname !== "localhost") void request.abort();
      else void request.continue();
    });
    await cached.evaluateOnNewDocument((cachedResult) => {
      if (sessionStorage.getItem("cached-fixture")) return;
      localStorage.clear();
      localStorage.setItem("finance_dashboard_history", JSON.stringify([{ symbol: "SPY", timestamp: "10:00", score: 50, fullData: cachedResult }]));
      localStorage.setItem("finance_dashboard_active_data", JSON.stringify({ ...cachedResult, symbol: "NVDA" }));
      sessionStorage.setItem("cached-fixture", "1");
    }, result("SPY"));
    await cached.goto(`${baseUrl}/#/work/finance-analyzer`, { waitUntil: "networkidle0" });
    await cached.waitForSelector("h2::-p-text(NVDA)");
    await cached.focus("input[name='finance-symbol']");
    await cached.click("button::-p-text(SPY)");
    await cached.waitForSelector("h2::-p-text(SPY)");
    assert.equal(await cached.$eval("input[name='finance-symbol']", (node) => node.value), "SPY");
    assert.equal(automaticRequests, 0, "Restoring valid history must not run an analysis API");
    await cached.reload({ waitUntil: "networkidle0" });
    await cached.waitForSelector("h2::-p-text(SPY)");
    assert.equal(automaticRequests, 0);
    assert.equal(await cached.$("[aria-label='Browser storage warning']"), null, "A valid cached result must survive reload without a warning");
    await cached.close();
    await require("./helpers/finance-workspace-uat.cjs")(browser, baseUrl, path.join(rootDir, "uat_screenshots", "finance-workspace", "after"));
    console.log("Finance reliability UAT passed: storage, history, chat, responsive research workflow, tabs, request ordering, partial/stale/error recovery.");
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => { console.error(error); process.exit(1); });
