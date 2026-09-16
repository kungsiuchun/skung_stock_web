import {
  buildStocksWatcherMacroSnapshot,
  FRED_API_ROOT,
  MACRO_FRED_SERIES_IDS,
  parseFredObservations,
} from "../../src/lib/stocks-watcher-macro";
import {
  MarketCacheQuotaExceededError,
  MarketCacheTimeoutError,
  resolveMarketCache,
} from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { reserveMarketCacheRefreshQuota } from "../../src/lib/stocks-watcher-refresh-quota";

interface Env {
  FRED_API_KEY?: string;
  MARKET_CACHE_DB?: D1DatabaseLike;
}

const MACRO_CACHE_TTL_MS = 60 * 60_000;
const MACRO_DEADLINE_MS = 12_000;

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(requestId ? { "X-Request-ID": requestId } : {}),
  },
});

const errorStatus = (error: unknown) => {
  if (error instanceof MarketCacheQuotaExceededError) return 429;
  if (error instanceof MarketCacheTimeoutError) return 504;
  return 502;
};

const loadFredSeries = async (seriesId: string, apiKey: string, signal: AbortSignal) => {
  const url = new URL(FRED_API_ROOT);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  // Ask FRED for the newest window, then normalize it into ascending order.
  // The oldest 500 daily observations would stop decades before today's row.
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "500");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SIU-Stocks-Watcher-Macro/1.0 (+https://sius-ai-workshop.pages.dev)",
    },
    signal,
  });
  if (!response.ok) throw new Error(`FRED ${seriesId} request returned HTTP ${response.status}.`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`FRED ${seriesId} response was not valid JSON.`);
  }
  return parseFredObservations(payload, seriesId);
};

export async function onRequestGet(context: { request: Request; env: Env; deadlineMs?: number }) {
  const requestId = crypto.randomUUID();
  const deadlineMs = context.deadlineMs ?? MACRO_DEADLINE_MS;
  const apiKey = context.env.FRED_API_KEY?.trim();
  if (!apiKey) {
    return json({
      error: "Macro data source is unavailable because FRED_API_KEY is not configured.",
      errorCode: "FRED_KEY_MISSING",
      requestId,
    }, 503, requestId);
  }

  try {
    const resolved = await resolveMarketCache({
      db: context.env.MARKET_CACHE_DB,
      scope: "stocks-watcher-macro-v1",
      symbol: "US-MACRO",
      params: { series: MACRO_FRED_SERIES_IDS },
      dataset: "history",
      ttlMs: MACRO_CACHE_TTL_MS,
      deadlineMs,
      requestId,
      signal: context.request.signal,
      sourceAsOf: (value) => value.asOf,
      refreshQuotaGuard: context.env.MARKET_CACHE_DB
        ? () => reserveMarketCacheRefreshQuota(context.env.MARKET_CACHE_DB!, { operation: "stocks_watcher_macro" })
        : undefined,
      load: async () => {
        const controller = new AbortController();
        const abortFromRequest = () => controller.abort(context.request.signal.reason);
        context.request.signal.addEventListener("abort", abortFromRequest, { once: true });
        const timeout = setTimeout(() => controller.abort("FRED macro deadline exceeded"), Math.min(10_000, Math.max(1, deadlineMs - 1_000)));
        try {
          const entries = await Promise.all(MACRO_FRED_SERIES_IDS.map(async (seriesId) => [
            seriesId,
            await loadFredSeries(seriesId, apiKey, controller.signal),
          ] as const));
          return buildStocksWatcherMacroSnapshot(Object.fromEntries(entries));
        } finally {
          clearTimeout(timeout);
          context.request.signal.removeEventListener("abort", abortFromRequest);
        }
      },
    });

    console.log(JSON.stringify({
      event: "stocks_watcher_macro",
      requestId,
      cacheStatus: resolved.cache.status,
      sourceAsOf: resolved.value.asOf,
      marketRows: resolved.value.markets.rows.length,
      inflationMonths: resolved.value.inflation.months.length,
    }));
    return json({ data: resolved.value, cache: resolved.cache, requestId }, resolved.cache.status === "stale" ? 206 : 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "stocks_watcher_macro",
      requestId,
      status: "failed",
      errorClass: error instanceof Error ? error.name : "unknown",
      ...(error instanceof MarketCacheTimeoutError ? { timeoutPhase: error.phase, timeoutMs: error.timeoutMs } : {}),
    }));
    return json({
      error: message,
      errorCode: error instanceof MarketCacheQuotaExceededError ? "D1_SAFETY_CUTOFF" : "MACRO_SOURCE_UNAVAILABLE",
      requestId,
    }, errorStatus(error), requestId);
  }
}
