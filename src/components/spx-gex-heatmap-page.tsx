import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, Gauge, Pause, Play, RefreshCw, Waves } from "lucide-react";
import { buildSpxGexHeatmapReadingContext, formatSpxGexCompactExposure, type SpxGexHeatmapCell, type SpxGexHeatmapModel, type SpxGexHeatmapReadingRule, type SpxGexSessionSummary, type SpxGexStrikeProfile } from "@/lib/spx-gex-heatmap";
import type { SpxDecisionCockpitProjection } from "@/lib/spx-decision-ledger";
import type { SpxGexCollectionRecord } from "@/lib/spx-gex-collection-lifecycle";
import { parseJsonResponse, SafeJsonResponseError } from "@/lib/safe-json-response";
import { getSpxSpotLivePulseKey } from "@/lib/spx-spot-live-pulse";
import { runSpxRequest } from "@/lib/spx-request-lane";
import { SpxPriceActionCompass } from "./spx-price-action-compass";
import { SpxGexPressureMatrix } from "./spx-gex-pressure-matrix";
import { SpxGexInlineTooltip, SpxGexTooltip, SpxGexTooltipSection } from "./spx-gex-tooltip";

interface SpxGexHeatmapResponse {
  status: "READY" | "EMPTY" | "BINDING_MISSING" | "STORAGE_UNAVAILABLE" | "ERROR";
  errorCode: string | null;
  error?: string;
  availableDates: string[];
  selectedDate: string | null;
  sessions: SpxGexSessionSummary[];
  selectedSnapshot: SpxGexSessionSummary | null;
  heatmap: SpxGexHeatmapModel | null;
  decision: SpxDecisionCockpitProjection | null;
  collection: SpxGexCollectionRecord | null;
  collectionHealth?: {
    dueSlots: number;
    persistedSlots: number;
    provider: string | null;
    stage: string | null;
    failure: string | null;
  } | null;
  warnings: string[];
}

interface SPXGexHeatmapPageProps {
  onBackToWork: () => void;
}

const emptyPayload: SpxGexHeatmapResponse = {
  status: "EMPTY",
  errorCode: null,
  availableDates: [],
  selectedDate: null,
  sessions: [],
  selectedSnapshot: null,
  heatmap: null,
  decision: null,
  collection: null,
  warnings: [],
};

type BoardRequestPhase = "LOADING" | "READY" | "EMPTY" | "ERROR";

interface BoardRequestState {
  phase: BoardRequestPhase;
  requestUrl: string;
  httpStatus: number | null;
  errorCode: string | null;
  message: string | null;
}

interface FailedPlaybackSnapshot {
  date: string;
  snapshotMinuteEt: number;
}

interface ActiveGexAuditCell {
  key: string;
  cell: SpxGexHeatmapCell;
  anchor: { left: number; top: number; width: number; height: number };
  locked: boolean;
}

const GEX_AUDIT_TOOLTIP_ID = "spx-gex-board-cell-tooltip";

const sourceModeLabel = () => {
  const mode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
  if (mode === "spx-uat") return "LOCAL FIXTURE";
  if (mode === "spx-live") return "LIVE PRODUCTION READ-ONLY";
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) return "LOCAL D1";
  return "LIVE PRODUCTION READ-ONLY";
};

const formatCompact = (value: number | null | undefined) => {
  return formatSpxGexCompactExposure(value, { missingLabel: "n/a" });
};

const formatSignedCompact = (value: number | null | undefined) => {
  return formatSpxGexCompactExposure(value, { signed: true, missingLabel: "n/a" });
};

const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
};

const formatNumber = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const formatYears = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toFixed(6);
};

const formatIvSource = (source: string | null | undefined) => source ? source.replace(/_/g, " ") : "n/a";

const cellDisplayLabel = (cell: SpxGexHeatmapCell | undefined) => {
  if (!cell) return "-";
  if (typeof cell.netGex === "number" && Number.isFinite(cell.netGex)) return formatCompact(cell.netGex);
  if (cell.callIvSource === "excluded_low_time_value" || cell.putIvSource === "excluded_low_time_value") return "excluded";
  if (cell.pricingQuality === "unpriced") return "unpriced";
  return "no-data";
};

const cellBadges = (cell: SpxGexHeatmapCell | undefined) => {
  if (!cell || typeof cell.netGex !== "number" || !Number.isFinite(cell.netGex)) return [];
  const badges: string[] = [];
  if (cell.pricingQuality === "repaired") badges.push("R");
  if (cell.pricingQuality === "partial") badges.push("partial");
  return badges;
};

const cellAuditLines = (cell: SpxGexHeatmapCell | undefined) => {
  if (!cell) return [];
  const priced = typeof cell.netGex === "number" && Number.isFinite(cell.netGex);
  return [
    `Strike ${cell.strike} ${cell.expdate}`,
    `Quality ${cell.pricingQuality || "legacy"} / Model ${cell.model || "none"}`,
    `Included series ${(cell.activeSeries || []).join(", ") || "legacy / unavailable"}`,
    ...((cell.inactiveSeries || []).map((series) => `Inactive ${series} / AM-settled after 09:30 ET`)),
    priced
      ? `Net GEX ${formatSignedCompact(cell.netGex)} = Call ${formatSignedCompact(cell.callGex)} + Put ${formatSignedCompact(cell.putGex)}`
      : `State ${cellDisplayLabel(cell)}`,
    `Gamma IV ${formatPercent(cell.gammaIvPercent)}`,
    `Call IV raw ${formatNumber(cell.callRawIv)} -> ${formatPercent(cell.callIvPercent)} (${formatIvSource(cell.callIvSource)})`,
    `Put IV raw ${formatNumber(cell.putRawIv)} -> ${formatPercent(cell.putIvPercent)} (${formatIvSource(cell.putIvSource)})`,
    `Call bid/ask/last ${formatNumber(cell.callBid)} / ${formatNumber(cell.callAsk)} / ${formatNumber(cell.callLastPrice)}`,
    `Put bid/ask/last ${formatNumber(cell.putBid)} / ${formatNumber(cell.putAsk)} / ${formatNumber(cell.putLastPrice)}`,
    `Call OI ${formatNumber(cell.callOpenInterest)} / Put OI ${formatNumber(cell.putOpenInterest)}`,
    `Effective OI C ${formatNumber(cell.callEffectiveOpenInterest)} / P ${formatNumber(cell.putEffectiveOpenInterest)}`,
    `DTE ${formatNumber(cell.dteHours)}h / t=${formatYears(cell.yearsToExpiry)}`,
    `Formula: Net = Call gamma(gamma IV) - Put gamma(gamma IV)`,
    ...(cell.repairNotes?.length ? cell.repairNotes.map((note) => `Audit: ${note}`) : []),
    ...(cell.missingReasons?.length ? [`Audit flags: ${cell.missingReasons.join(", ")}`] : []),
    `Calculated @ ${cell.calculationTimestamp || "-"}`,
  ].filter(Boolean);
};

const cellStyle = (value: number | null | undefined, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return { backgroundColor: "#07111a", color: "#526171" };
  const strength = Math.min(1, Math.abs(value) / Math.max(1, max));
  if (value >= 0) {
    const green = Math.round(52 + 175 * strength);
    return { backgroundColor: `rgb(${Math.round(12 + 48 * strength)}, ${green}, ${Math.round(46 + 28 * strength)})`, color: "#f7fff8" };
  }
  const red = Math.round(88 + 178 * strength);
  return { backgroundColor: `rgb(${red}, ${Math.round(28 + 34 * strength)}, ${Math.round(46 + 28 * strength)})`, color: "#fff7f7" };
};

const cellStyleForCell = (cell: SpxGexHeatmapCell | undefined, max: number) => {
  if (!cell) return { backgroundColor: "#04101a", color: "#334454" };
  if (typeof cell.netGex === "number" && Number.isFinite(cell.netGex)) return cellStyle(cell.netGex, max);
  if (cell.pricingQuality === "unpriced") return { backgroundColor: "#151923", color: "#a7b0bd" };
  return { backgroundColor: "#07111a", color: "#526171" };
};

const exposureColor = (value: number) => value >= 0 ? "#d000d4" : "#20d6c8";

const exposureState = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "missing";
  if (value === 0) return "true-zero";
  return Math.abs(value) < 1 ? "threshold" : "reported";
};

const nearestStrike = (strikes: number[], spot: number | null | undefined) => {
  if (typeof spot !== "number" || !Number.isFinite(spot) || strikes.length === 0) return null;
  return strikes.reduce((nearest, strike) => (Math.abs(strike - spot) < Math.abs(nearest - spot) ? strike : nearest));
};

const tagClass = (severity: string) =>
  severity === "major"
    ? "border border-yellow-300/35 bg-yellow-300/15 text-yellow-100"
    : severity === "watch"
      ? "border border-pink-300/25 bg-pink-400/10 text-pink-100"
      : "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100";

type RowRangeMode = "auto" | "all";

const auditedProfiles = (heatmap: SpxGexHeatmapModel): SpxGexStrikeProfile[] => heatmap.strikeProfiles || [];

const dataQualityText = (heatmap: SpxGexHeatmapModel) => {
  const summary = heatmap.dataQuality;
  if (!summary) return "quality unavailable";
  const inactiveAm = heatmap.cells.reduce((sum, cell) => sum + (cell.inactiveSeries?.length || 0), 0);
  return `priced ${summary.priced} · repaired ${summary.repaired} · partial ${summary.partial} · unpriced ${summary.unpriced} · IV-excluded ${summary.excluded} · inactive AM ${inactiveAm}`;
};

const formatSnapshotMinuteEt = (minute: number) => {
  const hours = Math.floor(minute / 60).toString().padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

const parseHeatmapResponse = (response: Response, requestUrl: string) => parseJsonResponse<SpxGexHeatmapResponse & { error?: string }>(response, requestUrl);

export const parseSpxGexBoardSelection = (hash: string) => {
  const query = hash.split("?", 2)[1] || "";
  const params = new URLSearchParams(query);
  const rawSnapshot = params.get("snapshot");
  const snapshot = rawSnapshot === null || rawSnapshot.trim() === "" ? Number.NaN : Number(rawSnapshot);
  return {
    date: params.get("date") || "",
    snapshot: Number.isInteger(snapshot) ? snapshot : null,
  };
};

const initialBoardSelection = () => {
  if (typeof window === "undefined") return { date: "", snapshot: null as number | null };
  return parseSpxGexBoardSelection(window.location.hash);
};

const currentEtClock = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { tradingDate: `${parts.year}-${parts.month}-${parts.day}`, minuteEt: Number(parts.hour) * 60 + Number(parts.minute) };
};

export function SPXGexHeatmapPage({ onBackToWork }: SPXGexHeatmapPageProps) {
  const initialSelection = useMemo(initialBoardSelection, []);
  const [data, setData] = useState<SpxGexHeatmapResponse>(emptyPayload);
  const [selectedDate, setSelectedDate] = useState(initialSelection.date);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(initialSelection.snapshot);
  const [loading, setLoading] = useState(true);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [requestState, setRequestState] = useState<BoardRequestState>({
    phase: "LOADING",
    requestUrl: "/api/spx-gex-heatmap",
    httpStatus: null,
    errorCode: null,
    message: null,
  });
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(900);
  const [rowRangeMode, setRowRangeMode] = useState<RowRangeMode>("auto");
  const [activeAuditCell, setActiveAuditCell] = useState<ActiveGexAuditCell | null>(null);
  const [auditDetail, setAuditDetail] = useState<SpxGexHeatmapCell | null>(null);
  const [auditDetailKey, setAuditDetailKey] = useState<string | null>(null);
  const [auditDetailError, setAuditDetailError] = useState<string | null>(null);
  const activeAuditCellRef = useRef(activeAuditCell);
  const auditHoverSuppressedAfterScrollRef = useRef(false);
  activeAuditCellRef.current = activeAuditCell;
    const [pressureRefreshKey, setPressureRefreshKey] = useState(0);
    const [initialHeatmapSettled, setInitialHeatmapSettled] = useState(false);
    const [initialCompassSettled, setInitialCompassSettled] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
  const [isFollowingLatest, setIsFollowingLatest] = useState(initialSelection.snapshot === null);
  const [failedPlayback, setFailedPlayback] = useState<FailedPlaybackSnapshot | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const playbackRunRef = useRef(0);
  const playbackStateRef = useRef({
    sessions: data.sessions,
    selectedDate,
    selectedMinute,
    speedMs,
  });
  playbackStateRef.current = {
    sessions: data.sessions,
    selectedDate,
    selectedMinute,
    speedMs,
  };

  const loadHeatmap = useCallback(async (
    date?: string,
    snapshotMinute?: number | null,
    options: { playback?: boolean } = {},
  ) => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (snapshotMinute !== null && snapshotMinute !== undefined) params.set("snapshot", String(snapshotMinute));
      const requestUrl = `/api/spx-gex-heatmap${params.toString() ? `?${params.toString()}` : ""}`;
      setRequestState({ phase: "LOADING", requestUrl, httpStatus: null, errorCode: null, message: null });
      const response = await runSpxRequest(() => fetch(requestUrl, { signal: controller.signal }), {
        signal: controller.signal,
        onRetry: () => setReconnecting(true),
      });
      const payload = await parseHeatmapResponse(response, requestUrl);
      if (requestVersion !== requestVersionRef.current) return "STALE";

      if (!response.ok) {
        setRequestState({
          phase: "ERROR",
          requestUrl,
          httpStatus: response.status,
          errorCode: payload.errorCode,
          message: payload.error || "SPX GEX heatmap API failed",
        });
        if (options.playback && date && snapshotMinute !== null && snapshotMinute !== undefined) {
          setFailedPlayback({ date, snapshotMinuteEt: snapshotMinute });
        }
        setPlaying(false);
        return "FAILED";
      }

      if (payload.status !== "READY" || !payload.heatmap) {
        setRequestState({
          phase: "EMPTY",
          requestUrl,
          httpStatus: response.status,
          errorCode: payload.errorCode,
          message: "No retained canonical SPX GEX snapshot was returned.",
        });
        if (options.playback && date && snapshotMinute !== null && snapshotMinute !== undefined) {
          setFailedPlayback({ date, snapshotMinuteEt: snapshotMinute });
        }
        setPlaying(false);
        return "FAILED";
      }

      setData(payload);
      setRequestState({
        phase: "READY",
        requestUrl,
        httpStatus: response.status,
        errorCode: payload.errorCode,
        message: null,
      });
      setFailedPlayback(null);
      setSelectedDate(payload.selectedDate || "");
      setSelectedMinute(payload.selectedSnapshot?.snapshotMinuteEt ?? null);
      if (payload.selectedDate && payload.selectedSnapshot?.snapshotMinuteEt !== undefined) {
        window.history.replaceState(
          null,
          "",
          `#/work/spx-gex-heatmap?date=${encodeURIComponent(payload.selectedDate)}&snapshot=${payload.selectedSnapshot.snapshotMinuteEt}`,
        );
      }
      return "READY";
    } catch (err) {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return "STALE";
      const httpStatus = err instanceof SafeJsonResponseError ? err.httpStatus : null;
      setRequestState({
        phase: "ERROR",
        requestUrl: `/api/spx-gex-heatmap${date ? `?date=${encodeURIComponent(date)}${snapshotMinute !== null && snapshotMinute !== undefined ? `&snapshot=${snapshotMinute}` : ""}` : ""}`,
        httpStatus,
        errorCode: null,
        message: err instanceof Error ? err.message : "SPX GEX heatmap failed",
      });
      if (options.playback && date && snapshotMinute !== null && snapshotMinute !== undefined) {
        setFailedPlayback({ date, snapshotMinuteEt: snapshotMinute });
      }
      setPlaying(false);
      return "FAILED";
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
        setReconnecting(false);
      }
    }
  }, []);

  const refreshLatest = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setManualRefreshPending(true);
    setPlaying(false);
    setIsFollowingLatest(true);
    try {
      if (await loadHeatmap(undefined, null) === "READY") setPressureRefreshKey(Date.now());
    } finally {
      refreshInFlightRef.current = false;
      setManualRefreshPending(false);
    }
  }, [loadHeatmap]);

  useEffect(() => {
    void loadHeatmap(initialSelection.date || undefined, initialSelection.snapshot).finally(() => setInitialHeatmapSettled(true));
    return () => activeRequestRef.current?.abort();
  }, [initialSelection.date, initialSelection.snapshot, loadHeatmap]);

  useEffect(() => {
    if (!isFollowingLatest || playing || !selectedDate) return undefined;
    const refreshVisibleLiveSession = () => {
      const clock = currentEtClock();
      if (document.visibilityState !== "visible" || selectedDate !== clock.tradingDate || clock.minuteEt < 570 || clock.minuteEt > 975) return;
      void loadHeatmap(selectedDate, null).then((result) => {
        if (result === "READY") setPressureRefreshKey(Date.now());
      });
    };
    const interval = window.setInterval(refreshVisibleLiveSession, 60_000);
    document.addEventListener("visibilitychange", refreshVisibleLiveSession);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisibleLiveSession);
    };
  }, [isFollowingLatest, loadHeatmap, playing, selectedDate]);

  useEffect(() => {
    if (!playing) return undefined;
    const runId = ++playbackRunRef.current;
    let cancelled = false;
    const runPlayback = async () => {
      while (!cancelled && playbackRunRef.current === runId) {
        const current = playbackStateRef.current;
        if (current.sessions.length <= 1 || !current.selectedDate) {
          setPlaying(false);
          return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, current.speedMs));
        if (cancelled || playbackRunRef.current !== runId) return;

        const state = playbackStateRef.current;
        const currentIndex = Math.max(0, state.sessions.findIndex((session) => session.snapshotMinuteEt === state.selectedMinute));
        const next = state.sessions[(currentIndex + 1) % state.sessions.length];
        if (!next) {
          setPlaying(false);
          return;
        }
        const result = await loadHeatmap(state.selectedDate, next.snapshotMinuteEt, { playback: true });
        if (result !== "READY" || playbackRunRef.current !== runId) return;
      }
    };
    void runPlayback();
    return () => {
      cancelled = true;
      if (playbackRunRef.current === runId) playbackRunRef.current += 1;
    };
  }, [loadHeatmap, playing]);

  useEffect(() => {
    const dismissAuditTooltip = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveAuditCell(null);
    };
    window.addEventListener("keydown", dismissAuditTooltip);
    return () => window.removeEventListener("keydown", dismissAuditTooltip);
  }, []);

  useEffect(() => {
    const dismissOnOuterScroll = (event: Event) => {
      if (!activeAuditCellRef.current?.locked) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[data-spx-gex-tooltip-surface]')) return;
      auditHoverSuppressedAfterScrollRef.current = true;
      setActiveAuditCell(null);
    };
    window.addEventListener("scroll", dismissOnOuterScroll, true);
    document.addEventListener("scroll", dismissOnOuterScroll, true);
    return () => {
      window.removeEventListener("scroll", dismissOnOuterScroll, true);
      document.removeEventListener("scroll", dismissOnOuterScroll, true);
    };
  }, []);

  useEffect(() => setActiveAuditCell(null), [selectedDate, selectedMinute, rowRangeMode]);

  useEffect(() => {
    if (!activeAuditCell || !selectedDate || selectedMinute === null) {
      setAuditDetail(null);
      setAuditDetailKey(null);
      setAuditDetailError(null);
      return undefined;
    }
    const controller = new AbortController();
    setAuditDetail(null);
    setAuditDetailKey(null);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        date: selectedDate,
        snapshot: String(selectedMinute),
        strike: String(activeAuditCell.cell.strike),
        expiry: activeAuditCell.cell.expdate,
      });
      void (async () => {
        try {
          const response = await fetch(`/api/spx-gex-cell-detail?${params.toString()}`, { signal: controller.signal });
          const payload = await parseJsonResponse<{ status: string; detail: SpxGexHeatmapCell | null; error?: string }>(response, "/api/spx-gex-cell-detail");
          if (!response.ok || payload.status !== "READY" || !payload.detail) throw new Error(payload.error || "GEX audit detail is unavailable.");
          if (!controller.signal.aborted) {
            setAuditDetailKey(activeAuditCell.key);
            setAuditDetail(payload.detail);
            setAuditDetailError(null);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setAuditDetail(null);
            setAuditDetailError(error instanceof Error ? error.message : String(error));
          }
        }
      })();
    }, activeAuditCell.locked ? 0 : 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeAuditCell, selectedDate, selectedMinute]);

  const heatmap = data.heatmap;
  const cellByKey = useMemo(() => {
    const map = new Map<string, SpxGexHeatmapCell>();
    for (const cell of heatmap?.cells || []) map.set(`${cell.strike}:${cell.expdate}`, cell);
    return map;
  }, [heatmap?.cells]);
  const profiles = useMemo(() => heatmap ? auditedProfiles(heatmap) : [], [heatmap]);
  const profileByStrike = useMemo(() => new Map(profiles.map((row) => [row.strike, row])), [profiles]);
  const maxGex = useMemo(
    () => Math.max(1, ...(heatmap?.cells || []).map((cell) => Math.abs(cell.netGex || 0)), ...profiles.map((row) => Math.abs(row.netGex))),
    [heatmap?.cells, profiles],
  );
  const exposureMax = useMemo(() => ({
    dex: Math.max(1, ...profiles.map((row) => Math.abs(row.netDex))),
    vex: Math.max(1, ...profiles.map((row) => Math.abs(row.netVex))),
    cex: Math.max(1, ...profiles.map((row) => Math.abs(row.netCex))),
  }), [profiles]);
  const laneExposureAvailable = useMemo(() => ({
    dex: profiles.some((row) => Math.abs(row.netDex) > 0),
    vex: profiles.some((row) => Math.abs(row.netVex) > 0),
    cex: profiles.some((row) => Math.abs(row.netCex) > 0),
  }), [profiles]);
  const visibleStrikes = useMemo(() => {
    if (!heatmap || rowRangeMode === "all") return heatmap?.strikes || [];
    const spot = heatmap.quote.last;
    const autoStrikes = heatmap.strikes.filter((strike) => Math.abs(strike - spot) <= 100);
    return autoStrikes.length > 0 ? autoStrikes : heatmap.strikes;
  }, [heatmap, rowRangeMode]);
  const spotStrike = useMemo(() => nearestStrike(heatmap?.strikes || [], heatmap?.quote.last), [heatmap?.quote.last, heatmap?.strikes]);
  const summaryExposureAvailable = useMemo(() => ({
    dex: laneExposureAvailable.dex || Math.abs(heatmap?.zeroDte.netDex || 0) > 0,
    vex: laneExposureAvailable.vex || Math.abs(heatmap?.zeroDte.netVex || 0) > 0,
    cex: laneExposureAvailable.cex || Math.abs(heatmap?.zeroDte.netCex || 0) > 0,
  }), [
    heatmap?.zeroDte.netCex,
    heatmap?.zeroDte.netDex,
    heatmap?.zeroDte.netVex,
    laneExposureAvailable.cex,
    laneExposureAvailable.dex,
    laneExposureAvailable.vex,
  ]);
  const selectedSessionIndex = Math.max(0, data.sessions.findIndex((session) => session.snapshotMinuteEt === selectedMinute));
  const selectedSession = data.selectedSnapshot || heatmap?.session || null;
  const heatmapSpotPulseKey = useMemo(() => getSpxSpotLivePulseKey({
    price: heatmap?.quote.last,
    timeEt: selectedSession?.snapshotTimeEt,
    resolution: "15m-canonical",
  }), [heatmap?.quote.last, selectedSession?.snapshotTimeEt]);
  const isDelayedSnapshot = Boolean(
    selectedSession &&
    selectedSession.collectedMinuteEt !== undefined &&
    selectedSession.collectedMinuteEt !== selectedSession.snapshotMinuteEt,
  );
  const readingContext = useMemo(() => heatmap ? buildSpxGexHeatmapReadingContext(heatmap) : null, [heatmap]);
  const sourceText = heatmap
    ? `${isDelayedSnapshot ? `15-min delayed snapshot · collected ${selectedSession?.collectedTimeEt} ET. ` : ""}${heatmap.source.note}`
    : "";
  const activateAuditCell = useCallback((element: HTMLElement, cell: SpxGexHeatmapCell, locked: boolean) => {
    if (locked) auditHoverSuppressedAfterScrollRef.current = false;
    const key = `${cell.strike}:${cell.expdate}`;
    const rect = element.getBoundingClientRect();
    setActiveAuditCell((current) => {
      if (locked && current?.key === key && current.locked) return null;
      if (!locked && current?.locked) return current;
      return { key, cell, anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, locked };
    });
  }, []);
  const clearTransientAuditCell = useCallback(() => {
    setActiveAuditCell((current) => current?.locked ? current : null);
  }, []);
  const snapshotControls = (
    <div data-spx-gex-snapshot-controls="true" className="flex flex-wrap items-center gap-2">
      <label className="inline-flex h-10 items-center gap-2 border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-300">
        <CalendarDays aria-hidden="true" className="h-4 w-4 text-cyan-200" />
        <span className="sr-only">SPX GEX snapshot date</span>
        <select
          name="spx-gex-snapshot-date"
          aria-label="SPX GEX snapshot date"
          value={selectedDate}
          onChange={(event) => {
            setPlaying(false);
            setIsFollowingLatest(event.target.value === currentEtClock().tradingDate);
            void loadHeatmap(event.target.value, null);
          }}
          className="bg-[#06111a] text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
        >
          {data.availableDates.length === 0 ? (
            <option value="">No snapshots</option>
          ) : (
            data.availableDates.map((date) => (
              <option key={date} value={date} className="bg-[#111827] text-white">
                {date}
              </option>
            ))
          )}
        </select>
      </label>
      <button
        onClick={() => {
          setPlaying(false);
          setIsFollowingLatest(true);
          void refreshLatest();
        }}
        disabled={loading || manualRefreshPending}
        aria-busy={loading || manualRefreshPending}
        className="inline-flex h-10 w-10 items-center justify-center border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 transition-colors hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        title="Refresh latest SPX and GEX sources"
        aria-label="Refresh latest SPX and GEX sources"
      >
        <RefreshCw aria-hidden="true" className={`h-4 w-4 ${(loading || manualRefreshPending) ? "animate-spin motion-reduce:animate-none" : ""}`} />
      </button>
    </div>
  );

  return (
    <section className="h-full w-full overflow-y-auto bg-[#02070d] px-3 pb-8 pt-4 text-white sm:px-5 lg:px-7">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-cyan-400/20 pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <button
              onClick={onBackToWork}
              className="mb-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/70 transition-colors hover:text-cyan-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Work gallery
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-black tracking-normal text-white sm:text-4xl">SPX Market Structure Board</h1>
              <span className="border border-amber-300/30 bg-amber-300/10 px-2 py-1 font-mono text-[10px] font-black tracking-[0.12em] text-amber-100">
                {sourceModeLabel()}
              </span>
              {heatmap && (
                <span key={heatmapSpotPulseKey || "heatmap-spot"} className="spx-spot-live-pulse inline-flex items-center gap-1.5 border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-black text-cyan-100" data-spx-gex-heatmap-spot-badge="true">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_7px_rgba(34,211,238,.9)]" aria-hidden="true" />
                  Spot ${heatmap.quote.last.toFixed(2)}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              Source-backed price action, signal structure, and intraday GEX exposure in one board.
            </p>
          </div>

        </header>

        {failedPlayback && requestState.phase === "ERROR" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-red-300/30 bg-red-300/10 px-3 py-2 text-sm text-red-100" role="alert" data-spx-gex-playback-error="true">
            <span>
              Timeline paused at {formatSnapshotMinuteEt(failedPlayback.snapshotMinuteEt)} ET · HTTP {requestState.httpStatus ?? "network"}. Last verified board remains on screen.
            </span>
            <button
              onClick={() => {
                setPlaying(false);
                void loadHeatmap(failedPlayback.date, failedPlayback.snapshotMinuteEt);
              }}
              className="border border-red-200/40 bg-red-200/10 px-3 py-1 font-mono text-xs font-black uppercase tracking-[0.08em] text-red-50 transition-colors hover:bg-red-200/20"
            >
              Retry {formatSnapshotMinuteEt(failedPlayback.snapshotMinuteEt)}
            </button>
          </div>
        )}
        {reconnecting && <Notice tone="amber" text="Reconnecting SPX source…" />}
        {requestState.phase === "ERROR" && requestState.message && <Notice tone="red" text={requestState.message} />}
        {data.warnings.length > 0 && <Notice tone="amber" text={data.warnings.join(" ")} />}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border border-white/10 bg-black/20 px-3 py-2 font-mono text-[10px] text-zinc-500" data-spx-gex-request-state={requestState.phase}>
          <span>STATE <strong className="text-zinc-200">{requestState.phase}</strong></span>
          <span>SOURCE <strong className="text-zinc-200">{sourceModeLabel()}</strong></span>
          <span>HTTP <strong className="text-zinc-200">{requestState.httpStatus ?? "PENDING"}</strong></span>
          <span>CODE <strong className="text-zinc-200">{requestState.errorCode || "NONE"}</strong></span>
          <span className="break-all">REQUEST <strong className="text-zinc-200">{requestState.requestUrl}</strong></span>
        </div>

        <SpxPriceActionCompass enabled={initialHeatmapSettled} onInitialLoadSettled={() => setInitialCompassSettled(true)} />

        <SpxGexPressureMatrix
          selectedDate={selectedDate}
          selectedMinute={selectedMinute}
          refreshKey={pressureRefreshKey}
          enabled={initialCompassSettled}
          controls={snapshotControls}
        />

        {loading && !heatmap ? (
          <div className="flex h-72 items-center justify-center border border-white/10 bg-white/[0.03] text-sm uppercase tracking-[0.2em] text-zinc-500">
            Loading SPX GEX
          </div>
        ) : heatmap ? (
          <>
            <section className="overflow-hidden border border-[#123142] bg-[#030910]" data-spx-gex-board-shell="true">
            <header className="border-b border-[#123142] bg-[#04101a] p-3">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-2xl">
                  <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/70">Exposure board</div>
                  <h2 className="mt-1 text-xl font-black tracking-normal text-white">SPX Intraday GEX Board</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Strike-by-expiry GEX matrix with deterministic structure labels and DEX/VEX/CEX exposure lanes.
                  </p>
                </div>
              </div>
            </header>

            <div className="border-b border-[#123142] bg-[#06111a] p-3" data-spx-decision-cockpit="true">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/70">Decision cockpit</div>
                  <div className="mt-1 text-sm font-black leading-6 text-white">
                    {readingContext?.headline || "Market judgement unavailable for this snapshot."}
                  </div>
                </div>
                <div className="font-mono text-[10px] text-zinc-500">
                  GEX collection: <span className="font-black text-cyan-100">{data.collection?.currentStage || "NOT_RECORDED"}</span>
                  {data.collectionHealth && (
                    <span className="ml-2 tabular-nums text-zinc-400">
                      {data.collectionHealth.persistedSlots}/{data.collectionHealth.dueSlots} due persisted
                      {data.collectionHealth.provider ? ` / ${data.collectionHealth.provider}` : ""}
                    </span>
                  )}
                </div>
              </div>

              {data.decision ? (
                <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                    <CockpitMetric label="Run ID" value={data.decision.runId} />
                    <CockpitMetric
                      label="Council"
                      value={`C ${data.decision.councilTally.CALL} / P ${data.decision.councilTally.PUT} / H ${data.decision.councilTally.HOLD} / X ${data.decision.councilTally.INVALID ?? 0}`}
                    />
                    <CockpitMetric label="CIO" value={`${data.decision.cio.action || "NOT_RUN"} · ${data.decision.cio.confidence}/100`} />
                    <CockpitMetric label="Risk Gate" value={`${data.decision.riskGate.disposition} · ${data.decision.riskGate.action || "N/A"}`} />
                    <CockpitMetric label="Run stage" value={data.decision.currentStage} />
                    <CockpitMetric label="Delivery" value={`${data.decision.delivery.status}${data.decision.delivery.telegramMessageId ? ` · ${data.decision.delivery.telegramMessageId}` : ""}`} />
                  </div>
                  {(data.decision.councilAgents || []).length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4" data-spx-council-agents="true">
                      {(data.decision.councilAgents || []).map((agent) => (
                        <div key={agent.agent} className="border border-white/10 bg-black/20 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-black uppercase tracking-[0.08em]">
                            <span className={agent.valid ? "text-cyan-100" : "text-red-200"}>
                              {agent.agent} · {agent.valid ? agent.decision : "INVALID"} · {agent.confidence}/100
                            </span>
                            <span className="text-zinc-600">{agent.attempts.length} attempt{agent.attempts.length === 1 ? "" : "s"}</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-zinc-400">{agent.reasoning || "No auditable reasoning persisted."}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 font-mono text-[9px] font-black uppercase text-zinc-400" data-spx-run-lifecycle="true">
                    {data.decision.lifecycle.map((event) => (
                      <span key={`${event.stage}-${event.attempt}`} className="border border-white/10 bg-black/20 px-2 py-1">
                        {event.stage}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-zinc-400">
                    Risk reason: {data.decision.riskGate.reason} · Replay {data.decision.replayGrade}
                    {data.decision.degraded ? ` · DEGRADED: ${data.decision.degradedReason || "unspecified"}` : ""}
                  </div>
                </>
              ) : (
                <div className="mt-3 border border-dashed border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-500">
                  No decision run is linked to this canonical snapshot. GEX truth remains available; CIO and delivery status are not inferred.
                </div>
              )}

              <div className="mt-2 break-all font-mono text-[9px] leading-4 text-zinc-600">
                Snapshot {heatmap.canonical?.snapshotId || "legacy/no-id"} · {heatmap.canonical?.payloadHash || "hash unavailable"} · provider {heatmap.canonical?.provider || "unknown"}
              </div>
            </div>

            <div className="border-b border-[#123142] bg-[#06111a] p-3" data-spx-gex-playback-controls="true">
              <div
                className="mb-4 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin] sm:mb-3 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-5"
                aria-label="SPX GEX summary metrics"
              >
                <Metric label="Snapshot" value={heatmap.session?.snapshotTimeEt || "n/a"} />
                <Metric label="0DTE NetGEX" value={formatSignedCompact(heatmap.zeroDte.netGex)} />
                <Metric label="DEX" value={summaryExposureAvailable.dex ? formatSignedCompact(heatmap.zeroDte.netDex) : "-"} />
                <Metric label="VEX" value={summaryExposureAvailable.vex ? formatSignedCompact(heatmap.zeroDte.netVex) : "-"} />
                <Metric label="CEX" value={summaryExposureAvailable.cex ? formatSignedCompact(heatmap.zeroDte.netCex) : "-"} />
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <button
                  onClick={() => {
                    if (playing) {
                      setPlaying(false);
                      activeRequestRef.current?.abort();
                      return;
                    }
                    setIsFollowingLatest(false);
                    setPlaying(true);
                  }}
                  disabled={!playing && (loading || data.sessions.length <= 1)}
                  aria-label={playing ? "Pause GEX timeline" : "Play GEX timeline"}
                  className="inline-flex h-10 w-12 items-center justify-center border border-pink-400/30 bg-pink-400/15 text-pink-100 transition-colors hover:bg-pink-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                  title={playing ? "Pause timeline" : "Play timeline"}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <input
                    type="range"
                    aria-label="Select SPX GEX snapshot"
                    min={0}
                    max={Math.max(0, data.sessions.length - 1)}
                    value={selectedSessionIndex}
                    onChange={(event) => {
                      const next = data.sessions[Number(event.target.value)];
                      setPlaying(false);
                      setIsFollowingLatest(false);
                      if (next) void loadHeatmap(selectedDate, next.snapshotMinuteEt);
                    }}
                    className="w-full accent-cyan-300"
                  />
                  <div className="mt-1 flex justify-between gap-2 overflow-hidden font-mono text-[10px] font-black text-cyan-200/70">
                    {data.sessions.map((session) => (
                      <button
                        key={session.snapshotMinuteEt}
                        onClick={() => {
                          setPlaying(false);
                          setIsFollowingLatest(false);
                          void loadHeatmap(selectedDate, session.snapshotMinuteEt);
                        }}
                        className={session.snapshotMinuteEt === selectedMinute ? "text-yellow-300" : "text-cyan-200/55"}
                      >
                        {session.snapshotTimeEt}
                      </button>
                    ))}
                  </div>
                </div>
                <select
                  name="spx-gex-playback-speed"
                  aria-label="SPX GEX playback speed"
                  value={speedMs}
                  onChange={(event) => setSpeedMs(Number(event.target.value))}
                  className="h-10 border border-white/10 bg-[#08131d] px-3 text-sm font-bold text-white outline-none"
                >
                  <option value={1400}>1X</option>
                  <option value={900}>2X</option>
                  <option value={500}>3X</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto bg-[#030910]" data-spx-gex-heatmap-board="true" onScroll={() => setActiveAuditCell(null)}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#123142] bg-[#06111a] px-3 py-2">
                <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/70">
                  <span>{visibleStrikes.length} / {heatmap.strikes.length} strikes</span>
                  <span className="border-l border-cyan-300/20 pl-3 text-yellow-100/90">{dataQualityText(heatmap)}</span>
                </div>
                <div className="inline-flex h-9 items-center border border-cyan-300/20 bg-cyan-300/10 p-0.5">
                  {(["auto", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRowRangeMode(mode)}
                      className={`h-7 px-3 font-mono text-[11px] font-black uppercase transition-colors ${
                        rowRangeMode === mode ? "bg-cyan-200 text-[#03111a]" : "text-cyan-100 hover:bg-cyan-300/15"
                      }`}
                      aria-pressed={rowRangeMode === mode}
                    >
                      {mode === "auto" ? "Auto" : "All"}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full min-w-[1540px] table-fixed border-collapse font-mono text-[11px]">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <HeaderCell width="70px">STRIKE</HeaderCell>
                    {heatmap.selectedExpiries.map((expiry) => (
                      <HeaderCell key={expiry}>{expiry.slice(5)}</HeaderCell>
                    ))}
                    <HeaderCell width="76px">STRIKE</HeaderCell>
                    <HeaderCell width="365px">NET GEX / STRUCTURE</HeaderCell>
                    <HeaderCell width="220px">DEX</HeaderCell>
                    <HeaderCell width="220px">VEX</HeaderCell>
                    <HeaderCell width="220px">CEX</HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {visibleStrikes.map((strike) => {
                    const profile = profileByStrike.get(strike);
                    const isSpotStrike = strike === spotStrike;
                    return (
                      <tr key={isSpotStrike ? `${strike}:${heatmapSpotPulseKey || "spot"}` : strike} className={isSpotStrike ? "bg-yellow-400/10 spx-spot-live-row" : ""} data-spx-gex-heatmap-spot-row={isSpotStrike || undefined}>
                        <StrikeCell strike={strike} isSpotStrike={isSpotStrike} />
                        {heatmap.selectedExpiries.map((expiry) => {
                          const cell = cellByKey.get(`${strike}:${expiry}`);
                          const auditLines = cellAuditLines(cell);
                          return (
                            <td
                              key={`${strike}-${expiry}`}
                              className="relative border border-[#102433] p-0 text-right font-black tabular-nums"
                              style={cellStyleForCell(cell, maxGex)}
                              data-gex-audit-cell={cell ? "true" : undefined}
                              data-gex-value-state={exposureState(cell?.netGex)}
                              data-gex-pricing-quality={cell?.pricingQuality}
                            >
                              {cell ? (
                                <button
                                  type="button"
                                  className="flex h-full min-h-5 w-full items-center justify-end px-1.5 py-[2px] text-right hover:brightness-125 focus-visible:relative focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-100"
                                  onMouseEnter={(event) => {
                                    if (!auditHoverSuppressedAfterScrollRef.current) activateAuditCell(event.currentTarget, cell, false);
                                  }}
                                  onMouseLeave={() => {
                                    auditHoverSuppressedAfterScrollRef.current = false;
                                    clearTransientAuditCell();
                                  }}
                                  onPointerMove={(event) => {
                                    if (!auditHoverSuppressedAfterScrollRef.current) return;
                                    auditHoverSuppressedAfterScrollRef.current = false;
                                    activateAuditCell(event.currentTarget, cell, false);
                                  }}
                                  onFocus={(event) => {
                                    auditHoverSuppressedAfterScrollRef.current = false;
                                    activateAuditCell(event.currentTarget, cell, false);
                                  }}
                                  onBlur={clearTransientAuditCell}
                                  onClick={(event) => activateAuditCell(event.currentTarget, cell, true)}
                                  aria-label={`Strike ${cell.strike}, expiry ${cell.expdate}, ${auditLines[2] || cellDisplayLabel(cell)}`}
                                  aria-describedby={activeAuditCell?.key === `${cell.strike}:${cell.expdate}` ? GEX_AUDIT_TOOLTIP_ID : undefined}
                                  data-gex-audit-trigger="true"
                                >
                                  <span>{cellDisplayLabel(cell)}</span>
                                  {cellBadges(cell).map((badge) => (
                                    <span key={badge} className="ml-1 inline-flex h-3.5 items-center border border-white/20 bg-black/25 px-1 align-middle text-[8px] font-black uppercase text-white/90">
                                      {badge}
                                    </span>
                                  ))}
                                </button>
                              ) : <span className="block px-1.5 py-[2px]">{cellDisplayLabel(cell)}</span>}
                            </td>
                          );
                        })}
                        <StrikeCell strike={strike} isSpotStrike={isSpotStrike} />
                        <td className="border border-[#102433] bg-[#050c14] px-1.5 py-[2px]">
                          <div className="grid grid-cols-[150px_72px_1fr] items-center gap-2">
                            {typeof profile?.netGex === "number" && Number.isFinite(profile.netGex) ? <ExposureBar value={profile.netGex} max={maxGex} /> : <div className="h-2.5 bg-[#07111b]" />}
                            <span className="text-right font-black text-cyan-100">{formatSignedCompact(profile?.netGex)}</span>
                            <span className="flex min-h-4 flex-wrap items-center gap-1 overflow-hidden">
                              {isSpotStrike && (
                                <span key={heatmapSpotPulseKey || "heatmap-spot-pill"} className="spx-spot-live-pulse border border-yellow-300/45 bg-yellow-300/15 px-1 py-0 text-[9px] font-black text-yellow-100" data-spx-gex-heatmap-spot-pill="true">
                                  Spot ${heatmap.quote.last.toFixed(2)}
                                </span>
                              )}
                              {(profile?.tags || []).map((tag) => (
                                <span key={tag.type} className={`px-1 py-0 text-[9px] font-black ${tagClass(tag.severity)}`}>
                                  {tag.label}
                                </span>
                              ))}
                            </span>
                          </div>
                        </td>
                        <ExposureCell value={laneExposureAvailable.dex ? profile?.netDex : null} max={exposureMax.dex} />
                        <ExposureCell value={laneExposureAvailable.vex ? profile?.netVex : null} max={exposureMax.vex} />
                        <ExposureCell value={laneExposureAvailable.cex ? profile?.netCex : null} max={exposureMax.cex} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {activeAuditCell && (
                <SpxGexTooltip
                  id={GEX_AUDIT_TOOLTIP_ID}
                  anchor={activeAuditCell.anchor}
                  width={380}
                  estimatedHeight={520}
                  surface="board"
                  interactive={activeAuditCell.locked}
                >
                  <GexAuditCellDetail activeCell={activeAuditCell} detail={auditDetailKey === activeAuditCell.key ? auditDetail : null} detailError={auditDetailError} />
                </SpxGexTooltip>
              )}
              <SpxGexInlineTooltip surface="board">
                {activeAuditCell ? <GexAuditCellDetail activeCell={activeAuditCell} detail={auditDetailKey === activeAuditCell.key ? auditDetail : null} detailError={auditDetailError} /> : (
                  <div className="text-zinc-500">Tap a priced expiry cell for complete GEX audit evidence.</div>
                )}
              </SpxGexInlineTooltip>
            </div>
            </section>

            <section className="grid gap-3 text-xs text-zinc-400 lg:grid-cols-[1fr_360px]">
              {readingContext && (
                <div className="border border-[#123142] bg-[#050c14] p-3" data-gex-reading-context="true">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
                      Professional read
                    </div>
                    <span className="border border-yellow-300/30 bg-yellow-300/10 px-2 py-1 font-mono text-[10px] font-black uppercase text-yellow-100">
                      {readingContext.regime}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-black leading-6 text-white">{readingContext.headline}</div>
                  <div className="mt-1 leading-6 text-zinc-400">{heatmap.premarketInterpretation.paragraph}</div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {readingContext.rules.map((rule) => (
                      <GexReadingRuleCard key={rule.label} rule={rule} />
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <GexReadingList title="Playbook" items={readingContext.playbook} />
                    <GexReadingList title="Risk checks" items={readingContext.riskNotes} />
                  </div>
                </div>
              )}
              <div className="border border-[#123142] bg-[#050c14] p-3">
                <div className="mb-2 flex items-center gap-2 font-black uppercase tracking-[0.16em] text-cyan-200">
                  <Gauge className="h-4 w-4" />
                  Source
                </div>
                <div className="leading-6">{sourceText}</div>
              </div>
            </section>
          </>
        ) : (
          <div className="flex h-72 flex-col items-center justify-center gap-3 border border-white/10 bg-white/[0.03] text-center">
            <Waves className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-500">
              {requestState.phase === "ERROR" ? requestState.message || "SPX GEX request failed." : "No retained canonical SPX GEX snapshots found."}
            </p>
            {snapshotControls}
            <div className="max-w-4xl break-all font-mono text-[10px] leading-5 text-zinc-600">
              {sourceModeLabel()} · {requestState.requestUrl} · HTTP {requestState.httpStatus ?? "n/a"} · {requestState.errorCode || "no error code"}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const GexAuditCellDetail = ({ activeCell, detail, detailError }: {
  activeCell: ActiveGexAuditCell;
  detail: SpxGexHeatmapCell | null;
  detailError: string | null;
}) => {
  const cell = detail || activeCell.cell;
  const priced = typeof cell.netGex === "number" && Number.isFinite(cell.netGex);
  return (
    <div className="space-y-2">
      <SpxGexTooltipSection>
        <div className="flex items-start justify-between gap-3">
          <div className="font-black text-white">Strike {cell.strike} / {cell.expdate}</div>
          <span className="shrink-0 border border-cyan-300/30 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-cyan-100">
            {cell.pricingQuality || "legacy"}
          </span>
        </div>
        <div className="text-zinc-500">Model {cell.model || "none"}</div>
        <div className="text-cyan-200">Included {(cell.activeSeries || []).join(", ") || "legacy / unavailable"}</div>
        {(cell.inactiveSeries || []).map((series) => <div key={series} className="text-amber-200">Inactive {series} / AM-settled after 09:30 ET</div>)}
        {!detail && !detailError && <div className="text-zinc-500">Loading full audit evidence…</div>}
        {detailError && <div className="text-amber-200">Full audit unavailable: {detailError}</div>}
      </SpxGexTooltipSection>
      <SpxGexTooltipSection label="Exposure">
        {priced ? (
          <>
            <div className="font-black text-white">Net GEX {formatSignedCompact(cell.netGex)}</div>
            <div>Call {formatSignedCompact(cell.callGex)} / Put {formatSignedCompact(cell.putGex)}</div>
          </>
        ) : <div className="text-zinc-400">State {cellDisplayLabel(cell)}</div>}
      </SpxGexTooltipSection>
      <SpxGexTooltipSection label="Volatility Inputs">
        <div>Gamma IV {formatPercent(cell.gammaIvPercent)}</div>
        <div>Call IV {formatNumber(cell.callRawIv)} → {formatPercent(cell.callIvPercent)} / {formatIvSource(cell.callIvSource)}</div>
        <div>Put IV {formatNumber(cell.putRawIv)} → {formatPercent(cell.putIvPercent)} / {formatIvSource(cell.putIvSource)}</div>
      </SpxGexTooltipSection>
      <SpxGexTooltipSection label="Market Inputs">
        <div>Call bid / ask / last {formatNumber(cell.callBid)} / {formatNumber(cell.callAsk)} / {formatNumber(cell.callLastPrice)}</div>
        <div>Put bid / ask / last {formatNumber(cell.putBid)} / {formatNumber(cell.putAsk)} / {formatNumber(cell.putLastPrice)}</div>
        <div>Raw OI C {formatNumber(cell.callOpenInterest)} / P {formatNumber(cell.putOpenInterest)}</div>
        <div>Effective OI C {formatNumber(cell.callEffectiveOpenInterest)} / P {formatNumber(cell.putEffectiveOpenInterest)}</div>
      </SpxGexTooltipSection>
      <SpxGexTooltipSection label="Audit Trail">
        <div>DTE {formatNumber(cell.dteHours)}h / t={formatYears(cell.yearsToExpiry)}</div>
        <div>Formula: Net = Call gamma − Put gamma</div>
        {(cell.repairNotes || []).map((note) => <div key={note} className="text-amber-200">Audit: {note}</div>)}
        {(cell.missingReasons || []).length > 0 && <div className="text-red-200">Audit flags: {(cell.missingReasons || []).join(", ")}</div>}
        <div className="break-all text-zinc-500">Calculated {cell.calculationTimestamp || "n/a"}</div>
      </SpxGexTooltipSection>
      {activeCell.locked && <div className="text-zinc-500">Pinned / press Escape to dismiss</div>}
    </div>
  );
};

const Notice = ({ tone, text }: { tone: "red" | "amber"; text: string }) => (
  <div className={`flex items-center gap-2 border px-4 py-3 text-sm ${tone === "red" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
    <AlertTriangle className="h-4 w-4" />
    {text}
  </div>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="w-[42vw] min-w-[150px] max-w-[190px] shrink-0 snap-start border border-[#123142] bg-black/20 px-3 py-2 sm:w-auto sm:min-w-0 sm:max-w-none sm:shrink">
    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
    <div className="mt-1 truncate font-mono text-lg font-black text-white">{value}</div>
  </div>
);

const CockpitMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 border border-[#123142] bg-black/20 px-2.5 py-2">
    <div className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div>
    <div className="mt-1 truncate font-mono text-[11px] font-black text-cyan-50" title={value}>{value}</div>
  </div>
);

const readingRuleClass = (tone: SpxGexHeatmapReadingRule["tone"]) => {
  if (tone === "bullish") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (tone === "bearish") return "border-red-300/25 bg-red-400/10 text-red-100";
  if (tone === "watch") return "border-yellow-300/30 bg-yellow-300/10 text-yellow-100";
  return "border-cyan-300/20 bg-cyan-300/5 text-cyan-100";
};

const GexReadingRuleCard = ({ rule }: { rule: SpxGexHeatmapReadingRule }) => (
  <div className={`border p-2 ${readingRuleClass(rule.tone)}`} data-gex-reading-rule={rule.label}>
    <div className="font-mono text-[9px] font-black uppercase tracking-[0.14em] opacity-80">{rule.label}</div>
    <div className="mt-1 font-mono text-[11px] font-black text-white">{rule.value}</div>
    <div className="mt-1 leading-5 text-zinc-300">{rule.detail}</div>
  </div>
);

const GexReadingList = ({ title, items }: { title: string; items: string[] }) => (
  <div className="border border-[#123142] bg-black/20 p-2">
    <div className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-cyan-200/80">{title}</div>
    <div className="mt-2 grid gap-1.5">
      {items.map((item) => (
        <div key={item} className="grid grid-cols-[10px_1fr] gap-2 leading-5 text-zinc-300">
          <span className="mt-2 h-1.5 w-1.5 bg-cyan-300/70" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  </div>
);

const HeaderCell = ({ children, width }: { children: string; width?: string }) => (
  <th className="border border-[#102433] bg-[#07121c] px-1.5 py-1.5 text-center font-black text-cyan-300" style={{ width }}>
    {children}
  </th>
);

const StrikeCell = ({ strike, isSpotStrike }: { strike: number; isSpotStrike: boolean }) => (
  <th className={`border border-[#102433] px-1.5 py-[2px] text-right font-black tabular-nums ${isSpotStrike ? "bg-yellow-300/15 text-yellow-100" : "bg-[#06121c] text-cyan-300"}`}>
    {strike.toLocaleString("en-US", { maximumFractionDigits: 0 })}
  </th>
);

const ExposureBar = ({ value, max }: { value: number; max: number }) => {
  const width = `${Math.max(2, Math.min(100, (Math.abs(value) / Math.max(1, max)) * 100))}%`;
  return (
    <div className="h-2.5 overflow-hidden bg-[#07111b]">
      <div className="h-full" style={{ width, background: `linear-gradient(90deg, ${exposureColor(value)}, transparent)` }} />
    </div>
  );
};

const ExposureCell = ({ value, max }: { value: number | null | undefined; max: number }) => (
  <td className="border border-[#102433] bg-[#050c14] px-1.5 py-[2px]">
    <div className="grid grid-cols-[1fr_72px] items-center gap-2">
      {typeof value === "number" && Number.isFinite(value) ? <ExposureBar value={value} max={max} /> : <div className="h-2.5 bg-[#07111b]" />}
      <span className="text-right font-black tabular-nums text-cyan-50">{formatSignedCompact(value)}</span>
    </div>
  </td>
);
