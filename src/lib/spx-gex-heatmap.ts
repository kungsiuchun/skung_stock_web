import type { D1DatabaseLike } from "./spx-recap-d1";

const MARKET_TIME_ZONE = "America/New_York";
const GENERATION_MINUTES = new Set([9 * 60 + 15, 9 * 60 + 20, 9 * 60 + 25]);

export interface SpxGexQuote {
  ticker: string;
  last: number;
  change: string;
  changePercent: string;
}

export interface SpxGexZeroDte {
  expiry: string;
  sessionPhase: string | null;
  nowEt: string | null;
  pinLevel: number | null;
  gammaFlip: number | null;
  netGex: number | null;
  netDex: number | null;
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
}

export interface SpxGexHeatmapModel {
  generatedAt: string;
  ticker: "SPX";
  quote: SpxGexQuote;
  snapshot: string | null;
  selectedExpiries: string[];
  strikeRange: {
    lower: number;
    upper: number;
  };
  strikes: number[];
  cells: SpxGexHeatmapCell[];
  totals: { expdate: string; netGex: number }[];
  zeroDte: SpxGexZeroDte;
  source: {
    quoteTool: "get_quotes";
    optionExpiryTool: "get_options";
    gexTool: "get_options_gex";
    zeroDteTool: "get_options_0dte";
    gexTopRows: 20;
    note: string;
  };
}

export interface BuildSpxGexHeatmapInput {
  generatedAt: string;
  quoteText: string;
  optionsText: string;
  zeroDteText: string;
  gexByExpiryText: Record<string, string>;
}

export interface SpxGexMcpClient {
  getQuotes: () => Promise<string>;
  getOptions: () => Promise<string>;
  getOptions0Dte: () => Promise<string>;
  getOptionsGex: (expiry: string) => Promise<string>;
}

export type SpxGexGenerationResult =
  | { status: "generated"; date: string }
  | { status: "skipped_existing"; date: string }
  | { status: "skipped"; date: string; reason: string };

export const isStocksMcpAuthError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const hasAuthSignal = /\b(401|403)\b|unauthori[sz]ed|forbidden|bearer/i.test(message);
  const hasStocksMcpSignal = /stocks mcp|mcp_bearer_token|mcp bearer|mcp sse/i.test(message);
  return hasAuthSignal && hasStocksMcpSignal;
};

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
  source_json: string;
}

const toDateKey = (year: number, month: number, day: number) =>
  `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

const toEasternDate = (date: Date) => new Date(date.toLocaleString("en-US", { timeZone: MARKET_TIME_ZONE }));

const getEtMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();

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

  if (year >= 2022) {
    holidays.add(observedHolidayKey(year, 5, 19));
  }

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

  return {
    etNow,
    etDateKey,
    minutes,
    isMarketOpenDay,
    isGenerationWindow: isMarketOpenDay && GENERATION_MINUTES.has(minutes),
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

  const [ticker, last, change, changePercent] = parseTableCells(row);
  const lastValue = parseDollarNumber(last);
  if (lastValue === null) throw new Error("Could not parse SPX quote last price.");

  return {
    ticker,
    last: lastValue,
    change,
    changePercent,
  };
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

export const selectSpxGexActiveExpiriesFromMcpText = (optionsText: string, zeroDteText: string, count = 5) => {
  const zeroDte = parseZeroDte(zeroDteText);
  return selectActiveExpiries(parseAvailableExpiries(optionsText), zeroDte.expiry, count);
};

const parseGexRows = (expiry: string, text: string) => {
  const rows: { strike: number; expdate: string; netGex: number }[] = [];

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

export const buildSpxGexHeatmapFromMcpText = (input: BuildSpxGexHeatmapInput): SpxGexHeatmapModel => {
  const quote = parseQuote(input.quoteText);
  const availableExpiries = parseAvailableExpiries(input.optionsText);
  const zeroDte = parseZeroDte(input.zeroDteText);
  const selectedExpiries = selectActiveExpiries(availableExpiries, zeroDte.expiry, 5);

  if (selectedExpiries.length < 5) {
    throw new Error(`Expected 5 active expiries from front expiry ${zeroDte.expiry}, got ${selectedExpiries.length}.`);
  }

  const parsedByExpiry = selectedExpiries.map((expiry) => parseGexRows(expiry, input.gexByExpiryText[expiry] || ""));
  const lowerStrike = quote.last * 0.9;
  const upperStrike = quote.last * 1.1;
  const strikes = Array.from(
    new Set(
      parsedByExpiry
        .flatMap((item) => item.rows)
        .filter((row) => row.strike >= lowerStrike && row.strike <= upperStrike)
        .map((row) => row.strike),
    ),
  ).sort((a, b) => b - a);

  const cells: SpxGexHeatmapCell[] = [];
  for (const strike of strikes) {
    for (const expiry of selectedExpiries) {
      const row = parsedByExpiry.flatMap((item) => item.rows).find((item) => item.strike === strike && item.expdate === expiry);
      cells.push({
        strike,
        expdate: expiry,
        netGex: row?.netGex ?? null,
      });
    }
  }

  return {
    generatedAt: input.generatedAt,
    ticker: "SPX",
    quote,
    snapshot: parsedByExpiry.find((item) => item.snapshot)?.snapshot || null,
    selectedExpiries,
    strikeRange: {
      lower: lowerStrike,
      upper: upperStrike,
    },
    strikes,
    cells,
    totals: selectedExpiries.map((expiry) => ({
      expdate: expiry,
      netGex: cells
        .filter((cell) => cell.expdate === expiry && cell.netGex !== null)
        .reduce((sum, cell) => sum + Number(cell.netGex || 0), 0),
    })),
    zeroDte,
    source: {
      quoteTool: "get_quotes",
      optionExpiryTool: "get_options",
      gexTool: "get_options_gex",
      zeroDteTool: "get_options_0dte",
      gexTopRows: 20,
      note: "Server schema caps rendered per-strike GEX rows at topRows <= 20; all rendered strikes are filtered to spot +/- 10%.",
    },
  };
};

const parseJsonField = <T>(value: string): T => JSON.parse(value) as T;

const rowToHeatmap = (row: D1SpxGexHeatmapRow): SpxGexHeatmapModel => ({
  generatedAt: row.generated_at,
  ticker: "SPX",
  quote: parseJsonField<SpxGexQuote>(row.quote_json),
  snapshot: row.snapshot_at,
  selectedExpiries: parseJsonField<string[]>(row.expiries_json),
  strikeRange: {
    lower: Number(row.spot) * 0.9,
    upper: Number(row.spot) * 1.1,
  },
  strikes: parseJsonField<number[]>(row.strikes_json),
  cells: parseJsonField<SpxGexHeatmapCell[]>(row.cells_json),
  totals: parseJsonField<{ expdate: string; netGex: number }[]>(row.totals_json),
  zeroDte: parseJsonField<SpxGexZeroDte>(row.zero_dte_json),
  source: parseJsonField<SpxGexHeatmapModel["source"]>(row.source_json),
});

export const listSpxGexHeatmapDates = async (db: D1DatabaseLike) => {
  const result = await db.prepare("SELECT date FROM spx_gex_heatmaps ORDER BY date DESC").all<{ date: string }>();
  return (result.results || []).map((row) => row.date);
};

export const readSpxGexHeatmap = async (db: D1DatabaseLike, date: string): Promise<SpxGexHeatmapModel | null> => {
  const row = await db
    .prepare("SELECT * FROM spx_gex_heatmaps WHERE date = ?")
    .bind(date)
    .first<D1SpxGexHeatmapRow>();

  return row ? rowToHeatmap(row) : null;
};

export const upsertSpxGexHeatmap = async (
  db: D1DatabaseLike,
  date: string,
  heatmap: SpxGexHeatmapModel,
  options: { retentionTradingDays?: number } = {},
) => {
  const retentionTradingDays = options.retentionTradingDays ?? 7;
  const upsert = db.prepare(`
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

  const prune = db.prepare(`
    DELETE FROM spx_gex_heatmaps
    WHERE date NOT IN (
      SELECT date FROM spx_gex_heatmaps ORDER BY date DESC LIMIT ?
    )
  `).bind(retentionTradingDays);

  if (db.batch) {
    await db.batch([upsert, prune]);
  } else {
    await upsert.run();
    await prune.run();
  }
};

export const generateAndStoreSpxGexHeatmap = async (options: {
  db: D1DatabaseLike;
  mcpClient: SpxGexMcpClient;
  now?: Date;
  force?: boolean;
}): Promise<SpxGexGenerationResult> => {
  const now = options.now || new Date();
  const generationStatus = getSpxGexGenerationStatus(now);
  const date = generationStatus.etDateKey;

  if (!options.force && !generationStatus.isGenerationWindow) {
    return {
      status: "skipped",
      date,
      reason: generationStatus.skipReason || "outside_generation_window",
    };
  }

  const existing = await readSpxGexHeatmap(options.db, date);
  if (existing && !options.force) {
    return { status: "skipped_existing", date };
  }

  const quoteText = await options.mcpClient.getQuotes();
  const optionsText = await options.mcpClient.getOptions();
  const zeroDteText = await options.mcpClient.getOptions0Dte();
  const selectedExpiries = selectSpxGexActiveExpiriesFromMcpText(optionsText, zeroDteText, 5);
  const gexByExpiryText: Record<string, string> = {};

  for (const expiry of selectedExpiries) {
    gexByExpiryText[expiry] = await options.mcpClient.getOptionsGex(expiry);
  }

  const heatmap = buildSpxGexHeatmapFromMcpText({
    generatedAt: now.toISOString(),
    quoteText,
    optionsText,
    zeroDteText,
    gexByExpiryText,
  });

  await upsertSpxGexHeatmap(options.db, date, heatmap, { retentionTradingDays: 7 });
  return { status: "generated", date };
};
