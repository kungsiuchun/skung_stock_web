import assert from "node:assert/strict";
import test from "node:test";

import { getHashForView, getViewFromHash, type ViewState } from "../src/lib/app-routes";

test("maps finance analyzer hashes to the dashboard view", () => {
  assert.equal(getViewFromHash("#/work/finance-analyzer"), "finance-dashboard");
  assert.equal(getViewFromHash("#/work/finance-dashboard"), "finance-dashboard");
});

test("maps empty and unknown hashes back to the home view", () => {
  assert.equal(getViewFromHash(""), "home");
  assert.equal(getViewFromHash("#/"), "home");
  assert.equal(getViewFromHash("#/does-not-exist"), "home");
});

test("round trips every page-level view to a hash route", () => {
  const expected: Array<[ViewState, string]> = [
    ["home", "#/"],
    ["about", "#/about"],
    ["work-gallery", "#/market-lab"],
    ["settle-up", "#/work/settle-up"],
    ["finance-dashboard", "#/work/finance-analyzer"],
    ["trading-agent-dashboard", "#/work/trading-agent-dashboard"],
    ["spx-recap", "#/work/spx-recap"],
    ["spx-gex-heatmap", "#/work/spx-gex-heatmap"],
    ["stocks-intelligence-watcher", "#/work/stocks-intelligence-watcher"],
    ["fixed-income", "#/work/fixed-income"],
    ["market-breadth", "#/work/market-breadth"],
    ["portfolio-backtest", "#/work/portfolio-backtest"],
  ];

  for (const [view, hash] of expected) {
    assert.equal(getHashForView(view), hash);
    assert.equal(getViewFromHash(hash), view);
  }
});
