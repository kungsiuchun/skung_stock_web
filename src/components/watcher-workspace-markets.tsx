import { lazy, Suspense, useEffect, useState } from "react";
import { StocksWatcherMacroPanel } from "./stocks-watcher-macro-panel";
import { StocksWatcherFixedIncomePanel } from "./stocks-watcher-fixed-income-panel";
import { StocksWatcherFearGreedPanel } from "./stocks-watcher-fear-greed-panel";
import type { FearGreedSnapshot } from "@/lib/fear-greed";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import type { MarketContextSnapshot } from "@/lib/market-context";
import type { WorkspaceRoute } from "@/lib/watcher-workspace";
import { workspaceHref } from "@/lib/watcher-workspace";
const Breadth = lazy(() => import("./market-breadth-page").then(module => ({ default: module.MarketBreadthPanel })));
const Rotation = lazy(() => import("./sector-rotation-page").then(module => ({ default: module.SectorRotationPage })));
const percent = (n: number | null) => n === null ? "Unavailable" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const marketTabs = [["overview", "Market overview"], ["breadth", "Breadth"], ["rotation", "Sector rotation"], ["rates", "Rates"], ["macro", "Macro"], ["sentiment", "Fear & Greed"]];
export function WatcherWorkspaceMarkets({ route, context, error, errorDetail, loading }: { route: WorkspaceRoute; context: MarketContextSnapshot | null; error: string | null; errorDetail?: string | null; loading: boolean }) {
  return <div><div className="ww-section-heading"><div><span className="ww-kicker">THE CONTEXT BEHIND THE TICKER</span><h1>Markets</h1><p>Participation, leadership and the cost of capital.</p></div>{context && <span className="ww-badge">Prices {context.priceAsOf}</span>}</div>
    <nav className="ww-tabs" aria-label="Market research">{marketTabs.map(([key, label]) => <a href={workspaceHref(route, { section: "markets", market: key })} key={key} aria-current={route.market === key ? "page" : undefined}>{label}</a>)}</nav>
    <Suspense fallback={<p role="status">Opening market research…</p>}>
      {route.market === "overview" ? <section className="ww-card"><div className="ww-card-heading"><h2>Sector leadership</h2><span className="ww-muted">Split-adjusted price returns · dividends excluded</span></div>{loading && <p role="status">Loading published market summary…</p>}{error && <div className="ww-notice" role="alert"><p>{error}</p>{errorDetail && <details><summary>Data details</summary><p>{errorDetail}</p></details>}</div>}{context && <><div className="ww-scroll"><table><thead><tr><th>Sector</th><th>1D</th><th>1M</th><th>1M vs SPY</th><th>Weekly rotation</th></tr></thead><tbody>{[...context.sectors].sort((a, b) => (b.oneMonth ?? -Infinity) - (a.oneMonth ?? -Infinity)).map(row => <tr key={row.etf}><th>{row.etf}<small>{row.sector}</small></th>{[row.oneDay, row.oneMonth, row.relativeOneMonth].map((n, i) => <td key={i} className={n === null ? "ww-muted" : n > 0 ? "ww-up" : n < 0 ? "ww-down" : ""}>{percent(n)}</td>)}<td>{row.quadrant}</td></tr>)}</tbody></table></div><p className="ww-footnote">State Street membership {context.holdingsAsOf} · Massive adjusted prices {context.priceAsOf} · Custom weekly model, relative to SPY. Current membership is not historical attribution.</p>{context.warnings.map(text => <p key={text} className="ww-notice">{text}</p>)}</>}</section>
        : route.market === "breadth" ? <div className="ww-embedded ww-market-embedded"><Breadth variant="embedded" /></div>
        : route.market === "rotation" ? <div className="ww-embedded ww-market-embedded"><Rotation /></div>
        : route.market === "rates" ? <div className="siw-app ww-panel-theme"><StocksWatcherFixedIncomePanel /></div>
        : route.market === "macro" ? <div className="siw-app ww-panel-theme"><StocksWatcherMacroPanel /></div>
        : route.market === "sentiment" ? <FearGreed /> : <p className="ww-notice" role="alert">Unknown market section. Choose a tab above.</p>}
    </Suspense>
  </div>;
}
function FearGreed() {
  const [data, setData] = useState<{ data: FearGreedSnapshot; cache: MarketCacheMetadata | null } | null>(null);
  const [error, setError] = useState<string | null>(null); const [errorDetail, setErrorDetail] = useState<string | null>(null); const [revision, setRevision] = useState(0);
  useEffect(() => { const controller = new AbortController(); setError(null); setErrorDetail(null); void fetch("/api/fear-greed", { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok || !body.data || typeof body.data.score !== "number") throw new Error(body.error || "Fear & Greed is unavailable."); if (!controller.signal.aborted) setData(body); }).catch(error => { if (!controller.signal.aborted) { setError("Fear & Greed data is unavailable."); setErrorDetail(error instanceof Error ? error.message : String(error)); } }); return () => controller.abort(); }, [revision]);
  return <div className="siw-app ww-panel-theme">{error && <div className="ww-notice" role="alert"><p>{error}</p>{errorDetail && <details><summary>Data details</summary><p>{errorDetail}</p></details>}</div>}{data ? <StocksWatcherFearGreedPanel snapshot={data.data} cache={data.cache} onRefresh={() => setRevision(n => n + 1)} /> : !error && <p role="status">Loading Fear & Greed…</p>}</div>;
}
