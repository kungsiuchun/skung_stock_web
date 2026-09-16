import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet } from "../functions/api/stocks-watcher-macro";
import {
  buildStocksWatcherMacroSnapshot,
  MACRO_FRED_SERIES_IDS,
  MACRO_INFLATION_SERIES_IDS,
  MACRO_MARKET_DEFINITIONS,
  parseFredObservations,
  StocksWatcherMacroError,
  type MacroObservation,
} from "../src/lib/stocks-watcher-macro";

const monthlyObservations = (startYear = 2024, startMonth = 1, count = 31, base = 100): MacroObservation[] =>
  Array.from({ length: count }, (_, index) => {
    const monthIndex = startMonth - 1 + index;
    const year = startYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return { date: `${year}-${String(month).padStart(2, "0")}-01`, value: base + index };
  });

const dailyObservations = (base = 100): MacroObservation[] => [
  { date: "2025-12-31", value: base },
  { date: "2026-04-08", value: base + 5 },
  { date: "2026-06-08", value: base + 10 },
  { date: "2026-07-01", value: base + 12 },
  { date: "2026-07-08", value: base + 15 },
  { date: "2026-07-09", value: base + 16 },
];

const fixtureSeries = () => {
  const entries = MACRO_FRED_SERIES_IDS.map((seriesId, index) => {
    const marketDefinition = MACRO_MARKET_DEFINITIONS.find((definition) => definition.seriesId === seriesId);
    const observations = marketDefinition?.frequency === "daily"
      ? dailyObservations(100 + index * 10)
      : monthlyObservations(2024, 1, 31, 100 + index * 10);
    return [seriesId, observations] as const;
  });
  const result = Object.fromEntries(entries) as Record<string, MacroObservation[]>;
  for (const [index, seriesId] of MACRO_INFLATION_SERIES_IDS.entries()) {
    result[seriesId] = monthlyObservations(2024, 1, 31, 100 + index * 20);
  }
  return result;
};

test("builds honest mixed-frequency market returns and twelve aligned inflation releases", () => {
  const snapshot = buildStocksWatcherMacroSnapshot(fixtureSeries(), "2026-08-26T14:00:00.000Z");

  assert.equal(snapshot.markets.rows.length, 9);
  assert.equal(snapshot.inflation.months.length, 12);
  assert.deepEqual(snapshot.inflation.months.slice(0, 2), ["2025-08", "2025-09"]);
  assert.equal(snapshot.inflation.months.at(-1), "2026-07");
  assert.equal(snapshot.inflation.rows.length, 7);

  const wti = snapshot.markets.rows.find((row) => row.id === "wti");
  assert.ok(wti);
  assert.equal(wti.frequency, "daily");
  assert.ok(wti.changes.oneDay !== null);
  assert.ok(wti.changes.oneWeek !== null);

  const copper = snapshot.markets.rows.find((row) => row.id === "copper");
  assert.ok(copper);
  assert.equal(copper.frequency, "monthly");
  assert.equal(copper.changes.oneDay, null);
  assert.equal(copper.changes.oneWeek, null);
  assert.ok(copper.changes.oneMonth !== null);

  const headline = snapshot.inflation.rows.find((row) => row.id === "headline-pce");
  assert.ok(headline);
  assert.equal(headline.values.length, 12);
  assert.ok(headline.values.every((value) => typeof value === "number"));
  assert.equal(snapshot.source.series.length, MACRO_FRED_SERIES_IDS.length);
});

test("clamps month-end comparison dates instead of overflowing into the next month", () => {
  const fixtures = fixtureSeries();
  fixtures.DCOILWTICO = [
    { date: "2025-12-31", value: 90 },
    { date: "2026-02-28", value: 100 },
    { date: "2026-03-03", value: 120 },
    { date: "2026-03-30", value: 130 },
    { date: "2026-03-31", value: 132 },
  ];
  const snapshot = buildStocksWatcherMacroSnapshot(fixtures, "2026-04-01T00:00:00.000Z");
  const wti = snapshot.markets.rows.find((row) => row.id === "wti");
  assert.ok(wti);
  assert.ok(Math.abs((wti.changes.oneMonth ?? Number.NaN) - 32) < 1e-9);
});

test("rejects malformed or empty FRED observation payloads instead of inventing data", () => {
  assert.throws(() => parseFredObservations({}, "PCEPI"), StocksWatcherMacroError);
  assert.throws(() => parseFredObservations({ observations: [{ date: "2026-07-01", value: "." }] }, "PCEPI"), StocksWatcherMacroError);
  assert.throws(() => parseFredObservations({ observations: [{ date: "2026-07-01", value: null }] }, "PCEPI"), StocksWatcherMacroError);
  assert.throws(() => parseFredObservations({ observations: [{ date: "2026-07-01", value: "" }] }, "PCEPI"), StocksWatcherMacroError);
  assert.deepEqual(parseFredObservations({ observations: [
    { date: "2026-07-02", value: "2.5" },
    { date: "bad-date", value: "9" },
    { date: "2026-07-01", value: "2.4" },
  ] }, "PCEPI"), [
    { date: "2026-07-01", value: 2.4 },
    { date: "2026-07-02", value: 2.5 },
  ]);
});

test("Macro API fails closed when the server-side FRED key is missing", async () => {
  const response = await onRequestGet({
    request: new Request("https://example.com/api/stocks-watcher-macro"),
    env: {},
  });
  const payload = await response.json() as { errorCode: string; error: string };
  assert.equal(response.status, 503);
  assert.equal(payload.errorCode, "FRED_KEY_MISSING");
  assert.match(payload.error, /FRED_API_KEY/);
});

test("Macro API fetches each declared FRED series server-side and returns source-labelled data", async () => {
  const originalFetch = globalThis.fetch;
  const fixtures = fixtureSeries();
  const requestedSeries: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const seriesId = url.searchParams.get("series_id") || "";
    assert.equal(url.searchParams.get("sort_order"), "desc");
    requestedSeries.push(seriesId);
    return new Response(JSON.stringify({ observations: fixtures[seriesId].map((entry) => ({
      date: entry.date,
      value: String(entry.value),
    })) }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const response = await onRequestGet({
      request: new Request("https://example.com/api/stocks-watcher-macro"),
      env: { FRED_API_KEY: "test-key" },
    });
    const payload = await response.json() as { data: { markets: { rows: unknown[] }; inflation: { months: string[] }; source: { provider: string } }; cache: { status: string } };
    assert.equal(response.status, 200);
    assert.deepEqual([...requestedSeries].sort(), [...MACRO_FRED_SERIES_IDS].sort());
    assert.equal(payload.data.markets.rows.length, 9);
    assert.equal(payload.data.inflation.months.length, 12);
    assert.equal(payload.data.source.provider, "Federal Reserve Economic Data (FRED)");
    assert.equal(payload.cache.status, "bypassed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
