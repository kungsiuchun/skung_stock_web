import {
  aggregateSpxOneMinutePriceActionCandles,
  isFreshSpx0DteSample,
  type SpxPriceActionCandle,
} from "../../src/lib/spx-price-action-compass";

const API_BASE_URL = "https://api.0dtespx.com";
const REQUEST_TIMEOUT_MS = 8_000;
export const ZERO_DTE_SPX_EM_LAG_TOLERANCE_MS = 60_000;
export const ZERO_DTE_SPX_FINAL_SAMPLE_TOLERANCE_MS = 60_000;

export type ZeroDteSpxFailureCode =
  | "ZERO_DTE_SPX_TOKEN_MISSING"
  | "ZERO_DTE_SPX_RATE_LIMITED"
  | "ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE"
  | "ZERO_DTE_SPX_RESPONSE_INVALID"
  | "ZERO_DTE_SPX_STALE"
  | "ZERO_DTE_SPX_FINALIZING"
  | "ZERO_DTE_SPX_SESSION_INCOMPLETE";

export class ZeroDteSpxError extends Error {
  constructor(readonly code: ZeroDteSpxFailureCode) {
    super(code);
  }
}

export interface ZeroDteSpxSession {
  current?: boolean;
  upcoming?: boolean;
  "start-time"?: unknown;
  "end-time"?: unknown;
  "data-start-time"?: unknown;
  "data-end-time"?: unknown;
}

export type ZeroDteSpxSessionState = "UPCOMING" | "LIVE" | "FINALIZING" | "CLOSED";

export interface ResolvedZeroDteSpxSession {
  sessionDate: string;
  state: ZeroDteSpxSessionState;
  startAt: string;
  endAt: string;
  dataStartAt: string;
  dataEndAt: string;
}

export interface ZeroDteSpxHistoryPoint {
  datetime?: unknown;
  datetimeUnix?: unknown;
  spx?: unknown;
  spxExpectedMove?: unknown;
  spx_expected_move?: unknown;
}

export interface ZeroDteSpxExpectedMove {
  status: "READY" | "UNAVAILABLE";
  value: number | null;
  sampleAt: string | null;
  ageMs: number | null;
  lagMs: number | null;
  errorCode:
    | "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE"
    | "ZERO_DTE_SPX_EXPECTED_MOVE_STALE"
    | "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID"
    | "ZERO_DTE_SPX_EXPECTED_MOVE_FUTURE"
    | "ZERO_DTE_SPX_EXPECTED_MOVE_LAGGED"
    | null;
}

export interface ZeroDteSpxIntradayResult {
  candles: SpxPriceActionCandle[];
  latestSampleAt: string;
  priceAgeMs: number;
  expectedMove: ZeroDteSpxExpectedMove;
}

type FetchLike = typeof fetch;

const asTimestamp = (row: ZeroDteSpxHistoryPoint) => {
  if (typeof row.datetimeUnix === "number" && Number.isFinite(row.datetimeUnix)) return row.datetimeUnix * 1_000;
  if (typeof row.datetime === "string") {
    const value = Date.parse(row.datetime);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const asPrice = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const asExpectedMove = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const asIsoTimestamp = (value: unknown) => {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const request = async (path: string, token: string, fetchImpl: FetchLike): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let status: number | null = null;
  try {
    const response = await fetchImpl(`${API_BASE_URL}${path}`, {
      headers: { Authorization: token },
      signal: controller.signal,
    });
    status = response.status;
    if (response.status === 429) throw new ZeroDteSpxError("ZERO_DTE_SPX_RATE_LIMITED");
    if (!response.ok) throw new ZeroDteSpxError("ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE");
    return response;
  } catch (error) {
    if (error instanceof ZeroDteSpxError) throw error;
    throw new ZeroDteSpxError("ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
    console.info("0dtespx_market_data_request", {
      path,
      status,
      latencyMs: Date.now() - startedAt,
    });
  }
};

export const resolveZeroDteSpxSession = (
  sessions: Record<string, ZeroDteSpxSession>,
  date: string,
  now = Date.now(),
): ResolvedZeroDteSpxSession | null => {
  const session = sessions[date];
  if (!session) return null;
  if (("current" in session && typeof session.current !== "boolean")
    || ("upcoming" in session && typeof session.upcoming !== "boolean")) {
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }
  if (session.current === true && session.upcoming === true) {
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }
  const startAt = asIsoTimestamp(session["start-time"]);
  const endAt = asIsoTimestamp(session["end-time"]);
  const dataStartAt = asIsoTimestamp(session["data-start-time"]);
  const dataEndAt = asIsoTimestamp(session["data-end-time"]);
  if (!startAt || !endAt || !dataStartAt || !dataEndAt) {
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  const dataStartMs = Date.parse(dataStartAt);
  const dataEndMs = Date.parse(dataEndAt);
  if (!(startMs <= dataStartMs && dataStartMs <= dataEndMs && dataEndMs <= endMs)) {
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }

  let state: ZeroDteSpxSessionState;
  if (session.upcoming === true || now < startMs) state = "UPCOMING";
  else if (now < endMs) {
    if (session.current !== true) throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
    state = "LIVE";
  } else state = session.current === true ? "FINALIZING" : "CLOSED";
  return { sessionDate: date, state, startAt, endAt, dataStartAt, dataEndAt };
};

export const isZeroDteSpxCurrentSession = (sessions: Record<string, ZeroDteSpxSession>, date: string, now = Date.now()) =>
  resolveZeroDteSpxSession(sessions, date, now)?.state === "LIVE";

export const fetchZeroDteSpxCurrentSession = async (token: string | undefined, fetchImpl: FetchLike = fetch) => {
  if (!token) throw new ZeroDteSpxError("ZERO_DTE_SPX_TOKEN_MISSING");
  const response = await request("/market-data/sessions", token, fetchImpl);
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid sessions");
    return payload as Record<string, ZeroDteSpxSession>;
  } catch {
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }
};

export const normalizeZeroDteSpxOneMinuteCandles = (
  rows: readonly ZeroDteSpxHistoryPoint[],
  now = Date.now(),
  session?: Pick<ResolvedZeroDteSpxSession, "state" | "dataEndAt">,
): ZeroDteSpxIntradayResult => {
  const points = rows
    .map((row) => ({ row, time: asTimestamp(row), price: asPrice(row.spx) }))
    .filter((row): row is { row: ZeroDteSpxHistoryPoint; time: number; price: number } => row.time !== null && row.price !== null)
    .sort((left, right) => left.time - right.time);
  if (points.length === 0) throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");

  const latestPoint = points[points.length - 1];
  const latestSampleAt = new Date(latestPoint.time).toISOString();
  const priceAgeMs = now - latestPoint.time;
  const completedSession = session?.state === "FINALIZING" || session?.state === "CLOSED";
  if (completedSession) {
    const dataEndMs = Date.parse(session.dataEndAt);
    const finalLagMs = dataEndMs - latestPoint.time;
    if (!Number.isFinite(dataEndMs) || finalLagMs < 0) throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
    if (finalLagMs > ZERO_DTE_SPX_FINAL_SAMPLE_TOLERANCE_MS) {
      throw new ZeroDteSpxError(session.state === "FINALIZING" ? "ZERO_DTE_SPX_FINALIZING" : "ZERO_DTE_SPX_SESSION_INCOMPLETE");
    }
  } else if (!isFreshSpx0DteSample(latestPoint.time, now)) {
    throw new ZeroDteSpxError("ZERO_DTE_SPX_STALE");
  }

  const expectedMoveRows = rows
    .map((row) => ({
      time: asTimestamp(row),
      present: "spx_expected_move" in row || "spxExpectedMove" in row,
      raw: row.spx_expected_move ?? row.spxExpectedMove,
    }))
    .filter((row): row is { time: number; present: boolean; raw: unknown } => row.time !== null)
    .sort((left, right) => left.time - right.time);
  const newestFutureNonNull = expectedMoveRows
    .filter((row) => row.present && row.raw !== null && row.raw !== undefined && row.time > latestPoint.time)
    .at(-1);
  const latestSpxHasExpectedMove = "spx_expected_move" in latestPoint.row || "spxExpectedMove" in latestPoint.row;
  const latestSpxRawExpectedMove = latestPoint.row.spx_expected_move ?? latestPoint.row.spxExpectedMove;
  const candidate = newestFutureNonNull || (
    latestSpxHasExpectedMove && latestSpxRawExpectedMove !== null && latestSpxRawExpectedMove !== undefined
      ? { time: latestPoint.time, present: true, raw: latestSpxRawExpectedMove }
      : expectedMoveRows.filter((row) => row.present && row.raw !== null && row.raw !== undefined && row.time <= latestPoint.time).at(-1)
  );
  let expectedMove: ZeroDteSpxExpectedMove;
  if (!candidate) {
    expectedMove = { status: "UNAVAILABLE", value: null, sampleAt: null, ageMs: null, lagMs: null, errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE" };
  } else {
    const value = asExpectedMove(candidate.raw);
    const sampleAt = new Date(candidate.time).toISOString();
    const ageMs = now - candidate.time;
    const lagMs = latestPoint.time - candidate.time;
    if (lagMs < 0) {
      expectedMove = { status: "UNAVAILABLE", value: null, sampleAt, ageMs, lagMs, errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_FUTURE" };
    } else if (value === null) {
      expectedMove = { status: "UNAVAILABLE", value: null, sampleAt, ageMs, lagMs, errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID" };
    } else if (lagMs > ZERO_DTE_SPX_EM_LAG_TOLERANCE_MS) {
      expectedMove = { status: "UNAVAILABLE", value: null, sampleAt, ageMs, lagMs, errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_LAGGED" };
    } else if (!completedSession && !isFreshSpx0DteSample(candidate.time, now)) {
      expectedMove = { status: "UNAVAILABLE", value: null, sampleAt, ageMs, lagMs, errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_STALE" };
    } else {
      expectedMove = { status: "READY", value, sampleAt, ageMs, lagMs, errorCode: null };
    }
  }

  const byMinute = new Map<number, Array<{ time: number; price: number }>>();
  for (const point of points) {
    const minute = Math.floor(point.time / 60_000) * 60_000;
    const bucket = byMinute.get(minute) || [];
    bucket.push(point);
    byMinute.set(minute, bucket);
  }
  const candles: SpxPriceActionCandle[] = [...byMinute.entries()].map(([minute, bucket]) => ({
    time: minute,
    date_iso: new Date(minute).toISOString().slice(0, 10),
    open: bucket[0].price,
    high: Math.max(...bucket.map((point) => point.price)),
    low: Math.min(...bucket.map((point) => point.price)),
    close: bucket[bucket.length - 1].price,
    volume: 0,
  }));
  return { candles: aggregateSpxOneMinutePriceActionCandles(candles, "1m"), latestSampleAt, priceAgeMs, expectedMove };
};

export const fetchZeroDteSpxIntradayCandles = async (
  date: string,
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
  session?: Pick<ResolvedZeroDteSpxSession, "state" | "dataEndAt">,
) => {
  if (!token) throw new ZeroDteSpxError("ZERO_DTE_SPX_TOKEN_MISSING");
  const response = await request(`/market-data/historical/${encodeURIComponent(date)}?series=spx,vix,spxExpectedMove`, token, fetchImpl);
  try {
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("invalid history");
    return normalizeZeroDteSpxOneMinuteCandles(payload as ZeroDteSpxHistoryPoint[], now, session);
  } catch (error) {
    if (error instanceof ZeroDteSpxError) throw error;
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }
};
