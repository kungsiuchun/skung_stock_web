const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");
const { startVite, waitForServer, stopProcessTree } = require("./helpers/browser-uat.cjs");

const rootDir = path.resolve(__dirname, "..");
const port = 5189;
const baseUrl = `http://127.0.0.1:${port}`;
const screenshots = path.join(rootDir, "uat_screenshots", "portfolio-shell");
const captionModule = (request) => new URL(request.url()).pathname === "/src/components/ai-caption-tool.tsx";

(async () => {
  const server = startVite({ rootDir, port, host: "127.0.0.1" });
  let browser;
  try {
    await waitForServer(baseUrl);
    fs.mkdirSync(screenshots, { recursive: true });
    browser = await puppeteer.launch({ headless: true });
    for (const width of [390, 768, 1440]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewport({ width, height: 900 });
      await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "networkidle0" });
      await page.focus(".skip-link");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest(".work-grid, .filter-bar"))), true,
        `Skip to content must bypass the navbar at ${width}px`);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth), "0px",
        "Skipped-to content controls must retain visible keyboard focus");
      await page.screenshot({ path: path.join(screenshots, `content-focus-${width}.png`) });

      await page.evaluate(() => { window.location.hash = "#/contact"; });
      await page.waitForSelector(".contact-actions");
      await page.waitForFunction(() => document.title === "Contact — Siu");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains("contact-action")), true,
        "Route changes must start keyboard navigation inside page content");
      assert.deepEqual(errors, [], "Ordinary navigation must not throw browser errors");
      await page.close();
    }

    // Hold the lazy module to exercise feedback, cancellation, and navigation while loading.
    for (const action of ["cancel", "navigate"]) {
      const page = await browser.newPage();
      let heldRequest;
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (captionModule(request)) heldRequest = request;
        else void request.continue();
      });
      await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "networkidle0" });
      await page.click(".work-card button.text-link");
      await page.waitForSelector("[role='status'] button[aria-label='Cancel opening Image Caption']");
      assert.ok(heldRequest, "Caption module must actually be held pending");
      assert.equal(await page.$eval("button[aria-label='Cancel opening Image Caption']", (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 44 && rect.height >= 44 && rect.top >= 88 && rect.bottom <= innerHeight
          && Boolean(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("[role='status']"));
      }), true, "Pending feedback and cancellation must be visible, not below the gallery or obscured");
      if (action === "cancel") {
        await page.click("button[aria-label='Cancel opening Image Caption']");
        assert.equal(await page.$eval(".work-card button.text-link", (node) => node === document.activeElement), true);
      } else {
        await page.evaluate(() => { window.location.hash = "#/contact"; });
        await page.waitForSelector(".contact-actions");
      }
      const loaded = page.waitForResponse((response) => captionModule(response.request()));
      await heldRequest.continue();
      await loaded;
      await page.waitForNetworkIdle();
      assert.equal(await page.$("dialog[open]"), null, "Late module completion must not reopen a cancelled tool");
      assert.notEqual(await page.$("main"), null, "The portfolio must remain mounted");
      await page.close();
    }

    // A failed lazy import must be isolated, actionable, and keyboard dismissible.
    for (const [width, failure] of [[390, "import"], [1440, "import"], [390, "render"], [1440, "render"]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      let captionCalls = 0;
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (captionModule(request)) {
          if (failure === "import") void request.abort("failed");
          else void request.respond({ status: 200, contentType: "application/javascript", body: 'export default function BrokenCaption() { throw new Error("Fixture render failure"); }' });
        }
        else if (new URL(request.url()).pathname === "/api/caption") {
          captionCalls++;
          void request.abort("failed");
        } else void request.continue();
      });
      await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "networkidle0" });
      await page.click(".work-card button.text-link");
      await page.waitForSelector("button[aria-label='Close Image Caption error']", { visible: true });
      assert.match(await page.$eval("[role='alert']", (node) => node.textContent), /Image Caption could not open/);
      assert.equal(await page.$eval("button[aria-label='Close Image Caption error']", (node) => node === document.activeElement), true,
        "Failed lazy imports must move focus to the recovery action");
      assert.equal(await page.$$eval(".work-grid a", (nodes) => nodes.length), 10, "A failed tool must preserve the gallery");
      const target = await page.$eval("button[aria-label='Close Image Caption error']", (node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
      });
      assert.ok(target.width >= 44 && target.height >= 44 && target.top >= 88 && target.bottom <= 900,
        `Recovery must be reachable and clear of the navbar: ${JSON.stringify(target)}`);
      await page.screenshot({ path: path.join(screenshots, `caption-${failure}-error-${width}.png`) });
      await page.keyboard.press("Enter");
      assert.equal(await page.$("[role='alert']"), null);
      assert.equal(await page.$eval(".work-card button.text-link", (node) => node === document.activeElement), true,
        "Dismissing the error must restore focus to the opener");
      assert.equal(captionCalls, 0, "Opening or failing a tool must not call the caption API");
      await page.close();
    }
    const page = await browser.newPage();
    let blockPhoto = true;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (blockPhoto && new URL(request.url()).pathname === "/src/components/photography-page.tsx") void request.abort("failed");
      else void request.continue();
    });
    await page.goto(`${baseUrl}/#/photography`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[role='alert']");
    const returnLink = await page.$("[role='alert'] a[href='#/market-lab']");
    await returnLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector(".work-grid");
    await page.evaluate(() => { window.location.hash = "#/photography"; });
    await page.waitForSelector("[role='alert']");
    blockPhoto = false;
    const navigation = page.waitForNavigation({ waitUntil: "networkidle0" });
    await page.click("[role='alert'] button");
    await navigation;
    await page.waitForSelector(".gallery-grid img");
    assert.equal(await page.$("[role='alert']"), null, "Reload must retry a failed lazy import with a fresh document");
    await page.close();
    console.log("Portfolio shell UAT passed: content focus, lazy-tool cancellation, isolated import/render failures, and route recovery.");
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => { console.error(error); process.exit(1); });
