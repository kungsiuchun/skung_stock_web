import assert from "node:assert/strict";
import test from "node:test";
import type { FomcRateProbabilityResponse } from "../src/lib/fomc-rate-probability";
import type { MarketCacheMetadata } from "../src/lib/market-data-cache";
import { SafeJsonResponseError } from "../src/lib/safe-json-response";
import {
  MACRO_FRED_SERIES_IDS,
  MACRO_MARKET_DEFINITIONS,
  type StocksWatcherMacroSnapshot,
} from "../src/lib/stocks-watcher-macro";
import { buildTreasuryYieldCurveResponse, type TreasuryYieldCurveResponse } from "../src/lib/treasury-yield-curve";
import { loadStocksWatcherFomc, loadStocksWatcherMacro, loadStocksWatcherTreasury } from "../src/components/stocks-watcher-panel-loaders";

const response = (body: string, status = 200, contentType = "application/json") =>
  new Response(body, { status, headers: { "content-type": contentType } });

const fetchResponse = (factory: () => Response): typeof fetch =>
  (async () => factory()) as unknown as typeof fetch;

const macroMonths = [
  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
  "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
];

const macroInflationRows = [
  ["headline-pce", "Headline PCE", "YoY %", "PCEPI", 2.7],
  ["core-pce", "Core PCE · ex food & energy", "YoY %", "PCEPILFE", 2.9],
  ["trimmed-pce-1m", "Trimmed Mean PCE · 1M annualized", "Ann. %", "PCETRIM1M158SFRBDAL", 2.2],
  ["trimmed-pce-6m", "Trimmed Mean PCE · 6M annualized", "Ann. %", "PCETRIM6M680SFRBDAL", 2.35],
  ["trimmed-pce-12m", "Trimmed Mean PCE · 12M", "YoY %", "PCETRIM12M159SFRBDAL", 2.28],
  ["personal-income", "Personal Income", "MoM %", "PI", 0.43],
  ["personal-spending", "Personal Spending", "MoM %", "PCE", 0.16],
] as const;

const macroData: StocksWatcherMacroSnapshot = {
  generatedAt: "2026-10-18T00:00:00.000Z",
  asOf: "2026-10-17",
  markets: {
    asOf: "2026-10-17",
    rows: MACRO_MARKET_DEFINITIONS.map((definition, index) => ({
      ...definition,
      value: 90 + index * 2.5,
      asOf: definition.frequency === "daily" ? "2026-10-17" : "2026-09-01",
      changes: { oneDay: 0.4 + index / 10, oneWeek: index === 0 ? null : 1.2 - index / 10, oneMonth: 2.1 + index / 10, threeMonth: index === 1 ? null : -1.4 + index / 5, yearToDate: 8.2 - index / 3 },
    })),
  },
  inflation: {
    asOf: "2026-09-01",
    months: macroMonths,
    rows: macroInflationRows.map(([id, label, unit, seriesId, base], rowIndex) => ({
      id,
      label,
      unit,
      seriesIds: [seriesId],
      values: macroMonths.map((_, index) => rowIndex === 0 && index === 0 ? null : Number((base + Math.sin(index + rowIndex) * 0.35).toFixed(2))),
    })),
  },
  source: {
    provider: "Federal Reserve Economic Data (FRED)",
    url: "https://fred.stlouisfed.org/",
    termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
    series: MACRO_FRED_SERIES_IDS.map((id) => ({ id, url: `https://fred.stlouisfed.org/series/${id}` })),
    note: "Daily EIA/Federal Reserve and monthly IMF/BEA/Dallas Fed series retrieved through FRED. Values may be revised.",
  },
};

const macroCache: MarketCacheMetadata = {
  status: "refreshed",
  dataset: "history",
  cachedAt: "2026-10-18T00:00:00.000Z",
  expiresAt: "2026-10-18T01:00:00.000Z",
  ageSeconds: 0,
  ttlMs: 3_600_000,
  ageRatio: 0,
  guard: "fresh",
  rowRead: true,
  rowWritten: true,
  observability: { rowRead: "hit", rowWritten: "written" },
  rowsRead: 1,
  rowsWritten: 1,
  sourceAsOf: "2026-10-17",
};

const treasuryMaturities = [
  ["1M", 1 / 12], ["1.5M", 1.5 / 12], ["2M", 2 / 12], ["3M", 3 / 12],
  ["4M", 4 / 12], ["6M", 6 / 12], ["1Y", 1], ["2Y", 2], ["3Y", 3],
  ["5Y", 5], ["7Y", 7], ["10Y", 10], ["20Y", 20], ["30Y", 30],
] as const;

const treasuryCurveContracts = [
  ["latest", "Latest published", "2026-10-17", [4.2, 4.17, 4.15, 4.1, 4.08, 4.05, 4.02, 3.9, 3.95, 4, 4.05, 4.1, 4.25, 4.5]],
  ["oneWeek", "1 week ago", "2026-10-10", [4.18, 4.15, 4.13, 4.08, 4.06, 4.03, 4, 3.86, 3.91, 3.96, 4.01, 4.05, 4.2, 4.46]],
  ["oneMonth", "1 month ago", "2026-09-17", [4.11, 4.08, 4.06, 4.01, 3.99, 3.96, 3.93, 3.8, 3.85, 3.92, 3.97, 4.02, 4.17, 4.43]],
  ["startOfYear", "Start of year", "2026-01-02", [4.3, 4.27, 4.25, 4.2, 4.18, 4.15, 4.12, 4.02, 4.07, 4.12, 4.17, 4.2, 4.37, 4.62]],
] as const;

const treasuryPoints = (values: readonly number[]) =>
  treasuryMaturities.map(([maturity, years], index) => ({ maturity, label: maturity, years, yield: values[index] }));

const treasuryData: TreasuryYieldCurveResponse = {
  asOfDate: "2026-10-17",
  sourceUrl: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?_format=csv&page=&type=daily_treasury_yield_curve",
  curves: treasuryCurveContracts.map(([key, label, date, values]) => ({ key, label, date, points: treasuryPoints(values) })),
  yieldRows: treasuryMaturities.map(([maturity], index) => ({
    maturity,
    yield: treasuryCurveContracts[0][3][index],
    oneDayBps: 1 + index / 10,
    oneWeekBps: 2 + index / 10,
    oneMonthBps: 3 + index / 10,
    yearToDateBps: -4 + index / 10,
  })),
  spreadRows: [
    { label: "10Y - 2Y", valueBps: 20, oneDayBps: 1, oneWeekBps: 1, oneMonthBps: -2, yearToDateBps: 2 },
    { label: "10Y - 3M", valueBps: 0, oneDayBps: 2, oneWeekBps: 2, oneMonthBps: -1, yearToDateBps: 3 },
  ],
  source: {
    provider: "U.S. Department of the Treasury",
    label: "Daily Treasury Par Yield Curve Rates",
    url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?_format=csv&page=&type=daily_treasury_yield_curve",
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
    outcomes: [
      { key: "cut", label: "Cut", probability: 10 },
      { key: "hold", label: "Hold", probability: 60 },
      { key: "hike", label: "Hike", probability: 30 },
    ],
    noHikeProbability: 70,
    volume: 12345,
  },
  source: {
    provider: "Polymarket",
    label: "Fed decision prediction markets",
    type: "prediction-market implied",
    url: "https://polymarket.com/",
    fetchedAt: "2026-10-18T00:00:00.000Z",
  },
};

test("Macro loader enforces complete provider payloads and preserves stale responses", async () => {
  const valid = await loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: macroData, cache: macroCache }))));
  assert.equal(valid.data.asOf, macroData.asOf);
  const withoutCache = await loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: macroData }))));
  assert.equal(withoutCache.cache, undefined);

  const stale = await loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: macroData, cache: { ...macroCache, status: "stale", guard: "stale", refreshError: "FRED refresh timed out." } }), 206)));
  assert.equal(stale.cache?.status, "stale");

  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: macroData, cache: { status: "stale" } })))),
    /Macro API returned invalid data: cache\.cachedAt/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: { ...macroData, markets: { ...macroData.markets, rows: [macroData.markets.rows[1], ...macroData.markets.rows.slice(1)] } }, cache: macroCache })))),
    /Macro API returned invalid data: data\.markets\.rows\[0\]\.id/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: { ...macroData, markets: { ...macroData.markets, rows: macroData.markets.rows.slice(0, -1) } }, cache: macroCache })))),
    /Macro API returned invalid data: data\.markets\.rows/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: { ...macroData, generatedAt: "2026-02-30T00:00:00.000Z" }, cache: macroCache })))),
    /Macro API returned invalid data: data\.generatedAt/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: { ...macroData, inflation: { ...macroData.inflation, rows: macroData.inflation.rows.slice(0, -1) } }, cache: macroCache })))),
    /Macro API returned invalid data: data\.inflation\.rows/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response("{}"))),
    /Macro API response did not include data/,
  );
  await assert.rejects(
    () => loadStocksWatcherMacro(fetchResponse(() => response(JSON.stringify({ data: {}, cache: macroCache })))),
    /Macro API returned invalid data: data\.generatedAt/,
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

test("Fixed Income loaders enforce complete Treasury and FOMC provider contracts", async () => {
  const januaryCsv = [
    "Date,1 Mo,1.5 Mo,2 Mo,3 Mo,4 Mo,6 Mo,1 Yr,2 Yr,3 Yr,5 Yr,7 Yr,10 Yr,20 Yr,30 Yr",
    ...["12/30/2025", "01/02/2026", "01/23/2026", "01/29/2026", "01/30/2026"].map((date, day) =>
      [date, ...Array.from({ length: 14 }, (_, index) => (3.5 + day / 10 + index / 100).toFixed(2))].join(",")),
  ].join("\n");
  const januaryData = buildTreasuryYieldCurveResponse(januaryCsv, "2026-01-30T22:00:00.000Z");
  const january = await loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify(januaryData))));
  assert.ok(january.curves[3].date > january.curves[2].date, "start-of-year may follow the one-month baseline in January");
  const treasury = await loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify(treasuryData))));
  assert.equal(treasury.asOfDate, treasuryData.asOfDate);
  const staleTreasury = await loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify(treasuryData), 206)));
  assert.equal(staleTreasury.curves.length, 4);

  await assert.rejects(
    () => loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify({ ...treasuryData, curves: [treasuryData.curves[0], treasuryData.curves[0], ...treasuryData.curves.slice(2)] })))),
    /Fixed Income API returned invalid data: curves\[1\]\.key/,
  );
  await assert.rejects(
    () => loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify({ ...treasuryData, curves: [{ ...treasuryData.curves[0], points: [...treasuryData.curves[0].points].reverse() }, ...treasuryData.curves.slice(1)] })))),
    /Fixed Income API returned invalid data: curves\[0\]\.points\[0\]\.maturity/,
  );
  await assert.rejects(
    () => loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify({ ...treasuryData, yieldRows: treasuryData.yieldRows.slice(0, -1) })))),
    /Fixed Income API returned invalid data: yieldRows/,
  );
  await assert.rejects(
    () => loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify({ ...treasuryData, source: { ...treasuryData.source, fetchedAt: "2026-02-30T00:00:00.000Z" } })))),
    /Fixed Income API returned invalid data: source\.fetchedAt/,
  );
  await assert.rejects(
    () => loadStocksWatcherTreasury(fetchResponse(() => response(JSON.stringify({})))),
    /Fixed Income API returned invalid data: asOfDate/,
  );

  const fomc = await loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify(fomcData))));
  assert.equal(fomc.meeting.eventSlug, fomcData.meeting.eventSlug);
  const staleFomc = await loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify(fomcData), 206)));
  assert.equal(staleFomc.meeting.outcomes.length, 3);
  for (const observedAt of ["2026-10-19T06:33:13.576075Z", "2026-10-19T06:33:13.576075123Z"]) {
    const precise = await loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify({ ...fomcData, meeting: { ...fomcData.meeting, observedAt } }))));
    assert.equal(precise.meeting.observedAt, observedAt, "provider sub-millisecond timestamps must remain valid and unchanged");
  }
  await assert.rejects(
    () => loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify({ ...fomcData, meeting: { ...fomcData.meeting, rawProbabilityTotal: 0 } })))),
    /FOMC probability API returned invalid data: meeting\.rawProbabilityTotal/,
  );
  await assert.rejects(
    () => loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify({ ...fomcData, meeting: { ...fomcData.meeting, noHikeProbability: 71 } })))),
    /FOMC probability API returned invalid data: meeting\.noHikeProbability/,
  );
  await assert.rejects(
    () => loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify({ ...fomcData, meeting: { ...fomcData.meeting, outcomes: [{ ...fomcData.meeting.outcomes[0], probability: 1 }, ...fomcData.meeting.outcomes.slice(1)] } })))),
    /FOMC probability API returned invalid data: meeting\.outcomes/,
  );
  await assert.rejects(
    () => loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify({ ...fomcData, meeting: { ...fomcData.meeting, observedAt: "2026-10-18T25:00:00Z" } })))),
    /FOMC probability API returned invalid data: meeting\.observedAt/,
  );
  await assert.rejects(
    () => loadStocksWatcherFomc(fetchResponse(() => response(JSON.stringify({})))),
    /FOMC probability API returned invalid data: meeting/,
  );

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
