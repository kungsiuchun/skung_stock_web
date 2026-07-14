import assert from "node:assert/strict";
import test from "node:test";

import { AgentExecutor } from "../functions/api/agent/executor";
import { ToolRegistry } from "../functions/api/agent/registry";
import { validateDashboardNarrative } from "../src/lib/finance-dashboard-narrative";

const completeReport = `## 即時行情
quote 顯示最新價格 317.31 美元，日內變動 +0.63%，成交量維持正常，市場處於反彈階段但未確認突破。

## 期權鏈分析
options chain 的 $320 call open interest 構成阻力，$310 put open interest 提供支撐；隱含波動率顯示事件風險仍高。

## 量化策略分析
11 個 deterministic quant strategies 分數由 75 至 25，最高分為多頭趨勢，最低分提示動能不足；均線與箱體策略出現衝突，主要 reasons 是排列改善，主要 risks 是阻力位成交量不足。

## 綜合分析結論
Quote、options、quant evidence 支持溫和看升而非追價。策略矛盾與風險包括阻力失敗、波動率上升和跌穿支撐，AI Trend／Action 必須受這些條件約束。

## 交易建議
等待 $310 至 $320 區間確認後再分段部署，跌穿支撐即降低曝險並設定 stop loss；這不是由單一算法分數製造的保證。若價格突破 $320 但成交量未跟上，仍應視為假突破，並重新檢查 options flow、量化策略分布及市場風險，避免把短線反彈誤當成趨勢反轉。
`;

test("executor requires the dashboard decision tool before accepting a final answer", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "record_dashboard_decision",
    description: "Test-only structured decision recorder.",
    parameters: [],
    handler: async () => ({ status: "recorded" }),
  });

  const responses = [
    { content: "Here is a narrative without a tool call.", tool_calls: [], model: "test" },
    {
      content: null,
      tool_calls: [{ id: "decision-1", name: "record_dashboard_decision", arguments: {} }],
      model: "test",
    },
    { content: "Structured decision submitted.", tool_calls: [], model: "test" },
  ];
  const adapter = {
    callWithTools: async () => responses.shift()!,
  };

  const executor = new AgentExecutor(registry, adapter as any, {
    maxSteps: 3,
    requiredFinalToolName: "record_dashboard_decision",
  });
  const result = await executor.run("Analyze AAPL");

  assert.equal(result.success, true);
  assert.equal(result.content, "Structured decision submitted.");
  assert.equal(result.steps.filter((step) => step.tool_name === "record_dashboard_decision").length, 1);
});

test("executor keeps a valid pre-decision narrative when final response is only confirmation", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "record_dashboard_decision",
    description: "Test-only structured decision recorder.",
    parameters: [],
    handler: async () => ({ status: "recorded" }),
  });

  const responses = [
    { content: completeReport, tool_calls: [], model: "test" },
    {
      content: null,
      tool_calls: [{ id: "decision-2", name: "record_dashboard_decision", arguments: {} }],
      model: "test",
    },
    { content: "已成功記錄 Dashboard 決策。", tool_calls: [], model: "test" },
  ];
  const adapter = { callWithTools: async () => responses.shift()! };
  const executor = new AgentExecutor(registry, adapter as any, {
    maxSteps: 3,
    requiredFinalToolName: "record_dashboard_decision",
    requiredFinalContentValidator: validateDashboardNarrative,
  });

  const result = await executor.run("Analyze AAPL");

  assert.equal(result.success, true);
  assert.equal(result.content, completeReport);
  assert.equal(result.steps.at(-1)?.type, "final_answer");
  assert.equal(result.steps.at(-1)?.content, completeReport);
});
