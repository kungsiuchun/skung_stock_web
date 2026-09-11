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

## Display and data rules

- Use American market colours: green means up/inflow; red means down/outflow.
- `lightweight-charts` rows must include `date_iso` in `YYYY-MM-DD` form.
- US/HK fund flow has no Level-2 order book source. The Yahoo fallback estimates
  dollar volume as `volume * lastPrice`; label it honestly and format it in
  億/萬/K rather than raw shares.
- The sentiment gauge receives `news[]` from its parent and derives insights from
  headlines. Keep the compact gauge-left/insights-right layout.
- Format numeric `change_pct` values with `%` explicitly.
- Never use `height="100%"` for Recharts in a flex container; use an explicit
  numeric height.
- Import `createChart`, `CandlestickSeries`, and `HistogramSeries` as named
  exports from `lightweight-charts`.

## Local verification

```powershell
npm run dev:all
npm run test:finance-agent-tools-smoke
npm run build
```

- Vite: `http://localhost:5173`
- Pages Functions: `http://localhost:8788`
- Browser checks use `localhost`, not `127.0.0.1`.
- In Puppeteer, replace `waitForTimeout` with a Promise-based wait helper.
- Use the feature-specific package scripts instead of the removed root
  `run_pup.cjs` script.

## Runtime secrets

Local `.dev.vars` can contain `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and
`ADANOS_API_KEY`. Never expose values in source, logs, docs, or browser code.
