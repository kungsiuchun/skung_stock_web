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
import { isNyseTradingDay } from "./nyse-calendar";
export { isNyseTradingDay } from "./nyse-calendar";

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

const previousNyseTradingDay = (date: string) => {
  const cursor = new Date(`${date}T12:00:00.000Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (!isNyseTradingDay(cursor.toISOString().slice(0, 10)));
  return cursor.toISOString().slice(0, 10);
};

const hasNyseSessionGap = (history: PriceBar[], requestedDate: string) => {
  const dates = new Set(history.map((bar) => bar.date));
  const firstDate = [...dates].sort()[0];
  if (!firstDate) return false;
  const cursor = new Date(`${firstDate}T12:00:00.000Z`);
  for (let date = firstDate; date < requestedDate; date = cursor.toISOString().slice(0, 10)) {
    if (isNyseTradingDay(date) && !dates.has(date)) return true;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
};

// Recheck the last published close on the provider's current split basis before
// appending a new session. A changed reference close requires replacing, rather
// than merging, its entire adjusted history so a split cannot manufacture a loss.
export const reconcileMarketBreadthAdjustments = async (input: {
  series: Map<string, PriceBar[]>;
  symbols: string[];
  referenceDate: string;
  requestedDate: string;
  fromDate: string;
  currentSummary: Map<string, PriceBar>;
  client: MarketBreadthDataClient;
}) => {
  const reference = await input.client.fetchDailySummary(input.referenceDate);
  const changed = input.symbols.filter((symbol) => {
    const current = input.currentSummary.get(symbol);
    if (!current) return false;
    if (current.date !== input.requestedDate || !Number.isFinite(current.close) || current.close <= 0) {
      throw new MarketBreadthSourceError("ADJUSTMENT_HISTORY_INVALID", "Current adjusted summary has an invalid date or close.");
    }
    const history = input.series.get(symbol) || [];
    if (!history.length) return false;
    const stored = history.find((bar) => bar.date === input.referenceDate);
    const fresh = reference.get(symbol);
    if (fresh && (fresh.date !== input.referenceDate || !Number.isFinite(fresh.close) || fresh.close <= 0)) {
      throw new MarketBreadthSourceError("ADJUSTMENT_HISTORY_INVALID", "Reference adjusted summary has an invalid date or close.");
    }
    return !stored || !fresh || Math.abs(fresh.close - stored.close) > Math.max(1, stored.close) * 1e-8
      || symbol === "SPY" && hasNyseSessionGap(history, input.requestedDate);
  });
  if (changed.length > 50) {
    throw new MarketBreadthSourceError("ADJUSTMENT_REPAIR_LIMIT", "More than 50 histories need adjustment repair; a bounded backfill is required.");
  }
  for (const symbol of changed) {
    const fetched = mergeMarketBreadthPriceBars([], await input.client.fetchCustomBars(symbol, input.fromDate, input.requestedDate));
    const latest = fetched[fetched.length - 1];
    const referenceBar = fetched.find((bar) => bar.date === input.referenceDate);
    const expectedReference = reference.get(symbol);
    const expectedCurrent = input.currentSummary.get(symbol)!;
    if (latest?.date !== input.requestedDate
      || Math.abs(latest.close - expectedCurrent.close) > Math.max(1, expectedCurrent.close) * 1e-8 ||
      (expectedReference && (!referenceBar || Math.abs(referenceBar.close - expectedReference.close) > Math.max(1, expectedReference.close) * 1e-8))
      || symbol === "SPY" && (fetched.length < input.series.get(symbol)!.length || hasNyseSessionGap(fetched, input.requestedDate))) {
      throw new MarketBreadthSourceError("ADJUSTMENT_HISTORY_INVALID", "Repaired adjusted history does not agree with the provider's reference date.");
    }
    input.series.set(symbol, fetched);
  }
  return changed;
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
  const marketDate = marketDateInNewYork(now);
  const requestedDate = input.mode === "DAILY" ? previousNyseTradingDay(marketDate) : marketDate;
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
      const requiredSessions = (symbol: string) => symbol === "SPY" || sectorEtfs.has(symbol) ? 400 : 200;
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
    const fromDate = new Date(now.getTime() - 800 * 86_400_000).toISOString().slice(0, 10);
    const repairedSymbols = latestSnapshot ? await reconcileMarketBreadthAdjustments({
      series, symbols, referenceDate: latestSnapshot.priceAsOf, requestedDate,
      fromDate, currentSummary: dailySummary, client: input.client,
    }) : [];
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
    const requiredSessions = (symbol: string) => symbol === "SPY" || sectorEtfs.has(symbol) ? 400 : 200;
    const newSymbols = symbols.filter((symbol) => (series.get(symbol) || []).length < requiredSessions(symbol) && !attempted.has(symbol));
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
    await finish(input.repository, { runId, status: "READY", priceAsOf: requestedDate, detail: { newSymbolsBackfilled: newSymbols.length, adjustedHistoriesRepaired: repairedSymbols.length } });
    return { status: "READY", runId, priceAsOf: requestedDate };
  } catch (error) {
    const errorClass = errorClassFor(error);
    await finish(input.repository, { runId, status: "FAILED", errorClass, detail: { failed: true } });
    return { status: "FAILED", runId, reason: errorClass };
  }
};
