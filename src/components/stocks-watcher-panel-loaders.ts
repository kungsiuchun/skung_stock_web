import type { FomcRateProbabilityResponse } from "../lib/fomc-rate-probability";
import type { MarketCacheMetadata } from "../lib/market-data-cache";
import { parseJsonResponse } from "../lib/safe-json-response";
import type { StocksWatcherMacroSnapshot } from "../lib/stocks-watcher-macro";
import type { TreasuryYieldCurveResponse } from "../lib/treasury-yield-curve";

export interface StocksWatcherMacroApiResponse {
  data?: StocksWatcherMacroSnapshot;
  cache?: MarketCacheMetadata;
  error?: string;
}

type JsonRecord = Record<string, unknown>;

const MACRO_CHANGE_KEYS = ["oneDay", "oneWeek", "oneMonth", "threeMonth", "yearToDate"] as const;
const TREASURY_CURVE_KEYS = ["latest", "oneWeek", "oneMonth", "startOfYear"] as const;
const FOMC_OUTCOME_LABELS = { cut: "Cut", hold: "Hold", hike: "Hike" } as const;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNullableFiniteNumber = (value: unknown): boolean =>
  value === null || isFiniteNumber(value);

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isIsoMonth = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  return isIsoDate(`${value}-01`);
};

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const invalidData = (source: string, field: string): never => {
  throw new Error(`${source} API returned invalid data: ${field}. Retry this source.`);
};

const requireValid = (condition: boolean, source: string, field: string): void => {
  if (!condition) invalidData(source, field);
};

const expectRecord = (value: unknown, source: string, field: string): JsonRecord => {
  if (!isRecord(value)) invalidData(source, field);
  return value;
};

const expectArray = (value: unknown, source: string, field: string): unknown[] => {
  if (!Array.isArray(value)) invalidData(source, field);
  return value;
};

const expectNonEmptyString = (value: unknown, source: string, field: string): string => {
  if (!isNonEmptyString(value)) invalidData(source, field);
  return value;
};

const expectFiniteNumber = (value: unknown, source: string, field: string): number => {
  if (!isFiniteNumber(value)) invalidData(source, field);
  return value;
};

const expectIsoDate = (value: unknown, source: string, field: string): string => {
  if (!isIsoDate(value)) invalidData(source, field);
  return value;
};

const expectTimestamp = (value: unknown, source: string, field: string): string => {
  if (!isTimestamp(value)) invalidData(source, field);
  return value;
};

const validateMacroSnapshot = (value: unknown): value is StocksWatcherMacroSnapshot => {
  const source = "Macro";
  const data = expectRecord(value, source, "data");
  expectTimestamp(data.generatedAt, source, "data.generatedAt");
  expectIsoDate(data.asOf, source, "data.asOf");

  const markets = expectRecord(data.markets, source, "data.markets");
  expectIsoDate(markets.asOf, source, "data.markets.asOf");
  const marketRows = expectArray(markets.rows, source, "data.markets.rows");
  for (const [index, rawRow] of marketRows.entries()) {
    const row = expectRecord(rawRow, source, `data.markets.rows[${index}]`);
    expectNonEmptyString(row.id, source, `data.markets.rows[${index}].id`);
    expectNonEmptyString(row.label, source, `data.markets.rows[${index}].label`);
    expectNonEmptyString(row.seriesId, source, `data.markets.rows[${index}].seriesId`);
    requireValid(row.frequency === "daily" || row.frequency === "monthly", source, `data.markets.rows[${index}].frequency`);
    expectNonEmptyString(row.unit, source, `data.markets.rows[${index}].unit`);
    expectFiniteNumber(row.value, source, `data.markets.rows[${index}].value`);
    expectIsoDate(row.asOf, source, `data.markets.rows[${index}].asOf`);
    const changes = expectRecord(row.changes, source, `data.markets.rows[${index}].changes`);
    for (const key of MACRO_CHANGE_KEYS) {
      requireValid(isNullableFiniteNumber(changes[key]), source, `data.markets.rows[${index}].changes.${key}`);
    }
  }

  const inflation = expectRecord(data.inflation, source, "data.inflation");
  expectIsoDate(inflation.asOf, source, "data.inflation.asOf");
  const months = expectArray(inflation.months, source, "data.inflation.months");
  requireValid(months.every(isIsoMonth), source, "data.inflation.months");
  const inflationRows = expectArray(inflation.rows, source, "data.inflation.rows");
  for (const [index, rawRow] of inflationRows.entries()) {
    const row = expectRecord(rawRow, source, `data.inflation.rows[${index}]`);
    expectNonEmptyString(row.id, source, `data.inflation.rows[${index}].id`);
    expectNonEmptyString(row.label, source, `data.inflation.rows[${index}].label`);
    expectNonEmptyString(row.unit, source, `data.inflation.rows[${index}].unit`);
    const seriesIds = expectArray(row.seriesIds, source, `data.inflation.rows[${index}].seriesIds`);
    requireValid(seriesIds.length > 0 && seriesIds.every(isNonEmptyString), source, `data.inflation.rows[${index}].seriesIds`);
    const values = expectArray(row.values, source, `data.inflation.rows[${index}].values`);
    requireValid(values.length === months.length && values.every(isNullableFiniteNumber), source, `data.inflation.rows[${index}].values`);
  }

  const sourceMetadata = expectRecord(data.source, source, "data.source");
  expectNonEmptyString(sourceMetadata.provider, source, "data.source.provider");
  expectNonEmptyString(sourceMetadata.url, source, "data.source.url");
  expectNonEmptyString(sourceMetadata.termsUrl, source, "data.source.termsUrl");
  expectNonEmptyString(sourceMetadata.note, source, "data.source.note");
  const series = expectArray(sourceMetadata.series, source, "data.source.series");
  for (const [index, rawSeries] of series.entries()) {
    const seriesEntry = expectRecord(rawSeries, source, `data.source.series[${index}]`);
    expectNonEmptyString(seriesEntry.id, source, `data.source.series[${index}].id`);
    expectNonEmptyString(seriesEntry.url, source, `data.source.series[${index}].url`);
  }

  if (data.cache !== undefined && data.cache !== null) {
    const cache = expectRecord(data.cache, source, "cache");
    requireValid(cache.status === "hit" || cache.status === "refreshed" || cache.status === "stale" || cache.status === "bypassed", source, "cache.status");
    expectTimestamp(cache.cachedAt, source, "cache.cachedAt");
    if (cache.refreshError !== undefined && cache.refreshError !== null) {
      expectNonEmptyString(cache.refreshError, source, "cache.refreshError");
    }
  }
  return true;
};

const validateTreasuryResponse = (value: unknown): value is TreasuryYieldCurveResponse => {
  const source = "Fixed Income";
  const data = expectRecord(value, source, "response");
  expectIsoDate(data.asOfDate, source, "asOfDate");
  expectNonEmptyString(data.sourceUrl, source, "sourceUrl");

  const curves = expectArray(data.curves, source, "curves");
  for (const [index, rawCurve] of curves.entries()) {
    const curve = expectRecord(rawCurve, source, `curves[${index}]`);
    requireValid(TREASURY_CURVE_KEYS.includes(curve.key as (typeof TREASURY_CURVE_KEYS)[number]), source, `curves[${index}].key`);
    expectNonEmptyString(curve.label, source, `curves[${index}].label`);
    expectIsoDate(curve.date, source, `curves[${index}].date`);
    const points = expectArray(curve.points, source, `curves[${index}].points`);
    for (const [pointIndex, rawPoint] of points.entries()) {
      const point = expectRecord(rawPoint, source, `curves[${index}].points[${pointIndex}]`);
      expectNonEmptyString(point.maturity, source, `curves[${index}].points[${pointIndex}].maturity`);
      expectNonEmptyString(point.label, source, `curves[${index}].points[${pointIndex}].label`);
      expectFiniteNumber(point.years, source, `curves[${index}].points[${pointIndex}].years`);
      expectFiniteNumber(point.yield, source, `curves[${index}].points[${pointIndex}].yield`);
    }
  }

  const yieldRows = expectArray(data.yieldRows, source, "yieldRows");
  for (const [index, rawRow] of yieldRows.entries()) {
    const row = expectRecord(rawRow, source, `yieldRows[${index}]`);
    expectNonEmptyString(row.maturity, source, `yieldRows[${index}].maturity`);
    for (const key of ["yield", "oneDayBps", "oneWeekBps", "oneMonthBps", "yearToDateBps"]) {
      expectFiniteNumber(row[key], source, `yieldRows[${index}].${key}`);
    }
  }

  const spreadRows = expectArray(data.spreadRows, source, "spreadRows");
  for (const [index, rawRow] of spreadRows.entries()) {
    const row = expectRecord(rawRow, source, `spreadRows[${index}]`);
    expectNonEmptyString(row.label, source, `spreadRows[${index}].label`);
    for (const key of ["valueBps", "oneDayBps", "oneWeekBps", "oneMonthBps", "yearToDateBps"]) {
      expectFiniteNumber(row[key], source, `spreadRows[${index}].${key}`);
    }
  }

  const sourceMetadata = expectRecord(data.source, source, "source");
  expectNonEmptyString(sourceMetadata.provider, source, "source.provider");
  expectNonEmptyString(sourceMetadata.label, source, "source.label");
  expectNonEmptyString(sourceMetadata.url, source, "source.url");
  expectTimestamp(sourceMetadata.fetchedAt, source, "source.fetchedAt");
  return true;
};

const validateFomcResponse = (value: unknown): value is FomcRateProbabilityResponse => {
  const source = "FOMC probability";
  const data = expectRecord(value, source, "response");
  const meeting = expectRecord(data.meeting, source, "meeting");
  expectNonEmptyString(meeting.eventSlug, source, "meeting.eventSlug");
  expectNonEmptyString(meeting.title, source, "meeting.title");
  expectIsoDate(meeting.date, source, "meeting.date");
  expectTimestamp(meeting.closesAt, source, "meeting.closesAt");
  expectTimestamp(meeting.observedAt, source, "meeting.observedAt");
  expectFiniteNumber(meeting.rawProbabilityTotal, source, "meeting.rawProbabilityTotal");
  const outcomes = expectArray(meeting.outcomes, source, "meeting.outcomes");
  const outcomeKeys = outcomes.map((rawOutcome, index) => {
    const outcome = expectRecord(rawOutcome, source, `meeting.outcomes[${index}]`);
    const expectedLabel = outcome.key === "cut" ? "Cut" : outcome.key === "hold" ? "Hold" : outcome.key === "hike" ? "Hike" : null;
    requireValid(expectedLabel !== null, source, `meeting.outcomes[${index}].key`);
    requireValid(outcome.label === expectedLabel, source, `meeting.outcomes[${index}].label`);
    const probability = expectFiniteNumber(outcome.probability, source, `meeting.outcomes[${index}].probability`);
    requireValid(probability >= 0 && probability <= 100, source, `meeting.outcomes[${index}].probability`);
    return outcome.key;
  });
  requireValid(new Set(outcomeKeys).size === outcomeKeys.length, source, "meeting.outcomes");
  requireValid(outcomes.length === 0 || outcomes.length === Object.keys(FOMC_OUTCOME_LABELS).length, source, "meeting.outcomes");
  const noHikeProbability = expectFiniteNumber(meeting.noHikeProbability, source, "meeting.noHikeProbability");
  requireValid(noHikeProbability >= 0 && noHikeProbability <= 100, source, "meeting.noHikeProbability");
  const volume = expectFiniteNumber(meeting.volume, source, "meeting.volume");
  requireValid(volume >= 0, source, "meeting.volume");

  const sourceMetadata = expectRecord(data.source, source, "source");
  expectNonEmptyString(sourceMetadata.provider, source, "source.provider");
  expectNonEmptyString(sourceMetadata.label, source, "source.label");
  expectNonEmptyString(sourceMetadata.type, source, "source.type");
  expectNonEmptyString(sourceMetadata.url, source, "source.url");
  expectTimestamp(sourceMetadata.fetchedAt, source, "source.fetchedAt");
  return true;
};

const readApiError = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return null;
};

const requestUrl = (path: string, bypassBrowserCache: boolean) =>
  `${path}${bypassBrowserCache ? `?_=${Date.now()}` : ""}`;

export const loadStocksWatcherMacro = async (
  fetchImpl: typeof fetch,
  bypassBrowserCache = false,
): Promise<StocksWatcherMacroApiResponse & { data: StocksWatcherMacroSnapshot }> => {
  const url = requestUrl("/api/stocks-watcher-macro", bypassBrowserCache);
  const response = await fetchImpl(url, bypassBrowserCache ? { cache: "no-store" } : undefined);
  const payload = await parseJsonResponse<StocksWatcherMacroApiResponse>(response, url, { allowHttpError: true });
  if (!response.ok) throw new Error(readApiError(payload) || `Macro API failed with HTTP ${response.status}.`);
  if (!isRecord(payload) || !payload.data) throw new Error("Macro API response did not include data. Retry this source.");
  validateMacroSnapshot(payload.data);
  return payload as StocksWatcherMacroApiResponse & { data: StocksWatcherMacroSnapshot };
};

export const loadStocksWatcherTreasury = async (
  fetchImpl: typeof fetch,
  bypassCache = false,
): Promise<TreasuryYieldCurveResponse> => {
  const url = requestUrl("/api/treasury-yield-curve", bypassCache);
  const response = await fetchImpl(url, bypassCache ? { cache: "no-store" } : undefined);
  const payload = await parseJsonResponse<TreasuryYieldCurveResponse & { error?: string }>(response, url, { allowHttpError: true });
  if (!response.ok) throw new Error(readApiError(payload) || `Fixed Income API failed with HTTP ${response.status}.`);
  validateTreasuryResponse(payload);
  return payload;
};

export const loadStocksWatcherFomc = async (
  fetchImpl: typeof fetch,
  bypassCache = false,
): Promise<FomcRateProbabilityResponse> => {
  const url = requestUrl("/api/fomc-rate-probability", bypassCache);
  const response = await fetchImpl(url, bypassCache ? { cache: "no-store" } : undefined);
  const payload = await parseJsonResponse<FomcRateProbabilityResponse & { error?: string }>(response, url, { allowHttpError: true });
  if (!response.ok) throw new Error(readApiError(payload) || `FOMC probability API failed with HTTP ${response.status}.`);
  validateFomcResponse(payload);
  return payload;
};
