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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as { ticker: string };
    const ticker = body.ticker?.trim().toUpperCase();

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
    
    // Inject our custom CoT Prompt
    const executor = new AgentExecutor(registry, adapter, {
      maxSteps: 8, // Give it more steps to complete the deep analysis
      skillInstructions: FINROBOT_COT_PROMPT,
    });

    const userMessage = `Please execute a full FinRobot equity research analysis on "${ticker}". Gather market data, run financial CoT, and output the final markdown report.`;
    
    console.log(`[FinRobot Endpoint] Starting analysis for ${ticker}...`);

    const result = await executor.run(userMessage);

    return jsonResponse({
      success: result.success,
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
