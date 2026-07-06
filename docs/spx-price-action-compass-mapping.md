# SPX Price Action Compass Integration Mapping

Upstream reference: `https://github.com/kain26/SPX-Price-Action-Compass/tree/main` at `e9be7a88e622aa996de19f2cb0e90a830c3bb33b`.

Note: upstream README claims MIT, but the cloned repository did not contain a root `LICENSE` file. This integration reimplements the feature concepts inside this repo instead of copying upstream source.

| Upstream feature | This repo integration status | Evidence / reason |
| --- | --- | --- |
| Multi-timeframe SPX K-line chart: 1m, 5m, 15m, 4h, 1d | 已整合 | `functions/api/spx-price-action-compass.ts` maps timeframes to native Yahoo ranges; 4h is aggregated from 1h. |
| OHLCV source from Yahoo chart API | 已由本專案既有功能覆蓋並改良 | Reuses `fetchNativeYahooHistory` exported from `src/lib/stocks-native-yahoo.ts`; no parallel Yahoo client. |
| Express server and local JSON cache | 不適用且有原因 | This repo uses Cloudflare Pages Functions and D1-backed GEX storage. Express/local file cache would create a second backend. |
| Synthetic SPX generator fallback | 不適用且有原因 | Goal forbids pure mock completion. Production API returns source-backed Yahoo candles only. |
| SVG K-line rendering with zoom/pan/crosshair | 已整合 | `src/components/spx-price-action-compass.tsx` renders custom SVG candles, volume, drag pan, wheel zoom, and crosshair badges. |
| Volume histogram | 已整合 | Same chart component renders `data-pa-volume-bar` bars using source volume. |
| Support/resistance clustering | 已整合 | `deriveSpxSupportResistanceZones` clusters swing highs/lows with timeframe-specific tolerance. |
| HH/HL/LH/LL labels | 已整合 | `deriveSpxPriceActionTrend` emits trend labels and the chart overlays them. |
| Pin Bar, Engulfing, Inside Bar, Doji, Morning Star, Evening Star | 已整合 | `detectSpxPriceActionPatterns` implements deterministic candle geometry rules. |
| Double Top, Double Bottom, Head & Shoulders, Triangle | 已整合 | Same detector derives multi-swing chart patterns from local swing points. |
| Pattern side panel / signal monitor | 已整合 | Right panel in `SpxPriceActionCompass` lists top deterministic signals. |
| Pattern detail modal with diagram | 已整合 | `PatternModal` and `PatternDiagram` open from chart badges or side-panel selections. |
| Price Action Review mode | 已整合 | `Review` mode shows chart, signal monitor, S/R summary, source metadata, and modal detail. |
| Real-time Challenge / Practice mode | 已整合 | `Practice` mode selects a historical signal window, hides future candles until a decision, then reveals deterministic outcome. |
| Daily candle drilldown into 5m day | 不適用且有原因 | Existing SPX GEX heatmap route is a compact board, not a standalone study app. This can be added later without blocking the requested top-of-page compass slice. |
| Manual sync endpoint | 不適用且有原因 | Repo source truth should not add a new sync mutator. The compass endpoint reads live Yahoo chart data and leaves GEX D1 generation untouched. |
| Chinese red-up/green-down toggle | 不適用且有原因 | Project rule is American convention: green up, red down. |
| Google Cloud Run deployment model | 不適用且有原因 | This repo keeps Cloudflare Pages Functions and existing deploy flow. |
