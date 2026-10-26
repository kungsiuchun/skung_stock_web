import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { WatcherValuationBands } from "@/lib/stocks-watcher-valuation-data";
import { STOCKS_WATCHER_PRICE_RANGES, type StocksWatcherPriceRange } from "@/lib/stocks-intelligence-watcher-session";
import {
  NativeToolResult,
  ChartGexAggregateRow,
  SharedPriceAxisRange,
  SharedPriceAxisCoordinates,
  ApprovedUniverseRegime,
  ApprovedUniverseHolding,
  RawHistoryPoint,
  SparklinePoint,
  SparklineTooltipPosition,
  RawQuoteRow,
  formatNumber,
  currency,
  formatExpiryDate,
  priceRangeLabel,
  normalizeSymbol,
  resultLooksHtml,
  htmlSrcDoc,
  rawRecord,
  rawNumber,
  historyFromResult,
  quotesFromResult,
  compactDateLabel,
  optionLegDisplayNumber,
  VALUATION_METRIC_LABEL,
} from "./stocks-intelligence-watcher-view-model";

export const SkeletonBlock = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-md bg-slate-800/70 ${className}`} />
);

export const MetricTile = ({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative" | "blue" | "yellow";
}) => (
  <div className={`siw-metric-tile siw-tone-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export const ValuationRainbowChart = ({ valuation }: { valuation: WatcherValuationBands }) => {
  const bands = valuation.latest.bands;
  const values = [bands.down2, bands.down1, bands.mean, bands.up1, bands.up2, valuation.latest.price]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length < 2 || valuation.latest.price === null) return null;

  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, Math.max(1, Math.abs(high)) * 0.04);
  const position = (value: number | null) => typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, ((value - low) / range) * 100))
    : null;
  const currentPosition = position(valuation.latest.price);
  const labels = [
    { key: "down2", label: "−2σ", value: bands.down2 },
    { key: "down1", label: "−1σ", value: bands.down1 },
    { key: "mean", label: "Mean", value: bands.mean },
    { key: "up1", label: "+1σ", value: bands.up1 },
    { key: "up2", label: "+2σ", value: bands.up2 },
  ];

  return (
    <div
      className="siw-valuation-rainbow"
      data-valuation-rainbow-chart
      data-valuation-metric={valuation.metric}
      aria-label={`${valuation.symbol} ${VALUATION_METRIC_LABEL[valuation.metric]} ${valuation.window} valuation band chart`}
    >
      <div className="siw-valuation-rainbow-rail" aria-hidden="true">
        {currentPosition !== null && <i className="siw-valuation-rainbow-marker" style={{ left: `${currentPosition}%` }} />}
      </div>
      <div className="siw-valuation-rainbow-labels">
        {labels.map((band) => {
          const bandPosition = position(band.value);
          return bandPosition === null ? null : (
            <span key={band.key} style={{ left: `${bandPosition}%` }}>
              <b>{band.label}</b>{currency(band.value || 0)}
            </span>
          );
        })}
      </div>
      <p><b>Published price {currency(valuation.latest.price)}</b><span>Lower historical multiple → Mean → Higher multiple</span></p>
    </div>
  );
};

export const ErrorBanner = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
    <span>{message}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="rounded border border-red-300/40 px-2 py-1 text-xs font-bold hover:bg-red-400/10">
        Retry
      </button>
    )}
  </div>
);

export const OptionsEmptyState = ({ expiry, onRetry }: { expiry?: string | null; onRetry?: () => void }) => (
  <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-md border border-slate-800 bg-slate-950/50 p-6 text-center">
    <p className="text-sm font-black text-blue-100">No structured options data for this expiry</p>
    <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
      The active source has no supported payload for {formatExpiryDate(expiry, "long")} in this panel.
    </p>
    {onRetry && (
      <button type="button" onClick={onRetry} className="mt-4 rounded-md border border-blue-400/40 px-3 py-2 text-xs font-bold text-blue-100 hover:bg-blue-500/10">
        Retry
      </button>
    )}
  </div>
);

export const OptionsUnsupportedState = ({ title, reason, source }: { title: string; reason: string; source?: string | null }) => (
  <div className="flex min-h-[14rem] flex-col items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/5 p-6 text-center" data-options-unsupported>
    <p className="text-sm font-black text-amber-100">{title}</p>
    <p className="mt-2 max-w-lg text-xs leading-5 text-slate-400">{reason}</p>
    {source && <p className="mt-3 text-[0.7rem] font-bold uppercase tracking-wide text-slate-500">Source: {source}</p>}
  </div>
);

export const PutCallRatioChart = ({
  raw,
  hasOpenInterest,
}: {
  raw: Record<string, unknown>;
  hasOpenInterest: boolean;
}) => {
  const metrics = [
    {
      key: "open-interest",
      label: "Open Interest",
      ratio: hasOpenInterest ? optionLegDisplayNumber(raw.putCallOpenInterest) : null,
      calls: optionLegDisplayNumber(raw.callOi),
      puts: optionLegDisplayNumber(raw.putOi),
    },
    {
      key: "volume",
      label: "Volume",
      ratio: optionLegDisplayNumber(raw.putCallVolume),
      calls: optionLegDisplayNumber(raw.callVol),
      puts: optionLegDisplayNumber(raw.putVol),
    },
  ];

  return (
    <figure className="rounded-md border border-slate-800 bg-slate-950/60 p-4" data-options-pcr-chart>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-200">Put / Call Pressure</p>
          <p className="mt-1 text-[0.68rem] text-slate-500">Selected expiry · 1.00 parity · 2.00+ capped on chart</p>
        </div>
        <div className="flex gap-3 text-[0.65rem] font-bold text-slate-400" aria-hidden="true">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan-400" />Call-heavy</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Put-heavy</span>
        </div>
      </div>
      <div className="space-y-5">
        {metrics.map((metric) => {
          const ratio = metric.ratio;
          const available = typeof ratio === "number" && Number.isFinite(ratio);
          const width = available ? Math.max(0, Math.min(100, ratio / 2 * 100)) : 0;
          const putHeavy = available && ratio > 1;
          return (
            <div key={metric.key} data-options-pcr-metric={metric.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-slate-400">P/C {metric.label}</p>
                  {metric.calls !== null && metric.puts !== null && (
                    <p className="mt-0.5 text-[0.65rem] tabular-nums text-slate-500">Puts {formatNumber(metric.puts)} · Calls {formatNumber(metric.calls)}</p>
                  )}
                </div>
                <strong className={`text-2xl font-black tabular-nums ${putHeavy ? "text-amber-200" : "text-cyan-200"}`}>
                  {available ? ratio.toFixed(2) : "n/a"}
                </strong>
              </div>
              <div
                className="relative h-4 overflow-hidden rounded-full border border-slate-700 bg-slate-900"
                role="img"
                aria-label={available ? `${metric.label} put-call ratio ${ratio.toFixed(2)}; parity is 1.00` : `${metric.label} put-call ratio unavailable`}
              >
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${putHeavy ? "bg-amber-400/80" : "bg-cyan-400/80"}`}
                  style={{ width: `${width}%` }}
                />
                <span className="absolute inset-y-0 left-1/2 w-px bg-white/80" aria-hidden="true" />
              </div>
              <div className="mt-1 grid grid-cols-3 text-[0.62rem] font-bold tabular-nums text-slate-600" aria-hidden="true">
                <span>0</span><span className="text-center">1.00 parity</span><span className="text-right">2.00+</span>
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-4 border-t border-slate-800 pt-3 text-[0.68rem] leading-5 text-slate-500">
        Below 1.00 means more calls than puts; above 1.00 means more puts than calls. This is positioning context, not a directional forecast.
      </figcaption>
    </figure>
  );
};

export const OptionsResultProvenance = ({ result }: { result: NativeToolResult | undefined }) => {
  const raw = rawRecord(result?.raw);
  const provenance = rawRecord(raw?.provenance);
  if (!provenance) return null;
  const provider = provenance.provider === "robinhood_mcp" ? "Robinhood MCP EOD" : String(provenance.provider || "Unknown source");
  const capturedAt = typeof provenance.capturedAt === "string" ? formatOptionsSourceTime(provenance.capturedAt) : "capture time unavailable";
  const methodology = typeof provenance.methodology === "string" ? provenance.methodology : "methodology unavailable";
  return (
    <p className="mb-3 rounded border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 text-[0.7rem] leading-5 text-cyan-100" data-options-result-provenance>
      Source: {provider} · Captured: {capturedAt} · Methodology: {methodology}
    </p>
  );
};

/** Source labels are audit evidence, not a millisecond-level activity log. */
export const formatOptionsSourceTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    hour12: true,
  }).format(date)} ET`;
};

export const ExpandableDescription = ({ description }: { description: string }) => {
  const [expanded, setExpanded] = useState(false);
  const previewLimit = 220;
  const isLong = description.length > previewLimit;
  const visibleDescription = expanded || !isLong ? description : `${description.slice(0, previewLimit).trimEnd()}…`;
  return (
    <>
      <p>{visibleDescription || "Company description unavailable from Yahoo."}</p>
      {isLong && (
        <button type="button" className="siw-description-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
};

export type PriceChartStyle = "line" | "mountain" | "candle" | "ohlc";

export interface PriceChartRow extends RawHistoryPoint {
  time: number;
}

export interface PriceChartTooltip {
  x: number;
  y: number;
  point: PriceChartRow;
}

export const toChartRows = (points: RawHistoryPoint[]): PriceChartRow[] => {
  let previousTime = 0;
  return points
    .map((point, index) => {
      const parsed = point.date ? Date.parse(point.date) : Number.NaN;
      const fallback = 1_700_000_000 + index * 86_400;
      let time = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
      if (time <= previousTime) time = previousTime + 60;
      previousTime = time;
      const close = point.close || point.open || point.high || point.low || 0;
      const open = point.open || close;
      const high = point.high || Math.max(open, close);
      const low = point.low || Math.min(open, close);
      return { ...point, time, open, high, low, close, volume: point.volume || 0 };
    })
    .filter((point) => point.close && point.high && point.low);
};

export const getSharedPriceAxisRange = (
  result: NativeToolResult,
  gexRows: ChartGexAggregateRow[],
): SharedPriceAxisRange | null => {
  const priceRows = toChartRows(historyFromResult(result));
  const values = [
    ...priceRows.flatMap((row) => [row.low, row.high].filter((value): value is number => typeof value === "number")),
    ...gexRows.map((row) => row.strike),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.04, 0.01);
  return { min: min - padding, max: max + padding };
};

export const OhlcVolumeChart = ({
  result,
  priceRange = "3mo",
  onPriceRangeChange = () => undefined,
  sharedPriceAxisRange,
  sharedAxisStrikes = [],
  onPriceAxisCoordinatesChange,
}: {
  result: NativeToolResult;
  priceRange?: StocksWatcherPriceRange;
  onPriceRangeChange?: (range: StocksWatcherPriceRange) => void;
  sharedPriceAxisRange?: SharedPriceAxisRange | null;
  sharedAxisStrikes?: number[];
  onPriceAxisCoordinatesChange?: (coordinates: SharedPriceAxisCoordinates | null) => void;
}) => {
  const allPoints = useMemo(() => historyFromResult(result), [result]);
  const [chartStyle, setChartStyle] = useState<PriceChartStyle>("ohlc");
  const [tooltip, setTooltip] = useState<PriceChartTooltip | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);

  const points = useMemo(() => toChartRows(allPoints), [allPoints]);
  const latest = points[points.length - 1];
  const activePoint = tooltip?.point || latest;
  const priorPoint = points[Math.max(0, points.length - 2)];
  const isUp = (activePoint?.close || 0) >= (activePoint?.open || priorPoint?.close || 0);
  const firstLabel = compactDateLabel(points[0]?.date);
  const latestLabel = compactDateLabel(latest?.date);
  const sharedAxisStrikeKey = sharedAxisStrikes.join("|");
  const axisStrikes = useMemo(
    () => sharedAxisStrikes.filter((strike) => Number.isFinite(strike)),
    [sharedAxisStrikeKey],
  );

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return undefined;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    setTooltip(null);

    const palette = getComputedStyle(containerRef.current);
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: palette.getPropertyValue("--ww-surface").trim() || "#05080d" },
        textColor: palette.getPropertyValue("--ww-muted").trim() || "#8aa0bc",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.10)" },
        horzLines: { color: "rgba(148,163,184,0.12)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: chartStyle === "line" || chartStyle === "mountain" ? 5 : 7,
      },
      crosshair: {
        horzLine: { color: "rgba(96,165,250,0.55)", labelBackgroundColor: "#1d4ed8" },
        vertLine: { color: "rgba(96,165,250,0.55)", labelBackgroundColor: "#1d4ed8" },
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    const candleData = points.map((point) => ({
      time: point.time as any,
      open: point.open || point.close || 0,
      high: point.high || point.close || 0,
      low: point.low || point.close || 0,
      close: point.close || point.open || 0,
    }));
    const closeData = points.map((point) => ({ time: point.time as any, value: point.close || 0 }));
    const volumeData = points.map((point) => ({
      time: point.time as any,
      value: point.volume || 0,
      color: (point.close || 0) >= (point.open || 0) ? "rgba(16,185,129,0.58)" : "rgba(248,113,113,0.58)",
    }));

    const priceSeries = chartStyle === "line"
      ? chart.addSeries(LineSeries, {
          color: "#60a5fa",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        })
      : chartStyle === "mountain"
        ? chart.addSeries(AreaSeries, {
            lineColor: "#60a5fa",
            topColor: "rgba(37,99,235,0.38)",
            bottomColor: "rgba(37,99,235,0.02)",
            lineWidth: 2,
            priceLineVisible: false,
          })
        : chartStyle === "candle"
          ? chart.addSeries(CandlestickSeries, {
              upColor: "#10b981",
              downColor: "#f43f5e",
              borderUpColor: "#34d399",
              borderDownColor: "#fb7185",
              wickUpColor: "#34d399",
              wickDownColor: "#fb7185",
            })
          : chart.addSeries(BarSeries, {
              upColor: "#10b981",
              downColor: "#f43f5e",
              thinBars: false,
            });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    if (sharedPriceAxisRange) {
      priceSeries.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: sharedPriceAxisRange.min, maxValue: sharedPriceAxisRange.max },
        }),
      });
    }

    priceSeries.setData(chartStyle === "line" || chartStyle === "mountain" ? closeData : candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    let axisFrame: number | null = null;
    let axisSettleTimer: number | null = null;
    let axisGestureActive = false;
    const reportAxisCoordinates = () => {
      if (!onPriceAxisCoordinatesChange || !containerRef.current) return;
      const surfaceBounds = containerRef.current.getBoundingClientRect();
      const pricePanelBounds = containerRef.current.closest(".siw-chart-price-panel")?.getBoundingClientRect();
      const chartTop = pricePanelBounds ? surfaceBounds.top - pricePanelBounds.top : 0;
      const coordinates = Object.fromEntries(
        axisStrikes.flatMap((strike) => {
          const coordinate = priceSeries.priceToCoordinate(strike);
          return coordinate === null || !Number.isFinite(coordinate)
            ? []
            : [[String(strike), chartTop + coordinate]];
        }),
      );
      onPriceAxisCoordinatesChange(coordinates);
    };
    const scheduleAxisCoordinates = () => {
      if (axisFrame !== null) window.cancelAnimationFrame(axisFrame);
      axisFrame = window.requestAnimationFrame(reportAxisCoordinates);
    };
    const settleAxisCoordinates = () => {
      scheduleAxisCoordinates();
      if (axisSettleTimer !== null) window.clearTimeout(axisSettleTimer);
      // The chart library applies a price-scale drag after its pointer handler.
      // Sample once more after that gesture settles, without coupling to scroll.
      axisSettleTimer = window.setTimeout(scheduleAxisCoordinates, 48);
    };
    const beginAxisGesture = (event: PointerEvent) => {
      axisGestureActive = event.target instanceof Node && Boolean(containerRef.current?.contains(event.target));
    };
    const observeAxisGesture = () => {
      if (axisGestureActive) scheduleAxisCoordinates();
    };
    const finishAxisGesture = () => {
      if (!axisGestureActive) return;
      axisGestureActive = false;
      settleAxisCoordinates();
    };
    const axisObserver = new ResizeObserver(scheduleAxisCoordinates);
    axisObserver.observe(containerRef.current);
    containerRef.current.addEventListener("wheel", scheduleAxisCoordinates, { passive: true });
    containerRef.current.addEventListener("pointermove", scheduleAxisCoordinates);
    containerRef.current.addEventListener("pointerup", scheduleAxisCoordinates);
    containerRef.current.addEventListener("dblclick", scheduleAxisCoordinates);
    // lightweight-charts owns the price-scale canvas edge, so a drag there can
    // bypass the surface element. Capture that gesture only; page scrolling and
    // unrelated pointer movement must never feed the profile coordinate system.
    window.addEventListener("pointerdown", beginAxisGesture, true);
    window.addEventListener("pointermove", observeAxisGesture, true);
    window.addEventListener("pointerup", finishAxisGesture, true);
    scheduleAxisCoordinates();

    const pointByTime = new Map(points.map((point) => [String(point.time), point]));
    chart.subscribeCrosshairMove((param: any) => {
      if (!param?.time || !param?.point) {
        return;
      }
      const point = pointByTime.get(String(param.time));
      if (!point) {
        return;
      }
      setTooltip((current) => {
        if (
          current?.point.time === point.time &&
          Math.abs(current.x - param.point.x) < 1 &&
          Math.abs(current.y - param.point.y) < 1
        ) {
          return current;
        }
        return { x: param.point.x, y: param.point.y, point };
      });
    });

    return () => {
      if (axisFrame !== null) window.cancelAnimationFrame(axisFrame);
      if (axisSettleTimer !== null) window.clearTimeout(axisSettleTimer);
      axisObserver.disconnect();
      containerRef.current?.removeEventListener("wheel", scheduleAxisCoordinates);
      containerRef.current?.removeEventListener("pointermove", scheduleAxisCoordinates);
      containerRef.current?.removeEventListener("pointerup", scheduleAxisCoordinates);
      containerRef.current?.removeEventListener("dblclick", scheduleAxisCoordinates);
      window.removeEventListener("pointerdown", beginAxisGesture, true);
      window.removeEventListener("pointermove", observeAxisGesture, true);
      window.removeEventListener("pointerup", finishAxisGesture, true);
      onPriceAxisCoordinatesChange?.(null);
      chart.remove();
      chartRef.current = null;
    };
  }, [axisStrikes, chartStyle, onPriceAxisCoordinatesChange, points, sharedPriceAxisRange?.min, sharedPriceAxisRange?.max]);

  if (points.length < 2) return <ToolTextSummary result={result} />;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-800 bg-[#05080d]"
      data-chart-style={chartStyle}
      data-price-chart-range={priceRange}
      data-shared-price-axis-range={sharedPriceAxisRange ? `${sharedPriceAxisRange.min}:${sharedPriceAxisRange.max}` : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {(["line", "mountain", "candle", "ohlc"] as PriceChartStyle[]).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => setChartStyle(style)}
              className={`rounded border px-3 py-1.5 text-xs font-black uppercase tracking-normal transition ${
                chartStyle === style
                  ? "border-blue-400/60 bg-blue-500/20 text-blue-200"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-blue-400/50 hover:text-blue-100"
              }`}
            >
              {style}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STOCKS_WATCHER_PRICE_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => onPriceRangeChange(range)}
              className={`rounded border px-3 py-1.5 text-xs font-black transition ${
                priceRange === range
                  ? "border-blue-400/60 bg-blue-500/20 text-blue-100"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-blue-400/50"
              }`}
              aria-pressed={priceRange === range}
            >
              {priceRangeLabel[range]}
            </button>
          ))}
          <span className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-400">
            Updated {latestLabel}
          </span>
        </div>
      </div>
      <div className="px-3 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={`rounded-full px-3 py-1.5 font-black ${isUp ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
            {tooltip ? compactDateLabel(activePoint.date) : "Last"} {currency(activePoint.close || 0)}
          </span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-slate-300">O {currency(activePoint.open || 0)}</span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-emerald-200">H {currency(activePoint.high || 0)}</span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-red-200">L {currency(activePoint.low || 0)}</span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 font-bold text-slate-300">Vol {formatNumber(activePoint.volume || 0)}</span>
        </div>
      </div>
      <div
        className="relative min-h-[28rem] flex-1 px-3 pb-3 pt-2"
        onMouseLeave={() => setTooltip(null)}
      >
        <div ref={containerRef} className="h-full w-full" data-price-chart-surface />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 w-56 rounded-md border border-blue-400/50 bg-slate-950/95 px-3 py-2 text-xs shadow-2xl shadow-blue-950/50"
            data-price-chart-tooltip
            style={{
              left: tooltip.x > 280 ? tooltip.x - 226 : tooltip.x + 26,
              top: Math.max(58, tooltip.y - 36),
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-black text-blue-100">{compactDateLabel(tooltip.point.date)}</span>
              <span className={`font-black ${(tooltip.point.close || 0) >= (tooltip.point.open || 0) ? "text-emerald-300" : "text-red-300"}`}>
                {(tooltip.point.close || 0) >= (tooltip.point.open || 0) ? "UP" : "DOWN"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums text-slate-300">
              <span>Open</span><span className="text-right text-slate-100">{currency(tooltip.point.open || 0)}</span>
              <span>High</span><span className="text-right text-emerald-200">{currency(tooltip.point.high || 0)}</span>
              <span>Low</span><span className="text-right text-red-200">{currency(tooltip.point.low || 0)}</span>
              <span>Close</span><span className="text-right text-blue-100">{currency(tooltip.point.close || 0)}</span>
              <span>Volume</span><span className="text-right text-slate-100">{formatNumber(tooltip.point.volume || 0)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
        <span>{firstLabel} - {latestLabel}</span>
        <span>{priceRangeLabel[priceRange]} Daily | {points.length} bars | Yahoo</span>
      </div>
    </div>
  );
};

export const QuoteBreadthPanel = ({ result }: { result: NativeToolResult }) => {
  const quotes = quotesFromResult(result);
  if (quotes.length === 0) return <ToolTextSummary result={result} />;
  const advancers = quotes.filter((quote) => (quote.changePercent || 0) >= 0).length;
  const breadthPct = Math.round((advancers / quotes.length) * 100);
  const leaders = quotes.slice(0, 3);
  const laggards = quotes.slice(-3).reverse();

  return (
    <div className="space-y-4 rounded-md border border-slate-800 bg-[#05080d] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Universe Breadth</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-white">{advancers}/{quotes.length}</p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">{breadthPct}% positive</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${breadthPct}%` }} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <QuoteMiniList title="Leaders" quotes={leaders} tone="up" />
        <QuoteMiniList title="Laggards" quotes={laggards} tone="down" />
      </div>
    </div>
  );
};

export const QuoteMiniList = ({ title, quotes, tone }: { title: string; quotes: RawQuoteRow[]; tone: "up" | "down" }) => (
  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
    <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{title}</p>
    <div className="space-y-2">
      {quotes.map((quote) => (
        <div key={quote.symbol} className="grid grid-cols-[4rem_1fr_auto] items-center gap-2 text-xs">
          <span className="font-black text-blue-100">{quote.symbol}</span>
          <span className="min-w-0 truncate text-slate-400">{quote.name}</span>
          <span className={`font-black tabular-nums ${tone === "up" ? "text-emerald-300" : "text-red-300"}`}>
            {(quote.changePercent || 0) >= 0 ? "+" : ""}{(quote.changePercent || 0).toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  </div>
);

export const StatsPanel = ({ result }: { result: NativeToolResult }) => {
  const raw = rawRecord(result.raw);
  const quote = rawRecord(raw?.quote);
  const summary = rawRecord(raw?.summary);
  const stats = rawRecord(summary?.defaultKeyStatistics);
  const financial = rawRecord(summary?.financialData);
  const profile = rawRecord(summary?.assetProfile);
  const companyDescription = typeof profile?.longBusinessSummary === "string" && profile.longBusinessSummary.trim()
    ? profile.longBusinessSummary.trim()
    : null;
  const fmt = (value: unknown) => {
    const record = rawRecord(value);
    if (typeof record?.fmt === "string") return record.fmt;
    if (typeof value === "string") return value;
    const numeric = rawNumber(record?.raw ?? value);
    return numeric ? formatNumber(numeric) : "n/a";
  };
  const metrics = [
    ["Price", currency(rawNumber(quote?.price))],
    ["Change", `${rawNumber(quote?.changePercent).toFixed(2)}%`],
    ["Forward P/E", fmt(stats?.forwardPE)],
    ["Trailing P/E", fmt(stats?.trailingPE)],
    ["Beta", fmt(stats?.beta)],
    ["Target Mean", fmt(financial?.targetMeanPrice)],
    ["Sector", typeof profile?.sector === "string" ? profile.sector : "n/a"],
    ["Industry", typeof profile?.industry === "string" ? profile.industry : "n/a"],
  ];

  return (
    <div className="space-y-3">
      <dl data-fundamentals-metrics className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md border border-slate-800 bg-[#05080d] p-4">
            <dt className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-slate-500">{label}</dt>
            <dd className="mt-2 break-words text-lg font-black tabular-nums text-blue-100">{value}</dd>
          </div>
        ))}
      </dl>
      <article data-company-description className="rounded-md border border-slate-800 bg-[#05080d] p-4">
        <h4 className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-slate-500">Company Description</h4>
        <div className="siw-description-copy mt-2 text-sm leading-6 text-slate-300">
          <ExpandableDescription description={companyDescription || ""} />
        </div>
      </article>
    </div>
  );
};

export const ToolTextSummary = ({ result }: { result: NativeToolResult }) => (
  <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-300">
    {(result.text || "No formatted summary was returned for this tool.").split("\n").filter(Boolean).slice(0, 8).map((line) => (
      <p key={line} className="break-words">{line.replace(/^#+\s*/, "").replace(/\*\*/g, "")}</p>
    ))}
  </div>
);

export const ToolResultBlock = ({ result }: { result: NativeToolResult }) => {
  if (["get_intraday", "get_stock_history", "chart_indicator"].includes(result.tool) && historyFromResult(result).length > 1) {
    return <OhlcVolumeChart result={result} />;
  }

  if (["market_breadth", "basket_relative_strength", "morning_briefing", "signal_scan", "get_sector_stats", "get_sector_top_holdings"].includes(result.tool) && quotesFromResult(result).length > 0) {
    return <QuoteBreadthPanel result={result} />;
  }

  if (["get_stock_stats", "get_beta"].includes(result.tool)) {
    return <StatsPanel result={result} />;
  }

  if (resultLooksHtml(result)) {
    return (
      <iframe
        title={`${result.tool} result`}
        srcDoc={htmlSrcDoc(result)}
        className="h-[28rem] w-full rounded-md border border-slate-800 bg-slate-950"
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  return <ToolTextSummary result={result} />;
};

export const BrandMark = () => (
  <div className="siw-brand-mark" aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

export const TickerLogo = ({ symbol, large = false }: { symbol: string; large?: boolean }) => {
  const normalized = normalizeSymbol(symbol || "?");
  const palette = [
    "siw-logo-lime",
    "siw-logo-white",
    "siw-logo-blue",
    "siw-logo-red",
    "siw-logo-orange",
    "siw-logo-cyan",
  ];
  const className = palette[normalized.charCodeAt(0) % palette.length];

  return (
    <span className={`siw-ticker-logo ${className} ${large ? "siw-ticker-logo-large" : ""}`} data-ticker-logo={normalized} aria-hidden="true">
      {normalized.slice(0, normalized === "BRK-B" ? 3 : 1)}
    </span>
  );
};

export const approvedUniverseRegimeFromResult = (result: NativeToolResult | null): ApprovedUniverseRegime | null => {
  const raw = rawRecord(result?.raw);
  if (!raw) return null;
  const regime = raw.regime;
  if (regime !== "risk_on" && regime !== "risk_off" && regime !== "mixed") return null;
  const universeCount = rawNumber(raw.universeCount);
  if (universeCount <= 0) return null;
  return {
    regime,
    advancers: rawNumber(raw.advancers),
    avgChange: rawNumber(raw.avgChange),
    universeCount,
  };
};

export const approvedUniverseHoldingsFromResult = (result: NativeToolResult | null): ApprovedUniverseHolding[] => {
  const raw = rawRecord(result?.raw);
  const rows = Array.isArray(raw?.holdings) ? raw.holdings : [];
  return rows
    .map((item) => rawRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      symbol: typeof item.symbol === "string" ? item.symbol : "",
      sector: typeof item.sector === "string" ? item.sector : "",
      price: rawNumber(item.price),
      changePercent: rawNumber(item.changePercent),
      volume: rawNumber(item.volume),
    }))
    .filter((item) => item.symbol)
    .sort((a, b) => b.changePercent - a.changePercent);
};

export const MiniSparkline = ({
  points,
  positive = true,
  className = "",
  dataRole,
  tooltip,
  sourceLabel,
  valueFormatter,
  placement = "top",
}: {
  points: Array<number | SparklinePoint>;
  positive?: boolean;
  className?: string;
  dataRole?: "hero" | "index";
  tooltip?: string;
  sourceLabel?: string;
  valueFormatter?: (value: number) => string;
  placement?: "top" | "bottom" | "auto";
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<SparklineTooltipPosition | null>(null);
  const cleanPoints = points
    .map((point, index): SparklinePoint | null => {
      if (typeof point === "number") {
        return Number.isFinite(point) ? { label: `Point ${index + 1}`, value: point, source: sourceLabel } : null;
      }
      return Number.isFinite(point.value) ? { ...point, source: point.source || sourceLabel } : null;
    })
    .filter((point): point is SparklinePoint => Boolean(point));
  const geometry = dataRole === "index"
    ? { viewBox: "0 0 100 64", baseline: 60, amplitude: 54, fillBase: 64, emptyTextY: 34 }
    : dataRole === "hero"
      ? { viewBox: "0 0 100 52", baseline: 49, amplitude: 45, fillBase: 52, emptyTextY: 28 }
      : { viewBox: "0 0 100 40", baseline: 36, amplitude: 32, fillBase: 40, emptyTextY: 22 };
  const resetHover = () => {
    setHoverIndex(null);
    setTooltipPosition(null);
  };
  if (cleanPoints.length < 2) {
    const unavailableLabel = tooltip || "Price sparkline unavailable";
    return (
      <span className="siw-sparkline-frame">
        <svg
          className={`siw-sparkline siw-empty ${className}`}
          viewBox={geometry.viewBox}
          preserveAspectRatio="none"
          role="img"
          aria-label={unavailableLabel}
          data-hero-sparkline={dataRole === "hero" ? "true" : undefined}
          data-index-sparkline={dataRole === "index" ? "true" : undefined}
        >
          <title>{unavailableLabel}</title>
          <text x="50" y={geometry.emptyTextY} textAnchor="middle">N/A</text>
        </svg>
      </span>
    );
  }
  const values = cleanPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const first = values[0];
  const latest = values[values.length - 1];
  const changePercent = first ? ((latest - first) / first) * 100 : 0;
  const tooltipText = tooltip || `Price sparkline: ${values.length} points, latest ${latest.toFixed(2)}, ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% from first point`;
  const formatValue = valueFormatter || ((value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
  const pointX = (index: number) => (index / Math.max(1, values.length - 1)) * 100;
  const pointY = (value: number) => geometry.baseline - ((value - min) / range) * geometry.amplitude;
  const path = values
    .map((value, index) => {
      const x = pointX(index);
      const y = pointY(value);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const activeIndex = hoverIndex === null ? null : Math.min(values.length - 1, Math.max(0, hoverIndex));
  const activePoint = activeIndex === null ? null : cleanPoints[activeIndex];
  const activeValue = activeIndex === null ? null : values[activeIndex];
  const previousValue = activeIndex === null || activeIndex === 0 ? null : values[activeIndex - 1];
  const activeChange = activeValue !== null && previousValue !== null ? activeValue - previousValue : null;
  const activeChangePercent = activeChange !== null && previousValue ? (activeChange / previousValue) * 100 : null;
  const activeX = activeIndex === null ? 0 : pointX(activeIndex);
  const activeChangeText = activeChange === null
    ? null
    : dataRole
      ? activeChangePercent === null ? null : `${activeChangePercent >= 0 ? "+" : ""}${activeChangePercent.toFixed(2)}%`
      : `${activeChange >= 0 ? "+" : ""}${formatValue(activeChange)}`;
  const activeRange = [activePoint?.rangeLabel, activePoint?.granularityLabel].filter(Boolean).join(" ");
  const activeHeader = activePoint
    ? [activePoint.label, activePoint.dateTimeLabel, activeRange].filter(Boolean).join(" · ")
    : "";
  const tooltipPlacement = placement === "auto" && dataRole === "hero" ? "bottom" : placement;
  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    setHoverIndex(Math.round(ratio * (values.length - 1)));
    const shouldOpenBelow = tooltipPlacement === "bottom" || event.clientY < 170;
    const left = Math.max(12, Math.min(window.innerWidth - 12, event.clientX + (event.clientX > window.innerWidth - 260 ? -12 : 12)));
    const top = shouldOpenBelow
      ? Math.min(window.innerHeight - 148, event.clientY + 18)
      : Math.max(12, event.clientY - 148);
    setTooltipPosition({
      left,
      top,
      alignRight: event.clientX > window.innerWidth - 260,
    });
  };

  return (
    <span className="siw-sparkline-frame" onPointerMove={handlePointerMove} onPointerLeave={resetHover}>
      <svg
        className={`siw-sparkline ${positive ? "siw-positive" : "siw-negative"} ${className}`}
        viewBox={geometry.viewBox}
        preserveAspectRatio="none"
        role="img"
        aria-label={tooltipText}
        tabIndex={0}
        data-hero-sparkline={dataRole === "hero" ? "true" : undefined}
        data-index-sparkline={dataRole === "index" ? "true" : undefined}
        onBlur={resetHover}
      >
        <title>{tooltipText}</title>
        <path className="siw-sparkline-fill" d={`${path} L100 ${geometry.fillBase} L0 ${geometry.fillBase} Z`} />
        <path className="siw-sparkline-line" d={path} />
        {activePoint && (
          <line
            className="siw-sparkline-crosshair"
            x1={activeX}
            x2={activeX}
            y1="0"
            y2={geometry.fillBase}
            data-sparkline-crosshair
          />
        )}
      </svg>
      {activePoint && activeValue !== null && (
        <span
          className={`siw-sparkline-tooltip is-fixed ${tooltipPosition?.alignRight ? "is-right" : ""} ${tooltipPlacement === "bottom" ? "is-bottom" : ""}`}
          data-sparkline-tooltip
          data-sparkline-tooltip-placement={tooltipPlacement}
          style={{
            left: tooltipPosition ? `${tooltipPosition.left}px` : `${activeX}%`,
            top: tooltipPosition ? `${tooltipPosition.top}px` : undefined,
          }}
        >
          <b>{activeHeader}</b>
          <span className="siw-sparkline-tooltip-main">
            <strong>{formatValue(activeValue)}</strong>
            {activeChangeText && <small data-sparkline-change className={activeChange !== null && activeChange >= 0 ? "siw-up" : "siw-down"}>{activeChangeText}</small>}
          </span>
          <em>{activePoint.source || sourceLabel || "Source"} · {activeIndex === null ? 0 : activeIndex + 1}/{values.length} pts</em>
        </span>
      )}
    </span>
  );
};
