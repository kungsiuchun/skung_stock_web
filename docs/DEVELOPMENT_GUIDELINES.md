# Agent Framework — Development Guidelines

> ⚠️ This document records **hard-won lessons** from production bugs.  
> Read this before making changes to the agent's tool system.

---

## Rule 1: No Duplicate Tool Names Across Files

**Date:** 2026-04-04  
**Bug:** "缺少 K 線數據" (Missing K-line data) — Chan Theory strategy always failed

### What Happened
Two separate files registered a tool with the **same name** (`run_algorithmic_strategy`):

| File | Handler | OHLC Data? |
|------|---------|------------|
| `analysis-tools.ts` (NEW) | Full OHLC + MACD + RSI | ✅ Yes |
| `strategy-tools.ts` (OLD) | Only MA/RSI from `analyze_trend` | ❌ No |

Because `chat.ts` registered them in order:
```typescript
registry.registerAll(ALL_ANALYSIS_TOOLS);  // new handler → registered
registry.registerAll(ALL_STRATEGY_TOOLS);  // old handler → OVERWRITES the new one!
```

The `ToolRegistry` uses a `Map<string, ToolDefinition>` — last write wins. The OLD handler silently replaced the NEW one.

### The Fix
Deleted `strategy-tools.ts` entirely. The correct handler lives in `analysis-tools.ts`.

### Prevention Rules
1. **Before creating a new tool:** `Select-String -Path "functions\**\*.ts" -Pattern "name: \"your_tool_name\""` to check for duplicates
2. **One tool, one file:** Each tool name must exist in exactly ONE file
3. **Never** copy-paste a tool handler into a new file — refactor the original instead

---

## Rule 2: Update System Prompts When Adding Tools

**Date:** 2026-04-04  
**Bug:** LLM refused to call `chan_theory` — said "system only has 6 strategies"

### What Happened
The `CHAT_SYSTEM_PROMPT` in `executor.ts` had a hardcoded list of only 3 tools:
```
- get_realtime_quote
- get_daily_history
- calculate_ma
```

Even though 10+ tools were registered in the `ToolRegistry`, the LLM's system prompt didn't mention them. The LLM treated unlisted tools as unavailable.

### Prevention Rules
1. **When adding a new tool:** Update `CHAT_SYSTEM_PROMPT` in `executor.ts`
2. **When adding a new strategy:** Update the `enum` array in the `strategy_name` parameter definition
3. The system prompt and tool definitions must stay **in sync**

---

## Rule 3: Tool Parameter `enum` Is Your Friend

When a tool parameter has a finite set of valid values (like strategy names), always use:
```typescript
{
  name: "strategy_name",
  type: "string",
  description: "...",
  enum: ["bull_trend", "chan_theory", ...]  // ← This constrains the LLM
}
```

This prevents the LLM from guessing or hallucinating invalid values.

---

## Rule 4: Defensively Cast API/LLM Payload Types

**Date:** 2026-04-05  
**Bug:** Dashboard Black Screen — `TypeError: entry.toFixed is not a function`

### What Happened
The backend framework's `get_realtime_quote` tool formatted prices using `.toFixed(2)` before returning them mathematically. This serialized the `price` field in the JSON `tool_result` as a **String** (e.g., `"177.39"`).

Meanwhile, the React frontend expected a `Number` because it had declared `let price = 0`. When it passed the parsed JSON string directly into a sub-component tracking `entry = price`, the component called `entry.toFixed(2)`. This immediately threw an unhandled TypeError in React (since strings lack a `.toFixed()` method), causing the entire App component tree to crash and rendering a completely blank/black screen.

### The Fix
Added rigid fallback logic and explicit type-casting wrapper strings on all numeric extractions from LLMs:
```typescript
const rawPrice = resJson.current_price || resJson.price || price;
price = typeof rawPrice === "string" ? parseFloat(rawPrice.replace(/[^0-9.]/g, '')) : Number(rawPrice);
```

### Prevention Rules
1. **Never trust types coming over the API/LLM boundary:** Even if an interface says `price: number`, JavaScript `JSON.parse` does not respect interfaces.
2. **Defensively cast before math:** Always wrap structural values from API returns as `Number(value)` or `String(value)` if they are crucial to UI rendering.
3. **Backend Tool Rule:** If a backend tool intends to return raw data, return raw numbers (e.g., `177.39`) instead of pre-formatted strings (`"177.39"`) unless explicitly intended and documented.

---

#---
 
 ## Rule 8: OpenRouter API Compliance (404 Avoidance)
 
 **Date:** 2026-04-17  
 **Bug:** 獅 Shark (Goldman): `接口錯誤(404)` — Agents failed to analyze SPX.
 
 ### What Happened
 Using a correct model ID (e.g., `google/gemma-4-26b-a4b-it:free`) but forgetting mandatory OpenRouter headers. On OpenRouter, a **404 Not Found** often means security or routing rejection due to missing identification.
 
 | Header | Mandatory? | Purpose |
 |--------|------------|---------|
 | `Authorization` | ✅ Yes | Bearer Token |
 | `HTTP-Referer` | ✅ Yes | Identifies your site for free model quotas |
 | `X-OpenRouter-Title` | ⚠️ Yes | Recommended identification (Preferred over `X-Title`) |
 
 ### The Fix
 Updated `worker-spx-bot.ts` to include all three mandatory headers and verified the model ID exactly against the [OpenRouter Models page](https://openrouter.ai/models).
 
 ### Prevention Rules
 1. **Model ID Veracity:** Never guess model strings. Check the URL of the model's API page.
 2. **Header Consistency:** Every `fetch` call to OpenRouter must identify the site.
 3. **Debug URL:** When testing, add `?debug=true` to the Worker URL to catch the exact error status code early.
 
 ---
 
 ## Rule 9: Human-Centric Data Precision (The "Decimal Rule")
 
 **Date:** 2026-04-17  
 **Bug:** SPX 現報 `7041.27978515625` — "Mother fker" ugly decimal points.
 
 ### What Happened
 Raw numeric data from APIs (like Yahoo Finance) often comes with high-precision floats. Passing these directly to the UI or LLM is unprofessional and creates visual clutter.
 
 | Value Type | Target Precision | Example |
 |------------|------------------|---------|
 | Stock Price | `.toFixed(2)` | `7041.28` |
 | RSI / MACD | `.toFixed(2)` | `60.82` |
 | Bandwidth % | `.toFixed(2)` + `%` | `0.39%` |
 
 ### The Fix
 Wrapped all numeric outputs in `.toFixed(2)` before passing them to the `message` template and LLM context.
 
 ### Prevention Rules
 1. **Context Sanitization:** Format data *before* it enters the `context` object passed to agents.
 2. **UI Rule:** Any figure shown to the user must be human-readable. If it has more than 3 decimal places, it's a bug.
 
 ---
 
 # Architecture Reference

### Tool Registration Flow
```
chat.ts
  └── registry.registerAll(ALL_STOCK_TOOLS)    → stock-tools.ts
  └── registry.registerAll(ALL_ANALYSIS_TOOLS) → analysis-tools.ts  ← strategies live here
  └── registry.registerAll(ALL_ALPHAEAR_TOOLS) → alphaear-tools.ts  ← fund flow/signals live here
  └── registry.registerAll(ALL_SEARCH_TOOLS)   → search-tools.ts
```

### Strategy Execution Flow
```
User selects strategy → chat.ts modifies prompt
  → LLM calls run_algorithmic_strategy tool
    → analysis-tools.ts handler fetches OHLC data
      → engine.ts runs deterministic strategy logic
        → Result returned to LLM for interpretation
```

### Key Files
| File | Responsibility |
|------|---------------|
| `executor.ts` | System prompt + ReAct loop |
| `analysis-tools.ts` | `analyze_trend` + `run_algorithmic_strategy` tools |
| `strategies/engine.ts` | 11 strategy classes + `runAlgorithmicStrategy()` |
| `strategies/indicators.ts` | EMA, MACD, RSI, Fibonacci calculations |
| `strategies/index.ts` | Strategy metadata (StrategySpec) for UI/prompts |

---

## Rule 5: Killing `dev:all` Does Not Kill Child Processes (Orphans)

**Date:** 2026-04-06
**Bug:** Updated `.dev.vars` failed to apply — backend continued querying old `qwen` model.

### What Happened
The project uses `concurrently` to run both Vite on `:5173` and Wrangler on `:8788`.
When the terminal process or `npm run dev:all` is terminated (e.g. by Ctrl+C or process kill), the actual `node` instances holding port `8788` (wrangler) often survive as **orphan processes** in the background. Because Wrangler was still running, it kept the *old* `.dev.vars` contents in memory. Restarting `dev:all` fails to replace the immortal background wrangler.

### The Fix
Need to forcefully kill processes occupying the specific ports rather than just the parent command.
PowerShell command used to clean up orphans:
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8788, 5173).OwningProcess | Stop-Process -Force
```

### Prevention Rules
1. **Changing `OPENROUTER_MODEL` or any var in `.dev.vars`:** Always ensure the Wrangler process is *completely* dead.
2. If the backend behaves like it has cached old env data, check `netstat -ano` for ghost processes on `8788`.
 
 ---
 
 ## Rule 6: Robust UI Data Binding & Score Synchronization
 
 **Date:** 2026-04-09  
 **Bug:** UI Score Inconsistency (47 vs 50) — Emotional Cycle Gauge didn't match report
 
 ### What Happened
 1. **Brittle Key Matching:** The code searched for specific strategy names (e.g., `if(name === "情緒")`) but the backend returned localized or modified names (`情緒週期(算法)`).
 2. **Default Score Trap:** `let score = 50` served as a default. When the parser failed to find/cast the backend score, it silently fell back to 50 instead of the actual `47` shown in the AI summary.
 3. **JSON Truncation:** Large tool results (e.g., 30 days of chart data) were occasionally truncated by the LLM proxy. `JSON.parse` threw an error, causing the entire step analysis to be skipped.
 
 ### The Fix
 1. **Fuzzy String Matching:** Use `.includes()` or standardized ID keys for UI component mapping.
 2. **Explicit Casting:** Always wrap numeric extractions with `Number()` and check for `!isNaN()` before assigning to UI state.
 3. **Truncation Handling:** Check `if (result.endsWith('...'))` before parsing. If truncated, either fail gracefully or use a more resilient parser.
 
 ### Prevention Rules
 1. **UI Sync Test:** If you add a chart or gauge, verify that the number in the UI **exactly matches** the raw tool result in the console.
 2. **Grid Resilience:** Use `grid-rows-[1fr]` or `items-stretch` to ensure side-by-side cards (like Gauge and Insights) never mismatch in height.
 3. **Buffer Entry:** Strategic "ideal entries" must always be mathematically offset from current price (e.g. `price * 0.985`) to ensure they aren't "sloppy" duplicates of the market price.

---

## Rule 7: Defensive Rendering for Tool Results (PUA L3.5)

**Date:** 2026-04-10  
**Bug:** Black Screen / UI Crash — Missing `super_large` field in fund flow tool result.

### What Happened
Secondary tools (like AlphaEar `get_fund_flow`) can return error structures `{ error: "..." }` or have fields missing for certain tickers. Sub-components (e.g., `FundFlowCard`) that access deep properties (`data.super_large.net`) without checking for existence will trigger a React render error, crashing the entire dashboard.

### The Fix
**The "Early Return" Defense:** Every premium UI component MUST check its `data` prop first:
```tsx
if (!data || data.error || !data.super_large) {
  return <NoDataPlaceholder error={data?.error} />;
}
```

### Prevention Rules
1. **Component Zero-Trust:** Assume any tool-driven prop could be `null`, `undefined`, or an error object.
2. **Parsing Validation:** In the main `handleAnalyze` loop, check `if (!resJson.error)` before assigning to state.
3. **Numeric Robustness:** Use `Number()` casting and `isNaN()` checks for any value used in calculations or chart domains.
