const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const puppeteer = require("puppeteer");
const { startVite, waitForServer, stopProcessTree } = require("./helpers/browser-uat.cjs");
const rootDir = path.resolve(__dirname, "..");
const baseUrl = "http://localhost:5192";
const fixture = { v: 2, activeEventId: "dinner", events: [{
  id: "dinner", name: "Dinner", participants: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Carol" }],
  expenses: [{ id: "food", description: "Food", amountCents: 1001, payerId: "a", participantIds: ["a", "b"] }],
}] };
const fixtureUrl = (value) => `${baseUrl}/#/work/settle-up?data=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
const shareBill = async (page) => {
  await page.focus("button[aria-label='Share bill']");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => new URLSearchParams(location.hash.split("?")[1]).has("data"));
  const encoded = await page.evaluate(() => new URLSearchParams(location.hash.split("?")[1]).get("data"));
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
};
const dialog = async (page) => {
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.$eval("dialog button", (node) => node === document.activeElement), true, "Cancel/Close must receive initial focus");
};
const confirm = async (page) => { await page.click("dialog button[data-confirm]"); await page.waitForSelector("dialog:not([open])"); };

(async () => {
  const server = startVite({ rootDir, port: 5192 });
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({ headless: true });
    const screenshots = path.join(rootDir, "uat_screenshots", "settle-up-safety");
    fs.mkdirSync(screenshots, { recursive: true });
    for (const width of [390, 768, 1440]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width, height: 844 });
    await page.goto(fixtureUrl(fixture), { waitUntil: "networkidle0" });
    assert.deepEqual(await shareBill(page), fixture, "Existing v2 sharing must round trip unchanged");
    assert.match(await page.$eval("aside ol", (node) => node.textContent), /Bob pays Alice\s*\$5\.00/, "The original cent allocation must remain unchanged");
    assert.equal(await page.$$eval(".settle-up-page input, .settle-up-page select", (nodes) => nodes.every((node) => node.name && (node.labels.length || node.getAttribute("aria-label")))), true, "Form controls need names and associated labels");
    assert.equal(await page.$$eval(".settle-up-page button", (nodes) => nodes.filter((node) => node.getClientRects().length).every((node) => {
      const rect = node.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
    })), true, "All visible Settle Up action targets must be at least 44x44");
    await page.click("button[aria-label='Remove Alice']");
    assert.notEqual(await page.$("input[aria-label='Rename Alice']"), null,
      "Referenced participants must not be removed or have their expenses reassigned");
    await dialog(page);
    assert.match(await page.$eval("dialog", (node) => node.textContent), /cannot remove[\s\S]*1 expense/i);
    assert.equal(await page.$("dialog button[data-confirm]"), null, "Blocked removal must not offer a destructive action");
    await page.screenshot({ path: path.join(screenshots, `blocked-person-${width}.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await page.$eval("button[aria-label='Remove Alice']", (node) => node === document.activeElement), true);
    assert.deepEqual(await shareBill(page), fixture, "Blocked removal must preserve the exact shared bill");
    await page.click("button[aria-label='Remove Bob']");
    await dialog(page);
    assert.equal(await page.$("dialog button[data-confirm]"), null, "A split participant must be protected even when not the payer");
    await page.keyboard.press("Escape");

    await page.click("button[aria-label='Remove Carol']");
    await dialog(page);
    const bounds = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      const rect = dialog.getBoundingClientRect();
      return { width: rect.width, right: rect.right, left: rect.left, height: rect.height,
        controls: [...dialog.querySelectorAll("button")].map((node) => { const r = node.getBoundingClientRect(); return [r.width, r.height]; }) };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.height <= 844 && bounds.controls.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(bounds));
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    assert.equal(await page.$eval("dialog", (node) => document.activeElement === document.body || node.contains(document.activeElement)), true,
      "Focus may enter browser chrome, but must not reach an interactive background element");
    await page.screenshot({ path: path.join(screenshots, `confirm-person-${width}.png`) });
    await page.keyboard.press("Escape");
    assert.deepEqual(await shareBill(page), fixture, "Cancelling an unreferenced person removal must not mutate the bill");
    await page.click("button[aria-label='Remove Carol']");
    await dialog(page);
    await confirm(page);
    assert.equal(await page.$eval("input[name='new-person']", (node) => node === document.activeElement), true);
    const withoutCarol = structuredClone(fixture);
    withoutCarol.events[0].participants.pop();
    assert.deepEqual(await shareBill(page), withoutCarol);
    assert.match(await page.$eval("aside ol", (node) => node.textContent), /Bob pays Alice\s*\$5\.00/);

    await page.click("button[aria-label='Remove Food']");
    await dialog(page);
    await page.click("dialog button:not([data-confirm])");
    assert.deepEqual(await shareBill(page), withoutCarol);
    await page.click("button[aria-label='Remove Food']");
    await dialog(page);
    await confirm(page);
    assert.equal(await page.$eval("button[aria-label='Add expense']", (node) => node === document.activeElement), true);
    const emptyExpenses = structuredClone(withoutCarol);
    emptyExpenses.events[0].expenses = [];
    assert.deepEqual(await shareBill(page), emptyExpenses);
    for (const name of ["Alice", "Bob"]) {
      await page.click(`button[aria-label='Remove ${name}']`);
      await dialog(page);
      await confirm(page);
    }
    assert.equal((await shareBill(page)).events[0].participants.length, 0, "The last unreferenced person can be removed safely");
    await page.click("button::-p-text(Demo data)");
    await dialog(page);
    await page.keyboard.press("Escape");
    assert.equal((await shareBill(page)).events[0].participants.length, 0, "Cancelling demo replacement must preserve the draft");
    await page.click("button::-p-text(Demo data)");
    await dialog(page);
    await confirm(page);
    assert.equal(await page.$eval("input[name='event-name']", (node) => node === document.activeElement), true);
    const demo = await shareBill(page);
    assert.equal(demo.events[0].name, "Chicago Trip");
    assert.equal(demo.events[0].expenses.length, 10);
    await page.click("button[aria-label='Remove current event']");
    await dialog(page);
    await page.keyboard.press("Escape");
    assert.deepEqual(await shareBill(page), demo);
    await page.click("button[aria-label='Remove current event']");
    await dialog(page);
    await confirm(page);
    assert.equal(await page.$eval("input[name='event-name']", (node) => node === document.activeElement), true, "Removing an event must focus the remaining event editor");
    const blank = await shareBill(page);
    assert.equal(blank.events.length, 1);
    assert.deepEqual(blank.events[0].expenses, []);
    assert.deepEqual(blank.events[0].participants, []);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true, `No document overflow at ${width}px`);
    assert.deepEqual(errors, []);
    await page.close();
    }

    const page = await browser.newPage();
    const multiple = structuredClone(fixture);
    multiple.events.push({ id: "coffee", name: "Coffee", participants: [], expenses: [] });
    await page.goto(fixtureUrl(multiple), { waitUntil: "networkidle0" });
    await page.click("button[aria-label='Remove current event']");
    await dialog(page);
    await confirm(page);
    assert.deepEqual((await shareBill(page)).events, [multiple.events[1]], "Removing an event must preserve other events exactly");
    const legacy = { participants: fixture.events[0].participants, expenses: fixture.events[0].expenses };
    await page.goto(fixtureUrl(legacy), { waitUntil: "networkidle0" });
    assert.deepEqual((await shareBill(page)).events[0].expenses, fixture.events[0].expenses, "Legacy share links must retain exact expense values");
    const lastReferenced = structuredClone(fixture);
    lastReferenced.events[0].participants = [fixture.events[0].participants[0]];
    lastReferenced.events[0].expenses[0].participantIds = ["a"];
    await page.goto(fixtureUrl(lastReferenced), { waitUntil: "networkidle0" });
    await page.click("button[aria-label='Remove Alice']");
    await dialog(page);
    assert.equal(await page.$("dialog button[data-confirm]"), null, "The last referenced person must not clear all expenses");
    await page.keyboard.press("Escape");
    assert.deepEqual(await shareBill(page), lastReferenced);
    console.log("Settle Up safety UAT passed: protected references, all confirmation/cancellation paths, exact cents and v1/v2 sharing at 390/768/1440px.");
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
})().catch((error) => { console.error(error); process.exit(1); });
