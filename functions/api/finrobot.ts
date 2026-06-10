/**
 * /api/finrobot — FinRobot Multi-Agent Integration
 *
 * Simulates the "Perception -> Brain -> Action" multi-agent flow
 * from ai4finance-foundation/finrobot but natively in TS using
 * the Cloudflare Workers backend.
 */

import type { PagesFunction } from "@cloudflare/workers-types";
import { ToolRegistry } from "./agent/registry";
import { OpenRouterAdapter } from "./agent/llm-adapter";
import { AgentExecutor } from "./agent/executor";
import { ALL_STOCK_TOOLS } from "./agent/tools/stock-tools";
import { ALL_ANALYSIS_TOOLS } from "./agent/tools/analysis-tools";
import { ALL_SEARCH_TOOLS } from "./agent/tools/search-tools";
import { ALL_RETAIL_TOOLS } from "./agent/tools/retail-tools";

interface Env {
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  ADANOS_API_KEY: string;
}

type AgentProfileId = "finrobot" | "buffett";

const FINROBOT_COT_PROMPT = `You are the Brain module of the FinRobot system, an advanced autonomous financial analyst. 
Your task is to orchestrate a "Perception -> Brain -> Action" workflow over multiple steps.

Phase 1 (Perception): You MUST precisely mimic the open-source FinRobot Python data pipeline by fetching the following 5 pillars of data before proceeding:
1. Fundamental Data: Use 'get_financial_summary' to gather Income Statements, Balance Sheets, Cash Flows, and Valuation Multiples (P/E, PEG).
2. Price & Technicals: Use 'get_daily_history' or 'calculate_ma' to understand historical trends.
3. Quantitative Signals: Use 'run_algorithmic_strategy' with strategy_name='all' to automatically evaluate all 11 proprietary quant models (e.g., bull_trend, chan_theory, volume_breakout).
4. Market Sentiment: Use 'get_retail_sentiment' to natively fetch and compute retail activity insights across Reddit, X, and Polymarket.
5. Market Catalysts: Use 'search_stock_news' to find recent news and catalysts.

Phase 2 (Brain): Apply Financial Chain-of-Thought (CoT) processes to evaluate the financials, DCF assumptions, technical trends, and risks based exactly on the data retrieved in Phase 1. Do not hallucinate data.

Phase 3 (Action): Generate a highly detailed, professional Equity Research Report formatted entirely in Markdown. 
The report MUST include:
# [Company Name/Ticker] Equity Research Report
## Executive Summary
## Financial & Valuation Analysis
## Quantitative Strategy Signals
## Retail Sentiment & Options Market Expectations
## Key Catalysts & News
## Final Recommendation

Always respond in Markdown. If you don't have enough data, explicitly mention what is missing.`;

const BUFFETT_QUALITY_PROMPT = `You are a Buffett-style long-term investment quality auditor.
Your job is not to predict next week's stock price. Your job is to force a disciplined quality review before any long-term capital is committed.

Start with this mandatory checklist and answer every item directly:
1. Is this company a good business?
2. Does it have a durable moat?
3. Are cash flows reliable and economically real?
4. Is management trustworthy and shareholder-oriented?
5. Does the current price offer a margin of safety?

Data-gathering protocol:
1. Use get_financial_summary for income statement, balance sheet, cash flow, valuation multiples, and debt context.
2. Use get_daily_history or get_realtime_quote only to anchor current price and valuation context, not to make a trading call.
3. Use search_stock_news for recent management, governance, moat, regulation, product, or capital allocation evidence.
4. Use get_retail_sentiment only as a behavioral risk input. Sentiment never overrides business quality.
5. Use run_algorithmic_strategy only if it helps identify price risk. Do not let technical signals dominate the verdict.

Analysis rules:
- Apply circle of competence first. If the business cannot be explained in one paragraph, say it is outside the circle and stop after the required checklist.
- Treat management integrity problems as an automatic veto.
- Distinguish franchise businesses from commodity businesses.
- Check moat type and moat trend: widening, stable, or narrowing.
- Estimate owner earnings qualitatively when exact maintenance capex is unavailable; explicitly state the missing data.
- Require a margin of safety. If intrinsic value cannot be estimated with reasonable confidence, the answer is "watch" or "pass", not "buy".
- Use Traditional Chinese.
- Do not hallucinate missing metrics. Mark missing data plainly.

The report MUST be Markdown and MUST include every section below:
# [Company/Ticker] Buffett Quality Review
## Conclusion
[Buy / Don't Buy / Keep Watching / Hold / Sell] - one direct sentence.

## Mandatory Quality Checklist
- Good business?
- Moat?
- Reliable cash flow?
- Trustworthy management?
- Margin of safety?

## Circle of Competence
[Inside circle / Outside circle / Boundary] plus one paragraph explaining how the business makes money.

## Key Assumptions
List 3-5 assumptions the decision depends on.

## Business Quality
- Moat type, strength, and trend
- Franchise / commodity / hybrid
- Pricing power
- Durability over a 10-year holding period

## Management & Capital Allocation
- Integrity signals
- Capital allocation record
- Buybacks, dividends, dilution, and debt discipline

## Financial Snapshot
- ROIC or proxy
- Cash conversion
- Debt safety in a revenue -30% stress case
- Owner earnings estimate or data gap

## Valuation & Margin of Safety
- Intrinsic value range or why it cannot be estimated
- Current margin of safety
- Suggested entry price or watch condition

## Sell Criteria Check
1. Price severely overvalued?
2. Fundamental moat destruction?
3. Management integrity issue?
4. Significantly better opportunity available?

## Key Risks
Top 3 risks only.

## Monitoring Indicators
- Quarterly checks
- Sell triggers

## Final Verdict
Direct long-term investor decision.`;

const AGENT_PROFILES: Record<AgentProfileId, { label: string; prompt: string; userMessage: (ticker: string) => string; maxSteps: number }> = {
  finrobot: {
    label: "FinRobot Analyst",
    prompt: FINROBOT_COT_PROMPT,
    maxSteps: 8,
    userMessage: (ticker) =>
      `Please execute a full FinRobot equity research analysis on "${ticker}". Gather market data, run financial CoT, and output the final markdown report.`,
  },
  buffett: {
    label: "Buffett Quality Auditor",
    prompt: BUFFETT_QUALITY_PROMPT,
    maxSteps: 10,
    userMessage: (ticker) =>
      `Run a Buffett-style long-term investment quality review on "${ticker}". Force the mandatory quality checklist, gather first-hand financial and news evidence with tools, and output the final markdown report.`,
  },
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as { ticker: string; agentProfile?: AgentProfileId };
    const ticker = body.ticker?.trim().toUpperCase();
    const profileId: AgentProfileId = body.agentProfile === "buffett" ? "buffett" : "finrobot";
    const profile = AGENT_PROFILES[profileId];

    if (!ticker) {
      return jsonResponse({ error: "No ticker provided" }, 400);
    }

    const apiKey = context.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "OpenRouter API Key not configured" }, 500);
    }

    const model = context.env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free";

    // Initialize all our tools (simulating FinRobot's Data Source utilities)
    const registry = new ToolRegistry();
    registry.setEnv(context.env);
    registry.registerAll(ALL_STOCK_TOOLS);
    registry.registerAll(ALL_ANALYSIS_TOOLS);
    registry.registerAll(ALL_SEARCH_TOOLS);
    registry.registerAll(ALL_RETAIL_TOOLS);

    const adapter = new OpenRouterAdapter({ apiKey, model });
    
    // Inject the selected report-generation profile.
    const executor = new AgentExecutor(registry, adapter, {
      maxSteps: profile.maxSteps,
      skillInstructions: profile.prompt,
    });

    const userMessage = profile.userMessage(ticker);
    
    console.log(`[FinRobot Endpoint] Starting ${profile.label} analysis for ${ticker}...`);

    const result = await executor.run(userMessage);

    return jsonResponse({
      success: result.success,
      agentProfile: profileId,
      agentLabel: profile.label,
      report: result.content,
      steps: result.steps,
      error: result.error,
    });
  } catch (error: any) {
    console.error("[FinRobot Endpoint] Error:", error);
    return jsonResponse({ error: error?.message || "Internal Server Error" }, 500);
  }
};

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
