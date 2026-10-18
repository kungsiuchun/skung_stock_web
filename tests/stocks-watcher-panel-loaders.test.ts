import assert from "node:assert/strict";
import test from "node:test";
import type { FomcRateProbabilityResponse } from "../src/lib/fomc-rate-probability";
import { SafeJsonResponseError } from "../src/lib/safe-json-response";
import type { StocksWatcherMacroSnapshot } from "../src/lib/stocks-watcher-macro";
import type { TreasuryYieldCurveResponse } from "../src/lib/treasury-yield-curve";
import { loadStocksWatcherFomc, loadStocksWatcherMacro, loadStocksWatcherTreasury } from "../src/components/stocks-watcher-panel-loaders";

const response = (body: string, status = 200, contentType = "application/json") =>
  new Response(body, { status, headers: { "content-type": contentType } });

const fetchResponse = (factory: () => Response): typeof fetch =>
  (async () => factory()) as unknown as typeof fetch;

const macroData: StocksWatcherMacroSnapshot = {
  generatedAt: "2026-10-18T00:00:00.000Z",
  asOf: "2026-10-17",
  markets: { asOf: "2026-10-17", rows: [] },
  inflation: { asOf: "2026-09-01", months: [], rows: [] },
  source: {
    provider: "Federal Reserve Economic Data (FRED)",
    url: "https://fred.stlouisfed.org/",
    termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
    series: [],
    note: "Official FRED data.",
  },
};

const treasuryData: TreasuryYieldCurveResponse = {
  asOfDate: "2026-10-17",
  sourceUrl: "https://home.treasury.gov/",
  curves: [],
  yieldRows: [],
  spreadRows: [],
  source: {
    provider: "U.S. Department of the Treasury",
    label: "Daily Treasury Par Yield Curve Rates",
    url: "https://home.treasury.gov/",
    fetchedAt: "2026-10-18T00:00:00.000Z",
  },
};

const fomcData: FomcRateProbabilityResponse = {
  meeting: {
    eventSlug: "fed-decision",
    title: "Fed Decision in October?",
    date: "2026-10-28",
    closesAt: "2026-10-28T18:00:00.000Z",
    observedAt: "2026-10-18T00:00:00.000Z",
    rawProbabilityTotal: 1,
    outcomes: [],
    noHikeProbability: 0,
    volume: 0,
  },
  source: {
    provider: "Polymarket",
    label: "Fed decision prediction markets",
    type: "prediction-market implied",
    url: "https://polymarket.com/",
    fetchedAt: "2026-10-18T00:00:00.000Z",
  },
};

test("Macro loader preserves valid and stale responses while rejecting invalid payloads", async () => {
  const valid = await loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: macroData }))));
  assert.equal(valid.data.asOf, macroData.asOf);

  const stale = await loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: macroData }), 206)));
  assert.equal(stale.data.generatedAt, macroData.generatedAt);

  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response("{}"))),
    /Macro API response did not include data/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(""))),
    (error: unknown) => error instanceof SafeJsonResponseError && error.message.includes("empty response"),
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response("<html>offline</html>", 502, "text/html"))),
    (error: unknown) => error instanceof SafeJsonResponseError && error.message.includes("not JSON"),
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ error: "Macro source unavailable." }), 503))),
    /Macro source unavailable/,
  );
});

test("Fixed Income loaders preserve valid, stale, and HTTP error behavior", async () => {
  const treasury = await loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify(treasuryData))));
  assert.equal(treasury.asOfDate, treasuryData.asOfDate);
  const staleTreasury = await loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify(treasuryData), 206)));
  assert.equal(staleTreasury.source.fetchedAt, treasuryData.source.fetchedAt);

  const fomc = await loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify(fomcData))));
  assert.equal(fomc.meeting.eventSlug, fomcData.meeting.eventSlug);
  const staleFomc = await loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify(fomcData), 206)));
  assert.equal(staleFomc.source.fetchedAt, fomcData.source.fetchedAt);

  for (const load of [loadStocksWatcherTreasury, loadStocksWatcherFomc]) {
    await assert.rejects(
      () => load(fetchResponse(() => response(""))),
      (error: unknown) => error instanceof SafeJsonResponseError && error.message.includes("empty response"),
    );
    await assert.rejects(
      () => load(fetchResponse(() => response("<html>offline</html>", 502, "text/html"))),
      (error: unknown) => error instanceof SafeJsonResponseError && error.message.includes("not JSON"),
    );
    await assert.rejects(
      () => load(fetchResponse(() => response(JSON.stringify({ error: "Fixed Income source unavailable." }), 503))),
      /Fixed Income source unavailable/,
    );
  }
});
