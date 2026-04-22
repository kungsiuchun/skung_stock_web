/**
 * /api/trading-agent/query — Multi-Agent Trading Orchestrator Endpoint
 *
 * Accepts POST with:
 *   { stock_code: string }
 *
 * Returns:
 *   { success: boolean, results: TradingAgentResult }
 */

import type { PagesFunction } from "@cloudflare/workers-types";
import { TradingAgentOrchestrator, OrchestratorEnv } from "../agent/trading-agent-orchestrator";

export const onRequestPost: PagesFunction<OrchestratorEnv> = async (context) => {
  try {
    const body = await context.request.json() as { stock_code?: string };
    const stock_code = body.stock_code?.trim().toUpperCase();

    if (!stock_code) {
      return jsonResponse({ error: "No stock_code provided" }, 400);
    }

    const apiKey = context.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "OpenRouter API Key not configured" }, 500);
    }

    // Initialize orchestrator with env (to pass keys like ALPHA_VANTAGE_API_KEY down)
    const orchestrator = new TradingAgentOrchestrator(context.env);
    
    // Execute Map-Reduce Multi-Agent logic
    const results = await orchestrator.run(stock_code);

    return jsonResponse({
      success: results.success,
      results,
      error: results.error
    });

  } catch (error: any) {
    console.error("[TradingAgent API] Error:", error);
    return jsonResponse({ error: error?.message || "Internal Server Error" }, 500);
  }
};

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
