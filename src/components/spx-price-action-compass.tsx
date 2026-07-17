import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  Check,
  Crosshair,
  Filter,
  GraduationCap,
  Grid3X3,
  Maximize2,
  RefreshCw,
  Search,
  Target,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  projectSpxChartClientPoint,
  sortSpxPriceActionPatternsLatestFirst,
  type SpxPriceActionCandle,
  type SpxPriceActionCompassResponse,
  type SpxPriceActionPattern,
  type SpxPriceActionPatternType,
  type SpxPriceActionTimeframe,
  type SpxPriceActionTrend,
  type SpxPriceActionZone,
} from "@/lib/spx-price-action-compass";
import { parseJsonResponse } from "@/lib/safe-json-response";
type SignalDirectionFilter = "all" | SpxPriceActionPattern["direction"];

interface SignalFilterState {
  direction: SignalDirectionFilter;
  type: "all" | SpxPriceActionPatternType;
}

const defaultSignalFilter: SignalFilterState = { direction: "all", type: "all" };

const directionFilterOptions: Array<{ value: SignalDirectionFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
  { value: "neutral", label: "Neutral" },
];

const emptyCompass: SpxPriceActionCompassResponse = {
  ticker: "SPX",
  timeframe: "5m",
  availableTimeframes: ["1m", "5m", "15m", "4h", "1d"],
  candles: [],
  patterns: [],
  zones: [],
  trend: { direction: "SIDEWAYS", strength: 0, labels: [] },
  summary: {
    latestClose: null,
    latestChange: null,
    latestChangePercent: null,
    nearestSupport: null,
    nearestResistance: null,
    latestPattern: null,
    patternCounts: {},
  },
  source: {
    provider: "yahoo",
    label: "Native Yahoo Finance chart",
    symbol: "^SPX",
    range: "",
    interval: "",
    fetchedAt: "",
    note: "",
  },
  warnings: [],
};

const formatPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : "n/a";

const formatSigned = (value: number | null | undefined, suffix = "") => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
};

const resolveTimestamp = (value: number | string | null | undefined) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatEtTime = (value: number | string | null | undefined, includeSeconds = false) => {
  const timestamp = resolveTimestamp(value);
  if (timestamp === null) return "time n/a";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const seconds = includeSeconds ? `:${parts.second}` : "";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}${seconds} ET`;
};

const formatUtcTime = (value: number | string | null | undefined, includeSeconds = false) => {
  const timestamp = resolveTimestamp(value);
  if (timestamp === null) return "time n/a";
  return `${new Date(timestamp).toISOString().slice(0, includeSeconds ? 19 : 16).replace("T", " ")} UTC`;
};

const timeframeLabel = (timeframe: SpxPriceActionTimeframe) => timeframe.toUpperCase();

const isBullishPattern = (pattern: SpxPriceActionPattern | null | undefined) => pattern?.direction === "bullish";
const isBearishPattern = (pattern: SpxPriceActionPattern | null | undefined) => pattern?.direction === "bearish";

const toneClasses = (pattern: SpxPriceActionPattern | null | undefined) => {
  if (isBullishPattern(pattern)) return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100";
  if (isBearishPattern(pattern)) return "border-red-300/35 bg-red-300/10 text-red-100";
  return "border-amber-300/35 bg-amber-300/10 text-amber-100";
};

export function SpxPriceActionCompass() {
  const [timeframe, setTimeframe] = useState<SpxPriceActionTimeframe>("5m");
  const [data, setData] = useState<SpxPriceActionCompassResponse>(emptyCompass);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<SpxPriceActionPattern | null>(null);
  const [modalPattern, setModalPattern] = useState<SpxPriceActionPattern | null>(null);
  const [signalFilter, setSignalFilter] = useState<SignalFilterState>(defaultSignalFilter);
  const [mode, setMode] = useState<"review" | "practice">("review");
  const [showZones, setShowZones] = useState(true);
  const [showPatterns, setShowPatterns] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [practiceChoice, setPracticeChoice] = useState<"LONG" | "SHORT" | "SKIP" | null>(null);
  const [practiceRevealed, setPracticeRevealed] = useState(false);
  const refreshInFlightRef = useRef(false);

  const loadCompass = async (nextTimeframe = timeframe) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const requestUrl = `/api/spx-price-action-compass?timeframe=${nextTimeframe}`;
      const response = await fetch(requestUrl);
      const payload = await parseJsonResponse<SpxPriceActionCompassResponse & { warnings?: string[] }>(response, requestUrl);
      if (!response.ok) throw new Error(payload.warnings?.join(" ") || "SPX Price Action Compass API failed");
      setData(payload);
      setSelectedPattern(payload.summary.latestPattern || payload.patterns[0] || null);
      setModalPattern(null);
      setPracticeChoice(null);
      setPracticeRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SPX Price Action Compass failed");
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCompass(timeframe);
  }, [timeframe]);

  const availablePatternTypes = useMemo(() => {
    return Array.from(new Set(data.patterns.map((pattern) => pattern.type))).sort();
  }, [data.patterns]);

  const filteredPatterns = useMemo(() => {
    return data.patterns.filter((pattern) => {
      const directionMatches = signalFilter.direction === "all" || pattern.direction === signalFilter.direction;
      const typeMatches = signalFilter.type === "all" || pattern.type === signalFilter.type;
      return directionMatches && typeMatches;
    });
  }, [data.patterns, signalFilter.direction, signalFilter.type]);

  useEffect(() => {
    if (!selectedPattern) return;
    if (!filteredPatterns.some((pattern) => pattern.id === selectedPattern.id)) {
      setSelectedPattern(null);
      setModalPattern(null);
    }
  }, [filteredPatterns, selectedPattern]);

  const challengePattern = useMemo(() => {
    return filteredPatterns
      .filter((pattern) => pattern.toIndex <= data.candles.length - 6 && pattern.fromIndex >= 20)
      .sort((a, b) => b.toIndex - a.toIndex || b.confidence - a.confidence)[0] || null;
  }, [data.candles.length, filteredPatterns]);

  const practiceOutcome = useMemo(() => {
    if (!challengePattern) return null;
    const signal = data.candles[challengePattern.toIndex];
    if (!signal) return null;
    const future = data.candles.slice(challengePattern.toIndex + 1, Math.min(data.candles.length, challengePattern.toIndex + 21));
    const threshold = Math.max(0.2, (signal.high - signal.low) * 0.1);
    const longIndex = future.findIndex((candle) => candle.high > signal.high + threshold);
    const shortIndex = future.findIndex((candle) => candle.low < signal.low - threshold);
    if (longIndex >= 0 && shortIndex < 0) return "LONG";
    if (shortIndex >= 0 && longIndex < 0) return "SHORT";
    if (longIndex >= 0 && shortIndex >= 0) return longIndex <= shortIndex ? "LONG" : "SHORT";
    const last = future[future.length - 1];
    return last && last.close < signal.close ? "SHORT" : "LONG";
  }, [challengePattern, data.candles]);

  const chartWindow = useMemo(() => {
    if (mode !== "practice" || !challengePattern) {
      return {
        candles: data.candles,
        patterns: filteredPatterns,
        trend: data.trend,
        offset: 0,
      };
    }
    const start = Math.max(0, challengePattern.fromIndex - 70);
    const end = practiceRevealed
      ? Math.min(data.candles.length, challengePattern.toIndex + 26)
      : challengePattern.toIndex + 1;
    const shiftedPattern: SpxPriceActionPattern = {
      ...challengePattern,
      candleIndices: challengePattern.candleIndices.map((index) => index - start),
      fromIndex: challengePattern.fromIndex - start,
      toIndex: challengePattern.toIndex - start,
      type: practiceRevealed ? challengePattern.type : challengePattern.type,
      label: practiceRevealed ? challengePattern.label : "Hidden signal",
      name: practiceRevealed ? challengePattern.name : "Hidden signal",
    };
    const shiftedTrend: SpxPriceActionTrend = {
      ...data.trend,
      labels: data.trend.labels
        .filter((label) => label.index >= start && label.index < end)
        .map((label) => ({ ...label, index: label.index - start })),
    };
    return {
      candles: data.candles.slice(start, end),
      patterns: [shiftedPattern],
      trend: shiftedTrend,
      offset: start,
    };
  }, [challengePattern, data.candles, filteredPatterns, data.trend, mode, practiceRevealed]);

  const patternById = useMemo(() => new Map(data.patterns.map((pattern) => [pattern.id, pattern])), [data.patterns]);
  const topPatterns = useMemo(
    () => sortSpxPriceActionPatternsLatestFirst(filteredPatterns).slice(0, 8),
    [filteredPatterns],
  );
  const latest = data.summary;

  return (
    <section
      className="border border-[#123142] bg-[#04101a] p-3 text-white"
      data-spx-price-action-compass="true"
      data-pa-candle-count={data.candles.length}
      data-pa-volume-count={data.candles.filter((candle) => candle.volume > 0).length}
      data-pa-zone-count={data.zones.length}
      data-pa-pattern-count={data.patterns.length}
      data-pa-filtered-pattern-count={filteredPatterns.length}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 border-b border-cyan-300/15 pb-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100">
                Source-backed
              </span>
              <h2 className="text-xl font-black tracking-normal text-white sm:text-2xl">SPX Price Action Compass</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Yahoo OHLCV + deterministic price-action structure, rendered before the GEX board.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedMode value={mode} onChange={setMode} />
            <div className="inline-flex h-9 items-center border border-cyan-300/20 bg-cyan-300/10 p-0.5">
              {data.availableTimeframes.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTimeframe(item)}
                  className={`h-7 px-2.5 font-mono text-[11px] font-black transition-colors ${
                    timeframe === item ? "bg-cyan-200 text-[#03111a]" : "text-cyan-100 hover:bg-cyan-300/15"
                  }`}
                  aria-pressed={timeframe === item}
                >
                  {timeframeLabel(item)}
                </button>
              ))}
            </div>
            <ToolbarToggle active={showZones} onClick={() => setShowZones((value) => !value)} title="Support and resistance">
              <Grid3X3 className="h-4 w-4" />
            </ToolbarToggle>
            <ToolbarToggle active={showPatterns} onClick={() => setShowPatterns((value) => !value)} title="Patterns">
              <Target className="h-4 w-4" />
            </ToolbarToggle>
            <ToolbarToggle active={showTrend} onClick={() => setShowTrend((value) => !value)} title="HH HL LH LL">
              <Crosshair className="h-4 w-4" />
            </ToolbarToggle>
            <ToolbarToggle active={showVolume} onClick={() => setShowVolume((value) => !value)} title="Volume">
              <BarChart3 className="h-4 w-4" />
            </ToolbarToggle>
            <button
              type="button"
              onClick={() => void loadCompass(timeframe)}
              disabled={loading}
              className="inline-flex h-9 w-9 items-center justify-center border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 transition-colors hover:bg-cyan-300/20 disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh SPX Price Action Compass"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {error && <Notice tone="red" text={`${data.candles.length > 0 ? "Refresh failed; showing the last verified Price Action Compass. " : ""}${error}`} />}
        {data.warnings.length > 0 && <Notice tone="amber" text={data.warnings.join(" ")} />}

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {loading && data.candles.length === 0 ? (
              <div className="flex h-[420px] items-center justify-center border border-white/10 bg-black/20 text-xs uppercase tracking-[0.2em] text-zinc-500">
                Loading SPX PA
              </div>
            ) : (
              <PriceActionChartCanvas
                candles={chartWindow.candles}
                patterns={chartWindow.patterns}
                zones={data.zones}
                trend={chartWindow.trend}
                selectedPattern={selectedPattern}
                signalFilter={signalFilter}
                availablePatternTypes={availablePatternTypes}
                totalPatternCount={data.patterns.length}
                showZones={showZones}
                showPatterns={showPatterns}
                showTrend={showTrend}
                showVolume={showVolume}
                onSignalFilterChange={setSignalFilter}
                onSelectPattern={(pattern) => {
                  const next = patternById.get(pattern.id) || pattern;
                  setSelectedPattern(next);
                }}
              />
            )}
          </div>

          <aside className="flex flex-col gap-3">
            {mode === "practice" ? (
              <PracticePanel
                pattern={challengePattern}
                outcome={practiceOutcome}
                choice={practiceChoice}
                revealed={practiceRevealed}
                onChoose={(choice) => {
                  setPracticeChoice(choice);
                  setPracticeRevealed(true);
                }}
                onReset={() => {
                  setPracticeChoice(null);
                  setPracticeRevealed(false);
                }}
              />
            ) : (
              <LearningPanel
                selectedPattern={selectedPattern}
                onOpen={() => {
                  const next = selectedPattern || data.summary.latestPattern || topPatterns[0] || null;
                  setSelectedPattern(next);
                  setModalPattern(next);
                }}
              />
            )}

            <section className="border border-[#123142] bg-black/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
                <span className="flex items-center gap-2"><Search aria-hidden="true" className="h-4 w-4" />Signal Monitor</span>
                <span className="text-[9px] text-cyan-200/45">Latest first</span>
              </div>
              <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pr-1">
                {topPatterns.length === 0 ? (
                  <div className="py-5 text-center text-xs text-zinc-500">No signal matches the active filter.</div>
                ) : topPatterns.map((pattern) => (
                  <button
                    key={pattern.id}
                    type="button"
                    onClick={() => {
                      setSelectedPattern(pattern);
                    }}
                    className={`border px-3 py-2 text-left transition-colors hover:border-white/40 ${selectedPattern?.id === pattern.id ? toneClasses(pattern) : "border-white/10 bg-white/[0.03] text-zinc-300"}`}
                    data-pa-side-pattern="true"
                    data-pa-side-pattern-active={selectedPattern?.id === pattern.id ? "true" : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-black text-white">{pattern.label}</span>
                      <span className="font-mono text-[10px]">{Math.round(pattern.confidence * 100)}%</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-zinc-500">
                      {data.candles[pattern.toIndex] ? formatEtTime(data.candles[pattern.toIndex].time) : "time n/a"} / idx {pattern.fromIndex}-{pattern.toIndex} / ${formatPrice(pattern.price)}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="border border-[#123142] bg-black/20 p-3">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
                <Grid3X3 className="h-4 w-4" />
                Support / Resistance
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ZoneTile label="Nearest support" zone={latest.nearestSupport} />
                <ZoneTile label="Nearest resistance" zone={latest.nearestResistance} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.zones.slice(0, 6).map((zone) => (
                  <span key={zone.id} className={`border px-2 py-1 font-mono text-[10px] font-black ${zoneClass(zone)}`}>
                    {zone.type} {formatPrice(zone.price)}
                  </span>
                ))}
              </div>
            </section>

          </aside>
        </div>

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_360px]">
          <SelectedSignalCard
            pattern={selectedPattern}
            candle={selectedPattern ? data.candles[selectedPattern.toIndex] : undefined}
            onShowDetail={() => {
              if (selectedPattern) setModalPattern(selectedPattern);
            }}
          />
          <SourcePanel data={data} />
        </div>
      </div>

      {modalPattern && (
        <PatternModal
          pattern={modalPattern}
          candles={data.candles}
          onClose={() => setModalPattern(null)}
        />
      )}
    </section>
  );
}

const SegmentedMode = ({ value, onChange }: { value: "review" | "practice"; onChange: (value: "review" | "practice") => void }) => (
  <div className="inline-flex h-9 items-center border border-white/10 bg-white/[0.04] p-0.5">
    <button
      type="button"
      onClick={() => onChange("review")}
      className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-black ${value === "review" ? "bg-white text-[#03111a]" : "text-zinc-300 hover:bg-white/10"}`}
    >
      <BookOpen className="h-3.5 w-3.5" />
      Review
    </button>
    <button
      type="button"
      onClick={() => onChange("practice")}
      className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-black ${value === "practice" ? "bg-white text-[#03111a]" : "text-zinc-300 hover:bg-white/10"}`}
    >
      <GraduationCap className="h-3.5 w-3.5" />
      Practice
    </button>
  </div>
);

const ToolbarToggle = ({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex h-9 w-9 items-center justify-center border transition-colors ${active ? "border-white/60 bg-white text-[#03111a]" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"}`}
    title={title}
    aria-label={title}
    aria-pressed={active}
  >
    {children}
  </button>
);

const Notice = ({ tone, text }: { tone: "red" | "amber"; text: string }) => (
  <div className={`border px-3 py-2 text-sm ${tone === "red" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
    {text}
  </div>
);

interface ChartProps {
  candles: SpxPriceActionCandle[];
  patterns: SpxPriceActionPattern[];
  zones: SpxPriceActionZone[];
  trend: SpxPriceActionTrend;
  selectedPattern: SpxPriceActionPattern | null;
  signalFilter: SignalFilterState;
  availablePatternTypes: SpxPriceActionPatternType[];
  totalPatternCount: number;
  showZones: boolean;
  showPatterns: boolean;
  showTrend: boolean;
  showVolume: boolean;
  onSignalFilterChange: (filter: SignalFilterState) => void;
  onSelectPattern: (pattern: SpxPriceActionPattern) => void;
}

interface ChartPatternGeometry {
  pattern: SpxPriceActionPattern;
  x1: number;
  x2: number;
  yTop: number;
  yBottom: number;
  color: string;
  selected: boolean;
  labelX: number;
  desiredLabelY: number;
  labelWidth: number;
}

interface ChartPatternLabelLayout extends ChartPatternGeometry {
  labelY: number;
}

const PATTERN_LABEL_HEIGHT = 15;
const PATTERN_LABEL_LANE_HEIGHT = 17;
const PATTERN_LABEL_GAP = 2;

const layoutChartPatternLabels = (patterns: ChartPatternGeometry[], chartHeight: number): ChartPatternLabelLayout[] => {
  const laneCount = Math.max(1, Math.floor((chartHeight - PATTERN_LABEL_HEIGHT) / PATTERN_LABEL_LANE_HEIGHT) + 1);
  const laneOccupancy: Array<Array<{ left: number; right: number }>> = Array.from({ length: laneCount }, () => []);
  const sorted = [...patterns].sort((left, right) =>
    Number(right.selected) - Number(left.selected)
    || left.desiredLabelY - right.desiredLabelY
    || left.labelX - right.labelX
    || left.pattern.id.localeCompare(right.pattern.id));

  return sorted.flatMap((pattern) => {
    const preferredLane = Math.max(0, Math.min(laneCount - 1, Math.round(pattern.desiredLabelY / PATTERN_LABEL_LANE_HEIGHT)));
    const candidateLanes = Array.from({ length: laneCount }, (_, index) => index)
      .sort((left, right) => Math.abs(left - preferredLane) - Math.abs(right - preferredLane) || left - right);
    const lane = candidateLanes.find((candidate) => laneOccupancy[candidate].every((occupied) =>
      pattern.labelX + pattern.labelWidth + PATTERN_LABEL_GAP <= occupied.left
      || pattern.labelX >= occupied.right + PATTERN_LABEL_GAP));
    if (lane === undefined) return [];
    laneOccupancy[lane].push({ left: pattern.labelX, right: pattern.labelX + pattern.labelWidth });
    return [{ ...pattern, labelY: lane * PATTERN_LABEL_LANE_HEIGHT }];
  });
};

function PriceActionChartCanvas({
  candles,
  patterns,
  zones,
  trend,
  selectedPattern,
  signalFilter,
  availablePatternTypes,
  totalPatternCount,
  showZones,
  showPatterns,
  showTrend,
  showVolume,
  onSignalFilterChange,
  onSelectPattern,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const [zoom, setZoom] = useState(110);
  const [startIndex, setStartIndex] = useState(0);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; price: number; index: number } | null>(null);
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(760);
  const height = expanded ? Math.max(520, viewportHeight - 116) : 620;
  const axisLeft = 58;
  const axisBottom = 22;
  const volumeHeight = showVolume ? 58 : 0;
  const chartHeight = height - axisBottom - volumeHeight;
  const plotWidth = Math.max(240, width - axisLeft);
  const maxStart = Math.max(0, candles.length - zoom);

  useEffect(() => {
    const defaultZoom = Math.min(candles.length || 1, 110);
    setZoom(defaultZoom);
    setStartIndex(Math.max(0, candles.length - defaultZoom));
  }, [candles.length]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.max(420, Math.round(entries[0]?.contentRect.width || 900)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncViewport = () => setViewportHeight(window.innerHeight || 760);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  useEffect(() => {
    if (!selectedPattern || candles.length === 0) return;
    const midpoint = Math.round((selectedPattern.fromIndex + selectedPattern.toIndex) / 2);
    const windowSize = Math.max(20, Math.min(candles.length, zoom));
    const nextStart = Math.max(0, Math.min(Math.max(0, candles.length - windowSize), Math.round(midpoint - windowSize / 2)));
    setStartIndex(nextStart);
  }, [candles.length, selectedPattern?.fromIndex, selectedPattern?.id, selectedPattern?.toIndex, zoom]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (candles.length === 0) return;
      const rect = svg.getBoundingClientRect();
      const point = projectSpxChartClientPoint({ clientX: event.clientX, clientY: event.clientY, rect, viewBoxWidth: width, viewBoxHeight: height });
      const ratio = Math.max(0, Math.min(1, (point.x - axisLeft) / plotWidth));
      const anchor = startIndex + ratio * zoom;
      const nextZoom = Math.max(20, Math.min(candles.length, Math.round(zoom * (event.deltaY < 0 ? 0.82 : 1.18))));
      const nextMaxStart = Math.max(0, candles.length - nextZoom);
      setZoom(nextZoom);
      setStartIndex(Math.max(0, Math.min(nextMaxStart, Math.round(anchor - ratio * nextZoom))));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [axisLeft, candles.length, height, plotWidth, startIndex, width, zoom]);

  const visibleStart = Math.max(0, Math.min(startIndex, maxStart));
  const visibleCandles = candles.slice(visibleStart, visibleStart + zoom);
  const high = Math.max(...visibleCandles.map((candle) => candle.high), 1);
  const low = Math.min(...visibleCandles.map((candle) => candle.low), high - 1);
  const priceRange = Math.max(1, high - low);
  const maxVolume = Math.max(...visibleCandles.map((candle) => candle.volume), 1);
  const candleWidth = plotWidth / Math.max(1, zoom);
  const getX = (visibleIndex: number) => axisLeft + visibleIndex * candleWidth + candleWidth / 2;
  const getY = (price: number) => 12 + (chartHeight - 28) - ((price - low) / priceRange) * (chartHeight - 40);
  const getVolY = (volume: number) => chartHeight + volumeHeight - Math.max(2, (volume / maxVolume) * Math.max(10, volumeHeight - 8));
  const zoneRows = (() => {
    if (!showZones) return [];
    const rows = zones
      .filter((zone) => zone.maxPrice >= low && zone.minPrice <= high)
      .map((zone) => {
        const y = getY(zone.price);
        const y1 = getY(zone.maxPrice);
        const y2 = getY(zone.minPrice);
        const color = zone.type === "support" ? "#22c55e" : zone.type === "resistance" ? "#ef4444" : "#facc15";
        const fill = zone.type === "support" ? "#052816" : zone.type === "resistance" ? "#2a0f10" : "#2a2107";
        const label = `${zone.type === "support" ? "Support" : zone.type === "resistance" ? "Resistance" : "Flip"} ${formatPrice(zone.price)}`;
        const bandHeight = Math.max(10, Math.min(24, Math.abs(y2 - y1)));
        return { zone, y, color, fill, label, bandHeight };
      })
      .sort((a, b) => b.zone.strength - a.zone.strength || Math.abs(a.zone.distanceToLastPercent) - Math.abs(b.zone.distanceToLastPercent))
      .slice(0, 6)
      .sort((a, b) => a.y - b.y);

    let labelY = 0;
    let spaced = rows.map((row) => {
      labelY = Math.max(row.y, labelY + 20, 18);
      return { ...row, labelY: Math.min(chartHeight - 16, labelY) };
    });
    const overflow = spaced.length ? spaced[spaced.length - 1].labelY - (chartHeight - 16) : 0;
    if (overflow > 0) {
      spaced = spaced.map((row) => ({ ...row, labelY: Math.max(18, row.labelY - overflow) }));
    }
    return spaced;
  })();
  const chartPatterns = showPatterns ? patterns.flatMap((pattern): ChartPatternGeometry[] => {
    const localIndices = pattern.candleIndices.filter((index) => index >= visibleStart && index < visibleStart + zoom);
    if (localIndices.length === 0) return [];
    const first = Math.max(pattern.fromIndex, visibleStart) - visibleStart;
    const last = Math.min(pattern.toIndex, visibleStart + zoom - 1) - visibleStart;
    const patternCandles = pattern.candleIndices.map((index) => candles[index]).filter(Boolean);
    if (patternCandles.length === 0) return [];
    const yTop = getY(Math.max(...patternCandles.map((candle) => candle.high))) - 8;
    const yBottom = getY(Math.min(...patternCandles.map((candle) => candle.low))) + 8;
    const x1 = getX(first) - candleWidth / 2;
    const x2 = getX(last) + candleWidth / 2;
    const labelWidth = Math.min(170, Math.max(82, pattern.label.length * 6.2));
    const labelX = Math.max(axisLeft, Math.min(width - labelWidth, x1));
    return [{
      pattern,
      x1,
      x2,
      yTop,
      yBottom,
      color: isBullishPattern(pattern) ? "#22c55e" : isBearishPattern(pattern) ? "#ef4444" : "#facc15",
      selected: selectedPattern?.id === pattern.id,
      labelX,
      desiredLabelY: Math.max(0, Math.min(chartHeight - PATTERN_LABEL_HEIGHT, yTop - 16)),
      labelWidth,
    }];
  }) : [];
  const chartPatternLabels = layoutChartPatternLabels(chartPatterns, chartHeight);

  const updateCrosshair = (clientX: number, clientY: number) => {
    lastPointerRef.current = { clientX, clientY };
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || visibleCandles.length === 0) return;
    const point = projectSpxChartClientPoint({ clientX, clientY, rect, viewBoxWidth: width, viewBoxHeight: height });
    const x = Math.max(axisLeft, Math.min(width, point.x));
    const y = Math.max(0, Math.min(chartHeight + volumeHeight, point.y));
    const visibleIndex = Math.max(0, Math.min(visibleCandles.length - 1, Math.floor((x - axisLeft) / candleWidth)));
    const priceY = Math.max(24, Math.min(chartHeight - 16, y));
    const price = low + ((chartHeight - 16 - priceY) / Math.max(1, chartHeight - 40)) * priceRange;
    setCrosshair({ x, y, price, index: visibleStart + visibleIndex });
  };

  useEffect(() => {
    const pointer = lastPointerRef.current;
    if (pointer) updateCrosshair(pointer.clientX, pointer.clientY);
  }, [height, width]);

  const handleMove = (clientX: number, clientY: number) => {
    updateCrosshair(clientX, clientY);
    if (dragStart === null) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentPoint = projectSpxChartClientPoint({ clientX, clientY, rect, viewBoxWidth: width, viewBoxHeight: height });
    const startPoint = projectSpxChartClientPoint({ clientX: dragStart, clientY, rect, viewBoxWidth: width, viewBoxHeight: height });
    const delta = currentPoint.x - startPoint.x;
    const moved = Math.round(delta / Math.max(1, candleWidth));
    if (Math.abs(moved) >= 1) {
      setStartIndex((current) => Math.max(0, Math.min(maxStart, current - moved)));
      setDragStart(clientX);
    }
  };

  if (candles.length === 0) {
    return (
      <div className="flex h-[620px] items-center justify-center border border-white/10 bg-black/20 text-xs uppercase tracking-[0.2em] text-zinc-500">
        No OHLCV
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden border border-[#123142] bg-[#02070d] ${
        expanded ? "fixed inset-3 z-[1100] shadow-2xl shadow-black/80 md:inset-6" : ""
      }`}
      ref={containerRef}
      data-pa-chart-expanded={expanded ? "true" : "false"}
    >
      <div className="flex items-center justify-between border-b border-[#123142] bg-black/30 px-3 py-2">
        <div className="flex items-center gap-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/75">
          <span>{candles.length} candles</span>
          <span>{visibleCandles.length} visible</span>
          <span>{patterns.length} / {totalPatternCount} signals</span>
        </div>
        <div className="relative flex items-center gap-1">
          <button type="button" className="h-7 w-7 border border-white/10 text-zinc-300 hover:bg-white/10" onClick={() => setZoom((value) => Math.min(candles.length, Math.round(value * 1.2)))} title="Zoom out">
            <ZoomOut className="mx-auto h-3.5 w-3.5" />
          </button>
          <button type="button" className="h-7 w-7 border border-white/10 text-zinc-300 hover:bg-white/10" onClick={() => setZoom((value) => Math.max(20, Math.round(value * 0.82)))} title="Zoom in">
            <ZoomIn className="mx-auto h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`h-7 w-7 border text-zinc-300 hover:bg-white/10 ${signalFilter.direction !== "all" || signalFilter.type !== "all" ? "border-cyan-200 bg-cyan-200 text-[#03111a]" : "border-white/10"}`}
            onClick={() => setFilterOpen((value) => !value)}
            title="Filter signals"
            aria-label="Filter signals"
            aria-expanded={filterOpen}
            data-pa-signal-filter-button="true"
          >
            <Filter className="mx-auto h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`h-7 w-7 border text-zinc-300 hover:bg-white/10 ${expanded ? "border-cyan-200 bg-cyan-200 text-[#03111a]" : "border-white/10"}`}
            onClick={() => {
              setFilterOpen(false);
              setExpanded((value) => !value);
            }}
            title={expanded ? "Exit full screen" : "Full screen chart"}
            aria-label={expanded ? "Exit full screen chart" : "Full screen chart"}
            aria-pressed={expanded}
            data-pa-chart-fullscreen-button="true"
          >
            {expanded ? <X className="mx-auto h-3.5 w-3.5" /> : <Maximize2 className="mx-auto h-3.5 w-3.5" />}
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-9 z-20 w-72 border border-[#123142] bg-[#02070d] p-3 shadow-2xl" data-pa-filter-popover="true">
              <div className="mb-2 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Signal filter</div>
              <div className="mb-3 grid grid-cols-4 gap-1">
                {directionFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSignalFilterChange({ ...signalFilter, direction: option.value })}
                    className={`h-7 border px-1 font-mono text-[10px] font-black ${signalFilter.direction === option.value ? "border-white bg-white text-[#03111a]" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"}`}
                    aria-pressed={signalFilter.direction === option.value}
                    data-pa-filter-direction={option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">Pattern type</span>
                <select
                  value={signalFilter.type}
                  onChange={(event) => onSignalFilterChange({ ...signalFilter, type: event.target.value as SignalFilterState["type"] })}
                  className="h-9 w-full border border-white/10 bg-[#06111a] px-2 font-mono text-[11px] font-black text-white outline-none"
                  data-pa-filter-type="true"
                >
                  <option value="all">All types</option>
                  {availablePatternTypes.map((type) => (
                    <option key={type} value={type}>{type.split("_").join(" ")}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>
      <svg
        ref={svgRef}
        data-pa-chart-surface="true"
        data-pa-visible-zone-count={zoneRows.length}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={dragStart === null ? "cursor-crosshair select-none" : "cursor-grabbing select-none"}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragStart(event.clientX);
          updateCrosshair(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => handleMove(event.clientX, event.clientY)}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setDragStart(null);
        }}
        onPointerCancel={() => setDragStart(null)}
        onPointerLeave={() => {
          if (dragStart === null) {
            lastPointerRef.current = null;
            setCrosshair(null);
          }
        }}
      >
        <defs>
          <filter id="pa-selected-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f8fafc" floodOpacity="0.45" />
          </filter>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="#02070d" />
        <rect x={axisLeft} y={0} width={plotWidth} height={chartHeight + volumeHeight} fill="#06111a" />
        {Array.from({ length: 5 }).map((_, index) => {
          const y = 12 + index * ((chartHeight - 30) / 4);
          const price = high - (index / 4) * priceRange;
          return (
            <g key={index}>
              <line x1={axisLeft} y1={y} x2={width} y2={y} stroke="#123142" strokeDasharray="3 3" />
              <text x={axisLeft - 6} y={y + 3} textAnchor="end" className="fill-zinc-500 font-mono text-[10px]">
                {price.toFixed(1)}
              </text>
            </g>
          );
        })}

        {zoneRows.map(({ zone, y, color, fill, label, bandHeight, labelY }) => {
          const bandY = Math.max(0, Math.min(chartHeight - bandHeight, y - bandHeight / 2));
          const labelWidth = Math.min(190, Math.max(122, label.length * 6.2 + 18));
          const labelX = Math.max(axisLeft + 8, width - labelWidth - 10);
          return (
            <g key={zone.id} data-pa-zone-band="true">
              <rect x={axisLeft} y={bandY} width={plotWidth} height={bandHeight} fill={fill} opacity={0.72} />
              <line x1={axisLeft} y1={y} x2={width} y2={y} stroke={color} strokeOpacity={0.9} strokeDasharray="7 5" strokeWidth={1.25} />
              <g data-pa-zone-label="true" transform={`translate(${labelX} ${labelY - 9})`}>
                <rect width={labelWidth} height={18} fill="#02070d" stroke={color} strokeOpacity={0.85} />
                <text x={8} y={12} className="fill-zinc-100 font-mono text-[10px] font-black">
                  {label}
                </text>
                <text x={labelWidth - 8} y={12} textAnchor="end" className="fill-zinc-400 font-mono text-[9px]">
                  {zone.strength}x
                </text>
              </g>
            </g>
          );
        })}

        {visibleCandles.map((candle, index) => {
          const x = getX(index);
          const yOpen = getY(candle.open);
          const yClose = getY(candle.close);
          const yHigh = getY(candle.high);
          const yLow = getY(candle.low);
          const bullish = candle.close >= candle.open;
          const color = bullish ? "#22c55e" : "#ef4444";
          const bodyTop = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(1, Math.abs(yOpen - yClose));
          const volumeY = getVolY(candle.volume);
          const volumeBarHeight = Math.max(1, chartHeight + volumeHeight - volumeY - 4);
          return (
            <g key={`${candle.time}-${index}`} data-pa-candle="true">
              <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.2} />
              <rect x={x - Math.max(1.5, candleWidth * 0.33)} y={bodyTop} width={Math.max(2, candleWidth * 0.66)} height={bodyHeight} fill={bullish ? color : "transparent"} stroke={color} strokeWidth={1.1} />
              {showVolume && (
                <rect
                  x={x - Math.max(1.5, candleWidth * 0.3)}
                  y={volumeY}
                  width={Math.max(2, candleWidth * 0.6)}
                  height={volumeBarHeight}
                  fill={color}
                  opacity={0.22}
                  data-pa-volume-bar="true"
                />
              )}
            </g>
          );
        })}

        {chartPatterns.map(({ pattern, x1, x2, yTop, yBottom, color, selected }) => (
          <g key={`${pattern.id}-range`} pointerEvents="none" data-pa-pattern-range="true" data-pa-selected-pattern={selected ? "true" : undefined}>
            <rect x={x1} y={yTop} width={Math.max(16, x2 - x1)} height={Math.max(18, yBottom - yTop)} fill={color} opacity={selected ? 0.12 : 0.035} stroke={color} strokeWidth={selected ? 2 : 1} strokeDasharray={selected ? "" : "3 2"} filter={selected ? "url(#pa-selected-glow)" : undefined} />
          </g>
        ))}

        {chartPatternLabels.map(({ pattern, color, selected, labelX, labelY, labelWidth }) => (
          <g
            key={`${pattern.id}-label`}
            role="button"
            tabIndex={0}
            aria-label={`Select ${pattern.label} signal`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelectPattern(pattern);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onSelectPattern(pattern);
            }}
            className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-white focus-visible:[&>rect]:stroke-2"
            data-pa-pattern-badge="true"
            data-pa-pattern-id={pattern.id}
            data-pa-selected-pattern={selected ? "true" : undefined}
          >
            <rect x={labelX} y={labelY} width={labelWidth} height={PATTERN_LABEL_HEIGHT} fill={selected ? color : "#02070d"} stroke={color} />
            <text x={labelX + 5} y={labelY + 11} className="pointer-events-none fill-white font-mono text-[9px] font-black">
              {pattern.label}
            </text>
          </g>
        ))}

        {showTrend && trend.labels
          .filter((label) => label.index >= visibleStart && label.index < visibleStart + zoom)
          .slice(-30)
          .map((label) => {
            const candle = candles[label.index];
            if (!candle) return null;
            const visibleIndex = label.index - visibleStart;
            const x = getX(visibleIndex);
            const highLabel = label.label === "HH" || label.label === "LH";
            const y = highLabel ? getY(candle.high) - 18 : getY(candle.low) + 22;
            const color = highLabel ? "#22c55e" : "#ef4444";
            return (
              <g key={`${label.index}-${label.label}`} pointerEvents="none" data-pa-structure-label="true">
                <circle cx={x} cy={y} r={8} fill={color} />
                <text x={x} y={y + 3} textAnchor="middle" className="fill-black font-mono text-[8px] font-black">{label.label}</text>
              </g>
            );
          })}

        {crosshair && (
          <g pointerEvents="none" data-pa-crosshair="true">
            <line x1={crosshair.x} y1={0} x2={crosshair.x} y2={chartHeight + volumeHeight} stroke="#d4d4d8" strokeDasharray="3 3" strokeOpacity={0.7} />
            <line x1={axisLeft} y1={crosshair.y} x2={width} y2={crosshair.y} stroke="#d4d4d8" strokeDasharray="3 3" strokeOpacity={0.7} />
            <rect x={2} y={Math.max(2, crosshair.y - 9)} width={52} height={18} fill="#f8fafc" />
            <text x={28} y={Math.max(14, crosshair.y + 3)} textAnchor="middle" className="fill-black font-mono text-[9px] font-black">{crosshair.price.toFixed(1)}</text>
            <rect x={Math.max(axisLeft, Math.min(width - 168, crosshair.x - 78))} y={height - 19} width={166} height={17} fill="#f8fafc" />
            <text x={Math.max(axisLeft, Math.min(width - 168, crosshair.x - 78)) + 83} y={height - 7} textAnchor="middle" className="fill-black font-mono text-[8px] font-black">
              {formatEtTime(candles[crosshair.index]?.time)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

const zoneClass = (zone: SpxPriceActionZone | null | undefined) => {
  if (!zone) return "border-white/10 bg-white/[0.03] text-zinc-500";
  if (zone.type === "support") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (zone.type === "resistance") return "border-red-300/30 bg-red-300/10 text-red-100";
  return "border-amber-300/30 bg-amber-300/10 text-amber-100";
};

const ZoneTile = ({ label, zone }: { label: string; zone: SpxPriceActionZone | null }) => (
  <div className={`border p-2 ${zoneClass(zone)}`}>
    <div className="font-mono text-[9px] font-black uppercase tracking-[0.14em] opacity-70">{label}</div>
    <div className="mt-1 font-mono text-sm font-black">{zone ? formatPrice(zone.price) : "n/a"}</div>
    <div className="font-mono text-[10px] opacity-70">{zone ? `${zone.strength} touches / ${formatSigned(zone.distanceToLastPercent, "%")}` : "-"}</div>
  </div>
);

const SelectedSignalCard = ({
  pattern,
  candle,
  onShowDetail,
}: {
  pattern: SpxPriceActionPattern | null;
  candle?: SpxPriceActionCandle;
  onShowDetail: () => void;
}) => (
  <section className={`border px-3 py-2 ${pattern ? toneClasses(pattern) : "border-[#123142] bg-black/20 text-zinc-500"}`} data-pa-selected-signal-card="true">
    {!pattern ? (
      <div className="flex min-h-12 items-center justify-center text-xs font-bold uppercase tracking-[0.16em]">
        Select a chart signal or Signal Monitor row
      </div>
    ) : (
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] opacity-70">
            Selected signal
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="text-lg font-black text-white">{pattern.label}</div>
            <span className="border border-white/15 bg-black/20 px-2 py-1 font-mono text-[10px] font-black uppercase">
              {pattern.direction} / {pattern.category}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 font-mono text-[11px] text-zinc-300">
            <span>Price ${formatPrice(pattern.price)}</span>
            <span>Confidence {Math.round(pattern.confidence * 100)}%</span>
            <span>Window {pattern.fromIndex}-{pattern.toIndex}</span>
            <span>{candle ? formatEtTime(candle.time) : "time n/a"}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onShowDetail}
          className="h-10 shrink-0 border border-white/25 bg-white px-3 text-xs font-black text-[#03111a] hover:bg-cyan-100"
          data-pa-show-detail="true"
        >
          Show Detail
        </button>
      </div>
    )}
  </section>
);

const SourcePanel = ({ data }: { data: SpxPriceActionCompassResponse }) => (
  <section className="border border-[#123142] bg-black/20 p-3 text-xs leading-5 text-zinc-400" data-pa-source-panel="true">
    <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Source</div>
    <div className="mt-2">{data.source.label} / {data.source.interval} / {data.source.range}</div>
    <div className="font-mono text-[10px] text-zinc-500">Candle time: America/New_York (ET)</div>
    <div className="font-mono text-[10px] text-zinc-600">
      Fetched {formatEtTime(data.source.fetchedAt, true)} / {formatUtcTime(data.source.fetchedAt, true)}
    </div>
  </section>
);

const LearningPanel = ({ selectedPattern, onOpen }: { selectedPattern: SpxPriceActionPattern | null; onOpen: () => void }) => (
  <section className="border border-[#123142] bg-black/20 p-3">
    <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
      <BookOpen className="h-4 w-4" />
      Learning Mode
    </div>
    <button
      type="button"
      onClick={onOpen}
      className={`w-full border px-3 py-3 text-left transition-colors hover:border-white/40 ${toneClasses(selectedPattern)}`}
      data-pa-learning-panel="true"
    >
      <div className="text-sm font-black text-white">{selectedPattern?.label || "Select a pattern"}</div>
      <div className="mt-1 text-xs leading-5 text-zinc-300">{selectedPattern?.description || "Pattern detail opens as a modal with the detected candle window and a compact diagram."}</div>
    </button>
  </section>
);

const PracticePanel = ({
  pattern,
  outcome,
  choice,
  revealed,
  onChoose,
  onReset,
}: {
  pattern: SpxPriceActionPattern | null;
  outcome: "LONG" | "SHORT" | null;
  choice: "LONG" | "SHORT" | "SKIP" | null;
  revealed: boolean;
  onChoose: (choice: "LONG" | "SHORT" | "SKIP") => void;
  onReset: () => void;
}) => (
  <section className="border border-[#123142] bg-black/20 p-3" data-pa-practice-panel="true">
    <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
      <GraduationCap className="h-4 w-4" />
      Practice Mode
    </div>
    {!pattern ? (
      <div className="py-6 text-center text-xs text-zinc-500">No usable challenge window.</div>
    ) : (
      <div className="flex flex-col gap-2">
        <div className="border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-zinc-300">
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Hidden setup</div>
          <div className="mt-1">Signal candle index {pattern.toIndex}. Outcome is hidden until a decision is made.</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["LONG", "SHORT", "SKIP"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onChoose(item)}
              disabled={revealed}
              className={`h-10 border text-xs font-black transition-colors disabled:opacity-80 ${
                choice === item
                  ? "border-white bg-white text-[#03111a]"
                  : "border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/10"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        {revealed && (
          <div className={`border p-3 text-xs leading-5 ${choice === "SKIP" ? "border-white/10 bg-white/[0.03] text-zinc-300" : choice === outcome ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-red-300/30 bg-red-300/10 text-red-100"}`}>
            <div className="flex items-center gap-2 font-black">
              {choice === outcome ? <Check className="h-4 w-4" /> : choice === "SKIP" ? <Target className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Outcome: {outcome || "n/a"}
            </div>
            <button type="button" onClick={onReset} className="mt-2 border border-white/15 px-2 py-1 font-mono text-[10px] font-black text-white hover:bg-white/10">
              Reset
            </button>
          </div>
        )}
      </div>
    )}
  </section>
);

const PatternModal = ({ pattern, candles, onClose }: { pattern: SpxPriceActionPattern; candles: SpxPriceActionCandle[]; onClose: () => void }) => {
  const patternCandles = pattern.candleIndices.map((index) => candles[index]).filter(Boolean);
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" data-pa-pattern-modal="true">
      <button type="button" aria-label="Close pattern modal backdrop" className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl border border-[#123142] bg-[#02070d] shadow-2xl">
        <div className={`h-1 ${isBullishPattern(pattern) ? "bg-emerald-400" : isBearishPattern(pattern) ? "bg-red-400" : "bg-amber-300"}`} />
        <div className="flex items-center justify-between border-b border-[#123142] px-4 py-3">
          <div>
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{pattern.type}</div>
            <h3 className="mt-1 text-lg font-black text-white">{pattern.label}</h3>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 border border-white/10 text-zinc-300 hover:bg-white/10" aria-label="Close pattern modal">
            <X className="mx-auto h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            <MetricChip label="Price" value={formatPrice(pattern.price)} />
            <MetricChip label="Confidence" value={`${Math.round(pattern.confidence * 100)}%`} />
            <MetricChip label="Window" value={`${pattern.fromIndex}-${pattern.toIndex}`} />
          </div>
          <PatternDiagram pattern={pattern} candles={patternCandles} />
          <div className="border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-zinc-300">
            {pattern.description}
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricChip = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/10 bg-white/[0.03] p-2">
    <div className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div>
    <div className="mt-1 truncate font-mono text-sm font-black text-white">{value}</div>
  </div>
);

const PatternDiagram = ({ pattern, candles }: { pattern: SpxPriceActionPattern; candles: SpxPriceActionCandle[] }) => {
  const color = isBullishPattern(pattern) ? "#22c55e" : isBearishPattern(pattern) ? "#ef4444" : "#facc15";
  const values = candles.length > 0 ? candles : [];
  const high = Math.max(...values.map((candle) => candle.high), pattern.price + 1);
  const low = Math.min(...values.map((candle) => candle.low), pattern.price - 1);
  const range = Math.max(1, high - low);
  const getY = (price: number) => 18 + 110 - ((price - low) / range) * 92;
  const candleBodyWidth = 12;
  const candleSlot = values.length <= 4 ? 24 : Math.max(16, Math.min(30, 420 / Math.max(1, values.length - 1)));
  const groupWidth = values.length > 1 ? (values.length - 1) * candleSlot + candleBodyWidth : candleBodyWidth;
  const startX = 260 - groupWidth / 2 + candleBodyWidth / 2;
  return (
    <div className="border border-white/10 bg-white/[0.03] p-3">
      <svg viewBox="0 0 520 150" width="100%" height="150" data-pa-pattern-diagram="true">
        <rect x={0} y={0} width={520} height={150} fill="#06111a" />
        <line x1={20} y1={getY(pattern.price)} x2={500} y2={getY(pattern.price)} stroke="#818cf8" strokeDasharray="4 3" />
        {values.map((candle, index) => {
          const x = startX + index * candleSlot;
          const bullish = candle.close >= candle.open;
          const candleColor = bullish ? "#22c55e" : "#ef4444";
          return (
            <g key={`${candle.time}-${index}`}>
              <line x1={x} y1={getY(candle.high)} x2={x} y2={getY(candle.low)} stroke={candleColor} />
              <rect x={x - candleBodyWidth / 2} y={Math.min(getY(candle.open), getY(candle.close))} width={candleBodyWidth} height={Math.max(2, Math.abs(getY(candle.open) - getY(candle.close)))} fill={bullish ? candleColor : "transparent"} stroke={candleColor} />
            </g>
          );
        })}
        {values.length === 0 && (
          <>
            <path d="M 30 110 C 120 30, 180 30, 250 85 S 390 120, 490 38" fill="none" stroke={color} strokeWidth={3} />
            <circle cx={250} cy={85} r={5} fill={color} />
          </>
        )}
        <text x={500} y={getY(pattern.price) - 5} textAnchor="end" className="fill-indigo-200 font-mono text-[10px] font-black">
          {formatPrice(pattern.price)}
        </text>
      </svg>
    </div>
  );
};
