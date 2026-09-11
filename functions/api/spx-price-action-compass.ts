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
  refreshZeroDteSpxIntradayFreshness,
  retainZeroDteSpxIntradayContext,
  resolveZeroDteSpxSession,
  type ResolvedZeroDteSpxSession,
  ZeroDteSpxError,
} from "./_0dtespx";
import {
  resolveSpxZeroDteSharedCache,
  SpxZeroDteSharedCacheError,
  type SpxZeroDteSharedCacheResolution,
} from "./_spx-0dte-shared-cache";
import { coalesceSpxEdgeRequest, readSpxEdgeCache, withSpxObservability, writeSpxEdgeCache } from "./_spx-edge-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";
import { reserveMarketCacheRefreshQuota } from "../../src/lib/stocks-watcher-refresh-quota";

interface Env {
  SPX_PRICE_ACTION_TEST_CANDLES?: SpxPriceActionCandle[];
  ZERO_DTE_SPX_API_TOKEN?: string;
  /** Local-only migration alias. Production must use ZERO_DTE_SPX_API_TOKEN. */
  spx_0dte_token?: string;
  CF_PAGES?: string;
  SPX_PRICE_ACTION_TEST_NOW_MS?: number;
  MARKET_CACHE_DB?: D1DatabaseLike;
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

export const isStrictIsoDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
};

const invalidOverlayDateResponse = () => json(
  { errorCode: "SPX_PRICE_ACTION_DATE_INVALID", error: "A valid date in YYYY-MM-DD format is required for price-overlay." },
  { status: 400, headers: { "Cache-Control": "no-store" } },
);

export const shouldCacheSpxPriceActionResponse = (_isPriceOverlay: boolean, source: SpxPriceActionSource) =>
  source.provider !== "0dtespx"
    || source.sessionState !== "FINALIZING";

async function onRequestUncached(context: Context) {
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const isPriceOverlay = url.searchParams.get("view") === "price-overlay";
  const requestedDate = isPriceOverlay ? url.searchParams.get("date") : null;
  if (isPriceOverlay && !isStrictIsoDate(requestedDate)) return invalidOverlayDateResponse();
  const timeframe = isPriceOverlay ? "1m" : normalizeSpxPriceActionTimeframe(url.searchParams.get("timeframe"));
  const config = getSpxPriceActionFetchConfig(timeframe);
  const nowMs = typeof context.env.SPX_PRICE_ACTION_TEST_NOW_MS === "number"
    ? context.env.SPX_PRICE_ACTION_TEST_NOW_MS
    : Date.now();
  const fetchedAt = new Date(nowMs).toISOString();
  const currentEtDate = etTradingDate(new Date(nowMs));
  const selectedDate = requestedDate || currentEtDate;
  const targetTimeframe = isPriceOverlay ? "1m" : timeframe;
  const zeroDteToken = context.env.ZERO_DTE_SPX_API_TOKEN
    || (context.env.CF_PAGES === "1" ? context.env.spx_0dte_token : undefined);
  const allowCache = !Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES)
    && typeof context.env.SPX_PRICE_ACTION_TEST_NOW_MS !== "number";
  if (allowCache) {
    const cached = await readSpxEdgeCache(context.request);
    if (cached) return cached;
  }

  let zeroDteAttempted = false;
  let routeSession: ResolvedZeroDteSpxSession | null = null;
  let routingReason = "";
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
        routingReason: "INJECTED_TEST_CANDLES",
        note: "Only used by local regression tests; production calls the native Yahoo chart path.",
      };
    } else if (targetTimeframe === "1m" || targetTimeframe === "5m" || targetTimeframe === "15m") {
      let shared: SpxZeroDteSharedCacheResolution | null = null;
      if (selectedDate === currentEtDate) {
        zeroDteAttempted = true;
        routingReason = "CURRENT_ET_DATE_SESSION_METADATA";
        shared = await resolveSpxZeroDteSharedCache({
          db: context.env.MARKET_CACHE_DB,
          tradingDate: selectedDate,
          nowMs,
          waitUntil: context.waitUntil,
          load: async () => {
            const sessions = await fetchZeroDteSpxCurrentSession(zeroDteToken);
            const session = resolveZeroDteSpxSession(sessions, selectedDate, nowMs);
            if (!session) throw new ZeroDteSpxError("ZERO_DTE_SPX_RESPONSE_INVALID");
            // Preserve provider-authoritative session state for an error response
            // even when the history request that follows fails.
            routeSession = session;
            routingReason = session.state === "LIVE"
              ? "CURRENT_ET_SESSION_LIVE"
              : session.state === "FINALIZING"
                ? "CURRENT_ET_SESSION_FINALIZING"
                : session.state === "CLOSED"
                  ? "CURRENT_ET_SESSION_CLOSED_HISTORICAL"
                  : "UPCOMING_SESSION_USES_YAHOO";
            return {
              session,
              value: session.state === "UPCOMING"
                ? null
                : await fetchZeroDteSpxIntradayCandles(selectedDate, zeroDteToken, fetch, nowMs, session),
            };
          },
          reserveRefresh: context.env.MARKET_CACHE_DB
            ? async () => {
              const decision = await reserveMarketCacheRefreshQuota(
                context.env.MARKET_CACHE_DB!,
                {
                  operation: "spx_0dtespx_intraday",
                  // Lease + snapshot, or lease + failure record + lease release.
                  cacheEntryWrites: 3,
                },
                new Date(nowMs),
              );
              return { allow: decision.allow, reason: decision.reason };
            }
            : undefined,
        });
        routeSession = shared.session;
      }
      if (routeSession && routeSession.state !== "UPCOMING") {
        routingReason = routeSession.state === "LIVE"
          ? "CURRENT_ET_SESSION_LIVE"
          : routeSession.state === "FINALIZING"
            ? "CURRENT_ET_SESSION_FINALIZING"
            : "CURRENT_ET_SESSION_CLOSED_HISTORICAL";
        if (!shared?.value) throw new SpxZeroDteSharedCacheError("SPX_0DTE_SHARED_CACHE_UNAVAILABLE");
        let retainedStaleContext = false;
        let intraday;
        try {
          intraday = refreshZeroDteSpxIntradayFreshness(shared.value, nowMs, routeSession);
        } catch (error) {
          const canRetainSharedContext = isPriceOverlay
            && error instanceof ZeroDteSpxError
            && error.code === "ZERO_DTE_SPX_STALE"
            && (shared.cache.status === "HIT" || shared.cache.status === "STALE");
          if (!canRetainSharedContext) throw error;
          intraday = retainZeroDteSpxIntradayContext(shared.value, nowMs, routeSession);
          retainedStaleContext = true;
          routingReason = `${routingReason}_RETAINED_STALE_SHARED_CACHE`;
        }
        rawCandles = intraday.candles;
        cacheSeconds = routeSession.state === "CLOSED" ? 3_600 : routeSession.state === "LIVE" ? 15 : 0;
        source = {
          provider: "0dtespx",
          label: `0DTESPX ${routeSession.state} SPX index series`,
          symbol: "SPX",
          range: routeSession.state === "LIVE" ? "current RTH session" : "same-day completed session",
          interval: "1s->1m",
          fetchedAt,
          latestSampleAt: intraday.latestSampleAt,
          priceAgeMs: intraday.priceAgeMs,
          status: retainedStaleContext ? "STALE" : "READY",
          sessionState: routeSession.state,
          sessionDate: routeSession.sessionDate,
          sessionStartAt: routeSession.startAt,
          sessionEndAt: routeSession.endAt,
          routingReason,
          note: retainedStaleContext
            ? "Last verified shared-cache SPX context; any valid Expected Move is stale, display-only, and must not be treated as live."
            : "Server-side normalized 1-minute SPX context; source does not provide volume.",
          expectedMove: intraday.expectedMove,
          sharedCache: shared.cache,
        };
      } else {
        zeroDteAttempted = false;
        routingReason = selectedDate !== currentEtDate
          ? "OLDER_SELECTED_DATE_USES_YAHOO"
          : routeSession?.state === "UPCOMING"
            ? "UPCOMING_SESSION_USES_YAHOO"
            : "NO_PROVIDER_SESSION_FOR_CURRENT_ET_DATE";
        rawCandles = toSpxPriceActionCandles(await fetchNativeYahooHistory("SPX", config.yahooRange, config.yahooInterval));
        source = {
          provider: "yahoo",
          label: "Native Yahoo Finance chart",
          symbol: "^SPX",
          range: config.yahooRange,
          interval: config.aggregateTo === "4h" ? "1h->4h" : config.yahooInterval,
          fetchedAt,
          status: "READY",
          sessionState: routeSession?.state,
          sessionDate: routeSession?.sessionDate || selectedDate,
          sessionStartAt: routeSession?.startAt || null,
          sessionEndAt: routeSession?.endAt || null,
          routingReason,
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
        routingReason: "HIGHER_TIMEFRAME_USES_YAHOO",
        note: "Historical and higher-timeframe SPX OHLCV use the native Yahoo chart source path; Cboe remains reserved for options/GEX source truth.",
      };
    }
    const candles = source.provider === "0dtespx"
      ? aggregateSpxOneMinutePriceActionCandles(rawCandles, targetTimeframe as "1m" | "5m" | "15m")
      : aggregateSpxPriceActionCandles(rawCandles, config.aggregateTo || timeframe);
    const warnings = candles.length === 0 ? ["No SPX OHLCV candles returned from source."] : [];
    if (source.provider === "0dtespx" && source.status === "STALE") {
      warnings.push("ZERO_DTE_SPX_STALE: showing last verified shared-cache SPX and any valid Expected Move as context only; current SPX is not live.");
    }
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
    const shouldCache = shouldCacheSpxPriceActionResponse(isPriceOverlay, source);
    console.info("spx_price_action_routing", {
      provider: source.provider,
      timeframe: targetTimeframe,
      selectedDate,
      sessionState: source.sessionState || null,
      sessionDate: source.sessionDate || null,
      sessionStartAt: source.sessionStartAt || null,
      sessionEndAt: source.sessionEndAt || null,
      priceAgeMs: source.priceAgeMs ?? null,
      expectedMoveAgeMs: source.expectedMove?.ageMs ?? null,
      expectedMoveLagMs: source.expectedMove?.lagMs ?? null,
      sharedCacheStatus: source.sharedCache?.status || null,
      sharedCacheAgeMs: source.sharedCache?.ageMs ?? null,
      sharedCacheRefreshing: source.sharedCache?.refreshing ?? null,
      routingReason: source.routingReason || null,
      status: source.status || "READY",
    });
    const response = withSpxObservability(
      json(payload, shouldCache ? {} : { headers: { "Cache-Control": "no-store" } }, cacheSeconds),
      Date.now() - startedAt,
    );
    if (allowCache && shouldCache) await writeSpxEdgeCache(context, response);
    return response;
  } catch (error) {
    const zeroDteFailure = error instanceof ZeroDteSpxError || zeroDteAttempted;
    const failureCode = error instanceof ZeroDteSpxError || error instanceof SpxZeroDteSharedCacheError
      ? error.code
      : zeroDteFailure ? "ZERO_DTE_SPX_UPSTREAM_UNAVAILABLE" : "SPX_PRICE_ACTION_SOURCE_FAILED";
    const sessionState = routeSession?.state || (zeroDteFailure ? "UNAVAILABLE" : undefined);
    const failureRoutingReason = routingReason || (zeroDteFailure ? "ZERO_DTE_SESSION_METADATA_UNAVAILABLE" : "YAHOO_SOURCE_FAILED");
    console.info("spx_price_action_routing", {
      provider: zeroDteFailure ? "0dtespx" : "yahoo",
      timeframe: targetTimeframe,
      selectedDate,
      sessionState: sessionState || null,
      sessionDate: routeSession?.sessionDate || (zeroDteFailure ? selectedDate : null),
      sessionStartAt: routeSession?.startAt || null,
      sessionEndAt: routeSession?.endAt || null,
      priceAgeMs: null,
      expectedMoveAgeMs: null,
      expectedMoveLagMs: null,
      routingReason: failureRoutingReason,
      status: "UNAVAILABLE",
      failureCode,
    });
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
          label: zeroDteFailure ? `0DTESPX ${sessionState} SPX index series` : "Native Yahoo Finance chart",
          symbol: "SPX",
          range: zeroDteFailure && routeSession?.state !== "LIVE" ? "same-day session" : zeroDteFailure ? "current RTH session" : config.yahooRange,
          interval: zeroDteFailure ? "1s->1m" : config.yahooInterval,
          fetchedAt,
          status: failureCode === "ZERO_DTE_SPX_STALE" ? "STALE" : "UNAVAILABLE",
          sessionState,
          sessionDate: routeSession?.sessionDate || (zeroDteFailure ? selectedDate : null),
          sessionStartAt: routeSession?.startAt || null,
          sessionEndAt: routeSession?.endAt || null,
          routingReason: failureRoutingReason,
          note: zeroDteFailure ? "0DTESPX same-day source is unavailable; Yahoo fallback is disabled for a live, finalizing, or completed current-date session." : "SPX Price Action source is unavailable.",
        },
        warnings: [failureCode],
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function onRequest(context: Context) {
  const url = new URL(context.request.url);
  if (url.searchParams.get("view") === "price-overlay" && !isStrictIsoDate(url.searchParams.get("date"))) {
    return invalidOverlayDateResponse();
  }
  const allowCache = !Array.isArray(context.env.SPX_PRICE_ACTION_TEST_CANDLES)
    && typeof context.env.SPX_PRICE_ACTION_TEST_NOW_MS !== "number";
  if (!allowCache) return onRequestUncached(context);
  const cached = await readSpxEdgeCache(context.request);
  if (cached) return cached;
  return coalesceSpxEdgeRequest(context.request, () => onRequestUncached(context));
}
