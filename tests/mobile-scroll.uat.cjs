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
  assert.equal(before.overflowY, "auto", `${name} must allow document vertical scrolling on mobile`);
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

  assert.equal(state.bodyOverflowY, "auto", `${name} must not be blocked by the document viewport lock`);
  assert.ok(state.chatBottom <= state.viewport, `${name} must not be clipped below the viewport`);
  assert.ok(state.inputBottom <= state.viewport, `${name} input must remain reachable`);
  assert.equal(state.messageOverflowY, "auto", `${name} messages must retain their own scroll region`);
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

      await page.goto(`${baseUrl}/#/work/stocks-intelligence-watcher`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-stocks-watcher-root]');
      await expectDocumentScroll(page, `Stocks Intelligence Watcher (${width}px)`);
    }

    console.log("Mobile scroll UAT passed.");
  } finally {
    if (browser) await browser.close();
    if (server && !server.killed) server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
