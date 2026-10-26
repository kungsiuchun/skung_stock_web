import { Clock, RefreshCw, Search, MessageSquare } from "lucide-react";
import type { FinanceDashboardData } from "@/lib/finance-dashboard-snapshot";
import type { DashboardHistoryItem } from "@/lib/finance-dashboard-persistence";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import { FINANCE_ANALYZER_SOURCE_MAP } from "@/lib/finance-analyzer-contract";
import { isValidTraderRiskCandle } from "@/lib/trader-risk-snapshot";

export function FinanceWorkspaceToolbar({ symbol, onSymbolChange, onAnalyze, loading, history, onHistory, onClear, onChat }: {
  symbol: string; onSymbolChange: (value: string) => void; onAnalyze: () => void; loading: boolean;
  history: DashboardHistoryItem[]; onHistory: (item: DashboardHistoryItem) => void; onClear: () => void; onChat?: () => void;
}) {
  return <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 pb-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-5 w-1 rounded-full bg-blue-600" aria-hidden="true" />
        <h1 className="text-lg font-bold tracking-tight text-slate-950">Finance Analyzer</h1>
        <span className="hidden text-xs text-slate-500 xl:inline">研究工作台</span>
      </div>
      {onChat && <button type="button" onClick={onChat} className="col-start-2 row-start-1 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 md:col-start-3"><MessageSquare className="h-4 w-4" />AI 對話</button>}
    <form onSubmit={(event) => { event.preventDefault(); onAnalyze(); }} className="col-span-2 flex min-w-0 gap-2 md:col-span-1 md:col-start-2 md:row-start-1">
      <div className="relative min-w-0 flex-1 sm:max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <input name="finance-symbol" aria-label="股票代碼" placeholder="搜尋股票代碼，例如 AAPL" autoComplete="off" spellCheck={false}
          value={symbol} onChange={(event) => onSymbolChange(event.target.value)}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm uppercase text-slate-950 placeholder:normal-case focus:border-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30" />
      </div>
      <button type="submit" disabled={!symbol.trim()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40">
        <Search className="h-4 w-4" />{loading ? "切換查詢" : "研究"}
      </button>
    </form>
    <div className="col-span-2 flex flex-wrap items-center gap-1.5 text-xs md:col-span-3" aria-label="最近研究">
      <span className="mr-1 text-slate-500">最近研究</span>
      {history.length ? <>
        {history.map((item) => <button key={item.symbol} type="button" onClick={() => onHistory(item)} title={`${item.timestamp} · ${item.fullData ? "還原已儲存結果" : "重新查詢"}`}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 font-mono font-semibold hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{item.symbol}</button>)}
        <button type="button" onClick={onClear} className="min-h-11 rounded-lg px-3 text-slate-500 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">清除歷史</button>
      </> : <span className="py-3 text-slate-400">尚無紀錄</span>}
    </div>
  </header>;
}

const dateTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { timeZoneName: "short" }) : "時間未提供";

export function FinanceWorkspaceSummary({ data, cache, onRefresh }: { data: FinanceDashboardData; cache: MarketCacheMetadata | null; onRefresh: () => void }) {
  const validBars = data.chartData.filter(isValidTraderRiskCandle);
  const lastBar = validBars[validBars.length - 1];
  const quoteAvailable = typeof data.price === "number" && data.price > 0 && data.quoteStatus !== "unavailable";
  const changeAvailable = data.change !== "未提供";
  return <section aria-label="標的摘要" data-symbol={data.symbol} className="space-y-2 py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">{data.symbol}</h2>
        <span className="font-mono text-2xl font-semibold tabular-nums text-slate-950">{quoteAvailable ? `$${data.price!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "報價未提供"}</span>
        <span className={`font-mono text-sm font-semibold ${!changeAvailable ? "text-slate-500" : data.change.startsWith("-") ? "text-red-600" : "text-emerald-700"}`}>{changeAvailable ? data.change : "變動未提供"}</span>
      </div>
      <button type="button" onClick={onRefresh} aria-label={`刷新 ${data.symbol}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><RefreshCw className="h-4 w-4" />刷新</button>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span>{cache ? (cache.status === "refreshed" || cache.status === "bypassed" ? "本次查詢" : "快取快照") : "已儲存研究 · 請刷新取得最新資料"}</span>
      <span>{data.quoteSourceAsOf ? `報價時間 ${dateTime(data.quoteSourceAsOf)}` : "報價時間未提供"}</span>
      <span>日線截至 <span className="font-mono text-slate-700">{lastBar?.date_iso || lastBar?.date || "未提供"}</span></span>
      <span>量化評分 <span className="font-mono font-semibold text-slate-700">{data.algoRating ?? "未計算"}</span></span>
    </div>
    <p className="flex items-start gap-1.5 text-xs text-slate-500"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{cache ? `快照來源時間：${dateTime(cache.sourceAsOf)} · 快取建立：${dateTime(cache.cachedAt)}` : "歷史結果未保存來源時間及技術／估值／VIX 快照。"}</span>
    </p>
    {cache?.status === "stale" && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">來源暫時無法更新，正顯示 {cache.ageSeconds} 秒前資料。原因：{cache.refreshError || "未提供"}</p>}
    {quoteAvailable && lastBar && Math.abs(lastBar.price - data.price!) >= 0.005 && <p className="text-xs text-amber-800">快照報價與日線末值 ${lastBar.price.toFixed(2)} 不同；{data.quoteSourceAsOf ? "兩者來源時間不同，請注意比較時點。" : "未提供報價時間，無法確認是否同一時點。"}</p>}
  </section>;
}

export function FinanceWorkspaceSources() {
  return <details aria-label="資料來源與方法" className="rounded-xl border border-slate-200 bg-white text-xs">
    <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">資料來源與方法</summary>
    <div className="space-y-3 border-t border-slate-100 p-4">
      <p className="text-slate-500">來源對照，並非連線狀態。各資料層可能有不同時間。</p>
      {FINANCE_ANALYZER_SOURCE_MAP.slice(0, 8).map((item) => <div key={item.layer} className="space-y-0.5">
        <p className="font-semibold text-slate-800">{item.displayLayer}</p><p className="text-slate-500">{item.displaySource} · {item.deterministic ? "規則計算" : "AI 摘要"}</p>
      </div>)}
    </div>
  </details>;
}
