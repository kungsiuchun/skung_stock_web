const assert = require("node:assert/strict");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

const APP_URL = process.env.SPX_UAT_APP_URL || "http://localhost:5173";
const API_ORIGIN = process.env.SPX_UAT_API_ORIGIN || "http://127.0.0.1:8788";
const API_URL = `${API_ORIGIN}/api/spx-gex-heatmap`;
const PRESSURE_API_URL = `${API_ORIGIN}/api/spx-gex-pressure`;
const SCREENSHOT_DIR = path.resolve(process.cwd(), ".tmp");

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

const triggerVisibleCurrentSessionRefresh = (page) => page.evaluate(() => {
  document.dispatchEvent(new Event("visibilitychange"));
});

const scrollNearestVerticalAncestor = (page, selector) => page.$eval(selector, async (element) => {
  let scroller = element.parentElement;
  while (scroller) {
    const style = getComputedStyle(scroller);
    if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
    scroller = scroller.parentElement;
  }
  const target = scroller || document.scrollingElement;
  if (!target) return false;
  const before = target.scrollTop;
  target.scrollTop = before < target.scrollHeight - target.clientHeight ? before + 2 : Math.max(0, before - 2);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return target.scrollTop !== before;
});

(async () => {
  const fixtureResponse = await fetch(API_URL);
  assert.equal(fixtureResponse.status, 200, "local Pages API must be running before this UAT");
  const fixture = await fixtureResponse.json();
  assert.equal(fixture.status, "READY", "local GEX fixture must be READY");
  assert.ok(fixture.heatmap && fixture.selectedSnapshot, "local GEX fixture must contain a board and selected snapshot");
  const pressureFixtureResponse = await fetch(`${PRESSURE_API_URL}?date=${fixture.selectedDate}`);
  assert.equal(pressureFixtureResponse.status, 200, "local pressure fixture must be available before this UAT");
  const pressureFixture = await pressureFixtureResponse.json();
  assert.equal(pressureFixture.status, "READY", "local pressure fixture must be READY");
  assert.ok(pressureFixture.pressure, "local pressure fixture must contain a pressure matrix");

  const firstMinute = fixture.selectedSnapshot.snapshotMinuteEt;
  const secondMinute = firstMinute + 15;
  const nextTradingDate = new Date(Date.parse(`${fixture.selectedDate}T12:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  const nextTradingDateOffsetMs = Date.parse(`${nextTradingDate}T00:00:00.000Z`) - Date.parse(`${fixture.selectedDate}T00:00:00.000Z`);
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
  const rolloverSessions = [firstSession, secondSession].map((session) => ({
    ...session,
    tradingDate: nextTradingDate,
  }));
  const rolloverHeatmapPayload = {
    ...firstPayload,
    availableDates: [nextTradingDate, ...fixture.availableDates.filter((date) => date !== nextTradingDate)],
    selectedDate: nextTradingDate,
    sessions: rolloverSessions,
    selectedSnapshot: rolloverSessions[0],
    heatmap: { ...firstPayload.heatmap, session: rolloverSessions[0] },
  };
  const rolloverPressurePayload = {
    ...pressureFixture,
    selectedDate: nextTradingDate,
    pressure: {
      ...pressureFixture.pressure,
      tradingDate: nextTradingDate,
      baseline: { ...pressureFixture.pressure.baseline, tradingDate: nextTradingDate },
      timeline: pressureFixture.pressure.timeline.map((frame) => ({ ...frame, tradingDate: nextTradingDate })),
    },
  };
  const oneMinuteCandles = Array.from({ length: 301 }, (_, index) => {
    const close = fixture.heatmap.quote.last + Math.sin(index / 11) * 9 + index * 0.015;
    return {
      time: Date.parse(`${fixture.selectedDate}T13:30:00.000Z`) + index * 60_000,
      date_iso: fixture.selectedDate,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 0,
    };
  });
  const oneMinutePayload = {
    ticker: "SPX",
    timeframe: "1m",
    availableTimeframes: ["1m", "5m", "15m", "4h", "1d"],
    candles: oneMinuteCandles,
    patterns: [],
    zones: [],
    trend: { direction: "SIDEWAYS", strength: 0, labels: [] },
    summary: {
      latestClose: oneMinuteCandles.at(-1).close,
      latestChange: 0,
      latestChangePercent: 0,
      nearestSupport: null,
      nearestResistance: null,
      latestPattern: null,
      patternCounts: {},
    },
    source: {
      provider: "test",
      label: "Injected 1-minute SPX UAT candles",
      symbol: "SPX",
      range: "fixture",
      interval: "1m",
      fetchedAt: new Date().toISOString(),
      note: "Deterministic pressure overlay UAT fixture.",
    },
    warnings: [],
  };
  const closedOneMinuteCandles = Array.from({ length: 391 }, (_, index) => {
    const close = fixture.heatmap.quote.last + Math.sin(index / 11) * 9 + index * 0.015;
    return {
      time: Date.parse(`${fixture.selectedDate}T13:30:00.000Z`) + index * 60_000,
      date_iso: fixture.selectedDate,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 0,
    };
  });
  const closedOneMinutePayload = {
    ...oneMinutePayload,
    candles: closedOneMinuteCandles,
    source: {
      ...oneMinutePayload.source,
      provider: "0dtespx",
      label: "0DTESPX CLOSED SPX index series",
      interval: "1s->1m",
      latestSampleAt: new Date(closedOneMinuteCandles.at(-1).time).toISOString(),
      priceAgeMs: 15 * 60_000,
      status: "READY",
      sessionState: "CLOSED",
      sessionDate: fixture.selectedDate,
      sessionEndAt: new Date(closedOneMinuteCandles.at(-1).time).toISOString(),
      routingReason: "CURRENT_ET_SESSION_CLOSED_HISTORICAL",
      expectedMove: {
        status: "READY",
        value: 25,
        sampleAt: new Date(closedOneMinuteCandles.at(-1).time).toISOString(),
        ageMs: 15 * 60_000,
        lagMs: 0,
        errorCode: null,
      },
    },
  };
  const staleExpectedMovePayload = {
    ...closedOneMinutePayload,
    source: {
      ...closedOneMinutePayload.source,
      label: "0DTESPX LIVE SPX index series",
      latestSampleAt: `${fixture.selectedDate}T20:14:00.000Z`,
      priceAgeMs: 60_000,
      status: "READY",
      sessionState: "LIVE",
      routingReason: "CURRENT_ET_SESSION_LIVE",
      expectedMove: {
        status: "STALE",
        value: 25,
        sampleAt: `${fixture.selectedDate}T19:15:00.000Z`,
        ageMs: 60 * 60_000,
        lagMs: 45 * 60_000,
        errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_LAGGED",
      },
      sharedCache: {
        status: "STALE",
        cachedAt: `${fixture.selectedDate}T20:14:00.000Z`,
        ageMs: 60_000,
        refreshAfterMs: 60_000,
        refreshing: true,
      },
    },
  };
  const liveOneMinuteCandles = Array.from({ length: 406 }, (_, index) => {
    const close = fixture.heatmap.quote.last + Math.sin(index / 11) * 9 + index * 0.015;
    return {
      time: Date.parse(`${fixture.selectedDate}T13:30:00.000Z`) + index * 60_000,
      date_iso: fixture.selectedDate,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 0,
    };
  });
  const liveExpectedMovePayload = {
    ...oneMinutePayload,
    candles: liveOneMinuteCandles,
    source: {
      ...oneMinutePayload.source,
      provider: "0dtespx",
      label: "0DTESPX LIVE SPX index series",
      interval: "1s->1m",
      latestSampleAt: `${fixture.selectedDate}T20:15:00.000Z`,
      priceAgeMs: 0,
      status: "READY",
      sessionState: "LIVE",
      sessionDate: fixture.selectedDate,
      routingReason: "CURRENT_ET_SESSION_LIVE",
      expectedMove: {
        status: "READY",
        value: 25,
        sampleAt: `${fixture.selectedDate}T20:15:00.000Z`,
        ageMs: 0,
        lagMs: 0,
        errorCode: null,
      },
      sharedCache: {
        status: "HIT",
        cachedAt: `${fixture.selectedDate}T20:15:00.000Z`,
        ageMs: 0,
        refreshAfterMs: 60_000,
        refreshing: false,
      },
    },
  };
  const rolloverExpectedMovePayload = {
    ...liveExpectedMovePayload,
    candles: liveExpectedMovePayload.candles.map((candle) => ({
      ...candle,
      time: candle.time + nextTradingDateOffsetMs,
      date_iso: nextTradingDate,
    })),
    source: {
      ...liveExpectedMovePayload.source,
      latestSampleAt: `${nextTradingDate}T20:15:00.000Z`,
      sessionDate: nextTradingDate,
      expectedMove: {
        ...liveExpectedMovePayload.source.expectedMove,
        sampleAt: `${nextTradingDate}T20:15:00.000Z`,
      },
      sharedCache: {
        ...liveExpectedMovePayload.source.sharedCache,
        cachedAt: `${nextTradingDate}T20:15:00.000Z`,
      },
    },
  };
  const missingExpectedMovePayload = {
    ...liveExpectedMovePayload,
    source: {
      ...liveExpectedMovePayload.source,
      expectedMove: {
        status: "UNAVAILABLE",
        value: null,
        sampleAt: null,
        ageMs: null,
        lagMs: null,
        errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE",
      },
      sharedCache: {
        status: "STALE",
        cachedAt: `${fixture.selectedDate}T20:14:00.000Z`,
        ageMs: 60_000,
        refreshAfterMs: 60_000,
        refreshing: true,
      },
    },
  };
  const monitorPatterns = [
    { id: "older-high-confidence", type: "PIN_BAR_BEARISH", name: "Older", label: "Older signal", category: "candle", direction: "bearish", candleIndices: [120], fromIndex: 120, toIndex: 120, price: 7358, confidence: 0.99, description: "Older" },
    { id: "latest-b", type: "DOJI", name: "Latest B", label: "Latest B", category: "candle", direction: "neutral", candleIndices: [280], fromIndex: 280, toIndex: 280, price: 7360, confidence: 0.8, description: "Latest B" },
    { id: "latest-a", type: "INSIDE_BAR", name: "Latest A", label: "Latest A", category: "candle", direction: "neutral", candleIndices: [280], fromIndex: 280, toIndex: 280, price: 7361, confidence: 0.8, description: "Latest A" },
    { id: "middle", type: "ENGULFING_BULLISH", name: "Middle", label: "Middle signal", category: "candle", direction: "bullish", candleIndices: [240], fromIndex: 239, toIndex: 240, price: 7359, confidence: 0.95, description: "Middle" },
  ];
  const fiveMinutePayload = {
    ...oneMinutePayload,
    timeframe: "5m",
    patterns: monitorPatterns,
    summary: { ...oneMinutePayload.summary, latestPattern: monitorPatterns[1], patternCounts: {} },
    source: { ...oneMinutePayload.source, interval: "5m", label: "Injected 5-minute SPX UAT candles" },
  };

  let secondSnapshotAttempts = 0;
  let forceCompassTextFailure = false;
  let compassMode = "live";
  let overlayMode = "live";
  let latestHeatmapPayload = firstPayload;
  let recoveredExpectedMoveRequests = 0;
  let injectedServiceUnavailableResponses = 0;
  const overlayDates = [];
  const overlayQueries = [];
  const initialSpqRequestOrder = [];
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`PAGE_ERROR: ${error.message}`));
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewport({ width: 1466, height: 986 });
  await page.evaluateOnNewDocument((fixedNow) => {
    const RealDate = Date;
    let currentNow = fixedNow;
    globalThis.__setSpxUatNow = (nextNow) => { currentNow = nextNow; };
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length > 0 ? args : [currentNow]));
      }
      static now() { return currentNow; }
    };
  }, Date.parse(`${fixture.selectedDate}T20:15:00.000Z`));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/spx-gex-heatmap") initialSpqRequestOrder.push("heatmap");
    if (url.pathname === "/api/spx-price-action-compass" && url.searchParams.get("view") !== "price-overlay") initialSpqRequestOrder.push("compass");
    if (url.pathname === "/api/spx-gex-pressure") {
      initialSpqRequestOrder.push("pressure");
      if (url.searchParams.get("date") === nextTradingDate) return request.respond(jsonResponse(rolloverPressurePayload));
    }
    if (url.pathname === "/api/spx-price-action-compass" && url.searchParams.get("view") === "price-overlay") initialSpqRequestOrder.push("overlay");
    if (url.pathname === "/api/spx-price-action-compass" && forceCompassTextFailure) {
      injectedServiceUnavailableResponses += 1;
      return request.respond({
        status: 503,
        contentType: "text/html; charset=utf-8",
        body: "<!DOCTYPE html><html><body>upstream unavailable</body></html>",
      });
    }
    if (url.pathname === "/api/spx-price-action-compass" && url.searchParams.get("view") === "price-overlay") {
      overlayDates.push(url.searchParams.get("date"));
      overlayQueries.push(url.search);
      if (overlayMode === "recover-expected-move") {
        recoveredExpectedMoveRequests += 1;
        return request.respond(jsonResponse(recoveredExpectedMoveRequests === 1 ? missingExpectedMovePayload : liveExpectedMovePayload));
      }
      if (overlayMode === "stale-em") return request.respond(jsonResponse(staleExpectedMovePayload));
      if (overlayMode === "closed") return request.respond(jsonResponse(closedOneMinutePayload));
      if (overlayMode === "rollover") return request.respond(jsonResponse(rolloverExpectedMovePayload));
      if (overlayMode === "closed-failure") return request.respond({
        status: 502,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          ...closedOneMinutePayload,
          candles: [],
          source: { ...closedOneMinutePayload.source, status: "UNAVAILABLE" },
          warnings: ["ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE"],
        }),
      });
      return request.respond(jsonResponse(oneMinutePayload));
    }
    if (url.pathname === "/api/spx-price-action-compass" && url.searchParams.get("timeframe") === "1m") {
      return request.respond(jsonResponse(oneMinutePayload));
    }
    if (url.pathname === "/api/spx-price-action-compass") {
      return request.respond(jsonResponse(compassMode === "closed"
        ? { ...fiveMinutePayload, source: { ...closedOneMinutePayload.source, interval: "1s->1m" } }
        : fiveMinutePayload));
    }
    if (url.pathname !== "/api/spx-gex-heatmap") return request.continue();

    if (!url.searchParams.has("snapshot")) return request.respond(jsonResponse(latestHeatmapPayload));
    const requestedMinute = Number(url.searchParams.get("snapshot"));
    if (!Number.isFinite(requestedMinute) || requestedMinute === firstMinute) {
      return request.respond(jsonResponse(firstPayload));
    }
    if (requestedMinute === secondMinute) {
      secondSnapshotAttempts += 1;
      if (secondSnapshotAttempts <= 3) {
        injectedServiceUnavailableResponses += 1;
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
    await page.waitForSelector('[data-spx-gex-pressure-matrix="true"]', { timeout: 20_000 });
    await page.click('[data-pa-signal-density="all"]');
    try {
      await page.waitForSelector('[data-pa-side-pattern="true"]', { timeout: 20_000 });
    } catch (error) {
      const pageText = await page.$eval("body", (node) => node.textContent || "").catch(() => "");
      throw new Error(`Signal Monitor did not render. Console: ${consoleErrors.join(" | ")}. Page: ${pageText.slice(0, 800)}`, { cause: error });
    }
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-spot-line="true"] polyline'));
    assert.deepEqual(initialSpqRequestOrder.slice(0, 4), ["heatmap", "compass", "pressure", "overlay"], "initial SPX Page reads must use the stable request lane order");
    const monitorOrder = await page.$$eval('[data-pa-side-pattern="true"]', (nodes) => nodes.map((node) => ({
      text: node.textContent || "",
      index: Number((node.textContent || "").match(/idx\s+\d+-(\d+)/)?.[1] || -1),
    })));
    assert.deepEqual(monitorOrder.map((row) => row.index), [280, 280, 240, 120], "Signal Monitor must be latest-first");
    assert.match(monitorOrder[0].text, /Latest A/, "signal ties must use the deterministic id tie-break");
    assert.match(await page.$eval('[data-spx-price-action-compass="true"]', (node) => node.textContent || ""), /LATEST FIRST/i);
    assert.equal(await page.$('button[aria-label="Refresh latest SPX and GEX sources"]'), null, "the duplicate Board refresh button must be removed");
    assert.equal(await page.$('button[aria-label="Refresh all SPX sources"]'), null, "the duplicate Compass refresh button must be removed");
    assert.equal(await page.$eval('[data-spx-gex-navigation-mode]', (node) => node.getAttribute("data-spx-gex-navigation-mode")), "pinned", "a legacy earlier-frame URL must remain explicitly pinned");
    assert.match(page.url(), /\?mode=pinned&date=.*&snapshot=/, "a migrated pinned URL must preserve its exact GEX date and frame");
    const snapshotUrlBeforeAutoRefresh = page.url();
    const snapshotLabelBeforeAutoRefresh = await page.$eval('button[class*="text-yellow-300"]', (node) => node.textContent || "");
    forceCompassTextFailure = true;
    await triggerVisibleCurrentSessionRefresh(page);
    await page.waitForFunction(() => document.querySelector('[data-spx-price-action-compass="true"]')?.textContent?.includes("Refresh failed; showing the last verified Price Action Compass."));
    const compassFailure = await page.$eval('[data-spx-price-action-compass="true"]', (element) => element.textContent || "");
    assert.match(compassFailure, /HTTP 503/);
    assert.ok(!compassFailure.includes("Unexpected token"), "Compass must not expose a JSON syntax error for HTML failures");
    assert.ok(await page.$('[data-pa-chart-surface="true"]'), "Compass must retain its last verified chart after refresh failure");
    assert.equal(page.url(), snapshotUrlBeforeAutoRefresh, "current-session source refresh must not rewrite the GEX snapshot URL");
    assert.equal(await page.$eval('button[class*="text-yellow-300"]', (node) => node.textContent || ""), snapshotLabelBeforeAutoRefresh, "current-session source refresh must not move the selected GEX frame");
    forceCompassTextFailure = false;

    const latestHeatmapResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/spx-gex-heatmap" && !url.searchParams.has("snapshot");
    });
    await page.select('select[name="spx-gex-snapshot-date"]', fixture.selectedDate);
    await latestHeatmapResponse;

    await page.evaluate(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__restoreSpxUatFetch = () => { window.fetch = nativeFetch; };
      window.fetch = (input, init) => String(input).startsWith("/api/spx-gex-pressure")
        ? new Promise(() => {})
        : nativeFetch(input, init);
    });
    await triggerVisibleCurrentSessionRefresh(page);
    await page.waitForSelector('[data-spx-gex-pressure-refresh-stale="true"]', { timeout: 20_000 });
    const pressureAfterTimeout = await page.evaluate(() => ({
      busy: document.querySelector('[data-spx-gex-pressure-matrix="true"]')?.getAttribute("aria-busy"),
      matrixVisible: Boolean(document.querySelector('[data-spx-gex-pressure-grid="true"]')),
      warning: document.querySelector('[data-spx-gex-pressure-refresh-stale="true"]')?.textContent || "",
    }));
    assert.equal(pressureAfterTimeout.busy, "false", "a terminal pressure timeout must stop aria-busy");
    assert.equal(pressureAfterTimeout.matrixVisible, true, "a pressure timeout must retain the last verified matrix");
    assert.match(pressureAfterTimeout.warning, /timed out after 8000ms/i);
    await page.evaluate(() => window.__restoreSpxUatFetch?.());
    await page.$eval('[data-pa-chart-surface="true"]', (element) => element.scrollIntoView({ block: "center" }));

    const signalHitTargets = await page.$$eval('[data-pa-pattern-badge="true"]', (badges) => badges.map((badge) => {
      const label = badge.querySelector("text")?.textContent?.trim() || "";
      const labelRect = badge.querySelector("text")?.getBoundingClientRect();
      if (!labelRect || labelRect.width === 0 || labelRect.height === 0) return null;
      const clientX = labelRect.left + labelRect.width / 2;
      const clientY = labelRect.top + labelRect.height / 2;
      const hitBadge = document.elementFromPoint(clientX, clientY)?.closest('[data-pa-pattern-badge="true"]');
      return {
        label,
        hitLabel: hitBadge?.querySelector("text")?.textContent?.trim() || null,
        clientX,
        clientY,
      };
    }).filter(Boolean));
    assert.deepEqual(
      signalHitTargets.filter((target) => target.label !== target.hitLabel),
      [],
      "every visible chart signal label must hit its own signal",
    );
    const latestBTarget = signalHitTargets.find((target) => target.label === "Latest B");
    assert.ok(latestBTarget, "overlapping Latest B signal must render a chart label");
    await page.mouse.click(latestBTarget.clientX, latestBTarget.clientY);
    await page.waitForFunction(() => document.querySelector('[data-pa-selected-signal-card="true"]')?.textContent?.includes("Latest B"));

    await page.$eval('[data-pa-chart-surface="true"]', (element) => element.scrollIntoView({ block: "center" }));
    const pointerTarget = await page.$eval('[data-pa-chart-surface="true"]', (svg) => {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const candleWidth = (viewBox.width - 58) / 110;
      const x = 58 + candleWidth * 50.2;
      const y = viewBox.height * 0.42;
      return {
        clientX: rect.left + x / viewBox.width * rect.width,
        clientY: rect.top + y / viewBox.height * rect.height,
      };
    });
    await page.mouse.move(pointerTarget.clientX, pointerTarget.clientY);
    await page.waitForSelector('[data-pa-crosshair="true"]');
    const crosshairError = await page.$eval('[data-pa-chart-surface="true"]', (svg, target) => {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const lines = svg.querySelectorAll('[data-pa-crosshair="true"] line');
      const renderedX = rect.left + Number(lines[0]?.getAttribute("x1")) / viewBox.width * rect.width;
      const renderedY = rect.top + Number(lines[1]?.getAttribute("y1")) / viewBox.height * rect.height;
      return { x: Math.abs(renderedX - target.clientX), y: Math.abs(renderedY - target.clientY) };
    }, pointerTarget);
    assert.ok(crosshairError.x <= 2, `crosshair x must align with pointer; error=${crosshairError.x}`);
    assert.ok(crosshairError.y <= 2, `crosshair y must align with pointer; error=${crosshairError.y}`);
    await page.click('[data-pa-chart-fullscreen-button="true"]');
    await page.waitForSelector('[data-pa-chart-expanded="true"]');
    const fullscreenPointer = await page.$eval('[data-pa-chart-surface="true"]', (svg) => {
      const rect = svg.getBoundingClientRect();
      return { clientX: rect.left + rect.width * 0.413, clientY: rect.top + rect.height * 0.37 };
    });
    await page.mouse.move(fullscreenPointer.clientX, fullscreenPointer.clientY);
    const fullscreenError = await page.$eval('[data-pa-chart-surface="true"]', (svg, target) => {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const lines = svg.querySelectorAll('[data-pa-crosshair="true"] line');
      return {
        x: Math.abs(rect.left + Number(lines[0]?.getAttribute("x1")) / viewBox.width * rect.width - target.clientX),
        y: Math.abs(rect.top + Number(lines[1]?.getAttribute("y1")) / viewBox.height * rect.height - target.clientY),
      };
    }, fullscreenPointer);
    assert.ok(fullscreenError.x <= 2 && fullscreenError.y <= 2, `fullscreen crosshair must align; error=${JSON.stringify(fullscreenError)}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-pa-chart-expanded="true"]'));
    try {
      await page.waitForSelector('[data-spx-gex-mover-tape="true"]', { timeout: 20_000 });
    } catch (error) {
      const matrixText = await page.$eval('[data-spx-gex-pressure-matrix="true"]', (element) => element.textContent || "");
      throw new Error(`Mover Tape did not render. Matrix text: ${matrixText.slice(0, 500)}. Console: ${consoleErrors.join(" | ")}`, { cause: error });
    }
    await page.waitForSelector('[data-spx-gex-pressure-spot-line="true"] polyline', { timeout: 20_000 });
    const pressureLayout = await page.evaluate(() => {
      const compass = document.querySelector('[data-spx-price-action-compass="true"]');
      const pressure = document.querySelector('[data-spx-gex-pressure-matrix="true"]');
      const board = document.querySelector('[data-spx-gex-heatmap-board="true"]');
      const boardShell = document.querySelector('[data-spx-gex-board-shell="true"]');
      const matrixScroll = document.querySelector('[data-spx-gex-pressure-scroll="true"]');
      const currentGexHeader = document.querySelector('[data-current-gex-column="header"]');
      const moverTape = document.querySelector('[data-spx-gex-mover-tape="true"]');
      const spotLine = document.querySelector('[data-spx-gex-pressure-spot-line="true"]');
      const spotPolyline = spotLine?.querySelector("polyline");
      const pointCount = Number(spotLine?.getAttribute("data-spx-gex-pressure-spot-point-count") || 0);
      return {
        pressureTitle: pressure?.textContent?.includes("Strike Pressure Matrix") || false,
        moverTitle: pressure?.textContent?.includes("Mover Tape") || false,
        oneMinuteSource: pressure?.textContent?.includes("SPX 1M / TEST") || false,
        spotResolution: spotLine?.getAttribute("data-spx-gex-pressure-spot-resolution") || "",
        spotPointCount: pointCount,
        renderedPolylinePoints: (spotPolyline?.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).length,
        majorTickLabels: [...document.querySelectorAll('[data-pressure-axis-major="true"]')].map((node) => node.querySelector('span:not([aria-hidden="true"])')?.textContent?.trim() || ""),
        rotatedTimeLabels: document.querySelectorAll('[data-pressure-axis-major] .-rotate-45').length,
        missingColumns: document.querySelectorAll('[data-pressure-column-status="MISSING"]').length,
        openingBucketBadge: document.querySelector('[data-spx-gex-opening-bucket="true"]')?.textContent?.includes("OPENING BUCKET") || false,
        openingBucketColumns: document.querySelectorAll('[data-pressure-opening-bucket="true"]').length,
        spotGuide: Boolean(document.querySelector('[data-spx-gex-pressure-spot-guide="true"]')),
        spotLiveChip: Boolean(document.querySelector('[data-spx-gex-pressure-live-spot="true"]')),
        spotCallout: Boolean(document.querySelector('[data-spx-gex-pressure-spot-callout="true"]')),
        selectedHeaderCount: document.querySelectorAll('[data-pressure-selected-slot="true"]').length,
        selectedBodyRingCount: [...document.querySelectorAll('[data-pressure-cell="true"]')].filter((cell) => cell.classList.contains("ring-1")).length,
        pulseTargets: [
          '[data-spx-gex-pressure-spot-marker="true"]',
          '[data-spx-gex-pressure-spot-guide="true"]',
          '[data-spx-gex-pressure-spot-endpoint="true"]',
          '[data-spx-gex-pressure-live-spot="true"]',
          '[data-spx-gex-heatmap-spot-badge="true"]',
          '[data-spx-gex-heatmap-spot-row="true"]',
          '[data-spx-gex-heatmap-spot-pill="true"]',
        ].map((selector) => ({ selector, pulses: document.querySelector(selector)?.classList.contains("spx-spot-live-pulse") || document.querySelector(selector)?.classList.contains("spx-spot-live-row") })),
        stickyStrike: getComputedStyle(document.querySelector('[data-spx-gex-pressure-grid="true"] .sticky.left-0') || document.body).position,
        stickyCurrentGex: getComputedStyle(document.querySelector('[data-current-gex-column="body"]') || document.body).position,
        moverUsesOrderedList: Boolean(document.querySelector('[data-spx-gex-mover-tape="true"] ol')),
        desktopMatrixOverflow: Boolean(matrixScroll && matrixScroll.scrollWidth > matrixScroll.clientWidth + 1),
        currentGexWidth: currentGexHeader?.getBoundingClientRect().width || 0,
        tapeBelowMatrix: Boolean(matrixScroll && moverTape && moverTape.getBoundingClientRect().top >= matrixScroll.getBoundingClientRect().bottom - 1),
        unifiedBoardShell: Boolean(boardShell && board && boardShell.contains(board)
          && boardShell.contains(document.querySelector('[data-spx-decision-cockpit="true"]'))
          && boardShell.contains(document.querySelector('[data-spx-gex-playback-controls="true"]'))),
        cellsMeetMinimumSize: [...document.querySelectorAll('[data-pressure-cell="true"]')].every((cell) => {
          const rect = cell.getBoundingClientRect();
          return rect.width >= 34 && rect.height >= 25;
        }),
        betweenCompassAndBoard: Boolean(compass && pressure && board
          && (compass.compareDocumentPosition(pressure) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (pressure.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    assert.equal(pressureLayout.pressureTitle, true, "pressure matrix title must render");
    assert.equal(pressureLayout.moverTitle, true, "Mover Tape must render");
    assert.equal(pressureLayout.oneMinuteSource, true, "pressure matrix must disclose the 1-minute SPX source");
    assert.equal(pressureLayout.spotResolution, "1m", "SPX overlay must use 1-minute candles");
    assert.ok(pressureLayout.spotPointCount >= 250, `SPX overlay must retain a dense 1-minute series; got ${pressureLayout.spotPointCount}`);
    assert.ok(pressureLayout.renderedPolylinePoints >= 250, "SPX overlay polyline must render the dense series");
    assert.deepEqual(pressureLayout.majorTickLabels, ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:00"], "time rail must show only hourly and session-end labels");
    assert.equal(pressureLayout.rotatedTimeLabels, 0, "time labels must not be rotated");
    assert.ok(pressureLayout.missingColumns > 0, "an internal missing GEX column must be visibly represented");
    assert.equal(pressureLayout.openingBucketBadge, true, "09:30 must be identified as the OPENING BUCKET");
    assert.equal(pressureLayout.openingBucketColumns, 1, "the pressure matrix must render exactly one opening bucket column");
    assert.equal(pressureLayout.spotGuide, true, "current SPX guide must render");
    assert.equal(pressureLayout.spotLiveChip, true, "latest SPX price must render outside the chart body");
    assert.equal(pressureLayout.spotCallout, false, "chart body must not contain an SPX price card that obscures the line");
    assert.equal(pressureLayout.selectedHeaderCount, 1, "exactly one pressure time header must identify the selected slot");
    assert.equal(pressureLayout.selectedBodyRingCount, 0, "selected pressure slot must not add a border to every matrix cell");
    assert.deepEqual(pressureLayout.pulseTargets.filter((target) => !target.pulses), [], "every current-spot marker must use the live pulse surface");
    assert.equal(pressureLayout.stickyStrike, "sticky", "strike rail must remain sticky");
    assert.equal(pressureLayout.stickyCurrentGex, "sticky", "Current GEX rail must remain sticky");
    assert.equal(pressureLayout.moverUsesOrderedList, true, "Mover Tape ranks must use an ordered list");
    assert.equal(pressureLayout.desktopMatrixOverflow, false, "1466px desktop matrix must not scroll horizontally");
    assert.ok(pressureLayout.currentGexWidth >= 120, "Current GEX rail must reserve at least 120px");
    assert.equal(pressureLayout.tapeBelowMatrix, true, "Mover Tape must stack below the matrix below 1536px");
    assert.equal(pressureLayout.unifiedBoardShell, true, "Board header, cockpit, playback, and exposure table must share one shell");
    assert.equal(pressureLayout.cellsMeetMinimumSize, true, "pressure cells must remain at least 34 by 25 CSS pixels");
    assert.equal(pressureLayout.betweenCompassAndBoard, true, "pressure matrix must sit between Compass and GEX Board");
    overlayMode = "recover-expected-move";
    const pageUrlBeforeExpectedMoveRecovery = page.url();
    await triggerVisibleCurrentSessionRefresh(page);
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-expected-move-warning="true"]')?.textContent?.includes("Expected Move unavailable"));
    const missingExpectedMove = await page.evaluate(() => ({
      corridorLines: document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length,
      warning: document.querySelector('[data-spx-gex-pressure-expected-move-warning="true"]')?.textContent || "",
    }));
    assert.equal(missingExpectedMove.corridorLines, 0, "an unverified Expected Move must not fabricate a corridor");
    assert.match(missingExpectedMove.warning, /ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE/);
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-expected-move-status="READY"]'));
    const recoveredExpectedMove = await page.evaluate(() => ({
      label: document.querySelector('[data-spx-gex-pressure-expected-move-status="READY"]')?.textContent || "",
      corridorLines: document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length,
    }));
    assert.equal(page.url(), pageUrlBeforeExpectedMoveRecovery, "Expected Move recovery must not require a page reload");
    assert.ok(recoveredExpectedMoveRequests >= 2, "a shared-cache refresh must trigger a bounded overlay-only follow-up read");
    assert.match(recoveredExpectedMove.label, /EM ±25\.00 · 16:15 ET/);
    assert.equal(recoveredExpectedMove.corridorLines, 2, "a recovered Expected Move must render both corridor rails");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const reducedMotionAnimation = await page.$eval('[data-spx-gex-pressure-spot-marker="true"]', (element) => getComputedStyle(element).animationName);
    assert.equal(reducedMotionAnimation, "none", "reduced motion must disable the current-spot pulse");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    overlayMode = "stale-em";
    await triggerVisibleCurrentSessionRefresh(page);
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-expected-move-status="STALE"]'));
    const staleExpectedMove = await page.evaluate(() => ({
      label: document.querySelector('[data-spx-gex-pressure-expected-move-status="STALE"]')?.textContent || "",
      warning: document.querySelector('[data-spx-gex-pressure-expected-move-warning="true"]')?.textContent || "",
      cache: document.querySelector('[data-spx-gex-pressure-shared-cache]')?.textContent || "",
      corridorLines: document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length,
    }));
    assert.match(staleExpectedMove.label, /STALE EM ±25\.00 · 15:15 ET/);
    assert.match(staleExpectedMove.warning, /Using stale 0DTESPX Expected Move sampled 60m ago/);
    assert.match(staleExpectedMove.warning, /context only/);
    assert.match(staleExpectedMove.cache, /CACHE STALE · REFRESHING/);
    assert.equal(staleExpectedMove.corridorLines, 2, "same-day stale EM must keep the visibly stale context corridor");
    assert.equal(overlayQueries.some((query) => new URLSearchParams(query).has("em_retry")), false, "browser must never create em_retry source calls");

    overlayMode = "closed";
    compassMode = "closed";
    await triggerVisibleCurrentSessionRefresh(page);
    try {
      await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent?.includes("0DTESPX CLOSED"));
      await page.waitForFunction(() => document.querySelector('[data-spx-price-action-compass="true"]')?.textContent?.includes("0DTESPX CLOSED"));
    } catch (error) {
      const state = await page.evaluate(() => ({
        source: document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent || "",
        warning: document.querySelector('[data-spx-gex-pressure-spot-warning="true"]')?.textContent || "",
        busy: document.querySelector('[data-spx-gex-pressure-matrix="true"]')?.getAttribute("aria-busy") || "",
      }));
      throw new Error(`CLOSED overlay did not load. Requests: ${overlayDates.join(",")}. State: ${JSON.stringify(state)}. Console: ${consoleErrors.join(" | ")}`, { cause: error });
    }
    const closedOverlay = await page.evaluate(() => ({
      source: document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent || "",
      spotTime: document.querySelector('[data-spx-gex-pressure-spot-status="true"]')?.textContent || "",
      expectedMove: document.querySelector('[data-spx-gex-pressure-expected-move="true"]')?.textContent || "",
      corridorLines: document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length,
      pulseCount: document.querySelectorAll('[data-spx-gex-pressure-matrix="true"] .spx-spot-live-pulse').length,
      state: document.querySelector('[data-spx-gex-pressure-session-state]')?.getAttribute("data-spx-gex-pressure-session-state") || "",
    }));
    assert.match(closedOverlay.source, /SPX 1M \/ 0DTESPX CLOSED/);
    assert.match(closedOverlay.spotTime, /16:00 ET/);
    assert.match(closedOverlay.expectedMove, /EM ±25\.00 · 16:00 ET/);
    assert.equal(closedOverlay.corridorLines, 2, "CLOSED overlay must retain the contract-valid EM corridor");
    assert.equal(closedOverlay.pulseCount, 0, "CLOSED overlay must not render any live pulse surface");
    assert.equal(closedOverlay.state, "CLOSED");
    assert.ok(overlayDates.length > 0 && overlayDates.every((date) => date === fixture.selectedDate), "every price-overlay request must carry the selected date");
    const readyCell = '[data-pressure-cell="true"][data-pressure-column-status="READY"]';
    await page.hover(readyCell);
    await page.waitForSelector('[data-spx-gex-pressure-tooltip="desktop"]');
    const desktopTooltip = await page.$eval('[data-spx-gex-pressure-tooltip="desktop"]', (element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent || "",
        visible: getComputedStyle(element).display !== "none",
        insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      };
    });
    assert.match(desktopTooltip.text, /Collected .* ET/);
    assert.match(desktopTooltip.text, /GEX snapshot SPX/);
    assert.match(desktopTooltip.text, /0DTESPX 1m context/);
    assert.equal(desktopTooltip.visible, true, "desktop hover tooltip must be visible");
    assert.equal(desktopTooltip.insideViewport, true, "desktop tooltip must remain inside the viewport");
    await page.focus(readyCell);
    assert.equal(await page.$eval(readyCell, (element) => element.getAttribute("aria-describedby")), "spx-gex-pressure-cell-tooltip");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-spx-gex-pressure-tooltip="desktop"]'));
    await page.$eval(readyCell, (element) => element.click());
    await page.waitForSelector('[data-spx-gex-pressure-tooltip="desktop"]');
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-tooltip="desktop"]')?.textContent?.includes("Pinned"));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(await scrollNearestVerticalAncestor(page, readyCell), true, "Pressure tooltip scroll-dismiss test requires a real vertical scroll");
    await page.waitForFunction(() => !document.querySelector('[data-spx-gex-pressure-tooltip="desktop"]'));
    await page.$eval('[data-spx-gex-pressure-matrix="true"]', (element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "spx-gex-pressure-professional-desktop.png") });
    assert.deepEqual(consoleErrors.filter((error) => !/503 \(Service Unavailable\)/.test(error)), [], `unexpected pressure matrix console errors: ${consoleErrors.join(" | ")}`);

    await page.setViewport({ width: 1600, height: 1000 });
    await page.waitForFunction(() => {
      const scroll = document.querySelector('[data-spx-gex-pressure-scroll="true"]');
      return Boolean(scroll && scroll.scrollWidth <= scroll.clientWidth + 1);
    });
    const widePressureLayout = await page.evaluate(() => {
      const scroll = document.querySelector('[data-spx-gex-pressure-scroll="true"]');
      const grid = document.querySelector('[data-spx-gex-pressure-grid="true"]');
      const currentGex = document.querySelector('[data-current-gex-column="header"]');
      const tape = document.querySelector('[data-spx-gex-mover-tape="true"]');
      return {
        overflow: Boolean(scroll && scroll.scrollWidth > scroll.clientWidth + 1),
        tapeAtRight: Boolean(scroll && tape && tape.getBoundingClientRect().left >= scroll.getBoundingClientRect().right - 1),
        rightGap: scroll && currentGex ? Math.abs(scroll.getBoundingClientRect().right - currentGex.getBoundingClientRect().right) : Infinity,
        bottomGap: scroll && grid ? Math.abs(scroll.getBoundingClientRect().bottom - grid.getBoundingClientRect().bottom) : Infinity,
        tapeHeightGap: scroll && tape ? Math.abs(scroll.getBoundingClientRect().height - tape.getBoundingClientRect().height) : Infinity,
      };
    });
    assert.equal(widePressureLayout.overflow, false, "1600px desktop matrix must not scroll horizontally");
    assert.equal(widePressureLayout.tapeAtRight, true, "Mover Tape must return to the right rail at 1536px and above");
    assert.ok(widePressureLayout.rightGap <= 1, `matrix content must fill the desktop rail; gap=${widePressureLayout.rightGap}`);
    assert.ok(widePressureLayout.bottomGap <= 1, `matrix content must fill the desktop rail height; gap=${widePressureLayout.bottomGap}`);
    assert.ok(widePressureLayout.tapeHeightGap <= 1, `Mover Tape must align with matrix height; gap=${widePressureLayout.tapeHeightGap}`);

    const boardCell = '[data-gex-audit-trigger="true"]';
    await page.hover(boardCell);
    await page.waitForSelector('[data-gex-audit-tooltip="desktop"]');
    const boardTooltip = await page.$eval('[data-gex-audit-tooltip="desktop"]', (element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent || "",
        insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        surface: element.getAttribute("data-spx-gex-tooltip-surface"),
      };
    });
    assert.equal(boardTooltip.surface, "board");
    assert.equal(boardTooltip.insideViewport, true, "Board tooltip must remain inside the viewport");
    assert.match(boardTooltip.text, /Exposure/);
    assert.match(boardTooltip.text, /Volatility Inputs/);
    assert.match(boardTooltip.text, /Market Inputs/);
    assert.match(boardTooltip.text, /Audit Trail/);
    assert.equal(await page.$eval(boardCell, (element) => element.closest("td")?.hasAttribute("title")), false, "Board must not retain the native title tooltip");
    await page.focus(boardCell);
    assert.equal(await page.$eval(boardCell, (element) => element.getAttribute("aria-describedby")), "spx-gex-board-cell-tooltip");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-gex-audit-tooltip="desktop"]'));
    await page.$eval(boardCell, (element) => element.click());
    await page.waitForSelector('[data-gex-audit-tooltip="desktop"]');
    await page.waitForFunction(() => document.querySelector('[data-gex-audit-tooltip="desktop"]')?.textContent?.includes("Pinned"));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    assert.equal(await scrollNearestVerticalAncestor(page, boardCell), true, "Board tooltip scroll-dismiss test requires a real vertical scroll");
    const boardTooltipAfterScroll = await page.$eval("body", () => document.querySelector('[data-gex-audit-tooltip="desktop"]')?.textContent || null);
    assert.equal(boardTooltipAfterScroll, null, `Board tooltip must dismiss after real scroll; remaining=${boardTooltipAfterScroll}`);

    await page.setViewport({ width: 390, height: 844 });
    await page.$eval(readyCell, (element) => element.click());
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-tooltip="mobile"]')?.textContent?.includes("GEX snapshot SPX"));
    const mobileLayout = await page.evaluate(() => {
      const grid = document.querySelector('[data-spx-gex-pressure-grid="true"]');
      const tape = document.querySelector('[data-spx-gex-mover-tape="true"]');
      const scroll = document.querySelector('[data-spx-gex-pressure-scroll="true"]');
      if (scroll) scroll.scrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const currentGex = document.querySelector('[data-current-gex-column="body"]');
      return {
        tapeBelowGrid: Boolean(grid && tape && tape.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom),
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        horizontalScroll: Boolean(scroll && scroll.scrollWidth > scroll.clientWidth),
        stickyCurrentVisible: Boolean(currentGex && currentGex.getBoundingClientRect().right <= window.innerWidth + 1),
        inlineDetail: document.querySelector('[data-spx-gex-pressure-tooltip="mobile"]')?.textContent || "",
      };
    });
    assert.equal(mobileLayout.tapeBelowGrid, true, "Mover Tape must stack below the matrix on mobile");
    assert.equal(mobileLayout.pageOverflow, false, "matrix horizontal scrolling must not overflow the mobile page");
    assert.equal(mobileLayout.horizontalScroll, true, "matrix must scroll horizontally inside its own rail on mobile");
    assert.equal(mobileLayout.stickyCurrentVisible, true, "Current GEX must remain visible at the right edge while scrolling");
    assert.match(mobileLayout.inlineDetail, /GEX snapshot SPX/, "mobile tap must open the inline detail panel");
    await page.$eval(boardCell, (element) => element.click());
    await page.waitForFunction(() => document.querySelector('[data-gex-audit-tooltip="mobile"]')?.textContent?.includes("Audit Trail"));
    const boardMobileDetail = await page.$eval('[data-gex-audit-tooltip="mobile"]', (element) => element.textContent || "");
    assert.match(boardMobileDetail, /Audit Trail/, "mobile Board tap must open the shared inline audit detail");
    await page.$eval('[data-spx-gex-pressure-matrix="true"]', (element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "spx-gex-pressure-professional-mobile.png") });
    await page.setViewport({ width: 1600, height: 1000 });

    await page.waitForSelector('button[title="Play timeline"]', { timeout: 20_000 });
    const spotOverlayBeforePlayback = await page.$eval('[data-spx-gex-pressure-spot-line="true"] polyline', (element) => element.getAttribute("points") || "");
    const overlayRequestsBeforePlayback = overlayQueries.length;
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
    assert.equal(secondSnapshotAttempts, 4, "one bounded retry must keep the failed playback frame, then the explicit retry may advance it");
    const spotOverlayAfterPlayback = await page.$eval('[data-spx-gex-pressure-spot-line="true"] polyline', (element) => element.getAttribute("points") || "");
    assert.equal(spotOverlayAfterPlayback, spotOverlayBeforePlayback, "GEX playback must not replay or reshape the current SPX context line");
    assert.equal(overlayQueries.length, overlayRequestsBeforePlayback, "GEX playback must not make one SPX overlay request per snapshot frame");
    const spxBrowserStorage = await page.evaluate(async () => ({
      local: Object.keys(localStorage).filter((key) => /spx|gex/i.test(key)),
      session: Object.keys(sessionStorage).filter((key) => /spx|gex/i.test(key)),
      cacheStorage: typeof caches === "undefined" ? [] : (await caches.keys()).filter((key) => /spx|gex/i.test(key)),
    }));
    assert.deepEqual(spxBrowserStorage, { local: [], session: [], cacheStorage: [] }, "SPX playback must not create a second browser-local data cache beside D1/edge cache");
    assert.equal(consoleErrors.length, injectedServiceUnavailableResponses, `only deliberately injected Compass and playback 503 responses may reach console: ${consoleErrors.join(" | ")}`);
    assert.ok(consoleErrors.every((error) => /503 \(Service Unavailable\)/.test(error)));
    await page.evaluate((nextNow) => globalThis.__setSpxUatNow?.(nextNow), Date.parse(`${fixture.selectedDate}T20:16:00.000Z`));
    overlayMode = "closed-failure";
    await triggerVisibleCurrentSessionRefresh(page);
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-spot-warning="true"]')?.textContent?.includes("showing the last verified 1-minute SPX and stale Expected Move context"));
    const retainedClosedOverlay = await page.evaluate(() => ({
      source: document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent || "",
      expectedMove: document.querySelector('[data-spx-gex-pressure-expected-move="true"]')?.textContent || "",
      corridorLines: document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length,
      pointCount: Number(document.querySelector('[data-spx-gex-pressure-spot-line="true"]')?.getAttribute("data-spx-gex-pressure-spot-point-count") || 0),
      warning: document.querySelector('[data-spx-gex-pressure-spot-warning="true"]')?.textContent || "",
      pulseCount: document.querySelectorAll('[data-spx-gex-pressure-matrix="true"] .spx-spot-live-pulse').length,
    }));
    assert.match(retainedClosedOverlay.source, /0DTESPX STALE/);
    assert.match(retainedClosedOverlay.expectedMove, /STALE EM ±25\.00 · 16:00 ET/, "an unavailable refresh must retain the last verified EM with a stale label");
    assert.equal(retainedClosedOverlay.corridorLines, 2, "an unavailable refresh must retain both visibly stale EM corridor lines");
    assert.ok(retainedClosedOverlay.pointCount >= 250, "post-close failure must retain the last verified 1-minute overlay");
    assert.match(retainedClosedOverlay.warning, /ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE/);
    assert.equal(retainedClosedOverlay.pulseCount, 0, "retained CLOSED overlay must remain non-live");
    overlayMode = "closed";
    await triggerVisibleCurrentSessionRefresh(page);
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent?.includes("0DTESPX CLOSED")
      && !document.querySelector('[data-spx-gex-pressure-spot-warning="true"]'));
    assert.match(await page.$eval('[data-spx-gex-pressure-spot-source="true"]', (element) => element.textContent || ""), /0DTESPX CLOSED/, "post-close source must recover on the next automatic visibility revalidation");

    const latestModeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/spx-gex-heatmap" && !url.searchParams.has("date") && !url.searchParams.has("snapshot");
    });
    await page.select('select[name="spx-gex-snapshot-date"]', fixture.selectedDate);
    await latestModeResponse;
    await page.waitForFunction(() => document.querySelector('[data-spx-gex-navigation-mode="latest"]'));
    assert.match(page.url(), /\?mode=latest$/, "follow-latest mode must use a stable URL that does not pin one GEX date or frame");

    latestHeatmapPayload = rolloverHeatmapPayload;
    overlayMode = "rollover";
    await page.evaluate((nextNow) => globalThis.__setSpxUatNow?.(nextNow), Date.parse(`${nextTradingDate}T20:15:00.000Z`));
    const rolloverHeatmapResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/spx-gex-heatmap" && !url.searchParams.has("date") && !url.searchParams.has("snapshot");
    });
    await triggerVisibleCurrentSessionRefresh(page);
    await rolloverHeatmapResponse;
    await page.waitForFunction((date) => document.querySelector('select[name="spx-gex-snapshot-date"]')?.value === date, {}, nextTradingDate);
    try {
      await page.waitForFunction(() => document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length === 2);
    } catch (error) {
      const rolloverDebug = await page.evaluate(() => ({
        source: document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent || null,
        expectedMove: document.querySelector('[data-spx-gex-pressure-expected-move="true"]')?.textContent || null,
        expectedMoveWarning: document.querySelector('[data-spx-gex-pressure-expected-move-warning="true"]')?.textContent || null,
        spotWarning: document.querySelector('[data-spx-gex-pressure-spot-warning="true"]')?.textContent || null,
        pressureState: document.querySelector('[data-spx-gex-pressure-matrix="true"]')?.getAttribute("aria-busy"),
        selectedDate: document.querySelector('select[name="spx-gex-snapshot-date"]')?.value || null,
      }));
      throw new Error(`Rollover EM did not render. DOM=${JSON.stringify(rolloverDebug)} overlays=${JSON.stringify(overlayDates.slice(-5))} queries=${JSON.stringify(overlayQueries.slice(-5))}`, { cause: error });
    }
    const rolloverState = await page.evaluate(() => ({
      navigationMode: document.querySelector('[data-spx-gex-navigation-mode]')?.getAttribute("data-spx-gex-navigation-mode"),
      selectedDate: document.querySelector('select[name="spx-gex-snapshot-date"]')?.value,
      source: document.querySelector('[data-spx-gex-pressure-spot-source="true"]')?.textContent || "",
      expectedMove: document.querySelector('[data-spx-gex-pressure-expected-move="true"]')?.textContent || "",
      corridorLines: document.querySelectorAll('[data-spx-gex-pressure-expected-move-upper="true"], [data-spx-gex-pressure-expected-move-lower="true"]').length,
    }));
    assert.deepEqual(rolloverState, {
      navigationMode: "latest",
      selectedDate: nextTradingDate,
      source: "SPX 1M / 0DTESPX LIVE",
      expectedMove: "EM ±25.00 · 16:15 ET",
      corridorLines: 2,
    }, "follow-latest mode must cross the ET trading date and restore current-session Expected Move without a reload");
    assert.equal(overlayDates.at(-1), nextTradingDate, "the rollover overlay request must follow the new selected GEX date");
    assert.match(page.url(), /\?mode=latest$/, "automatic rollover must not rewrite latest mode into a pinned snapshot URL");
    console.log("SPX GEX pressure + playback UAT passed: matrix renders with aligned spot/tape, and failed replay retries deterministically.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
