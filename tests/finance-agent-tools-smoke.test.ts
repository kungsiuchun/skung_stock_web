import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { ToolRegistry } from "../functions/api/agent/registry";
import { ALL_STOCK_TOOLS } from "../functions/api/agent/tools/stock-tools";
import { ALL_ANALYSIS_TOOLS } from "../functions/api/agent/tools/analysis-tools";
import { ALL_SEARCH_TOOLS } from "../functions/api/agent/tools/search-tools";
import { ALL_ALPHAEAR_TOOLS } from "../functions/api/agent/tools/alphaear-tools";
import { ALL_RETAIL_TOOLS } from "../functions/api/agent/tools/retail-tools";
import { macroTools } from "../functions/api/agent/tools/macro-tools";

type SmokeResult = Record<string, any>;

const loadDevVars = () => {
  const env: Record<string, string> = {};
  if (!fs.existsSync(".dev.vars")) return env;

  for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }

  return env;
};

const executeWithTimeout = async (
  registry: ToolRegistry,
  name: string,
  args: Record<string, any>,
  timeoutMs = 30_000,
) => {
  return Promise.race([
    registry.execute(name, args),
    new Promise<never>((_, reject) => {
      windowlessSetTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
};

const windowlessSetTimeout = (fn: () => void, ms: number) => setTimeout(fn, ms);

const assertNoToolError = (name: string, result: SmokeResult) => {
  assert.ok(result, `${name} returned an empty result`);
  assert.equal(result.error, undefined, `${name} returned error: ${result.error}`);
};

const smokeCases: Array<{
  name: string;
  args: Record<string, any>;
  assertResult: (result: SmokeResult) => void;
}> = [
  {
    name: "get_realtime_quote",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("get_realtime_quote", result);
      assert.equal(result.symbol, "MSFT");
      assert.equal(typeof result.price, "number");
    },
  },
  {
    name: "get_daily_history",
    args: { stock_code: "MSFT", days: 20 },
    assertResult: (result) => {
      assertNoToolError("get_daily_history", result);
      assert.ok(Array.isArray(result.history) && result.history.length > 0, "history should contain rows");
    },
  },
  {
    name: "calculate_ma",
    args: { stock_code: "MSFT", periods: [5, 10, 20] },
    assertResult: (result) => {
      assertNoToolError("calculate_ma", result);
      assert.ok(result.moving_averages?.MA5, "MA5 should be present");
    },
  },
  {
    name: "get_options_chain",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("get_options_chain", result);
      assert.ok(Array.isArray(result.calls) && result.calls.length > 0, "calls should not be empty");
      assert.ok(Array.isArray(result.puts) && result.puts.length > 0, "puts should not be empty");
    },
  },
  {
    name: "get_financial_summary",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("get_financial_summary", result);
      assert.equal(result.symbol, "MSFT");
      assert.ok(result.financial_metrics || result.valuation, "financial summary should contain metrics");
    },
  },
  {
    name: "analyze_trend",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("analyze_trend", result);
      assert.equal(result.symbol, "MSFT");
      assert.ok(result.trend, "trend should be present");
    },
  },
  {
    name: "run_algorithmic_strategy",
    args: { stock_code: "MSFT", strategy_name: "all" },
    assertResult: (result) => {
      assertNoToolError("run_algorithmic_strategy", result);
      assert.ok(Array.isArray(result.signals) && result.signals.length > 0, "strategy signals should not be empty");
      assert.ok(Array.isArray(result.chart_data) && result.chart_data.length > 0, "chart_data should not be empty");
    },
  },
  {
    name: "save_user_memory",
    args: { fact: "validation smoke only" },
    assertResult: (result) => {
      assertNoToolError("save_user_memory", result);
      assert.equal(result.status, "saved");
    },
  },
  {
    name: "read_financial_theory",
    args: { strategy_name: "bull_trend" },
    assertResult: (result) => {
      assertNoToolError("read_financial_theory", result);
      assert.equal(result.strategy_name, "bull_trend");
    },
  },
  {
    name: "delegate_task",
    args: { role: "Technical Analyst", task_description: "validation smoke only for MSFT" },
    assertResult: (result) => {
      assertNoToolError("delegate_task", result);
      assert.equal(result._delegate, true);
    },
  },
  {
    name: "search_stock_news",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("search_stock_news", result);
      assert.ok(Array.isArray(result.news), "news should be an array");
    },
  },
  {
    name: "search_market_news",
    args: { query: "AI semiconductor", news_count: 3 },
    assertResult: (result) => {
      assertNoToolError("search_market_news", result);
      assert.ok(Array.isArray(result.news), "market news should be an array");
    },
  },
  {
    name: "get_fund_flow",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("get_fund_flow", result);
      assert.equal(result.symbol, "MSFT");
      assert.equal(typeof result.net_inflow, "number");
    },
  },
  {
    name: "get_alphaear_news",
    args: { source: "cls", count: 3 },
    assertResult: (result) => {
      assertNoToolError("get_alphaear_news", result);
      assert.equal(result.source_type, "yahoo_finance_search");
      assert.ok(Array.isArray(result.items) && result.items.length > 0, "Yahoo Finance headlines should not be empty");
      assert.ok(result.items[0].publisher, "headline should include a publisher");
      assert.ok(result.items[0].url, "headline should include a source URL");
    },
  },
  {
    name: "get_financial_signals",
    args: { stock_code: "MSFT" },
    assertResult: (result) => {
      assertNoToolError("get_financial_signals", result);
      assert.ok(Array.isArray(result.signals), "signals should be an array even when empty");
    },
  },
  {
    name: "get_retail_sentiment",
    args: { stock_code: "MSFT", days_back: 7 },
    assertResult: (result) => {
      assertNoToolError("get_retail_sentiment", result);
      assert.notEqual(result.sourceType, "unavailable", "retail sentiment should use env-backed Adanos data");
      assert.equal(result.coverage, "3/3");
    },
  },
  {
    name: "search_fred_series",
    args: { search_text: "unemployment" },
    assertResult: (result) => {
      assertNoToolError("search_fred_series", result);
      assert.ok(Array.isArray(result.results) && result.results.length > 0, "FRED search results should not be empty");
    },
  },
  {
    name: "get_fred_series",
    args: { series_id: "UNRATE", limit: 3 },
    assertResult: (result) => {
      assertNoToolError("get_fred_series", result);
      assert.ok(Array.isArray(result.observations) && result.observations.length > 0, "FRED observations should not be empty");
    },
  },
];

test("Finance Agent Chat tools can pull their backing data sources", async () => {
  const env = loadDevVars();
  assert.ok(env.ADANOS_API_KEY, "ADANOS_API_KEY must be present for retail sentiment smoke");
  assert.ok(env.FRED_API_KEY, "FRED_API_KEY must be present for macro tools smoke");

  const registry = new ToolRegistry();
  registry.setEnv(env);
  registry.registerAll([
    ...ALL_STOCK_TOOLS,
    ...ALL_ANALYSIS_TOOLS,
    ...ALL_SEARCH_TOOLS,
    ...ALL_ALPHAEAR_TOOLS,
    ...ALL_RETAIL_TOOLS,
    ...macroTools,
  ]);

  for (const smokeCase of smokeCases) {
    const result = await executeWithTimeout(registry, smokeCase.name, smokeCase.args);
    smokeCase.assertResult(result);
  }
});
