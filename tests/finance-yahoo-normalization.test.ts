import assert from "node:assert/strict";
import test from "node:test";

import { ALL_ANALYSIS_TOOLS } from "../functions/api/agent/tools/analysis-tools";
import { ALL_STOCK_TOOLS } from "../functions/api/agent/tools/stock-tools";
import { ToolRegistry } from "../functions/api/agent/registry";
import { buildFinanceDashboardSnapshot } from "../src/lib/finance-dashboard-snapshot";
import { normalizeStoredDashboardData, normalizeStoredDashboardSnapshot } from "../src/lib/finance-dashboard-persistence";
import { deriveTraderRiskSnapshot } from "../src/lib/trader-risk-snapshot";
import { filterYahooFormingDailyBars, normalizeFinanceChartData, normalizeYahooChartResult } from "../src/lib/yahoo-finance-normalizer";
import { onRequest as getTechnicalRadar } from "../functions/api/technical-radar";
import { onRequest as getSentiment } from "../functions/api/sentiment";
import { onRequest as getVix } from "../functions/api/vix";

const originalFetch = globalThis.fetch;

const dateFor = (index: number) => {
  const date = new Date(Date.UTC(2025, 0, 1 + index));
  return date.toISOString().slice(0, 10);
};

const rowFor = (index: number) => {
  const close = 100 + index * 0.1;
  return {
    timestamp: Date.parse(`${dateFor(index)}T00:00:00.000Z`) / 1_000,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000 + index,
  };
};

const yahooPayload = (rows: Array<Record<string, unknown>>, previousClose?: number, metaOverrides: Record<string, unknown> = {}) => ({
  chart: {
    result: [{
      timestamp: rows.map((row) => row.timestamp),
      indicators: { quote: [{
        open: rows.map((row) => row.open),
        high: rows.map((row) => row.high),
        low: rows.map((row) => row.low),
        close: rows.map((row) => row.close),
        volume: rows.map((row) => row.volume),
      }] },
      meta: {
        ...(previousClose === undefined ? {} : { chartPreviousClose: previousClose }),
        currentTradingPeriod: { regular: { end: Date.parse("2024-01-01T00:00:00.000Z") / 1_000 } },
        ...metaOverrides,
      },
    }],
  },
});

const setYahooPayload = (payload: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
};

const setYahooPayloadBySymbol = (payloads: Record<string, unknown>) => {
  globalThis.fetch = (async (input) => {
    const url = String(input);
    const symbol = url.split("/chart/")[1]?.split("?")[0] || "";
    return new Response(JSON.stringify(payloads[symbol] || payloads.DEFAULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
};

const registry = () => {
  const value = new ToolRegistry();
  value.registerAll([...ALL_STOCK_TOOLS, ...ALL_ANALYSIS_TOOLS]);
  return value;
};

const validChartPoint = (date: string) => ({
  date,
  date_iso: date,
  price: 100,
  open: 99,
  high: 101,
  low: 98,
  volume: 1_000,
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("public quote tool never turns a missing latest close into a price or change", async () => {
  const rows = [rowFor(0), { ...rowFor(1), close: null }];
  setYahooPayload(yahooPayload(rows, 100));
  const result = await registry().execute("get_realtime_quote", { stock_code: "AAPL" });

  assert.equal(result.price, null);
  assert.equal(result.change_pct, null);
  assert.equal(result.volume, null);
  assert.equal(result.quote_status, "unavailable");
  assert.equal(result.last_valid_date, dateFor(0));
});

test("public quote tool keeps a genuine zero change and exposes missing previous close", async () => {
  setYahooPayload(yahooPayload([rowFor(0)], 100));
  const unchanged = await registry().execute("get_realtime_quote", { stock_code: "AAPL" });
  assert.equal(unchanged.change_pct, 0);

  setYahooPayload(yahooPayload([rowFor(0)]));
  const missingPrevious = await registry().execute("get_realtime_quote", { stock_code: "AAPL" });
  assert.equal(missingPrevious.price, 100);
  assert.equal(missingPrevious.change_pct, null);
});

test("public technical, sentiment, and VIX boundaries never reuse an older close", async () => {
  for (const invalidClose of [null, "100"]) {
    const rows = Array.from({ length: 35 }, (_, index) => rowFor(index));
    rows[rows.length - 1].close = invalidClose;
    const payload = yahooPayload(rows, 100);
    setYahooPayload(payload);

    const technicalResponse = await getTechnicalRadar({ request: new Request("https://example.test/api/technical-radar?symbol=AAPL") });
    const technical = await technicalResponse.json() as Record<string, unknown>;
    assert.equal(technicalResponse.status, 502);
    assert.equal(technical.partial, true);
    assert.equal(technical.rejected_bar_count, 1);
    assert.equal(technical.last_valid_date, dateFor(33));

    setYahooPayload(payload);
    const vixResponse = await getVix({ request: new Request("https://example.test/api/vix") });
    const vix = await vixResponse.json() as Record<string, unknown>;
    assert.equal(vixResponse.status, 502);
    assert.equal(vix.partial, true);
    assert.equal(vix.rejected_bar_count, 1);
    assert.equal(vix.last_valid_date, dateFor(33));
  }

  const rows = Array.from({ length: 35 }, (_, index) => rowFor(index));
  rows[rows.length - 1].close = null;
  const payload = yahooPayload(rows, 100);
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
  const sentimentResponse = await getSentiment({
    request: new Request("https://example.test/api/sentiment?symbol=AAPL"),
    env: {},
  });
  const sentiment = await sentimentResponse.json() as { score: number | null; warnings: string[] };
  assert.equal(sentimentResponse.status, 200);
  assert.equal(sentiment.score, null);
  assert.ok(sentiment.warnings.some((warning) => warning.includes("Technical proxy unavailable")));
});

test("public technical and VIX endpoints preserve valid controls", async () => {
  const payload = yahooPayload(Array.from({ length: 35 }, (_, index) => rowFor(index)), 100);
  setYahooPayload(payload);

  const technicalResponse = await getTechnicalRadar({ request: new Request("https://example.test/api/technical-radar?symbol=AAPL") });
  const technical = await technicalResponse.json() as Record<string, unknown>;
  assert.equal(technicalResponse.status, 200);
  assert.equal(technical.partial, false);
  assert.equal(typeof technical.rsi_14, "number");

  setYahooPayload(payload);
  const vixResponse = await getVix({ request: new Request("https://example.test/api/vix") });
  const vix = await vixResponse.json() as Record<string, unknown>;
  assert.equal(vixResponse.status, 200);
  assert.equal(vix.partial, false);
  assert.equal(typeof vix.value, "number");
});

test("a flat but valid price history keeps the dashboard available with an explicit technical error", async () => {
  const rows = Array.from({ length: 35 }, (_, index) => ({ ...rowFor(index), open: 100, high: 101, low: 99, close: 100 }));
  setYahooPayload(yahooPayload(rows, 100));
  const response = await getTechnicalRadar({ request: new Request("https://example.test/api/technical-radar?symbol=AAPL") });
  const technical = await response.json() as { error: string; last_valid_date: string };
  assert.equal(response.status, 502);
  assert.match(technical.error, /價格區間/);
  assert.equal(technical.last_valid_date, dateFor(34));
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "AAPL", agent: { success: true, steps: [{ type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 100, change_pct: 0 }) }] },
    news: {}, vix: null, fundamentals: null, technical, sentiment: null,
  });
  assert.equal(normalizeStoredDashboardSnapshot(snapshot)?.data.price, 100);
  assert.equal((normalizeStoredDashboardSnapshot(snapshot)?.technicalData as typeof technical).error, technical.error);
});

test("public quote tool uses regularMarketTime instead of a daily interval timestamp", async () => {
  const regularMarketTime = Date.parse("2025-01-02T15:30:00.000Z") / 1_000;
  setYahooPayload(yahooPayload([rowFor(0), rowFor(1)], 100, { regularMarketTime }));
  const quote = await registry().execute("get_realtime_quote", { stock_code: "AAPL" });
  assert.equal(quote.source_as_of, "2025-01-02T15:30:00.000Z");

  setYahooPayload(yahooPayload([rowFor(0), rowFor(1)], 100, { regularMarketTime: String(regularMarketTime) }));
  const missingQuoteTime = await registry().execute("get_realtime_quote", { stock_code: "AAPL" });
  assert.equal(missingQuoteTime.source_as_of, null);
});

test("shared daily forming-bar boundary excludes current rows when session end is missing or invalid", () => {
  const now = new Date("2026-07-21T18:00:00.000Z");
  const dates = ["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21"];
  const rows = dates.map((date, index) => ({
    timestamp: Date.parse(`${date}T13:30:00.000Z`) / 1_000,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000 + index,
  }));

  for (const end of [undefined, "invalid", Number.NaN]) {
    const payload = yahooPayload(rows, undefined, { currentTradingPeriod: { regular: { end } } });
    const normalized = normalizeYahooChartResult(payload);
    const completed = filterYahooFormingDailyBars(payload, normalized.bars, now);
    assert.equal(completed.bars.length, 4);
    assert.equal(completed.partialBarExcluded, true);
    assert.equal(completed.bars.at(-1)?.date, "2026-07-20");
  }
});

test("public history, moving average and trend tools reject malformed Yahoo rows", async () => {
  const rows = Array.from({ length: 35 }, (_, index) => rowFor(index));
  rows[5].close = "100.5";
  rows[10].volume = undefined;
  rows[15].open = true;
  rows[20].timestamp = undefined;
  rows[21].timestamp = Number.MAX_VALUE;
  setYahooPayload(yahooPayload(rows));

  const tools = registry();
  const history = await tools.execute("get_daily_history", { stock_code: "AAPL", days: 40 });
  assert.equal(history.rejected_bar_count, 5);
  assert.equal(history.history.length, 30);
  assert.equal(history.last_valid_date, dateFor(34));
  assert.ok(history.history.every((row: Record<string, unknown>) => typeof row.close === "number" && row.close > 0 && typeof row.volume === "number"));

  const movingAverage = await tools.execute("calculate_ma", { stock_code: "AAPL", periods: [5, 10, 20] });
  assert.equal(movingAverage.data_points_used, 30);
  assert.equal(movingAverage.last_valid_date, dateFor(34));

  const trend = await tools.execute("analyze_trend", { stock_code: "AAPL" });
  assert.equal(trend.rejected_bar_count, 5);
  assert.equal(trend.last_valid_date, dateFor(34));
  assert.ok(trend.chart_data.every((row: Record<string, unknown>) => row.date_iso !== "1970-01-01" && typeof row.volume === "number"));
});

test("public Yahoo tools retain quality metadata for empty chart results", async () => {
  setYahooPayload({ chart: { result: [] } });
  const tools = registry();
  for (const [name, args] of [
    ["get_realtime_quote", { stock_code: "AAPL" }],
    ["get_daily_history", { stock_code: "AAPL", days: 20 }],
    ["calculate_ma", { stock_code: "AAPL", periods: [5] }],
    ["analyze_trend", { stock_code: "AAPL" }],
  ] as const) {
    const result = await tools.execute(name, args);
    assert.equal(result.partial, true, name);
    assert.equal(result.rejected_bar_count, 0, name);
    assert.equal(result.last_valid_date, null, name);
  }
});

test("public strategy tool keeps the actual last valid date when the latest row is rejected", async () => {
  const rows = Array.from({ length: 222 }, (_, index) => rowFor(index));
  rows[221].close = null;
  setYahooPayload(yahooPayload(rows));
  const result = await registry().execute("run_algorithmic_strategy", { stock_code: "AAPL", strategy_name: "all" });

  assert.equal(result.rejected_bar_count, 1);
  assert.equal(result.partial, true);
  assert.equal(result.last_valid_date, dateFor(220));
  assert.equal(result.chart_data.at(-1).date_iso, dateFor(220));
  assert.ok(result.chart_data.every((row: Record<string, unknown>) => typeof row.price === "number" && row.price > 0));
});

test("strategy relative strength aligns benchmark endpoints by date and exposes benchmark quality", async () => {
  const stockRows = Array.from({ length: 260 }, (_, index) => rowFor(index));
  const benchmarkRows = stockRows.map((row, index) => ({
    ...row,
    open: 200 + index * 0.2,
    high: 202 + index * 0.2,
    low: 199 + index * 0.2,
    close: 201 + index * 0.2,
  }));
  benchmarkRows[100].close = null;
  setYahooPayloadBySymbol({
    AAPL: yahooPayload(stockRows),
    SPY: yahooPayload(benchmarkRows),
  });

  const result = await registry().execute("run_algorithmic_strategy", { stock_code: "AAPL", strategy_name: "all" });
  const alignedBenchmark = benchmarkRows.filter((row) => typeof row.close === "number");
  const stockCurrent = stockRows.at(-1)!.close as number;
  const stockPrior = stockRows.at(-21)!.close as number;
  const benchmarkCurrent = alignedBenchmark.find((row) => row.timestamp === stockRows.at(-1)!.timestamp)!.close as number;
  const benchmarkPrior = alignedBenchmark.find((row) => row.timestamp === stockRows.at(-21)!.timestamp)!.close as number;
  const expected = ((stockCurrent / stockPrior - 1) - (benchmarkCurrent / benchmarkPrior - 1)) * 100;
  assert.equal(result.market_snapshot.relative_strength_vs_spy_20d, Number(expected.toFixed(2)));
  assert.equal(result.market_snapshot.benchmark_rejected_bar_count, 1);
  assert.equal(result.market_snapshot.benchmark_partial, true);
  assert.equal(result.market_snapshot.data_partial, true);
  assert.equal(result.partial, false);
});

test("quality metadata survives insufficient tool results and the snapshot boundary", async () => {
  const trendRows = Array.from({ length: 20 }, (_, index) => rowFor(index));
  trendRows[5].close = null;
  setYahooPayload(yahooPayload(trendRows));
  const tools = registry();
  const trend = await tools.execute("analyze_trend", { stock_code: "AAPL" });
  assert.match(trend.error, /Insufficient data/);
  assert.equal(trend.partial, true);
  assert.equal(trend.rejected_bar_count, 1);
  assert.equal(trend.last_valid_date, dateFor(19));

  setYahooPayload(yahooPayload([{ ...rowFor(0), close: null }]));
  const movingAverage = await tools.execute("calculate_ma", { stock_code: "AAPL", periods: [5] });
  assert.equal(movingAverage.error, "No closing prices available");
  assert.equal(movingAverage.partial, true);
  assert.equal(movingAverage.rejected_bar_count, 1);
  assert.equal(movingAverage.last_valid_date, null);

  const strategyRows = Array.from({ length: 219 }, (_, index) => rowFor(index));
  strategyRows[10].close = null;
  setYahooPayload(yahooPayload(strategyRows));
  const strategy = await tools.execute("run_algorithmic_strategy", { stock_code: "AAPL", strategy_name: "all" });
  assert.match(strategy.error, /220 completed daily bars/);
  assert.equal(strategy.partial, true);
  assert.equal(strategy.rejected_bar_count, 1);
  assert.equal(strategy.last_valid_date, dateFor(218));

  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: { success: true, steps: [{ type: "tool_call", tool_name: "run_algorithmic_strategy", tool_result: JSON.stringify(strategy) }] },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });
  assert.equal(snapshot.data.chartDataRejectedCount, 1);
  assert.equal(snapshot.data.chartDataLastValidDate, dateFor(218));
  assert.equal(snapshot.data.chartDataPartial, true);
});

test("snapshot and chart boundaries reject malformed rows without manufacturing quote values", () => {
  const snapshot = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: {
      success: true,
      steps: [
        { type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: null, change_pct: null }) },
        { type: "tool_call", tool_name: "run_algorithmic_strategy", tool_result: JSON.stringify({
          partial: true,
          rejected_bar_count: 3,
          last_valid_date: "2025-01-01",
          chart_data: [validChartPoint("2025-01-01"), { ...validChartPoint("2025-01-02"), price: "100" }, { ...validChartPoint("invalid") }],
        }) },
      ],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });

  assert.equal(snapshot.data.price, null);
  assert.equal(snapshot.data.change, "未提供");
  assert.equal(snapshot.data.quoteStatus, "unavailable");
  assert.equal(snapshot.data.chartData.length, 1);
  assert.equal(snapshot.data.chartDataRejectedCount, 3);
  assert.equal(snapshot.data.chartDataLastValidDate, "2025-01-01");
  assert.equal(snapshot.data.chartDataPartial, true);

  const unchanged = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: {
      success: true,
      steps: [{ type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 100, change_pct: 0 }) }],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });
  assert.equal(unchanged.data.price, 100);
  assert.equal(unchanged.data.change, "+0.00%");
  assert.equal(unchanged.data.quoteStatus, "available");

  const zeroPrice = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: {
      success: true,
      steps: [{ type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 0, change_pct: 0 }) }],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });
  assert.equal(zeroPrice.data.price, null);
  assert.equal(zeroPrice.data.change, "未提供");
  assert.equal(zeroPrice.data.quoteStatus, "unavailable");

  const unavailableQuote = buildFinanceDashboardSnapshot({
    symbol: "AAPL",
    agent: {
      success: true,
      steps: [{ type: "tool_call", tool_name: "get_realtime_quote", tool_result: JSON.stringify({ price: 100, change_pct: -100, quote_status: "unavailable" }) }],
    },
    news: {}, vix: null, fundamentals: null, technical: null, sentiment: null,
  });
  assert.equal(unavailableQuote.data.price, null);
  assert.equal(unavailableQuote.data.change, "未提供");

  const chart = normalizeFinanceChartData([
    validChartPoint("2025-01-01"),
    { ...validChartPoint("2025-01-02"), price: "100" },
    { ...validChartPoint("2025-01-03"), volume: null },
    { ...validChartPoint("2025-01-04"), date_iso: "2025-02-30" },
    { ...validChartPoint("2025-01-05"), price: 0 },
  ]);
  assert.equal(chart.bars.length, 1);
  assert.equal(chart.rejectedBarCount, 4);
});

test("saved zero prices and invalid saved bars cannot bypass the boundary", () => {
  const base = {
    symbol: "AAPL", price: 100, change: "+0.00%", algoRating: 50, marketSentiment: null,
    strategyPoints: {}, news: [], chartData: [validChartPoint("2025-01-01")],
    quantStrategies: [], quantStrategySchemaVersion: "v3" as const,
  };
  assert.ok(normalizeStoredDashboardData(base));
  assert.equal(normalizeStoredDashboardData({ ...base, price: 0 }), null);
  assert.equal(normalizeStoredDashboardData({ ...base, chartData: [{ ...validChartPoint("2025-01-01"), price: 0 }] }), null);
  assert.equal(normalizeStoredDashboardData({ ...base, chartData: [{ ...validChartPoint("2025-01-01"), volume: "1000" }] }), null);
  assert.equal(normalizeStoredDashboardData({ ...base, chartData: [{ ...validChartPoint("2025-01-01"), date_iso: "invalid" }] }), null);
});

test("rejected source rows stop risk metrics even when invalid rows were excluded upstream", () => {
  const snapshot = deriveTraderRiskSnapshot([validChartPoint("2025-01-01")], 1);
  assert.equal(snapshot.invalidBarCount, 1);
  assert.equal(snapshot.dollarVolume, null);
  assert.ok(snapshot.bars.every((bar) => bar.value === "Needs data"));
});
