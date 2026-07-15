const assert = require("node:assert/strict");
const puppeteer = require("puppeteer");

const APP_URL = "http://localhost:5173";
const API_URL = "http://127.0.0.1:8788/api/spx-gex-heatmap";

const formatMinute = (minute) => {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const jsonResponse = (payload) => ({
  status: 200,
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify(payload),
});

(async () => {
  const fixtureResponse = await fetch(API_URL);
  assert.equal(fixtureResponse.status, 200, "local Pages API must be running before this UAT");
  const fixture = await fixtureResponse.json();
  assert.equal(fixture.status, "READY", "local GEX fixture must be READY");
  assert.ok(fixture.heatmap && fixture.selectedSnapshot, "local GEX fixture must contain a board and selected snapshot");

  const firstMinute = fixture.selectedSnapshot.snapshotMinuteEt;
  const secondMinute = firstMinute + 15;
  const firstSession = { ...fixture.selectedSnapshot, snapshotMinuteEt: firstMinute, snapshotTimeEt: formatMinute(firstMinute) };
  const secondSession = { ...fixture.selectedSnapshot, snapshotMinuteEt: secondMinute, snapshotTimeEt: formatMinute(secondMinute) };
  const firstPayload = {
    ...fixture,
    sessions: [firstSession, secondSession],
    selectedSnapshot: firstSession,
    heatmap: { ...fixture.heatmap, session: firstSession },
  };
  const secondPayload = {
    ...fixture,
    sessions: [firstSession, secondSession],
    selectedSnapshot: secondSession,
    heatmap: { ...fixture.heatmap, session: secondSession },
  };

  let secondSnapshotAttempts = 0;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== "/api/spx-gex-heatmap") return request.continue();

    const requestedMinute = Number(url.searchParams.get("snapshot"));
    if (!Number.isFinite(requestedMinute) || requestedMinute === firstMinute) {
      return request.respond(jsonResponse(firstPayload));
    }
    if (requestedMinute === secondMinute) {
      secondSnapshotAttempts += 1;
      if (secondSnapshotAttempts === 1) {
        return request.respond({
          status: 503,
          contentType: "text/html; charset=utf-8",
          body: "<html><body>upstream unavailable</body></html>",
        });
      }
      return request.respond(jsonResponse(secondPayload));
    }
    return request.respond(jsonResponse(firstPayload));
  });

  try {
    await page.goto(`${APP_URL}/#/work/spx-gex-heatmap?date=${fixture.selectedDate}&snapshot=${firstMinute}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForSelector('button[title="Play timeline"]', { timeout: 20_000 });
    await page.click('button[title="Play timeline"]');
    await page.waitForSelector('[data-spx-gex-playback-error="true"]', { timeout: 10_000 });

    const paused = await page.evaluate(() => ({
      boardVisible: document.body.innerText.includes("SPX Intraday GEX Board"),
      pausedText: document.querySelector('[data-spx-gex-playback-error="true"]')?.textContent || "",
      activeSnapshot: document.querySelector('button[class*="text-yellow-300"]')?.textContent || "",
    }));
    assert.equal(paused.boardVisible, true, "a failed replay must retain the last verified board");
    assert.match(paused.pausedText, new RegExp(`Timeline paused at ${formatMinute(secondMinute)} ET`));
    assert.equal(paused.activeSnapshot, formatMinute(firstMinute), "failed replay must not advance the selected frame");

    await page.click('[data-spx-gex-playback-error="true"] button');
    await page.waitForFunction((minute) => !document.querySelector('[data-spx-gex-playback-error="true"]')
      && document.querySelector('button[class*="text-yellow-300"]')?.textContent === minute, {}, formatMinute(secondMinute));
    assert.equal(secondSnapshotAttempts, 2, "Retry must request the same failed snapshot once");
    console.log("SPX GEX playback UAT passed: failed frame pauses, preserves the board, and retries deterministically.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
