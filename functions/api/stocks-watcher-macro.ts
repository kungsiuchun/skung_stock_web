import {
  buildStocksWatcherMacroSnapshot,
  FRED_GRAPH_CSV_ROOT,
  MACRO_FRED_SERIES_IDS,
  MACRO_FRED_SERIES_GROUPS,
  parseFredCsv,
} from "../../src/lib/stocks-watcher-macro";
import {
  MarketCacheQuotaExceededError,
  MarketCacheTimeoutError,
  resolveMarketCache,
} from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { reserveMarketCacheRefreshQuota } from "../../src/lib/stocks-watcher-refresh-quota";

interface Env {
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

const loadFredSeriesGroup = async (seriesIds: readonly string[], signal: AbortSignal) => {
  const url = new URL(FRED_GRAPH_CSV_ROOT);
  url.searchParams.set("id", seriesIds.join(","));

  const response = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "SIU-Stocks-Watcher-Macro/1.0 (+https://sius-ai-workshop.pages.dev)",
    },
    signal,
  });
  if (!response.ok) throw new Error(`FRED CSV request for ${seriesIds.join(", ")} returned HTTP ${response.status}.`);
  const payload = await response.text();
  return parseFredCsv(payload, seriesIds);
};

export async function onRequestGet(context: { request: Request; env: Env; deadlineMs?: number }) {
  const requestId = crypto.randomUUID();
  const deadlineMs = context.deadlineMs ?? MACRO_DEADLINE_MS;

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
          const groups = await Promise.all(MACRO_FRED_SERIES_GROUPS.map((seriesIds) =>
            loadFredSeriesGroup(seriesIds, controller.signal)));
          return buildStocksWatcherMacroSnapshot(Object.assign({}, ...groups));
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
      upstreamRequests: MACRO_FRED_SERIES_GROUPS.length,
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
