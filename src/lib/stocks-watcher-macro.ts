export const FRED_GRAPH_CSV_ROOT = "https://fred.stlouisfed.org/graph/fredgraph.csv";
export const FRED_SOURCE_URL = "https://fred.stlouisfed.org/";
export const FRED_TERMS_URL = "https://fred.stlouisfed.org/docs/api/terms_of_use.html";

export type MacroSeriesFrequency = "daily" | "monthly";

export interface MacroObservation {
  date: string;
  value: number;
}

export interface MacroMarketChanges {
  oneDay: number | null;
  oneWeek: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  yearToDate: number | null;
}

export interface MacroMarketRow {
  id: string;
  label: string;
  seriesId: string;
  frequency: MacroSeriesFrequency;
  unit: string;
  value: number;
  asOf: string;
  changes: MacroMarketChanges;
}

export interface MacroInflationRow {
  id: string;
  label: string;
  unit: string;
  seriesIds: string[];
  values: Array<number | null>;
}

export interface StocksWatcherMacroSnapshot {
  generatedAt: string;
  asOf: string;
  markets: {
    asOf: string;
    rows: MacroMarketRow[];
  };
  inflation: {
    asOf: string;
    months: string[];
    rows: MacroInflationRow[];
  };
  source: {
    provider: "Federal Reserve Economic Data (FRED)";
    url: string;
    termsUrl: string;
    series: Array<{ id: string; url: string }>;
    note: string;
  };
}

export interface MacroMarketDefinition {
  id: string;
  label: string;
  seriesId: string;
  frequency: MacroSeriesFrequency;
  unit: string;
}

export const MACRO_MARKET_DEFINITIONS: readonly MacroMarketDefinition[] = [
  { id: "wti", label: "WTI Crude Oil", seriesId: "DCOILWTICO", frequency: "daily", unit: "USD / bbl" },
  { id: "brent", label: "Brent Crude Oil", seriesId: "DCOILBRENTEU", frequency: "daily", unit: "USD / bbl" },
  { id: "natural-gas", label: "Natural Gas · Henry Hub", seriesId: "DHHNGSP", frequency: "daily", unit: "USD / MMBtu" },
  { id: "copper", label: "Copper · Global", seriesId: "PCOPPUSDM", frequency: "monthly", unit: "USD / metric ton" },
  { id: "uranium", label: "Uranium · Global", seriesId: "PURANUSDM", frequency: "monthly", unit: "USD / lb" },
  { id: "usd", label: "U.S. Dollar · Broad Index", seriesId: "DTWEXBGS", frequency: "daily", unit: "Index 2006=100" },
  { id: "all-commodities", label: "All Commodities", seriesId: "PALLFNFINDEXM", frequency: "monthly", unit: "Index 2016=100" },
  { id: "energy-index", label: "Energy Basket", seriesId: "PNRGINDEXM", frequency: "monthly", unit: "Index 2016=100" },
  { id: "metals-index", label: "Metals Basket", seriesId: "PMETAINDEXM", frequency: "monthly", unit: "Index 2016=100" },
] as const;

export const MACRO_INFLATION_SERIES_IDS = [
  "PCEPI",
  "PCEPILFE",
  "PCETRIM1M158SFRBDAL",
  "PCETRIM6M680SFRBDAL",
  "PCETRIM12M159SFRBDAL",
  "PI",
  "PCE",
] as const;

export const MACRO_FRED_SERIES_IDS = Array.from(new Set([
  ...MACRO_MARKET_DEFINITIONS.map((definition) => definition.seriesId),
  ...MACRO_INFLATION_SERIES_IDS,
]));

/**
 * FRED graph downloads support multiple same-frequency series in one CSV.
 * Keep each group at five or fewer series so one dashboard refresh stays
 * below Cloudflare Workers' six simultaneous outgoing-connection limit.
 */
export const MACRO_FRED_SERIES_GROUPS: readonly (readonly string[])[] = [
  MACRO_MARKET_DEFINITIONS.filter((definition) => definition.frequency === "daily").map((definition) => definition.seriesId),
  MACRO_MARKET_DEFINITIONS.filter((definition) => definition.frequency === "monthly").map((definition) => definition.seriesId),
  ["PCEPI", "PCEPILFE", "PI", "PCE"],
  ["PCETRIM1M158SFRBDAL", "PCETRIM6M680SFRBDAL", "PCETRIM12M159SFRBDAL"],
] as const;

export class StocksWatcherMacroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StocksWatcherMacroError";
  }
}

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const parseFredCsv = (
  payload: string,
  expectedSeriesIds: readonly string[],
): Record<string, MacroObservation[]> => {
  const lines = payload.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const columns = lines[0]?.split(",").map((value) => value.trim()) || [];
  if (columns[0] !== "observation_date") {
    throw new StocksWatcherMacroError("FRED CSV response did not begin with observation_date.");
  }

  const indexes = expectedSeriesIds.map((seriesId) => {
    const index = columns.indexOf(seriesId);
    if (index < 1) throw new StocksWatcherMacroError(`FRED CSV response did not contain series ${seriesId}.`);
    return [seriesId, index] as const;
  });
  const parsed = Object.fromEntries(expectedSeriesIds.map((seriesId) => [seriesId, []])) as Record<string, MacroObservation[]>;

  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const date = cells[0]?.trim();
    if (!isIsoDate(date)) continue;
    for (const [seriesId, index] of indexes) {
      const rawValue = cells[index]?.trim();
      if (!rawValue || rawValue === ".") continue;
      const value = Number(rawValue);
      if (Number.isFinite(value)) parsed[seriesId].push({ date, value });
    }
  }

  for (const seriesId of expectedSeriesIds) {
    parsed[seriesId].sort((left, right) => left.date.localeCompare(right.date));
    parsed[seriesId] = parsed[seriesId].slice(-500);
    if (parsed[seriesId].length === 0) {
      throw new StocksWatcherMacroError(`FRED ${seriesId} returned no finite observations.`);
    }
  }
  return parsed;
};

const percentChange = (current: number, prior: number | undefined) => {
  if (!Number.isFinite(current) || typeof prior !== "number" || !Number.isFinite(prior) || prior === 0) return null;
  return ((current / prior) - 1) * 100;
};

const shiftUtcDate = (date: string, unit: "day" | "month", amount: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  if (unit === "day") next.setUTCDate(next.getUTCDate() + amount);
  else {
    const originalDay = next.getUTCDate();
    const targetMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + amount, 1));
    const lastTargetDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
    targetMonth.setUTCDate(Math.min(originalDay, lastTargetDay));
    return targetMonth.toISOString().slice(0, 10);
  }
  return next.toISOString().slice(0, 10);
};

const findAtOrBefore = (observations: MacroObservation[], target: string, beforeDate?: string) => {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index];
    if (observation.date <= target && (!beforeDate || observation.date < beforeDate)) return observation;
  }
  return undefined;
};

const buildMarketRow = (
  definition: MacroMarketDefinition,
  observations: MacroObservation[],
): MacroMarketRow => {
  const latest = observations[observations.length - 1];
  if (!latest) throw new StocksWatcherMacroError(`FRED ${definition.seriesId} returned no market observation.`);
  const previousYearEnd = findAtOrBefore(observations, `${Number(latest.date.slice(0, 4)) - 1}-12-31`, latest.date);
  const oneMonthPrior = findAtOrBefore(observations, shiftUtcDate(latest.date, "month", -1), latest.date);
  const threeMonthPrior = findAtOrBefore(observations, shiftUtcDate(latest.date, "month", -3), latest.date);
  const previous = observations.length > 1 ? observations[observations.length - 2] : undefined;
  const oneWeekPrior = findAtOrBefore(observations, shiftUtcDate(latest.date, "day", -7), latest.date);

  return {
    ...definition,
    value: latest.value,
    asOf: latest.date,
    changes: {
      oneDay: definition.frequency === "daily" ? percentChange(latest.value, previous?.value) : null,
      oneWeek: definition.frequency === "daily" ? percentChange(latest.value, oneWeekPrior?.value) : null,
      oneMonth: percentChange(latest.value, oneMonthPrior?.value),
      threeMonth: percentChange(latest.value, threeMonthPrior?.value),
      yearToDate: percentChange(latest.value, previousYearEnd?.value),
    },
  };
};

const toMonthKey = (date: string) => date.slice(0, 7);

const directMonthlyValues = (observations: MacroObservation[]) =>
  new Map(observations.map((observation) => [toMonthKey(observation.date), observation.value]));

const derivedMonthlyChanges = (observations: MacroObservation[], periods: number) => {
  const values = new Map<string, number>();
  observations.forEach((observation, index) => {
    const prior = observations[index - periods];
    const change = percentChange(observation.value, prior?.value);
    if (change !== null) values.set(toMonthKey(observation.date), change);
  });
  return values;
};

const valuesForMonths = (values: Map<string, number>, months: string[]) =>
  months.map((month) => values.get(month) ?? null);

const requireSeries = (
  observationsBySeries: Readonly<Record<string, MacroObservation[]>>,
  seriesId: string,
) => {
  const observations = observationsBySeries[seriesId];
  if (!observations?.length) throw new StocksWatcherMacroError(`Missing required FRED series ${seriesId}.`);
  return observations;
};

export const buildStocksWatcherMacroSnapshot = (
  observationsBySeries: Readonly<Record<string, MacroObservation[]>>,
  generatedAt = new Date().toISOString(),
): StocksWatcherMacroSnapshot => {
  const marketRows = MACRO_MARKET_DEFINITIONS.map((definition) =>
    buildMarketRow(definition, requireSeries(observationsBySeries, definition.seriesId)));

  const headlinePce = requireSeries(observationsBySeries, "PCEPI");
  const corePce = requireSeries(observationsBySeries, "PCEPILFE");
  const headlineYoy = derivedMonthlyChanges(headlinePce, 12);
  const months = Array.from(headlineYoy.keys()).sort().slice(-12);
  if (months.length !== 12) throw new StocksWatcherMacroError("FRED PCE history did not cover twelve monthly releases.");

  const inflationRows: MacroInflationRow[] = [
    { id: "headline-pce", label: "Headline PCE", unit: "YoY %", seriesIds: ["PCEPI"], values: valuesForMonths(headlineYoy, months) },
    { id: "core-pce", label: "Core PCE · ex food & energy", unit: "YoY %", seriesIds: ["PCEPILFE"], values: valuesForMonths(derivedMonthlyChanges(corePce, 12), months) },
    { id: "trimmed-pce-1m", label: "Trimmed Mean PCE · 1M annualized", unit: "Ann. %", seriesIds: ["PCETRIM1M158SFRBDAL"], values: valuesForMonths(directMonthlyValues(requireSeries(observationsBySeries, "PCETRIM1M158SFRBDAL")), months) },
    { id: "trimmed-pce-6m", label: "Trimmed Mean PCE · 6M annualized", unit: "Ann. %", seriesIds: ["PCETRIM6M680SFRBDAL"], values: valuesForMonths(directMonthlyValues(requireSeries(observationsBySeries, "PCETRIM6M680SFRBDAL")), months) },
    { id: "trimmed-pce-12m", label: "Trimmed Mean PCE · 12M", unit: "YoY %", seriesIds: ["PCETRIM12M159SFRBDAL"], values: valuesForMonths(directMonthlyValues(requireSeries(observationsBySeries, "PCETRIM12M159SFRBDAL")), months) },
    { id: "personal-income", label: "Personal Income", unit: "MoM %", seriesIds: ["PI"], values: valuesForMonths(derivedMonthlyChanges(requireSeries(observationsBySeries, "PI"), 1), months) },
    { id: "personal-spending", label: "Personal Spending", unit: "MoM %", seriesIds: ["PCE"], values: valuesForMonths(derivedMonthlyChanges(requireSeries(observationsBySeries, "PCE"), 1), months) },
  ];

  const sortedMarketDates = marketRows.map((row) => row.asOf).sort();
  const marketAsOf = sortedMarketDates[sortedMarketDates.length - 1] || generatedAt.slice(0, 10);
  const inflationAsOf = `${months[months.length - 1]}-01`;
  const sortedSourceDates = [marketAsOf, inflationAsOf].sort();
  const asOf = sortedSourceDates[sortedSourceDates.length - 1] || generatedAt.slice(0, 10);

  return {
    generatedAt,
    asOf,
    markets: { asOf: marketAsOf, rows: marketRows },
    inflation: { asOf: inflationAsOf, months, rows: inflationRows },
    source: {
      provider: "Federal Reserve Economic Data (FRED)",
      url: FRED_SOURCE_URL,
      termsUrl: FRED_TERMS_URL,
      series: MACRO_FRED_SERIES_IDS.map((id) => ({ id, url: `https://fred.stlouisfed.org/series/${id}` })),
      note: "Daily EIA/Federal Reserve and monthly IMF/BEA/Dallas Fed series retrieved through FRED. Values may be revised.",
    },
  };
};
