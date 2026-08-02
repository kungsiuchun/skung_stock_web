import { normalizeStocksWatcherSymbol } from "./stocks-native-yahoo";

export const WATCHER_VALUATION_SCHEMA_VERSION = "1.0";
export const WATCHER_VALUATION_METRICS = ["pe", "fcf", "ps"] as const;
export const WATCHER_VALUATION_WINDOWS = ["1Y", "2Y", "3Y", "5Y"] as const;
export type WatcherValuationMetric = typeof WATCHER_VALUATION_METRICS[number];
export type WatcherValuationWindow = typeof WATCHER_VALUATION_WINDOWS[number];

interface R2ObjectBodyLike { json: () => Promise<unknown>; httpEtag?: string; }
export interface R2BucketLike {
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  put?: (key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) => Promise<unknown | null>;
}
export interface WatcherValuationRelease { schemaVersion: string; releaseId: string; generatedAt: string; }
export type WatcherCoverageStatus = "published" | "queued" | "unavailable";
export interface WatcherCoverageRecord { symbol: string; requestedAt: string; state: "queued" | "published"; }
export interface WatcherCoverageRegistry { schemaVersion: string; updatedAt: string; symbols: WatcherCoverageRecord[]; }

export interface WatcherValuationBandPoint {
  date: string;
  price: number | null;
  bands: { mean: number | null; up1: number | null; up2: number | null; down1: number | null; down2: number | null; };
}

export interface WatcherValuationBands {
  schemaVersion: string;
  source: string;
  symbol: string;
  generatedAt: string;
  dataAsOf: string;
  metric: WatcherValuationMetric;
  window: WatcherValuationWindow;
  latest: WatcherValuationBandPoint;
  points: WatcherValuationBandPoint[];
}

export interface WatcherFinancialQuarter {
  date: string;
  filingDate: string | null;
  fiscalYear: string | null;
  period: string | null;
  currency: string | null;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  revenue_qoq: number | null;
  revenue_yoy: number | null;
  netIncome_qoq: number | null;
  netIncome_yoy: number | null;
  eps_qoq: number | null;
  eps_yoy: number | null;
  operatingCashFlow_qoq: number | null;
  operatingCashFlow_yoy: number | null;
}

export interface WatcherFinancialStatements {
  schemaVersion: string;
  source: string;
  symbol: string;
  generatedAt: string;
  dataAsOf: string;
  quarters: WatcherFinancialQuarter[];
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const nullableString = (value: unknown) => typeof value === "string" ? value : null;
const fail = (message: string): never => { throw new Error(`VALUATION_DATA_INVALID: ${message}`); };

export const parseWatcherValuationMetric = (value: unknown): WatcherValuationMetric => {
  const metric = String(value || "pe").toLowerCase();
  if (!WATCHER_VALUATION_METRICS.includes(metric as WatcherValuationMetric)) throw new Error("VALUATION_DATA_INVALID: metric must be pe, fcf, or ps.");
  return metric as WatcherValuationMetric;
};

export const parseWatcherValuationWindow = (value: unknown): WatcherValuationWindow => {
  const window = String(value || "3Y").toUpperCase();
  if (!WATCHER_VALUATION_WINDOWS.includes(window as WatcherValuationWindow)) throw new Error("VALUATION_DATA_INVALID: window must be 1Y, 2Y, 3Y, or 5Y.");
  return window as WatcherValuationWindow;
};

const assertFresh = (generatedAt: string) => {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) fail("generatedAt is invalid");
  if (Date.now() - timestamp > 72 * 60 * 60 * 1000) throw new Error("VALUATION_DATA_STALE: published data is older than 72 hours.");
};

const parsePoint = (value: unknown): WatcherValuationBandPoint => {
  const row = record(value);
  const bands = record(row?.bands);
  if (!row || !bands || !nullableString(row.date)) fail("valuation point is malformed");
  const validRow = row as Record<string, unknown>;
  const validBands = bands as Record<string, unknown>;
  return { date: validRow.date as string, price: nullableNumber(validRow.price), bands: { mean: nullableNumber(validBands.mean), up1: nullableNumber(validBands.up1), up2: nullableNumber(validBands.up2), down1: nullableNumber(validBands.down1), down2: nullableNumber(validBands.down2) } };
};

const parseValuation = (value: unknown, symbol: string, metric: WatcherValuationMetric, window: WatcherValuationWindow): WatcherValuationBands => {
  const body = record(value);
  if (!body || body.schemaVersion !== WATCHER_VALUATION_SCHEMA_VERSION || body.symbol !== symbol || body.metric !== metric || body.window !== window) fail("valuation contract mismatch");
  const validBody = body as Record<string, unknown>;
  const generatedAt = nullableString(validBody.generatedAt);
  const dataAsOf = nullableString(validBody.dataAsOf);
  const rawPoints = validBody.points;
  if (!generatedAt || !dataAsOf || !Array.isArray(rawPoints)) throw new Error("VALUATION_DATA_INVALID: valuation metadata is missing");
  assertFresh(generatedAt);
  const points = rawPoints.map(parsePoint);
  if (!points.length) fail("valuation points are empty");
  return { schemaVersion: validBody.schemaVersion as string, source: nullableString(validBody.source) || "ValuationCalculation", symbol, generatedAt, dataAsOf, metric, window, latest: parsePoint(validBody.latest), points };
};

const parseFinancials = (value: unknown, symbol: string): WatcherFinancialStatements => {
  const body = record(value);
  if (!body || body.schemaVersion !== WATCHER_VALUATION_SCHEMA_VERSION || body.symbol !== symbol || !Array.isArray(body.quarters)) fail("financial contract mismatch");
  const validBody = body as Record<string, unknown>;
  const generatedAt = nullableString(validBody.generatedAt);
  const dataAsOf = nullableString(validBody.dataAsOf);
  const rawQuarters = validBody.quarters as unknown[];
  if (!generatedAt || !dataAsOf) throw new Error("VALUATION_DATA_INVALID: financial metadata is missing");
  assertFresh(generatedAt);
  const quarters = rawQuarters.map((value) => {
    const row = record(value);
    if (!row || !nullableString(row.date)) fail("financial quarter is malformed");
    const validRow = row as Record<string, unknown>;
    const key = (name: string) => nullableNumber(validRow[name]);
    return { date: validRow.date as string, filingDate: nullableString(validRow.filingDate), fiscalYear: nullableString(validRow.fiscalYear), period: nullableString(validRow.period), currency: nullableString(validRow.currency), revenue: key("revenue"), netIncome: key("netIncome"), eps: key("eps"), operatingCashFlow: key("operatingCashFlow"), freeCashFlow: key("freeCashFlow"), revenue_qoq: key("revenue_qoq"), revenue_yoy: key("revenue_yoy"), netIncome_qoq: key("netIncome_qoq"), netIncome_yoy: key("netIncome_yoy"), eps_qoq: key("eps_qoq"), eps_yoy: key("eps_yoy"), operatingCashFlow_qoq: key("operatingCashFlow_qoq"), operatingCashFlow_yoy: key("operatingCashFlow_yoy") };
  });
  if (!quarters.length || quarters.length > 12) fail("financial quarters must contain 1 to 12 rows");
  return { schemaVersion: validBody.schemaVersion as string, source: nullableString(validBody.source) || "ValuationCalculation", symbol, generatedAt, dataAsOf, quarters };
};

const getJson = async (bucket: R2BucketLike | undefined, key: string) => {
  if (!bucket) throw new Error("VALUATION_DATA_UNAVAILABLE: R2 binding is not configured.");
  const object = await bucket.get(key);
  if (!object) throw new Error(`VALUATION_DATA_NOT_PUBLISHED: ${key} is unavailable.`);
  return object.json();
};

export const loadWatcherValuationRelease = async (bucket: R2BucketLike | undefined): Promise<WatcherValuationRelease> => {
  const body = record(await getJson(bucket, "current.json"));
  const releaseId = nullableString(body?.releaseId);
  const generatedAt = nullableString(body?.generatedAt);
  if (!body || body.schemaVersion !== WATCHER_VALUATION_SCHEMA_VERSION || !releaseId || !/^[A-Za-z0-9._-]+$/.test(releaseId) || !generatedAt) throw new Error("VALUATION_DATA_INVALID: release pointer contract mismatch");
  assertFresh(generatedAt);
  return { schemaVersion: WATCHER_VALUATION_SCHEMA_VERSION, releaseId, generatedAt };
};

const releaseKey = (release: WatcherValuationRelease, key: string) => `releases/${release.releaseId}/${key}`;

export const loadWatcherValuationManifest = async (bucket: R2BucketLike | undefined, release?: WatcherValuationRelease) => {
  const activeRelease = release || await loadWatcherValuationRelease(bucket);
  const body = record(await getJson(bucket, releaseKey(activeRelease, "manifest.json")));
  if (!body || body.schemaVersion !== WATCHER_VALUATION_SCHEMA_VERSION || !Array.isArray(body.symbols)) fail("manifest contract mismatch");
  const validBody = body as Record<string, unknown>;
  const symbols = (validBody.symbols as unknown[]).map((value) => {
    const entry = record(value);
    const symbol = nullableString(entry?.symbol);
    if (!symbol) fail("manifest symbol is malformed");
    return normalizeStocksWatcherSymbol(symbol);
  });
  return { release: activeRelease, symbols };
};

const parseCoverageRegistry = (body: Record<string, unknown> | null): WatcherCoverageRegistry => {
  if (!body) return { schemaVersion: WATCHER_VALUATION_SCHEMA_VERSION, updatedAt: "", symbols: [] };
  if (body.schemaVersion !== WATCHER_VALUATION_SCHEMA_VERSION || !Array.isArray(body.symbols)) fail("coverage registry contract mismatch");
  const updatedAt = nullableString(body.updatedAt) || "";
  const symbols = (body.symbols as unknown[]).map((value) => {
    const entry = record(value);
    const symbol = nullableString(entry?.symbol);
    const requestedAt = nullableString(entry?.requestedAt);
    const state = entry?.state;
    if (!symbol || !requestedAt || (state !== "queued" && state !== "published")) fail("coverage registry symbol is malformed");
    return { symbol: normalizeStocksWatcherSymbol(symbol), requestedAt: requestedAt as string, state: state as "queued" | "published" };
  });
  return { schemaVersion: WATCHER_VALUATION_SCHEMA_VERSION, updatedAt, symbols };
};

const readWatcherCoverageRegistry = async (bucket: R2BucketLike | undefined) => {
  if (!bucket) throw new Error("VALUATION_DATA_UNAVAILABLE: R2 binding is not configured.");
  const object = await bucket.get("coverage/universe.json");
  return { registry: parseCoverageRegistry(object ? record(await object.json()) : null), etag: object?.httpEtag };
};

export const loadWatcherCoverageRegistry = async (bucket: R2BucketLike | undefined): Promise<WatcherCoverageRegistry> => {
  return (await readWatcherCoverageRegistry(bucket)).registry;
};

export const getWatcherCoverageStatus = async (bucket: R2BucketLike | undefined, symbolInput: string): Promise<WatcherCoverageStatus> => {
  const symbol = normalizeStocksWatcherSymbol(symbolInput);
  try {
    const manifest = await loadWatcherValuationManifest(bucket);
    if (manifest.symbols.includes(symbol)) return "published";
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("VALUATION_DATA_NOT_PUBLISHED:")) throw error;
  }
  const registry = await loadWatcherCoverageRegistry(bucket);
  return registry.symbols.some((entry) => entry.symbol === symbol) ? "queued" : "unavailable";
};

export const requestWatcherCoverage = async (bucket: R2BucketLike | undefined, symbolInput: string) => {
  if (!bucket?.put) throw new Error("VALUATION_DATA_UNAVAILABLE: R2 write binding is not configured.");
  const symbol = normalizeStocksWatcherSymbol(symbolInput);
  try {
    const manifest = await loadWatcherValuationManifest(bucket);
    if (manifest.symbols.includes(symbol)) return { symbol, status: "already_published" as const };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("VALUATION_DATA_NOT_PUBLISHED:")) throw error;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { registry, etag } = await readWatcherCoverageRegistry(bucket);
    if (registry.symbols.some((entry) => entry.symbol === symbol)) return { symbol, status: "already_queued" as const };
    const requestedAt = new Date().toISOString();
    const next = {
      schemaVersion: WATCHER_VALUATION_SCHEMA_VERSION,
      updatedAt: requestedAt,
      symbols: [...registry.symbols, { symbol, requestedAt, state: "queued" as const }],
    };
    const write = await bucket.put("coverage/universe.json", JSON.stringify(next), {
      httpMetadata: { contentType: "application/json" },
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
    });
    if (write !== null) return { symbol, status: "queued" as const, requestedAt };
  }
  throw new Error("VALUATION_DATA_CONFLICT: coverage registry changed repeatedly; retry the request.");
};

export const loadWatcherValuationBands = async (bucket: R2BucketLike | undefined, input: { symbol: string; metric?: unknown; window?: unknown; release?: WatcherValuationRelease }) => {
  const symbol = normalizeStocksWatcherSymbol(input.symbol);
  const metric = parseWatcherValuationMetric(input.metric);
  const window = parseWatcherValuationWindow(input.window);
  const release = input.release || await loadWatcherValuationRelease(bucket);
  return parseValuation(await getJson(bucket, releaseKey(release, `valuation/${symbol}/${metric}/${window}.json`)), symbol, metric, window);
};

export const loadWatcherFinancialStatements = async (bucket: R2BucketLike | undefined, input: { symbol: string; periods?: unknown; release?: WatcherValuationRelease }) => {
  const symbol = normalizeStocksWatcherSymbol(input.symbol);
  const periods = input.periods === undefined ? 4 : Number(input.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) throw new Error("VALUATION_DATA_INVALID: periods must be an integer from 1 to 12.");
  const release = input.release || await loadWatcherValuationRelease(bucket);
  const financials = parseFinancials(await getJson(bucket, releaseKey(release, `financials/${symbol}.json`),), symbol);
  return { ...financials, quarters: financials.quarters.slice(0, periods) };
};

export const STOCKS_WATCHER_VALUATION_TOOLS = [
  { name: "get_valuation_bands", description: "Read audited hybrid PE, P/FCF, or P/S valuation bands published by ValuationCalculation.", inputKeys: ["symbol", "metric", "window"] },
  { name: "get_financial_statements", description: "Read up to 12 published quarterly financial-statement rows from ValuationCalculation.", inputKeys: ["symbol", "periods"] },
] as const;
