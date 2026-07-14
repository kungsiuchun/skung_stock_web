import assert from "node:assert/strict";
import test from "node:test";

import {
  getDashboardNarrativeStatus,
  validateDashboardNarrative,
} from "../src/lib/finance-dashboard-narrative";

const completeReport = `
## 即時行情
最新價格為 317.31 美元，日內變動 +0.63%，成交量與前一交易日比較維持正常，quote 顯示價格仍在近期反彈區間。市場狀態是買盤回補，但尚未形成無條件追價訊號。

## 期權鏈分析
Options chain 顯示 $320 call open interest 集中，構成上方阻力；$310 put open interest 提供支撐。Call／Put 分布與隱含波動率反映短線仍有事件風險，若跌穿支撐，期權槓桿會放大回撤。

## 量化策略分析
完整 11 個 deterministic quant strategies 的分布偏向多頭，但分數由 75 至 25 不等，最高分為多頭趨勢，最低分策略仍提示動能不足。多頭排列與箱體震盪策略互相矛盾，主要 reasons 是均線結構改善，主要 risks 是阻力位附近成交量未能同步放大。

## 綜合分析結論
Quote 的反彈、options 的 $320 阻力，以及 quant 分布共同支持溫和看升，而不是立即突破。策略矛盾代表訊號置信度有限；風險包括阻力失敗、波動率上升和跌穿 $310 支撐。AI Trend／Action 只在這些 evidence 上成立，並非由算法分數單獨接管。

## 交易建議
穩健交易者可等待價格在 $310 至 $320 之間確認突破，再按風險承受能力分段部署；若跌穿 $310，應降低曝險並重新評估。任何買入方案都要設定 stop loss，並承認 options、quote、quant evidence 仍可能快速反轉。
`;

test("complete five-section dashboard report passes validation", () => {
  assert.equal(validateDashboardNarrative(completeReport).valid, true);
  assert.deepEqual(getDashboardNarrativeStatus(completeReport), { status: "available" });
});

test("short decision confirmation fails closed", () => {
  const result = validateDashboardNarrative("已成功記錄 Dashboard 決策。決策摘要：趨勢判定：看多，行動建議：觀望。");
  assert.equal(result.valid, false);
});

test("missing required section fails closed", () => {
  const withoutTradingAdvice = completeReport.replace("## 交易建議", "## 其他");
  const result = validateDashboardNarrative(withoutTradingAdvice);
  assert.equal(result.valid, false);
  assert.match(result.reason, /交易建議/);
});

test("JSON and tool confirmations are not accepted as narrative", () => {
  assert.equal(validateDashboardNarrative(`{"status":"recorded","reply":"${"x".repeat(700)}"}`).valid, false);
  assert.equal(validateDashboardNarrative("Structured decision submitted.".repeat(100)).valid, false);
});

test("report without source evidence fails closed", () => {
  const noEvidence = completeReport
    .replaceAll("quote", "data")
    .replaceAll("Quote", "Data")
    .replaceAll("最新價格", "數值")
    .replaceAll("成交量", "活動")
    .replaceAll("市場狀態", "狀態")
    .replaceAll("Options", "Market")
    .replaceAll("options", "market")
    .replaceAll("open interest", "open data")
    .replaceAll("Call", "Side")
    .replaceAll("Put", "Side")
    .replaceAll("支撐", "位置")
    .replaceAll("阻力", "位置")
    .replaceAll("quant", "model")
    .replaceAll("Quant", "Model")
    .replaceAll("deterministic", "computed")
    .replaceAll("分數", "數值")
    .replaceAll("reasons", "notes")
    .replaceAll("策略", "方法")
    .replaceAll("風險", "狀況")
    .replaceAll("矛盾", "差異")
    .replaceAll("risks", "conditions");
  assert.equal(validateDashboardNarrative(noEvidence).valid, false);
});
