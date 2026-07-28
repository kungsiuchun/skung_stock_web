import type { CandlestickInterval, CandlestickPatternData } from "./candlestick-patterns";
import type { MarketCacheMetadata } from "./market-data-cache";

export const CANDLESTICK_CLIENT_DEADLINE_MS = 12_000;

interface CandlestickApiResponse {
  data?: CandlestickPatternData;
  cache?: MarketCacheMetadata;
  error?: string;
  requestId?: string;
}

export interface CandlestickClientResult {
  data: CandlestickPatternData;
  cache: MarketCacheMetadata;
  requestId?: string;
}

export interface CandlestickClientRequestError {
  symbol: string;
  interval: CandlestickInterval;
  message: string;
}

export const getCandlestickErrorForSelection = (
  error: CandlestickClientRequestError | null,
  symbol: string,
  interval: CandlestickInterval,
) => error?.symbol === symbol && error.interval === interval ? error.message : null;

export class CandlestickClientTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`K 線型態分析逾時（${Math.round(timeoutMs / 1_000)} 秒），請重試。`);
    this.name = "CandlestickClientTimeoutError";
  }
}

const abortError = () => {
  const error = new Error("K 線型態分析請求已取消。");
  error.name = "AbortError";
  return error;
};

export async function fetchCandlestickAnalysis(input: {
  symbol: string;
  interval: CandlestickInterval;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<CandlestickClientResult> {
  const timeoutMs = input.timeoutMs ?? CANDLESTICK_CLIENT_DEADLINE_MS;
  if (input.signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const request = (async () => {
    const response = await (input.fetcher || globalThis.fetch)(
      `/api/candlestick-patterns?symbol=${encodeURIComponent(input.symbol)}&interval=${input.interval}`,
      { signal: controller.signal },
    );
    let payload: CandlestickApiResponse;
    try {
      payload = await response.json() as CandlestickApiResponse;
    } catch {
      const requestId = response.headers.get("X-Request-ID");
      throw new Error(`K 線型態 API 回傳無效 JSON。${requestId ? ` Request ID: ${requestId}` : ""}`);
    }
    const requestId = payload.requestId || response.headers.get("X-Request-ID") || undefined;
    if ((!response.ok && response.status !== 206) || !payload.data || !payload.cache) {
      throw new Error(`${payload.error || `K 線型態 API 回傳 HTTP ${response.status}。`}${requestId ? ` Request ID: ${requestId}` : ""}`);
    }
    return { data: payload.data, cache: payload.cache, requestId };
  })();

  const racers: Promise<CandlestickClientResult>[] = [request];
  racers.push(new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CandlestickClientTimeoutError(timeoutMs));
    }, timeoutMs);
  }));
  if (input.signal) {
    racers.push(new Promise((_, reject) => {
      abortHandler = () => {
        controller.abort(input.signal?.reason);
        reject(abortError());
      };
      input.signal!.addEventListener("abort", abortHandler, { once: true });
      if (input.signal!.aborted) abortHandler();
    }));
  }

  try {
    return await Promise.race(racers);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortHandler) input.signal?.removeEventListener("abort", abortHandler);
  }
}
