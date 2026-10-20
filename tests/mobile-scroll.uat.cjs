const assert = require("node:assert/strict");
const puppeteer = require("puppeteer");
const { startVite, waitForServer } = require("./helpers/browser-uat.cjs");

const rootDir = require("node:path").resolve(__dirname, "..");
const port = 5175;
const baseUrl = `http://localhost:${port}`;
async function expectDocumentScroll(page, name) {
  const before = await page.evaluate(() => ({
    height: document.scrollingElement.scrollHeight,
    viewport: window.innerHeight,
    overflowY: getComputedStyle(document.body).overflowY,
  }));
  assert.notEqual(before.overflowY, "hidden", `${name} must not hide document vertical overflow on mobile`);
  assert.ok(before.height > before.viewport, `${name} must have content below the mobile viewport`);

  await page.evaluate(() => window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" }));
  const scrollY = await page.evaluate(() => window.scrollY);
  assert.ok(scrollY > 0, `${name} must actually move when the document scrolls`);
}

async function expectChatAccessible(page, name) {
  const state = await page.evaluate(() => {
    const chat = document.querySelector('[aria-label="Finance Agent Chat"]');
    const messageScroller = chat?.querySelector('.overflow-y-auto');
    const input = chat?.querySelector('input[placeholder^="Type your question"]');
    const chatBounds = chat?.getBoundingClientRect();
    const inputBounds = input?.getBoundingClientRect();
    return {
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      chatBottom: chatBounds?.bottom ?? 0,
      inputBottom: inputBounds?.bottom ?? 0,
      messageOverflowY: messageScroller ? getComputedStyle(messageScroller).overflowY : null,
      viewport: window.innerHeight,
    };
  });

  assert.notEqual(state.bodyOverflowY, "hidden", `${name} must not be blocked by the document viewport lock`);
  assert.equal(state.messageOverflowY, "auto", `${name} messages must retain their own scroll region`);
  await page.evaluate(() => document.querySelector('[aria-label="Finance Agent Chat"] input[placeholder^="Type your question"]')?.scrollIntoView({ block: "end", behavior: "instant" }));
  const reachable = await page.evaluate(() => {
    const input = document.querySelector('[aria-label="Finance Agent Chat"] input[placeholder^="Type your question"]');
    return { bottom: input?.getBoundingClientRect().bottom || 0, viewport: window.innerHeight };
  });
  assert.ok(reachable.bottom <= reachable.viewport, `${name} input must become reachable through document scrolling: ${JSON.stringify({ state, reachable })}`);
}

async function expectRouteBackTarget(page, name, selector) {
  await page.waitForFunction((query) => [...document.querySelectorAll(query)].some((node) => node.getClientRects().length > 0), {}, selector);
  const targets = await page.$$eval(selector, (nodes) => nodes
    .filter((node) => node.getClientRects().length > 0)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
  assert.ok(targets.length > 0 && targets.every((target) => target.width >= 44 && target.height >= 44), `${name} visible route back controls must be at least 44x44: ${JSON.stringify(targets)}`);
}

(async () => {
  const server = startVite({ rootDir, port });
  let browser;

  try {
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    for (const width of [390, 768]) {
      await page.setViewport({ width, height: 844, isMobile: width === 390 });

      await page.goto(`${baseUrl}/#/home`, { waitUntil: "domcontentloaded" });
      await expectDocumentScroll(page, `首頁 (${width}px)`);

      await page.goto(`${baseUrl}/#/work/finance-analyzer`, { waitUntil: "domcontentloaded" });
      await page.click('button[title="Analyzer (Chat Bot)"]');
      await page.waitForSelector('[aria-label="Finance Agent Chat"]');
      await expectChatAccessible(page, `Finance Agent Chat (${width}px)`);
      assert.equal(await page.$eval("input[name='finance-question']", (node) => node.getAttribute("aria-label")), "Finance question");
      assert.equal(await page.$eval("select[name='analysis-strategy']", (node) => node.labels.length > 0), true);
      assert.notEqual(await page.$("[role='log'][aria-label='Finance chat messages']"), null);

      await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-stocks-watcher-root]');
      await expectDocumentScroll(page, `Stocks Intelligence Watcher (${width}px)`);
      const watcherNavigation = await page.evaluate(() => ({
        selectorVisible: Boolean(document.querySelector("select[name='watcher-section']")?.getClientRects().length),
        tabsVisible: Boolean(document.querySelector(".siw-main-tabs")?.getClientRects().length),
        selectorHeight: document.querySelector("select[name='watcher-section']")?.getBoundingClientRect().height || 0,
      }));
      assert.equal(watcherNavigation.selectorVisible, true, `Watcher must use a section selector at ${width}px`);
      assert.equal(watcherNavigation.tabsVisible, false, `Watcher tabs must not overflow at ${width}px`);
      assert.ok(watcherNavigation.selectorHeight >= 44, `Watcher selector must be at least 44px tall at ${width}px`);

      await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".work-grid");
      const actions = await page.$$eval(".work-card .text-link", (nodes) => ({
        anchors: nodes.filter((node) => node instanceof HTMLAnchorElement).length,
        buttons: nodes.filter((node) => node instanceof HTMLButtonElement).length,
      }));
      assert.deepEqual(actions, { anchors: 10, buttons: 1 }, "tool routes must be native links; only the caption modal stays a button");
      await page.click(".work-card button.text-link");
      await page.waitForSelector("input[name='caption-image']");
      const upload = await page.waitForSelector("button[aria-label='Upload image for caption']", { visible: true });
      await upload.focus();
      assert.equal(await page.$eval("button[aria-label='Upload image for caption']", (node) => node === document.activeElement), true, "upload must accept keyboard focus");
      const chooserPromise = page.waitForFileChooser();
      await page.keyboard.press("Enter");
      const chooser = await chooserPromise;
      await chooser.cancel();
      assert.equal(await page.$eval("input[name='caption-image']", (node) => node.getAttribute("aria-label")), "Image for caption");
      await page.click("button[aria-label='Close image caption tool']");

      await page.goto(`${baseUrl}/#/photography`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".gallery-grid img");
      assert.equal(await page.$$eval(".gallery-grid img", (images) => images.every((image) => Number(image.getAttribute("width")) > 0 && Number(image.getAttribute("height")) > 0)), true, "photographs must declare intrinsic dimensions");

      await page.goto(`${baseUrl}/#/work/portfolio-backtest`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("form[name='portfolio-backtest']");
      assert.equal(await page.$$eval("form[name='portfolio-backtest'] input, form[name='portfolio-backtest'] select", (controls) => controls.every((control) => Boolean(control.getAttribute("name")))), true, "backtest fields must expose stable form names");

      const routeBackChecks = [
        ["finance analyzer", "#/work/finance-analyzer", '[title="Back to Market Lab"]'],
        ["fixed income", "#/work/fixed-income", 'a[href="#/market-lab"]'],
        ["market breadth", "#/work/market-breadth", 'a[href="#/market-lab"]'],
        ["sector rotation", "#/work/sector-rotation", ".sr-back"],
        ["settle up", "#/work/settle-up", 'a[href="#/market-lab"]'],
        ["SPX GEX", "#/work/spx-gex-heatmap", 'a[href="#/market-lab"]'],
        ["stocks watcher", "#/work/stocks-intelligence-watcher", '.siw-sidebar-head .siw-back-button'],
        ["portfolio backtest", "#/work/portfolio-backtest", 'a[href="#/market-lab"]'],
      ];
      for (const [name, hash, selector] of routeBackChecks) {
        await page.goto(`${baseUrl}/${hash}`, { waitUntil: "domcontentloaded" });
        await expectRouteBackTarget(page, `${name} (${width}px)`, selector);
      }
    }

    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-stocks-watcher-root]');
    assert.equal(await page.$eval(".siw-main-tabs", (node) => Boolean(node.getClientRects().length)), true, "desktop Watcher must retain tabs");
    assert.equal(await page.$eval("select[name='watcher-section']", (node) => Boolean(node.getClientRects().length)), false, "desktop Watcher must hide the mobile selector");

    await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Tab");
    const focusState = await page.evaluate(() => {
      const active = document.activeElement;
      const style = active ? getComputedStyle(active) : null;
      return { tag: active?.tagName || "", outlineWidth: style?.outlineWidth || "0px" };
    });
    assert.notEqual(focusState.tag, "BODY", "keyboard navigation must move focus to an interactive control");
    assert.notEqual(focusState.outlineWidth, "0px", "keyboard focus must remain visible");

    let treasuryRequests = 0;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/treasury-yield-curve") {
        treasuryRequests++;
        void request.respond({ status: 200, contentType: "application/json", body: "{}" });
      } else void request.continue();
    });
    await page.goto(`${baseUrl}/#/work/fixed-income`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[role='alert']");
    assert.match(await page.$eval("[role='alert']", (node) => node.textContent), /Treasury source unavailable[\s\S]*invalid data/);
    const beforeTreasuryRetry = treasuryRequests;
    const retry = await page.waitForSelector("button::-p-text(Retry source)");
    await retry.click();
    await page.waitForFunction(() => document.querySelector("[role='alert']")?.textContent.includes("invalid data"));
    assert.equal(treasuryRequests, beforeTreasuryRetry + 1, "malformed Treasury data must remain isolated with a working source retry");

    console.log("Mobile scroll UAT passed.");
  } finally {
    if (browser) await browser.close();
    if (server && !server.killed) server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
