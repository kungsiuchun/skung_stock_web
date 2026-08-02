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

## Market Data Cache

- Watcher and Finance Analyzer use the optional `MARKET_CACHE_DB` D1 binding as a 60-second shared market snapshot cache; `migrations/0009_market_data_cache.sql` owns its schema.
- Keep `MARKET_CACHE_DB` separate from `SPX_RECAP_DB`. The latter is an SPX decision/audit ledger, not a general cache.
- Production Pages binds `MARKET_CACHE_DB` to the isolated `market-cache-db` D1 database (`c629da02-21ce-4b1c-87f2-59ba54be922e`). Apply only `migrations/0009_market_data_cache.sql` to this database with `wrangler d1 execute market-cache-db --remote --file=./migrations/0009_market_data_cache.sql`; never run the shared SPX migration sequence against it.
- Without the binding (for example, local development before initializing local D1), API responses explicitly report `cache.status="bypassed"`; never claim a shared-cache hit.
- Expired entries may be shown only as visibly stale data with the refresh failure reason. Do not recreate a demo fallback for market-source failures.

## Stock Watcher Valuation Coverage

- `VALUATION_DATA` is a private R2 binding. Published releases live below `releases/<releaseId>/`; `current.json` is the only active-release pointer.
- Missing valuation/financial data must remain explicit (`NOT_PUBLISHED`, `queued`, or `unavailable`); never substitute Yahoo data for this published calculation layer.
- New ticker coverage is written only through `/api/stocks-intelligence-watcher/admin`. It requires `Authorization: Bearer <STOCKS_WATCHER_ADMIN_TOKEN>`; configure that value as a Pages secret and never embed it in the public UI. The public snapshot/tool route is read-only.
- The daily ValuationCalculation workflow reads `coverage/universe.json`, unions it with its default universe, and publishes only after the entire resolved universe validates. R2 release retention and the export-size cap bound storage growth.

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
- Telegram is a compact push adapter: degraded/HOLD output must use human-readable Traditional Chinese, omit non-applicable entry/invalidation/target fields, and never expose internal fallback codes. Directional output must retain snapshot-backed evidence and executable levels. Every decision message passes one HTML-escape send choke point before Telegram delivery; never trust model text or caller-level escaping.
- Telegram is a compact decision card: UAT label (only for UAT), `SPX: <price> 操作：<final Risk-Gated action>`, then `⏱️ 美東時間：<scheduled ET>｜標的：SPX`. Keep the full canonical GEX section. Render `📊 Council` with the Call/Put/HOLD/INVALID tally and QM/CM/NT/PA in order, one concise human-readable line per agent; never show model/provider/parser debris. Render `🧠 CIO` with only executable entry, invalidation, targets, and no-trade conditions for directional actions; HOLD/CLOSE has one concise plan line. Footer contains risk, a data warning only when non-OK, run ID, and Board link. An invalid agent is counted as `INVALID`, never as a real HOLD vote.
- Council and CIO both use `openai/gpt-5-mini`, no `temperature`, and `reasoning.effort="minimal"`. Every structured GPT-5 Mini request is Azure-only: send `order` and `only` as `azure`, set `allow_fallbacks=false`, keep `require_parameters=true`, and retry at most once against the same Azure provider. Azure rejects OpenRouter `json_schema`, so its wire contract uses `response_format: { type: "json_object" }`; the Worker still strictly validates the complete Council/CIO schema, evidence references, confidence bounds, and no-extra-fields rules before accepting output. Accept `azure` endpoint variants only; every other resolved provider is an `UNAPPROVED_PROVIDER` fail-closed contract violation. An HTTP 404 is `PROVIDER_UNAVAILABLE`, never timeout/schema evidence. Council uses `max_completion_tokens=1024`, a 45-second attempt timeout, a shared 100-second deadline, and an 8KB role-projection hard limit. CIO uses `max_completion_tokens=1536` and its existing timeout profile. There is no cross-model or cross-provider fallback.
- Valid AI confidence is 1-100; zero is reserved for pipeline-generated invalid/degraded results. Every Council/CIO claim, including HOLD conflicts, must cite exact role-projection snapshot fact keys. Persist requested/resolved model, provider, token usage, cost, latency, finish reason and response hash, plus safe OpenRouter response-shape evidence (`error_type`, error/provider code, routing providers, generation ID, error-message hash, canonical `contractError`); never persist raw model output, raw prompt, or raw error text. `UPSTREAM_ERROR`, `MISSING_CHOICE`, `EMPTY_CONTENT`, `OUTPUT_NOT_JSON`, `SCHEMA_INVALID`, and 400 contract classes are distinct failure classes and Telegram must humanize them without leaking internal codes.
- Telegram includes a compact GEX section derived only from the canonical Board `SpxGexTelegramSummary`: snapshot/collection time, provider engine, gamma regime/flip, SG High/Low, long walls, and short pockets. Persist that summary inside `MarketSnapshot`; never re-fetch or recalculate GEX in the formatter. If absent, state that the canonical snapshot is missing instead of fabricating levels.
- The normalized model context and traceable snapshot facts are persisted for new runs. Raw Yahoo/CBOE response payloads are not persisted and must not be described as available.
- The SPX Intraday GEX Board is the canonical GEX source for both Board and Telegram. `generatedAt` is always an ISO timestamp; display text belongs in `displayTimeLabel`. Canonical evidence uses immutable `snapshotId`, schema version, provider/fallback metadata, source timestamp, normalized payload hash, and `replayGrade=NORMALIZED_CANONICAL`.
- GEX collection slots use migration `0008_spx_gex_collection_lifecycle.sql` with `SCHEDULED -> FETCHED -> NORMALIZED -> PERSISTED` or explicit `FAILED`. A directional CIO action that cites missing, schema-mismatched, or older-than-35-minute canonical GEX must be vetoed to `DEGRADED HOLD`.
- The singleton `SPX_SCHEDULER` Durable Object owns 15-minute market alarms. Cron is only its wake/re-arm fallback; a late or absent tick is recorded as `cron_invocation_missed`, never backfilled with later market data or replayed as a stale trade decision.
- The GEX API returns explicit `READY`, `EMPTY`, or `ERROR` status; missing D1/table is 503, read failure is 500, and only READY may be cached. A missing URL `snapshot` parameter must remain `null`, never coerce to minute zero.
- The Pressure API reads guarded compact D1 JSON projections (`session`, canonical metadata, spot, 0DTE strike/NetGEX) and must never pull whole-day `snapshot_json` rows into the Worker. Browser SPX reads share one serial lane with an 8-second per-attempt deadline, one 300ms delayed retry for timeout/transport or HTTP 502/503/504 only, and per-attempt abort signals so every terminal path releases the lane.
- Local UAT uses `npm run dev:spx-uat` with the isolated `.wrangler/spx-uat` fixture (2026-07-13 14:30 represented / 14:45 collected, 480 cells, 5 expiries). `npm run dev:spx-live` proxies only the GEX GET endpoint to production read-only. Vite is fixed to strict port 5173 and Pages to 8788.
- Off-hours manual decision triggers use the fixed 2026-07-13 14:45 ET `UAT_REPLAY`, clearly marked non-live, and make no model call. Authenticated `?probe_llm` validates the exact GPT-5 request without Telegram. Authenticated `?uat_llm` first runs that probe, then runs the same fixture through four live Council calls and one CIO call without changing position or signal journals; Telegram requires explicit `?deliver` and starts with `SYSTEM UAT｜非即時訊號｜不可交易`.
- Regression command: `node --import tsx --test tests\spx-agent-calibration.test.ts tests\spx-decision-pipeline.test.ts tests\spx-gex-collection-lifecycle.test.ts tests\spx-gex-heatmap.test.ts tests\spx-price-action-compass.test.ts tests\spx-worker-agent-output.test.ts tests\spx-worker-data-budget.test.ts`.
- Production migration or Worker deploy requires explicit user authorization. Apply remote D1 migrations 0007 and 0008 before deploying code that depends on the new tables.
