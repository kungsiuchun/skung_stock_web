import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NT_VOLATILITY_RISK_PROMPT } from "../src/lib/spx-decision-pipeline";

const workerSource = readFileSync(new URL("../scripts/worker-spx-bot.ts", import.meta.url), "utf8");
const promptsSource = readFileSync(new URL("../scripts/prompts.ts", import.meta.url), "utf8");
const mojibakeMarkers = new RegExp(`[${[0xc3, 0xc2, 0xe2, 0xf0, 0x178].map((code) => String.fromCharCode(code)).join("")}]`);

test("Telegram trading run does not fetch low-ROI ETF fund-flow charts", () => {
  for (const symbol of ["SPY", "IWM", "XLK", "XLV"]) {
    assert.equal(
      workerSource.includes(`fetchYahooChart('${symbol}'`),
      false,
      `unexpected Yahoo fetch for ${symbol}`,
    );
  }
});

test("Telegram trading run does not fetch fake VIX 3-month context from ^VIX daily data", () => {
  assert.equal(workerSource.includes("VIX 3m chart"), false);
  assert.equal(workerSource.includes("vixQuotes3mo"), false);
  assert.equal(workerSource.includes("currentVix3m = vixQuotes3mo"), false);
});

test("market data quality call uses fetched SPX structure variables", () => {
  assert.equal(workerSource.includes("spxD1Quotes,"), false);
  assert.equal(workerSource.includes("spxH1Quotes,"), false);
  assert.match(workerSource, /spxD1Quotes:\s*spxQuotesD1/);
  assert.match(workerSource, /spxH1Quotes:\s*spxQuotesH1/);
});

test("NT sentiment persona does not require removed ETF flow or fake VIX3M inputs", () => {
  assert.equal(/ETF|SPY|IWM|XLK|XLV|XLY|XLI|XLP|XLU/.test(NT_VOLATILITY_RISK_PROMPT), false);
  assert.equal(/3m|3-month|VIX3M/i.test(NT_VOLATILITY_RISK_PROMPT), false);
});

test("SPX bot prompt sources stay ASCII-safe and free of mojibake markers", () => {
  assert.equal(mojibakeMarkers.test(promptsSource), false);
});

test("SPX Worker contains no post-CIO trend-day directional override", () => {
  assert.equal(workerSource.includes("trend_day_override"), false);
  assert.equal(workerSource.includes("單邊上升日 override"), false);
  assert.equal(workerSource.includes("單邊下跌日 override"), false);
});

test("SPX Worker persists normalized replay context without claiming raw source payloads", () => {
  assert.match(workerSource, /marketSnapshot\.normalizedContext\s*=\s*extendedContext/);
  assert.match(workerSource, /replayGrade:\s*canonicalGex\s*\?\s*'NORMALIZED_CANONICAL'\s*:\s*'PARTIAL_NORMALIZED'/);
  for (const series of ["spx15m", "spx5m", "spxD1", "spxH1", "vix15m", "vix9d"]) {
    assert.match(workerSource, new RegExp(`${series}:\\s*normalizeReplaySeries`));
  }
  assert.match(workerSource, /snapshotId:\s*canonicalGex\.snapshotId/);
  assert.match(workerSource, /payloadHash:\s*canonicalGex\.payloadHash/);
  assert.equal(workerSource.includes("rawSnapshotAvailable: true"), false);
  assert.match(workerSource, /vendorRawPayloadsPersisted:\s*marketSnapshot\.rawSnapshotAvailable/);
  assert.equal(workerSource.includes("rawSourcePayloadsPersisted:"), false);
});

test("Telegram GEX section is wired from the canonical Board summary", () => {
  assert.match(workerSource, /const calculatedGex = canonicalGexSnapshot\.calculatedGex/);
  assert.match(workerSource, /gexSummary:\s*calculatedGex/);
  assert.match(workerSource, /isUsableCanonicalSpxGexHeatmap/);
  assert.match(workerSource, /canonicalGexSnapshot\.status !== 'READY'/);
  assert.match(workerSource, /loadCanonicalSpxGexForTelegram\(env, now, \{ allowGeneration: false \}\)/);
});

test("scheduled market work is supervised by one tick with stale-run recovery", () => {
  assert.match(workerSource, /runSupervisedSpxMarketTick/);
  assert.match(workerSource, /recoverStaleTradingRuns/);
  assert.match(workerSource, /runSpxGexHeatmapGeneration\(env, now\)[\s\S]*?runTradingAgents\(env, now\)/);
  assert.equal(workerSource.includes("const TRADING_CRON"), false);
});

test("manual and debug Worker triggers are preview-only unless delivery is explicit", () => {
  assert.match(
    workerSource,
    /resolveSpxDeliveryMode\(\{\s*trigger:\s*'MANUAL',\s*debugPreview:\s*true\s*\}\)/,
  );
  assert.match(
    workerSource,
    /explicitDelivery:\s*url\.searchParams\.has\('deliver'\)/,
  );
  assert.match(
    workerSource,
    /deliveryMode === 'SEND'[\s\S]*?await retryDueDecisionOutbox\(env, now\)/,
  );
  assert.match(workerSource, /Telegram enqueue\/send suppressed/);
});
