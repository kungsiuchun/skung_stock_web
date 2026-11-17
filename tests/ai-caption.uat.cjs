const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer");
const { startVite, waitForServer, stopProcessTree } = require("./helpers/browser-uat.cjs");

const rootDir = path.resolve(__dirname, "..");
const baseUrl = "http://localhost:5177";
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "caption-uat-"));
const imagePath = path.join(fixtureDir, "pixel.png");
fs.writeFileSync(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64"));
fs.writeFileSync(path.join(fixtureDir, "too-large.png"), Buffer.alloc(5 * 1024 * 1024 + 1));
fs.writeFileSync(path.join(fixtureDir, "empty.jpg"), "");
fs.writeFileSync(path.join(fixtureDir, "not-image.txt"), "not an image");
fs.writeFileSync(path.join(fixtureDir, "corrupt.png"), "not a PNG");

(async () => {
  const server = startVite({ rootDir, port: 5177 });
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const screenshots = path.join(rootDir, "uat_screenshots", "caption");
    fs.mkdirSync(screenshots, { recursive: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      window.__captionRequests = [];
      window.__captionAccess = "owner";
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (String(url) !== "/api/caption") return nativeFetch(url, options);
        if (!options?.method || options.method === "GET") {
          if (window.__captionAccess === "visitor") return Promise.resolve(Response.json({ error: "Sign in as the site owner to generate captions." }, { status: 401 }));
          if (window.__captionAccess === "unavailable") return Promise.resolve(Response.json({ error: "Caption generation is unavailable because its AI service is not configured." }, { status: 503 }));
          return Promise.resolve(Response.json({ available: true }));
        }
        // Deliberately ignore abort to prove late responses cannot change a new image.
        return new Promise((resolve) => window.__captionRequests.push({ resolve, signal: options.signal }));
      };
      window.__previewUrls = new Set();
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { const url = create(blob); window.__previewUrls.add(url); return url; };
      URL.revokeObjectURL = (url) => { window.__previewUrls.delete(url); revoke(url); };
    });
    for (const width of [375, 1440]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".work-card button.text-link");
      for (const access of ["visitor", "unavailable"]) {
        await page.evaluate(value => { window.__captionAccess = value; }, access);
        await page.focus(".work-card button.text-link");
        await page.keyboard.press("Enter");
        await page.waitForFunction(mode => mode === "visitor" ? Boolean(document.querySelector("dialog[open] a")) : document.querySelector("dialog[open]")?.textContent.includes("AI service is not configured"), {}, access);
        assert.equal(await page.$("button[aria-label='Upload image for caption']"), null, "visitors and missing bindings cannot select images for generation");
        if (access === "visitor") assert.equal(await page.$eval("dialog a", node => new URL(node.href).pathname), "/api/stocks-intelligence-watcher/auth/login");
        assert.equal(await page.evaluate(() => window.__captionRequests.length), 0);
        await page.waitForFunction(() => getComputedStyle(document.querySelector("dialog > div")).opacity === "1");
        await page.screenshot({ path: path.join(screenshots, `caption-${access}-${width}.png`) });
        await page.keyboard.press("Escape");
      }
    }
    for (const width of [375, 768, 1440]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${baseUrl}/#/market-lab`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".work-card button.text-link");
      await page.evaluate(() => { window.__captionAccess = "owner"; });
      await page.click(".work-card button.text-link");
      await page.waitForSelector("dialog[open][aria-labelledby='caption-tool-title']");
      await page.waitForSelector("button[aria-label='Upload image for caption']");
      assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true);
      for (let tab = 0; tab < 6; tab++) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => ({ modal: document.querySelector("dialog").matches(":modal"), inDialog: document.querySelector("dialog").contains(document.activeElement), onBody: document.activeElement === document.body }));
        // Chromium may place focus on the document between native modal Tab cycles.
        assert.ok(focus.modal && (focus.inDialog || focus.onBody), `Tab must not reach background page controls: ${JSON.stringify(focus)}`);
      }
      const bounds = await page.$eval("dialog", (node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height, `modal must fit ${width}px: ${JSON.stringify(bounds)}`);
      await page.waitForFunction(() => getComputedStyle(document.querySelector("dialog > div")).opacity === "1");
      await page.screenshot({ path: path.join(screenshots, `caption-dialog-${width}.png`) });
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog[open]", { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement?.matches(".work-card button.text-link")), true, "Escape must return focus to the opener");
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden", "closing must restore page scrolling");
    }
    await page.click(".work-card button.text-link");
    await page.waitForSelector("dialog[open]");
    await page.waitForSelector("button[aria-label='Upload image for caption']");
    const input = await page.$("input[name='caption-image']");
    for (const [name, message] of [["not-image.txt", /PNG or JPG/], ["too-large.png", /no larger than 5 MB/], ["empty.jpg", /non-empty/], ["corrupt.png", /could not be opened/]]) {
      await input.uploadFile(path.join(fixtureDir, name));
      await page.waitForSelector("dialog [role='alert']");
      assert.match(await page.$eval("dialog [role='alert']", (node) => node.textContent), message);
      assert.equal(await page.evaluate(() => window.__captionRequests.length), 0, "invalid files must not call the API");
    }
    const selectImage = async () => {
      await input.uploadFile(imagePath);
      await page.waitForFunction(() => document.querySelector("img[alt='Upload preview']")?.naturalWidth > 0);
    };
    const generate = () => page.click("button::-p-text(GENERATE CAPTION)");
    await selectImage();
    await generate();
    await page.waitForFunction(() => window.__captionRequests.length === 1);
    await page.$eval("button[aria-label='Remove uploaded image']", (node) => node.click());
    assert.equal(await page.evaluate(() => window.__captionRequests[0].signal.aborted), true);
    await selectImage();
    await generate();
    await page.waitForFunction(() => window.__captionRequests.length === 2);
    await page.evaluate(() => window.__captionRequests[0].resolve(Response.json({ result: { description: "OLD CAPTION" } })));
    await page.waitForFunction(() => document.querySelector("button") && document.querySelector("dialog").textContent.includes("ANALYZING IMAGE"));
    assert.equal(await page.$eval("dialog", (node) => node.textContent.includes("OLD CAPTION")), false);
    await page.evaluate(() => window.__captionRequests[1].resolve(Response.json({ error: "Try the service again." }, { status: 503 })));
    await page.waitForSelector("dialog [role='alert']");
    assert.match(await page.$eval("dialog [role='alert']", (node) => node.textContent), /Try the service again/);
    assert.equal(await page.$("button::-p-text(GENERATE CAPTION)") !== null, true, "service errors must keep the retry action");
    for (const malformed of [null, { result: { description: 123 } }]) {
      const index = await page.evaluate(() => window.__captionRequests.length);
      await generate();
      await page.waitForFunction((count) => window.__captionRequests.length === count, {}, index + 1);
      await page.evaluate(({ index, malformed }) => window.__captionRequests[index].resolve(Response.json(malformed)), { index, malformed });
      await page.waitForFunction(() => document.querySelector("dialog [role='alert']")?.textContent.includes("no caption") && [...document.querySelectorAll("dialog button")].some((node) => node.textContent.includes("GENERATE CAPTION") && !node.disabled));
    }
    const finalIndex = await page.evaluate(() => window.__captionRequests.length);
    await generate();
    await page.waitForFunction((count) => window.__captionRequests.length === count, {}, finalIndex + 1);
    await page.evaluate((index) => window.__captionRequests[index].resolve(Response.json({ result: "NEW CAPTION" })), finalIndex);
    await page.waitForFunction(() => document.querySelector("dialog").textContent.includes("NEW CAPTION"));
    assert.equal(await page.$("dialog [role='alert']"), null);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("dialog [role='status'] > div")).opacity === "1");
    await page.screenshot({ path: path.join(screenshots, "desktop-caption.png") });
    await page.click("button[aria-label='Remove uploaded image']");
    await selectImage();
    const expiredIndex = await page.evaluate(() => window.__captionRequests.length);
    await generate();
    await page.waitForFunction(count => window.__captionRequests.length === count, {}, expiredIndex + 1);
    await page.evaluate(index => window.__captionRequests[index].resolve(Response.json({ error: "Owner session expired. Sign in again." }, { status: 401 })), expiredIndex);
    await page.waitForSelector("dialog a[href='/api/stocks-intelligence-watcher/auth/login']");
    assert.equal(await page.$("button::-p-text(GENERATE CAPTION)"), null, "expired owners cannot continue generating");
    assert.match(await page.$eval("dialog [role='alert']", node => node.textContent), /session expired/);
    await page.click("button[aria-label='Close image caption tool']");
    await page.waitForSelector("dialog[open]", { hidden: true });
    assert.equal(await page.evaluate(() => window.__previewUrls.size), 0, "closing must release image preview URLs");
    await page.click(".work-card button.text-link");
    await page.waitForSelector("dialog[open]");
    await (await page.$("input[name='caption-image']")).uploadFile(imagePath);
    await page.waitForFunction(() => document.querySelector("img[alt='Upload preview']")?.naturalWidth > 0);
    const closingIndex = await page.evaluate(() => window.__captionRequests.length);
    await generate();
    await page.waitForFunction((count) => window.__captionRequests.length === count, {}, closingIndex + 1);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { hidden: true });
    assert.equal(await page.evaluate((index) => window.__captionRequests[index].signal.aborted, closingIndex), true, "closing must abort the pending frontend request");
    await page.evaluate((index) => window.__captionRequests[index].resolve(Response.json({ result: { description: "CLOSED CAPTION" } })), closingIndex);
    await page.click(".work-card button.text-link");
    await page.waitForSelector("dialog[open]");
    assert.equal(await page.$eval("dialog", (node) => node.textContent.includes("CLOSED CAPTION")), false);
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    console.log("Caption UAT passed: modal keyboard/focus, file guards, stale responses, retry and preview cleanup.");
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
    assert.equal(path.dirname(path.resolve(fixtureDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixtureDir).startsWith("caption-uat-"));
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
