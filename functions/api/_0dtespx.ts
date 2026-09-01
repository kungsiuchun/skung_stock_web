import {
  aggregateSpxOneMinutePriceActionCandles,
  isFreshSpx0DteSample,
  type SpxPriceActionCandle,
} from "../../src/lib/spx-price-action-compass";

const API_BASE_URL = "https://api.0dtespx.com";
const REQUEST_TIMEOUT_MS = 8_000;

export type ZeroDteSpxFailureCode =
  | "ZERO_DTE_SPX_TOKEN_MISSING"
  | "ZERO_DTE_SPX_RATE_LIMITED"
  | "ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE"
  | "ZERO_DTE_SPX_RESPONSE_INVALID"
  | "ZERO_DTE_SPX_STALE";

export class ZeroDteSpxError extends Error {
  constructor(readonly code: ZeroDteSpxFailureCode) {
    super(code);
  }
}

export interface ZeroDteSpxSession {
  current?: boolean;
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
  errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE" | "ZERO_DTE_SPX_EXPECTED_MOVE_STALE" | null;
}

export interface ZeroDteSpxIntradayResult {
  candles: SpxPriceActionCandle[];
  latestSampleAt: string;
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

export const isZeroDteSpxCurrentSession = (sessions: Record<string, ZeroDteSpxSession>, date: string) =>
  sessions[date]?.current === true;

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
): ZeroDteSpxIntradayResult => {
  const points = rows
    .map((row) => ({ time: asTimestamp(row), price: asPrice(row.spx) }))
    .filter((row): row is { time: number; price: number } => row.time !== null && row.price !== null)
    .sort((left, right) => left.time - right.time);
  if (points.length === 0) throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");

  const latestSampleAt = new Date(points[points.length - 1].time).toISOString();
  if (!isFreshSpx0DteSample(points[points.length - 1].time, now)) throw new ZeroDteSpxError("ZERO_DTE_SPX_STALE");
  const latestExpectedMove = rows
    .map((row) => ({ time: asTimestamp(row), value: asExpectedMove(row.spx_expected_move ?? row.spxExpectedMove) }))
    .filter((row): row is { time: number; value: number } => row.time !== null && row.value !== null)
    .sort((left, right) => left.time - right.time)
    .at(-1) || null;
  const expectedMove: ZeroDteSpxExpectedMove = !latestExpectedMove
    ? { status: "UNAVAILABLE", value: null, sampleAt: null, errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE" }
    : !isFreshSpx0DteSample(latestExpectedMove.time, now)
      ? { status: "UNAVAILABLE", value: null, sampleAt: new Date(latestExpectedMove.time).toISOString(), errorCode: "ZERO_DTE_SPX_EXPECTED_MOVE_STALE" }
      : { status: "READY", value: latestExpectedMove.value, sampleAt: new Date(latestExpectedMove.time).toISOString(), errorCode: null };

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
  return { candles: aggregateSpxOneMinutePriceActionCandles(candles, "1m"), latestSampleAt, expectedMove };
};

export const fetchZeroDteSpxIntradayCandles = async (
  date: string,
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
) => {
  if (!token) throw new ZeroDteSpxError("ZERO_DTE_SPX_TOKEN_MISSING");
  const response = await request(`/market-data/historical/${encodeURIComponent(date)}?series=spx,vix,spxExpectedMove`, token, fetchImpl);
  try {
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("invalid history");
    return normalizeZeroDteSpxOneMinuteCandles(payload as ZeroDteSpxHistoryPoint[], now);
  } catch (error) {
    if (error instanceof ZeroDteSpxError) throw error;
    throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
  }
};
