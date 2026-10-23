import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DashboardSnapshotState } from "@/lib/finance-dashboard-state";
import { formatDashboardAction, formatDashboardTrend } from "@/lib/finance-dashboard-ai-decision";
import { SentimentGauge } from "./sentiment-gauge";
import { TechnicalRadar } from "./technical-radar";
import { FearIndexCard } from "./fear-index-card";
import { StrategyCards } from "./strategy-cards";
import { ValuationWidget } from "./valuation-widget";
import { OptionsFlowCard } from "./options-flow-card";
import { NewsFeed } from "./news-feed";
import { FinancialJuiceWidget } from "./financial-juice-widget";

const tabs = [
  { id: "technical", label: "技術" }, { id: "options", label: "期權" },
  { id: "fundamentals", label: "基本面" }, { id: "news", label: "新聞" }, { id: "ai", label: "AI 解讀" },
] as const;

export function FinanceResearchPanels({ snapshot }: { snapshot: DashboardSnapshotState }) {
  const [tab, setTab] = useState<typeof tabs[number]["id"]>("technical");
  const [marketNewsOpen, setMarketNewsOpen] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const data = snapshot.activeData;
  if (!data) return null;
  const { technicalData, valuationData, vixData } = snapshot;
  const unavailable = {
    technical: !technicalData || Boolean(technicalData.error),
    options: !data.optionsFlow || Boolean(data.optionsFlow.error) || !data.optionsFlow.topStrikes.some((row) => row.callOI + row.putOI > 0),
    fundamentals: !valuationData || Boolean(valuationData.error) || !valuationData.pe_ratio,
    news: data.news.length === 0,
    ai: data.dashboardNarrative?.status !== "available" || !data.finalAnalysis,
  };
  return <section aria-label="研究資料" data-symbol={data.symbol} className="mt-5 min-w-0">
    <div role="tablist" aria-label="研究分類" className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab"
        id={`research-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`research-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setTab(tabs[next].id); tabRefs.current[next]?.focus();
        }} className={`inline-flex min-h-11 items-center gap-1.5 rounded-t-lg border-b-2 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${tab === item.id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent text-slate-500 hover:bg-white hover:text-slate-900"}`}>
        {item.label}{unavailable[item.id] && <span aria-label="資料未完整提供" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </button>)}
    </div>
    <p className="my-2 text-xs text-slate-500">{data.symbol} · 琥珀點表示該分類資料未完整提供</p>
    <div role="tabpanel" id={`research-panel-${tab}`} aria-labelledby={`research-tab-${tab}`} tabIndex={0} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
      {tab === "technical" && <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {technicalData && !technicalData.error ? <TechnicalRadar data={technicalData} loading={false} /> : <MissingData text={technicalData?.error || "技術指標未提供，歷史研究請刷新資料。"} />}
          <StrategyCards quantStrategies={data.quantStrategies} recommendedTrade={data.recommendedTrade} />
        </div>
        <div className="min-w-0 space-y-4">
          <SentimentGauge sentiment={data.marketSentiment} sentimentSource={data.sentimentSource} sentimentData={data.sentimentData} news={data.news} />
          {vixData ? <FearIndexCard data={vixData} /> : <MissingData text="VIX 快照未提供。" />}
        </div>
      </div>}
      {tab === "options" && <OptionsFlowCard symbol={data.symbol} data={data.optionsFlow!} />}
      {tab === "fundamentals" && <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">{data.symbol} 估值摘要</h3>
        <p className="mt-1 text-xs text-slate-500">Yahoo Finance 財務摘要 · 不代表即時報價</p>
        {unavailable.fundamentals ? <MissingData text={valuationData?.error || "估值摘要未提供，歷史研究請刷新資料。"} /> : <ValuationWidget data={valuationData} loading={false} />}
      </div>}
      {tab === "news" && <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <NewsFeed news={data.news.map((item) => ({ title: item.title, source: item.publisher || item.source || "來源未提供", time: item.publish_time, link: item.link }))} />
        <details open={marketNewsOpen} onToggle={(event) => setMarketNewsOpen(event.currentTarget.open)} className="self-start rounded-xl border border-slate-200 bg-white"><summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">市場新聞 · FinancialJuice</summary>{marketNewsOpen && <FinancialJuiceWidget />}</details>
      </div>}
      {tab === "ai" && <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h3 className="text-sm font-semibold">{data.symbol} AI 解讀</h3>
          <a href="#/work/trading-agent-dashboard" className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">深度分析</a>
        </div>
        {data.decision.status === "available" ? <p className="my-3 text-sm text-slate-700">趨勢：{formatDashboardTrend(data.decision.trend)} · 行動：{formatDashboardAction(data.decision.action)}</p> : <MissingData text={`AI 判斷不可用：${data.decision.reason}`} />}
        {!unavailable.ai ? <div className="prose prose-sm mt-4 max-w-none break-words text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{data.finalAnalysis}</ReactMarkdown></div>
          : <MissingData text={`AI Key Insights 暫不可用：${data.dashboardNarrative && "reason" in data.dashboardNarrative ? data.dashboardNarrative.reason : "API 未返回完整 AI 分析。"}`} />}
      </div>}
    </div>
  </section>;
}

function MissingData({ text }: { text: string }) {
  return <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{text}</p>;
}
