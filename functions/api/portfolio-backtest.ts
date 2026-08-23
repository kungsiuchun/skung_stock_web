import {
  PORTFOLIO_BACKTEST_BENCHMARK,
  PortfolioBacktestError,
  simulatePortfolioBacktest,
  validatePortfolioBacktestRequest,
  type PortfolioBacktestInput,
  type PortfolioHistoricalPoint,
  type PortfolioHistoricalSeries,
} from "../../src/lib/portfolio-backtest";
import { MarketCacheTimeoutError, resolveMarketCache, type MarketCacheStatus } from "../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

interface Env {
  MARKET_CACHE_DB?: D1DatabaseLike;
}

type BacktestRequest = Omit<PortfolioBacktestInput, "histories" | "requestedStart" | "requestedEnd"> & {
  operation?: "backtest";
  startDate?: string;
  endDate?: string;
};

type TickerValidationRequest = {
  operation: "validate";
  tickers: unknown;
};

type ApiContext = {
  request: Request;
  env: Env;
  deadlineMs?: number;
  now?: Date;
  fetcher?: typeof fetch;
};

export const PORTFOLIO_BACKTEST_API_DEADLINE_MS = 20_000;
export const PORTFOLIO_BACKTEST_HISTORY_TTL_MS = 60_000;
const MAX_HISTORY_FETCH_CONCURRENCY = 3;
const US_EXCHANGES = new Set(["NMS", "NGM", "NYQ", "ASE", "PCX", "NCM", "NGS", "NAS", "BTS", "IEX", "CBOE"]);
const YAHOO_CHART_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const;
const YAHOO_CHART_USER_AGENT = "Mozilla/5.0";
const YAHOO_RANGE_RECENCY_MS = 14 * 86_400_000;
const INFERRED_DIVIDEND_FACTOR_EPSILON = 1e-6;

type YahooChartRequest = {
  host: typeof YAHOO_CHART_HOSTS[number];
  url: URL;
};

class PortfolioBacktestApiError extends Error {
  constructor(
    public readonly code: "INVALID_JSON" | "INELIGIBLE_TICKER" | "UPSTREAM_UNAVAILABLE" | "MALFORMED_PAYLOAD" | "YAHOO_TIMEOUT",
    message: string,
    public readonly upstream?: { host: string; status?: number; attempts?: number },
  ) {
    super(message);
    this.name = "PortfolioBacktestApiError";
  }
}

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(requestId ? { "X-Request-ID": requestId } : {}),
  },
});

const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

const dateKeyInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const defaultRange = (now: Date) => {
  const end = dateKeyInTimeZone(now, "America/New_York");
  const startDate = new Date(`${end}T00:00:00.000Z`);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 5);
  return { start: startDate.toISOString().slice(0, 10), end };
};

const requestedRange = (body: BacktestRequest, now: Date) => {
  const defaults = defaultRange(now);
  return { start: body.startDate || defaults.start, end: body.endDate || defaults.end };
};

const yahooRangeForRecentEnd = (start: string, end: string, now: Date) => {
  const nowDate = dateKeyInTimeZone(now, "America/New_York");
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const nowMs = Date.parse(`${nowDate}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(nowMs)
    || endMs > nowMs || nowMs - endMs > YAHOO_RANGE_RECENCY_MS) return null;

  const requiredDays = Math.ceil((nowMs - startMs) / 86_400_000);
  if (requiredDays <= 31) return "1mo";
  if (requiredDays <= 92) return "3mo";
  if (requiredDays <= 184) return "6mo";
  if (requiredDays <= 367) return "1y";
  if (requiredDays <= 2 * 366 + 7) return "2y";
  if (requiredDays <= 5 * 366 + 14) return "5y";
  if (requiredDays <= 10 * 366 + 21) return "10y";
  return "max";
};

const yahooChartRequests = (input: Pick<ApiContext, "now"> & { ticker: string; start: string; end: string }): YahooChartRequest[] => {
  const requests: YahooChartRequest[] = [];
  const range = yahooRangeForRecentEnd(input.start, input.end, input.now || new Date());
  if (range) {
    const url = new URL(`https://${YAHOO_CHART_HOSTS[0]}/v8/finance/chart/${encodeURIComponent(input.ticker)}`);
    url.searchParams.set("range", range);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("includePrePost", "false");
    requests.push({ host: YAHOO_CHART_HOSTS[0], url });
  }
  for (const host of YAHOO_CHART_HOSTS) {
    const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(input.ticker)}`);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("period1", String(Math.floor(Date.parse(`${input.start}T00:00:00.000Z`) / 1_000)));
    url.searchParams.set("period2", String(Math.floor(Date.parse(`${input.end}T00:00:00.000Z`) / 1_000) + 86_400));
    url.searchParams.set("includePrePost", "false");
    requests.push({ host, url });
  }
  return requests;
};

const eventDate = (key: string, value: unknown, timeZone: string) => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const timestamp = numeric(record.date) ?? numeric(Number(key));
  return timestamp && timestamp > 0 ? dateKeyInTimeZone(new Date(timestamp * 1_000), timeZone) : null;
};

const splitFactor = (value: unknown) => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const numerator = numeric(record.numerator);
  const denominator = numeric(record.denominator);
  if (numerator && denominator && numerator > 0 && denominator > 0) return numerator / denominator;
  if (typeof record.splitRatio === "string") {
    const match = record.splitRatio.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) return Number(match[1]) / Number(match[2]);
  }
  return null;
};

const assertEligibleUsEtf = (ticker: string, meta: Record<string, unknown>) => {
  const quoteType = String(meta.instrumentType || meta.quoteType || "").toUpperCase();
  const exchange = String(meta.exchangeName || "").toUpperCase();
  const fullExchange = String(meta.fullExchangeName || "");
  const usListed = US_EXCHANGES.has(exchange) || /nasdaq|nyse|arca|cboe|iex/i.test(fullExchange);
  if (quoteType !== "ETF" || !usListed) {
    throw new PortfolioBacktestApiError("INELIGIBLE_TICKER", `${ticker} is not verified as a US-listed ETF by the market-data provider.`);
  }
  return { quoteType, exchange: exchange || fullExchange };
};

const assertNormalizedEligibleUsEtf = (series: PortfolioHistoricalSeries) =>
  assertEligibleUsEtf(series.ticker, { instrumentType: series.quoteType, exchangeName: series.exchange, fullExchangeName: series.exchange });

export const normalizeYahooPortfolioHistory = (input: { ticker: string; payload: unknown; now?: Date }): PortfolioHistoricalSeries => {
  const payload = input.payload as { chart?: { result?: unknown[]; error?: { description?: string } } };
  const result = payload.chart?.result?.[0] as Record<string, unknown> | undefined;
  if (!result) throw new PortfolioBacktestApiError("UPSTREAM_UNAVAILABLE", "Market history provider returned no usable chart result.");
  const meta = result.meta && typeof result.meta === "object" ? result.meta as Record<string, unknown> : {};
  const ticker = input.ticker.trim().toUpperCase();
  const eligibility = assertEligibleUsEtf(ticker, meta);
  const timestamps = result.timestamp;
  const indicators = result.indicators && typeof result.indicators === "object" ? result.indicators as Record<string, unknown> : {};
  const quote = Array.isArray(indicators.quote) ? indicators.quote[0] as Record<string, unknown> : null;
  const adjusted = Array.isArray(indicators.adjclose) ? indicators.adjclose[0] as Record<string, unknown> : null;
  const closes = quote?.close;
  const adjustedCloses = adjusted?.adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || !Array.isArray(adjustedCloses)) {
    throw new PortfolioBacktestApiError("MALFORMED_PAYLOAD", `Market history for ${ticker} is missing EOD close or adjusted-close data.`);
  }
  const timeZone = typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : "America/New_York";
  const regularSessionEnd = meta.currentTradingPeriod && typeof meta.currentTradingPeriod === "object"
    ? numeric((meta.currentTradingPeriod as Record<string, unknown>).regular && typeof (meta.currentTradingPeriod as Record<string, unknown>).regular === "object"
      ? ((meta.currentTradingPeriod as Record<string, unknown>).regular as Record<string, unknown>).end
      : undefined)
    : null;
  const dividends = new Map<string, number>();
  const splits = new Map<string, number>();
  const events = result.events && typeof result.events === "object" ? result.events as Record<string, unknown> : {};
  const dividendEvents = events.dividends && typeof events.dividends === "object" ? events.dividends as Record<string, unknown> : {};
  for (const [key, event] of Object.entries(dividendEvents)) {
    const date = eventDate(key, event, timeZone);
    const amount = event && typeof event === "object" ? numeric((event as Record<string, unknown>).amount) : null;
    if (!date || amount === null || amount < 0) throw new PortfolioBacktestApiError("MALFORMED_PAYLOAD", `Market history for ${ticker} includes an invalid dividend event.`);
    dividends.set(date, (dividends.get(date) || 0) + amount);
  }
  const splitEvents = events.splits && typeof events.splits === "object" ? events.splits as Record<string, unknown> : {};
  for (const [key, event] of Object.entries(splitEvents)) {
    const date = eventDate(key, event, timeZone);
    const factor = splitFactor(event);
    if (!date || factor === null || factor <= 0) throw new PortfolioBacktestApiError("MALFORMED_PAYLOAD", `Market history for ${ticker} includes an invalid split event.`);
    splits.set(date, (splits.get(date) || 1) * factor);
  }
  const now = input.now || new Date();
  const nowDate = dateKeyInTimeZone(now, timeZone);
  const rawPoints: Array<{ date: string; close: number; adjustedClose: number }> = [];
  const dates = new Set<string>();
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = numeric(timestamps[index]);
    if (timestamp === null || timestamp <= 0) throw new PortfolioBacktestApiError("MALFORMED_PAYLOAD", `Market history for ${ticker} contains an invalid timestamp.`);
    const date = dateKeyInTimeZone(new Date(timestamp * 1_000), timeZone);
    if (date === nowDate && (!regularSessionEnd || now.getTime() < regularSessionEnd * 1_000)) continue;
    const close = numeric(closes[index]);
    const adjustedClose = numeric(adjustedCloses[index]);
    if (close === null || close <= 0 || adjustedClose === null || adjustedClose <= 0 || dates.has(date)) {
      throw new PortfolioBacktestApiError("MALFORMED_PAYLOAD", `Market history for ${ticker} contains incomplete or duplicate completed EOD data.`);
    }
    dates.add(date);
    rawPoints.push({ date, close, adjustedClose });
  }
  if (rawPoints.length < 2) throw new PortfolioBacktestApiError("MALFORMED_PAYLOAD", `Market history for ${ticker} has fewer than two completed EOD sessions.`);
  rawPoints.sort((left, right) => left.date.localeCompare(right.date));
  if (dividends.size === 0) {
    for (let index = 1; index < rawPoints.length; index += 1) {
      const previous = rawPoints[index - 1];
      const current = rawPoints[index];
      const previousFactor = previous.adjustedClose / previous.close;
      const currentFactor = current.adjustedClose / current.close;
      const inferredDividend = Math.round(previous.close * (1 - previousFactor / currentFactor) * 1e8) / 1e8;
      if (Number.isFinite(inferredDividend) && inferredDividend > previous.close * INFERRED_DIVIDEND_FACTOR_EPSILON) {
        dividends.set(current.date, inferredDividend);
      }
    }
  }
  const byDate = new Map(rawPoints.map((point) => [point.date, {
    ...point,
    dividend: dividends.get(point.date) || 0,
    splitFactor: splits.get(point.date) || 1,
  }]));
  const points = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  return {
    ticker,
    displayName: String(meta.longName || meta.shortName || ticker),
    quoteType: eligibility.quoteType,
    exchange: eligibility.exchange,
    points,
  };
};

const errorStatus = (error: unknown) => {
  if (error instanceof MarketCacheTimeoutError || error instanceof PortfolioBacktestApiError && error.code === "YAHOO_TIMEOUT") return 504;
  if (error instanceof PortfolioBacktestApiError && error.code === "INELIGIBLE_TICKER") return 422;
  if (error instanceof PortfolioBacktestError) return error.code === "INVALID_ALLOCATION" || error.code === "INVALID_INPUT" || error.code === "DUPLICATE_TICKER" ? 400 : 422;
  if (error instanceof PortfolioBacktestApiError && error.code === "INVALID_JSON") return 400;
  return 502;
};

const safeError = (error: unknown) => {
  if (error instanceof PortfolioBacktestError || error instanceof PortfolioBacktestApiError) return { code: error.code, message: error.message };
  if (error instanceof MarketCacheTimeoutError) return { code: "REQUEST_TIMEOUT", message: "The portfolio backtest exceeded its allowed market-data deadline." };
  return { code: "UPSTREAM_UNAVAILABLE", message: "Market history is currently unavailable. Retry later." };
};

const safeUpstreamTelemetry = (error: unknown) => error instanceof PortfolioBacktestApiError && error.upstream
  ? {
      upstreamHost: error.upstream.host,
      ...(error.upstream.status === undefined ? {} : { upstreamStatus: error.upstream.status }),
      ...(error.upstream.attempts === undefined ? {} : { upstreamAttempts: error.upstream.attempts }),
    }
  : {};

const cacheStatus = (statuses: MarketCacheStatus[]): MarketCacheStatus => {
  if (statuses.every((status) => status === "bypassed")) return "bypassed";
  if (statuses.some((status) => status === "stale")) return "stale";
  if (statuses.every((status) => status === "hit")) return "hit";
  return "refreshed";
};

const validateTickerList = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw new PortfolioBacktestApiError("INVALID_JSON", "Ticker validation requires between 1 and 10 ETF symbols.");
  }
  const tickers = value.map((ticker) => String(ticker || "").trim().toUpperCase());
  if (tickers.some((ticker) => !/^[A-Z0-9.^-]{1,16}$/.test(ticker)) || new Set(tickers).size !== tickers.length) {
    throw new PortfolioBacktestApiError("INVALID_JSON", "Ticker validation requires unique, valid ETF symbols.");
  }
  return tickers;
};

const fetchHistory = async (input: {
  ticker: string;
  start: string;
  end: string;
  db?: D1DatabaseLike;
  deadlineMs: number;
  signal: AbortSignal;
  fetcher: typeof fetch;
  now: Date;
  requestId: string;
}) => resolveMarketCache({
  db: input.db,
  scope: "portfolio-backtest-history-v1",
  symbol: input.ticker,
  params: { end: input.end, start: input.start },
  dataset: "history",
  ttlMs: PORTFOLIO_BACKTEST_HISTORY_TTL_MS,
  deadlineMs: input.deadlineMs,
  signal: input.signal,
  requestId: input.requestId,
  sourceAsOf: (value) => value.points[value.points.length - 1]?.date,
  load: async () => {
    let lastFailure: { host: string; status?: number } | undefined;
    let attempts = 0;
    const requests = yahooChartRequests(input);
    const loadRequests = async () => {
      for (const request of requests) {
        attempts += 1;
        let response: Response;
        try {
          response = await input.fetcher(request.url.toString(), {
            headers: {
              "User-Agent": YAHOO_CHART_USER_AGENT,
            },
            signal: input.signal,
          });
        } catch {
          if (input.signal.aborted) throw new PortfolioBacktestApiError("YAHOO_TIMEOUT", "Market history provider timed out.");
          lastFailure = { host: request.host };
          continue;
        }
        if (!response.ok) {
          lastFailure = { host: request.host, status: response.status };
          continue;
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          lastFailure = { host: request.host, status: response.status };
          continue;
        }
        return normalizeYahooPortfolioHistory({ ticker: input.ticker, payload, now: input.now });
      }
      return null;
    };
    const result = await loadRequests();
    if (result) return result;
    const upstream = lastFailure || { host: "unknown" };
    throw new PortfolioBacktestApiError(
      "UPSTREAM_UNAVAILABLE",
      upstream.status ? "Market history provider returned an unavailable response." : "Market history provider could not be reached.",
      { ...upstream, attempts },
    );
  },
});

const boundedSeriesFetch = async (tickers: string[], load: (ticker: string) => Promise<ReturnType<typeof fetchHistory>>) => {
  const results: Awaited<ReturnType<typeof fetchHistory>>[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tickers.length) {
      const index = next;
      next += 1;
      results[index] = await load(tickers[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_HISTORY_FETCH_CONCURRENCY, tickers.length) }, worker));
  return results;
};

export async function onRequestPost(context: ApiContext) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const deadlineMs = context.deadlineMs ?? PORTFOLIO_BACKTEST_API_DEADLINE_MS;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deadlineMs);
  try {
    let body: BacktestRequest | TickerValidationRequest;
    try {
      body = await context.request.json() as BacktestRequest;
    } catch {
      throw new PortfolioBacktestApiError("INVALID_JSON", "Portfolio backtest requests must contain valid JSON.");
    }
    if (!body || typeof body !== "object") throw new PortfolioBacktestApiError("INVALID_JSON", "Portfolio backtest requests must contain a JSON object.");
    if (body.operation === "validate") {
      const tickers = validateTickerList(body.tickers);
      const now = context.now || new Date();
      const range = defaultRange(now);
       const fetched = await boundedSeriesFetch(tickers, (ticker) => fetchHistory({ ticker, start: range.start, end: range.end, db: context.env.MARKET_CACHE_DB, deadlineMs, signal: controller.signal, fetcher: context.fetcher || fetch, now, requestId }));
       fetched.forEach((entry) => assertNormalizedEligibleUsEtf(entry.value));
      const statuses = fetched.map((entry) => entry.cache.status);
      const status = cacheStatus(statuses);
      console.log(JSON.stringify({ event: "portfolio_backtest_ticker_validation", requestId, status: "success", tickerCount: tickers.length, cacheStatus: status, durationMs: Date.now() - startedAt }));
      return json({
        data: { instruments: fetched.map((entry) => ({ ticker: entry.value.ticker, displayName: entry.value.displayName, eligibility: "verified_us_etf" as const, exchange: entry.value.exchange })), warnings: status === "stale" ? ["Historical ticker metadata is stale because a refresh failed."] : [] },
        cache: { status },
        requestId,
      }, status === "stale" ? 206 : 200, requestId);
    }
    const range = requestedRange(body, context.now || new Date());
    validatePortfolioBacktestRequest({
      startingCapital: body.startingCapital,
      positions: body.positions,
      rebalancePolicy: body.rebalancePolicy,
      dividendPolicy: body.dividendPolicy,
      requestedStart: range.start,
      requestedEnd: range.end,
    });
    const tickers = [...new Set([...body.positions.map((position) => position.ticker.trim().toUpperCase()), PORTFOLIO_BACKTEST_BENCHMARK])];
    const now = context.now || new Date();
    const fetched = await boundedSeriesFetch(tickers, (ticker) => fetchHistory({ ticker, start: range.start, end: range.end, db: context.env.MARKET_CACHE_DB, deadlineMs, signal: controller.signal, fetcher: context.fetcher || fetch, now, requestId }));
    fetched.forEach((entry) => assertNormalizedEligibleUsEtf(entry.value));
    const computed = simulatePortfolioBacktest({
      startingCapital: body.startingCapital,
      positions: body.positions,
      histories: fetched.map((entry) => entry.value),
      rebalancePolicy: body.rebalancePolicy,
      dividendPolicy: body.dividendPolicy,
      requestedStart: range.start,
      requestedEnd: range.end,
    });
    const statuses = fetched.map((entry) => entry.cache.status);
    const status = cacheStatus(statuses);
    const result = { ...computed, warnings: status === "stale" ? ["Historical data is stale because a refresh failed; retry before relying on this comparison."] : computed.warnings };
    console.log(JSON.stringify({ event: "portfolio_backtest", requestId, status: "success", tickerCount: body.positions.length, cacheStatus: status, sourceAsOf: result.sourceAsOf, effectiveSessionCount: result.effectiveRange.sessionCount, rebalancePolicy: body.rebalancePolicy, dividendPolicy: body.dividendPolicy, durationMs: Date.now() - startedAt }));
    return json({ data: result, cache: { status, series: fetched.map((entry) => ({ symbol: entry.value.ticker, status: entry.cache.status, sourceAsOf: entry.cache.sourceAsOf || entry.value.points[entry.value.points.length - 1]?.date || null })) }, requestId }, status === "stale" ? 206 : 200, requestId);
  } catch (error) {
    const failure = controller.signal.aborted
      ? { code: "REQUEST_TIMEOUT", message: "The portfolio backtest exceeded its allowed market-data deadline." }
      : safeError(error);
    console.error(JSON.stringify({ event: "portfolio_backtest", requestId, status: "failed", errorCode: failure.code, errorClass: error instanceof Error ? error.name : "unknown", ...safeUpstreamTelemetry(error), durationMs: Date.now() - startedAt }));
    return json({ error: failure, requestId }, controller.signal.aborted ? 504 : errorStatus(error), requestId);
  } finally {
    clearTimeout(deadline);
  }
}
