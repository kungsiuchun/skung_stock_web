import { ToolRegistry } from "./registry";
import { AgentExecutor } from "./executor";
import { OpenRouterAdapter } from "./llm-adapter";

import { ALL_STOCK_TOOLS } from "./tools/stock-tools";
import { ALL_ANALYSIS_TOOLS } from "./tools/analysis-tools";
import { ALL_SEARCH_TOOLS } from "./tools/search-tools";
import { ALL_RETAIL_TOOLS } from "./tools/retail-tools";
import { ALL_FUNDAMENTALS_TOOLS } from "./tools/fundamentals-tools";
import { macroTools } from "./tools/macro-tools";

export interface OrchestratorEnv {
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  ALPHA_VANTAGE_API_KEY?: string;
  ADANOS_API_KEY?: string;
}

export interface TradingAgentResult {
  symbol: string;
  fundamentals_report: string;
  market_report: string;
  sentiment_report: string;
  quant_report: string;
  manager_report: string;
  success: boolean;
  error?: string;
}

export class TradingAgentOrchestrator {
  private adapter: OpenRouterAdapter;
  private env: OrchestratorEnv;

  constructor(env: OrchestratorEnv) {
    this.env = env;
    this.adapter = new OpenRouterAdapter({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free",
    });
  }

  // Helper to create an executor for a specific role
  private createExecutor(tools: any[], systemPrompt: string, roleName: string): AgentExecutor {
    // We bind the env to the handlers out of band if needed, 
    // actually our handlers take `env` as second param in the execute function?
    // Wait, the `ToolRegistry` usually just runs `handler(args, env)`.
    const registry = new ToolRegistry();
    registry.registerAll(tools);
    // Note: To pass env to handlers, we might need a small modification in ToolRegistry
    // Let's assume we can inject global fallback or modify the tools. 
    // We will ensure our tool functions read from `this.env` if possible or fallback.
    // In our fundamentals-tools, it uses a fallback. We can also pass `env` through the ReAct loop if needed, 
    // but right now ToolRegistry doesn't take context easily unless we override.
    // For now, it will use the fallback or global context.
    
    // We'll wrap the registry's execute method to pass `env`.
    // We'll patch it below.

    const originalExecute = registry.execute.bind(registry);
    registry.execute = async (name: string, args: any) => {
      // Find tool
      const toolDef = tools.find(t => t.name === name);
      if (toolDef) {
         return toolDef.handler(args, this.env);
      }
      return originalExecute(name, args);
    };

    return new AgentExecutor(registry, this.adapter, { maxSteps: 5, skillInstructions: systemPrompt });
  }

  async run(symbol: string): Promise<TradingAgentResult> {
    console.log(`[Orchestrator] Starting multi-agent analysis for ${symbol} ...`);
    
    // --- 1. Fundamentals Analyst ---
    const fundamentalPrompt = `你是一位基本面與宏觀經濟分析師。
任務：使用工具取得 ${symbol} 的公司基本面、利潤表和資產負債表。如果適合，也可以使用 get_fred_series 取得最新的宏觀經濟數據 (如 GDP, UNRATE, CPIAUCSL)。
你必須給出一份詳細的 Markdown 報告，列出公司的財務健康狀況、估值指標（本益比、EPS等）、現金流狀況，以及內部成長潛力與宏觀環境影響。請使用繁體中文。`;
    const fundamentalExecutor = this.createExecutor([...ALL_FUNDAMENTALS_TOOLS, ...macroTools], fundamentalPrompt, "Fundamentals Analyst");

    // --- 2. Market Analyst ---
    const marketPrompt = `你是一位市場技術分析師與量化策略師。
任務：使用你的工具獲取 ${symbol} 的技術指標（例如 get_realtime_quote, calculate_ma, analyze_trend）。
給出一份 Markdown 報告，評論當前技術圖表排列（多頭/空頭）、RSI強弱、以及近期價格走勢。請使用繁體中文。`;
    const marketExecutor = this.createExecutor([...ALL_STOCK_TOOLS, ...ALL_ANALYSIS_TOOLS], marketPrompt, "Market Analyst");

    // --- 3. Sentiment Analyst ---
    const sentimentPrompt = `你是一位新聞與市場情緒分析師。
任務：使用 search_stock_news (可能的話 get_retail_sentiment) 獲取 ${symbol} 的近期新聞、催化劑與散戶情緒。
給出一份 Markdown 報告，總結推動股價背後的消息面與情緒指標。請使用繁體中文。`;
    const sentimentExecutor = this.createExecutor([...ALL_SEARCH_TOOLS, ...ALL_RETAIL_TOOLS], sentimentPrompt, "Sentiment Analyst");

    // --- 4. Quant Analyst ---
    const quantPrompt = `你是一位量化策略分析師 (Quant Analyst)。
任務：使用 run_algorithmic_strategy 執行 ${symbol} 的「所有」策略 (將 strategy_name 設為 "all")。
找出當中得分最高或者最強烈暗示方向的策略，給出一份 Markdown 報告。列舉最適合當前市況的策略名稱、精確的進出場點位和止損位建議。請使用繁體中文。`;
    const quantExecutor = this.createExecutor(ALL_ANALYSIS_TOOLS, quantPrompt, "Quant Analyst");

    // Execute in parallel
    console.log(`[Orchestrator] Dispatching Analyst Agents for ${symbol} ...`);
    let fRes, mRes, sRes, qRes;
    try {
      [fRes, mRes, sRes, qRes] = await Promise.all([
        fundamentalExecutor.run(`請分析 ${symbol} 的基本面並產生報告。`),
        marketExecutor.run(`請分析 ${symbol} 的技術面並產生報告。`),
        sentimentExecutor.run(`請搜集 ${symbol} 的新聞情緒並產生報告。`),
        quantExecutor.run(`請運行 ${symbol} 的量化策略並產生報告。`)
      ]);
    } catch (err: any) {
      return {
        symbol,
        fundamentals_report: "",
        market_report: "",
        sentiment_report: "",
        quant_report: "",
        manager_report: "",
        success: false,
        error: `Parallel execution failed: ${err.message}`
      };
    }

    // --- 5. Portfolio Manager Synthesis ---
    const managerPrompt = `你是一位頂級投資組合經理 (Portfolio Manager)。
下屬的基本面、技術面、情緒面以及量化分析師已經提交了他們針對 ${symbol} 的報告。
任務：綜合這四份報告，交叉驗證他們的觀點，化解衝突，並生成一份最終且具有「強烈觀點」的交易決定（BUY / HOLD / SELL）。
請保持直接、客觀，不要使用模糊的語言，請用具體數據佐證。請使用繁體中文。`;

    const summaryInput = `
以下是各個分析師的報告：

【基本面分析報告】
${fRes.content}

【技術面分析報告】
${mRes.content}

【情緒面分析報告】
${sRes.content}

【量化策略分析報告】
${qRes.content}

請綜合以上資訊，給出最終分析與投資決策。
`;

    // Manager agent doesn't necessarily need tools here, just synthesizing.
    const managerExecutor = this.createExecutor([], managerPrompt, "Portfolio Manager");
    console.log(`[Orchestrator] Dispatching Portfolio Manager for ${symbol} ...`);
    const managerRes = await managerExecutor.run(summaryInput);

    return {
      symbol,
      fundamentals_report: fRes.content,
      market_report: mRes.content,
      sentiment_report: sRes.content,
      quant_report: qRes.content,
      manager_report: managerRes.content,
      success: managerRes.success,
      error: managerRes.error,
    };
  }
}
