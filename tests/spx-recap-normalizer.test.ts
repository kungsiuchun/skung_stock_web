import assert from "node:assert/strict";
import test from "node:test";
import { buildDerivedAudit, normalizeRecapDay, type ActionLogItem } from "../src/lib/spx-recap-normalizer";

test("recap reports retain observed callout points without claiming executed options returns", () => {
  const day = normalizeRecapDay("2026-10-30", { actionLog: [
    { time: "2026/10/30 10:00:00", action: "觀望防守", price: 7634.55 },
    { time: "2026/10/30 10:15:00", action: "買入 Put", price: 7609.87 },
    { time: "2026/10/30 15:45:00", action: "平倉 PUT", price: 7557.14, pnl: 52.73 },
  ] });
  assert.equal(day.summary.tradesTaken, 1);
  assert.equal(day.summary.winRate, 100);
  assert.equal(day.summary.totalPnlPoints, 52.73);
  const report = buildDerivedAudit(day.date, day.timeline, day.summary);
  assert.match(report, /Callout 勝率（不含持平）：100%/);
  assert.match(report, /SPX 方向累計點數：\+52\.73 pts/);
  assert.ok(report.includes("並非券商成交、選擇權損益或扣費後報酬"));
  assert.doesNotMatch(report, /真實交易勝率|實際出手|淨 PnL/);
});

test("missing or nonnumeric wire values cannot create a flat close or a zero SPX price", () => {
  for (const missing of [undefined, null, "", " ", true, false, [], Number.NaN, Number.POSITIVE_INFINITY]) {
    const day = normalizeRecapDay("2026-10-30", { actionLog: [
      { action: "觀望防守", price: missing, pnl: missing },
      { action: "買入 Put", price: missing, pnl: missing },
      { action: "平倉 PUT", price: missing, pnl: missing },
    ] as unknown as ActionLogItem[] });
    assert.deepEqual(day.timeline.map(row => row.status), ["defense", "entry", "pending"]);
    assert.ok(day.timeline.every(row => row.price === null && row.pnl === null));
    assert.equal(day.summary.flatCloses, 0);
    assert.equal(day.summary.winRate, null);
  }
});

test("genuine zero points remain a flat close and numeric legacy strings stay valid", () => {
  for (const value of [0, "0"]) {
    const day = normalizeRecapDay("2026-10-30", { actionLog: [{ action: "平倉 PUT", price: "7500.25", pnl: value }] as unknown as ActionLogItem[] });
    assert.equal(day.timeline[0].price, 7500.25);
    assert.equal(day.timeline[0].pnl, 0);
    assert.equal(day.summary.flatCloses, 1);
    assert.equal(day.summary.winRate, null);
  }
});
