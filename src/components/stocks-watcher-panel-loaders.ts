import type { FomcRateProbabilityResponse } from "../lib/fomc-rate-probability";
import type { MarketCacheMetadata } from "../lib/market-data-cache";
import { parseJsonResponse } from "../lib/safe-json-response";
import {
  FRED_SOURCE_URL,
  FRED_TERMS_URL,
  MACRO_FRED_SERIES_IDS,
  MACRO_MARKET_DEFINITIONS,
  type StocksWatcherMacroSnapshot,
} from "../lib/stocks-watcher-macro";
import type { TreasuryYieldCurveResponse } from "../lib/treasury-yield-curve";

export interface StocksWatcherMacroApiResponse {
  data?: StocksWatcherMacroSnapshot;
  cache?: MarketCacheMetadata;
  error?: string;
}

type JsonRecord = Record<string, unknown>;

const MACRO_CHANGE_KEYS = ["oneDay", "oneWeek", "oneMonth", "threeMonth", "yearToDate"] as const;
const FOMC_OUTCOME_LABELS = { cut: "Cut", hold: "Hold", hike: "Hike" } as const;
const MACRO_INFLATION_ROWS = [
  { id: "headline-pce", label: "Headline PCE", unit: "YoY %", seriesId: "PCEPI" },
  { id: "core-pce", label: "Core PCE · ex food & energy", unit: "YoY %", seriesId: "PCEPILFE" },
  { id: "trimmed-pce-1m", label: "Trimmed Mean PCE · 1M annualized", unit: "Ann. %", seriesId: "PCETRIM1M158SFRBDAL" },
  { id: "trimmed-pce-6m", label: "Trimmed Mean PCE · 6M annualized", unit: "Ann. %", seriesId: "PCETRIM6M680SFRBDAL" },
  { id: "trimmed-pce-12m", label: "Trimmed Mean PCE · 12M", unit: "YoY %", seriesId: "PCETRIM12M159SFRBDAL" },
  { id: "personal-income", label: "Personal Income", unit: "MoM %", seriesId: "PI" },
  { id: "personal-spending", label: "Personal Spending", unit: "MoM %", seriesId: "PCE" },
] as const;
const TREASURY_CURVE_CONTRACTS = [
  { key: "latest", label: "Latest published" },
  { key: "oneWeek", label: "1 week ago" },
  { key: "oneMonth", label: "1 month ago" },
  { key: "startOfYear", label: "Start of year" },
] as const;
const TREASURY_MATURITY_CONTRACTS = [
  { maturity: "1M", years: 1 / 12 },
  { maturity: "1.5M", years: 1.5 / 12 },
  { maturity: "2M", years: 2 / 12 },
  { maturity: "3M", years: 3 / 12 },
  { maturity: "4M", years: 4 / 12 },
  { maturity: "6M", years: 6 / 12 },
  { maturity: "1Y", years: 1 },
  { maturity: "2Y", years: 2 },
  { maturity: "3Y", years: 3 },
  { maturity: "5Y", years: 5 },
  { maturity: "7Y", years: 7 },
  { maturity: "10Y", years: 10 },
  { maturity: "20Y", years: 20 },
  { maturity: "30Y", years: 30 },
] as const;
const TREASURY_SPREAD_LABELS = ["10Y - 2Y", "10Y - 3M"] as const;
const CACHE_STATUS_VALUES = ["hit", "refreshed", "stale", "bypassed"] as const;
const CACHE_GUARD_VALUES = ["fresh", "near_expiry", "stale", "bypassed"] as const;
const CACHE_ROW_READ_VALUES = ["bypassed", "miss", "hit", "failed"] as const;
const CACHE_ROW_WRITE_VALUES = ["bypassed", "written", "failed"] as const;

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

const isTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isIsoDate(match[1])) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (hours > 23 || minutes > 59 || seconds > 59) return false;
  if (match[6] !== "Z") {
    const offset = match[6].slice(1).split(":").map(Number);
    if (offset[0] > 23 || offset[1] > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
};

const isStrictlyIncreasing = (values: readonly unknown[]): boolean =>
  values.every((value, index) => {
    if (index === 0) return typeof value === "string";
    const previous = values[index - 1];
    return typeof value === "string" && typeof previous === "string" && value > previous;
  });

const isNonIncreasing = (values: readonly unknown[]): boolean =>
  values.every((value, index) => {
    if (index === 0) return typeof value === "string";
    const previous = values[index - 1];
    return typeof value === "string" && typeof previous === "string" && value <= previous;
  });

function invalidData(source: string, field: string): never {
  throw new Error(`${source} API returned invalid data: ${field}. Retry this source.`);
}

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
  const asOf = expectIsoDate(data.asOf, source, "data.asOf");

  const markets = expectRecord(data.markets, source, "data.markets");
  const marketsAsOf = expectIsoDate(markets.asOf, source, "data.markets.asOf");
  const marketRows = expectArray(markets.rows, source, "data.markets.rows");
  requireValid(marketRows.length === MACRO_MARKET_DEFINITIONS.length, source, "data.markets.rows");
  const marketDates: string[] = [];
  for (const [index, rawRow] of marketRows.entries()) {
    const row = expectRecord(rawRow, source, `data.markets.rows[${index}]`);
    const expected = MACRO_MARKET_DEFINITIONS[index];
    requireValid(row.id === expected.id, source, `data.markets.rows[${index}].id`);
    requireValid(row.label === expected.label, source, `data.markets.rows[${index}].label`);
    requireValid(row.seriesId === expected.seriesId, source, `data.markets.rows[${index}].seriesId`);
    requireValid(row.frequency === expected.frequency, source, `data.markets.rows[${index}].frequency`);
    requireValid(row.unit === expected.unit, source, `data.markets.rows[${index}].unit`);
    expectFiniteNumber(row.value, source, `data.markets.rows[${index}].value`);
    marketDates.push(expectIsoDate(row.asOf, source, `data.markets.rows[${index}].asOf`));
    const changes = expectRecord(row.changes, source, `data.markets.rows[${index}].changes`);
    for (const key of MACRO_CHANGE_KEYS) {
      requireValid(isNullableFiniteNumber(changes[key]), source, `data.markets.rows[${index}].changes.${key}`);
    }
  }
  const sortedMarketDates = [...marketDates].sort();
  const latestMarketAsOf = sortedMarketDates[sortedMarketDates.length - 1];
  requireValid(latestMarketAsOf === marketsAsOf, source, "data.markets.asOf");

  const inflation = expectRecord(data.inflation, source, "data.inflation");
  const inflationAsOf = expectIsoDate(inflation.asOf, source, "data.inflation.asOf");
  const months = expectArray(inflation.months, source, "data.inflation.months");
  requireValid(months.length === 12 && months.every(isIsoMonth) && isStrictlyIncreasing(months), source, "data.inflation.months");
  const lastMonth = months[months.length - 1];
  requireValid(inflationAsOf === `${lastMonth}-01`, source, "data.inflation.asOf");
  const inflationRows = expectArray(inflation.rows, source, "data.inflation.rows");
  requireValid(inflationRows.length === MACRO_INFLATION_ROWS.length, source, "data.inflation.rows");
  for (const [index, rawRow] of inflationRows.entries()) {
    const row = expectRecord(rawRow, source, `data.inflation.rows[${index}]`);
    const expected = MACRO_INFLATION_ROWS[index];
    requireValid(row.id === expected.id, source, `data.inflation.rows[${index}].id`);
    requireValid(row.label === expected.label, source, `data.inflation.rows[${index}].label`);
    requireValid(row.unit === expected.unit, source, `data.inflation.rows[${index}].unit`);
    const seriesIds = expectArray(row.seriesIds, source, `data.inflation.rows[${index}].seriesIds`);
    requireValid(seriesIds.length === 1 && seriesIds[0] === expected.seriesId, source, `data.inflation.rows[${index}].seriesIds`);
    const values = expectArray(row.values, source, `data.inflation.rows[${index}].values`);
    requireValid(values.length === months.length && values.every(isNullableFiniteNumber), source, `data.inflation.rows[${index}].values`);
  }
  const sortedAsOfDates = [marketsAsOf, inflationAsOf].sort();
  const expectedAsOf = sortedAsOfDates[sortedAsOfDates.length - 1];
  requireValid(expectedAsOf === asOf, source, "data.asOf");

  const sourceMetadata = expectRecord(data.source, source, "data.source");
  requireValid(sourceMetadata.provider === "Federal Reserve Economic Data (FRED)", source, "data.source.provider");
  requireValid(sourceMetadata.url === FRED_SOURCE_URL, source, "data.source.url");
  requireValid(sourceMetadata.termsUrl === FRED_TERMS_URL, source, "data.source.termsUrl");
  expectNonEmptyString(sourceMetadata.note, source, "data.source.note");
  const series = expectArray(sourceMetadata.series, source, "data.source.series");
  requireValid(series.length === MACRO_FRED_SERIES_IDS.length, source, "data.source.series");
  for (const [index, rawSeries] of series.entries()) {
    const seriesEntry = expectRecord(rawSeries, source, `data.source.series[${index}]`);
    const expectedSeriesId = MACRO_FRED_SERIES_IDS[index];
    requireValid(seriesEntry.id === expectedSeriesId, source, `data.source.series[${index}].id`);
    requireValid(seriesEntry.url === `https://fred.stlouisfed.org/series/${expectedSeriesId}`, source, `data.source.series[${index}].url`);
  }
  return true;
};

const validateMacroCache = (value: unknown): value is MarketCacheMetadata => {
  const source = "Macro";
  const cache = expectRecord(value, source, "cache");
  requireValid(CACHE_STATUS_VALUES.includes(cache.status as (typeof CACHE_STATUS_VALUES)[number]), source, "cache.status");
  expectTimestamp(cache.cachedAt, source, "cache.cachedAt");
  expectTimestamp(cache.expiresAt, source, "cache.expiresAt");
  requireValid(cache.dataset === "history", source, "cache.dataset");
  requireValid(expectFiniteNumber(cache.ageSeconds, source, "cache.ageSeconds") >= 0, source, "cache.ageSeconds");
  requireValid(expectFiniteNumber(cache.ttlMs, source, "cache.ttlMs") > 0, source, "cache.ttlMs");
  requireValid(expectFiniteNumber(cache.ageRatio, source, "cache.ageRatio") >= 0, source, "cache.ageRatio");
  requireValid(CACHE_GUARD_VALUES.includes(cache.guard as (typeof CACHE_GUARD_VALUES)[number]), source, "cache.guard");
  requireValid(typeof cache.rowRead === "boolean", source, "cache.rowRead");
  requireValid(typeof cache.rowWritten === "boolean", source, "cache.rowWritten");
  const observability = expectRecord(cache.observability, source, "cache.observability");
  requireValid(CACHE_ROW_READ_VALUES.includes(observability.rowRead as (typeof CACHE_ROW_READ_VALUES)[number]), source, "cache.observability.rowRead");
  requireValid(CACHE_ROW_WRITE_VALUES.includes(observability.rowWritten as (typeof CACHE_ROW_WRITE_VALUES)[number]), source, "cache.observability.rowWritten");
  requireValid(Number.isInteger(expectFiniteNumber(cache.rowsRead, source, "cache.rowsRead")) && (cache.rowsRead as number) >= 0, source, "cache.rowsRead");
  requireValid(Number.isInteger(expectFiniteNumber(cache.rowsWritten, source, "cache.rowsWritten")) && (cache.rowsWritten as number) >= 0, source, "cache.rowsWritten");
  if (cache.sourceAsOf !== undefined && cache.sourceAsOf !== null) expectIsoDate(cache.sourceAsOf, source, "cache.sourceAsOf");
  if (cache.refreshError !== undefined && cache.refreshError !== null) expectNonEmptyString(cache.refreshError, source, "cache.refreshError");
  return true;
};

const validateTreasuryResponse = (value: unknown): value is TreasuryYieldCurveResponse => {
  const source = "Fixed Income";
  const data = expectRecord(value, source, "response");
  const asOfDate = expectIsoDate(data.asOfDate, source, "asOfDate");
  expectNonEmptyString(data.sourceUrl, source, "sourceUrl");

  const curves = expectArray(data.curves, source, "curves");
  requireValid(curves.length === TREASURY_CURVE_CONTRACTS.length, source, "curves");
  const curveDates: string[] = [];
  const latestYields: number[] = [];
  for (const [index, rawCurve] of curves.entries()) {
    const curve = expectRecord(rawCurve, source, `curves[${index}]`);
    const expectedCurve = TREASURY_CURVE_CONTRACTS[index];
    requireValid(curve.key === expectedCurve.key, source, `curves[${index}].key`);
    requireValid(curve.label === expectedCurve.label, source, `curves[${index}].label`);
    curveDates.push(expectIsoDate(curve.date, source, `curves[${index}].date`));
    const points = expectArray(curve.points, source, `curves[${index}].points`);
    requireValid(points.length === TREASURY_MATURITY_CONTRACTS.length, source, `curves[${index}].points`);
    for (const [pointIndex, rawPoint] of points.entries()) {
      const point = expectRecord(rawPoint, source, `curves[${index}].points[${pointIndex}]`);
      const expectedMaturity = TREASURY_MATURITY_CONTRACTS[pointIndex];
      requireValid(point.maturity === expectedMaturity.maturity, source, `curves[${index}].points[${pointIndex}].maturity`);
      requireValid(point.label === expectedMaturity.maturity, source, `curves[${index}].points[${pointIndex}].label`);
      requireValid(expectFiniteNumber(point.years, source, `curves[${index}].points[${pointIndex}].years`) === expectedMaturity.years, source, `curves[${index}].points[${pointIndex}].years`);
      const yieldValue = expectFiniteNumber(point.yield, source, `curves[${index}].points[${pointIndex}].yield`);
      if (index === 0) latestYields.push(yieldValue);
    }
  }
  requireValid(isNonIncreasing(curveDates.slice(0, 3)) && curveDates[3] <= curveDates[0], source, "curves.date");
  requireValid(asOfDate === curveDates[0], source, "asOfDate");

  const yieldRows = expectArray(data.yieldRows, source, "yieldRows");
  requireValid(yieldRows.length === TREASURY_MATURITY_CONTRACTS.length, source, "yieldRows");
  for (const [index, rawRow] of yieldRows.entries()) {
    const row = expectRecord(rawRow, source, `yieldRows[${index}]`);
    const expectedMaturity = TREASURY_MATURITY_CONTRACTS[index];
    requireValid(row.maturity === expectedMaturity.maturity, source, `yieldRows[${index}].maturity`);
    requireValid(expectFiniteNumber(row.yield, source, `yieldRows[${index}].yield`) === latestYields[index], source, `yieldRows[${index}].yield`);
    for (const key of ["yield", "oneDayBps", "oneWeekBps", "oneMonthBps", "yearToDateBps"]) {
      expectFiniteNumber(row[key], source, `yieldRows[${index}].${key}`);
    }
  }

  const spreadRows = expectArray(data.spreadRows, source, "spreadRows");
  requireValid(spreadRows.length === TREASURY_SPREAD_LABELS.length, source, "spreadRows");
  for (const [index, rawRow] of spreadRows.entries()) {
    const row = expectRecord(rawRow, source, `spreadRows[${index}]`);
    requireValid(row.label === TREASURY_SPREAD_LABELS[index], source, `spreadRows[${index}].label`);
    const shortIndex = index === 0 ? 7 : 3;
    requireValid(expectFiniteNumber(row.valueBps, source, `spreadRows[${index}].valueBps`) === Number(((latestYields[11] - latestYields[shortIndex]) * 100).toFixed(1)), source, `spreadRows[${index}].valueBps`);
    for (const key of ["valueBps", "oneDayBps", "oneWeekBps", "oneMonthBps", "yearToDateBps"]) {
      expectFiniteNumber(row[key], source, `spreadRows[${index}].${key}`);
    }
  }

  const sourceMetadata = expectRecord(data.source, source, "source");
  requireValid(sourceMetadata.provider === "U.S. Department of the Treasury", source, "source.provider");
  requireValid(sourceMetadata.label === "Daily Treasury Par Yield Curve Rates", source, "source.label");
  expectNonEmptyString(sourceMetadata.url, source, "source.url");
  requireValid(sourceMetadata.url === data.sourceUrl, source, "source.url");
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
  requireValid(meeting.dateBasis === undefined || meeting.dateBasis === "market_close_utc", source, "meeting.dateBasis");
  requireValid(meeting.date === new Date(meeting.closesAt as string).toISOString().slice(0, 10)
    || (meeting.dateBasis === undefined && meeting.date === (meeting.closesAt as string).slice(0, 10)), source, "meeting.date");
  expectFiniteNumber(meeting.rawProbabilityTotal, source, "meeting.rawProbabilityTotal");
  const outcomes = expectArray(meeting.outcomes, source, "meeting.outcomes");
  requireValid(outcomes.length === Object.keys(FOMC_OUTCOME_LABELS).length, source, "meeting.outcomes");
  const probabilities: number[] = [];
  const outcomeKeys = outcomes.map((rawOutcome, index) => {
    const outcome = expectRecord(rawOutcome, source, `meeting.outcomes[${index}]`);
    const expectedKey = Object.keys(FOMC_OUTCOME_LABELS)[index] as keyof typeof FOMC_OUTCOME_LABELS;
    requireValid(outcome.key === expectedKey, source, `meeting.outcomes[${index}].key`);
    requireValid(outcome.label === FOMC_OUTCOME_LABELS[expectedKey], source, `meeting.outcomes[${index}].label`);
    const probability = expectFiniteNumber(outcome.probability, source, `meeting.outcomes[${index}].probability`);
    requireValid(probability >= 0 && probability <= 100, source, `meeting.outcomes[${index}].probability`);
    probabilities.push(probability);
    return outcome.key;
  });
  requireValid(new Set(outcomeKeys).size === outcomeKeys.length, source, "meeting.outcomes");
  requireValid(expectFiniteNumber(meeting.rawProbabilityTotal, source, "meeting.rawProbabilityTotal") >= 0.95 && (meeting.rawProbabilityTotal as number) <= 1.05, source, "meeting.rawProbabilityTotal");
  requireValid(Math.abs(probabilities.reduce((total, probability) => total + probability, 0) - 100) <= 0.2, source, "meeting.outcomes");
  const noHikeProbability = expectFiniteNumber(meeting.noHikeProbability, source, "meeting.noHikeProbability");
  requireValid(noHikeProbability >= 0 && noHikeProbability <= 100, source, "meeting.noHikeProbability");
  requireValid(noHikeProbability === Number((probabilities[0] + probabilities[1]).toFixed(1)), source, "meeting.noHikeProbability");
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
  if (payload.cache !== undefined && payload.cache !== null) validateMacroCache(payload.cache);
  if (!validateMacroSnapshot(payload.data)) invalidData("Macro", "data");
  return { ...payload, data: payload.data };
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
