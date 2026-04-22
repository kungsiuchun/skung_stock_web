<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

---

# Project Development Guidelines

## Project Overview

**SIU'S Portfolio** — A full-stack AI-powered portfolio site with an embedded **Finance Analyzer Dashboard**.

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Backend**: Cloudflare Pages Functions (Workers runtime)
- **Charting**: TradingView `lightweight-charts` (K-line/OHLC), Recharts (VIX line chart)
- **AI Agent**: OpenRouter LLM + multi-tool ReAct agent
- **Data Sources**: Yahoo Finance API (prices, VIX), EastMoney (A-share fund flow)

---

## Architecture

```
src/
  components/
    finance-dashboard.tsx       # Main dashboard orchestrator (React state machine)
    dashboard/
      price-volume-chart.tsx    # TradingView lightweight-charts K-line (OHLC + Volume)
      sentiment-gauge.tsx       # SVG arc gauge + dynamic news-driven insights
      strategy-cards.tsx        # Algorithmic strategy entry/exit points
      fund-flow-card.tsx        # Capital flow bar chart (American colors)
      fear-index-card.tsx       # VIX from Yahoo Finance + sparkline
      news-feed.tsx             # Market news feed

functions/api/
  agent/
    tools/
      analysis-tools.ts         # Core: price history, strategy engine, signals
      alphaear-tools.ts         # Fund flow (EastMoney + Yahoo fallback)
      stock-tools.ts            # Yahoo Finance quote fetcher
    strategies/
      engine.ts                 # Algorithmic strategy logic
  vix.ts                        # VIX endpoint (Yahoo ^VIX)
```

---

## Key Rules & Conventions

### Colors (American Convention)
- **Green** = price UP / inflow
- **Red** = price DOWN / outflow
- Do NOT use Asian convention (red=up, green=down)

### Chart Library
- **K-line / Candlestick** → Always use `lightweight-charts` (TradingView)
- **NEVER use Recharts for candlestick** — Recharts v3 has broken array-dataKey support
- **VIX sparkline / simple lines** → Recharts `<LineChart>` is fine

### Data Format for lightweight-charts
Chart data MUST include `date_iso` (YYYY-MM-DD format):
```ts
{
  date_iso: "2026-04-10",   // Required by lightweight-charts
  price: 260.48,
  open: 258.00,
  high: 262.00,
  low: 257.50,
  volume: 31259500
}
```

### Fund Flow (資金分佈)
- US/HK stocks do NOT have Level-2 order book data
- Fallback: Yahoo Finance volume × last price → dollar-denominated estimates
- Display values in 億/萬/K format (not raw shares)
- Formula: `dollarVol = volume × lastPrice`, then split into SuperLarge/Large/Medium/Small

### Sentiment Gauge
- Accepts `news[]` prop from parent — insights are dynamically derived from news headlines
- Keyword matching: positiveKeywords vs negativeKeywords
- Layout: compact inline (gauge left, insights right) — NO large whitespace containers

### Routing
- Dashboard uses **React State** (`currentView`), NOT URL routing
- To navigate: click "AI VISION" → click "Finance Analyzer" card
- For Puppeteer testing: use UI click sequence, NOT `page.goto('/finance-dashboard')`

---

## Dev Server

```powershell
npm run dev:all   # Starts Vite (port 5173) + Wrangler Pages (port 8788)
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8788`
- Puppeteer tests use `localhost:5173` (IPv6 `::1`, NOT `127.0.0.1`)

---

## UAT Testing

Use Puppeteer for automated UAT:
```powershell
node run_pup.cjs
```

Screenshots saved to `./uat_screenshots/`. Full UAT checklist:
- [ ] K線圖 renders with real OHLC candles
- [ ] 市場情緒指數 shows gauge + dynamic insights
- [ ] 恐慌指數 (VIX) shows value + sparkline (compact, no whitespace)
- [ ] 資金分佈 shows dollar-denominated bars
- [ ] 策略對沖與點位 shows readable text (light mode colors)
- [ ] 個股解讀 (繁體中文, not 简体)
- [ ] Price tag shows `$XXX.XX +X.XX%`

---

## Known Issues & Gotchas

| Issue | Fix |
|-------|-----|
| Recharts `width(-1) height(-1)` | Never use `height="100%"` in flex container — use explicit `height={300}` |
| `lightweight-charts` import | Use named imports: `import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'` |
| Fund flow shows 0 | Must multiply volume × price for dollar amounts |
| `change_pct` missing % | API returns number (e.g. `-2.15`), format as `${val.toFixed(2)}%` |
| Puppeteer `waitForTimeout` | Use `const wait = ms => new Promise(r => setTimeout(r, ms))` |
| Puppeteer `localhost` fails | Check port — server binds to `::1` (IPv6), use `localhost` not `127.0.0.1` |

---

## Environment Variables (`.dev.vars`)

```
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=...
ADANOS_API_KEY=...
```

---

## AlphaEar Skills Available

| Skill | Purpose |
|-------|---------|
| `alphaear-stock` | Yahoo Finance stock quotes & history |
| `alphaear-news` | Hot finance news (CLS, Weibo, WallstreetCN) |
| `alphaear-sentiment` | FinBERT / LLM sentiment scoring |
| `alphaear-search` | Web search (DDG/Jina/Baidu) |
| `alphaear-signal-tracker` | Signal evolution tracking |
| `alphaear-predictor` | Kronos time-series forecasting |
| `alphaear-reporter` | Structured finance report generation |
| `alphaear-deepear-lite` | DeepEar high-frequency signals |
