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
import { DeepEarSignalsCard } from "./dashboard/deepear-signals";
import { ValuationWidget } from "./dashboard/valuation-widget";
import { TechnicalRadar } from "./dashboard/technical-radar";
import { FinancialJuiceWidget } from "./dashboard/financial-juice-widget";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FINANCE_ANALYZER_MODEL_CALL_BUDGETS,
  FINANCE_ANALYZER_SOURCE_MAP,
  normalizeQuantStrategiesFromAgentResponse,
} from "@/lib/finance-analyzer-contract";
import type { SentimentApiResult } from "@/lib/market-sentiment";

interface NewsItem {
  title: string;
  publisher: string;
  publish_time: string;
  link: string;
  source?: string;
}

interface DashboardData {
  symbol: string;
  price: number;
  change: string;
  algoRating: number;
  marketSentiment: number | null;
  sentimentSource?: string;
  sentimentData?: SentimentApiResult | null;
  signal: string;
  trend: string;
  strategyPoints: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
  };
  news: NewsItem[];
  chartData: { date: string; price: number; volume: number }[];
  optionsFlow?: {
    totalCallOI: number;
    totalPutOI: number;
    ratio: number;
    topStrikes: { strike: number; callOI: number; putOI: number }[];
    expirationDate?: string;
    interpretation?: string;
    error?: string;
  };
  quantStrategies?: { name: string; score: number }[];
  financialSignals?: any[];
  finalAnalysis?: string;
}

interface HistoryItem {
  symbol: string;
  timestamp: string;
  score: number;
  fullData?: DashboardData;
}


export function FinanceDashboard() {
  const [valuationData, setValuationData] = useState<any>(null);
  const [technicalData, setTechnicalData] = useState<any>(null);

  // Focus specific data sets based on natural language
  const [activeData, setActiveData] = useState<DashboardData | null>(null);
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [vixData, setVixData] = useState<any>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // 1. Load from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem("finance_dashboard_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    const savedActiveData = localStorage.getItem("finance_dashboard_active_data");
    if (savedActiveData) {
      try {
        setActiveData(JSON.parse(savedActiveData));
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

  const handleAnalyze = async () => {
    if (!symbol.trim() || loading) return;
    
    try {
      setLoading(true);
      setError(null);
      // Reset all data states to avoid pollution (Rule 7)
      setActiveData(null);

      // Start news fetch in parallel
      const newsPromise = fetch(`/api/news?symbol=${symbol.toUpperCase()}`)
        .then(r => r.json())
        .catch(() => ({ news: [] }));

      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "finance_dashboard",
          message: `分析 ${symbol.toUpperCase()}。
1. 先使用 get_realtime_quote 取得最新價格。
2. 使用 get_options_chain 取得股票期權鏈；如果 Yahoo 沒有資料，明確說沒有期權鏈資料。
3. 使用 get_financial_signals 取得 DeepEar 訊號；如果來源為空，回傳空訊號，不要創作 demo 訊號。
4. 使用 run_algorithmic_strategy，strategy_name 必須是 "all"，由 deterministic strategy engine 回傳策略分數。
5. 最終回覆使用繁體中文，綜合工具結果做精簡 narrative；缺資料要標示，不要用假資料補洞。`,
          history: [],
        }),
      });

      const vixPromise = fetch(`/api/vix`).then(r => r.json()).catch(() => null);
      const valuationPromise = fetch(`/api/fundamentals?symbol=${symbol.toUpperCase()}`).then(r => r.json()).catch(() => null);
      const technicalPromise = fetch(`/api/technical-radar?symbol=${symbol.toUpperCase()}`).then(r => r.json()).catch(() => null);
      const sentimentPromise = fetch(`/api/sentiment?symbol=${symbol.toUpperCase()}`).then(r => r.json()).catch(() => null);

      const [data, newsData, vixResponse, valuationRes, technicalRes, sentimentRes] = await Promise.all([
        response.json(),
        newsPromise,
        vixPromise,
        valuationPromise,
        technicalPromise,
        sentimentPromise
      ]);

      if (vixResponse && !vixResponse.error) {
        setVixData(vixResponse);
      }
      
      if (valuationRes) setValuationData(valuationRes);
      if (technicalRes) setTechnicalData(technicalRes);

      if (!response.ok) throw new Error(data.error || "API 請求失敗");

      const sentimentPayload: SentimentApiResult | null =
        sentimentRes && !sentimentRes.error ? sentimentRes as SentimentApiResult : null;

      // 2. Parse Tool Results from Steps
      let price = 0;
      let change = "0.00%";
      let signalResult = "觀望";
      let algoScore = 50;
      let sentimentValue: number | null = null;
      let sentimentSource: string | undefined;
      let entry = 0, sl = 0, tp = 0;
      let trendResult = "震盪";
      let parsedNews: NewsItem[] = (newsData.news || []).map((n: any) => ({
        ...n,
        source: n.publisher || n.source || "Yahoo Finance"
      }));
      let chartDataArray: any[] = [];
      let optionsFlowData: any = null;
      let financialSignalsArray: any[] = [];
      let quantStrategiesResult: any[] = [];

      if (data.steps && Array.isArray(data.steps)) {
        for (const step of data.steps) {
          if (step.type === "tool_call" && step.tool_result) {
            try {
              // Standardize tool result (protect against NaN)
              const toolResult = step.tool_result.trim();
              const resJson = JSON.parse(toolResult);
              
              if (step.tool_name === "get_realtime_quote") {
                const p = Number(resJson.price || resJson.current_price);
                if (!isNaN(p)) price = p;
                // change_pct comes back as a number like -2.15, format to "-2.15%"
                const rawPct = resJson.change_pct ?? resJson.change_percent;
                if (rawPct !== undefined && rawPct !== null) {
                  const pctNum = Number(rawPct);
                  if (!isNaN(pctNum)) {
                    change = (pctNum >= 0 ? "+" : "") + pctNum.toFixed(2) + "%";
                  }
                }
              }

              // Data-driven extraction to protect against LLM tool-calling drift
              if (resJson.chart_data && Array.isArray(resJson.chart_data)) {
                chartDataArray = resJson.chart_data.map((d: any) => ({
                  ...d,
                  price: Number(d.price || 0),
                  open: Number(d.open || d.price || 0),
                  high: Number(d.high || d.price || 0),
                  low: Number(d.low || d.price || 0),
                  volume: Number(d.volume || 0)
                }));
              }

              if (resJson.score !== undefined) algoScore = Number(resJson.score);
              if (resJson.entry !== undefined) entry = Number(resJson.entry);
              if (resJson.stopLoss !== undefined) sl = Number(resJson.stopLoss);
              if (resJson.target !== undefined) tp = Number(resJson.target);
              if (resJson.trend) trendResult = resJson.trend;
              if (resJson.signal) signalResult = resJson.signal;

              if (step.tool_name === "get_options_chain") {
                let totalCallOI = 0;
                let totalPutOI = 0;
                const topStrikesMap = new Map<number, {callOI: number, putOI: number}>();
                
                const calls = resJson.calls || [];
                const puts = resJson.puts || [];
                
                calls.forEach((c: any) => {
                  const oi = c.open_interest || c.volume || 0;
                  totalCallOI += oi;
                  const s = topStrikesMap.get(c.strike) || { callOI: 0, putOI: 0 };
                  s.callOI += oi;
                  topStrikesMap.set(c.strike, s);
                });
                
                puts.forEach((p: any) => {
                  const oi = p.open_interest || p.volume || 0;
                  totalPutOI += oi;
                  const s = topStrikesMap.get(p.strike) || { callOI: 0, putOI: 0 };
                  s.putOI += oi;
                  topStrikesMap.set(p.strike, s);
                });
                
                const ratio = totalPutOI > 0 ? (totalCallOI / totalPutOI) : 1;
                const underlyingPrice = resJson.underlying_price || 0;
                const topStrikes = Array.from(topStrikesMap.entries())
                  .map(([strike, data]) => ({ strike: Number(strike), ...data }))
                  .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))
                  .slice(0, 8)
                  .sort((a, b) => b.strike - a.strike); // sort descending by strike for display

                let expStr = "";
                if (resJson.current_expiration) {
                  const d = new Date(resJson.current_expiration * 1000);
                  expStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                }

                if (topStrikes.length > 0) {
                  optionsFlowData = {
                    totalCallOI,
                    totalPutOI,
                    ratio,
                    topStrikes,
                    expirationDate: expStr || undefined
                  };
                } else if (resJson.error) {
                  optionsFlowData = { error: resJson.error };
                }
              }

              
              if (step.tool_name === "get_financial_signals" && resJson.signals && Array.isArray(resJson.signals)) {
                financialSignalsArray = resJson.signals;
              }

              if (step.tool_name === "run_algorithmic_strategy" && Array.isArray(resJson.signals)) {
                const topSignal = resJson.signals[0];
                if (topSignal) {
                  if (Number.isFinite(Number(topSignal.score))) algoScore = Number(topSignal.score);
                  if (topSignal.signal) signalResult = topSignal.signal;
                  if (topSignal.trend) trendResult = topSignal.trend;
                  if (Number.isFinite(Number(topSignal.entry))) entry = Number(topSignal.entry);
                  if (Number.isFinite(Number(topSignal.stopLoss))) sl = Number(topSignal.stopLoss);
                  if (Number.isFinite(Number(topSignal.target))) tp = Number(topSignal.target);
                }
              }
            } catch (e) {
              console.warn("Failed to parse tool result for step:", step.tool_name, e);
            }
          }
        }
      }

      quantStrategiesResult = normalizeQuantStrategiesFromAgentResponse(data);
      if (typeof sentimentPayload?.score === "number" && Number.isFinite(sentimentPayload.score)) {
        sentimentValue = sentimentPayload.score;
      }
      if (sentimentPayload?.sourceLabel) {
        sentimentSource = sentimentPayload.sourceLabel;
      }

      const finalData: DashboardData = {
        symbol: symbol.toUpperCase(),
        price,
        change,
        algoRating: algoScore,
        marketSentiment: sentimentValue,
        sentimentSource,
        sentimentData: sentimentPayload,
        signal: signalResult,
        trend: trendResult,
        strategyPoints: { entry, stopLoss: sl, takeProfit: tp },
        news: parsedNews,
        chartData: chartDataArray,
        optionsFlow: optionsFlowData || {
          totalCallOI: 0,
          totalPutOI: 0,
          ratio: 1,
          topStrikes: [],
          error: "未找到期權鏈數據"
        },
        quantStrategies: quantStrategiesResult,
        financialSignals: financialSignalsArray,
        finalAnalysis: data.reply || data.summary || "AI 代理尚未生成最終分析總結。"
      };

      setActiveData(finalData);
      
      // Update history with full data for instant switching
      const newHistory = [
        { symbol: symbol.toUpperCase(), timestamp: new Date().toLocaleTimeString(), score: algoScore, fullData: finalData },
        ...history.filter(h => h.symbol !== symbol.toUpperCase()).slice(0, 4)
      ];
      setHistory(newHistory);

    } catch (err: any) {
      console.error("Analysis Error:", err);
      setError(err.message || "分析過程中發生錯誤");
    } finally {
      setLoading(false);
    }
  };

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
                      onClick={() => { setHistory([]); localStorage.removeItem("finance_dashboard_history"); }}
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
                            setActiveData(h.fullData);
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
              onClick={handleAnalyze}
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

        {!activeData && !loading ? (
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
                            setActiveData(h.fullData);
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
                        <p className="text-2xl font-black text-gray-800">{activeData.trend}</p>
                      </div>
                      <div className="space-y-1 col-span-2 md:col-span-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Action</p>
                        <p className={`text-2xl font-black ${activeData.signal === '買入' ? 'text-blue-600' : activeData.signal === '賣出' ? 'text-red-500' : 'text-gray-400'}`}>
                          {activeData.signal}
                        </p>
                      </div>
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
                     signal={activeData?.signal || "觀望"} 
                     trend={activeData?.trend || "震盪"} 
                     price={activeData?.price || 0} 
                     entry={activeData?.strategyPoints.entry}
                     stopLoss={activeData?.strategyPoints.stopLoss}
                     takeProfit={activeData?.strategyPoints.takeProfit}
                  />
                  
                  {activeData?.financialSignals && activeData.financialSignals.length > 0 && (
                     <div className="mt-8 bg-blue-50/50 border border-blue-100 rounded-3xl p-6">
                        <div className="text-blue-600 font-bold mb-3 flex items-center gap-2">
                           <Activity className="w-5 h-5"/>
                           AI DeepEar Signals
                        </div>
                        <ul className="space-y-2">
                          {activeData.financialSignals.map((sig, idx) => (
                             <li key={idx} className="flex gap-3 text-sm text-gray-700">
                                <span className={`w-2 h-2 mt-1.5 rounded-full ${sig.signal === 'BULLISH' ? 'bg-green-500' : sig.signal === 'BEARISH' ? 'bg-red-500' : 'bg-gray-400'}`} />
                                <span className="flex-1">{sig.reasoning.substring(0, 100)}...</span>
                             </li>
                          ))}
                        </ul>
                     </div>
                  )}
                </div>
                
                <div className="lg:col-span-4 space-y-8">
                  <OptionsFlowCard data={activeData?.optionsFlow as any} symbol={activeData?.symbol} />
                </div>
              </div>

              {/* Key Insights AI Analysis */}
              {activeData?.finalAnalysis && (
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
              )}
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
                      {FINANCE_ANALYZER_SOURCE_MAP.slice(0, 7).map((item) => (
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
                    quantStrategies={activeData?.quantStrategies}
                  />
                  <FearIndexCard data={vixData} />
                  <FinancialJuiceWidget />
                  <DeepEarSignalsCard signals={activeData?.financialSignals || []} />
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
