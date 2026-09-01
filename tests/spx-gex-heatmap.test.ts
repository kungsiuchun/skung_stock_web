import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSpxGexHeatmapReadingContext,
  buildCanonicalSpxGexSnapshotEnvelope,
  buildSpxGexHeatmapFromOptionChains,
  buildSpxGexHeatmapFromToolText,
  calculateBlackScholesExposures,
  classifySpxGexStructureTags,
  formatSpxGexCompactExposure,
  generateAndStoreSpxGexHeatmap,
  getSpxGexGenerationStatus,
  listSpxGexHeatmapDates,
  listSpxGexHeatmapSessions,
  listSpxGexInvalidSnapshots,
  readSpxGexHeatmap,
  toTelegramGexSummary,
  upsertSpxGexHeatmap,
  type SpxGexDataClient,
  type SpxGexHeatmapModel,
  type SpxGexOptionChain,
  type SpxGexStrikeProfile,
} from "../src/lib/spx-gex-heatmap";
import { deriveNativeOptionExposureLevels } from "../src/lib/stocks-native-yahoo";
import {
  CboeD1Cache,
  CboeSpxGexDataClient,
  FallbackSpxGexDataClient,
  createSpxGexIntradayDataClient,
  parseCboeOptionSymbol,
  parseCboeSpxOptionsPayload,
} from "../src/lib/spx-gex-cboe";
import { loadCanonicalSpxGexForTelegram } from "../scripts/worker-spx-bot";
import { onRequest as getSpxGexHeatmapApi } from "../functions/api/spx-gex-heatmap";
import { onRequest as getSpxGexPressureApi } from "../functions/api/spx-gex-pressure";
import { onRequest as getSpxGexCellDetailApi } from "../functions/api/spx-gex-cell-detail";
import { canonicalSpxCacheRequest, coalesceSpxEdgeRequest, resetSpxEdgeCoalescingForTests } from "../functions/api/_spx-edge-cache";
import { buildSpxGexUatFixture } from "../src/lib/spx-gex-uat-fixture";
import {
  buildSpxGexOneMinuteSpotSegments,
  buildSpxGexPressureAxisTicks,
  buildSpxGexPressureChartGeometry,
  buildSpxGexPressureMatrixFromFrames,
  buildSpxGexPressureMatrix,
  extendSpxGexPressureForSession,
  getLatestSpxGexSpotPoint,
  getSpxGexPressureTooltipPosition,
  toSpxGexPressureFrame,
} from "../src/lib/spx-gex-pressure-matrix";
import { parseSpxGexBoardSelection } from "../src/components/spx-gex-heatmap-page";
import { getSpxGexTooltipPosition } from "../src/lib/spx-gex-tooltip";
import { parseJsonResponse, SafeJsonResponseError } from "../src/lib/safe-json-response";
import { getSpxSpotLivePulseKey } from "../src/lib/spx-spot-live-pulse";
import { resetSpxRequestLaneForTests, runSpxRequest, SpxRequestTimeoutError } from "../src/lib/spx-request-lane";

it("normalizes volatile refresh keys into one SPX edge-cache key", () => {
  const first = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-pressure?date=2026-07-17&_=1"));
  const second = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-pressure?date=2026-07-17&refresh=2"));
  const tracking = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-pressure?utm_source=ad&date=2026-07-17&requestId=abc"));
  assert.equal(first.url, "https://example.com/api/spx-gex-pressure?date=2026-07-17");
  assert.equal(first.url, second.url);
  assert.equal(first.url, tracking.url);
});

it("keeps price-action view and timeframe selections in distinct SPX edge-cache keys", () => {
  const overlay = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-price-action-compass?view=price-overlay"));
  const fourHour = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-price-action-compass?timeframe=4h"));
  const sameOverlay = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-price-action-compass?view=price-overlay&cacheBust=1"));
  assert.notEqual(overlay.url, fourHour.url);
  assert.equal(overlay.url, sameOverlay.url);
});

it("normalizes only effective SPX endpoint selections", () => {
  const heatmap = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-heatmap?view=x"));
  const plainHeatmap = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-heatmap"));
  const invalidOne = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-price-action-compass?timeframe=bad-a"));
  const invalidTwo = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-price-action-compass?timeframe=bad-b"));
  assert.equal(heatmap.url, plainHeatmap.url);
  assert.equal(invalidOne.url, invalidTwo.url);
  const invalidPressure = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-pressure?date=bad-a"));
  const plainPressure = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-pressure"));
  const datedPressure = canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-pressure?date=2026-08-20"));
  assert.equal(invalidPressure.url, plainPressure.url);
  assert.notEqual(datedPressure.url, plainPressure.url);
  assert.equal(
    canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-heatmap?snapshot=bad-a")).url,
    canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-heatmap?snapshot=bad-b")).url,
  );
  assert.equal(
    canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-cell-detail?date=2026-08-20&snapshot=570&strike=6000&expiry=2026-08-28")).url,
    canonicalSpxCacheRequest(new Request("https://example.com/api/spx-gex-cell-detail?date=2026-08-20&snapshot=570.0&strike=6000.0&expiry=2026-08-28")).url,
  );
});

it("rejects Cloudflare text failures without attempting JSON parsing", async () => {
  await assert.rejects(
    () => parseJsonResponse(new Response("error code: 1102", {
      status: 503,
      headers: { "content-type": "text/plain; charset=UTF-8", "cf-ray": "unit-ray" },
    }), "/api/spx-gex-pressure"),
    (error: unknown) => error instanceof SafeJsonResponseError
      && error.message.includes("Cloudflare 1102")
      && error.message.includes("Ray unit-ray"),
  );
});

it("replays the live spot pulse only for a changed candle or canonical snapshot", () => {
  const first = getSpxSpotLivePulseKey({ price: 7488.66, timeEt: "11:42", resolution: "1m" });
  assert.equal(first, getSpxSpotLivePulseKey({ price: 7488.66, timeEt: "11:42", resolution: "1m" }));
  assert.notEqual(first, getSpxSpotLivePulseKey({ price: 7488.66, timeEt: "11:43", resolution: "1m" }));
  assert.notEqual(first, getSpxSpotLivePulseKey({ price: 7489.01, timeEt: "11:42", resolution: "1m" }));
  assert.equal(getSpxSpotLivePulseKey({ price: 7488.66, timeEt: "11:45", resolution: "15m-fallback" }), "15m-fallback:11:45:7488.6600");
  assert.equal(getSpxSpotLivePulseKey({ price: null, timeEt: "11:45", resolution: "1m" }), null);
});

it("serializes SPX requests and retries only transient 503 responses", async () => {
  resetSpxRequestLaneForTests();
  const order: string[] = [];
  let transientAttempts = 0;
  const first = runSpxRequest(async () => {
    order.push("heatmap");
    return new Response("heatmap", { status: 200 });
  });
  const second = runSpxRequest(async () => {
    order.push("compass");
    transientAttempts += 1;
    return new Response("compass", { status: transientAttempts < 2 ? 503 : 200 });
  }, { retryDelaysMs: [0] });
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.deepEqual(order, ["heatmap", "compass", "compass"]);
});

it("drops an obsolete queued SPX request before it reaches the origin", async () => {
  resetSpxRequestLaneForTests();
  let releaseFirst!: () => void;
  let obsoleteOriginCalls = 0;
  const first = runSpxRequest(() => new Promise<Response>((resolve) => {
    releaseFirst = () => resolve(new Response("heatmap", { status: 200 }));
  }));
  const controller = new AbortController();
  const obsolete = runSpxRequest(async () => {
    obsoleteOriginCalls += 1;
    return new Response("obsolete", { status: 200 });
  }, { signal: controller.signal });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  controller.abort();
  releaseFirst();
  await first;
  await assert.rejects(obsolete, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(obsoleteOriginCalls, 0);
});

it("times out a hung SPX request and releases the serial lane", async () => {
  resetSpxRequestLaneForTests();
  let attempts = 0;
  let timedOutAttemptsAborted = 0;
  const hung = runSpxRequest((signal) => new Promise<Response>(() => {
    attempts += 1;
    signal.addEventListener("abort", () => { timedOutAttemptsAborted += 1; }, { once: true });
  }), { retries: 1, retryDelaysMs: [0], attemptTimeoutMs: 10 });
  const next = runSpxRequest(async () => new Response("next", { status: 200 }));

  await assert.rejects(hung, (error: unknown) => error instanceof SpxRequestTimeoutError);
  assert.equal((await next).status, 200);
  assert.equal(attempts, 2);
  assert.equal(timedOutAttemptsAborted, 2);
});

it("does not retry an in-flight SPX request after caller abort", async () => {
  resetSpxRequestLaneForTests();
  const controller = new AbortController();
  let attempts = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const request = runSpxRequest((signal) => new Promise<Response>((_resolve, reject) => {
    attempts += 1;
    markStarted();
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  }), { signal: controller.signal, retries: 1, retryDelaysMs: [0], attemptTimeoutMs: 100 });
  await started;
  controller.abort();

  await assert.rejects(request, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(attempts, 1);
});

it("does not retry a non-transport SPX task failure", async () => {
  resetSpxRequestLaneForTests();
  let attempts = 0;
  await assert.rejects(
    runSpxRequest(async () => {
      attempts += 1;
      throw new Error("programmer failure");
    }, { retries: 1, retryDelaysMs: [0] }),
    /programmer failure/,
  );
  assert.equal(attempts, 1);
});

it("coalesces concurrent cold-cache producers into one response", async () => {
  resetSpxEdgeCoalescingForTests();
  let producers = 0;
  const request = new Request("https://example.com/api/spx-gex-pressure?date=2026-07-17");
  const producer = async () => {
    producers += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ status: "READY" }), { headers: { "Content-Type": "application/json" } });
  };
  const [first, second] = await Promise.all([
    coalesceSpxEdgeRequest(request, producer),
    coalesceSpxEdgeRequest(request, producer),
  ]);
  assert.equal(producers, 1);
  assert.equal(await first.text(), await second.text());
});

it("coalesces equivalent numeric cell selections into one cold-cache producer", async () => {
  resetSpxEdgeCoalescingForTests();
  let producers = 0;
  const producer = async () => {
    producers += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ status: "READY" }));
  };
  await Promise.all([
    coalesceSpxEdgeRequest(new Request("https://example.com/api/spx-gex-cell-detail?date=2026-08-20&snapshot=570&strike=6000&expiry=2026-08-28"), producer),
    coalesceSpxEdgeRequest(new Request("https://example.com/api/spx-gex-cell-detail?date=2026-08-20&snapshot=570.0&strike=6000.0&expiry=2026-08-28"), producer),
  ]);
  assert.equal(producers, 1);
});

it("does not turn a missing snapshot hash parameter into snapshot minute zero", () => {
  assert.deepEqual(parseSpxGexBoardSelection("#/work/spx-gex-heatmap"), {
    date: "",
    snapshot: null,
  });
  assert.deepEqual(parseSpxGexBoardSelection("#/work/spx-gex-heatmap?date=2026-07-13&snapshot=870"), {
    date: "2026-07-13",
    snapshot: 870,
  });
});

it("isolated UAT fixture pins the 2026-07-13 14:30 represented / 14:45 collected canonical board", () => {
  const fixture = buildSpxGexUatFixture();
  const replayed = buildSpxGexUatFixture();

  assert.equal(fixture.session?.tradingDate, "2026-07-13");
  assert.equal(fixture.session?.snapshotTimeEt, "14:30");
  assert.equal(fixture.session?.collectedTimeEt, "14:45");
  assert.equal(fixture.selectedExpiries.length, 5);
  assert.equal(fixture.cells.length, 480);
  assert.match(fixture.canonical?.payloadHash || "", /^fnv1a64:[a-f0-9]{16}$/);
  assert.equal(replayed.canonical?.payloadHash, fixture.canonical?.payloadHash);
});

describe("SPX GEX intraday generation gate", () => {
  it("collects a 15-minute delayed feed from 09:45 through 16:15 ET on a trading day", () => {
    const tooEarly = getSpxGexGenerationStatus(new Date("2026-05-27T13:30:00Z"));
    const open = getSpxGexGenerationStatus(new Date("2026-05-27T13:45:00Z"));
    const mid = getSpxGexGenerationStatus(new Date("2026-05-27T17:30:00Z"));
    const close = getSpxGexGenerationStatus(new Date("2026-05-27T20:15:00Z"));
    const outside = getSpxGexGenerationStatus(new Date("2026-05-27T20:30:00Z"));

    assert.equal(tooEarly.snapshotTimeEt, "09:15");
    assert.equal(tooEarly.isGenerationWindow, false);
    assert.equal(open.etDateKey, "2026-05-27");
    assert.equal(open.snapshotMinuteEt, 9 * 60 + 30);
    assert.equal(open.snapshotTimeEt, "09:30");
    assert.equal(open.collectedMinuteEt, 9 * 60 + 45);
    assert.equal(open.collectedTimeEt, "09:45");
    assert.equal(open.isGenerationWindow, true);
    assert.equal(mid.isGenerationWindow, true);
    assert.equal(mid.snapshotTimeEt, "13:15");
    assert.equal(close.snapshotTimeEt, "16:00");
    assert.equal(close.collectedTimeEt, "16:15");
    assert.equal(close.isGenerationWindow, true);
    assert.equal(outside.isGenerationWindow, false);
  });

  it("blocks generation on a full NYSE market holiday", () => {
    const status = getSpxGexGenerationStatus(new Date("2026-05-25T13:15:00Z"));

    assert.equal(status.etDateKey, "2026-05-25");
    assert.equal(status.isMarketOpenDay, false);
    assert.equal(status.isGenerationWindow, false);
    assert.equal(status.skipReason, "us_market_holiday");
  });

  it("blocks generation on Juneteenth", () => {
    const status = getSpxGexGenerationStatus(new Date("2026-06-19T13:45:00Z"));

    assert.equal(status.etDateKey, "2026-06-19");
    assert.equal(status.snapshotTimeEt, "09:30");
    assert.equal(status.isMarketOpenDay, false);
    assert.equal(status.isGenerationWindow, false);
    assert.equal(status.skipReason, "us_market_holiday");
  });
});

describe("SPX GEX Black-Scholes exposure model", () => {
  it("produces finite GEX, DEX, VEX, and CEX values even at the 0DTE floor", () => {
    const exposure = calculateBlackScholesExposures({
      spot: 6000,
      strike: 6000,
      yearsToExpiry: 0,
      callOpenInterest: 10_000,
      putOpenInterest: 12_000,
      callIv: 0.18,
      putIv: 0.2,
    });

    assert.equal(Number.isFinite(exposure.netGex), true);
    assert.equal(Number.isFinite(exposure.netDex), true);
    assert.equal(Number.isFinite(exposure.netVex), true);
    assert.equal(Number.isFinite(exposure.netCex), true);
    assert.ok(exposure.callGex > 0);
    assert.ok(exposure.putGex < 0);
  });

  it("uses a blended gamma IV so 0DTE side-IV skew does not zero out upside call gamma", () => {
    const exposure = calculateBlackScholesExposures({
      spot: 7475.79,
      strike: 7550,
      yearsToExpiry: 2.75 / (365 * 24),
      callOpenInterest: 5254,
      putOpenInterest: 3497,
      callIv: 0.0846,
      putIv: 0.1485,
      gammaIv: (0.0846 + 0.1485) / 2,
    });

    assert.ok(exposure.callGex > Math.abs(exposure.putGex));
    assert.ok(exposure.netGex > 0);
  });

  it("keeps Yahoo rows with missing open interest as no-data instead of volume-proxy zero", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildMissingOpenInterestChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(cell.netGex, null);
    assert.equal(cell.callEffectiveOpenInterest, null);
    assert.equal(cell.putEffectiveOpenInterest, null);
    assert.equal(cell.callOpenInterestStatus, "missing");
    assert.equal(cell.putOpenInterestStatus, "missing");
    assert.deepEqual(cell.missingReasons, ["missing call open interest", "missing put open interest"]);
    assert.equal(cell.model, undefined);
    assert.equal(heatmap.zeroDte.netGex, null);
    assert.equal(heatmap.zeroDte.pinLevel, null);
  });

  it("treats reported zero open interest as true zero with audited inputs", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroOpenInterestChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(cell.netGex, 0);
    assert.equal(cell.callEffectiveOpenInterest, 0);
    assert.equal(cell.putEffectiveOpenInterest, 0);
    assert.equal(cell.callOpenInterestStatus, "reported");
    assert.equal(cell.putOpenInterestStatus, "reported");
    assert.deepEqual(cell.missingReasons, []);
    assert.equal(cell.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(heatmap.zeroDte.netGex, 0);
    assert.equal(heatmap.zeroDte.pinLevel, null);
    assert.equal(heatmap.zeroDte.topCallWallLevel, null);
    assert.equal(heatmap.zeroDte.topPutWallLevel, null);
    assert.deepEqual(heatmap.strikeProfiles.flatMap((row) => row.tags), []);
  });

  it("repairs reported zero IV from a valid bid/ask mid and marks the cell as repaired", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroIvRepairableChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(typeof cell.netGex, "number");
    assert.equal(Number.isFinite(cell.netGex), true);
    assert.equal(cell.callIvSource, "repaired_from_mid");
    assert.equal(cell.putIvSource, "reported");
    assert.equal(cell.pricingQuality, "repaired");
    assert.equal(cell.callIvStatus, "reported");
    assert.ok(Number(cell.callIv) > 0);
    assert.ok(cell.repairNotes?.some((note) => note.includes("call IV repaired from bid/ask mid")));
    assert.deepEqual(cell.missingReasons, []);
  });

  it("excludes a zero-IV OTM near-zero leg as zero gamma and keeps the priced side", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroIvLowTimeValueChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(typeof cell.netGex, "number");
    assert.equal(Number.isFinite(cell.netGex), true);
    assert.equal(cell.callGex, 0);
    assert.ok(Number(cell.putGex) < 0);
    assert.equal(cell.callIvSource, "excluded_low_time_value");
    assert.equal(cell.putIvSource, "reported");
    assert.equal(cell.pricingQuality, "partial");
    assert.ok(cell.missingReasons?.some((reason) => reason === "excluded call IV"));
  });

  it("keeps zero IV with no safe price repair as unpriced instead of fabricating GEX", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildZeroIvUnpricedChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.ok(cell);
    assert.equal(cell.netGex, null);
    assert.equal(cell.callIvSource, "unpriced");
    assert.equal(cell.putIvSource, "reported");
    assert.equal(cell.pricingQuality, "unpriced");
    assert.ok(cell.missingReasons?.some((reason) => reason === "unpriced call IV"));
    assert.equal(cell.model, undefined);
  });

  it("formats tiny non-zero exposure as a threshold, not a misleading display zero", () => {
    assert.equal(formatSpxGexCompactExposure(0.4), "<1");
    assert.equal(formatSpxGexCompactExposure(0.4, { signed: true }), "+<1");
    assert.equal(formatSpxGexCompactExposure(-0.4, { signed: true }), ">-1");
    assert.equal(formatSpxGexCompactExposure(null), "n/a");
  });

  it("derives native pin, call wall, put wall, and gamma flip independently from finite Yahoo rows", () => {
    const rows = [
      { strike: 7450, callGex: 200_000, putGex: -5_000_000, netGex: -4_800_000 },
      { strike: 7475, callGex: 8_000_000, putGex: -2_000_000, netGex: 6_000_000 },
      { strike: 7500, callGex: 1_000_000, putGex: -900_000, netGex: 100_000 },
      { strike: 7525, callGex: 6_000_000, putGex: -1_000_000, netGex: 5_000_000 },
    ];

    const levels = deriveNativeOptionExposureLevels(rows, 7475);

    assert.equal(levels.pin?.strike, 7475);
    assert.equal(levels.callWall?.strike, 7475);
    assert.equal(levels.putWall?.strike, 7450);
    assert.equal(levels.gammaFlip, 7461.11);
  });
});

describe("SPX GEX Cboe delayed source adapter", () => {
  it("normalizes Cboe OCC-style symbols into expiry, side, and strike", () => {
    assert.deepEqual(parseCboeOptionSymbol("SPX260624C07365000"), {
      root: "SPX",
      expiry: "2026-06-24",
      side: "C",
      strike: 7365,
    });
    assert.deepEqual(parseCboeOptionSymbol("SPX260717P00200000"), {
      root: "SPX",
      expiry: "2026-07-17",
      side: "P",
      strike: 200,
    });
    assert.equal(parseCboeOptionSymbol("BROKEN"), null);
  });

  it("preserves reported zero separately from missing fields when mapping raw Cboe JSON", () => {
    const chains = parseCboeSpxOptionsPayload(buildCboeFixturePayload(), { todayEt: "2026-06-24" });
    const front = chains.find((chain) => chain.selectedExpiry === "2026-06-24");
    const call = front?.calls.find((leg) => leg.strike === 7365);
    const put = front?.puts.find((leg) => leg.strike === 7365);

    assert.ok(front);
    assert.equal(front.source?.label, "Cboe delayed");
    assert.equal(call?.openInterest, 0);
    assert.equal(call?.volume, 0);
    assert.equal(call?.bid, 0);
    assert.equal(call?.impliedVolatility, 12.5);
    assert.equal(put?.openInterest, null);
    assert.equal(put?.volume, null);
    assert.equal(put?.impliedVolatility, 13.1);
  });

  it("selects the current ET front expiry instead of an expired Cboe row", async () => {
    const client = new CboeSpxGexDataClient({
      fetchJson: async () => buildCboeFixturePayload(),
      now: () => new Date("2026-06-24T14:00:00Z"),
    });

    const chain = await client.getOptionsChain();

    assert.equal(chain.selectedExpiry, "2026-06-24");
    assert.deepEqual(chain.expiries.slice(0, 2), ["2026-06-24", "2026-06-25"]);
    assert.equal(chain.spot, 7365.46);
    assert.equal(chain.calls.length, 1);
    assert.equal(chain.puts.length, 1);
  });

  it("accepts Cboe SPXW weekly option roots as SPX contracts", () => {
    const chains = parseCboeSpxOptionsPayload({
      timestamp: "2026-06-24 05:12:52",
      data: {
        symbol: "SPX",
        current_price: 7365.46,
        options: [
          cboeOption("SPXW260624C07365000", { open_interest: 10, volume: 2, iv: 0.12 }),
          cboeOption("SPXW260624P07365000", { open_interest: 11, volume: 3, iv: 0.13 }),
        ],
      },
    }, { todayEt: "2026-06-24" });

    assert.equal(chains[0]?.selectedExpiry, "2026-06-24");
    assert.equal(chains[0]?.calls[0]?.contractSymbol, "SPXW260624C07365000");
    assert.equal(chains[0]?.puts[0]?.contractSymbol, "SPXW260624P07365000");
  });

  it("excludes settled AM SPX and prices the active PM SPXW series on third-Friday 0DTE", () => {
    const chains = parseCboeSpxOptionsPayload({
      timestamp: "2026-07-17 10:45:10",
      data: {
        symbol: "SPX",
        current_price: 7490,
        options: [
          cboeOption("SPX260717C07490000", { bid: 0, ask: 0, iv: 0, open_interest: 682, volume: 0, last_trade_price: 46.9, last_trade_time: "2026-07-16T16:01:36" }),
          cboeOption("SPX260717P07490000", { bid: 0, ask: 0, iv: 0, open_interest: 2182, volume: 0, last_trade_price: 4.85, last_trade_time: "2026-07-16T16:14:05" }),
          cboeOption("SPXW260717C07490000", { bid: 14.4, ask: 14.6, iv: 0.2163, open_interest: 559, volume: 23084, last_trade_price: 14.5, last_trade_time: "2026-07-17T10:48:22" }),
          cboeOption("SPXW260717P07490000", { bid: 16.9, ask: 17.1, iv: 0.2161, open_interest: 2199, volume: 12291, last_trade_price: 16.8, last_trade_time: "2026-07-17T10:48:20" }),
        ],
      },
    }, { todayEt: "2026-07-17" });
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-07-17T14:45:59.000Z",
      chains,
      selectedExpiries: ["2026-07-17"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.equal(cell?.pricingQuality, "priced");
    assert.equal(typeof cell?.netGex, "number");
    assert.deepEqual(cell?.activeSeries, ["SPXW"]);
    assert.deepEqual(cell?.inactiveSeries, ["SPX"]);
    assert.equal(cell?.callOpenInterest, 559);
    assert.equal(cell?.putOpenInterest, 2199);
    assert.ok(cell?.repairNotes?.some((note) => note.includes("AM-settled series inactive")));
    assert.equal(heatmap.zeroDte.netGex === null, false);
  });

  it("fails closed for an active PM 0DTE series with 0/0 quotes and stale last trades", () => {
    const chains = parseCboeSpxOptionsPayload({
      timestamp: "2026-07-17 10:45:10",
      data: {
        symbol: "SPX",
        current_price: 7490,
        options: [
          cboeOption("SPXW260717C07490000", { bid: 0, ask: 0, iv: 0, open_interest: 559, volume: 0, last_trade_price: 0.05, last_trade_time: "2026-07-16T16:01:36" }),
          cboeOption("SPXW260717P07490000", { bid: 0, ask: 0, iv: 0, open_interest: 2199, volume: 0, last_trade_price: 0.05, last_trade_time: "2026-07-16T16:14:05" }),
        ],
      },
    }, { todayEt: "2026-07-17" });
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-07-17T14:45:59.000Z",
      chains,
      selectedExpiries: ["2026-07-17"],
      maxStrikes: 1,
    });
    const cell = heatmap.cells[0];

    assert.equal(cell?.pricingQuality, "unpriced");
    assert.equal(cell?.netGex, null);
    assert.notEqual(cell?.callIvSource, "excluded_low_time_value");
    assert.notEqual(cell?.putIvSource, "excluded_low_time_value");
  });

  it("marks Cboe as the heatmap source label and keeps source-specific timestamp text", async () => {
    const client = new CboeSpxGexDataClient({
      fetchJson: async () => buildDenseCboePayload(),
      now: () => new Date("2026-06-24T14:00:00Z"),
    });
    const front = await client.getOptionsChain();
    const chains = await Promise.all(front.expiries.slice(0, 5).map((expiry) => client.getOptionsChain(expiry)));
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-24T14:00:00.000Z",
      quoteText: await client.getQuotes(),
      chains,
      selectedExpiries: front.expiries.slice(0, 5),
      maxStrikes: 5,
    });

    assert.ok(heatmap.source.note.includes("Cboe delayed"));
    assert.ok(heatmap.source.note.includes("2026-06-24 05:12:52"));
    assert.equal(heatmap.selectedExpiries[0], "2026-06-24");
  });

  it("falls back to Yahoo-compatible data when Cboe selection fails", async () => {
    const fallbackChain = buildOptionChain("2026-06-24", 7365.46);
    const client = new FallbackSpxGexDataClient({
      primary: {
        async getQuotes() { throw new Error("primary quote should not be used after selection failure"); },
        async getOptions() { throw new Error("primary options should not be used after selection failure"); },
        async getOptions0Dte() { throw new Error("primary 0dte should not be used after selection failure"); },
        async getOptionsGex() { throw new Error("primary gex should not be used after selection failure"); },
        async getOptionsChain() { throw new Error("Cboe unavailable"); },
      },
      fallback: {
        async getQuotes() { return "| Ticker | Last | Change | Change % |\n| SPX | $7,365.46 | n/a | n/a |"; },
        async getOptions() { return ""; },
        async getOptions0Dte() { return ""; },
        async getOptionsGex() { return ""; },
        async getOptionsChain() { return { ...fallbackChain, source: { provider: "yahoo", label: "Yahoo delayed fallback" } }; },
      },
    });

    const chain = await client.getOptionsChain();
    const quoteText = await client.getQuotes();

    assert.equal(chain.source?.label, "Yahoo delayed fallback");
    assert.ok(quoteText.includes("SPX"));
  });

  it("does not call Yahoo market context when Cboe delayed source is healthy", async () => {
    const client = new FallbackSpxGexDataClient({
      primary: new CboeSpxGexDataClient({
        fetchJson: async () => buildDenseCboePayload(),
        now: () => new Date("2026-06-24T14:00:00Z"),
      }),
      fallback: {
        async getQuotes() { throw new Error("fallback quote should not be used"); },
        async getOptions() { throw new Error("fallback options should not be used"); },
        async getOptions0Dte() { throw new Error("fallback 0dte should not be used"); },
        async getOptionsGex() { throw new Error("fallback gex should not be used"); },
        async getOptionsChain() { throw new Error("fallback chain should not be used"); },
        async getMarketContext() { throw new Error("Yahoo market context should not be called for healthy Cboe"); },
      },
    });

    const chain = await client.getOptionsChain();
    const context = await client.getMarketContext();

    assert.equal(chain.source?.label, "Cboe delayed");
    assert.deepEqual(context.warnings, [
      "Cboe delayed source selected; Yahoo market context skipped to keep heatmap generation independent of Yahoo crumb/4xx failures.",
    ]);
  });

  it("writes a normalized D1 cache on miss and reuses it for the same 15-minute bucket", async () => {
    const db = new MemoryD1();
    let fetches = 0;
    const now = () => new Date("2026-06-24T14:00:00Z");

    const firstClient = new CboeSpxGexDataClient({
      db,
      fetchJson: async () => {
        fetches += 1;
        return buildDenseCboePayload();
      },
      now,
    });

    const firstChain = await firstClient.getOptionsChain();
    const secondClient = new CboeSpxGexDataClient({
      db,
      fetchJson: async () => {
        fetches += 1;
        throw new Error("cache hit should not refetch Cboe");
      },
      now,
    });
    const secondChain = await secondClient.getOptionsChain();

    assert.equal(fetches, 1);
    assert.equal(db.cboeCache.size, 1);
    assert.equal(firstChain.selectedExpiry, "2026-06-24");
    assert.equal(secondChain.selectedExpiry, "2026-06-24");
    assert.equal(secondChain.source?.label, "Cboe delayed cache");
  });

  it("force_refresh bypasses fresh cache, overwrites the bucket, and reports safe quality counters", async () => {
    const db = new MemoryD1();
    const now = () => new Date("2026-06-24T14:00:00Z");
    await new CboeSpxGexDataClient({
      db,
      fetchJson: async () => buildDenseCboePayload(),
      now,
    }).getOptionsChain();

    let forceFetches = 0;
    const refreshedPayload = buildDenseCboePayload() as any;
    refreshedPayload.data.current_price = 7401.25;
    const forceClient = new CboeSpxGexDataClient({
      db,
      fetchJson: async () => {
        forceFetches += 1;
        return refreshedPayload;
      },
      now,
      cachePolicy: "force_refresh",
      allowStaleCache: false,
    });
    const refreshed = await forceClient.getOptionsChain();
    const cached = await new CboeSpxGexDataClient({
      db,
      fetchJson: async () => { throw new Error("overwritten cache should be reused"); },
      now,
    }).getOptionsChain();

    assert.equal(forceFetches, 1);
    assert.equal(refreshed.spot, 7401.25);
    assert.equal(cached.spot, 7401.25);
    assert.equal(forceClient.getCollectionQualitySummary()?.cacheStatus, "force_refreshed");
    assert.ok((forceClient.getCollectionQualitySummary()?.rawLegCount || 0) > 0);
    assert.equal(
      forceClient.getCollectionQualitySummary()?.parsedLegCount,
      refreshedPayload.data.options.length,
    );
  });

  it("force_refresh fails closed without reading fresh or stale Cboe cache", async () => {
    const db = new MemoryD1();
    const now = () => new Date("2026-06-24T14:00:00Z");
    await new CboeSpxGexDataClient({
      db,
      fetchJson: async () => buildDenseCboePayload(),
      now,
    }).getOptionsChain();

    const forceClient = new CboeSpxGexDataClient({
      db,
      fetchJson: async () => { throw new Error("forced Cboe refresh unavailable"); },
      now,
      cachePolicy: "force_refresh",
      allowStaleCache: false,
    });

    await assert.rejects(() => forceClient.getOptionsChain(), /forced Cboe refresh unavailable/);
  });

  it("ignores expired exact cache rows and refetches Cboe", async () => {
    const db = new MemoryD1();
    const cache = new CboeD1Cache(db, { now: () => new Date("2026-06-24T14:00:00Z") });
    const chains = parseCboeSpxOptionsPayload(buildDenseCboePayload(), { todayEt: "2026-06-24" }).slice(0, 5);
    await cache.write({
      cacheKey: "SPX:CBOE_DELAYED:2026-06-24:600",
      tradingDate: "2026-06-24",
      collectedMinuteEt: 600,
      sourceTimestamp: "2026-06-24 05:12:52",
      spot: 7365.46,
      chains,
      pcrValue: 1.23,
      rawBytes: 1000,
      fetchMs: 10,
      createdAt: "2026-06-24T13:00:00.000Z",
      expiresAt: "2026-06-24T13:59:59.000Z",
    });

    let fetches = 0;
    const client = new CboeSpxGexDataClient({
      db,
      fetchJson: async () => {
        fetches += 1;
        return buildDenseCboePayload();
      },
      now: () => new Date("2026-06-24T14:00:00Z"),
    });

    const chain = await client.getOptionsChain();

    assert.equal(fetches, 1);
    assert.equal(chain.source?.label, "Cboe delayed");
  });

  it("uses today's latest stale D1 cache when live Cboe fetch fails", async () => {
    const db = new MemoryD1();
    const cache = new CboeD1Cache(db, { now: () => new Date("2026-06-24T15:00:00Z") });
    const chains = parseCboeSpxOptionsPayload(buildDenseCboePayload(), { todayEt: "2026-06-24" }).slice(0, 5);
    await cache.write({
      cacheKey: "SPX:CBOE_DELAYED:2026-06-24:600",
      tradingDate: "2026-06-24",
      collectedMinuteEt: 600,
      sourceTimestamp: "2026-06-24 05:12:52",
      spot: 7365.46,
      chains,
      pcrValue: 1.23,
      rawBytes: 1000,
      fetchMs: 10,
      createdAt: "2026-06-24T14:00:00.000Z",
      expiresAt: "2026-06-25T14:00:00.000Z",
    });

    const client = new CboeSpxGexDataClient({
      db,
      fetchJson: async () => {
        throw new Error("Cboe network down");
      },
      now: () => new Date("2026-06-24T15:00:00Z"),
    });

    const chain = await client.getOptionsChain();

    assert.equal(chain.source?.label, "Cboe delayed cache stale");
    assert.equal(chain.source?.timestamp, "2026-06-24 05:12:52");
  });

  it("does not write normalized chains that exceed the D1 row guard", async () => {
    const db = new MemoryD1();
    const chains = parseCboeSpxOptionsPayload(buildDenseCboePayload(), { todayEt: "2026-06-24" }).slice(0, 5);
    const oversized = chains.map((chain) => ({
      ...chain,
      calls: Array.from({ length: 2500 }, (_, index) => ({ ...chain.calls[0], contractSymbol: `SPX_BIG_C_${index}`, strike: 5000 + index })),
      puts: Array.from({ length: 2500 }, (_, index) => ({ ...chain.puts[0], contractSymbol: `SPX_BIG_P_${index}`, strike: 5000 + index })),
    }));
    const cache = new CboeD1Cache(db);

    const written = await cache.write({
      cacheKey: "SPX:CBOE_DELAYED:2026-06-24:600",
      tradingDate: "2026-06-24",
      collectedMinuteEt: 600,
      sourceTimestamp: "2026-06-24 05:12:52",
      spot: 7365.46,
      chains: oversized,
      pcrValue: 1.23,
      rawBytes: 1000,
      fetchMs: 10,
      createdAt: "2026-06-24T14:00:00.000Z",
      expiresAt: "2026-06-25T14:00:00.000Z",
    });

    assert.equal(written, false);
    assert.equal(db.cboeCache.size, 0);
  });

  it("keeps Cboe D1 cache as ingestion cache, not Telegram GEX truth", async () => {
    const db = new MemoryD1();
    const client = createSpxGexIntradayDataClient({
      db,
      fetchJson: async () => buildDenseCboePayload(),
      now: () => new Date("2026-06-24T14:00:00Z"),
    });
    const front = await client.getOptionsChain();
    const chains = await Promise.all(front.expiries.slice(0, 5).map((expiry) => client.getOptionsChain!(expiry)));
    const pcrValue = await client.getOptionsPcr?.();
    const canonicalOnly = await loadCanonicalSpxGexForTelegram(
      { SPX_RECAP_DB: db },
      new Date("2026-06-24T13:30:00Z"),
      { dataClient: { ...client, getOptionsChain: async (expiry?: string) => chains.find((chain) => chain.selectedExpiry === (expiry || front.selectedExpiry)) || front } },
    );

    assert.equal(db.cboeCache.size, 1);
    assert.equal(pcrValue, 0.9);
    assert.equal(canonicalOnly.heatmap, null);
    assert.equal(canonicalOnly.calculatedGex, null);
    assert.equal(canonicalOnly.status, "MISSING");
  });

  it("continues with live Cboe data when the D1 cache table is unavailable", async () => {
    let fetches = 0;
    const client = new CboeSpxGexDataClient({
      db: new ThrowingD1(),
      fetchJson: async () => {
        fetches += 1;
        return buildDenseCboePayload();
      },
      now: () => new Date("2026-06-24T14:00:00Z"),
    });

    const chain = await client.getOptionsChain();

    assert.equal(fetches, 1);
    assert.equal(chain.source?.label, "Cboe delayed");
  });
});

const expiries = ["2026-05-27", "2026-05-28", "2026-05-29", "2026-06-01", "2026-06-02"];
const strikes = [5900, 5950, 6000, 6050, 6100];

const buildOptionChain = (expiry: string, spot = 6000, multiplier = 1): SpxGexOptionChain => ({
  symbol: "SPX",
  spot,
  expiries,
  selectedExpiry: expiry,
  calls: strikes.map((strike, index) => ({
    contractSymbol: `SPX${expiry.replaceAll("-", "")}C${strike}`,
    strike,
    lastPrice: Math.max(1, spot - strike + 25),
    bid: 1,
    ask: 2,
    volume: Math.round((900 + index * 75) * multiplier),
    openInterest: Math.round((index === 3 ? 22_000 : 4_000 + index * 1_500) * multiplier),
    impliedVolatility: 18 + index,
  })),
  puts: strikes.map((strike, index) => ({
    contractSymbol: `SPX${expiry.replaceAll("-", "")}P${strike}`,
    strike,
    lastPrice: Math.max(1, strike - spot + 25),
    bid: 1,
    ask: 2,
    volume: Math.round((800 + index * 60) * multiplier),
    openInterest: Math.round((index === 0 ? 24_000 : 5_000 + index * 1_200) * multiplier),
    impliedVolatility: 20 + index,
  })),
});

const buildSideSkewChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475.79,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7550",
    strike: 7550,
    lastPrice: 1,
    bid: 1,
    ask: 2,
    volume: 53041,
    openInterest: 5254,
    impliedVolatility: 8.46,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7550",
    strike: 7550,
    lastPrice: 1,
    bid: 1,
    ask: 2,
    volume: 2557,
    openInterest: 3497,
    impliedVolatility: 14.85,
  }],
});

const buildMissingOpenInterestChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475.79,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 12,
    bid: 11,
    ask: 12.5,
    volume: 1550,
    impliedVolatility: 12.1,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 10,
    bid: 9,
    ask: 10.5,
    volume: 1440,
    impliedVolatility: 13.4,
  }],
} as SpxGexOptionChain);

const buildZeroOpenInterestChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475.79,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 12,
    bid: 11,
    ask: 12.5,
    volume: 1550,
    openInterest: 0,
    impliedVolatility: 12.1,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 10,
    bid: 9,
    ask: 10.5,
    volume: 1440,
    openInterest: 0,
    impliedVolatility: 13.4,
  }],
});

const buildZeroIvRepairableChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 31,
    bid: 30,
    ask: 32,
    volume: 1550,
    openInterest: 800,
    impliedVolatility: 0,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 28,
    bid: 27,
    ask: 29,
    volume: 1440,
    openInterest: 900,
    impliedVolatility: 12.5,
  }],
});

const buildZeroIvLowTimeValueChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7600",
    strike: 7600,
    lastPrice: 0,
    bid: 0,
    ask: 0.05,
    volume: 120,
    openInterest: 500,
    impliedVolatility: 0,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7600",
    strike: 7600,
    lastPrice: 124,
    bid: 123,
    ask: 125,
    volume: 240,
    openInterest: 700,
    impliedVolatility: 15,
  }],
});

const buildZeroIvUnpricedChain = (): SpxGexOptionChain => ({
  symbol: "SPX",
  spot: 7475,
  expiries: ["2026-06-22"],
  selectedExpiry: "2026-06-22",
  calls: [{
    contractSymbol: "SPX20260622C7475",
    strike: 7475,
    lastPrice: 9,
    bid: 0,
    ask: 80,
    volume: 1550,
    openInterest: 800,
    impliedVolatility: 0,
  }],
  puts: [{
    contractSymbol: "SPX20260622P7475",
    strike: 7475,
    lastPrice: 28,
    bid: 27,
    ask: 29,
    volume: 1440,
    openInterest: 900,
    impliedVolatility: 12.5,
  }],
});

const cboeOption = (
  option: string,
  fields: Record<string, unknown>,
) => ({
  option,
  bid: 1,
  ask: 2,
  iv: 0.12,
  open_interest: 100,
  volume: 10,
  last_trade_price: 1.5,
  ...fields,
});

const buildCboeFixturePayload = () => ({
  timestamp: "2026-06-24 05:12:52",
  data: {
    symbol: "SPX",
    current_price: 7365.46,
    price_change: -12.34,
    price_change_percent: -0.17,
    options: [
      cboeOption("SPX260623C07365000", { open_interest: 10, volume: 2, iv: 0.111 }),
      cboeOption("SPX260624C07365000", { bid: 0, open_interest: 0, volume: 0, iv: 0.125, last_trade_price: 7.1 }),
      cboeOption("SPX260624P07365000", { open_interest: undefined, volume: undefined, iv: 0.131, last_trade_price: 8.2 }),
      cboeOption("SPX260625C07365000", { open_interest: 5, volume: 1, iv: 0.14 }),
      cboeOption("SPX260625P07365000", { open_interest: 6, volume: 1, iv: 0.15 }),
    ],
  },
});

const buildDenseCboePayload = () => {
  const denseExpiries = ["2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29", "2026-06-30"];
  const denseStrikes = [7325, 7350, 7365, 7375, 7400];
  const options = denseExpiries.flatMap((expiry, expiryIndex) => {
    const yymmdd = expiry.slice(2).replaceAll("-", "");
    return denseStrikes.flatMap((strike, strikeIndex) => {
      const encodedStrike = String(strike * 1000).padStart(8, "0");
      return [
        cboeOption(`SPX${yymmdd}C${encodedStrike}`, {
          open_interest: 1000 + expiryIndex * 100 + strikeIndex,
          volume: 100 + strikeIndex,
          iv: 0.12 + strikeIndex / 100,
        }),
        cboeOption(`SPX${yymmdd}P${encodedStrike}`, {
          open_interest: 1200 + expiryIndex * 100 + strikeIndex,
          volume: 90 + strikeIndex,
          iv: 0.14 + strikeIndex / 100,
        }),
      ];
    });
  });
  return {
    timestamp: "2026-06-24 05:12:52",
    data: {
      symbol: "SPX",
      current_price: 7365.46,
      price_change: -12.34,
      price_change_percent: -0.17,
      options,
    },
  };
};

const buildStructuredHeatmap = (generatedAt = "2026-05-27T13:45:00.000Z", spot = 6000) =>
  buildSpxGexHeatmapFromOptionChains({
    generatedAt,
    quoteText: `| Ticker | Last | Change | Change % |\n| SPX | $${spot.toFixed(2)} | +12.50 | +0.21% |`,
    chains: expiries.map((expiry, index) => buildOptionChain(expiry, spot, 1 + index * 0.1)),
    selectedExpiries: expiries,
    maxStrikes: 5,
  });

type StructureFixtureRow = Omit<SpxGexStrikeProfile, "tags" | "dominantExpiry"> & { dominantExpiry?: string | null };

const structureRow = (row: StructureFixtureRow): Omit<SpxGexStrikeProfile, "tags"> => ({
  dominantExpiry: null,
  ...row,
});

const labelsFor = (profiles: SpxGexStrikeProfile[]) =>
  profiles.flatMap((row) => row.tags.map((tag) => tag.label));

const labelAt = (profiles: SpxGexStrikeProfile[], strike: number) =>
  profiles.find((row) => row.strike === strike)?.tags[0]?.label || "";

const gexText = (_expiry: string, rows: string) => `
**Snapshot:** 2026-05-27T09:14:55 **Spot:** $6,000.00
| Metric | Value |
| Net GEX | **1.25B** |
| Strike | Call GEX | Put GEX | Total |
${rows}
`.trim();

const legacyZeroDteText = `
**Snapshot:** 2026-05-27T09:14:55 **Session phase:** \`pre_market\` **Now (ET):** 2026-05-27 09:14
**Expiry:** 2026-05-27
**Pin level:** $6,000 (0.0%)
Flip level: $5,950 (-0.8%)
| Metric | Value |
| Net GEX | **1.50B** |
| Net DEX | **-400.00M** |
| Top call wall | $6,050 |
| Top put wall | $5,900 |
| Charm regime | \`supportive\` |
`.trim();

const buildLegacyHeatmap = (generatedAt = "2026-05-27T13:15:00.000Z") =>
  buildSpxGexHeatmapFromToolText({
    generatedAt,
    quoteText: "| Ticker | Last | Change | Change % |\n| SPX | $6,000.00 | +12.50 | +0.21% |",
    optionsText: "**Available expiries:** 2026-05-27, 2026-05-28, 2026-05-29, 2026-06-01, 2026-06-02",
    zeroDteText: legacyZeroDteText,
    gexByExpiryText: {
      "2026-05-27": gexText("2026-05-27", "| $6,050 | 1 | 2 | **2.00B** |\n| $6,000 | 1 | 2 | **-1.00B** |"),
      "2026-05-28": gexText("2026-05-28", "| $6,050 | 1 | 2 | **1.25B** |\n| $6,000 | 1 | 2 | **500.00M** |"),
      "2026-05-29": gexText("2026-05-29", "| $6,050 | 1 | 2 | **750.00M** |\n| $6,000 | 1 | 2 | **-250.00M** |"),
      "2026-06-01": gexText("2026-06-01", "| $6,050 | 1 | 2 | **300.00M** |\n| $6,000 | 1 | 2 | **100.00M** |"),
      "2026-06-02": gexText("2026-06-02", "| $6,050 | 1 | 2 | **-200.00M** |\n| $6,000 | 1 | 2 | **50.00M** |"),
    },
  });

describe("SPX GEX exposure board model", () => {
  it("classifies professional-style primary structure labels with ranked, testable rules", () => {
    const profiles = classifySpxGexStructureTags([
      structureRow({ strike: 6060, netGex: 1_200_000_000, callGex: 1_450_000_000, putGex: -250_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 8_000, totalVolume: 3_000 }),
      structureRow({ strike: 6050, netGex: 5_000_000_000, callGex: 6_200_000_000, putGex: -1_200_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 50_000, totalVolume: 7_500 }),
      structureRow({ strike: 6040, netGex: 300_000_000, callGex: 440_000_000, putGex: -140_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 3_000, totalVolume: 1_200 }),
      structureRow({ strike: 6020, netGex: 800_000_000, callGex: 930_000_000, putGex: -130_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 12_000, totalVolume: 2_200 }),
      structureRow({ strike: 6000, netGex: 100_000_000, callGex: 300_000_000, putGex: -200_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 60_000, totalVolume: 10_000 }),
      structureRow({ strike: 5960, netGex: -1_400_000_000, callGex: 200_000_000, putGex: -1_600_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 25_000, totalVolume: 3_500 }),
      structureRow({ strike: 5940, netGex: 20_000_000, callGex: 40_000_000, putGex: -20_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 500, totalVolume: 200 }),
    ], 6000, {
      pinLevel: 6000,
      gammaFlip: 5940,
      topCallWallLevel: 6050,
      topPutWallLevel: 5960,
    });

    assert.deepEqual(labelsFor(profiles).sort(), [
      "Air Gap",
      "Big call wall · gamma ceiling",
      "Lower Shelf",
      "Minor resistance",
      "NOW / OI spike / pin zone",
      "Resistance zone",
      "Upper Shelf",
    ].sort());
    assert.equal(labelAt(profiles, 6050), "Big call wall · gamma ceiling");
    assert.equal(labelAt(profiles, 6000), "NOW / OI spike / pin zone");
    assert.equal(profiles.every((row) => row.tags.length <= 1), true);
  });

  it("does not mark every positive NetGEX strike above spot as Resistance zone", () => {
    const productionLikeProfiles = [
      structureRow({ strike: 7610, netGex: 223_501_893, callGex: 932_653_255, putGex: -709_151_361, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 7_879, totalVolume: 2_100 }),
      structureRow({ strike: 7605, netGex: 402_869_636, callGex: 1_441_864_441, putGex: -1_038_994_805, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 13_268, totalVolume: 2_600 }),
      structureRow({ strike: 7600, netGex: 12_787_655_875, callGex: 13_443_621_205, putGex: -655_965_332, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 62_010, totalVolume: 9_000 }),
      structureRow({ strike: 7595, netGex: 2_077_872_173, callGex: 2_256_386_093, putGex: -178_513_920, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 10_759, totalVolume: 3_000 }),
      structureRow({ strike: 7590, netGex: 1_951_620_216, callGex: 2_138_821_231, putGex: -187_201_016, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 8_827, totalVolume: 2_800 }),
      structureRow({ strike: 7585, netGex: 919_156_460, callGex: 1_063_248_485, putGex: -144_092_026, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 3_266, totalVolume: 1_300 }),
      structureRow({ strike: 7580, netGex: 3_201_291_145, callGex: 3_832_132_312, putGex: -630_841_168, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 9_327, totalVolume: 3_200 }),
      structureRow({ strike: 7575, netGex: 5_415_502_982, callGex: 7_144_427_868, putGex: -1_728_924_886, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 20_028, totalVolume: 5_000 }),
      structureRow({ strike: 7570, netGex: 5_990_142_995, callGex: 6_490_895_072, putGex: -500_752_076, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 5_161, totalVolume: 2_400 }),
      structureRow({ strike: 7545, netGex: -301_600_279, callGex: 517_105_335, putGex: -818_705_614, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 5_242, totalVolume: 1_400 }),
      structureRow({ strike: 7535, netGex: 16_831_523, callGex: 1_411_161_037, putGex: -1_394_329_513, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 13_239, totalVolume: 2_900 }),
      structureRow({ strike: 7500, netGex: -3_400_000_000, callGex: 1_200_000_000, putGex: -4_600_000_000, netDex: 0, netVex: 0, netCex: 0, totalOpenInterest: 31_000, totalVolume: 4_500 }),
    ];
    const profiles = classifySpxGexStructureTags(productionLikeProfiles, 7570.12, {
      pinLevel: 7600,
      gammaFlip: 7545.18,
      topCallWallLevel: 7600,
      topPutWallLevel: 7500,
    });

    const resistanceLabels = labelsFor(profiles).filter((label) => label === "Resistance zone");
    const positiveAboveCount = productionLikeProfiles.filter((row) => row.strike > 7570.12 && row.netGex > 0).length;

    assert.equal(positiveAboveCount, 8);
    assert.equal(resistanceLabels.length <= 1, true);
    assert.equal(profiles.every((row) => row.tags.length <= 1), true);
    assert.equal(labelAt(profiles, 7600), "Big call wall · gamma ceiling");
    assert.equal(labelsFor(profiles).includes("Pin Zone"), false);
  });

  it("builds a professional exposure board with matrix cells, structure tags, DEX, VEX, and CEX", () => {
    const heatmap = buildStructuredHeatmap();
    const atTheMoneyCell = heatmap.cells.find((cell) => cell.expdate === expiries[0] && cell.strike === 6000);

    assert.deepEqual(heatmap.selectedExpiries, expiries);
    assert.equal(heatmap.cells.length, expiries.length * strikes.length);
    assert.equal(heatmap.strikeProfiles.length, strikes.length);
    assert.equal(heatmap.zeroDte.charmRegime, "black_scholes_approx");
    assert.equal(typeof heatmap.zeroDte.netVex, "number");
    assert.equal(typeof heatmap.zeroDte.netCex, "number");
    assert.ok(heatmap.strikeProfiles.some((row) => row.tags.some((tag) => tag.type === "big_call_wall")));
    assert.ok(heatmap.strikeProfiles.some((row) => row.tags.some((tag) => tag.type === "lower_shelf")));
    assert.ok(heatmap.strikeProfiles.some((row) => row.tags.some((tag) => tag.type === "now")));
    assert.ok(heatmap.strikeProfiles.every((row) => row.tags.length <= 1));
    assert.ok(heatmap.source.note.includes("Black-Scholes"));
    assert.ok(heatmap.source.note.includes("blended per-strike IV"));
    assert.ok(heatmap.source.note.includes("raw call/put IV retained for audit"));
    assert.ok(atTheMoneyCell);
    assert.equal(atTheMoneyCell.callIv, 0.2);
    assert.equal(atTheMoneyCell.putIv, 0.22);
    assert.equal(atTheMoneyCell.callIvPercent, 20);
    assert.equal(atTheMoneyCell.putIvPercent, 22);
    assert.equal(atTheMoneyCell.gammaIvPercent, 21);
    assert.equal(atTheMoneyCell.gammaIv, 0.21);
    assert.equal(atTheMoneyCell.avgIv, 21);
    assert.equal(atTheMoneyCell.callEffectiveOpenInterest, 7000);
    assert.equal(atTheMoneyCell.putEffectiveOpenInterest, 7400);
    assert.equal(atTheMoneyCell.callOpenInterest, 7000);
    assert.equal(atTheMoneyCell.putOpenInterest, 7400);
    assert.equal(atTheMoneyCell.callVolume, 1050);
    assert.equal(atTheMoneyCell.putVolume, 920);
    assert.equal(atTheMoneyCell.contractMultiplier, 100);
    assert.equal(atTheMoneyCell.riskFreeRate, 0.04);
    assert.equal(atTheMoneyCell.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(atTheMoneyCell.calculationTimestamp, "2026-05-27T13:45:00.000Z");
    assert.equal(Number.isFinite(atTheMoneyCell.yearsToExpiry), true);
    assert.equal(Number.isFinite(atTheMoneyCell.dteHours), true);
    assert.equal(atTheMoneyCell.netGex, Number(atTheMoneyCell.callGex || 0) + Number(atTheMoneyCell.putGex || 0));
  });

  it("derives a deterministic professional heatmap reading context from the canonical model", () => {
    const heatmap = buildStructuredHeatmap();
    const context = buildSpxGexHeatmapReadingContext(heatmap);
    const ruleLabels = context.rules.map((rule) => rule.label);

    assert.match(context.headline, /spot 6,000.00/);
    assert.ok(context.regime.includes("gamma"));
    assert.deepEqual(ruleLabels, [
      "Spot vs flip",
      "0DTE gamma",
      "Pin / walls",
      "DEX pressure",
      "VEX / vol lane",
      "CEX / charm lane",
      "Structure map",
      "Data quality",
    ]);
    assert.ok(context.rules.every((rule) => rule.value.length > 0 && rule.detail.length > 0));
    assert.ok(context.rules.some((rule) => rule.label === "Spot vs flip" && rule.detail.includes("acceptance")));
    assert.ok(context.rules.some((rule) => rule.label === "Data quality" && rule.value.includes("priced")));
    assert.ok(context.nearbyStructures.length > 0);
    assert.ok(context.playbook.length >= 3);
    assert.ok(context.riskNotes.some((note) => note.includes("Black-Scholes pressure lanes")));

    const collapsedContext = buildSpxGexHeatmapReadingContext({
      ...heatmap,
      zeroDte: {
        ...heatmap.zeroDte,
        topCallWallLevel: 6000,
        topPutWallLevel: 6000,
      },
    });
    assert.ok(collapsedContext.headline.includes("wall cluster"));
    assert.equal(collapsedContext.headline.includes("6,000 -> 6,000"), false);
  });

  it("derives Telegram GEX summary from canonical heatmap totals and strike profiles", () => {
    const heatmap = buildStructuredHeatmap();
    const summary = toTelegramGexSummary(heatmap);
    const totalNetGex = heatmap.totals.reduce((sum, total) => sum + total.netGex, 0);
    const mostLong = [...heatmap.strikeProfiles].sort((a, b) => b.netGex - a.netGex)[0];
    const mostShort = [...heatmap.strikeProfiles].sort((a, b) => a.netGex - b.netGex)[0];

    assert.ok(summary);
    assert.equal(summary.source, "Canonical D1 SPX GEX heatmap (black_scholes_exposure_engine)");
    assert.equal(summary.spot, heatmap.quote.last);
    assert.equal(summary.totalNetGex, totalNetGex);
    assert.equal(summary.zeroDteNetGex, heatmap.zeroDte.netGex);
    assert.equal(summary.gammaFlipLevel, heatmap.zeroDte.gammaFlip);
    assert.equal(summary.mostLongStrike, mostLong.strike);
    assert.equal(summary.mostShortStrike, mostShort.strike);
    assert.equal(summary.longWalls?.[0]?.strike, mostLong.strike);
    assert.equal(summary.shortPockets?.[0]?.strike, mostShort.strike);
    assert.equal(summary.generatedAt, heatmap.generatedAt);
    assert.equal(new Date(summary.generatedAt).toISOString(), heatmap.generatedAt);
    assert.equal(summary.displayTimeLabel, "09:30 ET snapshot / collected 09:45 ET");
  });

  it("builds a stable replayable canonical snapshot envelope from normalized inputs", () => {
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-07-13T18:45:00.000Z",
      chains: expiries.map((expiry) => ({
        ...buildOptionChain(expiry, 7516.04),
        source: {
          provider: "cboe",
          label: "Cboe delayed",
          timestamp: "2026-07-13 18:30:00",
          fallbackFrom: "yahoo",
        },
      })),
      selectedExpiries: expiries,
      maxStrikes: 5,
    });

    const canonical = buildCanonicalSpxGexSnapshotEnvelope(heatmap);
    const replayed = buildCanonicalSpxGexSnapshotEnvelope(JSON.parse(JSON.stringify(heatmap)));
    const changed = buildCanonicalSpxGexSnapshotEnvelope({
      ...heatmap,
      cells: heatmap.cells.map((cell, index) => index === 0 ? { ...cell, netGex: Number(cell.netGex || 0) + 1 } : cell),
    });

    assert.equal(canonical.schemaVersion, 1);
    assert.equal(canonical.replayGrade, "NORMALIZED_CANONICAL");
    assert.equal(canonical.generatedAt, "2026-07-13T18:45:00.000Z");
    assert.equal(canonical.sourceTimestamp, "2026-07-13T18:30:00.000Z");
    assert.equal(canonical.provider, "cboe");
    assert.equal(canonical.fallbackFrom, "yahoo");
    assert.deepEqual(canonical.dataQuality, heatmap.dataQuality);
    assert.equal(canonical.payloadHash, replayed.payloadHash);
    assert.equal(canonical.snapshotId, replayed.snapshotId);
    assert.notEqual(canonical.payloadHash, changed.payloadHash);
  });

  it("keeps dense SPX strike coverage near spot instead of collapsing to a sparse mock-table", () => {
    const denseStrikes = Array.from({ length: 121 }, (_, index) => 5700 + index * 5);
    const denseChains = expiries.map((expiry) => ({
      ...buildOptionChain(expiry),
      calls: denseStrikes.map((strike, index) => ({
        contractSymbol: `SPX${expiry.replaceAll("-", "")}C${strike}`,
        strike,
        lastPrice: Math.max(1, 6000 - strike + 25),
        bid: 1,
        ask: 2,
        volume: 200 + index,
        openInterest: 1000 + index * 5,
        impliedVolatility: 18 + (index % 8),
      })),
      puts: denseStrikes.map((strike, index) => ({
        contractSymbol: `SPX${expiry.replaceAll("-", "")}P${strike}`,
        strike,
        lastPrice: Math.max(1, strike - 6000 + 25),
        bid: 1,
        ask: 2,
        volume: 180 + index,
        openInterest: 900 + index * 4,
        impliedVolatility: 20 + (index % 8),
      })),
    }));

    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-05-27T13:15:00.000Z",
      chains: denseChains,
      selectedExpiries: expiries,
    });

    assert.equal(heatmap.strikes.length, 96);
    assert.equal(heatmap.cells.length, 96 * expiries.length);
    assert.ok(heatmap.strikes.includes(6000));
  });
});

class MemoryD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: MemoryD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.includes("INSERT INTO spx_cboe_option_chain_cache")) {
      this.db.cboeCache.set(String(this.values[0]), {
        cache_key: this.values[0],
        trading_date: this.values[1],
        collected_minute_et: this.values[2],
        source_timestamp: this.values[3],
        spot: this.values[4],
        chains_json: this.values[5],
        pcr_value: this.values[6],
        raw_bytes: this.values[7],
        normalized_bytes: this.values[8],
        fetch_ms: this.values[9],
        created_at: this.values[10],
        expires_at: this.values[11],
      });
    }

    if (this.query.includes("DELETE FROM spx_cboe_option_chain_cache")) {
      const cutoff = String(this.values[0]);
      for (const [key, row] of [...this.db.cboeCache.entries()]) {
        if (String(row.expires_at) < cutoff) this.db.cboeCache.delete(key);
      }
    }

    if (this.query.includes("INSERT INTO spx_gex_intraday_snapshots")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      if (!this.query.includes("DO NOTHING") || !this.db.intraday.has(key)) {
        this.db.intraday.set(key, {
          trading_date: this.values[0],
          snapshot_minute_et: this.values[1],
          snapshot_time_et: this.values[2],
          generated_at: this.values[3],
          ticker: this.values[4],
          spot: this.values[5],
          snapshot_json: this.values[6],
        });
      }
    }

    if (this.query.includes("INSERT INTO spx_gex_pressure_projections")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      this.db.pressureProjections.set(key, {
        trading_date: this.values[0],
        snapshot_minute_et: this.values[1],
        snapshot_time_et: this.values[2],
        collected_minute_et: this.values[3],
        collected_time_et: this.values[4],
        generated_at: this.values[5],
        spot: this.values[6],
        expiry: this.values[7],
        calculation_engine_version: this.values[8],
        provider: this.values[9],
        fallback_from: this.values[10],
        source_timestamp: this.values[11],
        snapshot_id: this.values[12],
        payload_hash: this.values[13],
        gex_json: this.values[14],
      });
    }

    if (this.query.includes("INSERT INTO spx_gex_invalid_snapshots")) {
      const key = `${this.values[0]}:${this.values[1]}:${this.values[8]}`;
      if (!this.db.invalidSnapshots.has(key)) {
        this.db.invalidSnapshots.set(key, {
          trading_date: this.values[0],
          snapshot_minute_et: this.values[1],
          snapshot_time_et: this.values[2],
          generated_at: this.values[3],
          ticker: this.values[4],
          spot: this.values[5],
          snapshot_json: this.values[6],
          snapshot_id: this.values[7],
          payload_hash: this.values[8],
          provider: this.values[9],
          reason_code: this.values[10],
          quarantined_at: this.values[11],
        });
      }
    }

    if (this.query.includes("DELETE FROM spx_gex_intraday_snapshots")) {
      if (this.query.includes("snapshot_json = ?")) {
        const key = `${this.values[0]}:${this.values[1]}`;
        const row = this.db.intraday.get(key);
        if (row?.snapshot_json === this.values[2]) {
          this.db.intraday.delete(key);
          this.db.pressureProjections.delete(key);
        }
      } else {
        const keepDates = Array.from(new Set([...this.db.intraday.values()].map((row) => String(row.trading_date))))
          .sort()
          .reverse()
          .slice(0, Number(this.values[0]));
        for (const [key, row] of [...this.db.intraday.entries()]) {
          if (!keepDates.includes(String(row.trading_date))) {
            this.db.intraday.delete(key);
            this.db.pressureProjections.delete(key);
          }
        }
      }
    }

    if (this.query.includes("DELETE FROM spx_gex_invalid_snapshots")) {
      const keepDates = Array.from(new Set([...this.db.invalidSnapshots.values()].map((row) => String(row.trading_date))))
        .sort()
        .reverse()
        .slice(0, Number(this.values[0]));
      for (const [key, row] of [...this.db.invalidSnapshots.entries()]) {
        if (!keepDates.includes(String(row.trading_date))) this.db.invalidSnapshots.delete(key);
      }
    }

    if (this.query.includes("INSERT INTO spx_gex_heatmaps")) {
      this.db.legacy.set(String(this.values[0]), {
        date: this.values[0],
        generated_at: this.values[1],
        snapshot_at: this.values[2],
        ticker: this.values[3],
        spot: this.values[4],
        quote_json: this.values[5],
        expiries_json: this.values[6],
        strikes_json: this.values[7],
        cells_json: this.values[8],
        totals_json: this.values[9],
        zero_dte_json: this.values[10],
        interpretation_json: this.query.includes("interpretation_json") ? this.values[11] : null,
        source_json: this.query.includes("interpretation_json") ? this.values[12] : this.values[11],
      });
    }

    if (this.query.includes("DELETE FROM spx_gex_heatmaps")) {
      const keepDates = [...this.db.legacy.keys()].sort().reverse().slice(0, Number(this.values[0]));
      for (const date of [...this.db.legacy.keys()]) {
        if (!keepDates.includes(date)) this.db.legacy.delete(date);
      }
    }

    return {};
  }

  async first<T = Record<string, unknown>>() {
    if (this.query.includes("INSERT INTO spx_d1_budget_state")) {
      const day = String(this.values[0]);
      const current = this.db.spxBudgetState.get(day);
      if (current && (Number(current.rows_read) >= Number(this.values[9]) || Number(current.rows_written) >= Number(this.values[10]))) {
        return null;
      }
      const next = current
        ? {
          utc_day: day,
          rows_read: Number(current.rows_read) + Number(this.values[5]),
          rows_written: Number(current.rows_written) + Number(this.values[6]),
          last_deny_reason: null,
        }
        : {
          utc_day: day,
          rows_read: Number(this.values[1]),
          rows_written: Number(this.values[2]),
          last_deny_reason: null,
        };
      this.db.spxBudgetState.set(day, next);
      return next as T;
    }

    if (this.query.includes("FROM spx_d1_budget_state")) {
      return (this.db.spxBudgetState.get(String(this.values[0])) || null) as T | null;
    }

    if (this.query.includes("FROM spx_cboe_option_chain_cache") && this.query.includes("cache_key = ?")) {
      const row = this.db.cboeCache.get(String(this.values[0]));
      if (!row) return null;
      if (this.query.includes("expires_at > ?") && !(String(row.expires_at) > String(this.values[1]))) return null;
      return row as T;
    }

    if (this.query.includes("FROM spx_cboe_option_chain_cache") && this.query.includes("trading_date = ?")) {
      const rows = [...this.db.cboeCache.values()]
        .filter((row) => row.trading_date === this.values[0])
        .filter((row) => !this.query.includes("collected_minute_et = ?") || row.collected_minute_et === this.values[1])
        .sort((a, b) => Number(b.collected_minute_et) - Number(a.collected_minute_et) || String(b.created_at).localeCompare(String(a.created_at)));
      return (rows[0] || null) as T | null;
    }

    if (this.query.includes("FROM spx_gex_intraday_snapshots")) {
      const date = String(this.values[0]);
      if (this.query.includes("snapshot_minute_et = ?")) {
        return (this.db.intraday.get(`${date}:${this.values[1]}`) || null) as T | null;
      }
      const rows = [...this.db.intraday.values()]
        .filter((row) => row.trading_date === date)
        .sort((a, b) => Number(b.snapshot_minute_et) - Number(a.snapshot_minute_et));
      return (rows[0] || null) as T | null;
    }

    if (this.query.includes("SELECT * FROM spx_gex_heatmaps WHERE date = ?")) {
      return (this.db.legacy.get(String(this.values[0])) || null) as T | null;
    }

    return null;
  }

  async all<T = Record<string, unknown>>() {
    if (this.query.includes("SELECT DISTINCT trading_date") && this.query.includes("FROM spx_gex_invalid_snapshots")) {
      return {
        results: Array.from(new Set([...this.db.invalidSnapshots.values()].map((row) => String(row.trading_date))))
          .sort()
          .reverse()
          .map((trading_date) => ({ trading_date })) as T[],
      };
    }

    if (this.query.includes("SELECT DISTINCT trading_date") && this.query.includes("FROM spx_gex_pressure_projections")) {
      return {
        results: Array.from(new Set([...this.db.pressureProjections.values()].map((row) => String(row.trading_date))))
          .sort()
          .reverse()
          .map((trading_date) => ({ trading_date })) as T[],
      };
    }

    if (this.query.includes("FROM spx_gex_invalid_snapshots") && this.query.includes("WHERE trading_date = ?")) {
      const date = String(this.values[0]);
      return {
        results: [...this.db.invalidSnapshots.values()]
          .filter((row) => row.trading_date === date)
          .sort((a, b) => Number(a.snapshot_minute_et) - Number(b.snapshot_minute_et))
          .map((row) => ({
            snapshot_minute_et: row.snapshot_minute_et,
            snapshot_time_et: row.snapshot_time_et,
            reason_code: row.reason_code,
          })) as T[],
      };
    }

    if (this.query.includes("SELECT DISTINCT trading_date")) {
      return {
        results: Array.from(new Set([...this.db.intraday.values()].map((row) => String(row.trading_date))))
          .sort()
          .reverse()
          .map((trading_date) => ({ trading_date })) as T[],
      };
    }

    if (this.query.includes("SPX_GEX_PRESSURE_PROJECTION")) {
      const date = String(this.values[0]);
      return {
        results: ([...this.db.pressureProjections.values()]
          .filter((row) => row.trading_date === date)
          .sort((a, b) => Number(a.snapshot_minute_et) - Number(b.snapshot_minute_et)) as T[]),
      };
    }

    if (this.query.includes("FROM spx_gex_intraday_snapshots") && this.query.includes("WHERE trading_date = ?")) {
      const date = String(this.values[0]);
      const includeSnapshotJson = this.query.includes("snapshot_json") || this.query.includes("SELECT *");
      return {
        results: [...this.db.intraday.values()]
          .filter((row) => row.trading_date === date)
          .sort((a, b) => Number(a.snapshot_minute_et) - Number(b.snapshot_minute_et))
          .map((row) => ({
            trading_date: row.trading_date,
            snapshot_minute_et: row.snapshot_minute_et,
            snapshot_time_et: row.snapshot_time_et,
            generated_at: row.generated_at,
            spot: row.spot,
            ...(includeSnapshotJson ? { snapshot_json: row.snapshot_json } : {}),
          })) as T[],
      };
    }

    if (this.query.includes("SELECT date FROM spx_gex_heatmaps")) {
      return {
        results: [...this.db.legacy.keys()].sort().reverse().map((date) => ({ date })) as T[],
      };
    }

    return { results: [] as T[] };
  }
}

class MemoryD1 {
  readonly intraday = new Map<string, Record<string, unknown>>();
  readonly pressureProjections = new Map<string, Record<string, unknown>>();
  readonly spxBudgetState = new Map<string, Record<string, unknown>>();
  readonly invalidSnapshots = new Map<string, Record<string, unknown>>();
  readonly legacy = new Map<string, Record<string, unknown>>();
  readonly cboeCache = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    return new MemoryD1Statement(this, query);
  }

  async batch(statements: MemoryD1Statement[]) {
    for (const statement of statements) await statement.run();
    return [];
  }
}

class ThrowingD1 {
  prepare() {
    throw new Error("no such table: spx_cboe_option_chain_cache");
  }
}

class MissingPipelineTablesD1 extends MemoryD1 {
  override prepare(query: string) {
    if (query.includes("spx_decision_run_health")) {
      throw new Error("no such table: spx_decision_run_health");
    }
    if (query.includes("spx_gex_collection_runs")) {
      throw new Error("no such table: spx_gex_collection_runs");
    }
    return super.prepare(query);
  }
}

const seedLegacyHeatmapRow = (db: MemoryD1, date: string, heatmap: SpxGexHeatmapModel) => {
  db.legacy.set(date, {
    date,
    generated_at: heatmap.generatedAt,
    snapshot_at: heatmap.snapshot,
    ticker: heatmap.ticker,
    spot: heatmap.quote.last,
    quote_json: JSON.stringify(heatmap.quote),
    expiries_json: JSON.stringify(heatmap.selectedExpiries),
    strikes_json: JSON.stringify(heatmap.strikes),
    cells_json: JSON.stringify(heatmap.cells),
    totals_json: JSON.stringify(heatmap.totals),
    zero_dte_json: JSON.stringify(heatmap.zeroDte),
    interpretation_json: JSON.stringify(heatmap.premarketInterpretation),
    source_json: JSON.stringify(heatmap.source),
  });
};

describe("SPX GEX intraday D1 storage", () => {
  it("quarantines a semantic-invalid snapshot instead of persisting it as active", async () => {
    const db = new MemoryD1();
    const invalid = buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000);
    invalid.cells = invalid.cells.map((cell) => ({
      ...cell,
      netGex: null,
      callIv: null,
      putIv: null,
      gammaIv: null,
    }));

    await assert.rejects(
      () => upsertSpxGexHeatmap(db, "2026-05-27", invalid),
      /NO_AUDITED_BLENDED_IV_CELLS/,
    );

    assert.equal(await readSpxGexHeatmap(db, "2026-05-27", 570), null);
    assert.deepEqual(await listSpxGexInvalidSnapshots(db, "2026-05-27"), [{
      snapshotMinuteEt: 570,
      snapshotTimeEt: "09:30",
      reasonCode: "NO_AUDITED_BLENDED_IV_CELLS",
    }]);
  });

  it("replaces an invalid active row with a contract-valid retry for the same slot", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000));
    const invalidRow = db.intraday.get("2026-05-27:570");
    assert.ok(invalidRow);
    const invalidSnapshot = JSON.parse(String(invalidRow.snapshot_json)) as SpxGexHeatmapModel;
    invalidSnapshot.cells = invalidSnapshot.cells.map((cell) => ({ ...cell, netGex: null, callIv: null, putIv: null, gammaIv: null }));
    invalidRow.snapshot_json = JSON.stringify(invalidSnapshot);

    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6010));

    assert.equal((await readSpxGexHeatmap(db, "2026-05-27", 570))?.quote.last, 6010);
    assert.equal((await listSpxGexInvalidSnapshots(db, "2026-05-27"))[0]?.reasonCode, "NO_AUDITED_BLENDED_IV_CELLS");
  });

  it("keeps canonical payload hash and snapshot id stable after audited D1 read normalization", async () => {
    const db = new MemoryD1();
    const fixture = buildSpxGexUatFixture();
    await upsertSpxGexHeatmap(db, "2026-07-13", fixture);

    const restored = await readSpxGexHeatmap(db, "2026-07-13", 14 * 60 + 30);

    assert.equal(restored?.canonical?.payloadHash, fixture.canonical?.payloadHash);
    assert.equal(restored?.canonical?.snapshotId, fixture.canonical?.snapshotId);
  });

  it("stores multiple snapshots per date, reads latest or selected slot, and retains seven trading dates", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000), { retentionTradingDays: 7 });
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T14:00:00.000Z", 6010), { retentionTradingDays: 7 });

    for (const date of ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22", "2026-05-26", "2026-05-28"]) {
      await upsertSpxGexHeatmap(db, date, buildStructuredHeatmap(`${date}T13:45:00.000Z`), { retentionTradingDays: 7 });
    }

    assert.deepEqual(await listSpxGexHeatmapDates(db), [
      "2026-05-28",
      "2026-05-27",
      "2026-05-26",
      "2026-05-22",
      "2026-05-21",
      "2026-05-20",
      "2026-05-19",
    ]);
    assert.equal((await listSpxGexHeatmapSessions(db, "2026-05-27")).length, 2);
    assert.equal((await readSpxGexHeatmap(db, "2026-05-27"))?.quote.last, 6010);
    const restoredFirstSlot = await readSpxGexHeatmap(db, "2026-05-27", 9 * 60 + 30);
    const restoredAuditCell = restoredFirstSlot?.cells.find((cell) => cell.expdate === expiries[0] && cell.strike === 6000);
    assert.equal(restoredFirstSlot?.quote.last, 6000);
    assert.equal(restoredAuditCell?.callIvPercent, 20);
    assert.equal(restoredAuditCell?.putIvPercent, 22);
    assert.equal(restoredAuditCell?.gammaIvPercent, 21);
    assert.equal(restoredAuditCell?.callEffectiveOpenInterest, 7000);
    assert.equal(restoredAuditCell?.putEffectiveOpenInterest, 7400);
    assert.equal(restoredAuditCell?.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(await readSpxGexHeatmap(db, "2026-05-18"), null);
    assert.equal(db.legacy.size, 0);
  });

  it("recomputes audit-capable side-IV intraday snapshots with blended gamma IV at read time", async () => {
    const db = new MemoryD1();
    const heatmap = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-06-22T18:15:07.000Z",
      chains: [buildSideSkewChain()],
      selectedExpiries: ["2026-06-22"],
      maxStrikes: 1,
    });
    const storedCell = heatmap.cells[0];
    assert.ok(storedCell);
    Object.assign(storedCell, {
      callGex: 4,
      putGex: -3_538_819,
      netGex: -3_538_815,
      gammaIv: undefined,
      gammaIvPercent: undefined,
      model: "black_scholes_gamma_exposure",
    });
    heatmap.source.note = `${heatmap.source.note} New snapshots retain per-cell IV/OI/DTE audit inputs; legacy snapshots may not.`;
    await upsertSpxGexHeatmap(db, "2026-06-22", heatmap, { retentionTradingDays: 7 });

    const restored = await readSpxGexHeatmap(db, "2026-06-22", 14 * 60);
    const restoredCell = restored?.cells[0];

    assert.ok(restoredCell);
    assert.equal(restoredCell.model, "black_scholes_gamma_exposure_blended_iv");
    assert.equal(restoredCell.gammaIvPercent, 11.66);
    assert.ok(Number(restoredCell.callGex) > Math.abs(Number(restoredCell.putGex)));
    assert.ok(Number(restoredCell.netGex) > 0);
    assert.equal(restored?.totals[0]?.netGex, restoredCell.netGex);
    assert.equal(restored?.zeroDte.netGex, restoredCell.netGex);
    assert.ok(!restored?.source.note.includes("legacy"));
  });

  it("does not fall back to the legacy daily table when no audited intraday snapshot exists", async () => {
    const db = new MemoryD1();
    const legacy = buildLegacyHeatmap("2026-05-27T13:15:00.000Z");
    seedLegacyHeatmapRow(db, "2026-05-27", legacy);

    const restored = await readSpxGexHeatmap(db, "2026-05-27");

    assert.equal(restored, null);
    assert.deepEqual(await listSpxGexHeatmapDates(db), []);
    assert.deepEqual(await listSpxGexHeatmapSessions(db, "2026-05-27"), []);
  });
});

describe("SPX GEX heatmap API", () => {
  it("returns 503 with an explicit status when the D1 binding is missing", async () => {
    const response = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap"),
      env: {},
    });
    const payload = (await response.json()) as { status: string; errorCode: string };

    assert.equal(response.status, 503);
    assert.equal(payload.status, "BINDING_MISSING");
    assert.equal(payload.errorCode, "SPX_RECAP_DB_BINDING_MISSING");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("distinguishes a missing heatmap table from a D1 read failure", async () => {
    const missingTableResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap"),
      env: { SPX_RECAP_DB: { prepare: () => { throw new Error("no such table: spx_gex_intraday_snapshots"); } } as any },
    });
    const missingPayload = (await missingTableResponse.json()) as { status: string; errorCode: string };
    assert.equal(missingTableResponse.status, 503);
    assert.equal(missingPayload.status, "STORAGE_UNAVAILABLE");
    assert.equal(missingPayload.errorCode, "SPX_GEX_INTRADAY_TABLE_MISSING");
    assert.equal(missingTableResponse.headers.get("cache-control"), "no-store");

    const failedResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap"),
      env: { SPX_RECAP_DB: { prepare: () => { throw new Error("D1 transport unavailable"); } } as any },
    });
    const failedPayload = (await failedResponse.json()) as { status: string; errorCode: string };
    assert.equal(failedResponse.status, 500);
    assert.equal(failedPayload.status, "ERROR");
    assert.equal(failedPayload.errorCode, "SPX_GEX_D1_READ_FAILED");
    assert.equal(failedResponse.headers.get("cache-control"), "no-store");
  });

  it("keeps Board truth available and exposes explicit warnings before pipeline migrations land", async () => {
    const db = new MissingPipelineTablesD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000));

    const response = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27&snapshot=570"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = (await response.json()) as { heatmap: SpxGexHeatmapModel; decision: null; collection: null; warnings: string[] };

    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.heatmap.quote.last, 6000);
    assert.equal(payload.decision, null);
    assert.equal(payload.collection, null);
    assert.deepEqual(payload.warnings, [
      "SPX decision pipeline migration is not applied yet.",
      "GEX collection lifecycle migration is not applied yet.",
    ]);
  });

  it("returns dates, sessions, selected latest snapshot, and supports explicit snapshot selection", async () => {
    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000));
    await upsertSpxGexHeatmap(db, "2026-05-27", buildStructuredHeatmap("2026-05-27T14:00:00.000Z", 6010));
    await upsertSpxGexHeatmap(db, "2026-05-28", buildStructuredHeatmap("2026-05-28T14:15:00.000Z", 6020));

    const latestResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const latestPayload = (await latestResponse.json()) as {
      selectedDate: string;
      sessions: Array<{ snapshotMinuteEt: number; collectedTimeEt: string }>;
      selectedSnapshot: { snapshotMinuteEt: number; collectedTimeEt: string };
      heatmap: SpxGexHeatmapModel;
    };

    assert.equal(latestResponse.status, 200);
    assert.equal((latestPayload as any).status, "READY");
    assert.equal(latestResponse.headers.get("cache-control"), "public, max-age=60");
    assert.equal(latestPayload.selectedDate, "2026-05-27");
    assert.deepEqual(
      latestPayload.sessions.map((session) => session.snapshotMinuteEt),
      [9 * 60 + 30, 9 * 60 + 45],
      "timeline frames stay replayable in chronological order",
    );
    assert.equal(latestPayload.selectedSnapshot.snapshotMinuteEt, 9 * 60 + 45);
    assert.equal(latestPayload.selectedSnapshot.collectedTimeEt, "10:00");
    assert.equal(latestPayload.heatmap.quote.last, 6010);
    assert.equal(latestPayload.heatmap.cells[0]?.model, undefined, "initial Board payload omits tooltip-only audit fields");
    assert.equal(latestPayload.heatmap.cells[0]?.callGex !== undefined, true, "initial Board payload retains visible exposure fields");

    const selectedResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27&snapshot=570"),
      env: { SPX_RECAP_DB: db },
    });
    const selectedPayload = (await selectedResponse.json()) as { heatmap: SpxGexHeatmapModel };

    assert.equal(selectedPayload.heatmap.quote.last, 6000);

    const missingFrameResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27&snapshot=600"),
      env: { SPX_RECAP_DB: db },
    });
    const missingFramePayload = (await missingFrameResponse.json()) as {
      status: string;
      heatmap: SpxGexHeatmapModel | null;
      selectedSnapshot: unknown | null;
    };

    assert.equal(missingFrameResponse.status, 200);
    assert.equal(missingFramePayload.status, "EMPTY");
    assert.equal(missingFramePayload.heatmap, null);
    assert.equal(missingFramePayload.selectedSnapshot, null);

    const defaultResponse = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap"),
      env: { SPX_RECAP_DB: db },
    });
    const defaultPayload = (await defaultResponse.json()) as {
      selectedDate: string;
      selectedSnapshot: { snapshotMinuteEt: number };
      heatmap: SpxGexHeatmapModel;
    };

    assert.equal(defaultPayload.selectedDate, "2026-05-28");
    assert.equal(defaultPayload.selectedSnapshot.snapshotMinuteEt, 10 * 60);
    assert.equal(defaultPayload.heatmap.quote.last, 6020);
  });

  it("loads complete audit evidence only for the requested Board cell", async () => {
    const db = new MemoryD1();
    const heatmap = buildStructuredHeatmap("2026-05-27T13:45:00.000Z", 6000);
    await upsertSpxGexHeatmap(db, "2026-05-27", heatmap);
    const target = heatmap.cells[0]!;
    const response = await getSpxGexCellDetailApi({
      request: new Request(`https://example.com/api/spx-gex-cell-detail?date=2026-05-27&snapshot=570&strike=${target.strike}&expiry=${target.expdate}`),
      env: { SPX_RECAP_DB: db },
    });
    const payload = await response.json() as { status: string; detail: SpxGexHeatmapModel["cells"][number] | null };
    assert.equal(response.status, 200);
    assert.equal(payload.status, "READY");
    assert.equal(payload.detail?.model, target.model);
    assert.deepEqual(payload.detail?.repairNotes, target.repairNotes);
  });

  it("rejects a cell request missing either required numeric selection before D1", async () => {
    const db = { prepare: () => { throw new Error("cell validation must precede D1"); } } as any;
    const missingSnapshot = await getSpxGexCellDetailApi({
      request: new Request("https://example.com/api/spx-gex-cell-detail?date=2026-05-27&strike=6000&expiry=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const missingStrike = await getSpxGexCellDetailApi({
      request: new Request("https://example.com/api/spx-gex-cell-detail?date=2026-05-27&snapshot=570&expiry=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    assert.equal(missingSnapshot.status, 400);
    assert.equal(missingStrike.status, 400);
  });

  it("returns no data instead of legacy fallback when only daily legacy rows exist", async () => {
    const db = new MemoryD1();
    seedLegacyHeatmapRow(db, "2026-05-27", buildLegacyHeatmap("2026-05-27T13:15:00.000Z"));

    const response = await getSpxGexHeatmapApi({
      request: new Request("https://example.com/api/spx-gex-heatmap?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = (await response.json()) as {
      availableDates: string[];
      selectedDate: string | null;
      sessions: unknown[];
      selectedSnapshot: unknown | null;
      heatmap: SpxGexHeatmapModel | null;
    };

    assert.equal(response.status, 200);
    assert.equal((payload as any).status, "EMPTY");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(payload.availableDates, []);
    assert.equal(payload.selectedDate, "2026-05-27");
    assert.deepEqual(payload.sessions, []);
    assert.equal(payload.selectedSnapshot, null);
    assert.equal(payload.heatmap, null);
  });
});

const createFakeDataClient = () => {
  const calls: string[] = [];
  const client: SpxGexDataClient = {
    async getQuotes() {
      calls.push("get_quotes");
      return "| Ticker | Last | Change | Change % |\n| SPX | $6,000.00 | +12.50 | +0.21% |";
    },
    async getOptions() {
      calls.push("get_options");
      return `**Available expiries:** ${expiries.join(", ")}`;
    },
    async getOptions0Dte() {
      calls.push("get_options_0dte");
      return legacyZeroDteText;
    },
    async getOptionsGex(expiry: string) {
      calls.push(`get_options_gex:${expiry}`);
      return gexText(expiry, "| $6,050 | 1 | 2 | **2.00B** |\n| $6,000 | 1 | 2 | **-1.00B** |");
    },
    async getOptionsChain(expiry?: string) {
      calls.push(`get_options_chain:${expiry || "front"}`);
      return buildOptionChain(expiry || expiries[0]);
    },
    async getMarketContext() {
      calls.push("get_market_context");
      return {
        macroRegime: "risk_off",
        breadth: { advancers: 2, universeCount: 5, avgChange: -0.65 },
        flow: { topTicker: "NVDA", proxyFlow: -125_000_000, changePercent: -1.2 },
        latestHeadline: "Futures slip before the open",
        warnings: [],
      };
    },
  };

  return { client, calls };
};

describe("SPX GEX intraday automation runner", () => {
  it("never emits NORMALIZED or PERSISTED for a snapshot that fails the shared contract", async () => {
    const db = new MemoryD1();
    const { client } = createFakeDataClient();
    const invalidClient: SpxGexDataClient = {
      ...client,
      async getOptionsChain(expiry?: string) {
        const chain = await client.getOptionsChain(expiry) as SpxGexOptionChain;
        const stripPricing = (leg: SpxGexOptionChain["calls"][number]) => ({
          ...leg,
          impliedVolatility: null,
          bid: null,
          ask: null,
          lastPrice: null,
        });
        return {
          ...chain,
          calls: chain.calls.map(stripPricing),
          puts: chain.puts.map(stripPricing),
        };
      },
    };
    const lifecycleStages: string[] = [];

    await assert.rejects(
      () => generateAndStoreSpxGexHeatmap({
        db,
        dataClient: invalidClient,
        now: new Date("2026-05-27T13:45:00Z"),
        onStage: async (stage) => { lifecycleStages.push(stage); },
      }),
      /NO_AUDITED_BLENDED_IV_CELLS/,
    );

    assert.deepEqual(lifecycleStages, ["FETCHED"]);
    assert.deepEqual(await listSpxGexHeatmapSessions(db, "2026-05-27"), []);
    assert.equal((await listSpxGexInvalidSnapshots(db, "2026-05-27"))[0]?.reasonCode, "NO_AUDITED_BLENDED_IV_CELLS");
  });

  it("generates once per 15-minute slot and skips only the same slot", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();
    const lifecycleStages: string[] = [];

    const firstRun = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:45:00Z"),
      onStage: async (stage) => { lifecycleStages.push(stage); },
    });
    const sameSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:45:00Z"),
    });
    const forcedSameSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T13:45:00Z"),
      force: true,
    });
    const nextSlot = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-27T14:00:00Z"),
    });

    assert.deepEqual(firstRun, { status: "generated", date: "2026-05-27", snapshotMinuteEt: 570, snapshotTimeEt: "09:30", collectedMinuteEt: 585, collectedTimeEt: "09:45" });
    assert.deepEqual(sameSlot, { status: "skipped_existing", date: "2026-05-27", snapshotMinuteEt: 570, snapshotTimeEt: "09:30", collectedMinuteEt: 585, collectedTimeEt: "09:45" });
    assert.deepEqual(forcedSameSlot, sameSlot);
    assert.deepEqual(nextSlot, { status: "generated", date: "2026-05-27", snapshotMinuteEt: 585, snapshotTimeEt: "09:45", collectedMinuteEt: 600, collectedTimeEt: "10:00" });
    assert.equal((await listSpxGexHeatmapSessions(db, "2026-05-27")).length, 2);
    assert.equal(calls.filter((call) => call === "get_quotes").length, 2);
    assert.equal(calls.filter((call) => call.startsWith("get_options_chain")).length, 12);
    assert.deepEqual(lifecycleStages, ["FETCHED", "NORMALIZED", "PERSISTED"]);
  });

  it("generates and stores the canonical heatmap before building Telegram GEX when cache is newer but snapshot is missing", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();
    const cache = new CboeD1Cache(db, { now: () => new Date("2026-05-27T14:00:00Z") });
    await cache.write({
      cacheKey: "SPX:CBOE_DELAYED:2026-05-27:600",
      tradingDate: "2026-05-27",
      collectedMinuteEt: 600,
      sourceTimestamp: "2026-05-27 14:00:00",
      spot: 6000,
      chains: expiries.map((expiry) => buildOptionChain(expiry)),
      pcrValue: 1.23,
    });
    await cache.write({
      cacheKey: "SPX:CBOE_DELAYED:2026-05-27:615",
      tradingDate: "2026-05-27",
      collectedMinuteEt: 615,
      sourceTimestamp: "2026-05-27 14:15:00",
      spot: 6005,
      chains: expiries.map((expiry) => buildOptionChain(expiry, 6005)),
      pcrValue: 1.34,
    });

    const result = await loadCanonicalSpxGexForTelegram(
      { SPX_RECAP_DB: db },
      new Date("2026-05-27T14:00:00Z"),
      { dataClient: client },
    );
    const stored = await readSpxGexHeatmap(db, "2026-05-27", 585);

    assert.ok(stored);
    assert.ok(result.heatmap);
    assert.ok(result.calculatedGex);
    assert.equal(result.heatmap.session?.snapshotMinuteEt, 585);
    assert.equal(result.heatmap.session?.collectedMinuteEt, 600);
    assert.equal(result.pcrValue, 1.23);
    assert.equal(result.calculatedGex.source, "Canonical D1 SPX GEX heatmap (black_scholes_exposure_engine)");
    assert.equal(result.calculatedGex.totalNetGex, stored?.totals.reduce((sum, total) => sum + total.netGex, 0));
    assert.equal(calls.includes("get_quotes"), true);
    assert.equal(calls.some((call) => call.startsWith("get_options_chain")), true);
  });

  it("does not call the data client when the market is closed", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();

    const result = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-05-25T13:15:00Z"),
    });

    assert.deepEqual(result, { status: "skipped", date: "2026-05-25", reason: "us_market_holiday" });
    assert.deepEqual(calls, []);
  });

  it("does not call the data client on Juneteenth", async () => {
    const db = new MemoryD1();
    const { client, calls } = createFakeDataClient();

    const result = await generateAndStoreSpxGexHeatmap({
      db,
      dataClient: client,
      now: new Date("2026-06-19T13:45:00Z"),
    });

    assert.deepEqual(result, { status: "skipped", date: "2026-06-19", reason: "us_market_holiday" });
    assert.deepEqual(calls, []);
  });
});

const buildPressureSnapshot = (generatedAt: string, spot: number, values: Record<number, number>) => {
  const snapshot = structuredClone(buildStructuredHeatmap(generatedAt, spot));
  const expiry = snapshot.zeroDte.expiry;
  const template = snapshot.cells.find((cell) => cell.expdate === expiry);
  assert.ok(template);
  snapshot.cells = [
    ...snapshot.cells.filter((cell) => cell.expdate !== expiry),
    ...Object.entries(values).map(([strike, netGex]) => ({
      ...structuredClone(template),
      strike: Number(strike),
      netGex,
      callGex: netGex > 0 ? netGex : 0,
      putGex: netGex < 0 ? netGex : 0,
    })),
  ];
  delete (snapshot as Partial<SpxGexHeatmapModel>).canonical;
  return snapshot;
};

describe("SPX 0DTE pressure matrix", () => {
  const baselineValues = { 5970: 100, 5975: 100, 5980: -100, 5985: -100, 5990: 100, 5995: -100, 6000: 0 };
  const currentValues = { 5970: 150, 5975: 50, 5980: -150, 5985: -50, 5990: -25, 5995: 25, 6000: 50, 6005: 75 };

  it("builds the same public matrix from compact pressure frames", () => {
    const snapshots = [
      buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues),
      buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, currentValues),
    ];
    assert.deepEqual(
      buildSpxGexPressureMatrixFromFrames(snapshots.map(toSpxGexPressureFrame)),
      buildSpxGexPressureMatrix(snapshots),
    );
  });

  it("classifies all pressure states, keeps a missing slot, and handles a zero baseline", () => {
    const baseline = buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues);
    const current = buildPressureSnapshot("2026-05-27T14:15:00.000Z", 6010, currentValues);
    const pressure = buildSpxGexPressureMatrix([current, baseline]);
    const stateAt = (strike: number) => pressure.rows.find((row) => row.strike === strike)?.cells.at(-1)?.state;

    assert.equal(pressure.baseline.snapshotTimeEt, "09:30");
    assert.deepEqual(pressure.timeline.map((slot) => [slot.snapshotTimeEt, slot.status]), [
      ["09:30", "READY"],
      ["09:45", "MISSING"],
      ["10:00", "READY"],
    ]);
    assert.equal(pressure.strikeRange.lower, 5950);
    assert.equal(pressure.strikeRange.upper, 6060);
    assert.equal(stateAt(5970), "POSITIVE_STRONGER");
    assert.equal(stateAt(5975), "POSITIVE_WEAKER");
    assert.equal(stateAt(5980), "NEGATIVE_DEEPER");
    assert.equal(stateAt(5985), "NEGATIVE_WEAKER");
    assert.equal(stateAt(5990), "FLIP_TO_NEGATIVE");
    assert.equal(stateAt(5995), "FLIP_TO_POSITIVE");
    assert.equal(stateAt(6000), "POSITIVE_STRONGER");
    assert.equal(pressure.rows.find((row) => row.strike === 6000)?.cells.at(-1)?.strengthPct, null);
    assert.equal(pressure.rows.find((row) => row.strike === 6005)?.cells.at(-1)?.state, "NO_BASELINE");
  });

  it("ranks latest movers by absolute delta with deterministic ties", () => {
    const pressure = buildSpxGexPressureMatrix([
      buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues),
      buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, currentValues),
    ]);

    assert.equal(pressure.movers[0].strike, 5995);
    assert.equal(pressure.movers[1].strike, 5990);
    assert.equal(pressure.movers[0].intensityPct, 100);
    assert.equal(pressure.movers.some((mover) => mover.strike === 6005), false);
  });

  it("fails closed when the 0DTE expiry changes during a session", () => {
    const baseline = buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues);
    const current = buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, currentValues);
    current.zeroDte.expiry = "2026-05-28";
    assert.throws(() => buildSpxGexPressureMatrix([baseline, current]), /expiry changed/);
  });

  it("uses the option-chain spot even when independent quote text disagrees", () => {
    const model = buildSpxGexHeatmapFromOptionChains({
      generatedAt: "2026-05-27T13:45:00.000Z",
      quoteText: "| Ticker | Last | Change | Change % |\n| SPX | $6,999.00 | +1 | +0.1% |",
      chains: expiries.map((expiry) => buildOptionChain(expiry, 6000)),
      selectedExpiries: expiries,
    });
    assert.equal(model.quote.last, 6000);
    assert.equal(model.session?.spot, 6000);
  });

  it("maps Yahoo 1-minute SPX candles onto ET market minutes and breaks only at missing price minutes", () => {
    const segments = buildSpxGexOneMinuteSpotSegments([
      { time: Date.parse("2026-05-27T13:30:00.000Z"), close: 6000 },
      { time: Date.parse("2026-05-27T13:31:00.000Z"), close: 6001 },
      { time: Date.parse("2026-05-27T13:33:00.000Z"), close: 6003 },
      { time: Date.parse("2026-05-28T13:32:00.000Z"), close: 7000 },
    ], "2026-05-27", 9 * 60 + 30, 9 * 60 + 35);

    assert.deepEqual(segments.map((segment) => segment.map((point) => [point.timeEt, point.price])), [
      [["09:30", 6000], ["09:31", 6001]],
      [["09:33", 6003]],
    ]);
  });

  it("keeps the Yahoo 1-minute endpoint ahead of the latest 15-minute GEX slot", () => {
    const candles = [
      { time: Date.parse("2026-05-27T14:00:00.000Z"), close: 6000 },
      { time: Date.parse("2026-05-27T14:07:00.000Z"), close: 6007 },
    ];
    const latest = getLatestSpxGexSpotPoint(candles, "2026-05-27");
    assert.equal(latest?.timeEt, "10:07");
    assert.equal(latest?.price, 6007);
  });

  it("labels future GEX slots pending and overdue absent slots missing", () => {
    const pressure = buildSpxGexPressureMatrix([
      buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues),
    ]);
    const live = extendSpxGexPressureForSession(pressure, { tradingDate: "2026-05-27", minuteEt: 10 * 60 + 7 });
    assert.equal(live.timeline.find((slot) => slot.snapshotTimeEt === "09:45")?.status, "MISSING");
    assert.equal(live.timeline.find((slot) => slot.snapshotTimeEt === "10:00")?.status, "PENDING");
    assert.equal(live.timeline.at(-1)?.snapshotTimeEt, "16:00");
  });

  it("resets pressure baseline at the latest compatible calculation engine segment", () => {
    const legacy = buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues);
    const currentA = buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6002, currentValues);
    const currentB = buildPressureSnapshot("2026-05-27T14:15:00.000Z", 6004, currentValues);
    legacy.source.calculationEngineVersion = 1;
    currentA.source.calculationEngineVersion = 2;
    currentB.source.calculationEngineVersion = 2;
    const pressure = buildSpxGexPressureMatrix([legacy, currentA, currentB]);
    assert.equal(pressure.baseline.snapshotTimeEt, "09:45");
    assert.match(pressure.warnings.join(" "), /engine changed to v2/i);
  });

  it("shows only open, hourly, and latest major time ticks while preserving missing slots", () => {
    const pressure = buildSpxGexPressureMatrix([
      buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues),
      buildPressureSnapshot("2026-05-27T14:45:00.000Z", 6004, currentValues),
      buildPressureSnapshot("2026-05-27T15:00:00.000Z", 6006, currentValues),
    ]);
    const ticks = buildSpxGexPressureAxisTicks(pressure.timeline);

    assert.deepEqual(ticks.filter((tick) => tick.isMajor).map((tick) => tick.snapshotTimeEt), ["09:30", "10:30", "10:45"]);
    assert.equal(ticks.find((tick) => tick.snapshotTimeEt === "10:45")?.isLatest, true);
    assert.equal(ticks.find((tick) => tick.snapshotTimeEt === "10:00")?.status, "MISSING");
  });

  it("maps 1-minute price geometry and clamps the spot guide without drawing an in-chart price card", () => {
    const pressure = buildSpxGexPressureMatrix([
      buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues),
      buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, currentValues),
    ]);
    const geometry = buildSpxGexPressureChartGeometry(pressure, [[
      { time: 1, minuteEt: 570, timeEt: "09:30", price: 7000 },
      { time: 2, minuteEt: 585, timeEt: "09:45", price: 6005 },
    ]], 34, 25);

    assert.equal(geometry.resolution, "1m");
    assert.equal(geometry.pointCount, 2);
    assert.equal(geometry.latestPoint?.timeEt, "09:45");
    assert.equal(geometry.segments[0][0].y, 12.5);
    assert.equal("callout" in geometry, false);
    assert.equal(geometry.spotGuide?.price, 6005);
    const withExpectedMove = buildSpxGexPressureChartGeometry(pressure, [[
      { time: 1, minuteEt: 570, timeEt: "09:30", price: 6000 },
      { time: 2, minuteEt: 585, timeEt: "09:45", price: 6005 },
    ]], 34, 25, 25);
    assert.deepEqual(withExpectedMove.expectedMoveRange && {
      value: withExpectedMove.expectedMoveRange.value,
      upper: withExpectedMove.expectedMoveRange.upper.price,
      lower: withExpectedMove.expectedMoveRange.lower.price,
    }, { value: 25, upper: 6030, lower: 5980 });
    assert.equal(buildSpxGexPressureChartGeometry(pressure, [], 34, 25, 25).expectedMoveRange, null);
  });

  it("uses 15-minute fallback segments without drawing across a missing GEX slot", () => {
    const pressure = buildSpxGexPressureMatrix([
      buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, baselineValues),
      buildPressureSnapshot("2026-05-27T14:15:00.000Z", 6010, currentValues),
    ]);
    const geometry = buildSpxGexPressureChartGeometry(pressure, [], 34, 25);

    assert.equal(geometry.resolution, "15m-fallback");
    assert.deepEqual(geometry.segments.map((segment) => segment.map((point) => point.timeEt)), [["09:30"], ["10:00"]]);
  });

  it("places desktop tooltips above when possible and below near the viewport top", () => {
    assert.deepEqual(getSpxGexPressureTooltipPosition({
      anchor: { left: 790, top: 400, width: 34, height: 25 },
      viewport: { width: 800, height: 600 },
      tooltip: { width: 320, height: 150 },
    }), { left: 472, top: 240, placement: "top" });
    assert.deepEqual(getSpxGexPressureTooltipPosition({
      anchor: { left: 2, top: 5, width: 34, height: 25 },
      viewport: { width: 800, height: 600 },
      tooltip: { width: 320, height: 150 },
    }), { left: 8, top: 40, placement: "bottom" });
  });

  it("clamps the shared GEX tooltip on every viewport edge and caps long content", () => {
    assert.deepEqual(getSpxGexTooltipPosition({
      anchor: { left: 790, top: 400, width: 34, height: 25 },
      viewport: { width: 800, height: 600 },
      tooltip: { width: 380, estimatedHeight: 520 },
    }), { left: 412, top: 72, placement: "bottom", width: 380, maxHeight: 584 });
    assert.deepEqual(getSpxGexTooltipPosition({
      anchor: { left: -20, top: 5, width: 34, height: 25 },
      viewport: { width: 320, height: 240 },
      tooltip: { width: 380, estimatedHeight: 520 },
    }), { left: 8, top: 8, placement: "bottom", width: 304, maxHeight: 224 });
  });
});

describe("SPX GEX pressure API", () => {
  class CountingD1 extends MemoryD1 {
    pressureProjectionQueries = 0;
    fullSnapshotListQueries = 0;

    override prepare(query: string) {
      if (query.includes("SPX_GEX_PRESSURE_PROJECTION")) this.pressureProjectionQueries += 1;
      if (query.includes("SELECT * FROM spx_gex_intraday_snapshots")
        && query.includes("WHERE trading_date = ?")
        && !query.includes("snapshot_minute_et = ?")) {
        this.fullSnapshotListQueries += 1;
      }
      return super.prepare(query);
    }
  }

  it("returns one compact READY response from one whole-day snapshot query", async () => {
    const db = new CountingD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 5995: -100, 6000: 100 }));
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, { 5995: -200, 6000: 150 }));

    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const text = await response.text();
    const payload = JSON.parse(text) as { status: string; pressure: { timeline: unknown[]; movers: unknown[] } };

    assert.equal(response.status, 200, text);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.equal(payload.status, "READY");
    assert.equal(payload.pressure.timeline.length, 2);
    assert.equal(payload.pressure.movers.length > 0, true);
    assert.equal(db.pressureProjectionQueries, 1);
    assert.equal(db.fullSnapshotListQueries, 0);
    assert.equal(response.headers.get("x-spx-frame-count"), "2");
    assert.equal(Number(response.headers.get("x-spx-projection-bytes")) < 150_000, true);
    assert.equal(text.includes("snapshot_json"), false);
  });

  it("returns explicit EMPTY for an unavailable requested date", async () => {
    const db = new CountingD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 5995: -100, 6000: 100 }));
    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-26"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = await response.json() as { status: string; errorCode: string; selectedDate: string; pressure: unknown };
    assert.equal(response.status, 200);
    assert.equal(payload.status, "EMPTY");
    assert.equal(payload.errorCode, "SPX_GEX_PRESSURE_DATE_UNAVAILABLE");
    assert.equal(payload.selectedDate, "2026-05-26");
    assert.equal(payload.pressure, null);
    assert.equal(db.pressureProjectionQueries, 0);
  });

  it("keeps a 27-frame pressure projection below 150 KB without returning the 16 MB source payload", async () => {
    const db = new CountingD1();
    for (let index = 0; index < 27; index += 1) {
      const generatedAt = new Date(Date.parse("2026-05-27T13:45:00.000Z") + index * 15 * 60_000).toISOString();
      await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot(generatedAt, 6000 + index, {
        5995: -100 - index,
        6000: 100 + index,
      }));
      const minute = 570 + index * 15;
      const row = db.intraday.get(`2026-05-27:${minute}`);
      assert.ok(row);
      const source = JSON.parse(String(row.snapshot_json)) as SpxGexHeatmapModel & { unusedSourcePadding?: string };
      source.unusedSourcePadding = "x".repeat(590_000);
      row.snapshot_json = JSON.stringify(source);
    }
    const sourceBytes = [...db.intraday.values()]
      .reduce((total, row) => total + new TextEncoder().encode(String(row.snapshot_json)).byteLength, 0);

    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const text = await response.text();

    assert.equal(response.status, 200, text);
    assert.equal(sourceBytes > 15_000_000, true);
    assert.equal(response.headers.get("x-spx-frame-count"), "27");
    assert.equal(Number(response.headers.get("x-spx-projection-bytes")) < 150_000, true);
    assert.equal(text.includes("unusedSourcePadding"), false);
    assert.equal(db.fullSnapshotListQueries, 0);
  });

  it("keeps compact pressure frames independent from later full-snapshot mutations", async () => {
    const db = new CountingD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 6000: 100 }));
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, { 6000: 150 }));
    const invalidRow = db.intraday.get("2026-05-27:570");
    assert.ok(invalidRow);
    const invalidSnapshot = JSON.parse(String(invalidRow.snapshot_json)) as SpxGexHeatmapModel;
    invalidSnapshot.cells = invalidSnapshot.cells.map((cell) => ({
      ...cell,
      netGex: null,
      callIv: null,
      putIv: null,
      gammaIv: null,
    }));
    invalidRow.snapshot_json = JSON.stringify(invalidSnapshot);

    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = await response.json() as {
      status: string;
      pressure: { baseline: { snapshotMinuteEt: number }; timeline: Array<{ snapshotMinuteEt: number; status: string }> };
      invalidSnapshots: Array<{ snapshotMinuteEt: number; reasonCode: string }>;
      warnings: string[];
    };

    assert.equal(response.status, 200);
    assert.equal(payload.status, "READY");
    assert.equal(payload.pressure.baseline.snapshotMinuteEt, 570);
    assert.equal(payload.pressure.timeline.find((slot) => slot.snapshotMinuteEt === 570)?.status, "READY");
    assert.deepEqual(payload.invalidSnapshots, []);
    assert.equal(payload.warnings.some((warning) => /09:30 snapshot/i.test(warning)), false);
  });

  it("reports quarantined frames as DEGRADED without exposing their payload", async () => {
    const db = new CountingD1();
    const invalid = buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 6000: 100 });
    invalid.cells = invalid.cells.map((cell) => ({ ...cell, netGex: null, callIv: null, putIv: null, gammaIv: null }));
    await assert.rejects(() => upsertSpxGexHeatmap(db, "2026-05-27", invalid), /NO_AUDITED_BLENDED_IV_CELLS/);
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T14:00:00.000Z", 6005, { 6000: 150 }));

    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const text = await response.text();
    const payload = JSON.parse(text) as { status: string; invalidSnapshots: Array<{ snapshotMinuteEt: number; reasonCode: string }> };

    assert.equal(response.status, 200, text);
    assert.equal(payload.status, "DEGRADED");
    assert.deepEqual(payload.invalidSnapshots, [{
      snapshotMinuteEt: 570,
      snapshotTimeEt: "09:30",
      reasonCode: "NO_AUDITED_BLENDED_IV_CELLS",
    }]);
    assert.equal(text.includes("snapshot_json"), false);
  });

  it("treats a contract-valid opening retry as READY even when earlier attempts remain quarantined for audit", async () => {
    const db = new CountingD1();
    const invalid = buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 6000: 100 });
    invalid.cells = invalid.cells.map((cell) => ({ ...cell, netGex: null, callIv: null, putIv: null, gammaIv: null }));
    await assert.rejects(() => upsertSpxGexHeatmap(db, "2026-05-27", invalid), /NO_AUDITED_BLENDED_IV_CELLS/);
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6001, { 6000: 120 }));

    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = await response.json() as { status: string; invalidSnapshots: unknown[]; warnings: string[] };

    assert.equal(response.status, 200);
    assert.equal(payload.status, "READY");
    assert.deepEqual(payload.invalidSnapshots, []);
    assert.equal(payload.warnings.some((warning) => /09:30 snapshot/i.test(warning)), false);
  });

  it("fails explicitly when a date has quarantined frames but no valid pressure snapshot", async () => {
    const db = new CountingD1();
    const invalid = buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 6000: 100 });
    invalid.cells = invalid.cells.map((cell) => ({ ...cell, netGex: null, callIv: null, putIv: null, gammaIv: null }));
    await assert.rejects(() => upsertSpxGexHeatmap(db, "2026-05-27", invalid), /NO_AUDITED_BLENDED_IV_CELLS/);

    const response = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    const payload = await response.json() as { status: string; errorCode: string; invalidSnapshots: unknown[] };

    assert.equal(response.status, 500);
    assert.equal(payload.status, "ERROR");
    assert.equal(payload.errorCode, "SPX_GEX_PRESSURE_NO_VALID_SNAPSHOTS");
    assert.equal(payload.invalidSnapshots.length, 1);
  });

  it("returns explicit binding, storage, and malformed-snapshot failures", async () => {
    const binding = await getSpxGexPressureApi({ request: new Request("https://example.com/api/spx-gex-pressure"), env: {} });
    assert.equal(binding.status, 503);
    assert.equal(((await binding.json()) as { status: string }).status, "BINDING_MISSING");

    const storage = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure"),
      env: { SPX_RECAP_DB: { prepare: () => { throw new Error("no such table: spx_gex_intraday_snapshots"); } } as any },
    });
    assert.equal(storage.status, 503);
    assert.equal(((await storage.json()) as { status: string }).status, "STORAGE_UNAVAILABLE");

    const db = new MemoryD1();
    await upsertSpxGexHeatmap(db, "2026-05-27", buildPressureSnapshot("2026-05-27T13:45:00.000Z", 6000, { 6000: 100 }));
    const projection = db.pressureProjections.get("2026-05-27:570");
    assert.ok(projection);
    projection.gex_json = "{";
    const malformed = await getSpxGexPressureApi({
      request: new Request("https://example.com/api/spx-gex-pressure?date=2026-05-27"),
      env: { SPX_RECAP_DB: db },
    });
    assert.equal(malformed.status, 500);
    const malformedPayload = (await malformed.json()) as { status: string; errorCode: string; invalidSnapshots: Array<{ reasonCode: string }> };
    assert.equal(malformedPayload.status, "ERROR");
    assert.equal(malformedPayload.errorCode, "SPX_GEX_PRESSURE_BUILD_FAILED");
    assert.deepEqual(malformedPayload.invalidSnapshots, []);
  });
});
