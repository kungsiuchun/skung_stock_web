import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import type {
  CandlestickBias,
  CandlestickInterval,
  CandlestickPatternData,
  CandlestickPatternMatch,
  CandlestickTrendContext,
} from "@/lib/candlestick-patterns";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";

interface ChartDataPoint {
  date_iso?: string;
  time?: string;
  price?: number;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

interface PriceVolumeChartProps {
  data: ChartDataPoint[];
  symbol: string;
}

interface CandlestickApiResponse {
  data?: CandlestickPatternData;
  cache?: MarketCacheMetadata;
  error?: string;
}

interface CachedAnalysis {
  data: CandlestickPatternData;
  cache: MarketCacheMetadata;
}

const INTERVAL_LABELS: Record<CandlestickInterval, string> = {
  "1d": "日線",
  "1wk": "週線",
  "1mo": "月線",
};

const BIAS_LABELS: Record<CandlestickBias, string> = {
  bullish: "偏多",
  bearish: "偏空",
  neutral: "中性",
};

const TREND_LABELS: Record<CandlestickTrendContext, string> = {
  bullish: "上升",
  bearish: "下降",
  neutral: "橫行／未確認",
  unavailable: "資料不足",
};

const biasClasses = (bias: CandlestickBias | CandlestickTrendContext) => {
  if (bias === "bullish") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (bias === "bearish") return "border-red-200 bg-red-50 text-red-800";
  if (bias === "unavailable") return "border-gray-200 bg-gray-50 text-gray-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

const buildMarkers = (matches: CandlestickPatternMatch[]): SeriesMarker<Time>[] => {
  const grouped = new Map<string, CandlestickPatternMatch[]>();
  for (const match of matches) {
    const key = `${match.endTime}:${match.bias}`;
    grouped.set(key, [...(grouped.get(key) || []), match]);
  }
  return [...grouped.values()]
    .map((group) => {
      const match = group[0];
      const suffix = group.length > 1 ? ` +${group.length - 1}` : "";
      if (match.bias === "bullish") {
        return {
          time: match.endTime as Time,
          position: "belowBar" as const,
          shape: "arrowUp" as const,
          color: "#16a34a",
          text: `${match.nameZh}${suffix}`,
        };
      }
      if (match.bias === "bearish") {
        return {
          time: match.endTime as Time,
          position: "aboveBar" as const,
          shape: "arrowDown" as const,
          color: "#dc2626",
          text: `${match.nameZh}${suffix}`,
        };
      }
      return {
        time: match.endTime as Time,
        position: "aboveBar" as const,
        shape: "circle" as const,
        color: "#d97706",
        text: `${match.nameZh}${suffix}`,
      };
    })
    .sort((left, right) => String(left.time).localeCompare(String(right.time)));
};

export function PriceVolumeChart({ data, symbol }: PriceVolumeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [patternsEnabled, setPatternsEnabled] = useState(false);
  const [interval, setInterval] = useState<CandlestickInterval>("1d");
  const [cacheByInterval, setCacheByInterval] = useState<Partial<Record<CandlestickInterval, CachedAnalysis>>>({});
  const [loadingInterval, setLoadingInterval] = useState<CandlestickInterval | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPatternsEnabled(false);
    setInterval("1d");
    setCacheByInterval({});
    setLoadingInterval(null);
    setError(null);
  }, [symbol]);

  useEffect(() => {
    if (!patternsEnabled || cacheByInterval[interval]) return;
    const controller = new AbortController();
    let current = true;
    setLoadingInterval(interval);
    setError(null);

    fetch(`/api/candlestick-patterns?symbol=${encodeURIComponent(symbol)}&interval=${interval}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as CandlestickApiResponse;
        if ((!response.ok && response.status !== 206) || !payload.data || !payload.cache) {
          throw new Error(payload.error || `K 線型態 API 回傳 HTTP ${response.status}。`);
        }
        return { data: payload.data, cache: payload.cache };
      })
      .then((resolved) => {
        if (!current) return;
        setCacheByInterval((previous) => ({ ...previous, [interval]: resolved }));
      })
      .catch((requestError) => {
        if (!current || requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        if (current) setLoadingInterval(null);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [cacheByInterval, interval, patternsEnabled, symbol]);

  const selected = patternsEnabled ? cacheByInterval[interval] : undefined;
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!selected) return data;
    return selected.data.bars.map((bar) => ({
      date_iso: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      price: bar.close,
      volume: bar.volume,
    }));
  }, [data, selected]);
  const markers = useMemo(
    () => selected ? buildMarkers(selected.data.analysis.recentMatches.slice(-12)) : [],
    [selected],
  );

  useEffect(() => {
    if (!containerRef.current || chartData.length === 0) return;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const validData = chartData
      .map((point) => ({
        time: point.time || point.date_iso,
        open: Number(point.open ?? point.price),
        high: Number(point.high ?? point.price),
        low: Number(point.low ?? point.price),
        close: Number(point.close ?? point.price),
        volume: Number(point.volume),
      }))
      .filter((point) => Boolean(point.time)
        && [point.open, point.high, point.low, point.close, point.volume].every(Number.isFinite)
        && point.low <= Math.min(point.open, point.close)
        && point.high >= Math.max(point.open, point.close));
    if (validData.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#64748b",
        fontFamily: "'Inter', -apple-system, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(0,0,0,0.03)" },
        horzLines: { color: "rgba(0,0,0,0.03)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        horzLine: { color: "rgba(0,0,0,0.1)", style: 2 },
        vertLine: { color: "rgba(0,0,0,0.1)", style: 2 },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    candleSeries.setData(validData.map((point) => ({
      time: point.time as Time,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    })));
    volumeSeries.setData(validData.map((point) => ({
      time: point.time as Time,
      value: point.volume,
      color: point.close >= point.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
    })));
    const seriesMarkers = createSeriesMarkers(candleSeries, markers);
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      seriesMarkers.detach();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartData, markers]);

  const latestMatches = selected?.data.analysis.latestMatches || [];
  const recentMatches = selected?.data.analysis.recentMatches.slice(-5).reverse() || [];
  const patternBias = selected?.data.analysis.patternBias || "neutral";
  const trendContext = selected?.data.analysis.trendContext || "unavailable";
  const conflictsWithTrend = selected
    && patternBias !== "neutral"
    && trendContext !== "neutral"
    && trendContext !== "unavailable"
    && patternBias !== trendContext;

  return (
    <div className="flex w-full flex-col">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">
            {symbol} {selected ? INTERVAL_LABELS[interval] : "近期走勢（日線）"} K 線圖
          </h3>
          {patternsEnabled && !selected && (
            <p className="mt-1 text-[10px] font-semibold text-gray-400">載入前暫時保留原有日線圖</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {patternsEnabled && (
            <div className="flex rounded-xl bg-gray-100 p-1" aria-label="K 線時段">
              {(Object.keys(INTERVAL_LABELS) as CandlestickInterval[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInterval(value)}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition ${interval === value ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                >
                  {INTERVAL_LABELS[value]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-pressed={patternsEnabled}
            onClick={() => {
              setPatternsEnabled((current) => !current);
              setError(null);
            }}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black transition ${patternsEnabled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"}`}
          >
            {patternsEnabled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {patternsEnabled ? "隱藏型態" : "顯示型態"}
          </button>
          <div className="flex items-center gap-3 text-[10px] font-bold text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-green-500" /> 上漲</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-red-500" /> 下跌</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <div ref={containerRef} className="w-full" style={{ height: 320 }} />
        {loadingInterval === interval && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]" aria-live="polite">
            <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-700 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              載入{INTERVAL_LABELS[interval]}型態
            </div>
          </div>
        )}
      </div>

      {patternsEnabled && error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-black">{INTERVAL_LABELS[interval]}型態分析失敗</p>
            <p className="mt-1 text-xs font-semibold">{error} 原有日線圖已保留，系統沒有產生替代訊號。</p>
          </div>
        </div>
      )}

      {patternsEnabled && selected && (
        <section className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5" aria-label="K 線型態分析">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Candlestick Pattern Analysis</p>
              <h4 className="mt-1 text-base font-black text-gray-900">{INTERVAL_LABELS[interval]}型態分析</h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-xl border px-3 py-2 ${biasClasses(patternBias)}`}>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-70">型態傾向</p>
                <p className="mt-1 text-sm font-black">{BIAS_LABELS[patternBias]}</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${biasClasses(trendContext)}`}>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-70">SMA20 背景</p>
                <p className="mt-1 text-sm font-black">{TREND_LABELS[trendContext]}</p>
              </div>
            </div>
          </div>

          {conflictsWithTrend && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              型態方向與 SMA20 背景相反：只可視為潛在反轉觀察，尚未確認。
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
              <p className="text-xs font-black text-gray-900">最新已完成 K 線</p>
              {latestMatches.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {latestMatches.map((match) => (
                    <div key={`${match.id}:${match.endTime}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-gray-900">{match.nameZh}</p>
                        <span className={`rounded-full px-2 py-1 text-[9px] font-black ${biasClasses(match.bias)}`}>{BIAS_LABELS[match.bias]}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium leading-5 text-gray-600">{match.ruleSummary}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs font-semibold leading-5 text-gray-500">最新已完成 K 線未識別到指定型態，因此型態傾向為中性。</p>
              )}
            </div>

            <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
              <p className="text-xs font-black text-gray-900">近期命中（最多五項）</p>
              {recentMatches.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {recentMatches.map((match) => (
                    <div key={`${match.id}:${match.endTime}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-bold text-gray-700">{match.nameZh}</span>
                      <span className="shrink-0 font-mono text-[10px] text-gray-400">{match.endTime}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs font-semibold text-gray-500">最近 120 支 K 線沒有命中精選型態。</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1 border-t border-gray-200 pt-3 text-[10px] font-semibold text-gray-500 sm:flex-row sm:items-center sm:justify-between">
            <span>Yahoo Finance 行情 + 本地固定型態規則｜資料截至 {selected.data.sourceAsOf}</span>
            <span>
              {selected.cache.status === "stale"
                ? `舊資料 ${selected.cache.ageSeconds}s｜更新失敗：${selected.cache.refreshError || "原因未提供"}`
                : `Cache: ${selected.cache.status}`}
              {selected.data.partialBarExcluded ? "｜已排除未完成 K 線" : ""}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
