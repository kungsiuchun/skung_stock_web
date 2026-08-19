import { strFromU8, unzipSync } from "fflate";

export const MARKET_BREADTH_SCHEMA_VERSION = 1 as const;
export const MARKET_BREADTH_PRICE_LIMIT = 420;

export const MARKET_BREADTH_SECTORS = [
  { sector: "Communication Services", etf: "XLC" },
  { sector: "Consumer Discretionary", etf: "XLY" },
  { sector: "Consumer Staples", etf: "XLP" },
  { sector: "Energy", etf: "XLE" },
  { sector: "Financials", etf: "XLF" },
  { sector: "Health Care", etf: "XLV" },
  { sector: "Industrials", etf: "XLI" },
  { sector: "Information Technology", etf: "XLK" },
  { sector: "Materials", etf: "XLB" },
  { sector: "Real Estate", etf: "XLRE" },
  { sector: "Utilities", etf: "XLU" },
] as const;

export type MarketBreadthSector = typeof MARKET_BREADTH_SECTORS[number]["sector"];
export type MarketBreadthFreshnessStatus = "FRESH" | "STALE";

export interface PriceBar {
  date: string;
  close: number;
}

export const mergeMarketBreadthPriceBars = (existing: PriceBar[], incoming: PriceBar[]) => {
  const byDate = new Map<string, PriceBar>();
  for (const bar of [...existing, ...incoming]) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(bar.date) && Number.isFinite(bar.close) && bar.close > 0) byDate.set(bar.date, { date: bar.date, close: bar.close });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-MARKET_BREADTH_PRICE_LIMIT);
};

export interface HoldingRow {
  ticker: string;
  name: string;
  weightPct: number;
}

export interface SectorFundMembership {
  sector: string;
  etf: string;
  holdingsAsOf: string;
  tickers: string[];
}

export interface SectorHolding extends HoldingRow {
  sector: string;
  sectorEtf: string;
}

export interface SectorWeight {
  sector: string;
  etf: string;
  weightPct: number;
  holdingCount: number;
}

export interface SectorUniverse {
  holdingsAsOf: string;
  holdings: SectorHolding[];
  sectorWeights: SectorWeight[];
  universeCount: number;
  totalWeightPct: number;
}

export interface ParsedStateStreetHoldings {
  fund: string;
  holdingsAsOf: string;
  holdings: HoldingRow[];
}

export interface BreadthCell {
  above: number;
  eligible: number;
  total: number;
  pct: number | null;
}

export interface MarketBreadthFreshness {
  status: MarketBreadthFreshnessStatus;
  reason: "CURRENT" | "LATEST_REFRESH_FAILED" | "SNAPSHOT_TOO_OLD";
  failedAt?: string;
  errorClass?: string;
}

export interface ReturnWindows {
  oneDay: number | null;
  oneWeek: number | null;
  oneMonth: number | null;
  threeMonths: number | null;
  yearToDate: number | null;
}

export interface SectorPerformanceRow extends ReturnWindows {
  sector: string;
  etf: string;
  weightPct: number;
  contribution1dPctPoints: number | null;
}

export interface MarketBreadthRow {
  sector: string;
  holdingCount: number;
  windows: {
    sma5: BreadthCell;
    sma20: BreadthCell;
    sma50: BreadthCell;
    sma100: BreadthCell;
    sma200: BreadthCell;
  };
}

export interface Sma200SlopeRow {
  sector: string;
  etf: string;
  windows: {
    session5: number | null;
    session20: number | null;
    session50: number | null;
    session100: number | null;
    session200: number | null;
  };
}

export interface MarketBreadthSnapshot {
  schemaVersion: typeof MARKET_BREADTH_SCHEMA_VERSION;
  snapshotId: string;
  generatedAt: string;
  holdingsAsOf: string;
  priceAsOf: string;
  universeCount: number;
  sectorPerformance: {
    benchmark: ReturnWindows & { symbol: "SPY" };
    rows: SectorPerformanceRow[];
    proxyContribution1dPctPoints: number;
    reconciliationGapPctPoints: number | null;
  };
  breadth: { rows: MarketBreadthRow[] };
  sma200Slope: { rows: Sma200SlopeRow[] };
  coverage: {
    currentPriceCount: number;
    constituent200DayCount: number;
    constituent200DayPct: number;
    totalConstituents: number;
    sectorEtf400DayCount: number;
    totalSectorEtfs: number;
  };
  sources: Array<{
    id: "state-street" | "massive";
    provider: string;
    label: string;
    url: string;
    role: string;
  }>;
  warnings: string[];
}

const round = (value: number, places = 4) => {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

export const normalizeMarketBreadthTicker = (value: string) =>
  value.trim().toUpperCase().replace(/[./]/g, "-");

const decodeXml = (value: string) => value
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&#39;|&apos;/g, "'");

const columnIndex = (cellReference: string) => {
  const letters = cellReference.match(/^[A-Z]+/i)?.[0].toUpperCase() || "";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const readSharedStrings = (files: Record<string, Uint8Array>) => {
  const bytes = files["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = strFromU8(bytes);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) =>
    decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((text) => text[1]).join("")),
  );
};

const readWorksheetRows = (files: Record<string, Uint8Array>) => {
  const worksheetNames = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  let sheetName: string | undefined;
  const workbookBytes = files["xl/workbook.xml"];
  const relationshipsBytes = files["xl/_rels/workbook.xml.rels"];
  if (workbookBytes && relationshipsBytes) {
    const workbookXml = strFromU8(workbookBytes);
    const holdingsSheet = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)].find((match) => /\bname="Holdings"/i.test(match[1]));
    if (!holdingsSheet) throw new Error("State Street workbook has no named Holdings worksheet.");
    const relationshipId = holdingsSheet[1].match(/\br:id="([^"]+)"/i)?.[1];
    const relationshipsXml = strFromU8(relationshipsBytes);
    const relationship = [...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)].find((match) => match[1].match(/\bId="([^"]+)"/i)?.[1] === relationshipId);
    const target = relationship?.[1].match(/\bTarget="([^"]+)"/i)?.[1]?.replace(/^\//, "");
    if (!target) throw new Error("State Street Holdings worksheet relationship is invalid.");
    sheetName = target.startsWith("xl/") ? target : `xl/${target}`;
    if (!files[sheetName]) throw new Error("State Street Holdings worksheet XML is missing.");
  } else {
    sheetName = worksheetNames[0];
  }
  if (!sheetName) throw new Error("State Street workbook has no worksheet XML.");
  const sharedStrings = readSharedStrings(files);
  const xml = strFromU8(files[sheetName]);
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) => {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] || "";
      const type = attributes.match(/\bt="([^"]+)"/i)?.[1] || "";
      const inlineText = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => match[1]).join("");
      const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || "";
      const value = type === "s"
        ? sharedStrings[Number(rawValue)] || ""
        : inlineText || rawValue;
      row[columnIndex(reference)] = decodeXml(value).trim();
    }
    return row;
  });
};

const monthByName: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const extractHoldingsDate = (rows: string[][]) => {
  const text = rows.flat().filter(Boolean).join(" ");
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const named = text.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-,\s]+(20\d{2})\b/);
  if (named) {
    const month = monthByName[named[2].slice(0, 3).toLowerCase()];
    if (month) return `${named[3]}-${month}-${named[1].padStart(2, "0")}`;
  }
  throw new Error("State Street workbook holdings date was not found.");
};

export const parseStateStreetHoldingsWorkbook = (
  workbookBytes: Uint8Array | ArrayBuffer,
  fund: string,
): ParsedStateStreetHoldings => {
  let files: Record<string, Uint8Array>;
  try {
    const bytes = workbookBytes instanceof Uint8Array ? workbookBytes : new Uint8Array(workbookBytes);
    files = unzipSync(bytes);
  } catch (error) {
    throw new Error(`State Street ${fund} workbook is not a valid XLSX archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rows = readWorksheetRows(files);
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((value) => value.trim().toLowerCase());
    return normalized.includes("name") && normalized.includes("ticker") && normalized.includes("weight");
  });
  if (headerIndex < 0) throw new Error(`State Street ${fund} workbook is missing the required holdings header.`);

  const header = rows[headerIndex].map((value) => value.trim().toLowerCase());
  const nameIndex = header.indexOf("name");
  const tickerIndex = header.indexOf("ticker");
  const weightIndex = header.indexOf("weight");
  const holdings = rows.slice(headerIndex + 1).flatMap((row): HoldingRow[] => {
    const ticker = normalizeMarketBreadthTicker(row[tickerIndex] || "");
    const name = (row[nameIndex] || "").trim();
    const weightPct = Number(String(row[weightIndex] || "").replace(/[%,$]/g, ""));
    if (!ticker || ticker === "-" || !name || !Number.isFinite(weightPct) || weightPct <= 0) return [];
    return [{ ticker, name, weightPct }];
  });
  if (holdings.length === 0) throw new Error(`State Street ${fund} workbook contains no equity holdings.`);
  const total = holdings.reduce((sum, row) => sum + row.weightPct, 0);
  if (total >= 0.95 && total <= 1.05) {
    for (const holding of holdings) holding.weightPct = round(holding.weightPct * 100);
  }
  return { fund, holdingsAsOf: extractHoldingsDate(rows), holdings };
};

const assertIsoDate = (value: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
};

export const buildSectorUniverse = (input: {
  holdingsAsOf: string;
  spyHoldings: HoldingRow[];
  sectorFunds: SectorFundMembership[];
}): SectorUniverse => {
  assertIsoDate(input.holdingsAsOf, "SPY holdings date");
  if (input.spyHoldings.length === 0) throw new Error("SPY holdings are empty.");

  const sectorByTicker = new Map<string, Array<{ sector: string; etf: string }>>();
  for (const fund of input.sectorFunds) {
    if (fund.holdingsAsOf !== input.holdingsAsOf) {
      throw new Error(`Holdings date mismatch for ${fund.etf}: ${fund.holdingsAsOf}.`);
    }
    for (const rawTicker of fund.tickers) {
      const ticker = normalizeMarketBreadthTicker(rawTicker);
      if (!ticker || ticker === "-") continue;
      const memberships = sectorByTicker.get(ticker) || [];
      memberships.push({ sector: fund.sector, etf: fund.etf });
      sectorByTicker.set(ticker, memberships);
    }
  }

  const seen = new Set<string>();
  const holdings = input.spyHoldings.map((holding): SectorHolding => {
    const ticker = normalizeMarketBreadthTicker(holding.ticker);
    if (!ticker || ticker === "-") throw new Error("SPY holding has no tradable ticker.");
    if (seen.has(ticker)) throw new Error(`Duplicate SPY holding ticker: ${ticker}.`);
    seen.add(ticker);
    const memberships = sectorByTicker.get(ticker) || [];
    if (memberships.length !== 1) {
      throw new Error(`${ticker} must belong to exactly one sector; found ${memberships.length}.`);
    }
    if (!Number.isFinite(holding.weightPct) || holding.weightPct <= 0) {
      throw new Error(`${ticker} has an invalid SPY weight.`);
    }
    return { ...holding, ticker, sector: memberships[0].sector, sectorEtf: memberships[0].etf };
  });

  const totalWeightPct = round(holdings.reduce((sum, row) => sum + row.weightPct, 0));
  if (totalWeightPct < 95 || totalWeightPct > 105) {
    throw new Error(`SPY holdings weight total ${totalWeightPct}% is outside the 95%-105% validation range.`);
  }

  const sectorWeights = input.sectorFunds.map((fund) => {
    const sectorHoldings = holdings.filter((row) => row.sector === fund.sector && row.sectorEtf === fund.etf);
    return {
      sector: fund.sector,
      etf: fund.etf,
      weightPct: round(sectorHoldings.reduce((sum, row) => sum + row.weightPct, 0)),
      holdingCount: sectorHoldings.length,
    };
  }).filter((row) => row.holdingCount > 0);

  return {
    holdingsAsOf: input.holdingsAsOf,
    holdings,
    sectorWeights,
    universeCount: holdings.length,
    totalWeightPct,
  };
};

const sortedBars = (series: PriceBar[]) => [...series]
  .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && Number.isFinite(bar.close) && bar.close > 0)
  .sort((left, right) => left.date.localeCompare(right.date));

export const calculateSessionReturn = (series: PriceBar[], sessionsBack: number): number | null => {
  const normalized = sortedBars(series);
  const current = normalized[normalized.length - 1];
  const base = normalized[normalized.length - sessionsBack - 1];
  if (!current || !base || base.close <= 0) return null;
  return round(((current.close / base.close) - 1) * 100);
};

export const calculateYtdReturn = (series: PriceBar[]): number | null => {
  const normalized = sortedBars(series);
  const current = normalized[normalized.length - 1];
  if (!current) return null;
  const currentYear = current.date.slice(0, 4);
  const base = [...normalized].reverse().find((bar) => bar.date.slice(0, 4) < currentYear);
  if (!base || base.close <= 0) return null;
  return round(((current.close / base.close) - 1) * 100);
};

export const proxyContributionPctPoints = (weightPct: number, returnPct: number): number =>
  round((weightPct / 100) * returnPct);

export const simpleMovingAverage = (values: number[], period: number): number | null => {
  if (!Number.isInteger(period) || period <= 0 || values.length < period) return null;
  const window = values.slice(-period);
  if (window.some((value) => !Number.isFinite(value))) return null;
  return window.reduce((sum, value) => sum + value, 0) / period;
};

export const buildBreadthCell = (seriesByHolding: PriceBar[][], period: number, priceAsOf?: string): BreadthCell => {
  let above = 0;
  let eligible = 0;
  for (const series of seriesByHolding) {
    const sorted = sortedBars(series);
    if (priceAsOf && sorted[sorted.length - 1]?.date !== priceAsOf) continue;
    const closes = sorted.map((bar) => bar.close);
    const average = simpleMovingAverage(closes, period);
    const current = closes[closes.length - 1];
    if (average === null || current === undefined) continue;
    eligible += 1;
    if (current > average) above += 1;
  }
  return {
    above,
    eligible,
    total: seriesByHolding.length,
    pct: eligible > 0 ? round((above / eligible) * 100, 1) : null,
  };
};

export const calculateSmaSlope = (
  series: PriceBar[],
  smaPeriod: number,
  sessionsBack: number,
): number | null => {
  const closes = sortedBars(series).map((bar) => bar.close);
  const current = simpleMovingAverage(closes, smaPeriod);
  const historicalEnd = closes.length - sessionsBack;
  if (current === null || historicalEnd < smaPeriod) return null;
  const historical = simpleMovingAverage(closes.slice(0, historicalEnd), smaPeriod);
  if (historical === null || historical === 0) return null;
  return round(((current / historical) - 1) * 100);
};

export const determineMarketBreadthFreshness = (input: {
  generatedAt: string;
  priceAsOf: string;
  now?: Date;
  latestFailure?: { failedAt: string; errorClass: string } | null;
  staleAfterHours?: number;
}): MarketBreadthFreshness => {
  const generatedMs = Date.parse(input.generatedAt);
  const failureMs = input.latestFailure ? Date.parse(input.latestFailure.failedAt) : Number.NaN;
  if (input.latestFailure && Number.isFinite(failureMs) && (!Number.isFinite(generatedMs) || failureMs > generatedMs)) {
    return {
      status: "STALE",
      reason: "LATEST_REFRESH_FAILED",
      failedAt: input.latestFailure.failedAt,
      errorClass: input.latestFailure.errorClass,
    };
  }

  const now = input.now || new Date();
  const staleAfterHours = input.staleAfterHours ?? 96;
  if (!Number.isFinite(generatedMs) || now.getTime() - generatedMs > staleAfterHours * 60 * 60 * 1000) {
    return { status: "STALE", reason: "SNAPSHOT_TOO_OLD" };
  }
  return { status: "FRESH", reason: "CURRENT" };
};

const buildReturnWindows = (series: PriceBar[]): ReturnWindows => ({
  oneDay: calculateSessionReturn(series, 1),
  oneWeek: calculateSessionReturn(series, 5),
  oneMonth: calculateSessionReturn(series, 21),
  threeMonths: calculateSessionReturn(series, 63),
  yearToDate: calculateYtdReturn(series),
});

const stableSnapshotHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const calculateMarketBreadthSnapshotId = (snapshot: Omit<MarketBreadthSnapshot, "snapshotId"> | MarketBreadthSnapshot) => {
  const content = { ...snapshot } as Partial<MarketBreadthSnapshot>;
  delete content.snapshotId;
  delete content.generatedAt;
  return `market-breadth-v1-${snapshot.priceAsOf}-${stableSnapshotHash(JSON.stringify(content))}`;
};

const requireSeries = (priceSeries: Map<string, PriceBar[]>, ticker: string) => {
  const normalized = normalizeMarketBreadthTicker(ticker);
  return sortedBars(priceSeries.get(normalized) || []);
};

export const buildMarketBreadthSnapshot = (input: {
  generatedAt: string;
  priceAsOf: string;
  universe: SectorUniverse;
  priceSeries: Map<string, PriceBar[]>;
}): MarketBreadthSnapshot => {
  assertIsoDate(input.priceAsOf, "Price date");
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("Snapshot generatedAt must be an ISO timestamp.");
  if (input.universe.sectorWeights.length !== MARKET_BREADTH_SECTORS.length) {
    throw new Error(`Expected ${MARKET_BREADTH_SECTORS.length} sector mappings; found ${input.universe.sectorWeights.length}.`);
  }
  if (input.universe.totalWeightPct < 95 || input.universe.totalWeightPct > 105) {
    throw new Error("SPY sector weights are outside the accepted range.");
  }

  const spySeries = requireSeries(input.priceSeries, "SPY");
  if (spySeries.length < 64 || spySeries[spySeries.length - 1]?.date !== input.priceAsOf) {
    throw new Error("SPY adjusted history is incomplete for the price date.");
  }

  const sectorPerformanceRows = input.universe.sectorWeights.map((sector): SectorPerformanceRow => {
    const series = requireSeries(input.priceSeries, sector.etf);
    if (series.length < 400 || series[series.length - 1]?.date !== input.priceAsOf) {
      throw new Error(`${sector.etf} adjusted history is incomplete; 400 sessions through ${input.priceAsOf} are required.`);
    }
    const windows = buildReturnWindows(series);
    return {
      sector: sector.sector,
      etf: sector.etf,
      weightPct: sector.weightPct,
      contribution1dPctPoints: windows.oneDay === null ? null : proxyContributionPctPoints(sector.weightPct, windows.oneDay),
      ...windows,
    };
  }).sort((left, right) => right.weightPct - left.weightPct);

  const benchmark = { symbol: "SPY" as const, ...buildReturnWindows(spySeries) };
  const proxyContribution1dPctPoints = round(sectorPerformanceRows.reduce(
    (sum, row) => sum + (row.contribution1dPctPoints || 0),
    0,
  ));
  const reconciliationGapPctPoints = benchmark.oneDay === null
    ? null
    : round(benchmark.oneDay - proxyContribution1dPctPoints);

  let currentPriceCount = 0;
  let constituent200DayCount = 0;
  for (const holding of input.universe.holdings) {
    const series = requireSeries(input.priceSeries, holding.ticker);
    if (series[series.length - 1]?.date === input.priceAsOf) currentPriceCount += 1;
    if (series.length >= 200 && series[series.length - 1]?.date === input.priceAsOf) constituent200DayCount += 1;
  }
  const constituent200DayPct = input.universe.universeCount > 0
    ? round((constituent200DayCount / input.universe.universeCount) * 100, 1)
    : 0;
  if (constituent200DayPct < 98) {
    throw new Error(`Constituent 200-session coverage ${constituent200DayPct}% is below the 98% publication threshold.`);
  }

  const breadthRows = input.universe.sectorWeights.map((sector): MarketBreadthRow => {
    const sectorSeries = input.universe.holdings
      .filter((holding) => holding.sector === sector.sector)
      .map((holding) => requireSeries(input.priceSeries, holding.ticker));
    return {
      sector: sector.sector,
      holdingCount: sectorSeries.length,
      windows: {
        sma5: buildBreadthCell(sectorSeries, 5, input.priceAsOf),
        sma20: buildBreadthCell(sectorSeries, 20, input.priceAsOf),
        sma50: buildBreadthCell(sectorSeries, 50, input.priceAsOf),
        sma100: buildBreadthCell(sectorSeries, 100, input.priceAsOf),
        sma200: buildBreadthCell(sectorSeries, 200, input.priceAsOf),
      },
    };
  });

  const slopeRows = input.universe.sectorWeights.map((sector): Sma200SlopeRow => {
    const series = requireSeries(input.priceSeries, sector.etf);
    return {
      sector: sector.sector,
      etf: sector.etf,
      windows: {
        session5: calculateSmaSlope(series, 200, 5),
        session20: calculateSmaSlope(series, 200, 20),
        session50: calculateSmaSlope(series, 200, 50),
        session100: calculateSmaSlope(series, 200, 100),
        session200: calculateSmaSlope(series, 200, 200),
      },
    };
  });

  const warnings = reconciliationGapPctPoints !== null && Math.abs(reconciliationGapPctPoints) >= 0.25
    ? [`Sector ETF proxy contribution differs from SPY 1D return by ${reconciliationGapPctPoints} percentage points.`]
    : [];

  const snapshot: Omit<MarketBreadthSnapshot, "snapshotId"> = {
    schemaVersion: MARKET_BREADTH_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    holdingsAsOf: input.universe.holdingsAsOf,
    priceAsOf: input.priceAsOf,
    universeCount: input.universe.universeCount,
    sectorPerformance: {
      benchmark,
      rows: sectorPerformanceRows,
      proxyContribution1dPctPoints,
      reconciliationGapPctPoints,
    },
    breadth: { rows: breadthRows },
    sma200Slope: { rows: slopeRows },
    coverage: {
      currentPriceCount,
      constituent200DayCount,
      constituent200DayPct,
      totalConstituents: input.universe.universeCount,
      sectorEtf400DayCount: sectorPerformanceRows.length,
      totalSectorEtfs: MARKET_BREADTH_SECTORS.length,
    },
    sources: [
      {
        id: "state-street",
        provider: "State Street Global Advisors",
        label: "SPY and Select Sector SPDR daily holdings",
        url: "https://www.ssga.com/uk/en_gb/institutional/etfs/state-street-spdr-sp-500-etf-trust-spy",
        role: "Universe, sector membership, and SPY sector weights",
      },
      {
        id: "massive",
        provider: "Massive",
        label: "Adjusted U.S. stock daily aggregates",
        url: "https://massive.com/docs/rest/stocks/aggregates/daily-market-summary",
        role: "Split-adjusted constituent, SPY, and sector ETF closes",
      },
    ],
    warnings,
  };
  return { ...snapshot, snapshotId: calculateMarketBreadthSnapshotId(snapshot) };
};

export const validateMarketBreadthSnapshot = (value: unknown): MarketBreadthSnapshot => {
  if (!value || typeof value !== "object") throw new Error("Market breadth snapshot is not an object.");
  const snapshot = value as Partial<MarketBreadthSnapshot>;
  if (snapshot.schemaVersion !== MARKET_BREADTH_SCHEMA_VERSION) throw new Error("Market breadth snapshot schema version is invalid.");
  if (typeof snapshot.snapshotId !== "string" || !snapshot.snapshotId.startsWith("market-breadth-v1-")) throw new Error("Market breadth snapshot ID is invalid.");
  if (!Number.isFinite(Date.parse(snapshot.generatedAt || ""))) throw new Error("Market breadth generatedAt is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.priceAsOf || "") || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.holdingsAsOf || "")) {
    throw new Error("Market breadth as-of dates are invalid.");
  }
  if (!Number.isInteger(snapshot.universeCount) || Number(snapshot.universeCount) <= 0) throw new Error("Market breadth universe count is invalid.");
  const finiteOrNull = (item: unknown) => item === null || typeof item === "number" && Number.isFinite(item);
  const expectedSectors = new Map(MARKET_BREADTH_SECTORS.map((row) => [row.sector, row.etf]));
  const validateSectorSet = (rows: unknown[], label: string) => {
    const sectors = rows.map((row) => row && typeof row === "object" ? (row as { sector?: unknown }).sector : null);
    if (rows.length !== expectedSectors.size || new Set(sectors).size !== expectedSectors.size || sectors.some((sector) => !expectedSectors.has(sector as MarketBreadthSector))) {
      throw new Error(`${label} sector set is invalid.`);
    }
  };
  const validateReturnWindows = (row: Partial<ReturnWindows>, label: string) => {
    for (const key of ["oneDay", "oneWeek", "oneMonth", "threeMonths", "yearToDate"] as const) {
      if (!finiteOrNull(row[key])) throw new Error(`${label} ${key} is invalid.`);
    }
  };
  if (!snapshot.sectorPerformance || !Array.isArray(snapshot.sectorPerformance.rows)) throw new Error("Sector performance rows are invalid.");
  validateSectorSet(snapshot.sectorPerformance.rows, "Sector performance");
  if (!snapshot.sectorPerformance.benchmark || snapshot.sectorPerformance.benchmark.symbol !== "SPY") throw new Error("Sector performance benchmark is invalid.");
  validateReturnWindows(snapshot.sectorPerformance.benchmark, "Benchmark");
  if (!finiteOrNull(snapshot.sectorPerformance.proxyContribution1dPctPoints) || !finiteOrNull(snapshot.sectorPerformance.reconciliationGapPctPoints)) throw new Error("Sector performance totals are invalid.");
  for (const row of snapshot.sectorPerformance.rows) {
    if (!row || typeof row !== "object" || expectedSectors.get(row.sector as MarketBreadthSector) !== row.etf || !Number.isFinite(row.weightPct) || !finiteOrNull(row.contribution1dPctPoints)) {
      throw new Error("Sector performance row is invalid.");
    }
    validateReturnWindows(row, `Sector performance ${row.sector}`);
  }
  if (!snapshot.breadth || !Array.isArray(snapshot.breadth.rows)) throw new Error("Breadth rows are invalid.");
  validateSectorSet(snapshot.breadth.rows, "Breadth");
  for (const row of snapshot.breadth.rows) {
    if (!row || typeof row !== "object" || !Number.isInteger(row.holdingCount) || !row.windows || typeof row.windows !== "object") throw new Error("Breadth row is invalid.");
    for (const key of ["sma5", "sma20", "sma50", "sma100", "sma200"] as const) {
      const cell = row.windows[key];
      if (!cell || !Number.isInteger(cell.above) || !Number.isInteger(cell.eligible) || !Number.isInteger(cell.total)
        || cell.above < 0 || cell.above > cell.eligible || cell.eligible > cell.total || cell.total !== row.holdingCount
        || !finiteOrNull(cell.pct) || cell.pct !== null && (cell.pct < 0 || cell.pct > 100)) throw new Error(`Breadth ${row.sector} ${key} is invalid.`);
    }
  }
  if (!snapshot.sma200Slope || !Array.isArray(snapshot.sma200Slope.rows)) throw new Error("SMA200 slope rows are invalid.");
  validateSectorSet(snapshot.sma200Slope.rows, "SMA200 slope");
  for (const row of snapshot.sma200Slope.rows) {
    if (!row || typeof row !== "object" || expectedSectors.get(row.sector as MarketBreadthSector) !== row.etf || !row.windows || typeof row.windows !== "object") throw new Error("SMA200 slope row is invalid.");
    for (const key of ["session5", "session20", "session50", "session100", "session200"] as const) {
      if (!finiteOrNull(row.windows[key])) throw new Error(`SMA200 slope ${row.sector} ${key} is invalid.`);
    }
  }
  const coverage = snapshot.coverage;
  if (!coverage || !Number.isInteger(coverage.currentPriceCount) || !Number.isInteger(coverage.constituent200DayCount)
    || !Number.isFinite(coverage.constituent200DayPct) || coverage.constituent200DayPct < 0 || coverage.constituent200DayPct > 100
    || coverage.totalConstituents !== snapshot.universeCount || coverage.totalSectorEtfs !== 11 || coverage.sectorEtf400DayCount !== 11) throw new Error("Market breadth coverage is invalid.");
  if (!Array.isArray(snapshot.sources) || snapshot.sources.length !== 2 || new Set(snapshot.sources.map((source) => source?.id)).size !== 2
    || snapshot.sources.some((source) => !source || !["state-street", "massive"].includes(source.id) || !source.provider || !source.label || !source.url || !source.role)
    || !Array.isArray(snapshot.warnings) || snapshot.warnings.some((warning) => typeof warning !== "string")) throw new Error("Market breadth provenance is invalid.");
  if (snapshot.snapshotId !== calculateMarketBreadthSnapshotId(snapshot as MarketBreadthSnapshot)) throw new Error("Market breadth snapshot ID does not match its payload.");
  return snapshot as MarketBreadthSnapshot;
};
