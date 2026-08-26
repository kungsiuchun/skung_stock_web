# SIU'S Portfolio

A full-stack AI-powered portfolio site with an embedded **Finance Analyzer Dashboard**.

## 🚀 Tech Stack

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Backend**: Cloudflare Pages Functions (Workers runtime)
- **Charting**: TradingView `lightweight-charts` (K-line/OHLC), Recharts (VIX line chart)
- **AI Agent**: OpenRouter LLM + multi-tool ReAct agent
- **Data Sources**: Yahoo Finance API (prices, VIX), EastMoney (A-share fund flow)

## 🏗️ Architecture

```text
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

## 🛠️ Data Metrics & Formatting

- **Colors (American Convention)**: Green = price UP / inflow; Red = price DOWN / outflow.
- **Charts**: Use `lightweight-charts` for candlesticks. Data must include ISO date: `{ date_iso: "YYYY-MM-DD", ... }`
- **Fund Flow**: Volume × Last Price for US/HK stocks, dynamically denominated (億/萬/K).

## 💻 Local Development

Runs with Vite and Wrangler Pages simultaneously.

```powershell
# Start Vite (port 5173) and Wrangler Pages (port 8788)
npm run dev:all
```
- Frontend: `http://localhost:5173`
- API: `http://localhost:8788`

**Environment Variables (`.dev.vars`)**:
```env
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=...
ADANOS_API_KEY=...
```

## 🚢 Production Deployment

`npm run deploy` is the default paired production release: it deploys Cloudflare
Pages first, then the SPX Worker that collects canonical snapshots and writes the
Strike Pressure Matrix projections consumed by Pages. Use it whenever the matrix
or its collector changes.

```powershell
# Default paired Pages + SPX Worker release
npm run deploy

# Paired release that explicitly synchronizes Pages runtime secrets first
npm run deploy -- --sync-secrets

# Intentional Pages-only release (does not deploy the SPX Worker)
npm run deploy:pages
```

`--sync-secrets` is opt-in; the normal paired release does not update Pages
runtime secrets. The SPX Worker can also be released intentionally with
`npm run deploy:spx`.

## 🧪 UAT Testing Framework

Run Puppeteer automated tests against `localhost:5173`.

```powershell
node run_pup.cjs
```
*(Screenshots saved to `./uat_screenshots/`)*

**Checklist:**
- [ ] K線圖 renders with OHLC candles
- [ ] 市場情緒指數 shows gauge insights
- [ ] 恐慌指數 (VIX) shows value + sparkline
- [ ] 資金分佈 displays dollar-denominated bars
- [ ] 策略對沖與點位 readable in light mode
- [ ] 個股解讀 in Traditional Chinese
- [ ] Price tags formatting (e.g. `$XXX.XX +X.XX%`)

## 🧠 AI integration & AlphaEar Skills

The platform leverages powerful AI logic chains integrated via AlphaEar Skills to forecast and measure events accurately:
- **Finance News & Sentiment**: `alphaear-news`, `alphaear-sentiment`
- **Predictive Tools**: `alphaear-predictor` (Kronos time-series), `alphaear-signal-tracker`
- **Analytics Gathering**: `alphaear-stock`, `alphaear-reporter`
