import type { ToolDefinition } from "../types";
import { validateDashboardDecision } from "../../../../src/lib/finance-dashboard-ai-decision";

const recordDashboardDecision = async (args: Record<string, unknown>) => {
  const decision = validateDashboardDecision({
    trend: args.trend,
    action: args.action,
    rationale: args.rationale,
    evidence: args.evidence,
  });

  if (decision.status === "unavailable") {
    console.warn(`[FinanceDashboardDecision] rejected reason=${decision.reason}`);
    return { error: decision.reason };
  }

  console.log(
    `[FinanceDashboardDecision] recorded trend=${decision.trend} action=${decision.action} evidence=${decision.evidence.length}`,
  );
  return {
    status: "recorded",
    decision,
    next_step:
      "Decision recorded. Do not reply with a confirmation. Return the complete five-section Traditional Chinese report with quote, options, quant, contradiction, risk, and trade guidance now.",
  };
};

export const dashboardDecisionTool: ToolDefinition = {
  name: "record_dashboard_decision",
  description:
    "Record the final Finance Dashboard AI decision only after quote, options, and quantitative strategy tools have returned. Submit only evidence directly supported by those tool results. This tool is not the final user response: after it succeeds, you must write the complete five-section Traditional Chinese report, never a confirmation sentence.",
  parameters: [
    {
      name: "trend",
      type: "string",
      enum: ["bullish", "bearish", "range"],
      description: "AI trend verdict from the collected evidence.",
    },
    {
      name: "action",
      type: "string",
      enum: ["buy", "wait", "sell"],
      description: "AI action verdict from the collected evidence.",
    },
    {
      name: "rationale",
      type: "string",
      description: "A concise Traditional Chinese rationale, 10 to 280 characters.",
    },
    {
      name: "evidence",
      type: "array",
      description:
        "At least two evidence objects shaped as { source: quote|options|quant, fact: concise factual support }. Cite at least two distinct source types.",
    },
  ],
  handler: recordDashboardDecision,
  category: "analysis",
};
