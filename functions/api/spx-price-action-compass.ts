import { fetchNativeYahooHistory } from "../../src/lib/stocks-native-yahoo";
import {
  aggregateSpxPriceActionCandles,
  buildSpxPriceActionCompassResponse,
  getSpxPriceActionFetchConfig,
  normalizeSpxPriceActionTimeframe,
  toSpxPriceActionCandles,
  type SpxPriceActionCandle,
  type SpxPriceActionSource,
} from "../../src/lib/spx-price-action-compass";

interface Env {
  SPX_PRICE_ACTION_TEST_CANDLES?: SpxPriceActionCandle[];
}

interface Context {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      ...(init.headers || {}),
    },
  });

export async function onRequest(context: Context) {
  const url = new URL(context.request.url);
  const timeframe = normalizeSpxPriceActionTimeframe(url.searchParams.get("timeframe"));
  const config = getSpxPriceActionFetchConfig(timeframe);
  const fetchedAt = new Date().toISOString();
  const edgeCache = Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES) || typeof caches === "undefined"
    ? null
    : caches.default;
  if (context.request.method === "GET" && edgeCache) {
    const cached = await edgeCache.match(context.request);
    if (cached) return cached;
  }

  try {
    const rawCandles = Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES)
      ? context.env.SPX_PRICE_ACTION_TEST_CANDLES
      : toSpxPriceActionCandles(
        await fetchNativeYahooHistory("SPX", config.yahooRange, config.yahooInterval),
      );
    const candles = aggregateSpxPriceActionCandles(rawCandles, config.aggregateTo || timeframe);
    const source: SpxPriceActionSource = Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES)
      ? {
        provider: "test",
        label: "Injected regression candles",
        symbol: "SPX",
        range: "fixture",
        interval: timeframe,
        fetchedAt,
        note: "Only used by local regression tests; production calls the native Yahoo chart path.",
      }
      : {
        provider: "yahoo",
        label: "Native Yahoo Finance chart",
        symbol: "^SPX",
        range: config.yahooRange,
        interval: config.aggregateTo === "4h" ? "1h->4h" : config.yahooInterval,
        fetchedAt,
        note: "SPX OHLCV uses the existing native Yahoo chart source path; Cboe remains reserved for options/GEX source truth.",
      };

    const response = json(buildSpxPriceActionCompassResponse({
      timeframe,
      candles,
      source,
      warnings: candles.length === 0 ? ["No SPX OHLCV candles returned from source."] : [],
    }));
    if (edgeCache && context.request.method === "GET") {
      const write = edgeCache.put(context.request, response.clone()).catch(() => undefined);
      context.waitUntil?.(write);
    }
    return response;
  } catch (error) {
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
          provider: "yahoo",
          label: "Native Yahoo Finance chart",
          symbol: "^SPX",
          range: config.yahooRange,
          interval: config.yahooInterval,
          fetchedAt,
          note: "SPX OHLCV uses the existing native Yahoo chart source path.",
        },
        warnings: [`SPX Price Action Compass source failed: ${error instanceof Error ? error.message : String(error)}`],
      },
      { status: 502 },
    );
  }
}
