import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptySpxBoard, parseSpxBoardResponse, spxFailureMessage, type SpxGexHeatmapResponse } from "@/lib/spx-board-response";
import { SafeJsonResponseError } from "@/lib/safe-json-response";
import { runSpxRequest, SpxRequestTimeoutError } from "@/lib/spx-request-lane";
import { getEarlyCloseMarketHolidayKeys, isNyseTradingDay } from "@/lib/nyse-calendar";
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

export type SpxGexBoardNavigationMode = "latest" | "pinned";
type SpxGexBoardLoadMode = SpxGexBoardNavigationMode | "legacy";


export const parseSpxGexBoardSelection = (hash: string) => {
  const query = hash.split("?", 2)[1] || "";
  const params = new URLSearchParams(query);
  const rawSnapshot = params.get("snapshot");
  const snapshot = rawSnapshot === null || rawSnapshot.trim() === "" ? Number.NaN : Number(rawSnapshot);
  const requestedMode = params.get("mode");
  const date = params.get("date") || "";
  const mode: SpxGexBoardLoadMode = requestedMode === "latest" || requestedMode === "pinned"
    ? requestedMode
    : date || Number.isInteger(snapshot) ? "legacy" : "latest";
  return {
    date,
    snapshot: Number.isInteger(snapshot) ? snapshot : null,
    mode,
  };
};

export const resolveSpxGexBoardNavigationMode = (
  requestedMode: SpxGexBoardLoadMode,
  payload: Pick<SpxGexHeatmapResponse, "availableDates" | "selectedDate" | "selectedSnapshot" | "sessions">,
): SpxGexBoardNavigationMode => {
  if (requestedMode !== "legacy") return requestedMode;
  const latestDate = payload.availableDates.reduce<string | null>(
    (latest, date) => latest === null || date > latest ? date : latest,
    null,
  );
  const latestSnapshotMinute = payload.sessions.reduce<number | null>(
    (latest, session) => latest === null || session.snapshotMinuteEt > latest ? session.snapshotMinuteEt : latest,
    null,
  );
  return latestDate !== null
    && payload.selectedDate === latestDate
    && latestSnapshotMinute !== null
    && payload.selectedSnapshot?.snapshotMinuteEt === latestSnapshotMinute
    ? "latest"
    : "pinned";
};

const spxGexBoardHash = (mode: SpxGexBoardNavigationMode, date: string, snapshotMinuteEt: number) => mode === "latest"
  ? "#/work/spx-gex-heatmap?mode=latest"
  : `#/work/spx-gex-heatmap?mode=pinned&date=${encodeURIComponent(date)}&snapshot=${snapshotMinuteEt}`;

const initialBoardSelection = () => {
  if (typeof window === "undefined") {
    return { date: "", snapshot: null as number | null, mode: "latest" as const };
  }
  return parseSpxGexBoardSelection(window.location.hash);
};

export const currentEtClock = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { tradingDate: `${parts.year}-${parts.month}-${parts.day}`, minuteEt: Number(parts.hour) * 60 + Number(parts.minute) };
};


export function useSpxGexBoard() {
  const initialSelection = useMemo(initialBoardSelection, []);
  const [data, setData] = useState<SpxGexHeatmapResponse>(emptySpxBoard);
  const [selectedDate, setSelectedDate] = useState(initialSelection.date);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(initialSelection.snapshot);
  const [loading, setLoading] = useState(true);
  const [requestState, setRequestState] = useState<BoardRequestState>({
    phase: "LOADING",
    requestUrl: "/api/spx-gex-heatmap",
    httpStatus: null,
    errorCode: null,
    message: null,
  });
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(900);

  const [pressureRefreshKey, setPressureRefreshKey] = useState(0);
  const [initialHeatmapSettled, setInitialHeatmapSettled] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [navigationMode, setNavigationMode] = useState<SpxGexBoardNavigationMode | "resolving">(
    initialSelection.mode === "legacy" ? "resolving" : initialSelection.mode,
  );
  const [failedPlayback, setFailedPlayback] = useState<FailedPlaybackSnapshot | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const navigationModeRef = useRef<SpxGexBoardLoadMode>(initialSelection.mode);
  const postCloseGexRevalidationDateRef = useRef<string | null>(null);
  const automaticReadRef = useRef({ date: "", failures: 0 });
  const requestPendingRef = useRef(false);
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


  const commitNavigationMode = useCallback((mode: SpxGexBoardNavigationMode) => {
    navigationModeRef.current = mode;
    setNavigationMode(mode);
  }, []);

  const loadHeatmap = useCallback(async (
    date?: string,
    snapshotMinute?: number | null,
    options: { playback?: boolean; navigationMode?: SpxGexBoardLoadMode; automatic?: boolean } = {},
  ) => {
    if (!options.automatic) automaticReadRef.current = { date: currentEtClock().tradingDate, failures: 0 };
    const requestedNavigationMode = options.navigationMode || navigationModeRef.current;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestVersion = ++requestVersionRef.current;
    requestPendingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (snapshotMinute !== null && snapshotMinute !== undefined) params.set("snapshot", String(snapshotMinute));
      const requestUrl = `/api/spx-gex-heatmap${params.toString() ? `?${params.toString()}` : ""}`;
      setRequestState({ phase: "LOADING", requestUrl, httpStatus: null, errorCode: null, message: null });
      const response = await runSpxRequest((attemptSignal) => fetch(requestUrl, { signal: attemptSignal }), {
        signal: controller.signal,
        onRetry: () => setReconnecting(true),
      });
      const payload = await parseSpxBoardResponse<SpxGexHeatmapResponse>(response, requestUrl, "heatmap");
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return "STALE";
      if (response.ok && payload.status === "READY" && ((date && payload.selectedDate !== date)
        || (snapshotMinute != null && payload.selectedSnapshot?.snapshotMinuteEt !== snapshotMinute))) {
        throw new SafeJsonResponseError("Snapshot response does not match the requested selection.", response.status, response.headers.get("content-type") || "", response.headers.get("cf-ray"), "SCHEMA_INVALID");
      }

      if (!response.ok || ["ERROR", "BINDING_MISSING", "STORAGE_UNAVAILABLE"].includes(payload.status)) {
        setRequestState({
          phase: "ERROR",
          requestUrl,
          httpStatus: response.status,
          errorCode: payload.errorCode,
          message: spxFailureMessage(response.status),
        });
        if (options.playback && date && snapshotMinute !== null && snapshotMinute !== undefined) {
          setFailedPlayback({ date, snapshotMinuteEt: snapshotMinute });
        }
        setPlaying(false);
        return "FAILED";
      }

      if (payload.status !== "READY" || !payload.heatmap) {
        setData(current => current.heatmap ? current : payload);
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
        const resolvedNavigationMode = resolveSpxGexBoardNavigationMode(requestedNavigationMode, payload);
        commitNavigationMode(resolvedNavigationMode);
        window.history.replaceState(
          null,
          "",
          spxGexBoardHash(resolvedNavigationMode, payload.selectedDate, payload.selectedSnapshot.snapshotMinuteEt),
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
        errorCode: err instanceof SafeJsonResponseError ? err.code : err instanceof SpxRequestTimeoutError ? "REQUEST_TIMEOUT" : "TRANSPORT_ERROR",
        message: spxFailureMessage(httpStatus),
      });
      if (options.playback && date && snapshotMinute !== null && snapshotMinute !== undefined) {
        setFailedPlayback({ date, snapshotMinuteEt: snapshotMinute });
      }
      setPlaying(false);
      return "FAILED";
    } finally {
      if (requestVersion === requestVersionRef.current) {
        requestPendingRef.current = false;
        setLoading(false);
        setReconnecting(false);
      }
    }
  }, [commitNavigationMode]);

  useEffect(() => {
    const loadLatest = initialSelection.mode === "latest";
    void loadHeatmap(
      loadLatest ? undefined : initialSelection.date || undefined,
      loadLatest ? null : initialSelection.snapshot,
      { navigationMode: initialSelection.mode },
    ).finally(() => setInitialHeatmapSettled(true));
    return () => activeRequestRef.current?.abort();
  }, [initialSelection.date, initialSelection.mode, initialSelection.snapshot, loadHeatmap]);


  useEffect(() => {
    if (!initialHeatmapSettled || navigationMode !== "latest" || playing) return undefined;
    const refreshVisibleCurrentSession = () => {
      const clock = currentEtClock();
      if (document.visibilityState !== "visible" || requestPendingRef.current || !isNyseTradingDay(clock.tradingDate)) return;
      if (automaticReadRef.current.date !== clock.tradingDate) automaticReadRef.current = { date: clock.tradingDate, failures: 0 };
      if (automaticReadRef.current.failures >= 3) return;
      const closeMinute = getEarlyCloseMarketHolidayKeys(Number(clock.tradingDate.slice(0, 4))).has(clock.tradingDate) ? 780 : 960;
      const isLiveSession = clock.minuteEt >= 570 && clock.minuteEt <= closeMinute + 15;
      const needsPostCloseRevalidation = clock.minuteEt > closeMinute + 15 && postCloseGexRevalidationDateRef.current !== clock.tradingDate;
      if (!isLiveSession && !needsPostCloseRevalidation) return;
      if (needsPostCloseRevalidation) postCloseGexRevalidationDateRef.current = clock.tradingDate;
      // An undated read is required here: a dated read can never discover the
      // first canonical GEX snapshot after an ET trading-date rollover.
      automaticReadRef.current.failures += 1;
      void loadHeatmap(undefined, null, { navigationMode: "latest", automatic: true }).then((result) => {
        if (result === "READY") automaticReadRef.current.failures = 0;
        // Pressure is canonical D1 GEX and follows only the latest-GEX path.
        // Current-session 0DTESPX revalidation is deliberately independent.
        if (result !== "STALE") setPressureRefreshKey((current) => current + 1);
      });
    };
    const interval = window.setInterval(refreshVisibleCurrentSession, 60_000);
    document.addEventListener("visibilitychange", refreshVisibleCurrentSession);
    // The live interval is intentionally not fired on mount. After close,
    // however, a background tab must obtain the completed same-day snapshot.
    if (currentEtClock().minuteEt > 975) refreshVisibleCurrentSession();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisibleCurrentSession);
    };
  }, [initialHeatmapSettled, loadHeatmap, navigationMode, playing]);

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
        const result = await loadHeatmap(state.selectedDate, next.snapshotMinuteEt, { playback: true, navigationMode: "pinned" });
        if (result !== "READY" || playbackRunRef.current !== runId) return;
      }
    };
    void runPlayback();
    return () => {
      cancelled = true;
      if (playbackRunRef.current === runId) playbackRunRef.current += 1;
    };
  }, [loadHeatmap, playing]);


  return {data, selectedDate, selectedMinute, loading, requestState, playing, setPlaying, speedMs, setSpeedMs, pressureRefreshKey, initialHeatmapSettled, reconnecting, navigationMode, failedPlayback, loadHeatmap, commitNavigationMode, activeRequestRef};
}
