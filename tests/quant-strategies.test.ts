import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertResearchBars,
  deriveStrategySignal,
  runQuantResearchSuite,
  runStrategyBacktest,
  runStrategyWalkForward,
  type ResearchBar,
} from "../functions/api/agent/strategies/research";
import { runAlgorithmicStrategy, BuySignal } from "../functions/api/agent/strategies/engine";
import { ALL_ANALYSIS_TOOLS } from "../functions/api/agent/tools/analysis-tools";

function isoDate(offset: number): string {
  const date = new Date(Date.UTC(2020, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function makeBars(length = 700): ResearchBar[] {
  const bars: ResearchBar[] = [];
  let previousClose = 100;
  for (let index = 0; index < length; index += 1) {
    const trend = index * 0.045;
    const cycle = Math.sin(index / 4) * 1.6;
    const isBreakout = index > 70 && index % 29 === 0;
    const close = isBreakout ? previousClose * 1.04 : Math.max(10, 100 + trend + cycle);
    const open = previousClose * (1 + Math.sin(index / 9) * 0.0015);
    const high = Math.max(open, close) * 1.008;
    const low = Math.min(open, close) * 0.992;
    const volume = 1_000_000 * (1 + (isBreakout ? 1.2 : Math.abs(Math.sin(index / 8)) * 0.3));
    bars.push({ date: isoDate(index), open, high, low, close, volume });
    previousClose = close;
  }
  return bars;
}

test("research bars fail fast on non-chronological data", () => {
  const bars = makeBars(3);
  [bars[1], bars[2]] = [bars[2], bars[1]];
  assert.throws(() => assertResearchBars(bars), /strictly ascending/);
});

test("volume breakout only reads historical bars and has no future-bar dependency", () => {
  const history = Array.from({ length: 21 }, (_, index): ResearchBar => ({
    date: isoDate(index),
    open: 100,
    high: 101,
    low: 99,
    close: index === 20 ? 103 : 100,
    volume: index === 20 ? 2_000_000 : 1_000_000,
  }));
  const signalBeforeFutureData = deriveStrategySignal("volume_breakout", history);
  const historyWithFutureBar = [...history, { ...history.at(-1)!, date: isoDate(21), close: 50, low: 49, high: 104 }];

  assert.equal(signalBeforeFutureData.position, 1);
  assert.equal(deriveStrategySignal("volume_breakout", history).position, 1);
  assert.equal(historyWithFutureBar.length, 22);
});

test("all eleven strategies produce reproducible research reports and chronological walk-forward windows", () => {
  const bars = makeBars();
  const suite = runQuantResearchSuite(bars);

  assert.equal(suite.reports.length, 11);
  assert.equal(suite.walkForward.length, 11);
  assert.equal(suite.reports[0].execution, "signal_at_close_execute_next_open");
  assert.equal(suite.reports[0].dataRange.start, bars[0].date);
  assert.equal(suite.reports[0].dataRange.end, bars.at(-1)?.date);
  assert.equal(suite.walkForward.find((report) => report.strategyId === "dragon_head")?.gate.status, "NOT_ELIGIBLE");
  assert.notEqual(suite.walkForward.find((report) => report.strategyId === "bull_trend")?.gate.status, "NOT_ELIGIBLE");
  assert.ok([1, null].includes(suite.correlation.bull_trend.bull_trend));

  const windows = suite.walkForward[0].windows;
  assert.deepEqual(windows.map((window) => window.name), ["train", "validation", "test"]);
  assert.ok(windows[0].end < windows[1].start);
  assert.ok(windows[1].end < windows[2].start);
  assert.deepEqual(
    suite.candidatePortfolioWalkForward.map((window) => window.name),
    ["train", "validation", "test"],
  );
  assert.notEqual(suite.candidatePortfolioGate.status, "PASS");
});

test("cost model is applied and the backtest uses next-open execution", () => {
  const bars = makeBars();
  const report = runStrategyBacktest("volume_breakout", bars);

  assert.equal(report.records[0].date, bars[67].date);
  assert.ok(report.records.some((record) => record.turnover > 0));
  assert.notEqual(report.costSensitivity.halfCostCagr, report.costSensitivity.doubleCostCagr);
  assert.ok(report.metrics.annualizedTurnover > 0);
});

test("discretionary frameworks cannot emit a live BUY signal through the existing engine", () => {
  const result = runAlgorithmicStrategy("wave_theory", {
    symbol: "TEST",
    currentPrice: 120,
    ma5: 115,
    ma10: 110,
    ma20: 105,
    rsi14: 60,
    maAlignment: "Strong Bullish",
    high60d: 110,
    low60d: 90,
  });

  assert.ok(result);
  assert.equal(result.signal, BuySignal.WAIT);
  assert.equal(result.researchStatus?.classification, "DISCRETIONARY_FRAMEWORK");
  assert.equal(result.researchStatus?.liveTradingEligible, false);
});

test("executable setups carry a complete 2R trade plan while pending setups expose only a trigger", () => {
  const executable = runAlgorithmicStrategy("volume_breakout", {
    symbol: "TEST",
    currentPrice: 104.2,
    ma5: 104,
    ma10: 103,
    ma20: 102,
    ma50: 100,
    ma200: 90,
    rsi14: 60,
    maAlignment: "Strong Bullish",
    atr14: 1,
    volumeRatio: 2.1,
    priorHigh20: 104,
    priorLow20: 99,
    priorHigh60: 110,
    priorLow60: 90,
    ma20Slope: 1,
    ma50Slope: 0.4,
    relativeStrength20: 3,
  });
  assert.ok(executable);
  assert.equal(executable.tradeSetup.actionability, "EXECUTABLE");
  assert.ok(executable.entry! > executable.stopLoss!);
  assert.ok(executable.target! > executable.entry!);
  assert.ok(executable.tradeSetup.rewardRisk! >= 2);

  const pending = runAlgorithmicStrategy("shrink_pullback", {
    symbol: "TEST",
    currentPrice: 104.2,
    ma5: 104,
    ma10: 103,
    ma20: 102,
    ma50: 100,
    ma200: 90,
    rsi14: 60,
    maAlignment: "Strong Bullish",
    atr14: 1,
    volumeRatio: 1.15,
    priorHigh20: 104,
    priorLow20: 99,
    priorHigh60: 110,
    priorLow60: 90,
    ma20Slope: 1,
    ma50Slope: 0.4,
    relativeStrength20: 3,
    ohlc: { open: [103], high: [105], low: [102], close: [104.2], volume: [1_000_000] },
  });
  assert.ok(pending);
  assert.equal(pending.tradeSetup.actionability, "PENDING_TRIGGER");
  assert.equal(pending.entry, undefined);
  assert.equal(pending.stopLoss, undefined);
  assert.equal(pending.target, undefined);
  assert.match(pending.tradeSetup.nextStep, /等待|先滿足/);
});

test("algorithmic strategy tool preserves the API while exposing the downgrade status", async () => {
  const bars = makeBars(260);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        chart: {
          result: [{
            timestamp: bars.map((bar) => Date.parse(bar.date) / 1000),
            indicators: {
              quote: [{
                open: bars.map((bar) => bar.open),
                high: bars.map((bar) => bar.high),
                low: bars.map((bar) => bar.low),
                close: bars.map((bar) => bar.close),
                volume: bars.map((bar) => bar.volume),
              }],
            },
          }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    const tool = ALL_ANALYSIS_TOOLS.find((candidate) => candidate.name === "run_algorithmic_strategy");
    assert.ok(tool);
    const result = await tool.handler({ stock_code: "TEST", strategy_name: "wave_theory" });
    assert.equal(result.signal, BuySignal.WAIT);
    assert.equal((result.researchStatus as { classification?: string }).classification, "DISCRETIONARY_FRAMEWORK");

    const theoryTool = ALL_ANALYSIS_TOOLS.find((candidate) => candidate.name === "read_financial_theory");
    assert.ok(theoryTool);
    const theory = await theoryTool.handler({ strategy_name: "wave_theory" });
    assert.equal(
      (theory.research_status as { institutional_gate?: string }).institutional_gate,
      "NOT_ELIGIBLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("walk-forward gate never treats a fixed rule as approved without explicit evidence", () => {
  const report = runStrategyWalkForward("ma_golden_cross", makeBars());
  assert.notEqual(report.gate.status, "PASS");
  assert.equal(report.parameterSelection, "none_fixed_rules");
});

test("audit CLI records declared source, deterministic seed state, and output artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "quant-strategy-audit-"));
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "report.json");
  const replayPath = join(directory, "replay.json");
  try {
    writeFileSync(
      inputPath,
      JSON.stringify({
        dataSource: "synthetic test fixture",
        universe: "TEST",
        config: { commissionBps: 2 },
        bars: makeBars(),
      }),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/quant-strategy-audit.ts", "--input", inputPath, "--output", outputPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const artifact = JSON.parse(readFileSync(outputPath, "utf8")) as {
      reproducibility: { dataSource: string; randomSeed: null; normalizedBarSha256: string };
      suite: { reports: Array<{ config: { commissionBps: number } }> };
    };
    assert.equal(artifact.reproducibility.dataSource, "synthetic test fixture");
    assert.equal(artifact.reproducibility.randomSeed, null);
    assert.equal(artifact.suite.reports.length, 11);
    assert.equal(artifact.suite.reports[0].config.commissionBps, 2);

    const replay = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/quant-strategy-audit.ts", "--input", outputPath, "--output", replayPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(replay.status, 0, replay.stderr);
    const replayArtifact = JSON.parse(readFileSync(replayPath, "utf8")) as {
      reproducibility: { normalizedBarSha256: string };
      suite: { reports: Array<{ config: { commissionBps: number } }> };
    };
    assert.equal(replayArtifact.reproducibility.normalizedBarSha256, artifact.reproducibility.normalizedBarSha256);
    assert.equal(replayArtifact.suite.reports[0].config.commissionBps, 2);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
