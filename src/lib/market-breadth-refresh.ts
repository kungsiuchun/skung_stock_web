import {
  buildMarketBreadthSnapshot,
  mergeMarketBreadthPriceBars,
  normalizeMarketBreadthTicker,
  type MarketBreadthSnapshot,
  type PriceBar,
  type SectorUniverse,
} from "./market-breadth";
import {
  MarketBreadthSourceError,
  type MarketBreadthDataClient,
} from "./market-breadth-sources";

type RefreshMode = "DAILY" | "BACKFILL";
type RefreshStatus = "READY" | "SKIPPED" | "FAILED" | "PARTIAL";

export interface MarketBreadthRefreshRepository {
  beginRun: (input: { runId: string; mode: RefreshMode; startedAt: string }) => Promise<void>;
  finishRun: (input: {
    runId: string;
    status: RefreshStatus;
    finishedAt: string;
    priceAsOf?: string | null;
    errorClass?: string | null;
    detail?: Record<string, unknown>;
  }) => Promise<void>;
  readLatestSnapshot: () => Promise<MarketBreadthSnapshot | null>;
  readUniverse: () => Promise<SectorUniverse | null>;
  saveUniverse: (universe: SectorUniverse, now: string) => Promise<void>;
  readSeries: (symbols: string[]) => Promise<Map<string, PriceBar[]>>;
  saveSeries: (series: Map<string, PriceBar[]>, now: string) => Promise<void>;
  publish: (snapshot: MarketBreadthSnapshot) => Promise<void>;
  readBackfillAttempts: (backfillScope: string) => Promise<Set<string>>;
  recordBackfillAttempt: (input: { backfillScope: string; symbol: string; attemptedAt: string; barCount: number }) => Promise<void>;
}

export interface MarketBreadthRefreshResult {
  status: RefreshStatus;
  runId: string;
  priceAsOf?: string;
  reason?: string;
  remainingSymbols?: number;
}

export const marketBreadthRequiredSymbols = (universe: SectorUniverse) => [...new Set([
  "SPY",
  ...universe.sectorWeights.map((row) => normalizeMarketBreadthTicker(row.etf)),
  ...universe.holdings.map((row) => normalizeMarketBreadthTicker(row.ticker)),
])];

export const marketBreadthBackfillScope = (universe: SectorUniverse) => {
  const signature = universe.holdings.map((row) => row.ticker).sort().join("|");
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `universe-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const errorClassFor = (error: unknown) => {
  if (error instanceof MarketBreadthSourceError) return error.errorClass;
  const message = error instanceof Error ? error.message : String(error);
  if (/no such table/i.test(message)) return "STORAGE_SCHEMA_MISSING";
  if (/coverage|history is incomplete|validation|invalid/i.test(message)) return "PUBLICATION_VALIDATION_FAILED";
  return "REFRESH_FAILED";
};

const finish = async (
  repository: MarketBreadthRefreshRepository,
  input: Omit<Parameters<MarketBreadthRefreshRepository["finishRun"]>[0], "finishedAt">,
) => repository.finishRun({ ...input, finishedAt: new Date().toISOString() });

const marketDateInNewYork = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const nthWeekday = (year: number, month: number, weekday: number, nth: number) => {
  const first = new Date(Date.UTC(year, month, 1));
  return 1 + (7 + weekday - first.getUTCDay()) % 7 + (nth - 1) * 7;
};

const lastWeekday = (year: number, month: number, weekday: number) => {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - (7 + last.getUTCDay() - weekday) % 7;
};

const observed = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const easterSunday = (year: number) => {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451); const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month, day));
};

export const isNyseTradingDay = (date: string) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6) return false;
  const year = parsed.getUTCFullYear();
  const goodFriday = easterSunday(year); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const holidays = new Set([
    observed(year, 0, 1),
    `${year}-01-${String(nthWeekday(year, 0, 1, 3)).padStart(2, "0")}`,
    `${year}-02-${String(nthWeekday(year, 1, 1, 3)).padStart(2, "0")}`,
    goodFriday.toISOString().slice(0, 10),
    `${year}-05-${String(lastWeekday(year, 4, 1)).padStart(2, "0")}`,
    observed(year, 5, 19), observed(year, 6, 4),
    `${year}-09-${String(nthWeekday(year, 8, 1, 1)).padStart(2, "0")}`,
    `${year}-11-${String(nthWeekday(year, 10, 4, 4)).padStart(2, "0")}`,
    observed(year, 11, 25),
  ]);
  return !holidays.has(date);
};

export const runMarketBreadthRefresh = async (input: {
  mode: RefreshMode;
  repository: MarketBreadthRefreshRepository;
  client: MarketBreadthDataClient;
  now?: Date;
  backfillBatchSize?: number;
}): Promise<MarketBreadthRefreshResult> => {
  const now = input.now || new Date();
  const startedAt = now.toISOString();
  const requestedDate = marketDateInNewYork(now);
  const runId = `market-breadth-${input.mode.toLowerCase()}-${startedAt}-${crypto.randomUUID()}`;
  await input.repository.beginRun({ runId, mode: input.mode, startedAt });

  try {
    const latestSnapshot = await input.repository.readLatestSnapshot();
    if (input.mode === "DAILY" && latestSnapshot?.priceAsOf === requestedDate) {
      await finish(input.repository, { runId, status: "SKIPPED", priceAsOf: requestedDate, detail: { reason: "DUPLICATE_PRICE_DATE" } });
      return { status: "SKIPPED", runId, priceAsOf: requestedDate, reason: "DUPLICATE_PRICE_DATE" };
    }

    const previousUniverse = await input.repository.readUniverse();
    const universe = await input.client.fetchUniverse();
    await input.repository.saveUniverse(universe, startedAt);
    const symbols = marketBreadthRequiredSymbols(universe);
    const backfillScope = marketBreadthBackfillScope(universe);

    if (input.mode === "BACKFILL") {
      const series = await input.repository.readSeries(symbols);
      const attempted = await input.repository.readBackfillAttempts(backfillScope);
      const sectorEtfs = new Set(universe.sectorWeights.map((row) => normalizeMarketBreadthTicker(row.etf)));
      const requiredSessions = (symbol: string) => symbol === "SPY" ? 64 : sectorEtfs.has(symbol) ? 400 : 200;
      const incomplete = symbols.filter((symbol) =>
        (series.get(symbol) || []).length < requiredSessions(symbol) && !attempted.has(symbol),
      );
      const batchSize = Math.max(1, Math.min(50, input.backfillBatchSize || 25));
      const batch = incomplete.slice(0, batchSize);
      const fromDate = new Date(now.getTime() - 800 * 86_400_000).toISOString().slice(0, 10);
      for (const symbol of batch) {
        const fetched = await input.client.fetchCustomBars(symbol, fromDate, requestedDate);
        series.set(symbol, mergeMarketBreadthPriceBars(series.get(symbol) || [], fetched));
        await input.repository.saveSeries(new Map([[symbol, series.get(symbol) || []]]), startedAt);
        await input.repository.recordBackfillAttempt({
          backfillScope,
          symbol,
          attemptedAt: startedAt,
          barCount: series.get(symbol)?.length || 0,
        });
        attempted.add(symbol);
      }
      const spyBackfillSeries = series.get("SPY") || [];
      const priceAsOf = spyBackfillSeries[spyBackfillSeries.length - 1]?.date;
      let publicationErrorClass: string | null = null;
      if (priceAsOf) {
        try {
          const snapshot = buildMarketBreadthSnapshot({ generatedAt: startedAt, priceAsOf, universe, priceSeries: series });
          await input.repository.publish(snapshot);
          await finish(input.repository, { runId, status: "READY", priceAsOf, detail: { backfilledSymbols: batch.length } });
          return { status: "READY", runId, priceAsOf };
        } catch (error) {
          publicationErrorClass = errorClassFor(error);
        }
      }
      const remaining = symbols.filter((symbol) =>
        (series.get(symbol) || []).length < requiredSessions(symbol) && !attempted.has(symbol),
      );
      if (remaining.length > 0) {
        await finish(input.repository, {
          runId,
          status: "PARTIAL",
          errorClass: "BACKFILL_INCOMPLETE",
          detail: { processedSymbols: batch.length, remainingSymbols: remaining.length, publicationErrorClass },
        });
        return { status: "PARTIAL", runId, reason: "BACKFILL_INCOMPLETE", remainingSymbols: remaining.length };
      }
      if (!priceAsOf) throw new Error("SPY history is incomplete after backfill.");
      const snapshot = buildMarketBreadthSnapshot({ generatedAt: startedAt, priceAsOf, universe, priceSeries: series });
      await input.repository.publish(snapshot);
      await finish(input.repository, { runId, status: "READY", priceAsOf, detail: { backfilledSymbols: batch.length } });
      return { status: "READY", runId, priceAsOf };
    }

    let dailySummary: Map<string, PriceBar>;
    try {
      dailySummary = await input.client.fetchDailySummary(requestedDate);
    } catch (error) {
      if (error instanceof MarketBreadthSourceError && error.errorClass === "NO_MARKET_DATA") {
        if (isNyseTradingDay(requestedDate)) throw error;
        await finish(input.repository, { runId, status: "SKIPPED", priceAsOf: requestedDate, detail: { reason: "NO_MARKET_DATA" } });
        return { status: "SKIPPED", runId, priceAsOf: requestedDate, reason: "NO_MARKET_DATA" };
      }
      throw error;
    }

    const series = await input.repository.readSeries(symbols);
    for (const symbol of symbols) {
      const dailyBar = dailySummary.get(symbol);
      if (dailyBar) series.set(symbol, mergeMarketBreadthPriceBars(series.get(symbol) || [], [dailyBar]));
    }
    await input.repository.saveSeries(new Map(symbols.map((symbol) => [symbol, series.get(symbol) || []])), startedAt);

    if (!previousUniverse) {
      await finish(input.repository, {
        runId,
        status: "PARTIAL",
        priceAsOf: requestedDate,
        errorClass: "INITIAL_BACKFILL_REQUIRED",
        detail: { reason: "INITIAL_BACKFILL_REQUIRED" },
      });
      return { status: "PARTIAL", runId, priceAsOf: requestedDate, reason: "INITIAL_BACKFILL_REQUIRED" };
    }

    const attempted = await input.repository.readBackfillAttempts(backfillScope);
    const sectorEtfs = new Set(universe.sectorWeights.map((row) => normalizeMarketBreadthTicker(row.etf)));
    const requiredSessions = (symbol: string) => symbol === "SPY" ? 64 : sectorEtfs.has(symbol) ? 400 : 200;
    const newSymbols = symbols.filter((symbol) => (series.get(symbol) || []).length < requiredSessions(symbol) && !attempted.has(symbol));
    const fromDate = new Date(now.getTime() - 800 * 86_400_000).toISOString().slice(0, 10);
    for (const symbol of newSymbols) {
      const fetched = await input.client.fetchCustomBars(symbol, fromDate, requestedDate);
      series.set(symbol, mergeMarketBreadthPriceBars(series.get(symbol) || [], fetched));
      await input.repository.saveSeries(new Map([[symbol, series.get(symbol) || []]]), startedAt);
      await input.repository.recordBackfillAttempt({ backfillScope, symbol, attemptedAt: startedAt, barCount: series.get(symbol)?.length || 0 });
    }

    const snapshot = buildMarketBreadthSnapshot({
      generatedAt: startedAt,
      priceAsOf: requestedDate,
      universe,
      priceSeries: series,
    });
    await input.repository.publish(snapshot);
    await finish(input.repository, { runId, status: "READY", priceAsOf: requestedDate, detail: { newSymbolsBackfilled: newSymbols.length } });
    return { status: "READY", runId, priceAsOf: requestedDate };
  } catch (error) {
    const errorClass = errorClassFor(error);
    await finish(input.repository, { runId, status: "FAILED", errorClass, detail: { failed: true } });
    return { status: "FAILED", runId, reason: errorClass };
  }
};
