import type { D1DatabaseLike } from "./spx-recap-d1";

const MARKET_TIME_ZONE = "America/New_York";
const SESSION_START_MINUTE_ET = 9 * 60 + 15;
const SESSION_END_MINUTE_ET = 16 * 60;
const SNAPSHOT_INTERVAL_MINUTES = 15;
const CONTRACT_MULTIPLIER = 100;
const RISK_FREE_RATE = 0.04;
const MIN_DTE_YEARS = 1 / (365 * 24 * 4);
const DEFAULT_EXPIRY_COUNT = 5;
const DEFAULT_MAX_STRIKES = 96;
const DEFAULT_STRIKE_RANGE_PCT = 0.05;

export interface SpxGexQuote {
  ticker: string;
  last: number;
  change: string;
  changePercent: string;
}

export interface SpxGexOptionLeg {
  contractSymbol?: string;
  strike: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
}

export interface SpxGexOptionChain {
  symbol: string;
  spot: number;
  expiries: string[];
  selectedExpiry: string | null;
  calls: SpxGexOptionLeg[];
  puts: SpxGexOptionLeg[];
}

export interface SpxGexZeroDte {
  expiry: string;
  sessionPhase: string | null;
  nowEt: string | null;
  pinLevel: number | null;
  gammaFlip: number | null;
  netGex: number | null;
  netDex: number | null;
  netVex?: number | null;
  netCex?: number | null;
  topCallWall: string | null;
  topCallWallLevel: number | null;
  topPutWall: string | null;
  topPutWallLevel: number | null;
  charmRegime: string | null;
}

export interface SpxGexHeatmapCell {
  strike: number;
  expdate: string;
  netGex: number | null;
  callGex?: number | null;
  putGex?: number | null;
  netDex?: number | null;
  netVex?: number | null;
  netCex?: number | null;
  callOpenInterest?: number;
  putOpenInterest?: number;
  totalOpenInterest?: number;
  totalVolume?: number;
  avgIv?: number | null;
  approximate?: boolean;
}

export interface SpxGexStrikeProfile {
  strike: number;
  netGex: number;
  callGex: number;
  putGex: number;
  netDex: number;
  netVex: number;
  netCex: number;
  totalOpenInterest: number;
  totalVolume: number;
  dominantExpiry: string | null;
  tags: SpxGexStructureTag[];
}

export type SpxGexStructureTagType =
  | "now"
  | "pin"
  | "gamma_flip"
  | "upper_shelf"
  | "near_resistance"
  | "minor_resistance"
  | "big_call_wall"
  | "resistance_zone"
  | "lower_shelf"
  | "air_gap"
  | "oi_spike"
  | "key_support"
  | "structural_support";

export interface SpxGexStructureTag {
  type: SpxGexStructureTagType;
  label: string;
  severity: "info" | "watch" | "major";
  source: string;
}

export interface SpxGexSnapshotMeta {
  tradingDate: string;
  snapshotMinuteEt: number;
  snapshotTimeEt: string;
  generatedAt: string;
  spot: number;
}

export type SpxGexPremarketRegime = "bullish_above_flip" | "bearish_below_flip" | "pinning_range" | "mixed";

export interface SpxGexMarketContext {
  macroRegime: string | null;
  breadth: {
    advancers: number;
    universeCount: number;
    avgChange: number | null;
  } | null;
  flow: {
    topTicker: string;
    proxyFlow: number;
    changePercent: number;
  } | null;
  latestHeadline: string | null;
  warnings: string[];
}

export interface SpxGexPremarketInterpretation {
  paragraph: string;
  levels: {
    dividingLine: string;
    upside: string;
    downside: string;
  };
  regime: SpxGexPremarketRegime;
  context: string | null;
  warnings: string[];
}

export interface SpxGexHeatmapModel {
  generatedAt: string;
  ticker: "SPX";
  quote: SpxGexQuote;
  snapshot: string | null;
  session: SpxGexSnapshotMeta | null;
  selectedExpiries: string[];
  strikeRange: {
    lower: number;
    upper: number;
  };
  strikes: number[];
  cells: SpxGexHeatmapCell[];
  totals: Array<{
    expdate: string;
    netGex: number;
    netDex?: number;
    netVex?: number;
    netCex?: number;
  }>;
  strikeProfiles: SpxGexStrikeProfile[];
  zeroDte: SpxGexZeroDte;
  premarketInterpretation: SpxGexPremarketInterpretation;
  source: {
    quoteTool: string;
    optionExpiryTool: string;
    gexTool: string;
    zeroDteTool: string;
    gexTopRows: number;
    note: string;
  };
}

export interface SpxGexSessionSummary {
  tradingDate: string;
  snapshotMinuteEt: number;
  snapshotTimeEt: string;
  generatedAt: string;
  spot: number;
}

export interface BuildSpxGexHeatmapInput {
  generatedAt: string;
  quoteText: string;
  optionsText: string;
  zeroDteText: string;
  gexByExpiryText: Record<string, string>;
  marketContext?: SpxGexMarketContext | null;
}

export interface BuildSpxGexHeatmapFromOptionChainsInput {
  generatedAt: string;
  quoteText?: string;
  chains: SpxGexOptionChain[];
  selectedExpiries?: string[];
  marketContext?: SpxGexMarketContext | null;
  maxStrikes?: number;
}

export interface SpxGexDataClient {
  getQuotes: () => Promise<string>;
  getOptions: () => Promise<string>;
  getOptions0Dte: () => Promise<string>;
  getOptionsGex: (expiry: string) => Promise<string>;
  getOptionsChain?: (expiry?: string) => Promise<SpxGexOptionChain>;
  getMarketContext?: () => Promise<SpxGexMarketContext>;
}

export type SpxGexGenerationResult =
  | { status: "generated"; date: string; snapshotMinuteEt: number; snapshotTimeEt: string }
  | { status: "skipped_existing"; date: string; snapshotMinuteEt: number; snapshotTimeEt: string }
  | { status: "skipped"; date: string; reason: string };

interface D1SpxGexHeatmapRow {
  date: string;
  generated_at: string;
  snapshot_at: string | null;
  ticker: string;
  spot: number;
  quote_json: string;
  expiries_json: string;
  strikes_json: string;
  cells_json: string;
  totals_json: string;
  zero_dte_json: string;
  interpretation_json?: string | null;
  source_json: string;
}

interface D1SpxGexIntradayRow {
  trading_date: string;
  snapshot_minute_et: number;
  snapshot_time_et: string;
  generated_at: string;
  spot: number;
  snapshot_json: string;
}

const toDateKey = (year: number, month: number, day: number) =>
  `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

const toEasternDate = (date: Date) => new Date(date.toLocaleString("en-US", { timeZone: MARKET_TIME_ZONE }));

const getEtMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();

const formatEtMinute = (minute: number) =>
  `${Math.floor(minute / 60).toString().padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;

const observedHolidayKey = (year: number, monthIndex: number, day: number) => {
  const date = new Date(year, monthIndex, day);
  const weekday = date.getDay();
  if (weekday === 6) date.setDate(date.getDate() - 1);
  if (weekday === 0) date.setDate(date.getDate() + 1);
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
};

const nthWeekdayOfMonth = (year: number, monthIndex: number, weekday: number, nth: number) => {
  const date = new Date(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
};

const lastWeekdayOfMonth = (year: number, monthIndex: number, weekday: number) => {
  const date = new Date(year, monthIndex + 1, 0);
  const offset = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date;
};

const getEasterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

export const getFullMarketHolidayKeys = (year: number) => {
  const holidays = new Set<string>();
  const addDate = (date: Date) => holidays.add(toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()));

  holidays.add(observedHolidayKey(year, 0, 1));
  holidays.add(observedHolidayKey(year + 1, 0, 1));
  addDate(nthWeekdayOfMonth(year, 0, 1, 3));
  addDate(nthWeekdayOfMonth(year, 1, 1, 3));

  const goodFriday = getEasterSunday(year);
  goodFriday.setDate(goodFriday.getDate() - 2);
  addDate(goodFriday);

  addDate(lastWeekdayOfMonth(year, 4, 1));

  if (year >= 2022) holidays.add(observedHolidayKey(year, 5, 19));

  holidays.add(observedHolidayKey(year, 6, 4));
  addDate(nthWeekdayOfMonth(year, 8, 1, 1));
  addDate(nthWeekdayOfMonth(year, 10, 4, 4));
  holidays.add(observedHolidayKey(year, 11, 25));

  return holidays;
};

export const getSpxGexGenerationStatus = (now: Date = new Date()) => {
  const etNow = toEasternDate(now);
  const etDateKey = toDateKey(etNow.getFullYear(), etNow.getMonth() + 1, etNow.getDate());
  const weekday = etNow.getDay();
  const minutes = getEtMinutes(etNow);
  const isWeekend = weekday === 0 || weekday === 6;
  const isFullHoliday = getFullMarketHolidayKeys(etNow.getFullYear()).has(etDateKey);
  const isMarketOpenDay = !isWeekend && !isFullHoliday;
  const isGenerationMinute =
    minutes >= SESSION_START_MINUTE_ET &&
    minutes <= SESSION_END_MINUTE_ET &&
    (minutes - SESSION_START_MINUTE_ET) % SNAPSHOT_INTERVAL_MINUTES === 0;

  return {
    etNow,
    etDateKey,
    minutes,
    snapshotMinuteEt: minutes,
    snapshotTimeEt: formatEtMinute(minutes),
    isMarketOpenDay,
    isGenerationWindow: isMarketOpenDay && isGenerationMinute,
    skipReason: isWeekend ? "weekend" : isFullHoliday ? "us_market_holiday" : null,
  };
};

const parseTableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

const parseDollarNumber = (value: string) => {
  const match = value.match(/\$?(-?[0-9][0-9,.]*)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
};

const parseGexNumber = (value: string) => {
  const clean = value.replace(/\*\*/g, "").replace(/,/g, "").trim();
  const match = clean.match(/(-?[0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
  if (!match) return null;

  const base = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return base * multiplier;
};

const parseQuote = (text: string): SpxGexQuote => {
  const row = text.split("\n").find((line) => /^\|\s*SPX\s*\|/.test(line));
  if (!row) throw new Error("Could not parse SPX quote row.");

  const cells = parseTableCells(row);
  const ticker = cells[0];
  const lastIndex = cells.findIndex((cell) => cell.includes("$"));
  const last = lastIndex >= 0 ? cells[lastIndex] : cells[1];
  const change = lastIndex >= 0 ? cells[lastIndex + 1] || "" : cells[2];
  const changePercent = lastIndex >= 0 ? cells[lastIndex + 2] || "" : cells[3];
  const lastValue = parseDollarNumber(last);
  if (lastValue === null) throw new Error("Could not parse SPX quote last price.");

  return { ticker, last: lastValue, change, changePercent };
};

const quoteFromChain = (chain: SpxGexOptionChain, quoteText?: string): SpxGexQuote => {
  if (quoteText) {
    try {
      return parseQuote(quoteText);
    } catch {
      // Chain spot is safer than failing a live snapshot because the quote table shape drifted.
    }
  }
  return { ticker: "SPX", last: chain.spot, change: "n/a", changePercent: "n/a" };
};

const parseAvailableExpiries = (text: string) => {
  const match = text.match(/\*\*Available expiries:\*\*\s*([^\n]+)/);
  if (!match) throw new Error("Could not parse available expiries.");
  return match[1].split(/\s*,\s*/).filter(Boolean);
};

const parseMetricTable = (text: string) => {
  const metrics = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableCells(line);
    if (cells.length >= 2) metrics.set(cells[0], cells[1]);
  }
  return metrics;
};

const parseZeroDte = (text: string): SpxGexZeroDte => {
  const metrics = parseMetricTable(text);
  const snapshotLine = text.split("\n").find((line) => line.includes("**Snapshot:**")) || "";
  const expiry = text.match(/\*\*Expiry:\*\*\s*([0-9-]+)/)?.[1];
  if (!expiry) throw new Error("Could not parse 0DTE expiry.");

  const topCallWall = metrics.get("Top call wall")?.replace(/\*\*/g, "").trim() || null;
  const topPutWall = metrics.get("Top put wall")?.replace(/\*\*/g, "").trim() || null;

  return {
    expiry,
    sessionPhase: snapshotLine.match(/\*\*Session phase:\*\*\s*`([^`]+)`/)?.[1] || null,
    nowEt: snapshotLine.match(/\*\*Now \(ET\):\*\*\s*([^*]+)/)?.[1]?.trim() || null,
    pinLevel: parseDollarNumber(text.match(/\*\*Pin level:\*\*\s*([^\n]+)/)?.[1] || ""),
    gammaFlip: parseDollarNumber(text.match(/Flip level:\s*([^\n]+)/)?.[1] || ""),
    netGex: parseGexNumber(metrics.get("Net GEX") || ""),
    netDex: parseGexNumber(metrics.get("Net DEX") || ""),
    topCallWall,
    topCallWallLevel: topCallWall ? parseDollarNumber(topCallWall) : null,
    topPutWall,
    topPutWallLevel: topPutWall ? parseDollarNumber(topPutWall) : null,
    charmRegime: metrics.get("Charm regime")?.replace(/`/g, "").trim() || null,
  };
};

const selectActiveExpiries = (availableExpiries: string[], frontExpiry: string, count: number) =>
  availableExpiries.filter((expiry) => expiry >= frontExpiry).slice(0, count);

export const selectSpxGexActiveExpiriesFromToolText = (optionsText: string, zeroDteText: string, count = DEFAULT_EXPIRY_COUNT) => {
  const zeroDte = parseZeroDte(zeroDteText);
  return selectActiveExpiries(parseAvailableExpiries(optionsText), zeroDte.expiry, count);
};

const parseGexRows = (expiry: string, text: string) => {
  const rows: Array<{ strike: number; expdate: string; netGex: number }> = [];

  for (const line of text.split("\n")) {
    if (!/^\|\s*(\*\*)?\$[0-9,.]+/.test(line)) continue;
    const cells = parseTableCells(line);
    if (cells.length < 4) continue;
    const strike = parseDollarNumber(cells[0]);
    const netGex = parseGexNumber(cells[3]);
    if (strike === null || netGex === null) continue;
    rows.push({ strike, expdate: expiry, netGex });
  }

  return {
    snapshot: text.match(/\*\*Snapshot:\*\*\s*([0-9T:.\-]+)/)?.[1] || null,
    rows,
  };
};

const compactExposure = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${value >= 0 ? "+" : ""}${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${value >= 0 ? "+" : ""}${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${value >= 0 ? "+" : ""}${(value / 1_000).toFixed(0)}K`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}`;
};

const formatStoredLevel = (value: number) => `$${value.toFixed(0)}`;

const normalPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
};

const normalCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

const normalizeIv = (value: number | undefined) => {
  const raw = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 20;
  const decimal = raw > 3 ? raw / 100 : raw;
  return Math.min(5, Math.max(0.01, decimal));
};

const effectiveOpenInterest = (leg: SpxGexOptionLeg | undefined) => {
  if (!leg) return 0;
  return leg.openInterest > 0 ? leg.openInterest : leg.volume;
};

const expiryToYears = (expiry: string, now: Date) => {
  const expiryTime = new Date(`${expiry}T21:00:00Z`).getTime();
  const years = (expiryTime - now.getTime()) / (365 * 24 * 60 * 60 * 1000);
  return Math.max(MIN_DTE_YEARS, years);
};

export const calculateBlackScholesExposures = (input: {
  spot: number;
  strike: number;
  yearsToExpiry: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callIv: number;
  putIv: number;
}) => {
  const calculateSide = (side: "call" | "put", iv: number, oi: number) => {
    if (input.spot <= 0 || input.strike <= 0 || oi <= 0) {
      return { deltaExposure: 0, gammaExposure: 0, vannaExposure: 0, charmExposure: 0 };
    }

    const sigma = normalizeIv(iv);
    const t = Math.max(MIN_DTE_YEARS, input.yearsToExpiry);
    const sqrtT = Math.sqrt(t);
    const d1 = (Math.log(input.spot / input.strike) + (RISK_FREE_RATE + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const pdf = normalPdf(d1);
    const delta = side === "call" ? normalCdf(d1) : normalCdf(d1) - 1;
    const gamma = pdf / (input.spot * sigma * sqrtT);
    const vanna = -pdf * d2 / sigma;
    const charm = -pdf * ((2 * RISK_FREE_RATE * t) - (d2 * sigma * sqrtT)) / (2 * t * sigma * sqrtT);

    return {
      deltaExposure: delta * oi * CONTRACT_MULTIPLIER * input.spot,
      gammaExposure: gamma * oi * CONTRACT_MULTIPLIER * input.spot * input.spot * 0.01,
      vannaExposure: vanna * oi * CONTRACT_MULTIPLIER * input.spot * 0.01,
      charmExposure: charm * oi * CONTRACT_MULTIPLIER * input.spot / 365,
    };
  };

  const call = calculateSide("call", input.callIv, input.callOpenInterest);
  const put = calculateSide("put", input.putIv, input.putOpenInterest);

  return {
    callGex: call.gammaExposure,
    putGex: -put.gammaExposure,
    netGex: call.gammaExposure - put.gammaExposure,
    callDex: call.deltaExposure,
    putDex: put.deltaExposure,
    netDex: call.deltaExposure + put.deltaExposure,
    callVex: call.vannaExposure,
    putVex: put.vannaExposure,
    netVex: call.vannaExposure + put.vannaExposure,
    callCex: call.charmExposure,
    putCex: put.charmExposure,
    netCex: call.charmExposure + put.charmExposure,
  };
};

const optionCellForStrike = (chain: SpxGexOptionChain, strike: number, now: Date): SpxGexHeatmapCell => {
  const call = chain.calls.find((leg) => leg.strike === strike);
  const put = chain.puts.find((leg) => leg.strike === strike);
  const callOpenInterest = call?.openInterest || 0;
  const putOpenInterest = put?.openInterest || 0;
  const callEffectiveOpenInterest = effectiveOpenInterest(call);
  const putEffectiveOpenInterest = effectiveOpenInterest(put);
  const callIv = normalizeIv(call?.impliedVolatility);
  const putIv = normalizeIv(put?.impliedVolatility);
  const yearsToExpiry = expiryToYears(chain.selectedExpiry || "", now);
  const exposures = calculateBlackScholesExposures({
    spot: chain.spot,
    strike,
    yearsToExpiry,
    callOpenInterest: callEffectiveOpenInterest,
    putOpenInterest: putEffectiveOpenInterest,
    callIv,
    putIv,
  });

  return {
    strike,
    expdate: chain.selectedExpiry || "",
    netGex: Math.round(exposures.netGex),
    callGex: Math.round(exposures.callGex),
    putGex: Math.round(exposures.putGex),
    netDex: Math.round(exposures.netDex),
    netVex: Math.round(exposures.netVex),
    netCex: Math.round(exposures.netCex),
    callOpenInterest,
    putOpenInterest,
    totalOpenInterest: callEffectiveOpenInterest + putEffectiveOpenInterest,
    totalVolume: (call?.volume || 0) + (put?.volume || 0),
    avgIv: Number((((callIv + putIv) / 2) * 100).toFixed(2)),
    approximate: callOpenInterest + putOpenInterest <= 0 || !(call?.impliedVolatility && put?.impliedVolatility),
  };
};

const buildGammaFlipFromProfiles = (profiles: Array<{ strike: number; netGex: number }>, spot: number) => {
  const sorted = [...profiles].filter((row) => Number.isFinite(row.strike) && Number.isFinite(row.netGex)).sort((a, b) => a.strike - b.strike);
  const candidates: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    if (previous.netGex === 0) candidates.push(previous.strike);
    if (current.netGex === 0) candidates.push(current.strike);
    if (Math.sign(previous.netGex) === Math.sign(current.netGex)) continue;

    const denominator = Math.abs(previous.netGex) + Math.abs(current.netGex);
    const weight = denominator > 0 ? Math.abs(previous.netGex) / denominator : 0.5;
    candidates.push(previous.strike + (current.strike - previous.strike) * weight);
  }

  if (candidates.length === 0) return null;
  return Number(candidates.reduce((nearest, candidate) => Math.abs(candidate - spot) < Math.abs(nearest - spot) ? candidate : nearest).toFixed(2));
};

const uniqueSortedStrikes = (chains: SpxGexOptionChain[], spot: number, maxStrikes: number) => {
  const lower = spot * (1 - DEFAULT_STRIKE_RANGE_PCT);
  const upper = spot * (1 + DEFAULT_STRIKE_RANGE_PCT);
  const allStrikes = Array.from(new Set(chains.flatMap((chain) => [...chain.calls, ...chain.puts].map((leg) => leg.strike))))
    .filter((strike) => strike > 0);
  const strikesInRange = allStrikes.filter((strike) => strike >= lower && strike <= upper);
  const sourceStrikes = strikesInRange.length >= Math.min(40, maxStrikes) ? strikesInRange : allStrikes;

  return sourceStrikes
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, maxStrikes)
    .sort((a, b) => b - a);
};

type StrikeProfileWithoutTags = Omit<SpxGexStrikeProfile, "tags"> | SpxGexStrikeProfile;

interface StructureCandidate {
  strike: number;
  priority: number;
  score: number;
  tag: SpxGexStructureTag;
}

const stripTags = (row: StrikeProfileWithoutTags): Omit<SpxGexStrikeProfile, "tags"> => {
  const { tags: _tags, ...profile } = row as SpxGexStrikeProfile;
  return profile;
};

const nearestProfileStrike = (profiles: Omit<SpxGexStrikeProfile, "tags">[], target: number | null | undefined) => {
  if (typeof target !== "number" || !Number.isFinite(target) || profiles.length === 0) return null;
  return profiles.reduce((nearest, row) =>
    Math.abs(row.strike - target) < Math.abs(nearest.strike - target) ? row : nearest,
  ).strike;
};

const addCandidate = (
  candidates: StructureCandidate[],
  row: Omit<SpxGexStrikeProfile, "tags"> | undefined | null,
  priority: number,
  score: number,
  tag: SpxGexStructureTag,
) => {
  if (!row) return;
  candidates.push({ strike: row.strike, priority, score, tag });
};

export const classifySpxGexStructureTags = (
  inputProfiles: StrikeProfileWithoutTags[],
  spot: number,
  zeroDte?: Partial<SpxGexZeroDte> | null,
): SpxGexStrikeProfile[] => {
  const profiles = inputProfiles.map(stripTags);
  if (profiles.length === 0) return [];

  const byStrike = new Map(profiles.map((row) => [row.strike, row]));
  const maxOi = Math.max(1, ...profiles.map((row) => row.totalOpenInterest));
  const maxVolume = Math.max(1, ...profiles.map((row) => row.totalVolume));
  const maxAbsNetGex = Math.max(1, ...profiles.map((row) => Math.abs(row.netGex)));
  const hasSideGex = profiles.some((row) => Math.abs(row.callGex) > 0 || Math.abs(row.putGex) > 0);
  const aboveSpot = profiles.filter((row) => row.strike > spot).sort((a, b) => a.strike - b.strike);
  const belowSpot = profiles.filter((row) => row.strike < spot).sort((a, b) => b.strike - a.strike);
  const spotStrike = nearestProfileStrike(profiles, spot);
  const pinStrike = nearestProfileStrike(profiles, zeroDte?.pinLevel);
  const callWallStrike = nearestProfileStrike(profiles, zeroDte?.topCallWallLevel);
  const putWallStrike = nearestProfileStrike(profiles, zeroDte?.topPutWallLevel);
  const gammaFlipStrike = nearestProfileStrike(profiles, zeroDte?.gammaFlip);
  const fallbackCallWall = aboveSpot.reduce<typeof profiles[number] | null>((best, row) => {
    const value = hasSideGex ? row.callGex : row.netGex;
    const bestValue = best ? (hasSideGex ? best.callGex : best.netGex) : -Infinity;
    return !best || value > bestValue ? row : best;
  }, null);
  const fallbackPutWall = belowSpot.reduce<typeof profiles[number] | null>((best, row) => {
    const value = hasSideGex ? row.putGex : row.netGex;
    const bestValue = best ? (hasSideGex ? best.putGex : best.netGex) : Infinity;
    return !best || value < bestValue ? row : best;
  }, null);
  const callWall = byStrike.get(callWallStrike ?? NaN) || fallbackCallWall;
  const putWall = byStrike.get(putWallStrike ?? NaN) || fallbackPutWall;
  const pin = byStrike.get(pinStrike ?? NaN) || profiles.reduce<typeof profiles[number] | null>(
    (best, row) => (!best || Math.abs(row.netGex) > Math.abs(best.netGex) ? row : best),
    null,
  );
  const spotRow = byStrike.get(spotStrike ?? NaN) || null;
  const candidates: StructureCandidate[] = [];
  const positiveAbove = aboveSpot
    .filter((row) => row.netGex > 0 && row.strike !== callWall?.strike)
    .sort((a, b) => b.netGex - a.netGex);
  const nearPositiveAbove = positiveAbove
    .filter((row) => Math.abs(row.strike - spot) / Math.max(1, spot) <= 0.01)
    .sort((a, b) => (b.netGex / maxAbsNetGex + b.totalOpenInterest / maxOi) - (a.netGex / maxAbsNetGex + a.totalOpenInterest / maxOi));
  const airGap = (gammaFlipStrike ? byStrike.get(gammaFlipStrike) : null)
    || profiles
      .filter((row) => Math.abs(row.strike - spot) / Math.max(1, spot) <= 0.015)
      .sort((a, b) => Math.abs(a.netGex) - Math.abs(b.netGex))[0]
    || null;

  if (callWall) {
    addCandidate(candidates, callWall, 100, Math.max(callWall.callGex, callWall.netGex), {
      type: "big_call_wall",
      label: "Big call wall · gamma ceiling",
      severity: "major",
      source: "ranked strongest call-side GEX wall above spot",
    });
  }

  if (pin) {
    addCandidate(candidates, pin, 92, Math.abs(pin.netGex), {
      type: "pin",
      label: "Pin Zone",
      severity: "major",
      source: "nearest 0DTE pin or strongest absolute net GEX row",
    });
  }

  if (spotRow) {
    const isPinSpot = pin?.strike === spotRow.strike;
    const hasOiOrVolumeSpike = spotRow.totalOpenInterest >= maxOi * 0.7 || spotRow.totalVolume >= maxVolume * 0.7;
    addCandidate(candidates, spotRow, isPinSpot && hasOiOrVolumeSpike ? 98 : 90, spotRow.totalOpenInterest, {
      type: "now",
      label: isPinSpot && hasOiOrVolumeSpike ? "NOW / OI spike / pin zone" : "NOW",
      severity: "major",
      source: isPinSpot && hasOiOrVolumeSpike ? "nearest spot strike overlapping pin and high participation" : "nearest spot strike",
    });
  }

  if (putWall) {
    addCandidate(candidates, putWall, 84, Math.abs(hasSideGex ? putWall.putGex : putWall.netGex), {
      type: "lower_shelf",
      label: "Lower Shelf",
      severity: "major",
      source: "ranked strongest downside put-GEX shelf below spot",
    });
  }

  const upperShelf = positiveAbove[0] || null;
  addCandidate(candidates, upperShelf, 76, upperShelf?.netGex || 0, {
    type: "upper_shelf",
    label: "Upper Shelf",
    severity: "watch",
    source: "largest positive net GEX shelf above the call wall",
  });

  const resistanceZone = nearPositiveAbove.find((row) => row.strike !== upperShelf?.strike) || null;
  addCandidate(candidates, resistanceZone, 68, resistanceZone?.netGex || 0, {
    type: "resistance_zone",
    label: "Resistance zone",
    severity: "watch",
    source: "highest ranked nearby positive net GEX cluster above spot",
  });

  const minorResistance = positiveAbove.find((row) =>
    row.strike !== upperShelf?.strike
    && row.strike !== resistanceZone?.strike
    && row.netGex <= maxAbsNetGex * 0.4
  ) || positiveAbove.find((row) => row.strike !== upperShelf?.strike && row.strike !== resistanceZone?.strike) || null;
  addCandidate(candidates, minorResistance, 60, minorResistance?.netGex || 0, {
    type: "minor_resistance",
    label: "Minor resistance",
    severity: "info",
    source: "secondary positive net GEX row after higher ranked resistance structures",
  });

  if (airGap && Math.abs(airGap.netGex) <= maxAbsNetGex * 0.08) {
    addCandidate(candidates, airGap, 52, maxAbsNetGex - Math.abs(airGap.netGex), {
      type: "air_gap",
      label: "Air Gap",
      severity: "info",
      source: "nearest gamma-flip or low absolute net GEX pocket",
    });
  }

  const tagByStrike = new Map<number, SpxGexStructureTag>();
  for (const candidate of candidates.sort((a, b) => b.priority - a.priority || b.score - a.score)) {
    if (!tagByStrike.has(candidate.strike)) tagByStrike.set(candidate.strike, candidate.tag);
  }

  return profiles.map((row) => ({ ...row, tags: tagByStrike.get(row.strike) ? [tagByStrike.get(row.strike)!] : [] }));
};

const addStructureTags = (profiles: Omit<SpxGexStrikeProfile, "tags">[], spot: number): SpxGexStrikeProfile[] =>
  classifySpxGexStructureTags(profiles, spot);

const addKeyLevelAnnotations = (profiles: SpxGexStrikeProfile[], zeroDte: SpxGexZeroDte, spot: number): SpxGexStrikeProfile[] =>
  classifySpxGexStructureTags(profiles, spot, zeroDte);

const buildStrikeProfiles = (strikes: number[], selectedExpiries: string[], cells: SpxGexHeatmapCell[], spot: number) => {
  const cellByKey = new Map(cells.map((cell) => [`${cell.strike}:${cell.expdate}`, cell]));
  const baseProfiles = strikes.map((strike) => {
    const rowCells = selectedExpiries.map((expiry) => cellByKey.get(`${strike}:${expiry}`)).filter((cell): cell is SpxGexHeatmapCell => Boolean(cell));
    const dominant = rowCells.reduce<SpxGexHeatmapCell | null>((best, cell) => (!best || Math.abs(cell.netGex || 0) > Math.abs(best.netGex || 0) ? cell : best), null);
    return {
      strike,
      netGex: rowCells.reduce((sum, cell) => sum + Number(cell.netGex || 0), 0),
      callGex: rowCells.reduce((sum, cell) => sum + Number(cell.callGex || 0), 0),
      putGex: rowCells.reduce((sum, cell) => sum + Number(cell.putGex || 0), 0),
      netDex: rowCells.reduce((sum, cell) => sum + Number(cell.netDex || 0), 0),
      netVex: rowCells.reduce((sum, cell) => sum + Number(cell.netVex || 0), 0),
      netCex: rowCells.reduce((sum, cell) => sum + Number(cell.netCex || 0), 0),
      totalOpenInterest: rowCells.reduce((sum, cell) => sum + Number(cell.totalOpenInterest || 0), 0),
      totalVolume: rowCells.reduce((sum, cell) => sum + Number(cell.totalVolume || 0), 0),
      dominantExpiry: dominant?.expdate || null,
    };
  });
  return addStructureTags(baseProfiles, spot);
};

const buildMarketContextSentence = (context: SpxGexMarketContext | null | undefined) => {
  if (!context) return null;
  const parts: string[] = [];
  if (context.macroRegime) parts.push(`macro regime ${context.macroRegime}`);
  if (context.breadth) parts.push(`breadth ${context.breadth.advancers}/${context.breadth.universeCount}`);
  if (context.flow) parts.push(`largest flow proxy ${context.flow.topTicker} ${compactExposure(context.flow.proxyFlow)}`);
  if (context.latestHeadline) parts.push(`latest headline: ${context.latestHeadline}`);
  return parts.length > 0 ? parts.join("; ") : null;
};

export const buildSpxGexPremarketInterpretation = (
  heatmap: Omit<SpxGexHeatmapModel, "premarketInterpretation">,
  marketContext?: SpxGexMarketContext | null,
): SpxGexPremarketInterpretation => {
  const spot = heatmap.quote.last;
  const flip = heatmap.zeroDte.gammaFlip;
  const callWall = heatmap.zeroDte.topCallWallLevel;
  const putWall = heatmap.zeroDte.topPutWallLevel;
  const isNearFlip = Boolean(flip && Math.abs(spot - flip) / Math.max(1, spot) <= 0.003);
  const regime: SpxGexPremarketRegime = isNearFlip
    ? "pinning_range"
    : flip
      ? spot >= flip
        ? "bullish_above_flip"
        : "bearish_below_flip"
      : "mixed";
  const dividingLine = flip ? `SPX ${flip.toFixed(0)} gamma flip` : "Gamma flip unavailable";
  const upside = callWall ? `${callWall.toFixed(0)} call wall / resistance` : "Call wall unavailable";
  const downside = putWall ? `${putWall.toFixed(0)} put wall / support` : "Put wall unavailable";
  const contextSentence = buildMarketContextSentence(marketContext);
  const paragraph = `Spot ${spot.toFixed(2)} vs ${dividingLine}. Upside: ${upside}. Downside: ${downside}. NetGEX ${compactExposure(heatmap.zeroDte.netGex)}, NetDEX ${compactExposure(heatmap.zeroDte.netDex)}, VEX ${compactExposure(heatmap.zeroDte.netVex)}, CEX ${compactExposure(heatmap.zeroDte.netCex)}.`;

  return {
    paragraph: contextSentence ? `${paragraph} Context: ${contextSentence}.` : paragraph,
    levels: { dividingLine, upside, downside },
    regime,
    context: contextSentence,
    warnings: marketContext?.warnings || [],
  };
};

const buildSessionMeta = (generatedAt: string, spot: number): SpxGexSnapshotMeta => {
  const status = getSpxGexGenerationStatus(new Date(generatedAt));
  return {
    tradingDate: status.etDateKey,
    snapshotMinuteEt: status.snapshotMinuteEt,
    snapshotTimeEt: status.snapshotTimeEt,
    generatedAt,
    spot,
  };
};

export const buildSpxGexHeatmapFromOptionChains = (input: BuildSpxGexHeatmapFromOptionChainsInput): SpxGexHeatmapModel => {
  if (input.chains.length === 0) throw new Error("No SPX option chains supplied.");
  const now = new Date(input.generatedAt);
  const frontChain = input.chains[0];
  const quote = quoteFromChain(frontChain, input.quoteText);
  const selectedExpiries = (input.selectedExpiries || input.chains.map((chain) => chain.selectedExpiry).filter(Boolean) as string[])
    .slice(0, DEFAULT_EXPIRY_COUNT);
  const chainsByExpiry = new Map(input.chains.map((chain) => [chain.selectedExpiry || "", chain]));
  const activeChains = selectedExpiries.map((expiry) => chainsByExpiry.get(expiry)).filter((chain): chain is SpxGexOptionChain => Boolean(chain));
  const strikes = uniqueSortedStrikes(activeChains, quote.last, input.maxStrikes ?? DEFAULT_MAX_STRIKES);
  const cells = activeChains.flatMap((chain) => strikes.map((strike) => optionCellForStrike(chain, strike, now)));
  const totals = selectedExpiries.map((expiry) => {
    const expiryCells = cells.filter((cell) => cell.expdate === expiry);
    return {
      expdate: expiry,
      netGex: expiryCells.reduce((sum, cell) => sum + Number(cell.netGex || 0), 0),
      netDex: expiryCells.reduce((sum, cell) => sum + Number(cell.netDex || 0), 0),
      netVex: expiryCells.reduce((sum, cell) => sum + Number(cell.netVex || 0), 0),
      netCex: expiryCells.reduce((sum, cell) => sum + Number(cell.netCex || 0), 0),
    };
  });
  const strikeProfiles = buildStrikeProfiles(strikes, selectedExpiries, cells, quote.last);
  const gammaFlip = buildGammaFlipFromProfiles(strikeProfiles, quote.last);
  const callWall = strikeProfiles.reduce<SpxGexStrikeProfile | null>((best, row) => (!best || row.callGex > best.callGex ? row : best), null);
  const putWall = strikeProfiles.reduce<SpxGexStrikeProfile | null>((best, row) => (!best || row.putGex < best.putGex ? row : best), null);
  const pin = strikeProfiles.reduce<SpxGexStrikeProfile | null>((best, row) => (!best || Math.abs(row.netGex) > Math.abs(best.netGex) ? row : best), null);
  const frontExpiry = selectedExpiries[0] || frontChain.selectedExpiry || "";
  const frontCells = cells.filter((cell) => cell.expdate === frontExpiry);

  const zeroDte: SpxGexZeroDte = {
    expiry: frontExpiry,
    sessionPhase: "intraday",
    nowEt: buildSessionMeta(input.generatedAt, quote.last).snapshotTimeEt,
    pinLevel: pin?.strike ?? null,
    gammaFlip,
    netGex: frontCells.reduce((sum, cell) => sum + Number(cell.netGex || 0), 0),
    netDex: frontCells.reduce((sum, cell) => sum + Number(cell.netDex || 0), 0),
    netVex: frontCells.reduce((sum, cell) => sum + Number(cell.netVex || 0), 0),
    netCex: frontCells.reduce((sum, cell) => sum + Number(cell.netCex || 0), 0),
    topCallWall: callWall ? formatStoredLevel(callWall.strike) : null,
    topCallWallLevel: callWall?.strike ?? null,
    topPutWall: putWall ? formatStoredLevel(putWall.strike) : null,
    topPutWallLevel: putWall?.strike ?? null,
    charmRegime: "black_scholes_approx",
  };

  const heatmapWithoutInterpretation: Omit<SpxGexHeatmapModel, "premarketInterpretation"> = {
    generatedAt: input.generatedAt,
    ticker: "SPX",
    quote,
    snapshot: input.generatedAt,
    session: buildSessionMeta(input.generatedAt, quote.last),
    selectedExpiries,
    strikeRange: { lower: quote.last * 0.965, upper: quote.last * 1.035 },
    strikes,
    cells,
    totals,
    strikeProfiles: addKeyLevelAnnotations(strikeProfiles, zeroDte, quote.last),
    zeroDte,
    source: {
      quoteTool: "get_quotes",
      optionExpiryTool: "get_options_chain",
      gexTool: "black_scholes_exposure_engine",
      zeroDteTool: "black_scholes_exposure_engine",
      gexTopRows: input.maxStrikes ?? DEFAULT_MAX_STRIKES,
      note: "Yahoo option chains are transformed into Black-Scholes GEX, DEX, VEX (vanna), and CEX (charm) approximations. Missing OI falls back to volume.",
    },
  };

  return {
    ...heatmapWithoutInterpretation,
    premarketInterpretation: buildSpxGexPremarketInterpretation(heatmapWithoutInterpretation, input.marketContext),
  };
};

const buildStrikeProfileFromLegacyCells = (heatmap: Omit<SpxGexHeatmapModel, "premarketInterpretation">) =>
  buildStrikeProfiles(heatmap.strikes, heatmap.selectedExpiries, heatmap.cells, heatmap.quote.last);

const keyLevelsCollapsed = (zeroDte: SpxGexZeroDte) => {
  const levelKeys = [zeroDte.pinLevel, zeroDte.gammaFlip, zeroDte.topCallWallLevel, zeroDte.topPutWallLevel]
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : null));
  const [pin, gammaFlip, callWall, putWall] = levelKeys;
  return [[pin, gammaFlip, callWall], [pin, gammaFlip, putWall], [pin, callWall, putWall], [gammaFlip, callWall, putWall]]
    .some((group) => group.every(Boolean) && new Set(group).size === 1);
};

const normalizeLegacyCollapsedLevels = (heatmap: Omit<SpxGexHeatmapModel, "premarketInterpretation">) => {
  const strikeProfiles = heatmap.strikeProfiles?.length ? heatmap.strikeProfiles : buildStrikeProfileFromLegacyCells(heatmap);
  let zeroDte = heatmap.zeroDte;
  let nextHeatmap = { ...heatmap, strikeProfiles: addKeyLevelAnnotations(strikeProfiles, zeroDte, heatmap.quote.last) };
  if (!keyLevelsCollapsed(heatmap.zeroDte)) return { heatmap: nextHeatmap, normalized: false };

  const upperWall = strikeProfiles.reduce<SpxGexStrikeProfile | null>((best, row) => (!best || row.netGex > best.netGex ? row : best), null);
  const negativeWall = strikeProfiles.reduce<SpxGexStrikeProfile | null>((best, row) => (!best || row.netGex < best.netGex ? row : best), null);
  const gammaFlip = buildGammaFlipFromProfiles(strikeProfiles, heatmap.quote.last);
  zeroDte = { ...heatmap.zeroDte, gammaFlip };
  if (upperWall) {
    zeroDte.topCallWallLevel = upperWall.strike;
    zeroDte.topCallWall = formatStoredLevel(upperWall.strike);
  }
  if (negativeWall && negativeWall.netGex < 0) {
    zeroDte.topPutWallLevel = negativeWall.strike;
    zeroDte.topPutWall = formatStoredLevel(negativeWall.strike);
  }

  nextHeatmap = { ...nextHeatmap, strikeProfiles: addKeyLevelAnnotations(strikeProfiles, zeroDte, heatmap.quote.last), zeroDte };
  return { heatmap: nextHeatmap, normalized: true };
};

export const buildSpxGexHeatmapFromToolText = (input: BuildSpxGexHeatmapInput): SpxGexHeatmapModel => {
  const quote = parseQuote(input.quoteText);
  const availableExpiries = parseAvailableExpiries(input.optionsText);
  const zeroDte = parseZeroDte(input.zeroDteText);
  const selectedExpiries = selectActiveExpiries(availableExpiries, zeroDte.expiry, DEFAULT_EXPIRY_COUNT);
  if (selectedExpiries.length < DEFAULT_EXPIRY_COUNT) {
    throw new Error(`Expected ${DEFAULT_EXPIRY_COUNT} active expiries from front expiry ${zeroDte.expiry}, got ${selectedExpiries.length}.`);
  }

  const parsedByExpiry = selectedExpiries.map((expiry) => parseGexRows(expiry, input.gexByExpiryText[expiry] || ""));
  const lowerStrike = quote.last * 0.9;
  const upperStrike = quote.last * 1.1;
  const strikes = Array.from(new Set(parsedByExpiry.flatMap((item) => item.rows).filter((row) => row.strike >= lowerStrike && row.strike <= upperStrike).map((row) => row.strike)))
    .sort((a, b) => b - a);

  const cells: SpxGexHeatmapCell[] = [];
  for (const strike of strikes) {
    for (const expiry of selectedExpiries) {
      const row = parsedByExpiry.flatMap((item) => item.rows).find((item) => item.strike === strike && item.expdate === expiry);
      cells.push({ strike, expdate: expiry, netGex: row?.netGex ?? null });
    }
  }

  const heatmapWithoutInterpretation: Omit<SpxGexHeatmapModel, "premarketInterpretation"> = {
    generatedAt: input.generatedAt,
    ticker: "SPX",
    quote,
    snapshot: parsedByExpiry.find((item) => item.snapshot)?.snapshot || null,
    session: buildSessionMeta(input.generatedAt, quote.last),
    selectedExpiries,
    strikeRange: { lower: lowerStrike, upper: upperStrike },
    strikes,
    cells,
    totals: selectedExpiries.map((expiry) => ({
      expdate: expiry,
      netGex: cells.filter((cell) => cell.expdate === expiry && cell.netGex !== null).reduce((sum, cell) => sum + Number(cell.netGex || 0), 0),
    })),
    strikeProfiles: [],
    zeroDte,
    source: {
      quoteTool: "get_quotes",
      optionExpiryTool: "get_options",
      gexTool: "get_options_gex",
      zeroDteTool: "get_options_0dte",
      gexTopRows: 20,
      note: "Legacy markdown GEX parser fallback. It does not include DEX, VEX, or CEX cells.",
    },
  };

  const withProfiles = { ...heatmapWithoutInterpretation, strikeProfiles: buildStrikeProfileFromLegacyCells(heatmapWithoutInterpretation) };
  const normalizedHeatmap = normalizeLegacyCollapsedLevels(withProfiles).heatmap;
  return {
    ...normalizedHeatmap,
    premarketInterpretation: buildSpxGexPremarketInterpretation(normalizedHeatmap, input.marketContext),
  };
};

const parseJsonField = <T>(value: string): T => JSON.parse(value) as T;

const rowToLegacyHeatmap = (row: D1SpxGexHeatmapRow): SpxGexHeatmapModel => {
  const quote = parseJsonField<SpxGexQuote>(row.quote_json);
  const heatmapWithoutInterpretation: Omit<SpxGexHeatmapModel, "premarketInterpretation"> = {
    generatedAt: row.generated_at,
    ticker: "SPX",
    quote,
    snapshot: row.snapshot_at,
    session: buildSessionMeta(row.generated_at, quote.last),
    selectedExpiries: parseJsonField<string[]>(row.expiries_json),
    strikeRange: { lower: Number(row.spot) * 0.9, upper: Number(row.spot) * 1.1 },
    strikes: parseJsonField<number[]>(row.strikes_json),
    cells: parseJsonField<SpxGexHeatmapCell[]>(row.cells_json),
    totals: parseJsonField<Array<{ expdate: string; netGex: number }>>(row.totals_json),
    strikeProfiles: [],
    zeroDte: parseJsonField<SpxGexZeroDte>(row.zero_dte_json),
    source: parseJsonField<SpxGexHeatmapModel["source"]>(row.source_json),
  };

  const normalized = normalizeLegacyCollapsedLevels(heatmapWithoutInterpretation);
  return {
    ...normalized.heatmap,
    premarketInterpretation: row.interpretation_json && !normalized.normalized
      ? parseJsonField<SpxGexPremarketInterpretation>(row.interpretation_json)
      : buildSpxGexPremarketInterpretation(normalized.heatmap),
  };
};

const rowToIntradayHeatmap = (row: D1SpxGexIntradayRow): SpxGexHeatmapModel => {
  const parsed = parseJsonField<SpxGexHeatmapModel>(row.snapshot_json);
  const baseHeatmap: Omit<SpxGexHeatmapModel, "premarketInterpretation"> = {
    ...parsed,
    strikeProfiles: parsed.strikeProfiles?.length ? parsed.strikeProfiles : [],
  };
  const strikeProfiles = parsed.strikeProfiles?.length
    ? addKeyLevelAnnotations(parsed.strikeProfiles, parsed.zeroDte, parsed.quote.last)
    : addKeyLevelAnnotations(buildStrikeProfileFromLegacyCells(baseHeatmap), parsed.zeroDte, parsed.quote.last);
  return {
    ...parsed,
    strikeProfiles,
    session: parsed.session || {
      tradingDate: row.trading_date,
      snapshotMinuteEt: Number(row.snapshot_minute_et),
      snapshotTimeEt: row.snapshot_time_et,
      generatedAt: row.generated_at,
      spot: Number(row.spot),
    },
  };
};

const isMissingIntradayTable = (error: unknown) => /spx_gex_intraday_snapshots|no such table/i.test(error instanceof Error ? error.message : String(error));

export const listSpxGexHeatmapDates = async (db: D1DatabaseLike) => {
  try {
    const result = await db.prepare("SELECT DISTINCT trading_date FROM spx_gex_intraday_snapshots ORDER BY trading_date DESC").all<{ trading_date: string }>();
    const dates = (result.results || []).map((row) => row.trading_date);
    if (dates.length > 0) return dates;
  } catch (error) {
    if (!isMissingIntradayTable(error)) throw error;
  }

  const result = await db.prepare("SELECT date FROM spx_gex_heatmaps ORDER BY date DESC").all<{ date: string }>();
  return (result.results || []).map((row) => row.date);
};

export const listSpxGexHeatmapSessions = async (db: D1DatabaseLike, date: string): Promise<SpxGexSessionSummary[]> => {
  try {
    const result = await db
      .prepare(`
        SELECT trading_date, snapshot_minute_et, snapshot_time_et, generated_at, spot
        FROM spx_gex_intraday_snapshots
        WHERE trading_date = ?
        ORDER BY snapshot_minute_et ASC
      `)
      .bind(date)
      .all<D1SpxGexIntradayRow>();
    const sessions = (result.results || []).map((row) => ({
      tradingDate: row.trading_date,
      snapshotMinuteEt: Number(row.snapshot_minute_et),
      snapshotTimeEt: row.snapshot_time_et,
      generatedAt: row.generated_at,
      spot: Number(row.spot),
    }));
    if (sessions.length > 0) return sessions;
  } catch (error) {
    if (!isMissingIntradayTable(error)) throw error;
  }

  const legacy = await readLegacySpxGexHeatmap(db, date);
  return legacy?.session ? [legacy.session] : [];
};

const readLegacySpxGexHeatmap = async (db: D1DatabaseLike, date: string): Promise<SpxGexHeatmapModel | null> => {
  const row = await db.prepare("SELECT * FROM spx_gex_heatmaps WHERE date = ?").bind(date).first<D1SpxGexHeatmapRow>();
  return row ? rowToLegacyHeatmap(row) : null;
};

export const readSpxGexIntradaySnapshot = async (
  db: D1DatabaseLike,
  date: string,
  snapshotMinuteEt?: number | null,
): Promise<SpxGexHeatmapModel | null> => {
  try {
    const row = snapshotMinuteEt === null || snapshotMinuteEt === undefined
      ? await db
        .prepare(`
          SELECT * FROM spx_gex_intraday_snapshots
          WHERE trading_date = ?
          ORDER BY snapshot_minute_et DESC
          LIMIT 1
        `)
        .bind(date)
        .first<D1SpxGexIntradayRow>()
      : await db
        .prepare(`
          SELECT * FROM spx_gex_intraday_snapshots
          WHERE trading_date = ? AND snapshot_minute_et = ?
        `)
        .bind(date, snapshotMinuteEt)
        .first<D1SpxGexIntradayRow>();

    return row ? rowToIntradayHeatmap(row) : null;
  } catch (error) {
    if (!isMissingIntradayTable(error)) throw error;
    return null;
  }
};

export const readSpxGexHeatmap = async (db: D1DatabaseLike, date: string, snapshotMinuteEt?: number | null): Promise<SpxGexHeatmapModel | null> => {
  const intraday = await readSpxGexIntradaySnapshot(db, date, snapshotMinuteEt);
  return intraday || readLegacySpxGexHeatmap(db, date);
};

const runStatement = async (db: D1DatabaseLike, statement: ReturnType<D1DatabaseLike["prepare"]>) => {
  if (db.batch) await db.batch([statement]);
  else await statement.run();
};

export const upsertSpxGexIntradaySnapshot = async (
  db: D1DatabaseLike,
  heatmap: SpxGexHeatmapModel,
  options: { retentionTradingDays?: number } = {},
) => {
  if (!heatmap.session) throw new Error("Intraday heatmap snapshot requires session metadata.");
  const retentionTradingDays = options.retentionTradingDays ?? 7;
  const upsert = db.prepare(`
    INSERT INTO spx_gex_intraday_snapshots (
      trading_date, snapshot_minute_et, snapshot_time_et, generated_at, ticker, spot,
      snapshot_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trading_date, snapshot_minute_et) DO UPDATE SET
      snapshot_time_et = excluded.snapshot_time_et,
      generated_at = excluded.generated_at,
      ticker = excluded.ticker,
      spot = excluded.spot,
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at
  `).bind(
    heatmap.session.tradingDate,
    heatmap.session.snapshotMinuteEt,
    heatmap.session.snapshotTimeEt,
    heatmap.generatedAt,
    heatmap.ticker,
    heatmap.quote.last,
    JSON.stringify(heatmap),
    heatmap.generatedAt,
    heatmap.generatedAt,
  );
  const prune = db.prepare(`
    DELETE FROM spx_gex_intraday_snapshots
    WHERE trading_date NOT IN (
      SELECT trading_date FROM (
        SELECT DISTINCT trading_date FROM spx_gex_intraday_snapshots ORDER BY trading_date DESC LIMIT ?
      )
    )
  `).bind(retentionTradingDays);

  if (db.batch) await db.batch([upsert, prune]);
  else {
    await upsert.run();
    await prune.run();
  }
};

export const upsertSpxGexHeatmap = async (
  db: D1DatabaseLike,
  date: string,
  heatmap: SpxGexHeatmapModel,
  options: { retentionTradingDays?: number } = {},
) => {
  const retentionTradingDays = options.retentionTradingDays ?? 7;
  const legacyUpsert = db.prepare(`
    INSERT INTO spx_gex_heatmaps (
      date, generated_at, snapshot_at, ticker, spot, quote_json, expiries_json,
      strikes_json, cells_json, totals_json, zero_dte_json, interpretation_json, source_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      generated_at = excluded.generated_at,
      snapshot_at = excluded.snapshot_at,
      ticker = excluded.ticker,
      spot = excluded.spot,
      quote_json = excluded.quote_json,
      expiries_json = excluded.expiries_json,
      strikes_json = excluded.strikes_json,
      cells_json = excluded.cells_json,
      totals_json = excluded.totals_json,
      zero_dte_json = excluded.zero_dte_json,
      interpretation_json = excluded.interpretation_json,
      source_json = excluded.source_json,
      updated_at = excluded.updated_at
  `).bind(
    date,
    heatmap.generatedAt,
    heatmap.snapshot,
    heatmap.ticker,
    heatmap.quote.last,
    JSON.stringify(heatmap.quote),
    JSON.stringify(heatmap.selectedExpiries),
    JSON.stringify(heatmap.strikes),
    JSON.stringify(heatmap.cells),
    JSON.stringify(heatmap.totals),
    JSON.stringify(heatmap.zeroDte),
    JSON.stringify(heatmap.premarketInterpretation),
    JSON.stringify(heatmap.source),
    heatmap.generatedAt,
    heatmap.generatedAt,
  );
  const legacyPrune = db.prepare(`
    DELETE FROM spx_gex_heatmaps
    WHERE date NOT IN (
      SELECT date FROM spx_gex_heatmaps ORDER BY date DESC LIMIT ?
    )
  `).bind(retentionTradingDays);

  try {
    if (db.batch) await db.batch([legacyUpsert, legacyPrune]);
    else {
      await legacyUpsert.run();
      await legacyPrune.run();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("interpretation_json")) throw error;
    const fallback = db.prepare(`
      INSERT INTO spx_gex_heatmaps (
        date, generated_at, snapshot_at, ticker, spot, quote_json, expiries_json,
        strikes_json, cells_json, totals_json, zero_dte_json, source_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        generated_at = excluded.generated_at,
        snapshot_at = excluded.snapshot_at,
        ticker = excluded.ticker,
        spot = excluded.spot,
        quote_json = excluded.quote_json,
        expiries_json = excluded.expiries_json,
        strikes_json = excluded.strikes_json,
        cells_json = excluded.cells_json,
        totals_json = excluded.totals_json,
        zero_dte_json = excluded.zero_dte_json,
        source_json = excluded.source_json,
        updated_at = excluded.updated_at
    `).bind(
      date,
      heatmap.generatedAt,
      heatmap.snapshot,
      heatmap.ticker,
      heatmap.quote.last,
      JSON.stringify(heatmap.quote),
      JSON.stringify(heatmap.selectedExpiries),
      JSON.stringify(heatmap.strikes),
      JSON.stringify(heatmap.cells),
      JSON.stringify(heatmap.totals),
      JSON.stringify(heatmap.zeroDte),
      JSON.stringify(heatmap.source),
      heatmap.generatedAt,
      heatmap.generatedAt,
    );
    await runStatement(db, fallback);
  }

  try {
    await upsertSpxGexIntradaySnapshot(db, heatmap, { retentionTradingDays });
  } catch (error) {
    if (!isMissingIntradayTable(error)) throw error;
  }
};

const buildFromStructuredChains = async (options: {
  dataClient: SpxGexDataClient;
  now: Date;
  marketContext: SpxGexMarketContext | null;
}) => {
  if (!options.dataClient.getOptionsChain) return null;
  const quoteText = await options.dataClient.getQuotes();
  const frontChain = await options.dataClient.getOptionsChain();
  const frontExpiry = frontChain.selectedExpiry || frontChain.expiries[0];
  if (!frontExpiry) throw new Error("SPX option chain returned no front expiry.");
  const selectedExpiries = selectActiveExpiries(frontChain.expiries, frontExpiry, DEFAULT_EXPIRY_COUNT);
  if (selectedExpiries.length < DEFAULT_EXPIRY_COUNT) {
    throw new Error(`Expected ${DEFAULT_EXPIRY_COUNT} active expiries from front expiry ${frontExpiry}, got ${selectedExpiries.length}.`);
  }
  const chains = await Promise.all(selectedExpiries.map((expiry) => options.dataClient.getOptionsChain!(expiry)));
  return buildSpxGexHeatmapFromOptionChains({
    generatedAt: options.now.toISOString(),
    quoteText,
    chains,
    selectedExpiries,
    marketContext: options.marketContext,
  });
};

const buildFromLegacyMarkdown = async (options: {
  dataClient: SpxGexDataClient;
  now: Date;
  marketContext: SpxGexMarketContext | null;
}) => {
  const quoteText = await options.dataClient.getQuotes();
  const optionsText = await options.dataClient.getOptions();
  const zeroDteText = await options.dataClient.getOptions0Dte();
  const selectedExpiries = selectSpxGexActiveExpiriesFromToolText(optionsText, zeroDteText, DEFAULT_EXPIRY_COUNT);
  const gexByExpiryText: Record<string, string> = {};
  for (const expiry of selectedExpiries) {
    gexByExpiryText[expiry] = await options.dataClient.getOptionsGex(expiry);
  }
  return buildSpxGexHeatmapFromToolText({
    generatedAt: options.now.toISOString(),
    quoteText,
    optionsText,
    zeroDteText,
    gexByExpiryText,
    marketContext: options.marketContext,
  });
};

export const generateAndStoreSpxGexHeatmap = async (options: {
  db: D1DatabaseLike;
  dataClient: SpxGexDataClient;
  now?: Date;
  force?: boolean;
}): Promise<SpxGexGenerationResult> => {
  const now = options.now || new Date();
  const generationStatus = getSpxGexGenerationStatus(now);
  const date = generationStatus.etDateKey;

  if (!options.force && !generationStatus.isGenerationWindow) {
    return { status: "skipped", date, reason: generationStatus.skipReason || "outside_generation_window" };
  }

  const existing = await readSpxGexIntradaySnapshot(options.db, date, generationStatus.snapshotMinuteEt);
  if (existing && !options.force) {
    return {
      status: "skipped_existing",
      date,
      snapshotMinuteEt: generationStatus.snapshotMinuteEt,
      snapshotTimeEt: generationStatus.snapshotTimeEt,
    };
  }

  let marketContext: SpxGexMarketContext | null = null;
  if (options.dataClient.getMarketContext) {
    try {
      marketContext = await options.dataClient.getMarketContext();
    } catch (error) {
      marketContext = {
        macroRegime: null,
        breadth: null,
        flow: null,
        latestHeadline: null,
        warnings: [`market context failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  const heatmap =
    (await buildFromStructuredChains({ dataClient: options.dataClient, now, marketContext })) ||
    (await buildFromLegacyMarkdown({ dataClient: options.dataClient, now, marketContext }));

  await upsertSpxGexHeatmap(options.db, date, heatmap, { retentionTradingDays: 7 });
  return {
    status: "generated",
    date,
    snapshotMinuteEt: generationStatus.snapshotMinuteEt,
    snapshotTimeEt: generationStatus.snapshotTimeEt,
  };
};
