import {
  buildCandlestickPatternData,
  CANDLESTICK_INTERVALS,
  CandlestickDataError,
  type CandlestickInterval,
} from "../../src/lib/candlestick-patterns";
import { MarketCacheQuotaExceededError, MarketCacheTimeoutError, resolveMarketCache } from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { reserveMarketCacheRefreshQuota } from "../../src/lib/stocks-watcher-refresh-quota";

interface Env {
  MARKET_CACHE_DB?: D1DatabaseLike;
}

const INTERVAL_RANGE: Record<CandlestickInterval, string> = {
  "1d": "1y",
  "1wk": "5y",
  "1mo": "10y",
};

export const CANDLESTICK_API_DEADLINE_MS = 10_000;

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(requestId ? { "X-Request-ID": requestId } : {}),
  },
});

const validSymbol = (value: unknown) => {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) throw new Error("Invalid stock symbol.");
  return symbol;
};

const validInterval = (value: unknown): CandlestickInterval => {
  const interval = String(value || "1d") as CandlestickInterval;
  if (!CANDLESTICK_INTERVALS.includes(interval)) throw new Error("Invalid interval. Use 1d, 1wk, or 1mo.");
  return interval;
};

const errorStatus = (error: unknown) => {
  if (error instanceof MarketCacheQuotaExceededError) return 429;
  if (error instanceof MarketCacheTimeoutError) return 504;
  if (!(error instanceof CandlestickDataError)) return 502;
  if (error.code === "INSUFFICIENT_BARS") return 422;
  if (error.code === "YAHOO_TIMEOUT") return 504;
  return 502;
};

export async function onRequestGet(context: { request: Request; env: Env; deadlineMs?: number }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const apiDeadlineMs = context.deadlineMs ?? CANDLESTICK_API_DEADLINE_MS;
  const url = new URL(context.request.url);
  let symbol: string;
  let interval: CandlestickInterval;
  try {
    symbol = validSymbol(url.searchParams.get("symbol"));
    interval = validInterval(url.searchParams.get("interval"));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), requestId }, 400, requestId);
  }

  try {
    const resolved = await resolveMarketCache({
      db: context.env.MARKET_CACHE_DB,
      scope: "candlestick-patterns-v2",
      symbol,
      params: { interval },
      deadlineMs: apiDeadlineMs,
      requestId,
      signal: context.request.signal,
      sourceAsOf: (value) => value.sourceAsOf,
      refreshQuotaGuard: context.env.MARKET_CACHE_DB
        ? () => reserveMarketCacheRefreshQuota(context.env.MARKET_CACHE_DB!, { operation: "candlestick_patterns" })
        : undefined,
      load: async () => {
        const controller = new AbortController();
        let timedOut = false;
        const yahooTimeoutMs = Math.min(8_000, Math.max(1, apiDeadlineMs - 2_000));
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, yahooTimeoutMs);
        try {
          const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${INTERVAL_RANGE[interval]}&events=history`;
          const response = await fetch(yahooUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Yahoo Finance chart request returned HTTP ${response.status}.`);
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new CandlestickDataError("MALFORMED_PAYLOAD", "Yahoo Finance chart response was not valid JSON.");
          }
          return buildCandlestickPatternData({ symbol, interval, payload });
        } catch (error) {
          if (timedOut) {
            throw new CandlestickDataError("YAHOO_TIMEOUT", `Yahoo Finance chart request exceeded ${yahooTimeoutMs}ms.`);
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
    });

    console.log(JSON.stringify({
      event: "candlestick_pattern_analysis",
      requestId,
      symbol,
      interval,
      status: "success",
      cacheStatus: resolved.cache.status,
      sourceAsOf: resolved.value.sourceAsOf,
      barCount: resolved.value.bars.length,
      rejectedBarCount: resolved.value.rejectedBarCount,
      partialBarExcluded: resolved.value.partialBarExcluded,
      latestPatternIds: resolved.value.analysis.latestMatches.map((match) => match.id),
      patternBias: resolved.value.analysis.patternBias,
      trendContext: resolved.value.analysis.trendContext,
      supportResistanceZoneCount: resolved.value.analysis.supportResistance.zones.length,
      durationMs: Date.now() - startedAt,
    }));
    return json({ data: resolved.value, cache: resolved.cache, requestId }, resolved.cache.status === "stale" ? 206 : 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "candlestick_pattern_analysis",
      requestId,
      symbol,
      interval,
      status: "failed",
      errorClass: error instanceof Error ? error.name : "unknown",
      ...(error instanceof MarketCacheTimeoutError ? { timeoutPhase: error.phase, timeoutMs: error.timeoutMs } : {}),
      durationMs: Date.now() - startedAt,
    }));
    return json({
      error: message,
      errorCode: error instanceof MarketCacheQuotaExceededError ? "D1_SAFETY_CUTOFF" : null,
      requestId,
    }, errorStatus(error), requestId);
  }
}
