import { AlertCircle, BarChart3 } from "lucide-react";
import { FinanceChatPanel } from "./finance-chat-tool";
import { PriceVolumeChart } from "./dashboard/price-volume-chart";
import { TraderRiskSnapshotCard } from "./dashboard/trader-risk-snapshot-card";
import { FinanceWorkspaceToolbar, FinanceWorkspaceSummary, FinanceWorkspaceSources } from "./dashboard/finance-workspace-header";
import { FinanceResearchPanels } from "./dashboard/finance-research-panels";
import { useFinanceWorkspace } from "@/hooks/use-finance-workspace";
import { DASHBOARD_LOADING_LABELS } from "@/lib/finance-dashboard-loading";

interface FinanceDashboardProps { showChat?: boolean; onCloseChat?: () => void; onOpenChat?: () => void }

export function FinanceDashboard({ showChat = false, onCloseChat, onOpenChat }: FinanceDashboardProps) {
  const workspace = useFinanceWorkspace();
  const { activeData, cache, error, history, loading, loadingPhase, symbol, setSymbol, analyze, selectHistory, clearHistory, warnings } = workspace;
  const storageNotice = warnings.length > 0 && <div role="alert" aria-label="Browser storage warning" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>;

  if (showChat) return <div className="min-h-dvh bg-[#0f141b] p-3 lg:h-full lg:min-h-0 lg:overflow-hidden sm:p-5">
    <div className="mx-auto flex min-h-[640px] max-w-[1600px] flex-col gap-3 lg:h-full lg:min-h-0">
      {storageNotice}
      <div className="flex items-center justify-between gap-3 text-white">
        <h1 className="text-lg font-semibold">AI 研究對話</h1>
        <button type="button" onClick={onCloseChat} className="min-h-11 rounded-lg border border-white/20 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">返回研究</button>
      </div>
      <FinanceChatPanel className="min-h-0 flex-1 rounded-xl border border-white/10" subtitle="查詢市場資料與研究問題" />
    </div>
  </div>;

  return <div data-finance-workspace className="min-h-full overflow-visible bg-[#f5f6f8] p-3 text-slate-800 [color-scheme:light] lg:h-full lg:overflow-y-auto sm:p-5">
    <div className="mx-auto max-w-[1600px]">
      {storageNotice}
      <FinanceWorkspaceToolbar symbol={symbol} onSymbolChange={setSymbol} onAnalyze={() => { void analyze(); }} loading={loading} history={history} onHistory={selectHistory} onClear={clearHistory} onChat={onOpenChat} />
      {error && <div role="alert" className="my-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div>}
      {loading ? <section role="status" aria-live="polite" aria-label="Finance Analyzer loading" className="py-5">
        <p className="mb-4 text-sm font-semibold text-blue-700">{symbol} · {loadingPhase ? DASHBOARD_LOADING_LABELS[loadingPhase] : "取得研究資料"}</p>
        <div className="h-[420px] animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      </section> : activeData ? <>
        <FinanceWorkspaceSummary data={activeData} cache={cache} onRefresh={() => { void analyze(activeData.symbol); }} />
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section aria-label={`${activeData.symbol} 價格與成交量`} className="order-1 min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 xl:col-start-1 xl:row-start-1">
            <PriceVolumeChart key={activeData.symbol} data={activeData.chartData} symbol={activeData.symbol} />
          </section>
          <aside aria-label="研究快覽" className="order-3 min-w-0 space-y-3 xl:order-none xl:col-start-2 xl:row-span-2 xl:row-start-1">
            <TraderRiskSnapshotCard data={activeData.chartData} />
            <FinanceWorkspaceSources />
          </aside>
          <div className="order-2 min-w-0 xl:col-start-1"><FinanceResearchPanels snapshot={workspace} /></div>
        </div>
      </> : <section className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center">
          <BarChart3 className="mb-3 h-7 w-7 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">選擇研究標的</h2>
          <p className="mt-2 text-sm text-slate-500">輸入代碼，查看價格、技術、期權與新聞。</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">{["SPY", "AAPL", "NVDA", "BTC-USD"].map((ticker) => <button key={ticker} type="button" onClick={() => { void analyze(ticker); }} className="min-h-11 rounded-lg border border-slate-200 px-3 font-mono text-xs font-semibold hover:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{ticker}</button>)}</div>
        </div>
        <FinanceWorkspaceSources />
      </section>}
    </div>
  </div>;
}
