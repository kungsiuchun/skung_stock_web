import {
  MARKET_BREADTH_SECTORS,
  type BreadthCell,
  type PriceBar,
  type SectorUniverse,
} from "./market-breadth";
import { isNyseTradingDay } from "./nyse-calendar";

export const SECTOR_ROTATION_SCHEMA_VERSION = 1 as const;
export const SECTOR_ROTATION_WINDOWS = [
  { key: "oneMonth", label: "1M", sessions: 21 },
  { key: "threeMonths", label: "3M", sessions: 63 },
  { key: "sixMonths", label: "6M", sessions: 126 },
  { key: "twelveMonths", label: "12M", sessions: 252 },
] as const;
export type RotationWindow = typeof SECTOR_ROTATION_WINDOWS[number]["key"];
export type RotationWindows = Record<RotationWindow, number | null>;
export type SectorRotationQuadrant = "Leading" | "Weakening" | "Lagging" | "Improving" | "Neutral" | "Unavailable";
export interface RotationPoint {
  date: string;
  rsRatio: number;
  rsMomentum: number;
  quadrant: SectorRotationQuadrant;
}
export interface PerformancePoint { date: string; value: number; relativeValue: number }
export interface SectorRotationHolding {
  ticker: string;
  name: string;
  sector: string;
  sectorEtf: string;
  spyWeightPct: number;
  sectorWeightPct: number;
  returns: RotationWindows;
  relativeToSpy: RotationWindows;
  relativeToSector: RotationWindows;
  contributionProxy: RotationWindows;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
}
export interface SectorRotationRow {
  sector: string;
  etf: string;
  weightPct: number;
  holdingCount: number;
  returns: RotationWindows;
  relativeToSpy: RotationWindows;
  rotation: {
    asOf: string | null;
    rsRatio: number | null;
    rsMomentum: number | null;
    quadrant: SectorRotationQuadrant;
    trail: RotationPoint[];
  };
  breadth: {
    sma50: BreadthCell;
    sma200: BreadthCell;
    positiveReturn: Record<RotationWindow, BreadthCell>;
    outperformingSpy: Record<RotationWindow, BreadthCell>;
  };
  performance: Record<RotationWindow, PerformancePoint[]>;
}

export const SECTOR_ROTATION_MODEL = {
  name: "Custom weekly relative rotation",
  benchmark: "SPY",
  relativeStrength: "Sector ETF close / SPY close",
  rsRatio: "100 × RS / 10-week simple moving average of RS",
  rsMomentum: "100 × RS-Ratio / 4-week simple moving average of RS-Ratio",
  weeklySampling: "Final NYSE trading session of completed week; gaps remain unavailable",
  neutralAxis: 100,
  neutralTolerance: 0.000001,
  pricePolicy: "Split-adjusted price returns; dividends excluded",
  weightPolicy: "Current SPY holdings and sector mapping; no historical attribution",
  contributionPolicy: "Current sector-normalized SPY weight × stock price return; percentage-point proxy",
  relativeReturnPolicy: "100 × ((1 + asset return / 100) / (1 + benchmark return / 100) − 1)",
  defaultTrailWeeks: 12,
  maxTrailWeeks: 52,
  proprietaryJdkModel: false,
} as const;

export interface SectorRotationSnapshot {
  schemaVersion: typeof SECTOR_ROTATION_SCHEMA_VERSION;
  snapshotId: string;
  sourceSnapshotId: string;
  generatedAt: string;
  holdingsAsOf: string;
  priceAsOf: string;
  universeCount: number;
  model: typeof SECTOR_ROTATION_MODEL;
  benchmark: { symbol: "SPY"; returns: RotationWindows };
  sectors: SectorRotationRow[];
  holdings: SectorRotationHolding[];
  coverage: {
    currentPriceCount: number;
    totalConstituents: number;
    eligibleByWindow: Record<RotationWindow, number>;
    completedWeekAsOf: string | null;
    availableSectorRotations: number;
  };
  warnings: string[];
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const dateValid = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sessionDatesEnding = (date: string, count: number) => {
  const dates: string[] = [];
  for (let cursor = date; dates.length < count; cursor = shiftDate(cursor, -1)) {
    if (isNyseTradingDay(cursor)) dates.unshift(cursor);
  }
  return dates;
};
const recordWindows = <T,>(fn: (sessions: number, key: RotationWindow) => T): Record<RotationWindow, T> =>
  Object.fromEntries(SECTOR_ROTATION_WINDOWS.map(({ key, sessions }) => [key, fn(sessions, key)])) as Record<RotationWindow, T>;

export const classifySectorRotationQuadrant = (rsRatio: number | null, rsMomentum: number | null): SectorRotationQuadrant => {
  if (rsRatio === null || rsMomentum === null) return "Unavailable";
  if (!Number.isFinite(rsRatio) || !Number.isFinite(rsMomentum) || rsRatio <= 0 || rsMomentum <= 0) {
    throw new Error("Invalid sector rotation coordinates.");
  }
  if (Math.abs(rsRatio - 100) <= SECTOR_ROTATION_MODEL.neutralTolerance
    || Math.abs(rsMomentum - 100) <= SECTOR_ROTATION_MODEL.neutralTolerance) return "Neutral";
  if (rsRatio > 100) return rsMomentum > 100 ? "Leading" : "Weakening";
  return rsMomentum > 100 ? "Improving" : "Lagging";
};

// Only known final sessions are used. A Wednesday close cannot become a Friday point.
export const completedNyseWeekCloseDate = (date: string) => {
  if (!dateValid(date)) throw new Error("Invalid completed-week date.");
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  let friday = shiftDate(date, (5 - weekday + 7) % 7);
  let final = friday;
  while (!isNyseTradingDay(final)) final = shiftDate(final, -1);
  if (final > date) {
    friday = shiftDate(friday, -7);
    final = friday;
    while (!isNyseTradingDay(final)) final = shiftDate(final, -1);
  }
  return final;
};

const previousCompletedWeek = (date: string) => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const friday = shiftDate(date, 5 - weekday);
  return completedNyseWeekCloseDate(shiftDate(friday, -7));
};

const checkedSeries = (bars: PriceBar[], ticker: string, priceAsOf: string): Map<string, number> => {
  const result = new Map<string, number>();
  for (const bar of bars) {
    if (!dateValid(bar.date) || !isNyseTradingDay(bar.date) || !Number.isFinite(bar.close) || bar.close <= 0 || result.has(bar.date)) {
      throw new Error(`Invalid price history for ${ticker}.`);
    }
    if (bar.date <= priceAsOf) result.set(bar.date, bar.close);
  }
  return result;
};
const alignedPrices = (series: Map<string, number>, dates: string[]) => {
  if (!dates.length) return null;
  const prices = dates.map((date) => series.get(date));
  return prices.every((value): value is number => value !== undefined) ? prices : null;
};
const priceReturn = (prices: number[] | null) => prices ? round(100 * (prices[prices.length - 1] / prices[0] - 1)) : null;
const relativeReturn = (asset: number | null, benchmark: number | null) => asset === null || benchmark === null
  ? null : round(100 * ((1 + asset / 100) / (1 + benchmark / 100) - 1));
const breadthCell = (values: Array<boolean | null>): BreadthCell => {
  const eligible = values.filter((value) => value !== null).length;
  const above = values.filter((value) => value === true).length;
  return { above, eligible, total: values.length, pct: eligible ? round(100 * above / eligible) : null };
};
const aboveSma = (series: Map<string, number>, benchmarkDates: string[], period: number): boolean | null => {
  if (benchmarkDates.length < period) return null;
  const prices = alignedPrices(series, benchmarkDates.slice(-period));
  return prices ? prices[prices.length - 1] > prices.reduce((sum, close) => sum + close, 0) / period : null;
};
const makeRotation = (series: Map<string, number>, spy: Map<string, number>, priceAsOf: string): SectorRotationRow["rotation"] => {
  const lastWeek = completedNyseWeekCloseDate(priceAsOf);
  const earliest = [...spy.keys()].sort()[0];
  const weeks: string[] = [];
  let cursor = lastWeek;
  while (earliest && cursor >= earliest && weeks.length < 65) {
    weeks.unshift(cursor);
    cursor = previousCompletedWeek(cursor);
  }
  const rs = weeks.map((date) => {
    const close = series.get(date);
    const spyClose = spy.get(date);
    return close !== undefined && spyClose !== undefined ? close / spyClose : null;
  });
  const ratios = rs.map((value, index) => {
    const prior = rs.slice(index - 9, index + 1);
    return index >= 9 && value !== null && prior.every((row): row is number => row !== null)
      ? 100 * value / (prior.reduce((sum, row) => sum + row, 0) / 10) : null;
  });
  const points = weeks.map((date, index): RotationPoint | null => {
    const ratio = ratios[index];
    const prior = ratios.slice(index - 3, index + 1);
    if (index < 12 || ratio === null || !prior.every((row): row is number => row !== null)) return null;
    const rsRatio = round(ratio);
    const rsMomentum = round(100 * ratio / (prior.reduce((sum, row) => sum + row, 0) / 4));
    return { date, rsRatio, rsMomentum, quadrant: classifySectorRotationQuadrant(rsRatio, rsMomentum) };
  });
  // Keep only the contiguous covered tail: never join across an unavailable week.
  const trail: RotationPoint[] = [];
  for (let index = points.length - 1; index >= 0 && trail.length < 52; index -= 1) {
    const point = points[index];
    if (!point) break;
    trail.unshift(point);
  }
  const latest = trail[trail.length - 1];
  return latest ? { asOf: latest.date, rsRatio: latest.rsRatio, rsMomentum: latest.rsMomentum, quadrant: latest.quadrant, trail }
    : { asOf: null, rsRatio: null, rsMomentum: null, quadrant: "Unavailable", trail: [] };
};

const fail = (message: string): never => { throw new Error(`Sector rotation validation failed: ${message}`); };
const closeEnough = (left: number, right: number, tolerance = 0.00002) => Math.abs(left - right) <= tolerance;
const validateUniverse = (universe: SectorUniverse) => {
  if (!dateValid(universe.holdingsAsOf) || !Array.isArray(universe.holdings) || !universe.holdings.length
    || universe.universeCount !== universe.holdings.length || universe.sectorWeights.length !== 11) fail("invalid universe");
  const expected = new Map(MARKET_BREADTH_SECTORS.map((row) => [row.sector as string, row.etf as string]));
  const tickers = new Set<string>();
  for (const holding of universe.holdings) {
    if (typeof holding.ticker !== "string" || !/^[A-Z0-9-]+$/.test(holding.ticker) || tickers.has(holding.ticker)
      || typeof holding.name !== "string" || expected.get(holding.sector) !== holding.sectorEtf
      || !Number.isFinite(holding.weightPct) || holding.weightPct <= 0) fail("invalid or duplicate holding membership");
    tickers.add(holding.ticker);
  }
  const sectors = new Set<string>();
  for (const sector of universe.sectorWeights) {
    const holdings = universe.holdings.filter((holding) => holding.sector === sector.sector);
    if (expected.get(sector.sector) !== sector.etf || sectors.has(sector.sector) || !holdings.length
      || sector.holdingCount !== holdings.length || !Number.isFinite(sector.weightPct) || sector.weightPct <= 0
      || !closeEnough(sector.weightPct, holdings.reduce((sum, holding) => sum + holding.weightPct, 0), 0.0000501)) fail("invalid sector weights");
    sectors.add(sector.sector);
  }
  const total = universe.holdings.reduce((sum, holding) => sum + holding.weightPct, 0);
  if (!Number.isFinite(universe.totalWeightPct) || !closeEnough(total, universe.totalWeightPct, 0.0000501) || total < 95 || total > 105) fail("invalid total weights");
};

export const calculateSectorRotationSnapshotId = (snapshot: Omit<SectorRotationSnapshot, "snapshotId"> | SectorRotationSnapshot) => {
  const content = { ...snapshot } as Partial<SectorRotationSnapshot> & { status?: unknown; freshness?: unknown };
  delete content.snapshotId;
  // The API adds delivery metadata after reading the immutable snapshot.
  delete content.status;
  delete content.freshness;
  const json = JSON.stringify(content);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) hash = Math.imul(hash ^ json.charCodeAt(index), 0x01000193);
  return `sector-rotation-v1-${snapshot.priceAsOf}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const buildSectorRotationSnapshot = (input: {
  universe: SectorUniverse;
  priceSeries: Map<string, PriceBar[]>;
  priceAsOf: string;
  generatedAt: string;
  sourceSnapshotId: string;
}): SectorRotationSnapshot => {
  validateUniverse(input.universe);
  if (!dateValid(input.priceAsOf) || !isNyseTradingDay(input.priceAsOf)) fail("invalid price date");
  if (!Number.isFinite(Date.parse(input.generatedAt)) || !input.sourceSnapshotId) fail("invalid source identity");
  const required = ["SPY", ...MARKET_BREADTH_SECTORS.map((row) => row.etf), ...input.universe.holdings.map((holding) => holding.ticker)];
  const series = new Map(required.map((ticker) => [ticker, checkedSeries(input.priceSeries.get(ticker) || [], ticker, input.priceAsOf)]));
  const spy = series.get("SPY")!;
  const spyDates = [...spy.keys()].sort();
  if (spyDates[spyDates.length - 1] !== input.priceAsOf) fail("SPY current close missing");
  for (let date = spyDates[0]; date < input.priceAsOf; date = shiftDate(date, 1)) {
    if (isNyseTradingDay(date) && !spy.has(date)) fail(`SPY session gap at ${date}`);
  }
  const windowDates = recordWindows((sessions) => spyDates.length > sessions ? spyDates.slice(-(sessions + 1)) : []);
  const returnsFor = (prices: Map<string, number>) => recordWindows((_sessions, key) => priceReturn(alignedPrices(prices, windowDates[key])));
  const spyReturns = returnsFor(spy);
  const sectorReturns = new Map(MARKET_BREADTH_SECTORS.map((row) => [row.etf as string, returnsFor(series.get(row.etf)!)]));
  const holdings: SectorRotationHolding[] = input.universe.holdings.map((holding) => {
    const prices = series.get(holding.ticker)!;
    const returns = returnsFor(prices);
    // Source sector totals are rounded to four decimals. Normalize against the
    // actual member weights so every sector remains a 100% basket.
    const sectorWeight = input.universe.holdings.filter((row) => row.sector === holding.sector)
      .reduce((sum, row) => sum + row.weightPct, 0);
    const sectorWeightPct = round(100 * holding.weightPct / sectorWeight);
    return {
      ticker: holding.ticker, name: holding.name, sector: holding.sector, sectorEtf: holding.sectorEtf,
      spyWeightPct: holding.weightPct, sectorWeightPct, returns,
      relativeToSpy: recordWindows((_sessions, key) => relativeReturn(returns[key], spyReturns[key])),
      relativeToSector: recordWindows((_sessions, key) => relativeReturn(returns[key], sectorReturns.get(holding.sectorEtf)![key])),
      contributionProxy: recordWindows((_sessions, key) => returns[key] === null ? null : round(sectorWeightPct / 100 * returns[key]!)),
      aboveSma50: aboveSma(prices, spyDates, 50), aboveSma200: aboveSma(prices, spyDates, 200),
    };
  });
  const sectors: SectorRotationRow[] = MARKET_BREADTH_SECTORS.map(({ sector, etf }) => {
    const weight = input.universe.sectorWeights.find((row) => row.sector === sector)!;
    const members = holdings.filter((holding) => holding.sector === sector);
    const prices = series.get(etf)!;
    const returns = sectorReturns.get(etf)!;
    return {
      sector, etf, weightPct: weight.weightPct, holdingCount: members.length, returns,
      relativeToSpy: recordWindows((_sessions, key) => relativeReturn(returns[key], spyReturns[key])),
      rotation: makeRotation(prices, spy, input.priceAsOf),
      breadth: {
        sma50: breadthCell(members.map((holding) => holding.aboveSma50)),
        sma200: breadthCell(members.map((holding) => holding.aboveSma200)),
        positiveReturn: recordWindows((_sessions, key) => breadthCell(members.map((holding) => holding.returns[key] === null ? null : holding.returns[key]! > 0))),
        outperformingSpy: recordWindows((_sessions, key) => breadthCell(members.map((holding) => holding.relativeToSpy[key] === null ? null : holding.relativeToSpy[key]! > 0))),
      },
      performance: recordWindows((_sessions, key) => {
        const dates = windowDates[key];
        const asset = alignedPrices(prices, dates);
        const benchmark = alignedPrices(spy, dates);
        return asset && benchmark ? dates.map((date, index) => ({
          date, value: round(100 * asset[index] / asset[0]),
          relativeValue: round(100 * (asset[index] / benchmark[index]) / (asset[0] / benchmark[0])),
        })) : [];
      }),
    };
  });
  const snapshot: Omit<SectorRotationSnapshot, "snapshotId"> = {
    schemaVersion: SECTOR_ROTATION_SCHEMA_VERSION, sourceSnapshotId: input.sourceSnapshotId,
    generatedAt: input.generatedAt, holdingsAsOf: input.universe.holdingsAsOf, priceAsOf: input.priceAsOf,
    universeCount: holdings.length, model: SECTOR_ROTATION_MODEL,
    benchmark: { symbol: "SPY", returns: spyReturns }, sectors, holdings,
    coverage: {
      currentPriceCount: input.universe.holdings.filter((holding) => series.get(holding.ticker)!.has(input.priceAsOf)).length,
      totalConstituents: holdings.length,
      eligibleByWindow: recordWindows((_sessions, key) => holdings.filter((holding) => holding.returns[key] !== null).length),
      completedWeekAsOf: completedNyseWeekCloseDate(input.priceAsOf),
      availableSectorRotations: sectors.filter((sector) => sector.rotation.quadrant !== "Unavailable").length,
    },
    warnings: [
      "Custom relative-rotation model, not the proprietary JdK RRG algorithm.",
      "Split-adjusted price returns exclude dividends. Relative strength does not imply a positive absolute return.",
      "Current holdings and weights are applied throughout the window; contribution is a proxy, not historical attribution.",
      ...(holdings.some((holding) => holding.returns.twelveMonths === null) ? ["Some constituents lack aligned 12-month history; unavailable observations are excluded from eligible breadth."] : []),
      ...(sectors.some((sector) => sector.rotation.quadrant === "Unavailable") ? ["Some sectors lack 13 consecutive completed weekly observations for the rotation model."] : []),
    ],
  };
  return validateSectorRotationSnapshot({ ...snapshot, snapshotId: calculateSectorRotationSnapshotId(snapshot) });
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const numberOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value));
const validateWindows = (value: unknown) => {
  if (!isObject(value) || SECTOR_ROTATION_WINDOWS.some(({ key }) => !numberOrNull(value[key]))) fail("invalid return windows");
};
const validateBreadth = (value: BreadthCell, total: number) => {
  if (!isObject(value) || ![value.above, value.eligible, value.total].every((count) => Number.isInteger(count) && count >= 0)
    || value.total !== total || value.above > value.eligible || value.eligible > value.total || !numberOrNull(value.pct)
    || (value.eligible === 0 ? value.pct !== null : value.pct === null || !closeEnough(value.pct, 100 * value.above / value.eligible))) fail("invalid breadth counts");
};

export const validateSectorRotationSnapshot = (value: unknown): SectorRotationSnapshot => {
  if (!isObject(value)) fail("snapshot is not an object");
  const snapshot = value as unknown as SectorRotationSnapshot;
  if (snapshot.schemaVersion !== 1 || typeof snapshot.snapshotId !== "string" || typeof snapshot.sourceSnapshotId !== "string"
    || !snapshot.sourceSnapshotId || !dateValid(snapshot.priceAsOf) || !isNyseTradingDay(snapshot.priceAsOf)
    || !dateValid(snapshot.holdingsAsOf) || typeof snapshot.generatedAt !== "string" || !Number.isFinite(Date.parse(snapshot.generatedAt))
    || !Array.isArray(snapshot.sectors) || snapshot.sectors.length !== 11 || !Array.isArray(snapshot.holdings)
    || snapshot.holdings.length !== snapshot.universeCount || snapshot.universeCount < 11 || snapshot.universeCount > 1000
    || JSON.stringify(snapshot.model) !== JSON.stringify(SECTOR_ROTATION_MODEL)
    || !isObject(snapshot.benchmark) || snapshot.benchmark.symbol !== "SPY" || !Array.isArray(snapshot.warnings)
    || snapshot.warnings.length > 20 || snapshot.warnings.some((warning) => typeof warning !== "string" || warning.length > 1000)) fail("invalid metadata");
  validateWindows(snapshot.benchmark.returns);
  if (SECTOR_ROTATION_WINDOWS.some(({ key }) => snapshot.benchmark.returns[key] !== null && snapshot.benchmark.returns[key]! <= -100)) fail("invalid benchmark return");
  const expectedWindowDates = recordWindows((sessions) => sessionDatesEnding(snapshot.priceAsOf, sessions + 1));
  const completedWeek = completedNyseWeekCloseDate(snapshot.priceAsOf);
  const expectedWeekDates: string[] = [];
  for (let cursor = completedWeek; expectedWeekDates.length < 52; cursor = previousCompletedWeek(cursor)) expectedWeekDates.unshift(cursor);
  const expected = new Map(MARKET_BREADTH_SECTORS.map((row) => [row.sector as string, row.etf as string]));
  const tickers = new Set<string>();
  for (const holding of snapshot.holdings) {
    if (!isObject(holding) || typeof holding.ticker !== "string" || !/^[A-Z0-9-]+$/.test(holding.ticker) || tickers.has(holding.ticker)
      || typeof holding.name !== "string" || expected.get(holding.sector) !== holding.sectorEtf
      || !Number.isFinite(holding.spyWeightPct) || holding.spyWeightPct <= 0 || holding.spyWeightPct > 100
      || !Number.isFinite(holding.sectorWeightPct) || holding.sectorWeightPct <= 0 || holding.sectorWeightPct > 100.000001
      || ![holding.aboveSma50, holding.aboveSma200].every((flag) => flag === null || typeof flag === "boolean")) fail("invalid holding");
    tickers.add(holding.ticker);
    [holding.returns, holding.relativeToSpy, holding.relativeToSector, holding.contributionProxy].forEach(validateWindows);
    for (const { key } of SECTOR_ROTATION_WINDOWS) {
      const stockReturn = holding.returns[key];
      if (stockReturn !== null && stockReturn <= -100) fail("invalid stock return");
      if (holding.relativeToSpy[key] !== relativeReturn(stockReturn, snapshot.benchmark.returns[key])) fail("stock/SPY relative return mismatch");
      const expectedContribution = stockReturn === null ? null : holding.sectorWeightPct / 100 * stockReturn;
      if (expectedContribution === null ? holding.contributionProxy[key] !== null
        : holding.contributionProxy[key] === null || !closeEnough(holding.contributionProxy[key]!, expectedContribution, Math.max(0.00002, Math.abs(stockReturn!) * 0.00000001))) fail("contribution proxy mismatch");
    }
  }
  const sectors = new Set<string>();
  for (const sector of snapshot.sectors) {
    if (!isObject(sector) || expected.get(sector.sector) !== sector.etf || sectors.has(sector.sector)
      || !Number.isFinite(sector.weightPct) || sector.weightPct <= 0 || sector.weightPct > 105) fail("invalid sector identity");
    sectors.add(sector.sector);
    const members = snapshot.holdings.filter((holding) => holding.sector === sector.sector);
    if (!members.length || sector.holdingCount !== members.length
      || !closeEnough(sector.weightPct, members.reduce((sum, holding) => sum + holding.spyWeightPct, 0), 0.0000501)
      || !closeEnough(members.reduce((sum, holding) => sum + holding.sectorWeightPct, 0), 100, 0.001)) fail("invalid sector membership counts or weights");
    validateWindows(sector.returns); validateWindows(sector.relativeToSpy);
    if (!isObject(sector.breadth) || !isObject(sector.breadth.positiveReturn) || !isObject(sector.breadth.outperformingSpy)
      || !isObject(sector.performance) || !isObject(sector.rotation)) fail("missing sector analysis");
    validateBreadth(sector.breadth.sma50, members.length); validateBreadth(sector.breadth.sma200, members.length);
    for (const [period, flags] of [["sma50", members.map((holding) => holding.aboveSma50)], ["sma200", members.map((holding) => holding.aboveSma200)]] as const) {
      if (JSON.stringify(sector.breadth[period]) !== JSON.stringify(breadthCell([...flags]))) fail("SMA breadth mismatch");
    }
    for (const { key, sessions } of SECTOR_ROTATION_WINDOWS) {
      const sectorReturn = sector.returns[key];
      if (sectorReturn !== null && sectorReturn <= -100) fail("invalid sector return");
      if (sector.relativeToSpy[key] !== relativeReturn(sectorReturn, snapshot.benchmark.returns[key])) fail("sector/SPY relative return mismatch");
      for (const holding of members) {
        const actualSectorWeight = members.reduce((sum, member) => sum + member.spyWeightPct, 0);
        if (!closeEnough(holding.sectorWeightPct, 100 * holding.spyWeightPct / actualSectorWeight)
          || holding.relativeToSector[key] !== relativeReturn(holding.returns[key], sectorReturn)) fail("holding/sector identity mismatch");
      }
      validateBreadth(sector.breadth.positiveReturn[key], members.length);
      validateBreadth(sector.breadth.outperformingSpy[key], members.length);
      if (JSON.stringify(sector.breadth.positiveReturn[key]) !== JSON.stringify(breadthCell(members.map((holding) => holding.returns[key] === null ? null : holding.returns[key]! > 0)))
        || JSON.stringify(sector.breadth.outperformingSpy[key]) !== JSON.stringify(breadthCell(members.map((holding) => holding.relativeToSpy[key] === null ? null : holding.relativeToSpy[key]! > 0)))) fail("return breadth mismatch");
      const points = sector.performance[key];
      if (!Array.isArray(points) || points.length !== (sectorReturn === null ? 0 : sessions + 1)) fail("invalid performance length");
      const expectedDates = expectedWindowDates[key];
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!isObject(point) || point.date !== expectedDates[index]
          || !Number.isFinite(point.value) || point.value <= 0 || !Number.isFinite(point.relativeValue) || point.relativeValue <= 0) fail("invalid performance point");
      }
      if (points.length && (points[0].value !== 100 || points[0].relativeValue !== 100 || points[points.length - 1].date !== snapshot.priceAsOf
        || !closeEnough(points[points.length - 1].value - 100, sectorReturn!)
        || !closeEnough(points[points.length - 1].relativeValue - 100, sector.relativeToSpy[key]!))) fail("performance endpoint mismatch");
    }
    const rotation = sector.rotation;
    if (!numberOrNull(rotation.rsRatio) || !numberOrNull(rotation.rsMomentum) || !Array.isArray(rotation.trail) || rotation.trail.length > 52
      || rotation.quadrant !== classifySectorRotationQuadrant(rotation.rsRatio, rotation.rsMomentum)) fail("invalid rotation state");
    if (rotation.quadrant === "Unavailable") {
      if (rotation.asOf !== null || rotation.rsRatio !== null || rotation.rsMomentum !== null || rotation.trail.length) fail("unavailable rotation has coordinates");
    } else {
      const latest = rotation.trail[rotation.trail.length - 1];
      if (!latest || rotation.asOf !== latest.date || rotation.rsRatio !== latest.rsRatio || rotation.rsMomentum !== latest.rsMomentum
        || rotation.asOf !== completedWeek) fail("rotation latest point mismatch");
    }
    for (let index = 0; index < rotation.trail.length; index += 1) {
      const point = rotation.trail[index];
      if (!isObject(point) || point.date !== expectedWeekDates[52 - rotation.trail.length + index]
        || !Number.isFinite(point.rsRatio) || !Number.isFinite(point.rsMomentum)
        || point.quadrant !== classifySectorRotationQuadrant(point.rsRatio, point.rsMomentum)) fail("invalid rotation trail");
    }
  }
  const coverage = snapshot.coverage;
  if (!isObject(coverage) || !isObject(coverage.eligibleByWindow) || coverage.totalConstituents !== snapshot.universeCount
    || !Number.isInteger(coverage.currentPriceCount) || coverage.currentPriceCount < 0 || coverage.currentPriceCount > snapshot.universeCount
    || coverage.completedWeekAsOf !== completedWeek
    || coverage.availableSectorRotations !== snapshot.sectors.filter((sector) => sector.rotation.quadrant !== "Unavailable").length
    || SECTOR_ROTATION_WINDOWS.some(({ key }) => coverage.eligibleByWindow[key] !== snapshot.holdings.filter((holding) => holding.returns[key] !== null).length)) fail("invalid coverage");
  const totalWeight = snapshot.holdings.reduce((sum, holding) => sum + holding.spyWeightPct, 0);
  if (totalWeight < 95 || totalWeight > 105 || snapshot.snapshotId !== calculateSectorRotationSnapshotId(snapshot)) fail("invalid payload identity");
  return snapshot;
};
