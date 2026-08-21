import { fetchNativeYahooHistory } from "../../src/lib/stocks-native-yahoo";
import {
  aggregateSpxOneMinutePriceActionCandles,
  aggregateSpxPriceActionCandles,
  buildSpxPriceActionCompassResponse,
  getSpxPriceActionFetchConfig,
  normalizeSpxPriceActionTimeframe,
  toSpxPriceActionCandles,
  type SpxPriceActionCandle,
  type SpxPriceActionSource,
} from "../../src/lib/spx-price-action-compass";
import {
  fetchZeroDteSpxCurrentSession,
  fetchZeroDteSpxIntradayCandles,
  isZeroDteSpxCurrentSession,
  ZeroDteSpxError,
} from "./_0dtespx";
import { coalesceSpxEdgeRequest, readSpxEdgeCache, withSpxObservability, writeSpxEdgeCache } from "./_spx-edge-cache";

interface Env {
  SPX_PRICE_ACTION_TEST_CANDLES?: SpxPriceActionCandle[];
  ZERO_DTE_SPX_API_TOKEN?: string;
  /** Local-only migration alias. Production must use ZERO_DTE_SPX_API_TOKEN. */
  spx_0dte_token?: string;
  CF_PAGES?: string;
}

interface Context {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const json = (body: unknown, init: ResponseInit = {}, cacheSeconds = 30) => {
  const text = JSON.stringify(body);
  return new Response(text, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
      "X-SPX-Payload-Bytes": String(new TextEncoder().encode(text).byteLength),
      ...(init.headers || {}),
    },
  });
};

const etTradingDate = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

async function onRequestUncached(context: Context) {
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const isPriceOverlay = url.searchParams.get("view") === "price-overlay";
  const timeframe = isPriceOverlay ? "1m" : normalizeSpxPriceActionTimeframe(url.searchParams.get("timeframe"));
  const config = getSpxPriceActionFetchConfig(timeframe);
  const fetchedAt = new Date().toISOString();
  const targetTimeframe = isPriceOverlay ? "1m" : timeframe;
  const zeroDteToken = context.env.ZERO_DTE_SPX_API_TOKEN
    || (context.env.CF_PAGES === "1" ? context.env.spx_0dte_token : undefined);
  const allowCache = !Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES);
  if (allowCache) {
    const cached = await readSpxEdgeCache(context.request);
    if (cached) return cached;
  }

  try {
    let cacheSeconds = 30;
    let source: SpxPriceActionSource;
    let rawCandles: SpxPriceActionCandle[];
    if (Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES)) {
      rawCandles = context.env.SPX_PRICE_ACTION_TEST_CANDLES;
      source = {
        provider: "test",
        label: "Injected regression candles",
        symbol: "SPX",
        range: "fixture",
        interval: timeframe,
        fetchedAt,
        status: "READY",
        note: "Only used by local regression tests; production calls the native Yahoo chart path.",
      };
    } else if (targetTimeframe === "1m" || targetTimeframe === "5m" || targetTimeframe === "15m") {
      const tradingDate = etTradingDate();
      const sessions = await fetchZeroDteSpxCurrentSession(zeroDteToken);
      if (isZeroDteSpxCurrentSession(sessions, tradingDate)) {
        const intraday = await fetchZeroDteSpxIntradayCandles(tradingDate, zeroDteToken);
        rawCandles = intraday.candles;
        cacheSeconds = 300;
        source = {
          provider: "0dtespx",
          label: "0DTESPX live SPX index series",
          symbol: "SPX",
          range: "current RTH session",
          interval: "1s->1m",
          fetchedAt,
          latestSampleAt: intraday.latestSampleAt,
          status: "READY",
          note: "Server-side normalized 1-minute SPX context; source does not provide volume.",
        };
      } else {
        rawCandles = toSpxPriceActionCandles(await fetchNativeYahooHistory("SPX", config.yahooRange, config.yahooInterval));
        source = {
          provider: "yahoo",
          label: "Native Yahoo Finance chart",
          symbol: "^SPX",
          range: config.yahooRange,
          interval: config.aggregateTo === "4h" ? "1h->4h" : config.yahooInterval,
          fetchedAt,
          status: "READY",
          note: "Historical and out-of-session SPX OHLCV use the native Yahoo chart source path; Cboe remains reserved for options/GEX source truth.",
        };
      }
    } else {
      rawCandles = toSpxPriceActionCandles(await fetchNativeYahooHistory("SPX", config.yahooRange, config.yahooInterval));
      source = {
        provider: "yahoo",
        label: "Native Yahoo Finance chart",
        symbol: "^SPX",
        range: config.yahooRange,
        interval: config.aggregateTo === "4h" ? "1h->4h" : config.yahooInterval,
        fetchedAt,
        status: "READY",
        note: "Historical and higher-timeframe SPX OHLCV use the native Yahoo chart source path; Cboe remains reserved for options/GEX source truth.",
      };
    }
    const candles = source.provider === "0dtespx"
      ? aggregateSpxOneMinutePriceActionCandles(rawCandles, targetTimeframe as "1m" | "5m" | "15m")
      : aggregateSpxPriceActionCandles(rawCandles, config.aggregateTo || timeframe);
    const warnings = candles.length === 0 ? ["No SPX OHLCV candles returned from source."] : [];
    const payload = isPriceOverlay
      ? {
        ticker: "SPX",
        timeframe: "1m",
        candles: candles.slice(-3000),
        source: {
          ...source,
          note: `${source.note} Compact 1-minute close series for the GEX pressure overlay; no pattern analysis is included.`,
        },
        warnings,
      }
      : buildSpxPriceActionCompassResponse({
        timeframe,
        candles,
        source,
        warnings,
      });
    const response = withSpxObservability(json(payload, {}, cacheSeconds), Date.now() - startedAt);
    if (allowCache) await writeSpxEdgeCache(context, response);
    return response;
  } catch (error) {
    const zeroDteFailure = error instanceof ZeroDteSpxError;
    const failureCode = zeroDteFailure ? error.code : "SPX_PRICE_ACTION_SOURCE_FAILED";
    return json(
      {
        ticker: "SPX",
        timeframe,
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
          provider: zeroDteFailure ? "0dtespx" : "yahoo",
          label: zeroDteFailure ? "0DTESPX live SPX index series" : "Native Yahoo Finance chart",
          symbol: "SPX",
          range: zeroDteFailure ? "current RTH session" : config.yahooRange,
          interval: zeroDteFailure ? "1s->1m" : config.yahooInterval,
          fetchedAt,
          status: failureCode === "ZERO_DTE_SPX_STALE" ? "STALE" : "UNAVAILABLE",
          note: zeroDteFailure ? "0DTESPX intraday source is unavailable; Yahoo fallback is disabled during the current session." : "SPX Price Action source is unavailable.",
        },
        warnings: [failureCode],
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function onRequest(context: Context) {
  const allowCache = !Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES);
  if (!allowCache) return onRequestUncached(context);
  const cached = await readSpxEdgeCache(context.request);
  if (cached) return cached;
  return coalesceSpxEdgeRequest(context.request, () => onRequestUncached(context));
}
