import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Activity, AlertTriangle, TrendingUp } from "lucide-react";
import { formatSpxGexCompactExposure } from "@/lib/spx-gex-heatmap";
import { parseJsonResponse } from "@/lib/safe-json-response";
import { getSpxSpotLivePulseKey } from "@/lib/spx-spot-live-pulse";
import { isSpxRequestAbort, runSpxRequest } from "@/lib/spx-request-lane";
import {
  buildSpxGexOneMinuteSpotSegments,
  buildSpxGexPressureAxisTicks,
  buildSpxGexPressureChartGeometry,
  extendSpxGexPressureForSession,
  getLatestSpxGexSpotPoint,
  type SpxGexPressureCell,
  type SpxGexPressureMatrixModel,
  type SpxGexPressureMover,
  type SpxGexPressureState,
} from "@/lib/spx-gex-pressure-matrix";
import { SpxGexInlineTooltip, SpxGexTooltip } from "./spx-gex-tooltip";

interface PressureResponse {
  status: "READY" | "DEGRADED" | "EMPTY" | "BINDING_MISSING" | "STORAGE_UNAVAILABLE" | "ERROR";
  errorCode: string | null;
  error?: string;
  selectedDate: string | null;
  pressure: SpxGexPressureMatrixModel | null;
  invalidSnapshots: Array<{
    snapshotMinuteEt: number;
    snapshotTimeEt: string;
    reasonCode: "SNAPSHOT_JSON_MALFORMED" | "SESSION_CONTRACT_INCOMPLETE" | "NO_AUDITED_BLENDED_IV_CELLS";
  }>;
  collectionAttempts: Array<{
    slotId: string;
    snapshotMinuteEt: number;
    attempt: number;
    status: "PENDING" | "FAILED" | "ACCEPTED";
    occurredAt: string;
    acceptedAt: string | null;
    failureReason: string | null;
    quality: Record<string, unknown> | null;
  }>;
  warnings: string[];
}

interface SpxGexPressureMatrixProps {
  selectedDate: string;
  selectedMinute: number | null;
  refreshKey: number;
  enabled?: boolean;
  controls: ReactNode;
}

interface ActiveCell {
  key: string;
  strike: number;
  cell: SpxGexPressureCell;
  anchor: { left: number; top: number; width: number; height: number };
  locked: boolean;
}

interface PriceOverlayState {
  selectedDate: string;
  data: {
    ticker: "SPX";
    timeframe: "1m";
    candles: Array<{ time: number; close: number }>;
    source: {
      provider: "0dtespx" | "yahoo" | "test";
      label: string;
      interval: string;
      fetchedAt: string;
      latestSampleAt?: string | null;
      status?: "READY" | "STALE" | "UNAVAILABLE";
      expectedMove?: { status: "READY" | "UNAVAILABLE"; value: number | null; sampleAt: string | null; errorCode: string | null };
    };
    warnings: string[];
  } | null;
  error: string | null;
}

const CELL_WIDTH = 35;
const ROW_HEIGHT = 25;
const STRIKE_WIDTH = 82;
const CURRENT_GEX_WIDTH = 120;
const MATRIX_HEADER_HEIGHT = 45;
const TOOLTIP_ID = "spx-gex-pressure-cell-tooltip";
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT = 150;

const strikeFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const spotFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const compact = (value: number | null | undefined, signed = false) =>
  formatSpxGexCompactExposure(value, { signed, missingLabel: "n/a" });

const stateLabel: Record<SpxGexPressureState, string> = {
  POSITIVE_STRONGER: "POSITIVE STRONGER",
  POSITIVE_WEAKER: "POSITIVE WEAKER",
  NEGATIVE_DEEPER: "NEGATIVE DEEPER",
  NEGATIVE_WEAKER: "NEGATIVE WEAKER",
  FLIP_TO_POSITIVE: "FLIP TO POSITIVE",
  FLIP_TO_NEGATIVE: "FLIP TO NEGATIVE",
  UNCHANGED: "UNCHANGED",
  NO_BASELINE: "NO BASELINE",
  NO_DATA: "NO DATA",
};

const stateGlyph = (state: SpxGexPressureState) => {
  if (state === "POSITIVE_STRONGER" || state === "NEGATIVE_DEEPER") return "+";
  if (state === "POSITIVE_WEAKER" || state === "NEGATIVE_WEAKER") return "−";
  if (state === "FLIP_TO_POSITIVE" || state === "FLIP_TO_NEGATIVE") return "↔";
  if (state === "UNCHANGED") return "·";
  return "";
};

const stateColor = (state: SpxGexPressureState, currentGex?: number | null) => {
  if (state === "FLIP_TO_POSITIVE" || state === "FLIP_TO_NEGATIVE") return "#fbbf24";
  if (state === "NO_DATA" || state === "NO_BASELINE") return "#475569";
  if ((currentGex || 0) > 0) return "#4ade80";
  if ((currentGex || 0) < 0) return "#f472b6";
  return "#64748b";
};

const cellBackground = (cell: SpxGexPressureCell, missingSlot: boolean) => {
  if (missingSlot) {
    return "repeating-linear-gradient(135deg, rgba(71,85,105,.16) 0 4px, rgba(15,23,42,.55) 4px 8px)";
  }
  if (cell.state === "NO_DATA") return "rgba(15, 28, 42, 0.72)";
  if (cell.state === "NO_BASELINE") return "rgba(51, 65, 85, 0.38)";
  const alpha = 0.18 + (cell.intensityPct / 100) * 0.68;
  if (cell.state === "FLIP_TO_POSITIVE" || cell.state === "FLIP_TO_NEGATIVE") return `rgba(245, 158, 11, ${alpha})`;
  if ((cell.currentGex || 0) >= 0) return `rgba(22, 163, 74, ${alpha})`;
  return `rgba(190, 24, 93, ${alpha})`;
};

const etClock = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { tradingDate: `${parts.year}-${parts.month}-${parts.day}`, minuteEt: Number(parts.hour) * 60 + Number(parts.minute) };
};

const formatPercent = (value: number | null) => value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const formatEtTime = (value: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(value));

const MoverTape = ({ movers, latestTime, matrixHeight }: { movers: SpxGexPressureMover[]; latestTime: string; matrixHeight: number }) => {
  const topMover = movers[0] || null;
  return (
    <aside
      className="flex flex-col overflow-hidden border-t border-[#123142] bg-[#040a12] p-3 2xl:h-[var(--spx-pressure-matrix-height)] 2xl:border-l 2xl:border-t-0"
      style={{ "--spx-pressure-matrix-height": `${matrixHeight}px` } as CSSProperties}
      data-spx-gex-mover-tape="true"
      aria-labelledby="spx-gex-mover-tape-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#123142] pb-2">
        <div id="spx-gex-mover-tape-title" className="flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.14em] text-cyan-300">
          <Activity aria-hidden="true" className="h-3.5 w-3.5" />Mover Tape
        </div>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">Latest {latestTime} ET</span>
      </div>
      <ol className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Latest GEX movers ranked by absolute delta">
        {!topMover ? (
          <li className="py-10 text-center text-xs text-zinc-500">No comparable baseline movers.</li>
        ) : (
          <>
            <li><MoverHero mover={topMover} /></li>
            {movers.slice(1).map((mover) => <MoverRow key={mover.strike} mover={mover} />)}
          </>
        )}
      </ol>
    </aside>
  );
};

const MoverHero = ({ mover }: { mover: SpxGexPressureMover }) => {
  const color = stateColor(mover.state, mover.currentGex);
  return (
    <div className="border p-3" style={{ borderColor: `${color}88`, background: `${color}0f` }} data-spx-gex-latest-mover="true">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.14em]" style={{ color }}>Latest mover</div>
          <div className="mt-1 text-3xl font-black tabular-nums text-white">{strikeFormatter.format(mover.strike)}</div>
          <div className="mt-1 font-mono text-xs font-black tabular-nums" style={{ color }}>Δ {compact(mover.deltaGex, true)} GEX</div>
        </div>
        <span className="shrink-0 border px-2 py-1 font-mono text-[10px] font-black uppercase" style={{ borderColor: color, color }}>
          {stateLabel[mover.state]}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-[10px] tabular-nums text-zinc-400">
        <span>Current <strong className="text-zinc-100">{compact(mover.currentGex, true)}</strong></span>
        <span className="text-right">Intensity <strong style={{ color }}>{mover.intensityPct}%</strong></span>
      </div>
      <div className="mt-2 h-[3px] bg-white/5" aria-hidden="true"><div className="h-full" style={{ width: `${mover.intensityPct}%`, backgroundColor: color }} /></div>
    </div>
  );
};

const MoverRow = ({ mover }: { mover: SpxGexPressureMover }) => {
  const color = stateColor(mover.state, mover.currentGex);
  return (
    <li className="border-b border-white/10 py-2.5">
      <div className="grid grid-cols-[30px_minmax(56px,1fr)_auto] items-center gap-2">
        <span className="font-mono text-[10px] font-black tabular-nums" style={{ color }}>#{mover.rank.toString().padStart(2, "0")}</span>
        <div className="min-w-0">
          <div className="text-base font-black tabular-nums text-white">{strikeFormatter.format(mover.strike)}</div>
          <div className="font-mono text-[10px] tabular-nums" style={{ color }}>Δ {compact(mover.deltaGex, true)}</div>
        </div>
        <div className="text-right">
          <span className="inline-block border px-1.5 py-0.5 font-mono text-[10px] font-black uppercase" style={{ borderColor: color, color }}>{stateLabel[mover.state]}</span>
          <div className="mt-1 font-mono text-[10px] tabular-nums text-zinc-400">Current {compact(mover.currentGex, true)}</div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-[2px] flex-1 bg-white/5" aria-hidden="true"><div className="h-full" style={{ width: `${mover.intensityPct}%`, backgroundColor: color }} /></div>
        <span className="w-8 text-right font-mono text-[10px] tabular-nums text-zinc-500">{mover.intensityPct}%</span>
      </div>
    </li>
  );
};

export function SpxGexPressureMatrix({ selectedDate, selectedMinute, refreshKey, controls, enabled = true }: SpxGexPressureMatrixProps) {
  const [data, setData] = useState<PressureResponse | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [priceOverlay, setPriceOverlay] = useState<PriceOverlayState | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [matrixRailWidth, setMatrixRailWidth] = useState(0);
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const activeCellRef = useRef(activeCell);
  const hoverSuppressedAfterScrollRef = useRef(false);
  activeCellRef.current = activeCell;
  dataRef.current = data;
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveCell(null);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, []);

  useEffect(() => {
    const dismissOnOuterScroll = (event: Event) => {
      if (!activeCellRef.current?.locked) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[data-spx-gex-tooltip-surface]')) return;
      hoverSuppressedAfterScrollRef.current = true;
      setActiveCell(null);
    };
    window.addEventListener("scroll", dismissOnOuterScroll, true);
    document.addEventListener("scroll", dismissOnOuterScroll, true);
    return () => {
      window.removeEventListener("scroll", dismissOnOuterScroll, true);
      document.removeEventListener("scroll", dismissOnOuterScroll, true);
    };
  }, []);

  useEffect(() => setActiveCell(null), [refreshKey, selectedDate]);

  useEffect(() => {
    const rail = matrixScrollRef.current;
    if (!rail) return undefined;
    const syncWidth = () => setMatrixRailWidth(Math.max(0, rail.getBoundingClientRect().width));
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [data?.pressure]);

  useEffect(() => {
    if (!selectedDate || !enabled) return undefined;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ date: selectedDate });
        const response = await runSpxRequest((attemptSignal) => fetch(`/api/spx-gex-pressure?${params.toString()}`, { signal: attemptSignal }), {
          signal: controller.signal,
          onRetry: () => setReconnecting(true),
        });
        const payload = await parseJsonResponse<PressureResponse>(response, "/api/spx-gex-pressure");
        if (!response.ok || payload.status === "ERROR" || payload.status === "STORAGE_UNAVAILABLE" || payload.status === "BINDING_MISSING") {
          throw new Error(payload.error || `SPX GEX pressure API failed with HTTP ${response.status}`);
        }
        setData(payload);
        setRefreshError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isSpxRequestAbort(error)) return;
        const message = error instanceof Error ? error.message : String(error);
        if (dataRef.current?.pressure && dataRef.current.selectedDate === selectedDate) {
          setRefreshError(message);
        } else {
          setData({ status: "ERROR", errorCode: "SPX_GEX_PRESSURE_REQUEST_FAILED", error: message, selectedDate, pressure: null, invalidSnapshots: [], collectionAttempts: [], warnings: [] });
        }
      } finally {
        if (!controller.signal.aborted) setReconnecting(false);
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, refreshKey, selectedDate]);

  useEffect(() => {
    if (!selectedDate || !enabled) return undefined;
    const controller = new AbortController();
    const load = async () => {
      try {
        const params = new URLSearchParams({ timeframe: "1m", view: "price-overlay" });
        const response = await runSpxRequest((attemptSignal) => fetch(`/api/spx-price-action-compass?${params.toString()}`, { signal: attemptSignal }), {
          signal: controller.signal,
          onRetry: () => setReconnecting(true),
        });
        const payload = await parseJsonResponse<NonNullable<PriceOverlayState["data"]>>(response, "/api/spx-price-action-compass");
        if (!response.ok) throw new Error(payload.warnings?.join(" ") || `SPX 1-minute API failed with HTTP ${response.status}`);
        setPriceOverlay({ selectedDate, data: payload, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isSpxRequestAbort(error)) return;
        const message = error instanceof Error ? error.message : String(error);
        setPriceOverlay((current) => current?.data && current.selectedDate === selectedDate
          ? { ...current, error: message }
          : { selectedDate, data: null, error: message });
      } finally {
        if (!controller.signal.aborted) setReconnecting(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, refreshKey, selectedDate]);

  const pressure = data?.selectedDate === selectedDate ? data.pressure : null;
  const openingAttempts = data?.selectedDate === selectedDate
    ? (data.collectionAttempts || []).filter((attempt) => attempt.snapshotMinuteEt === 9 * 60 + 30)
    : [];
  const acceptedOpeningRetry = openingAttempts.find((attempt) => attempt.attempt > 1 && attempt.status === "ACCEPTED");
  const latestSpotPoint = useMemo(() => pressure && priceOverlay?.data
    ? getLatestSpxGexSpotPoint(priceOverlay.data.candles, pressure.tradingDate)
    : null, [pressure, priceOverlay?.data]);
  const displayPressure = useMemo(() => pressure ? extendSpxGexPressureForSession(pressure, etClock()) : null, [pressure, refreshKey]);
  const oneMinuteSpotSegments = useMemo(() => {
    if (!displayPressure || priceOverlay?.selectedDate !== selectedDate || !priceOverlay.data || !latestSpotPoint) return [];
    const startMinute = displayPressure.timeline[0]?.snapshotMinuteEt ?? displayPressure.baseline.snapshotMinuteEt;
    return buildSpxGexOneMinuteSpotSegments(priceOverlay.data.candles, displayPressure.tradingDate, startMinute, latestSpotPoint.minuteEt);
  }, [displayPressure, latestSpotPoint, priceOverlay, selectedDate]);
  const axisTicks = useMemo(() => displayPressure ? buildSpxGexPressureAxisTicks(displayPressure.timeline) : [], [displayPressure]);
  const timelineLength = displayPressure?.timeline.length || 0;
  const availableTimelineWidth = Math.max(0, matrixRailWidth - STRIKE_WIDTH - CURRENT_GEX_WIDTH);
  const effectiveCellWidth = timelineLength > 0 ? Math.max(CELL_WIDTH, availableTimelineWidth / timelineLength) : CELL_WIDTH;
  const chartGeometry = useMemo(
    () => displayPressure ? buildSpxGexPressureChartGeometry(
      displayPressure,
      oneMinuteSpotSegments,
      effectiveCellWidth,
      ROW_HEIGHT,
      priceOverlay?.data?.source.provider === "0dtespx" && priceOverlay.data.source.expectedMove?.status === "READY"
        ? priceOverlay.data.source.expectedMove.value
        : null,
    ) : null,
    [displayPressure, effectiveCellWidth, oneMinuteSpotSegments, priceOverlay?.data],
  );
  const spotPulseKey = useMemo(() => chartGeometry?.latestPoint
    ? getSpxSpotLivePulseKey({
      price: chartGeometry.latestPoint.price,
      timeEt: chartGeometry.latestPoint.timeEt,
      resolution: chartGeometry.resolution,
    })
    : null, [chartGeometry]);
  const matrixWidth = timelineLength * effectiveCellWidth;
  const matrixHeight = (displayPressure?.rows.length || 0) * ROW_HEIGHT;
  const matrixGridHeight = MATRIX_HEADER_HEIGHT + matrixHeight;
  const oneMinuteOverlayPending = priceOverlay?.selectedDate !== selectedDate;
  const usingOneMinuteSpot = chartGeometry?.resolution === "1m";
  const spotSourceLabel = usingOneMinuteSpot
    ? `SPX 1M / ${(priceOverlay?.data?.source.provider || "source").toUpperCase()}`
    : oneMinuteOverlayPending ? "SPX 1M LOADING…" : "SPX 15M SNAPSHOT FALLBACK";
  const spotLiveLabel = chartGeometry?.latestPoint
    ? `SPX ${spotFormatter.format(chartGeometry.latestPoint.price)} · ${chartGeometry.latestPoint.timeEt} ET`
    : null;
  const priceOverlayWarning = !usingOneMinuteSpot && !oneMinuteOverlayPending
    ? priceOverlay?.error || `No SPX 1-minute candles are available for ${selectedDate}; showing the canonical 15-minute snapshot line.`
    : null;
  const expectedMoveWarning = usingOneMinuteSpot && priceOverlay?.data?.source.provider === "0dtespx"
    && priceOverlay.data.source.expectedMove?.status === "UNAVAILABLE"
    ? `0DTESPX Expected Move unavailable (${priceOverlay.data.source.expectedMove.errorCode || "source did not provide a valid current value"}).`
    : null;
  const expectedMoveLabel = chartGeometry?.expectedMoveRange
    ? `EM ±${spotFormatter.format(chartGeometry.expectedMoveRange.value)} · ${priceOverlay?.data?.source.expectedMove?.sampleAt ? formatEtTime(priceOverlay.data.source.expectedMove.sampleAt) : "current"} ET`
    : null;
  const activateCell = useCallback((element: HTMLElement, strike: number, cell: SpxGexPressureCell, locked: boolean) => {
    if (locked) hoverSuppressedAfterScrollRef.current = false;
    const key = `${strike}-${cell.snapshotMinuteEt}`;
    const rect = element.getBoundingClientRect();
    setActiveCell((current) => {
      if (locked && current?.key === key && current.locked) return null;
      if (!locked && current?.locked) return current;
      return { key, strike, cell, anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, locked };
    });
  }, []);

  const clearTransientCell = useCallback(() => {
    setActiveCell((current) => current?.locked ? current : null);
  }, []);

  const activeSlot = displayPressure?.timeline.find((slot) => slot.snapshotMinuteEt === activeCell?.cell.snapshotMinuteEt) || null;
  const activeSpotPoint = activeCell
    ? oneMinuteSpotSegments.flat().find((point) => point.minuteEt === activeCell.cell.snapshotMinuteEt) || null
    : null;

  return (
    <section
      className="border border-[#123142] bg-[#030910]"
      style={{ colorScheme: "dark" }}
      data-spx-gex-pressure-matrix="true"
      aria-busy={loading}
    >
      <div className="flex flex-col gap-3 border-b border-[#123142] bg-[#06111a] p-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Intraday GEX Movers</div>
          <h2 className="mt-1 text-xl font-black text-white">Strike Pressure Matrix</h2>
          <p className="mt-1 text-xs text-zinc-400">0DTE GEX / 15-minute delayed snapshots / SPX 1-minute price context</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-cyan-300/60 bg-cyan-300/10 px-2 py-1 font-mono text-[10px] font-black text-cyan-100">0DTE</span>
          {pressure && <span className="border border-amber-300/30 bg-amber-300/10 px-2 py-1 font-mono text-[10px] font-black text-amber-100">{pressure.delayMinutes}M DELAYED</span>}
          {pressure && <span className="border border-cyan-300/30 bg-cyan-300/5 px-2 py-1 font-mono text-[10px] font-black text-cyan-100" data-spx-gex-pressure-spot-source="true">{spotSourceLabel}</span>}
          {spotLiveLabel && <span key={spotPulseKey || "spot-live"} className="spx-spot-live-pulse border border-cyan-300/70 bg-cyan-300/10 px-2 py-1 font-mono text-[10px] font-black text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,.14)]" data-spx-gex-pressure-live-spot="true">{spotLiveLabel}</span>}
          {expectedMoveLabel && <span className="border border-violet-300/60 bg-violet-300/10 px-2 py-1 font-mono text-[10px] font-black text-violet-100" title="0DTESPX expected move risk corridor; it does not alter canonical GEX." data-spx-gex-pressure-expected-move="true">{expectedMoveLabel}</span>}
          {controls}
        </div>
      </div>

      {loading && !pressure ? (
        <div className="flex h-64 items-center justify-center font-mono text-xs uppercase tracking-[0.16em] text-zinc-500" role="status" aria-live="polite">Loading pressure matrix…</div>
      ) : !pressure ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 px-4 text-center text-zinc-400" role="alert" aria-live="assertive">
          <AlertTriangle aria-hidden="true" className="h-6 w-6 text-amber-300/70" />
          <span className="text-sm">{data?.error || "No retained 0DTE pressure snapshots for this date."}</span>
        </div>
      ) : (
        <>
            <div className="flex flex-wrap items-center gap-2 border-b border-cyan-300/20 bg-cyan-300/5 px-3 py-2 font-mono text-[10px] font-black text-cyan-100" data-spx-gex-opening-bucket="true">
              <span>09:30 ET · OPENING BUCKET</span>
              {acceptedOpeningRetry?.acceptedAt && (
                <span className="border border-green-300/40 bg-green-300/10 px-1.5 py-0.5 text-green-200" data-spx-gex-opening-retry-accepted="true">
                  RETRY {acceptedOpeningRetry.attempt} · ACCEPTED {formatEtTime(acceptedOpeningRetry.acceptedAt)} ET
                </span>
              )}
            </div>
            {pressure.warnings.length > 0 && <div className="border-b border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100" role="status" data-spx-gex-pressure-warning="true">{pressure.warnings.join(" ")}</div>}
            {reconnecting && <div className="border-b border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100" role="status">Reconnecting SPX source…</div>}
            {refreshError && <div className="border-b border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100" role="status" data-spx-gex-pressure-refresh-stale="true">Refresh failed; showing the last verified GEX matrix. {refreshError}</div>}
           {priceOverlayWarning && <div className="border-b border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-100" role="status" data-spx-gex-pressure-spot-warning="true">{priceOverlayWarning}</div>}
           {expectedMoveWarning && <div className="border-b border-violet-300/20 bg-violet-300/5 px-3 py-2 text-xs text-violet-100" role="status" data-spx-gex-pressure-expected-move-warning="true">{expectedMoveWarning}</div>}

          <div className="grid 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start">
            <div
              ref={matrixScrollRef}
              className="min-w-0 self-start overflow-x-auto [scrollbar-width:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 [&::-webkit-scrollbar]:hidden"
              data-spx-gex-pressure-scroll="true"
              onScroll={() => setActiveCell(null)}
              tabIndex={0}
              aria-label="SPX GEX pressure matrix. Use horizontal arrow keys or touch to inspect all 15-minute columns."
            >
              <div className="min-w-max font-mono text-[10px] tabular-nums" data-spx-gex-pressure-grid="true">
                <div className="flex border-b border-[#123142] bg-[#050c14]">
                  <div className="sticky left-0 z-40 flex h-11 shrink-0 items-center bg-[#050c14] px-2 font-black text-cyan-200" style={{ width: STRIKE_WIDTH }}>STRIKE</div>
                  <div className="flex" style={{ width: matrixWidth }}>
                    {axisTicks.map((slot) => (
                      <div
                        key={slot.snapshotMinuteEt}
                        className={`relative flex h-11 shrink-0 items-start justify-center border-l border-[#102433] pt-2 font-black ${slot.snapshotMinuteEt === selectedMinute ? "bg-cyan-300/15 text-cyan-100" : slot.status === "MISSING" ? "text-amber-200/80" : slot.status === "PENDING" ? "text-zinc-600" : "text-cyan-200/70"}`}
                        style={{ width: effectiveCellWidth }}
                        title={`${slot.snapshotTimeEt} ET${slot.collectedTimeEt ? ` / collected ${slot.collectedTimeEt} ET` : slot.status === "PENDING" ? " / pending collection" : " / missing"}`}
                        aria-current={slot.snapshotMinuteEt === selectedMinute ? "time" : undefined}
                        data-pressure-axis-major={slot.isMajor ? "true" : "false"}
                        data-pressure-column-status={slot.status}
                        data-pressure-opening-bucket={slot.snapshotMinuteEt === 9 * 60 + 30 ? "true" : undefined}
                        data-pressure-selected-slot={slot.snapshotMinuteEt === selectedMinute ? "true" : undefined}
                      >
                        {slot.snapshotMinuteEt === selectedMinute && <span className="absolute inset-x-0 top-0 h-0.5 bg-cyan-200 shadow-[0_0_8px_rgba(34,211,238,.9)]" aria-hidden="true" />}
                        {(slot.isMajor || slot.snapshotMinuteEt === selectedMinute) && <span className="whitespace-nowrap text-[9px]">{slot.snapshotTimeEt}</span>}
                        {!slot.isMajor && slot.snapshotMinuteEt !== selectedMinute && <span className="mt-1 h-1.5 w-px bg-cyan-200/25" aria-hidden="true" />}
                        {slot.snapshotMinuteEt === 9 * 60 + 30 && (
                          <span className={`absolute whitespace-nowrap text-[6px] tracking-[-0.05em] text-cyan-300 ${slot.status === "READY" ? "bottom-1" : "bottom-3.5"}`}>OPENING BUCKET</span>
                        )}
                        {slot.status === "MISSING" && <span className="absolute bottom-1 text-[8px] font-black tracking-[-0.08em]">MISSING</span>}
                        {slot.status === "PENDING" && <span className="absolute bottom-1 text-[8px] font-black tracking-[-0.08em]">PENDING</span>}
                      </div>
                    ))}
                  </div>
                  <div className="sticky right-0 z-40 flex h-11 shrink-0 items-center justify-end bg-[#050c14] px-2 text-right font-black text-cyan-200 shadow-[-8px_0_12px_rgba(3,9,16,.75)]" style={{ width: CURRENT_GEX_WIDTH }} data-current-gex-column="header">CURRENT GEX</div>
                </div>

                <div className="flex">
                  <div className="sticky left-0 z-30 shrink-0 bg-[#050c14]" style={{ width: STRIKE_WIDTH }}>
                    <div className="relative" style={{ height: matrixHeight }}>
                      {displayPressure!.rows.map((row) => (
                        <div key={row.strike} className="flex items-center border-b border-[#102433] px-2 font-black tabular-nums text-cyan-300" style={{ height: ROW_HEIGHT }}>
                          {strikeFormatter.format(row.strike)}
                        </div>
                      ))}
                      {chartGeometry?.spotGuide && (
                        <div
                          key={spotPulseKey || "spot-guide"}
                          className="spx-spot-live-pulse pointer-events-none absolute left-0 z-40 flex w-full -translate-y-1/2 items-center justify-between border-y border-cyan-300/70 bg-[#04222c] px-1.5 py-0.5 text-[9px] font-black text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,.18)]"
                          style={{ top: chartGeometry.spotGuide.y }}
                          data-spx-gex-pressure-spot-marker="true"
                        >
                          <span>SPOT</span><span>{spotFormatter.format(chartGeometry.spotGuide.price)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative shrink-0" style={{ width: matrixWidth, height: matrixHeight }}>
                    {displayPressure!.rows.map((row) => (
                      <div key={row.strike} className="flex" style={{ height: ROW_HEIGHT }}>
                        {row.cells.map((cell, columnIndex) => {
                          const slot = displayPressure!.timeline[columnIndex];
                          const key = `${row.strike}-${cell.snapshotMinuteEt}`;
                          const isActive = activeCell?.key === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              className="relative z-10 flex shrink-0 items-center justify-center border-b border-l border-[#102433] font-black transition-[filter] hover:brightness-150 focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                              style={{ width: effectiveCellWidth, minWidth: effectiveCellWidth, height: ROW_HEIGHT, minHeight: ROW_HEIGHT, background: cellBackground(cell, slot.status !== "READY"), color: stateColor(cell.state, cell.currentGex) }}
                              onMouseEnter={(event) => {
                                if (!hoverSuppressedAfterScrollRef.current) activateCell(event.currentTarget, row.strike, cell, false);
                              }}
                              onMouseLeave={() => {
                                hoverSuppressedAfterScrollRef.current = false;
                                clearTransientCell();
                              }}
                              onPointerMove={(event) => {
                                if (!hoverSuppressedAfterScrollRef.current) return;
                                hoverSuppressedAfterScrollRef.current = false;
                                activateCell(event.currentTarget, row.strike, cell, false);
                              }}
                              onFocus={(event) => {
                                hoverSuppressedAfterScrollRef.current = false;
                                activateCell(event.currentTarget, row.strike, cell, false);
                              }}
                              onBlur={clearTransientCell}
                              onClick={(event) => activateCell(event.currentTarget, row.strike, cell, true)}
                              aria-label={`${slot.snapshotTimeEt} ET, strike ${strikeFormatter.format(row.strike)}, ${stateLabel[cell.state]}`}
                              aria-describedby={isActive ? TOOLTIP_ID : undefined}
                              data-pressure-cell="true"
                              data-pressure-column-status={slot.status}
                            >
                              {stateGlyph(cell.state)}
                            </button>
                          );
                        })}
                      </div>
                    ))}

                    <svg
                      className="pointer-events-none absolute inset-0 z-20 overflow-visible"
                      width={matrixWidth}
                      height={matrixHeight}
                      aria-hidden="true"
                      data-spx-gex-pressure-spot-line="true"
                      data-spx-gex-pressure-spot-resolution={chartGeometry?.resolution || "15m-fallback"}
                      data-spx-gex-pressure-spot-point-count={chartGeometry?.pointCount || 0}
                    >
                       {chartGeometry?.spotGuide && <line key={`${spotPulseKey || "spot"}:guide`} className="spx-spot-live-pulse" x1="0" x2={matrixWidth} y1={chartGeometry.spotGuide.y} y2={chartGeometry.spotGuide.y} stroke="#22d3ee" strokeWidth="1" strokeDasharray="5 4" opacity="0.72" data-spx-gex-pressure-spot-guide="true" />}
                       {chartGeometry?.expectedMoveRange && <>
                         <line x1="0" x2={matrixWidth} y1={chartGeometry.expectedMoveRange.upper.y} y2={chartGeometry.expectedMoveRange.upper.y} stroke="#c4b5fd" strokeWidth="1" strokeDasharray="3 4" opacity="0.88" data-spx-gex-pressure-expected-move-upper="true" />
                         <line x1="0" x2={matrixWidth} y1={chartGeometry.expectedMoveRange.lower.y} y2={chartGeometry.expectedMoveRange.lower.y} stroke="#c4b5fd" strokeWidth="1" strokeDasharray="3 4" opacity="0.88" data-spx-gex-pressure-expected-move-lower="true" />
                       </>}
                      {chartGeometry?.segments.map((segment, index) => (
                        <polyline key={index} points={segment.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#22d3ee" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
                      ))}
                      {chartGeometry?.latestPoint && <circle key={`${spotPulseKey || "spot"}:endpoint`} className="spx-spot-live-pulse" cx={chartGeometry.latestPoint.x} cy={chartGeometry.latestPoint.y} r="4" fill="#ecfeff" stroke="#22d3ee" strokeWidth="2" data-spx-gex-pressure-spot-endpoint="true" />}
                    </svg>
                    <span className="sr-only">{usingOneMinuteSpot ? "SPX 1-minute price overlay" : "SPX 15-minute canonical snapshot fallback overlay"}{chartGeometry?.expectedMoveRange ? ` with 0DTESPX expected move plus or minus ${chartGeometry.expectedMoveRange.value}` : ""}</span>
                  </div>

                  <div className="sticky right-0 z-30 shrink-0 bg-[#050c14] shadow-[-8px_0_12px_rgba(3,9,16,.75)]" style={{ width: CURRENT_GEX_WIDTH }} data-current-gex-column="body">
                    {displayPressure!.rows.map((row) => (
                      <div key={row.strike} className={`flex items-center justify-end border-b border-[#102433] px-2 text-right font-black tabular-nums ${(row.currentGex || 0) >= 0 ? "text-green-300" : "text-pink-300"}`} style={{ height: ROW_HEIGHT }}>
                        {compact(row.currentGex, true)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <MoverTape movers={pressure.movers} latestTime={pressure.latest.snapshotTimeEt} matrixHeight={matrixGridHeight} />
          </div>

          {activeCell && (
            <SpxGexTooltip id={TOOLTIP_ID} anchor={activeCell.anchor} width={TOOLTIP_WIDTH} estimatedHeight={TOOLTIP_HEIGHT} surface="pressure" interactive={activeCell.locked}>
              <PressureCellDetail activeCell={activeCell} slot={activeSlot} spotPoint={activeSpotPoint} spotProvider={priceOverlay?.data?.source.provider || "source"} />
            </SpxGexTooltip>
          )}

          <SpxGexInlineTooltip surface="pressure">
            {activeCell ? <PressureCellDetail activeCell={activeCell} slot={activeSlot} spotPoint={activeSpotPoint} spotProvider={priceOverlay?.data?.source.provider || "source"} /> : (
              <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500"><TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />Tap a pressure cell for exact delayed-time evidence.</div>
            )}
          </SpxGexInlineTooltip>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#123142] bg-[#030910] px-3 py-2 font-mono text-[10px] text-zinc-500">
            <div className="flex flex-wrap gap-3">
              <span className="text-green-300">■ Positive GEX</span><span className="text-pink-300">■ Negative GEX</span><span className="text-white">+ Stronger</span><span>− Weaker</span><span className="text-amber-300">↔ Flip</span><span className="text-cyan-300">━ SPX</span><span className="text-violet-200">┄ Expected Move</span>
            </div>
            <span className="tabular-nums">{pressure.source.provider} / baseline {pressure.baseline.snapshotTimeEt} ET / collected {pressure.baseline.collectedTimeEt} ET</span>
          </div>
        </>
      )}
    </section>
  );
}

const PressureCellDetail = ({
  activeCell,
  slot,
  spotPoint,
  spotProvider,
}: {
  activeCell: ActiveCell;
  slot: SpxGexPressureMatrixModel["timeline"][number] | null;
  spotPoint: { price: number; timeEt: string } | null;
  spotProvider: string;
}) => (
  <div className="space-y-1.5 tabular-nums">
    <div className="font-black text-white">{slot?.snapshotTimeEt || "Unknown"} ET / {strikeFormatter.format(activeCell.strike)} / <span style={{ color: stateColor(activeCell.cell.state, activeCell.cell.currentGex) }}>{stateLabel[activeCell.cell.state]}</span></div>
    <div>Market {slot?.snapshotTimeEt || "missing"} ET / Collected {slot?.collectedTimeEt || "missing"} ET</div>
    <div>Baseline {compact(activeCell.cell.baselineGex, true)} → Current {compact(activeCell.cell.currentGex, true)}</div>
    <div>Δ {compact(activeCell.cell.deltaGex, true)} / Strength {formatPercent(activeCell.cell.strengthPct)} / Intensity {activeCell.cell.intensityPct}%</div>
    <div className="border-t border-white/10 pt-1.5 text-cyan-100">GEX snapshot SPX {activeCell.cell.spot === null ? "n/a" : spotFormatter.format(activeCell.cell.spot)}</div>
    <div className="text-cyan-300">{spotProvider.toUpperCase()} 1m context {spotPoint ? `${spotFormatter.format(spotPoint.price)} at ${spotPoint.timeEt} ET` : "unavailable at this minute"}</div>
    {activeCell.locked && <div className="text-zinc-500">Pinned / press Escape to dismiss</div>}
  </div>
);
