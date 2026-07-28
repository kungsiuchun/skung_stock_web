import { useState, useEffect } from "react";
import { 
  Search, TrendingUp, TrendingDown, Clock, Activity, 
  Zap, Calendar, BarChart3, AlertCircle, RefreshCw
} from "lucide-react";

import { SentimentGauge } from "./dashboard/sentiment-gauge";
import { StrategyCards } from "./dashboard/strategy-cards";
import { NewsFeed, type NewsItem as SubNewsItem } from "./dashboard/news-feed";
import { OptionsFlowCard } from "./dashboard/options-flow-card";
import { PriceVolumeChart } from "./dashboard/price-volume-chart";
import { FearIndexCard } from "./dashboard/fear-index-card";
import { ValuationWidget } from "./dashboard/valuation-widget";
import { TechnicalRadar } from "./dashboard/technical-radar";
import { FinancialJuiceWidget } from "./dashboard/financial-juice-widget";
import { TraderRiskSnapshotCard } from "./dashboard/trader-risk-snapshot-card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FinanceChatPanel } from "./finance-chat-tool";
import {
  FINANCE_ANALYZER_MODEL_CALL_BUDGETS,
  FINANCE_ANALYZER_SOURCE_MAP,
  normalizeQuantStrategiesFromAgentResponse,
  selectRecommendedQuantTrade,
} from "@/lib/finance-analyzer-contract";
import {
  formatDashboardAction,
  formatDashboardTrend,
  normalizeDashboardDecision,
} from "@/lib/finance-dashboard-ai-decision";
import type { FinanceDashboardData as DashboardData, FinanceDashboardSnapshotPayload } from "@/lib/finance-dashboard-snapshot";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import {
  DASHBOARD_LOADING_LABELS,
  DASHBOARD_LOADING_PHASE_MS,
  getNextDashboardLoadingPhase,
  type DashboardLoadingPhase,
} from "@/lib/finance-dashboard-loading";
import {
  getDashboardNarrativeStatus,
} from "@/lib/finance-dashboard-narrative";
import {
  sanitizeDashboardHistory,
  hasLegacyDeepEarData as hasPersistedLegacyDeepEarData,
  normalizeStoredDashboardData as normalizePersistedDashboardData,
} from "@/lib/finance-dashboard-persistence";
import {
  applyDashboardSnapshot,
  beginDashboardAnalysis,
  completeDashboardAnalysis,
  EMPTY_DASHBOARD_SNAPSHOT_STATE,
  failDashboardAnalysis,
} from "@/lib/finance-dashboard-state";

export interface HistoryItem {
  symbol: string;
  timestamp: string;
  score: number;
  fullData?: DashboardData;
}

interface FinanceDashboardProps {
  showChat?: boolean;
  onCloseChat?: () => void;
}

const LEGACY_DEEPEAR_PATTERN = /DeepEar|高頻|get_financial_signals/i;

export const hasLegacyDeepEarData = (data: unknown) => {
  if (!data || typeof data !== "object") return false;
  const value = data as { financialSignals?: unknown; finalAnalysis?: unknown };
  return Boolean(
    value.financialSignals ||
    (typeof value.finalAnalysis === "string" && LEGACY_DEEPEAR_PATTERN.test(value.finalAnalysis))
  );
};

export const normalizeStoredDashboardData = (data: unknown): DashboardData | null => {
  if (!data || typeof data !== "object") return null;
  const stored = data as DashboardData & { quantStrategies?: unknown };
  const normalizedStrategies = normalizeQuantStrategiesFromAgentResponse({ quant_strategies: stored.quantStrategies });
  const hasCurrentQuantSchema = stored.quantStrategySchemaVersion === "v3";
  const quantStrategies = hasCurrentQuantSchema
    ? normalizedStrategies
    : normalizedStrategies.map((strategy) => ({
      ...strategy,
      entry: undefined,
      stopLoss: undefined,
      target: undefined,
      tradeSetup: {
        actionability: "PENDING_TRIGGER" as const,
        nextStep: "舊快取不符合目前量化策略合約；重新分析後才會產生交易計劃。",
        optionsStatus: "PENDING" as const,
      },
    }));
  return {
    ...(stored as DashboardData),
    quantStrategySchemaVersion: "v3",
    decision: normalizeDashboardDecision((stored as { decision?: unknown }).decision),
    quantStrategies,
    recommendedTrade: hasCurrentQuantSchema ? selectRecommendedQuantTrade(quantStrategies) : null,
    dashboardNarrative: stored.dashboardNarrative || getDashboardNarrativeStatus(stored.finalAnalysis),
  };
};

function FinanceDashboardLoading({ phase, symbol }: { phase: DashboardLoadingPhase; symbol: string }) {
  const phases: DashboardLoadingPhase[] = ["market", "options", "quant", "synthesis"];
  const activeIndex = phases.indexOf(phase);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12" aria-live="polite" aria-label="Finance Analyzer loading">
      <div className="space-y-8 lg:col-span-8">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-end justify-between gap-6">
            <div className="space-y-4">
              <div className="h-4 w-24 animate-pulse rounded bg-blue-100" />
              <div className="h-12 w-48 animate-pulse rounded-xl bg-gray-200" />
              <div className="h-8 w-36 animate-pulse rounded-lg bg-gray-100" />
            </div>
            <div className="grid w-1/2 grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-gray-100" />)}
            </div>
          </div>
          <p className="mt-8 text-sm font-semibold text-blue-700">
            {symbol ? `${symbol.toUpperCase()} · ` : ""}{DASHBOARD_LOADING_LABELS[phase]}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${((activeIndex + 1) / phases.length) * 100}%` }} />
          </div>
        </div>
        <div className="h-[360px] animate-pulse rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="h-5 w-48 rounded bg-gray-100" />
          <div className="mt-8 h-64 rounded-2xl bg-gray-50" />
        </div>
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 h-5 w-56 rounded bg-gray-100" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-2xl bg-gray-50" />)}
          </div>
        </div>
      </div>
      <div className="space-y-8 lg:col-span-4">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6 h-5 w-40 rounded bg-gray-100" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-gray-50" />)}
          </div>
        </div>
        <div className="h-64 animate-pulse rounded-3xl border border-gray-200 bg-white p-6 shadow-sm" />
        <div className="h-52 animate-pulse rounded-3xl border border-gray-200 bg-white p-6 shadow-sm" />
      </div>
    </div>
  );
}

export function FinanceDashboard({ showChat = false, onCloseChat }: FinanceDashboardProps) {
  const [dashboardSnapshot, setDashboardSnapshot] = useState(EMPTY_DASHBOARD_SNAPSHOT_STATE);
  const { activeData, cache, error, history, loading, loadingPhase, technicalData, valuationData, vixData } = dashboardSnapshot;
  const [symbol, setSymbol] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // 1. Load from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem("finance_dashboard_history");
    if (savedHistory) {
      try {
        const sanitizedHistory = sanitizeDashboardHistory(JSON.parse(savedHistory));
        setDashboardSnapshot((current) => ({ ...current, history: sanitizedHistory }));
        localStorage.setItem("finance_dashboard_history", JSON.stringify(sanitizedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    const savedActiveData = localStorage.getItem("finance_dashboard_active_data");
    if (savedActiveData) {
      try {
        const parsedActiveData = JSON.parse(savedActiveData);
        if (hasPersistedLegacyDeepEarData(parsedActiveData)) {
          localStorage.removeItem("finance_dashboard_active_data");
        } else {
          const normalizedActiveData = normalizePersistedDashboardData(parsedActiveData);
          if (normalizedActiveData) {
            setDashboardSnapshot((current) => ({ ...current, activeData: normalizedActiveData }));
          } else {
            localStorage.removeItem("finance_dashboard_active_data");
          }
        }
      } catch (e) {
        console.error("Failed to parse active data", e);
      }
    }
  }, []);

  // 2. Save to localStorage when state changes
  useEffect(() => {
    localStorage.setItem("finance_dashboard_history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (activeData) {
      localStorage.setItem("finance_dashboard_active_data", JSON.stringify(activeData));
    }
  }, [activeData]);

  useEffect(() => {
    if (!loadingPhase) return;
    const timer = window.setInterval(() => {
      setDashboardSnapshot((current) => ({
        ...current,
        loadingPhase: current.loadingPhase ? getNextDashboardLoadingPhase(current.loadingPhase) : null,
      }));
    }, DASHBOARD_LOADING_PHASE_MS);
    return () => window.clearInterval(timer);
  }, [loadingPhase]);

  const handleAnalyze = async () => {
    if (!symbol.trim() || loading) return;

    try {
      setDashboardSnapshot(beginDashboardAnalysis);

      const response = await fetch("/api/finance-dashboard/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
        }),
      });
      const payload = await response.json() as {
        data?: FinanceDashboardSnapshotPayload;
        cache?: MarketCacheMetadata;
        error?: string;
      };
      if (!response.ok && response.status !== 206) throw new Error(payload.error || "分析快照請求失敗");
      if (!payload.data || !payload.cache) throw new Error("分析快照回應格式無效。");

      setDashboardSnapshot((current) => applyDashboardSnapshot(
        current,
        payload.data as FinanceDashboardSnapshotPayload,
        payload.cache as MarketCacheMetadata,
        symbol,
        new Date().toLocaleTimeString(),
      ));

    } catch (err: any) {
      console.error("Analysis Error:", err);
      setDashboardSnapshot((current) => failDashboardAnalysis(current, err.message || "分析過程中發生錯誤"));
    } finally {
      setDashboardSnapshot(completeDashboardAnalysis);
    }
  };

  if (showChat) {
    return (
      <div className="h-full overflow-hidden bg-[#0f141b] p-3 text-[#1e2329] sm:p-4 lg:p-6">
        <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4">
          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300/70">Finance Analyzer</p>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Agent Chat Workspace</h1>
                <p className="mt-1 text-xs font-semibold text-white/45">
                  Full ReAct tool surface with source-backed data pulls.
                </p>
              </div>
              {onCloseChat && (
                <button
                  type="button"
                  onClick={onCloseChat}
                  className="w-fit rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-400/15"
                >
                  Back to dashboard
                </button>
              )}
            </div>
          </div>

          <FinanceChatPanel
            className="min-h-0 flex-1 rounded-2xl border border-white/10 shadow-2xl"
            subtitle="Full chat surface · ReAct tools · Env-backed data sources"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f5f6f8] text-[#1e2329] p-4 lg:p-8 selection:bg-cyan-500/30">
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Activity className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-3xl font-black tracking-tight text-gray-900">
                Finance <span className="text-blue-600">Analyzer</span>
              </h1>
            </div>
            <p className="text-gray-500 text-sm font-medium ml-1">基於 AI 的多模態金融大數據分析系統</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group shadow-sm rounded-2xl">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-2xl blur opacity-10 group-hover:opacity-30 transition duration-500" />
              <div className="relative flex items-center">
                <Search className="absolute left-4 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                <input
                  type="text"
                  placeholder="輸入股票代碼 (例如: TSLA, AAPL)..."
                  className="w-full lg:w-[400px] bg-white border border-gray-200 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:border-blue-500 transition-all placeholder:text-gray-400 text-gray-900 shadow-sm"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  onFocus={() => setShowHistory(true)}
                  onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                />
              </div>

              {/* Recent Searches Dropdown */}
              {showHistory && history.length > 0 && (
                <div className="absolute top-full left-0 w-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  <div className="p-2 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-3 py-1">最近搜尋記錄</span>
                    <button 
                      onClick={() => { setDashboardSnapshot((current) => ({ ...current, history: [] })); localStorage.removeItem("finance_dashboard_history"); }}
                      className="text-[10px] font-bold text-red-500 px-3 py-1 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      清除歷史
                    </button>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {history.map((h, i) => (
                      <button 
                        key={i}
                        onClick={() => {
                          if (h.fullData) {
                            setDashboardSnapshot((current) => ({ ...current, activeData: normalizePersistedDashboardData(h.fullData) }));
                            setSymbol(h.symbol);
                          } else {
                            setSymbol(h.symbol);
                            handleAnalyze();
                          }
                          setShowHistory(false);
                        }}
                        className="w-full flex items-center justify-between p-4 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0 text-left"
                      >
                        <div className="flex flex-col">
                          <span className="font-black text-gray-900">{h.symbol}</span>
                          <span className="text-[10px] text-gray-400 uppercase font-mono">{h.timestamp}</span>
                        </div>
                        <div className={`px-3 py-1 rounded-lg text-xs font-bold ${h.score > 60 ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                          {h.score} pts
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => handleAnalyze()}
              disabled={loading}
              className="px-8 py-4 bg-gray-900 text-white rounded-2xl text-sm font-bold hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2 whitespace-nowrap shadow-md"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {loading ? "分析中..." : "開始分析"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-8 p-4 rounded-2xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-4 shadow-sm">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {cache && activeData && (
          <div className={`mb-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${cache.status === "stale" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-800"}`}>
            <Clock className="h-4 w-4" />
            {cache.status === "stale"
              ? `來源暫時無法更新，正顯示 ${cache.ageSeconds} 秒前資料。${cache.refreshError ? ` 原因：${cache.refreshError}` : ""}`
              : `資料更新於 ${new Date(cache.sourceAsOf || cache.cachedAt).toLocaleTimeString()}`}
          </div>
        )}

        {loading && loadingPhase ? (
          <FinanceDashboardLoading phase={loadingPhase} symbol={symbol} />
        ) : !activeData ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
             <div className="lg:col-span-8 space-y-8">
                <div className="bg-white border border-gray-200 rounded-3xl p-12 flex flex-col items-center justify-center text-center min-h-[500px] group transition-all duration-700 shadow-sm">
                  <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center mb-8 relative">
                    <div className="absolute inset-0 rounded-full bg-blue-100 animate-ping opacity-50" />
                    <BarChart3 className="w-10 h-10 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-bold mb-4 text-gray-900">準備好開始深度分析了嗎？</h2>
                  <p className="text-gray-500 max-w-sm leading-relaxed mb-8">
                    輸入任何美股代碼，我們的 AI 代理將自動抓取多個數據源，執行量化策略，並為您生成專業的投資分析報吿。
                  </p>
                  <div className="flex gap-4">
                    {["TSLA", "AAPL", "NVDA", "BTC-USD"].map((s) => (
                      <button 
                        key={s}
                        onClick={() => { setSymbol(s); }}
                        className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 border border-gray-200 text-xs font-bold hover:bg-blue-50 hover:text-blue-600 transition-all shadow-sm"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="lg:col-span-4">
                <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-6 h-full flex flex-col">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-gray-900">
                    <Clock className="w-4 h-4 text-blue-500" />
                    最近搜尋
                  </h3>
                  <div className="flex-1 space-y-3">
                    {history.length > 0 ? history.map((h, i) => (
                      <button 
                        key={i}
                        onClick={() => { 
                          if (h.fullData) {
                            setDashboardSnapshot((current) => ({ ...current, activeData: normalizePersistedDashboardData(h.fullData) }));
                          } else {
                            setSymbol(h.symbol);
                          }
                        }}
                        className="w-full flex items-center justify-between p-4 rounded-2xl bg-gray-50 border border-transparent hover:border-blue-200 hover:bg-blue-50 transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-black text-gray-900 group-hover:text-blue-600 transition-colors">{h.symbol}</span>
                          <span className="text-[10px] text-gray-400 uppercase font-mono">{h.timestamp}</span>
                        </div>
                        <div className={`text-xs font-bold ${h.score > 60 ? 'text-green-600' : 'text-orange-500'}`}>
                          {h.score} pts
                        </div>
                      </button>
                    )) : (
                      <div className="flex flex-col items-center justify-center py-12 opacity-50 text-center text-gray-400">
                        <Calendar className="w-8 h-8 mb-2" />
                        <p className="text-xs">尚無歷史記錄</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Big Column */}
            <div className="lg:col-span-8 space-y-8">
              {/* Asset Header Info */}
              {activeData && (
                <div className="bg-white border border-gray-200 rounded-3xl p-8 lg:p-10 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-96 h-96 bg-blue-100 blur-[100px] -mr-48 -mt-48 transition-all duration-700" />
                  
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 relative">
                    <div className="flex items-start gap-8">
                      <div className="hidden sm:flex w-24 h-24 rounded-[28px] bg-blue-50 border border-blue-100 items-center justify-center p-4">
                        <Activity className="w-full h-full text-blue-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-[10px] font-black tracking-widest text-blue-600 uppercase">
                            US Market
                          </span>
                          <span className="text-gray-400 text-xs font-mono">/ EQUITY</span>
                        </div>
                        <h2 className="text-6xl font-black tracking-tighter mb-2 text-gray-900">{activeData.symbol}</h2>
                        <div className="flex items-center gap-4">
                          <span className="text-4xl font-mono tracking-tight text-gray-900">${activeData.price.toLocaleString()}</span>
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-sm ${(activeData.change || "0.00%").startsWith('-') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                             {(activeData.change || "0.00%").startsWith('-') ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                             {activeData.change || "0.00%"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-6 md:pt-0 border-t md:border-t-0 border-gray-100">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Algo Rating</p>
                        <p className={`text-2xl font-black ${activeData.algoRating > 70 ? 'text-green-600' : activeData.algoRating > 40 ? 'text-orange-500' : 'text-red-600'}`}>
                          {activeData.algoRating}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Trend</p>
                        <p className={`text-2xl font-black ${activeData.decision.status === "available" ? "text-gray-800" : "text-red-600"}`}>
                          {activeData.decision.status === "available" ? formatDashboardTrend(activeData.decision.trend) : "AI 判斷不可用"}
                        </p>
                      </div>
                      <div className="space-y-1 col-span-2 md:col-span-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Action</p>
                        <p className={`text-2xl font-black ${activeData.decision.status !== "available" ? "text-red-600" : activeData.decision.action === "buy" ? "text-blue-600" : activeData.decision.action === "sell" ? "text-red-500" : "text-gray-500"}`}>
                          {activeData.decision.status === "available" ? formatDashboardAction(activeData.decision.action) : "AI 判斷不可用"}
                        </p>
                      </div>
                      {activeData.decision.status === "unavailable" && (
                        <p className="col-span-2 md:col-span-3 -mt-2 text-xs font-medium text-red-600">{activeData.decision.reason}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Valuation Widget Section */}
              {activeData && (
                 <ValuationWidget data={valuationData} loading={loading} />
              )}

              {/* Chart Section */}
              <div className="bg-white border border-gray-200 rounded-3xl p-6 lg:p-8 shadow-sm relative mt-8">
                 <PriceVolumeChart 
                   data={activeData?.chartData || []} 
                   symbol={activeData?.symbol || "---"}
                 />
              </div>

              {/* Options Data Widget (replaced fund flow) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
                <div className="lg:col-span-8">
                  <StrategyCards 
                     quantStrategies={activeData?.quantStrategies || []}
                     recommendedTrade={activeData?.recommendedTrade}
                  />
                </div>
                
                <div className="lg:col-span-4 space-y-8">
                  <OptionsFlowCard data={activeData?.optionsFlow as any} symbol={activeData?.symbol} />
                </div>
              </div>

              {/* Key Insights AI Analysis */}
              {activeData && activeData.dashboardNarrative?.status === "available" && activeData.finalAnalysis ? (
                <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 shadow-sm rounded-3xl p-8 lg:p-10 relative overflow-hidden group mt-8">
                   <div className="absolute top-0 right-0 w-64 h-64 bg-blue-100 blur-[80px] -mr-32 -mt-32 rounded-full transition-all duration-700" />
                   <h3 className="text-xl font-black text-blue-800 tracking-tight mb-6 flex items-center gap-3">
                     <Zap className="w-5 h-5 text-blue-500" />
                     個股解讀（AI Key Insights）
                   </h3>
                   <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed tracking-wide font-medium">
                     <ReactMarkdown remarkPlugins={[remarkGfm]}>
                       {activeData.finalAnalysis}
                     </ReactMarkdown>
                   </div>
                </div>
              ) : activeData ? (
                <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
                  <h3 className="flex items-center gap-3 text-xl font-black text-amber-900">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                    AI Key Insights 暫不可用
                  </h3>
                  <p className="mt-3 text-sm font-semibold leading-6 text-amber-800">
                    {(activeData.dashboardNarrative && "reason" in activeData.dashboardNarrative
                      ? activeData.dashboardNarrative.reason
                      : "API 未返回完整 AI 分析。")}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Right Side Column */}
              <div className="lg:col-span-4 space-y-8">
                {/* Sentiment & Signal Section */}
                <div className="grid grid-cols-1 gap-6">
                  <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-sm font-black text-gray-900">資料來源與可信度</h3>
                        <p className="text-[11px] text-gray-500 font-semibold leading-5 mt-1">
                          價格、期權、新聞與指標先取市場資料；AI 只負責整合解讀。
                        </p>
                      </div>
                      <a
                        href="#/work/trading-agent-dashboard"
                        className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-black tracking-wider text-blue-700 hover:bg-blue-100"
                      >
                        深度分析
                      </a>
                    </div>
                    <div className="mb-4 grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-emerald-50 px-3 py-2">
                        <p className="text-[9px] font-black uppercase tracking-wider text-emerald-700">Data First</p>
                        <p className="mt-1 text-[11px] font-bold text-emerald-950">市場資料優先</p>
                      </div>
                      <div className="rounded-2xl bg-blue-50 px-3 py-2">
                        <p className="text-[9px] font-black uppercase tracking-wider text-blue-700">AI Guardrail</p>
                        <p className="mt-1 text-[11px] font-bold text-blue-950">
                          最多 {FINANCE_ANALYZER_MODEL_CALL_BUDGETS.dashboard.maxOpenRouterCalls} 次模型調用
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {FINANCE_ANALYZER_SOURCE_MAP.slice(0, 8).map((item) => (
                        <div
                          key={item.layer}
                          title={`${item.layer} | ${item.endpoint}`}
                          className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5"
                        >
                          <div>
                            <p className="text-[12px] font-bold text-gray-900">{item.displayLayer}</p>
                            <p className="text-[10px] text-gray-500 leading-4">{item.displaySource}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black tracking-wider ${item.deterministic ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>
                            {item.deterministic ? "規則計算" : "AI 摘要"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                    {activeData && <TechnicalRadar data={technicalData} loading={loading} />}
                  <SentimentGauge
                    sentiment={activeData?.marketSentiment ?? null}
                    sentimentSource={activeData?.sentimentSource}
                    sentimentData={activeData?.sentimentData ?? null}
                    news={activeData?.news || []}
                  />
                  <FearIndexCard data={vixData} />
                  <FinancialJuiceWidget />
                  <TraderRiskSnapshotCard data={activeData?.chartData || []} />
                  <NewsFeed news={(activeData?.news || []) as SubNewsItem[]} />
                </div>
              </div>
          </div>
        )}

        {/* Footer info */}
        <div className="mt-16 pt-8 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
           <div className="flex items-center gap-6">
              <span className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-blue-500" /> AI AGENT ACTIVE</span>
              <span className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-green-500" /> ALL API NOMINAL</span>
              <span className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-purple-500" /> AI 摘要上限 {FINANCE_ANALYZER_MODEL_CALL_BUDGETS.dashboard.maxOpenRouterCalls}</span>
           </div>
           <div>© 2026 ANTIGRAVITY QUANTUM RESEARCH | V4.0.0-LIGHT</div>
        </div>
      </div>
    </div>
  );
}
