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

### Local Tooling Gotchas

- `list_graph_stats` can succeed even when `list_repos` and `cross_repo_search` return zero results. This means the repo-local graph database exists at `.code-review-graph/graph.db`, but the global multi-repo registry is empty.
- Before using `cross_repo_search`, run `list_repos`. If it returns `0 registered repository(ies)`, use repo-scoped graph tools with an explicit `repo_root` instead of cross-repo search.
- Current observed broken CLI shim: `C:\Users\kungs\.local\bin\code-review-graph.exe` returned `uv trampoline failed to canonicalize script path` when called with `--help` or `register --help`. Do not assume the CLI `register` path works until that shim is reinstalled or repaired.
- The MCP docs helper advertised sections such as `usage`, `commands`, and `troubleshooting`, but returned `not_found` for those same names in this environment. Trust actual MCP tool schemas and direct tool output first.
- The previously documented Python path `C:\Users\kungs\AppData\Local\Microsoft\WindowsApps\python.exe` was observed missing. Verify Python with `Get-Command python` / `Get-Command py` before relying on a hard-coded interpreter path.

---

# Project Development Guidelines

## Project Overview

**SIU'S Portfolio** — A full-stack AI-powered portfolio site with an embedded **Finance Analyzer Dashboard**.

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Backend**: Cloudflare Pages Functions (Workers runtime)
- **Charting**: TradingView `lightweight-charts` (K-line/OHLC), Recharts (VIX line chart)
- **AI Agent**: OpenRouter LLM + multi-tool ReAct agent
- **Data Sources**: Yahoo Finance API (prices, VIX), EastMoney (A-share fund flow)

## Codex Plugin Routing

- Use `cloudflare@openai-curated` for Workers, Pages Functions, Wrangler config, D1 migrations, cron/scheduled Workers, and production deploy questions.
- Use `browser@openai-bundled` after meaningful frontend/UI changes; verify the actual route, visible text, charts, and console errors instead of trusting code inspection.
- Use `github@openai-curated` for PRs, CI, issues, and publish flows when GitHub context is needed.
- Use `build-web-apps@openai-curated` for React/Vite/Tailwind implementation and frontend architecture work.
- Use `build-web-data-visualization@openai-curated` for chart-heavy surfaces such as SPX GEX, Stocks Intelligence Watcher, OHLC, options exposure, and dashboard data visualization.
- Keep `documents`, `spreadsheets`, `presentations`, and `pdf` enabled for artifact work, but do not route normal repo coding tasks through them.
- Do not install or invoke Figma, Notion, Gmail, Slack, Stripe, Vercel, Netlify, or Sentry plugins unless the task explicitly depends on those external systems; extra connectors increase noise and auth surface.

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

---

## SPX Telegram Decision Pipeline

- Trading runs use one immutable `run_id` and this authority chain: Market Snapshot -> Council (QM/CM/NT/PA analysis only) -> CIO (the only component allowed to create `OPEN_CALL`, `OPEN_PUT`, `HOLD`, or `CLOSE`) -> Risk Gate (PASS, veto to HOLD, or require CLOSE only) -> D1 Decision Ledger -> Telegram Outbox.
- Never add a post-CIO directional override. Deterministic/model/data fallbacks must fail closed to explicit `DEGRADED HOLD`; they cannot manufacture a trade direction.
- Lifecycle evidence is stored in D1 tables `spx_decision_runs`, append-only `spx_run_lifecycle_events`, and `spx_delivery_outbox` from migration `0007_spx_decision_pipeline.sql`.
- Authenticated Worker diagnostics: `?run_id=<run_id>`, `?retry_run_id=<run_id>`, and `?lifecycle_date=YYYY-MM-DD`. Delivery is successful only when a Telegram `message_id` is persisted; a console log is not delivery evidence.
- Manual and `?debug` decision runs are preview-only by default. Telegram enqueue/send requires an explicit `?deliver`; scheduled cron runs remain `SEND`. A delivered `message_id` proves transport only, not message readability.
- Telegram is a compact push adapter: degraded/HOLD output must use human-readable Traditional Chinese, omit non-applicable entry/invalidation/target fields, and never expose internal fallback codes. Directional output must retain snapshot-backed evidence and executable levels.
- Telegram includes a compact GEX section derived only from the canonical Board `SpxGexTelegramSummary`: snapshot/collection time, provider engine, gamma regime/flip, SG High/Low, long walls, and short pockets. Persist that summary inside `MarketSnapshot`; never re-fetch or recalculate GEX in the formatter. If absent, state that the canonical snapshot is missing instead of fabricating levels.
- The normalized model context and traceable snapshot facts are persisted for new runs. Raw Yahoo/CBOE response payloads are not persisted and must not be described as available.
- The SPX Intraday GEX Board is the canonical GEX source for both Board and Telegram. `generatedAt` is always an ISO timestamp; display text belongs in `displayTimeLabel`. Canonical evidence uses immutable `snapshotId`, schema version, provider/fallback metadata, source timestamp, normalized payload hash, and `replayGrade=NORMALIZED_CANONICAL`.
- GEX collection slots use migration `0008_spx_gex_collection_lifecycle.sql` with `SCHEDULED -> FETCHED -> NORMALIZED -> PERSISTED` or explicit `FAILED`. A directional CIO action that cites missing, schema-mismatched, or older-than-35-minute canonical GEX must be vetoed to `DEGRADED HOLD`.
- Regression command: `node --import tsx --test tests\spx-decision-pipeline.test.ts tests\spx-worker-agent-output.test.ts tests\spx-worker-data-budget.test.ts`.
- Production migration or Worker deploy requires explicit user authorization. Apply remote D1 migrations 0007 and 0008 before deploying code that depends on the new tables.
