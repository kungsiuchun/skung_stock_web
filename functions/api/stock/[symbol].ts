/**
 * /api/stock/[symbol] — Finance Chat Bot endpoint
 *
 * Now powered by the Agent Framework:
 *   ToolRegistry → OpenRouterAdapter → AgentExecutor (ReAct loop)
 *
 * The agent autonomously decides which tools to call (get_realtime_quote,
 * get_daily_history, calculate_ma) based on the user's request.
 */

import type { PagesFunction } from "@cloudflare/workers-types";
import { ToolRegistry } from "../agent/registry";
import { OpenRouterAdapter } from "../agent/llm-adapter";
import { AgentExecutor } from "../agent/executor";
import { ALL_STOCK_TOOLS } from "../agent/tools/stock-tools";

interface Env {
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const symbol = (context.params.symbol as string || "").toUpperCase();
    if (!symbol) {
      return jsonResponse({ error: "No symbol provided" }, 400);
    }

    const apiKey = context.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "OpenRouter API Key not configured" }, 500);
    }

    const model = context.env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free";

    // 1. Build Registry (register all stock tools)
    const registry = new ToolRegistry();
    registry.registerAll(ALL_STOCK_TOOLS);

    // 2. Build LLM Adapter
    const adapter = new OpenRouterAdapter({ apiKey, model });

    // 3. Build Executor
    const executor = new AgentExecutor(registry, adapter, { maxSteps: 5 });

    // 4. Run the agent
    const userInput = `請分析股票 ${symbol} 的最新走勢，包括即時行情、近期歷史數據和均線分析。最後給出買入/觀望/賣出的建議。`;

    console.log(`[API] Running agent for symbol: ${symbol}`);
    const result = await executor.run(userInput);

    return jsonResponse({
      success: result.success,
      symbol,
      analysis: result.content,
      steps: result.steps,
      error: result.error,
    });
  } catch (error: any) {
    console.error("Finance API Error:", error);
    return jsonResponse({ error: error?.message || "Internal Server Error" }, 500);
  }
};

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
