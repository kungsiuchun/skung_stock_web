import {
  MARKET_BREADTH_SECTORS,
  buildSectorUniverse,
  normalizeMarketBreadthTicker,
  parseStateStreetHoldingsWorkbook,
  type PriceBar,
  type SectorUniverse,
} from "./market-breadth";

const STATE_STREET_HOLDINGS_BASE = "https://www.ssga.com/library-content/products/fund-data/etfs/emea";

export const STATE_STREET_FUNDS = [
  { fund: "SPY", sector: null },
  ...MARKET_BREADTH_SECTORS.map(({ sector, etf }) => ({ fund: etf, sector })),
] as const;

export class MarketBreadthSourceError extends Error {
  constructor(public readonly errorClass: string, message: string) {
    super(message);
    this.name = "MarketBreadthSourceError";
  }
}

export const stateStreetHoldingsUrl = (fund: string) =>
  `${STATE_STREET_HOLDINGS_BASE}/holdings-daily-emea-en-${fund.toLowerCase()}.xlsx`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const fetchWithDeadline = async <T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort("MARKET_BREADTH_PROVIDER_TIMEOUT");
      reject(new MarketBreadthSourceError("PROVIDER_TIMEOUT", `Market breadth source exceeded its ${timeoutMs}ms deadline.`));
    }, timeoutMs);
  });
  try {
    const fetchAndConsume = fetcher(url, { ...init, signal: controller.signal }).then(consume);
    return await Promise.race([fetchAndConsume, timeout]);
  } catch (error) {
    if (controller.signal.aborted) throw new MarketBreadthSourceError("PROVIDER_TIMEOUT", `Market breadth source exceeded its ${timeoutMs}ms deadline.`);
    throw error;
  } finally {
    clearTimeout(timer!);
  }
};

export const parseMassiveDailySummary = (payload: unknown, date: string): Map<string, PriceBar> => {
  const root = asRecord(payload);
  const results = Array.isArray(root?.results) ? root.results : [];
  const bars = new Map<string, PriceBar>();
  for (const item of results) {
    const row = asRecord(item);
    const ticker = normalizeMarketBreadthTicker(String(row?.T || ""));
    const close = Number(row?.c);
    if (!ticker || !Number.isFinite(close) || close <= 0) continue;
    bars.set(ticker, { date, close });
  }
  if (bars.size === 0) {
    throw new MarketBreadthSourceError("NO_MARKET_DATA", `Massive returned no daily bars for ${date}.`);
  }
  return bars;
};

export const parseMassiveCustomBars = (payload: unknown): PriceBar[] => {
  const root = asRecord(payload);
  const results = Array.isArray(root?.results) ? root.results : [];
  const byDate = new Map<string, PriceBar>();
  for (const item of results) {
    const row = asRecord(item);
    const timestamp = Number(row?.t);
    const close = Number(row?.c);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) continue;
    const date = new Date(timestamp).toISOString().slice(0, 10);
    byDate.set(date, { date, close });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

export const toMassiveTicker = (ticker: string) => {
  const canonical = normalizeMarketBreadthTicker(ticker);
  return canonical.replace(/^([A-Z]+)-([A-Z])$/, "$1.$2");
};

export interface MarketBreadthDataClient {
  fetchUniverse: () => Promise<SectorUniverse>;
  fetchDailySummary: (date: string) => Promise<Map<string, PriceBar>>;
  fetchCustomBars: (ticker: string, fromDate: string, toDate: string) => Promise<PriceBar[]>;
}

const fetchJson = async (fetcher: typeof fetch, url: string, apiKey: string, timeoutMs: number) => {
  return fetchWithDeadline(fetcher, url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  }, timeoutMs, async (response) => {
    if (!response.ok) {
      const errorClass = response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED";
      throw new MarketBreadthSourceError(errorClass, `Massive request failed with HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new MarketBreadthSourceError("PROVIDER_CONTRACT_INVALID", `Massive returned ${contentType || "an unknown content type"}.`);
    }
    return response.json() as Promise<unknown>;
  });
};

export const createMarketBreadthDataClient = (input: {
  apiKey: string;
  fetcher?: typeof fetch;
  massiveBaseUrl?: string;
  requestTimeoutMs?: number;
  massiveMinRequestIntervalMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}): MarketBreadthDataClient => {
  if (!input.apiKey) throw new MarketBreadthSourceError("SECRET_MISSING", "MASSIVE_API_KEY is not configured.");
  const fetcher = input.fetcher || fetch;
  const massiveBaseUrl = (input.massiveBaseUrl || "https://api.massive.com").replace(/\/$/, "");
  const requestTimeoutMs = Math.max(100, Math.min(60_000, input.requestTimeoutMs || 20_000));
  const requestedIntervalMs = input.massiveMinRequestIntervalMs ?? 13_000;
  if (!Number.isFinite(requestedIntervalMs) || requestedIntervalMs < 0) {
    throw new MarketBreadthSourceError("RATE_LIMIT_CONFIG_INVALID", "Massive request interval must be a finite non-negative number.");
  }
  const massiveMinRequestIntervalMs = Math.min(60_000, requestedIntervalMs);
  const now = input.now || Date.now;
  const sleep = input.sleep || ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let nextMassiveRequestAt = 0;
  let massiveRequestTail = Promise.resolve();

  const runMassiveRequest = <T>(request: () => Promise<T>): Promise<T> => {
    const pending = massiveRequestTail.then(async () => {
      const delayMs = Math.max(0, nextMassiveRequestAt - now());
      if (delayMs > 0) await sleep(delayMs);
      nextMassiveRequestAt = now() + massiveMinRequestIntervalMs;
      return request();
    });
    massiveRequestTail = pending.then(() => undefined, () => undefined);
    return pending;
  };

  return {
    fetchUniverse: async () => {
      const workbooks = await Promise.all(STATE_STREET_FUNDS.map(async ({ fund, sector }) => {
        const url = stateStreetHoldingsUrl(fund);
        return fetchWithDeadline(fetcher, url, {
          headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        }, requestTimeoutMs, async (response) => {
          if (!response.ok) {
            throw new MarketBreadthSourceError("HOLDINGS_UNAVAILABLE", `State Street ${fund} workbook returned HTTP ${response.status}.`);
          }
          const parsed = parseStateStreetHoldingsWorkbook(await response.arrayBuffer(), fund);
          return { ...parsed, sector };
        });
      }));
      const spy = workbooks.find((workbook) => workbook.fund === "SPY");
      if (!spy) throw new MarketBreadthSourceError("HOLDINGS_CONTRACT_INVALID", "SPY holdings workbook is missing.");
      return buildSectorUniverse({
        holdingsAsOf: spy.holdingsAsOf,
        spyHoldings: spy.holdings,
        sectorFunds: workbooks.flatMap((workbook) => workbook.sector ? [{
          sector: workbook.sector,
          etf: workbook.fund,
          holdingsAsOf: workbook.holdingsAsOf,
          tickers: workbook.holdings.map((holding) => holding.ticker),
        }] : []),
      });
    },
    fetchDailySummary: async (date) => {
      const payload = await runMassiveRequest(() => fetchJson(
        fetcher,
        `${massiveBaseUrl}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&include_otc=false`,
        input.apiKey,
        requestTimeoutMs,
      ));
      return parseMassiveDailySummary(payload, date);
    },
    fetchCustomBars: async (ticker, fromDate, toDate) => {
      const normalizedTicker = toMassiveTicker(ticker);
      const payload = await runMassiveRequest(() => fetchJson(
        fetcher,
        `${massiveBaseUrl}/v2/aggs/ticker/${encodeURIComponent(normalizedTicker)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=50000`,
        input.apiKey,
        requestTimeoutMs,
      ));
      return parseMassiveCustomBars(payload);
    },
  };
};
