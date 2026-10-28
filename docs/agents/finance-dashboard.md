# Finance Dashboard Contract

Read this file only for Finance Analyzer UI, its Pages Functions, or related UAT.

## Architecture

- Frontend: React, TypeScript, Vite, TailwindCSS.
- Backend: Cloudflare Pages Functions.
- Candlestick/OHLC charts: TradingView `lightweight-charts` only.
- Simple VIX lines: Recharts is allowed.
- The dashboard uses React `currentView` state rather than URL routing.
- Current portfolio navigation is the Work Gallery flow documented in `CONTEXT.md`;
  the old AI VISION navigation no longer exists.
- Finance Analyzer is a chart-first research workspace. Search, recent research,
  quote and chart remain primary; technicals, options, fundamentals, news and AI
  interpretation live in research tabs. AI chat and source/method details are secondary.
- Public Finance hashes now open the unified Watcher research workspace. See
  `watcher-workspace.md` for current navigation, selected-symbol and public AI policy.
  The compatibility Finance snapshot is data-only and never starts a model call.
  Legacy research components and their browser history remain available in source;
  do not erase saved history during workspace changes.

## Display and data rules

- Use American market colours: green means up/inflow; red means down/outflow.
- `lightweight-charts` rows must include `date_iso` in `YYYY-MM-DD` form.
- US/HK fund flow has no Level-2 order book source. The Yahoo fallback estimates
  dollar volume as `volume * lastPrice`; label it honestly and format it in
  億/萬/K rather than raw shares.
- The sentiment gauge receives `news[]` from its parent and derives insights from
  headlines. Keep the compact gauge-left/insights-right layout.
- Format numeric `change_pct` values with `%` explicitly.
- Distinguish source time, cache creation and restored history. Never substitute
  cache creation or the browser clock for a missing quote timestamp. Source maps
  describe provenance, not successful connectivity; do not hardcode healthy states.
- Invalid OHLC rows are visibly excluded from the chart, and invalidate derived
  risk metrics rather than substituting an older row. The Finance Agent's Yahoo
  normalization rejects null/non-numeric or impossible OHLC and invalid dates
  before both strategy context and chart construction, with a scoped
  rejection-count log. A missing latest quote remains unavailable rather than
  becoming a zero price or zero change; snapshots expose partial state and the
  actual last valid date.
- Option walls use a validated quote or the options chain's numeric underlying
  price; missing prices never use an average strike as a market-price substitute.
- The VIX line endpoint validates observed daily closes independently of unused
  OHLC fields. Latest and immediately preceding provider observations must both
  have valid, completed closes; no older substitution, missing-to-zero conversion
  or invented candles. Source and daily as-of date accompany the existing values.
- Public fundamentals shares the bounded Yahoo session transport. Send only
  cookie name/value pairs; never forward Set-Cookie attributes or cache an empty/
  HTML crumb. Preserve source identity and the missing-result 404 contract.
  Upstream rate limits remain 429; other upstream failures are 502/504.
- Browser persistence is optional: blocked/full/corrupt storage produces a visible warning, not a route failure or a synthetic API error. Initial hydration must never write empty history over saved data. Invalid saved payloads are not silently deleted.
- Only validated history metadata and render-safe saved results may be restored. History analysis passes its selected ticker explicitly; restored results clear valuation, technical, VIX and cache metadata that were not saved with that history entry.
- Never use `height="100%"` for Recharts in a flex container; use an explicit
  numeric height.
- Import `createChart`, `CandlestickSeries`, and `HistogramSeries` as named
  exports from `lightweight-charts`.

## Local verification

```powershell
npm run dev:all
npm run test:finance-ui
npm run test:finance-ui:uat
npm run test:finance-agent-tools-smoke
npm run build
```

- Vite: `http://localhost:5173`
- Pages Functions: `http://localhost:8788`
- Browser checks use `localhost`, not `127.0.0.1`.
- In Puppeteer, replace `waitForTimeout` with a Promise-based wait helper.
- Use the feature-specific package scripts instead of the removed root
  `run_pup.cjs` script.
- For Yahoo OHLC normalization changes, also run `npm run test:quant-strategies`.
  For risk/chart client changes, run the related `trader-risk-snapshot` and
  `candlestick-pattern-client` tests with `node --import tsx --test`.

## Runtime secrets

Local `.dev.vars` can contain `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and
`ADANOS_API_KEY`. Never expose values in source, logs, docs, or browser code.
