/**
 * Agent Framework — ReAct Loop Executor
 * Mirrors the Python blueprint's AgentExecutor._run_loop().
 *
 * Flow:
 *   1. Build messages (system + user)
 *   2. Loop: call LLM → if tool_calls → execute → append results → repeat
 *   3. If LLM returns pure content → that's the Final Answer → exit
 *   4. If max_steps exceeded → error
 */

import type {
  ChatMessage,
  AgentResult,
  AgentStep,
  OpenAIToolCall,
} from "./types";
import { ToolRegistry } from "./registry";
import { OpenRouterAdapter } from "./llm-adapter";
import { LoggerHook, type AgentHook } from "./hooks";

const ANALYSIS_SYSTEM_PROMPT = `你是一位專業的金融分析師 AI 助手。

你可以使用以下工具來獲取和分析股票數據。
請先使用工具獲取數據，然後根據數據進行分析。

分析框架：
1. **數據收集** — 使用工具獲取即時行情和歷史數據
2. **技術分析** — 計算均線、觀察趨勢
3. **綜合判斷** — 根據數據給出買入/觀望/賣出建議

重要規則：
- 你必須先調用工具獲取數據，不要憑空編造數據
- 最終回答請使用繁體中文
- 回答要條理清晰，包含數據佐證`;

export const CHAT_SYSTEM_PROMPT = `你是一位專業的金融分析師 AI 助手，用戶正在與你進行多輪對話。

你可以使用以下工具來獲取和分析股票數據：
- get_realtime_quote：獲取即時行情
- get_daily_history：獲取歷史 K 線數據
- calculate_ma：計算均線
- analyze_trend：綜合技術趨勢分析（MA、RSI、成交量）
- run_algorithmic_strategy：執行特定的量化策略算法。可用 strategy_name 包括：
  bull_trend, ma_golden_cross, shrink_pullback, box_oscillation, volume_breakout,
  dragon_head, emotion_cycle, chan_theory, wave_theory, one_yang_three_yin, bottom_volume
- get_financial_summary：獲取公司基本面數據
- get_options_chain：獲取期權鏈數據
- search_stock_news：搜索股票相關新聞
- get_fund_flow：獲取股票資金流向（主力、散戶比例）
- get_alphaear_news：獲取財聯社、雪球等實時金融熱點
- get_financial_signals：獲取 DeepEar 高頻金融預警信號
- get_retail_sentiment：獲取 Reddit/X 等零售情緒數據

對話規則：
- 當用戶詢問股票相關問題時，你應該主動使用工具獲取數據
- 當用戶選擇了特定策略模式時，你必須使用 run_algorithmic_strategy 工具執行對應策略
- 你可以基於之前對話中已獲取的數據來回答後續問題
- 最終回答請使用繁體中文
- 保持專業但友善的對話風格`;

export interface ExecutorConfig {
  maxSteps?: number;
  skillInstructions?: string;
  hooks?: AgentHook[];
}

export class AgentExecutor {
  private registry: ToolRegistry;
  private adapter: OpenRouterAdapter;
  private maxSteps: number;
  private skillInstructions: string;
  private hooks: AgentHook[];

  constructor(
    registry: ToolRegistry,
    adapter: OpenRouterAdapter,
    config?: ExecutorConfig
  ) {
    this.registry = registry;
    this.adapter = adapter;
    this.maxSteps = config?.maxSteps ?? 5;
    this.skillInstructions = config?.skillInstructions || "";
    this.hooks = config?.hooks || [new LoggerHook()];
  }

  /**
   * Run the ReAct loop for a given user input.
   */
  async run(userInput: string): Promise<AgentResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT + "\n" + this.skillInstructions },
      { role: "user", content: userInput },
    ];

    return this.reactLoop(messages);
  }

  /**
   * Chat mode — run the ReAct loop with existing conversation history.
   * Mirrors the Python blueprint's `chat()` entry point.
   */
  async chat(history: ChatMessage[], newMessage: string): Promise<AgentResult> {
    // Build messages: system prompt + prior conversation + new user message
    const messages: ChatMessage[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT + "\n" + this.skillInstructions },
      ...history,
      { role: "user", content: newMessage },
    ];

    return this.reactLoop(messages);
  }

  // ── Private: Core ReAct Loop ──────────────────────────────────────

  private async reactLoop(messages: ChatMessage[]): Promise<AgentResult> {
    const toolDecls = this.registry.toOpenAITools();
    const steps: AgentStep[] = [];
    const new_memories: string[] = [];

    console.log(`[Agent] Starting ReAct loop. Tools: [${this.registry.getToolNames().join(", ")}]`);

    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`[Agent] ── Step ${step + 1} ──`);

      // 1. Call LLM
      const response = await this.adapter.callWithTools(messages, toolDecls);

      // 2. Check if LLM wants to call tools
      if (response.tool_calls.length > 0) {
        console.log(
          `[Agent] LLM requested ${response.tool_calls.length} tool(s): ${response.tool_calls.map((tc) => tc.name).join(", ")}`
        );

        // Build assistant message with tool_calls
        const assistantToolCalls: OpenAIToolCall[] = response.tool_calls.map(
          (tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })
        );

        messages.push({
          role: "assistant",
          content: response.content,
          tool_calls: assistantToolCalls,
        });

        // 3. Execute tools in parallel (chunked to protect downstream limits) with Hooks
        const CHUNK_SIZE = 3;
        const results: { tc: typeof response.tool_calls[0]; resultStr: string; success: boolean; duration: number }[] = [];

        for (let i = 0; i < response.tool_calls.length; i += CHUNK_SIZE) {
          const chunk = response.tool_calls.slice(i, i + CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(async (tc) => {
              const execContext = {
                toolName: tc.name,
                toolArgs: JSON.stringify(tc.arguments),
                toolId: String(tc.id),
                timestamp: Date.now(),
              };

              // PreToolUse Hook
              for (const hook of this.hooks) {
                if (hook.preToolUse) await hook.preToolUse(execContext);
              }

              let resultStr: string;
              let success = true;
              let error: Error | undefined;

              try {
                // Special Case: delegate_task (Internal Handling)
                if (tc.name === "delegate_task") {
                  const subRole = tc.arguments.role;
                  const subTask = tc.arguments.task_description;
                  console.log(`[Agent] Swarm Delegation: ${subRole} -> ${subTask.slice(0, 50)}...`);
                  
                  // Create an isolated sub-executor with the same registry and adapter
                  const subExecutor = new AgentExecutor(this.registry, this.adapter, {
                    maxSteps: 5,
                    skillInstructions: `You are the ${subRole}. Complete this task: ${subTask}`
                  });
                  const subResult = await subExecutor.run(subTask);
                  resultStr = subResult.content;
                } else {
                  const result = await this.registry.execute(tc.name, tc.arguments);
                  
                  // Special Case: save_user_memory
                  if (tc.name === "save_user_memory" && result.fact) {
                    new_memories.push(result.fact);
                  }
                  
                  resultStr = JSON.stringify(result, null, 0);
                }
              } catch (err: any) {
                error = err;
                resultStr = JSON.stringify({ error: err.message });
                success = false;
              }

              const duration = Date.now() - execContext.timestamp;

              // PostToolUse Hook
              for (const hook of this.hooks) {
                if (hook.postToolUse) await hook.postToolUse(execContext, success ? resultStr : undefined, error);
              }

              return { tc, resultStr, success, duration };
            })
          );
          results.push(...chunkResults);
        }

        for (const res of results) {
          // Backward compatibility console log in executor
          console.log(
            `[Agent]   → ${res.tc.name}(${JSON.stringify(res.tc.arguments)}) → ${res.success ? "OK" : "FAIL"} (${res.duration}ms)`
          );

          // Record step
          steps.push({
            step: step + 1,
            type: "tool_call",
            tool_name: res.tc.name,
            tool_args: res.tc.arguments,
            tool_result: res.resultStr, // Do not truncate, UI needs full data
          });

          // Append tool result message
          messages.push({
            role: "tool",
            tool_call_id: res.tc.id,
            name: res.tc.name,
            content: res.resultStr,
          });
        }

        // Continue loop — LLM will see tool results next iteration
        continue;
      }

      // 4. No tool calls → Final Answer
      const finalContent = response.content || "No analysis generated.";
      console.log(`[Agent] Final answer received (${finalContent.length} chars)`);

      steps.push({
        step: step + 1,
        type: "final_answer",
        content: finalContent,
      });

      return {
        success: true,
        content: finalContent,
        steps,
        new_memories: new_memories.length > 0 ? new_memories : undefined,
      };
    }

    // Max steps exceeded
    console.warn(`[Agent] Max steps (${this.maxSteps}) exceeded!`);
    return {
      success: false,
      content: "分析步驟超過上限，請稍後重試。",
      steps,
      error: `Exceeded max_steps (${this.maxSteps})`,
    };
  }
}
