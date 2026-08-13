import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";

import {
  buildBreadthCell,
  buildMarketBreadthSnapshot,
  buildSectorUniverse,
  calculateSessionReturn,
  calculateSmaSlope,
  calculateYtdReturn,
  determineMarketBreadthFreshness,
  normalizeMarketBreadthTicker,
  proxyContributionPctPoints,
  parseStateStreetHoldingsWorkbook,
  simpleMovingAverage,
  type HoldingRow,
  type PriceBar,
} from "../src/lib/market-breadth";
import {
  MarketBreadthSourceError,
  createMarketBreadthDataClient,
  parseMassiveCustomBars,
  parseMassiveDailySummary,
} from "../src/lib/market-breadth-sources";
import {
  isNyseTradingDay,
  runMarketBreadthRefresh,
  type MarketBreadthRefreshRepository,
} from "../src/lib/market-breadth-refresh";

const bars = (values: Array<[string, number]>): PriceBar[] =>
  values.map(([date, close]) => ({ date, close }));

const risingBars = (count = 420): PriceBar[] => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.UTC(2025, 0, 2 + index));
  return { date: date.toISOString().slice(0, 10), close: 100 + index };
});

const workbook = (sheetXml: string) => zipSync({
  "[Content_Types].xml": strToU8("<Types></Types>"),
  "xl/worksheets/sheet1.xml": strToU8(sheetXml),
});

const workbookWithNamedHoldingsSheet = (coverXml: string, holdingsXml: string) => zipSync({
  "[Content_Types].xml": strToU8("<Types></Types>"),
  "xl/workbook.xml": strToU8(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cover" r:id="rId1"/><sheet name="Holdings" r:id="rId2"/></sheets></workbook>`),
  "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
  "xl/worksheets/sheet1.xml": strToU8(coverXml),
  "xl/worksheets/sheet2.xml": strToU8(holdingsXml),
});

const apiSnapshot = () => ({
  schemaVersion: 1,
  snapshotId: "market-breadth-v1-2026-08-11-test",
  generatedAt: "2026-08-11T23:30:00.000Z",
  holdingsAsOf: "2026-08-11",
  priceAsOf: "2026-08-11",
  universeCount: 503,
  sectorPerformance: { benchmark: { symbol: "SPY", oneDay: 0, oneWeek: 0, oneMonth: 0, threeMonths: 0, yearToDate: 0 }, rows: Array.from({ length: 11 }, () => ({})), proxyContribution1dPctPoints: 0, reconciliationGapPctPoints: 0 },
  breadth: { rows: Array.from({ length: 11 }, () => ({})) },
  sma200Slope: { rows: Array.from({ length: 11 }, () => ({})) },
  coverage: { currentPriceCount: 503, constituent200DayCount: 503, constituent200DayPct: 100, totalConstituents: 503, sectorEtf400DayCount: 11, totalSectorEtfs: 11 },
  sources: [{ id: "state-street" }, { id: "massive" }],
  warnings: [],
});

const productionLikeUniverse = () => {
  const sectorWeights = MARKET_TEST_SECTORS.map((sector, index) => ({
    ...sector,
    weightPct: index === MARKET_TEST_SECTORS.length - 1 ? 10 : 9,
    holdingCount: 5,
  }));
  const holdings = sectorWeights.flatMap((sector, sectorIndex) => Array.from({ length: 5 }, (_, holdingIndex) => ({
    ticker: `TEST${sectorIndex}-${holdingIndex}`,
    name: `Test ${sectorIndex}-${holdingIndex}`,
    weightPct: sector.weightPct / 5,
    sector: sector.sector,
    sectorEtf: sector.etf,
  })));
  return { holdingsAsOf: "2026-08-11", holdings, sectorWeights, universeCount: holdings.length, totalWeightPct: 100 };
};

const barsEnding = (endDate: string, count = 420): PriceBar[] => {
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
    close: 100 + index,
  }));
};

class MemoryMarketBreadthRefreshRepository implements MarketBreadthRefreshRepository {
  universe = productionLikeUniverse();
  series = new Map<string, PriceBar[]>();
  latestSnapshot = null as ReturnType<typeof buildMarketBreadthSnapshot> | null;
  published: ReturnType<typeof buildMarketBreadthSnapshot>[] = [];
  finishes: Array<{ status: string; errorClass?: string | null }> = [];
  attempts = new Map<string, Set<string>>();

  async beginRun() {}
  async finishRun(input: { status: "READY" | "SKIPPED" | "FAILED" | "PARTIAL"; errorClass?: string | null }) { this.finishes.push(input); }
  async readLatestSnapshot() { return this.latestSnapshot; }
  async readUniverse() { return this.universe; }
  async saveUniverse(universe: ReturnType<typeof productionLikeUniverse>) { this.universe = universe; }
  async readSeries(symbols: string[]) { return new Map(symbols.map((symbol) => [symbol, this.series.get(symbol) || []])); }
  async saveSeries(series: Map<string, PriceBar[]>) { for (const [symbol, rows] of series) this.series.set(symbol, rows); }
  async publish(snapshot: ReturnType<typeof buildMarketBreadthSnapshot>) { this.latestSnapshot = snapshot; this.published.push(snapshot); }
  async readBackfillAttempts(holdingsAsOf: string) { return new Set(this.attempts.get(holdingsAsOf) || []); }
  async recordBackfillAttempt(input: { backfillScope: string; symbol: string }) {
    const attempts = this.attempts.get(input.backfillScope) || new Set<string>();
    attempts.add(input.symbol);
    this.attempts.set(input.backfillScope, attempts);
  }
}

describe("S&P 500 Market Breadth calculations", () => {
  it("parses the dated State Street holdings workbook contract", () => {
    const parsed = parseStateStreetHoldingsWorkbook(workbook(`
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Holdings as of 08/11/2026</t></is></c></row>
        <row r="5">
          <c r="A5" t="inlineStr"><is><t>Name</t></is></c>
          <c r="B5" t="inlineStr"><is><t>Ticker</t></is></c>
          <c r="C5" t="inlineStr"><is><t>Identifier</t></is></c>
          <c r="D5" t="inlineStr"><is><t>SEDOL</t></is></c>
          <c r="E5" t="inlineStr"><is><t>Weight</t></is></c>
          <c r="F5" t="inlineStr"><is><t>Sector</t></is></c>
        </row>
        <row r="6">
          <c r="A6" t="inlineStr"><is><t>Berkshire Hathaway Inc. Class B</t></is></c>
          <c r="B6" t="inlineStr"><is><t>BRK.B</t></is></c>
          <c r="E6"><v>1.72</v></c>
        </row>
        <row r="7"><c r="A7" t="inlineStr"><is><t>Cash</t></is></c><c r="B7" t="inlineStr"><is><t>-</t></is></c><c r="E7"><v>0.02</v></c></row>
      </sheetData></worksheet>
    `), "SPY");

    assert.equal(parsed.fund, "SPY");
    assert.equal(parsed.holdingsAsOf, "2026-08-11");
    assert.deepEqual(parsed.holdings, [
      { ticker: "BRK-B", name: "Berkshire Hathaway Inc. Class B", weightPct: 1.72 },
    ]);
  });

  it("fails closed when the State Street workbook header changes", () => {
    assert.throws(() => parseStateStreetHoldingsWorkbook(workbook(`
      <worksheet><sheetData>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Holdings as of 08/11/2026</t></is></c></row>
        <row r="5"><c r="A5" t="inlineStr"><is><t>Security</t></is></c></row>
      </sheetData></worksheet>
    `), "SPY"), /required holdings header/i);
  });

  it("selects the named Holdings worksheet instead of assuming sheet1", () => {
    const parsed = parseStateStreetHoldingsWorkbook(workbookWithNamedHoldingsSheet(
      "<worksheet><sheetData><row><c r=\"A1\" t=\"inlineStr\"><is><t>Cover page</t></is></c></row></sheetData></worksheet>",
      `<worksheet><sheetData>
        <row><c r="A1" t="inlineStr"><is><t>Holdings as of 08/11/2026</t></is></c></row>
        <row><c r="A2" t="inlineStr"><is><t>Name</t></is></c><c r="B2" t="inlineStr"><is><t>Ticker</t></is></c><c r="C2" t="inlineStr"><is><t>Weight</t></is></c></row>
        <row><c r="A3" t="inlineStr"><is><t>Apple</t></is></c><c r="B3" t="inlineStr"><is><t>AAPL</t></is></c><c r="C3"><v>7.1</v></c></row>
      </sheetData></worksheet>`,
    ), "SPY");
    assert.equal(parsed.holdings[0]?.ticker, "AAPL");
  });

  it("normalizes Massive daily summaries and rejects an empty market day", () => {
    assert.deepEqual(parseMassiveDailySummary({
      status: "OK",
      results: [
        { T: "BRK.B", c: 501.25 },
        { T: "AAPL", c: 0 },
      ],
    }, "2026-08-11"), new Map([
      ["BRK-B", { date: "2026-08-11", close: 501.25 }],
    ]));
    assert.throws(() => parseMassiveDailySummary({ status: "OK", results: [] }, "2026-08-11"), /no daily bars/i);
  });

  it("normalizes, sorts, and de-duplicates Massive custom bars", () => {
    assert.deepEqual(parseMassiveCustomBars({
      status: "OK",
      results: [
        { t: Date.parse("2026-08-11T00:00:00.000Z"), c: 102 },
        { t: Date.parse("2026-08-08T00:00:00.000Z"), c: 99 },
        { t: Date.parse("2026-08-11T00:00:00.000Z"), c: 103 },
      ],
    }), [
      { date: "2026-08-08", close: 99 },
      { date: "2026-08-11", close: 103 },
    ]);
  });

  it("aborts a hanging provider request before the GitHub job hard timeout", async () => {
    const client = createMarketBreadthDataClient({
      apiKey: "test-key",
      requestTimeoutMs: 100,
      fetcher: ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })) as typeof fetch,
    });
    await assert.rejects(() => client.fetchDailySummary("2026-08-11"), (error: unknown) =>
      error instanceof MarketBreadthSourceError && error.errorClass === "PROVIDER_TIMEOUT",
    );
  });

  it("times out when headers arrive but the provider body never completes", async () => {
    const client = createMarketBreadthDataClient({
      apiKey: "test-key",
      requestTimeoutMs: 100,
      fetcher: (async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => new Promise<unknown>(() => undefined),
      } as Response)) as typeof fetch,
    });
    await assert.rejects(() => client.fetchDailySummary("2026-08-11"), (error: unknown) =>
      error instanceof MarketBreadthSourceError && error.errorClass === "PROVIDER_TIMEOUT",
    );
  });

  it("serializes Massive requests and enforces the configured minimum interval", async () => {
    let clock = 0;
    const requestTimes: number[] = [];
    const sleepDelays: number[] = [];
    const client = createMarketBreadthDataClient({
      apiKey: "test-key",
      massiveMinRequestIntervalMs: 13_000,
      now: () => clock,
      sleep: async (delayMs) => {
        sleepDelays.push(delayMs);
        clock += delayMs;
      },
      fetcher: (async (url: string | URL | Request) => {
        requestTimes.push(clock);
        const isGrouped = String(url).includes("/grouped/");
        return new Response(JSON.stringify(isGrouped
          ? { status: "OK", results: [{ T: "AAPL", c: 200 }] }
          : { status: "OK", results: [{ t: Date.parse("2026-08-11T00:00:00.000Z"), c: 200 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    await Promise.all([
      client.fetchDailySummary("2026-08-11"),
      client.fetchCustomBars("AAPL", "2025-01-01", "2026-08-11"),
    ]);

    assert.deepEqual(requestTimes, [0, 13_000]);
    assert.deepEqual(sleepDelays, [13_000]);
  });

  it("keeps the Massive interval after a failed request and rejects invalid limiter config", async () => {
    let clock = 0;
    let requestCount = 0;
    const requestTimes: number[] = [];
    const client = createMarketBreadthDataClient({
      apiKey: "test-key",
      massiveMinRequestIntervalMs: 13_000,
      now: () => clock,
      sleep: async (delayMs) => { clock += delayMs; },
      fetcher: (async () => {
        requestTimes.push(clock);
        requestCount += 1;
        return requestCount === 1
          ? new Response("unavailable", { status: 500 })
          : new Response(JSON.stringify({ status: "OK", results: [{ T: "AAPL", c: 200 }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
      }) as typeof fetch,
    });

    await assert.rejects(() => client.fetchDailySummary("2026-08-11"), (error: unknown) =>
      error instanceof MarketBreadthSourceError && error.errorClass === "PROVIDER_UNAVAILABLE",
    );
    await client.fetchDailySummary("2026-08-11");
    assert.deepEqual(requestTimes, [0, 13_000]);
    assert.throws(() => createMarketBreadthDataClient({
      apiKey: "test-key",
      massiveMinRequestIntervalMs: Number.NaN,
    }), (error: unknown) => error instanceof MarketBreadthSourceError && error.errorClass === "RATE_LIMIT_CONFIG_INVALID");
  });

  it("normalizes State Street share-class tickers for Massive", () => {
    assert.equal(normalizeMarketBreadthTicker(" BRK.B "), "BRK-B");
    assert.equal(normalizeMarketBreadthTicker("BF/B"), "BF-B");
  });

  it("maps every SPY holding to exactly one Select Sector SPDR", () => {
    const spy: HoldingRow[] = [
      { ticker: "AAA", name: "Alpha", weightPct: 60 },
      { ticker: "BBB", name: "Beta", weightPct: 40 },
    ];
    const universe = buildSectorUniverse({
      holdingsAsOf: "2026-08-11",
      spyHoldings: spy,
      sectorFunds: [
        { sector: "Information Technology", etf: "XLK", holdingsAsOf: "2026-08-11", tickers: ["AAA"] },
        { sector: "Financials", etf: "XLF", holdingsAsOf: "2026-08-11", tickers: ["BBB"] },
      ],
    });

    assert.deepEqual(universe.holdings.map((row) => [row.ticker, row.sector]), [
      ["AAA", "Information Technology"],
      ["BBB", "Financials"],
    ]);
    assert.deepEqual(universe.sectorWeights, [
      { sector: "Information Technology", etf: "XLK", weightPct: 60, holdingCount: 1 },
      { sector: "Financials", etf: "XLF", weightPct: 40, holdingCount: 1 },
    ]);
  });

  it("rejects duplicate sector membership instead of choosing an arbitrary sector", () => {
    assert.throws(() => buildSectorUniverse({
      holdingsAsOf: "2026-08-11",
      spyHoldings: [{ ticker: "AAA", name: "Alpha", weightPct: 100 }],
      sectorFunds: [
        { sector: "Information Technology", etf: "XLK", holdingsAsOf: "2026-08-11", tickers: ["AAA"] },
        { sector: "Financials", etf: "XLF", holdingsAsOf: "2026-08-11", tickers: ["AAA"] },
      ],
    }), /exactly one sector/i);
  });

  it("uses trading sessions for returns and the prior year-end for YTD", () => {
    const series = bars([
      ["2025-12-31", 100],
      ["2026-01-02", 102],
      ["2026-01-05", 104],
      ["2026-01-06", 106],
      ["2026-01-07", 108],
      ["2026-01-08", 110],
    ]);

    assert.equal(calculateSessionReturn(series, 5), 10);
    assert.equal(calculateYtdReturn(series), 10);
    assert.equal(proxyContributionPctPoints(37.61, -0.34), -0.1279);
  });

  it("excludes insufficient history from the breadth denominator", () => {
    const cell = buildBreadthCell([
      bars([["2026-08-07", 1], ["2026-08-10", 2], ["2026-08-11", 4]]),
      bars([["2026-08-07", 4], ["2026-08-10", 3], ["2026-08-11", 2]]),
      bars([["2026-08-10", 1], ["2026-08-11", 2]]),
    ], 3);

    assert.deepEqual(cell, { above: 1, eligible: 2, total: 3, pct: 50 });
  });

  it("calculates SMA level and SMA slope without substituting missing history", () => {
    assert.equal(simpleMovingAverage([1, 2, 3, 4, 5], 3), 4);
    assert.equal(calculateSmaSlope(bars([
      ["2026-08-05", 1],
      ["2026-08-06", 2],
      ["2026-08-07", 3],
      ["2026-08-10", 4],
      ["2026-08-11", 6],
    ]), 3, 2), 116.6667);
    assert.equal(calculateSmaSlope(bars([["2026-08-11", 6]]), 3, 2), null);
  });

  it("marks the last good snapshot stale when a newer refresh failed", () => {
    assert.deepEqual(determineMarketBreadthFreshness({
      generatedAt: "2026-08-11T23:31:00.000Z",
      priceAsOf: "2026-08-11",
      now: new Date("2026-08-12T00:00:00.000Z"),
      latestFailure: { failedAt: "2026-08-11T23:45:00.000Z", errorClass: "PROVIDER_UNAVAILABLE" },
    }), {
      status: "STALE",
      reason: "LATEST_REFRESH_FAILED",
      failedAt: "2026-08-11T23:45:00.000Z",
      errorClass: "PROVIDER_UNAVAILABLE",
    });
  });

  it("builds all three panels from one validated price and holdings snapshot", () => {
    const sectorWeights = MARKET_TEST_SECTORS.map((sector, index) => ({
      sector: sector.sector,
      etf: sector.etf,
      weightPct: index === MARKET_TEST_SECTORS.length - 1 ? 10 : 9,
      holdingCount: 1,
    }));
    const holdings = sectorWeights.map((sector, index) => ({
      ticker: `TEST${index}`,
      name: `Test ${index}`,
      weightPct: sector.weightPct,
      sector: sector.sector,
      sectorEtf: sector.etf,
    }));
    const series = new Map<string, PriceBar[]>([
      ["SPY", risingBars()],
      ...sectorWeights.map((sector) => [sector.etf, risingBars()] as [string, PriceBar[]]),
      ...holdings.map((holding) => [holding.ticker, risingBars()] as [string, PriceBar[]]),
    ]);
    const priceAsOf = risingBars().at(-1)!.date;
    const snapshot = buildMarketBreadthSnapshot({
      generatedAt: `${priceAsOf}T23:30:00.000Z`,
      priceAsOf,
      universe: {
        holdingsAsOf: priceAsOf,
        holdings,
        sectorWeights,
        universeCount: holdings.length,
        totalWeightPct: 100,
      },
      priceSeries: series,
    });

    assert.equal(snapshot.sectorPerformance.rows.length, 11);
    assert.equal(snapshot.breadth.rows.length, 11);
    assert.equal(snapshot.sma200Slope.rows.length, 11);
    assert.deepEqual(snapshot.breadth.rows[0].windows.sma200, { above: 1, eligible: 1, total: 1, pct: 100 });
    assert.equal(snapshot.coverage.constituent200DayPct, 100);
    assert.ok(snapshot.sma200Slope.rows.every((row) => Number(row.windows.session200) > 0));
    assert.match(snapshot.snapshotId, /^market-breadth-v1-/);
  });
});

describe("Market Breadth refresh producer", () => {
  it("recognizes NYSE holidays but not an ordinary weekday", () => {
    assert.equal(isNyseTradingDay("2026-12-25"), false);
    assert.equal(isNyseTradingDay("2026-08-11"), true);
  });

  it("requests the previous NYSE trading day for Basic-plan EOD refreshes", async () => {
    const cases = [
      { now: "2026-08-12T17:30:00.000Z", expected: "2026-08-11" },
      { now: "2026-08-17T17:30:00.000Z", expected: "2026-08-14" },
      { now: "2026-09-08T17:30:00.000Z", expected: "2026-09-04" },
    ];

    for (const testCase of cases) {
      const repository = new MemoryMarketBreadthRefreshRepository();
      let requestedDate = "";
      await runMarketBreadthRefresh({
        mode: "DAILY",
        now: new Date(testCase.now),
        repository,
        client: {
          fetchUniverse: async () => repository.universe,
          fetchDailySummary: async (date) => {
            requestedDate = date;
            throw new MarketBreadthSourceError("NO_MARKET_DATA", "test stop");
          },
          fetchCustomBars: async () => [],
        },
      });
      assert.equal(requestedDate, testCase.expected);
    }
  });

  it("completes the initial backfill in resumable batches without retrying short-history constituents forever", async () => {
    const repository = new MemoryMarketBreadthRefreshRepository();
    const shortTicker = repository.universe.holdings.at(-1)!.ticker;
    let customCalls = 0;
    let result = null as Awaited<ReturnType<typeof runMarketBreadthRefresh>> | null;
    for (let attempt = 0; attempt < 8 && result?.status !== "READY"; attempt += 1) {
      result = await runMarketBreadthRefresh({
        mode: "BACKFILL",
        now: new Date("2026-08-11T22:30:00.000Z"),
        backfillBatchSize: 10,
        repository,
        client: {
          fetchUniverse: async () => repository.universe,
          fetchDailySummary: async () => new Map(),
          fetchCustomBars: async (ticker) => {
            customCalls += 1;
            return ticker === shortTicker ? barsEnding("2026-08-11", 80) : barsEnding("2026-08-11");
          },
        },
      });
    }
    assert.equal(result?.status, "READY");
    assert.equal(customCalls, 67);
    assert.equal(repository.published[0].coverage.constituent200DayPct, 98.2);
  });

  it("appends one grouped daily summary, bounds history, and publishes READY", async () => {
    const repository = new MemoryMarketBreadthRefreshRepository();
    const symbols = ["SPY", ...MARKET_TEST_SECTORS.map((row) => row.etf), ...repository.universe.holdings.map((row) => row.ticker)];
    for (const symbol of symbols) repository.series.set(symbol, barsEnding("2026-08-10"));
    const grouped = new Map(symbols.map((symbol) => [symbol, { date: "2026-08-11", close: 520 }]));

    const result = await runMarketBreadthRefresh({
      mode: "DAILY",
      now: new Date("2026-08-12T17:30:00.000Z"),
      repository,
      client: {
        fetchUniverse: async () => repository.universe,
        fetchDailySummary: async () => grouped,
        fetchCustomBars: async () => { throw new Error("custom backfill should not run"); },
      },
    });

    assert.equal(result.status, "READY");
    assert.equal(repository.published.length, 1);
    assert.equal(repository.published[0].priceAsOf, "2026-08-11");
    assert.equal(repository.series.get("SPY")?.length, 420);
    assert.equal(repository.series.get("SPY")?.at(-1)?.close, 520);
  });

  it("deduplicates the second cron for the same price date", async () => {
    const repository = new MemoryMarketBreadthRefreshRepository();
    repository.latestSnapshot = apiSnapshot() as ReturnType<typeof buildMarketBreadthSnapshot>;
    let providerCalls = 0;
    const result = await runMarketBreadthRefresh({
      mode: "DAILY",
      now: new Date("2026-08-12T18:30:00.000Z"),
      repository,
      client: {
        fetchUniverse: async () => { providerCalls += 1; return repository.universe; },
        fetchDailySummary: async () => { providerCalls += 1; return new Map(); },
        fetchCustomBars: async () => [],
      },
    });
    assert.equal(result.status, "SKIPPED");
    assert.equal(result.reason, "DUPLICATE_PRICE_DATE");
    assert.equal(providerCalls, 0);
  });

  it("deduplicates a holiday run and preserves last-good after a provider outage", async () => {
    const holidayRepository = new MemoryMarketBreadthRefreshRepository();
    holidayRepository.latestSnapshot = {
      ...apiSnapshot(),
      priceAsOf: "2026-12-24",
    } as ReturnType<typeof buildMarketBreadthSnapshot>;
    const holiday = await runMarketBreadthRefresh({
      mode: "DAILY",
      now: new Date("2026-12-25T22:30:00.000Z"),
      repository: holidayRepository,
      client: {
        fetchUniverse: async () => { throw new Error("holiday duplicate must not call providers"); },
        fetchDailySummary: async () => { throw new Error("holiday duplicate must not call providers"); },
        fetchCustomBars: async () => [],
      },
    });
    assert.equal(holiday.status, "SKIPPED");
    assert.equal(holiday.reason, "DUPLICATE_PRICE_DATE");
    assert.equal(holidayRepository.published.length, 0);

    const failedRepository = new MemoryMarketBreadthRefreshRepository();
    failedRepository.latestSnapshot = {
      ...apiSnapshot(),
      priceAsOf: "2026-08-10",
    } as ReturnType<typeof buildMarketBreadthSnapshot>;
    const failed = await runMarketBreadthRefresh({
      mode: "DAILY",
      now: new Date("2026-08-12T22:30:00.000Z"),
      repository: failedRepository,
      client: {
        fetchUniverse: async () => { throw new MarketBreadthSourceError("PROVIDER_UNAVAILABLE", "outage"); },
        fetchDailySummary: async () => new Map(),
        fetchCustomBars: async () => [],
      },
    });
    assert.equal(failed.status, "FAILED");
    assert.equal(failedRepository.published.length, 0);
    assert.equal(failedRepository.latestSnapshot?.snapshotId, apiSnapshot().snapshotId);
    assert.equal(failedRepository.finishes.at(-1)?.errorClass, "PROVIDER_UNAVAILABLE");
  });

  it("treats an empty normal trading day as FAILED, never as a holiday", async () => {
    const repository = new MemoryMarketBreadthRefreshRepository();
    const result = await runMarketBreadthRefresh({
      mode: "DAILY",
      now: new Date("2026-08-11T22:47:00.000Z"),
      repository,
      client: {
        fetchUniverse: async () => repository.universe,
        fetchDailySummary: async () => { throw new MarketBreadthSourceError("NO_MARKET_DATA", "unexpected empty day"); },
        fetchCustomBars: async () => [],
      },
    });
    assert.equal(result.status, "FAILED");
    assert.equal(repository.finishes.at(-1)?.errorClass, "NO_MARKET_DATA");
  });
});

const MARKET_TEST_SECTORS = [
  { sector: "Communication Services", etf: "XLC" },
  { sector: "Consumer Discretionary", etf: "XLY" },
  { sector: "Consumer Staples", etf: "XLP" },
  { sector: "Energy", etf: "XLE" },
  { sector: "Financials", etf: "XLF" },
  { sector: "Health Care", etf: "XLV" },
  { sector: "Industrials", etf: "XLI" },
  { sector: "Information Technology", etf: "XLK" },
  { sector: "Materials", etf: "XLB" },
  { sector: "Real Estate", etf: "XLRE" },
  { sector: "Utilities", etf: "XLU" },
] as const;
