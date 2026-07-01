/**
 * /api/agent/chat — Multi-turn Chat Endpoint
 *
 * Accepts POST with:
 *   { message: string, history: ChatMessage[] }
 *
 * Returns:
 *   { success, reply, steps, history }
 *
 * The frontend maintains conversation history and sends it with each request.
 * The executor runs the ReAct loop with the full history for context.
 */

// Minimal fallback types for Cloudflare Workers if @cloudflare/workers-types is missing
interface CFContext<E = any> {
  request: Request;
  env: E;
}
type PagesFunction<E = any> = (context: CFContext<E>) => Promise<Response>;

import type { ChatMessage } from "../agent/types";
import { ToolRegistry } from "../agent/registry";
import { OpenRouterAdapter } from "../agent/llm-adapter";
import { AgentExecutor } from "../agent/executor";
import { ALL_STOCK_TOOLS } from "../agent/tools/stock-tools";
import { ALL_ANALYSIS_TOOLS } from "../agent/tools/analysis-tools";
import { ALL_SEARCH_TOOLS } from "../agent/tools/search-tools";
import { ALL_ALPHAEAR_TOOLS } from "../agent/tools/alphaear-tools";
import { ALL_RETAIL_TOOLS } from "../agent/tools/retail-tools";
import { macroTools } from "../agent/tools/macro-tools";
import { SkillManager } from "../agent/skills/base";

interface Env {
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  ADANOS_API_KEY?: string;
  FRED_API_KEY?: string;
}

const DASHBOARD_TOOL_ALLOWLIST = new Set([
  "get_realtime_quote",
  "get_options_chain",
  "run_algorithmic_strategy",
]);

const onlyAllowedDashboardTools = (tools: any[]) =>
  tools.filter((tool) => DASHBOARD_TOOL_ALLOWLIST.has(tool.name));

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as {
      message?: string;
      history?: ChatMessage[];
      strategy_mode?: string;
      user_memories?: string[];
      surface?: "finance_dashboard" | "finance_chat";
    };

    let message = body.message?.trim();
    if (!message) {
      return jsonResponse({ error: "No message provided" }, 400);
    }

    const isFinanceDashboard = body.surface === "finance_dashboard";

    // Force LLM to run algos if the user picked an algorithmic strategy.
    // Dashboard requests use their own narrow prompt and tool allowlist.
    if (!isFinanceDashboard && body.strategy_mode && body.strategy_mode !== "default") {
      if (body.strategy_mode === "financial_expert") {
        message = `[用戶選擇了: 進階財務分析模式]
請使用 get_financial_summary 和 get_options_chain 工具，對目標標的進行深度的基本面與期權情緒分析。

用戶訊息：
${message}`;
      } else {
        message = `[用戶選擇了策略模式: ${body.strategy_mode}]
請「必須」同時使用 run_algorithmic_strategy (策略名稱: ${body.strategy_mode}) 及 get_retail_sentiment 工具，以獲取量化指標及散戶情緒數據。

用戶訊息：
${message}`;
      }
    }

    const apiKey = context.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "OpenRouter API Key not configured" }, 500);
    }

    const model = context.env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free";

    // 1. Build Agent & Tools
    const registry = new ToolRegistry();
    registry.setEnv(context.env);

    if (isFinanceDashboard) {
      registry.registerAll(onlyAllowedDashboardTools(ALL_STOCK_TOOLS));
      registry.registerAll(onlyAllowedDashboardTools(ALL_ANALYSIS_TOOLS));
      registry.registerAll(onlyAllowedDashboardTools(ALL_ALPHAEAR_TOOLS));
    } else {
      registry.registerAll(ALL_STOCK_TOOLS);
      registry.registerAll(ALL_ANALYSIS_TOOLS);
      registry.registerAll(ALL_SEARCH_TOOLS);
      registry.registerAll(ALL_ALPHAEAR_TOOLS);
      registry.registerAll(ALL_RETAIL_TOOLS);
      registry.registerAll(macroTools);
    }

    // 2. Initialize Strategy System
    const skillManager = new SkillManager();
    // Activate core skills for the "AI 智能分析" mode
    skillManager.activate(["bull_trend", "financial_expert"]); 
    const skillInstructions = skillManager.getSkillInstructions();

    // 2. Load user memories from request
    const userMemories: string[] = body.user_memories || [];
    const memoryContext = userMemories.length > 0 
      ? `\n### 用戶長期記憶 (User Memory):\n${userMemories.map(m => `- ${m}`).join("\n")}\n這些是關於用戶的已知事實，請在分析時參考。`
      : "";

    // 3. Setup Executor
    const adapter = new OpenRouterAdapter({ apiKey, model });
    const executor = new AgentExecutor(registry, adapter, { 
      maxSteps: isFinanceDashboard ? 6 : 10,
      skillInstructions: skillInstructions + memoryContext + (isFinanceDashboard
        ? "\nDashboard surface rule: use only the registered dashboard tools. Do not delegate to subagents, do not save user memory, do not request macro/search/retail tools, and label missing data instead of inventing fallback data."
        : "")
    });

    // 2. Sanitise history — only keep user & assistant messages (no system, tool etc.)
    const history: ChatMessage[] = (body.history || []).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    console.log(`[Chat API] message="${message.slice(0, 80)}" history=${history.length} memories=${userMemories.length}`);

    // 3. Run agent in chat mode
    const result = await executor.chat(history, message);

    // 4. Build updated history to send back to the frontend
    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: result.content },
    ];

    const replyContent = result.content && result.content.trim() ? result.content : "I couldn't generate a response. Please try rephrasing your question.";
    return jsonResponse({
      success: result.success,
      reply: replyContent,
      steps: result.steps,
      history: updatedHistory,
      new_memories: result.new_memories,
      meta: {
        surface: isFinanceDashboard ? "finance_dashboard" : "finance_chat",
        max_openrouter_calls: isFinanceDashboard ? 6 : 10,
        registered_tools: registry.getToolNames(),
      },
      error: result.error,
    });
  } catch (error: any) {
    console.error("[Chat API] Error:", error);
    return jsonResponse({ error: error?.message || "Internal Server Error" }, 500);
  }
};

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
