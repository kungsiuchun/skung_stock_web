export const TREASURY_YIELD_CURVE_SOURCE_URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/all?_format=csv&page=&type=daily_treasury_yield_curve";
export const getTreasuryYieldCurveXmlUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;

const TREASURY_XML_FIELD_BY_MATURITY: Record<string, string> = {
  "1M": "BC_1MONTH",
  "1.5M": "BC_1_5MONTH",
  "2M": "BC_2MONTH",
  "3M": "BC_3MONTH",
  "4M": "BC_4MONTH",
  "6M": "BC_6MONTH",
  "1Y": "BC_1YEAR",
  "2Y": "BC_2YEAR",
  "3Y": "BC_3YEAR",
  "5Y": "BC_5YEAR",
  "7Y": "BC_7YEAR",
  "10Y": "BC_10YEAR",
  "20Y": "BC_20YEAR",
  "30Y": "BC_30YEAR",
};

const MATURITIES = [
  ["1 Mo", "1M", 1 / 12],
  ["1.5 Mo", "1.5M", 1.5 / 12],
  ["2 Mo", "2M", 2 / 12],
  ["3 Mo", "3M", 3 / 12],
  ["4 Mo", "4M", 4 / 12],
  ["6 Mo", "6M", 6 / 12],
  ["1 Yr", "1Y", 1],
  ["2 Yr", "2Y", 2],
  ["3 Yr", "3Y", 3],
  ["5 Yr", "5Y", 5],
  ["7 Yr", "7Y", 7],
  ["10 Yr", "10Y", 10],
  ["20 Yr", "20Y", 20],
  ["30 Yr", "30Y", 30],
] as const;

export type TreasuryCurveKey = "latest" | "oneWeek" | "oneMonth" | "startOfYear";

export interface TreasuryCurvePoint {
  maturity: string;
  label: string;
  years: number;
  yield: number;
}

export interface TreasuryCurveSnapshot {
  key: TreasuryCurveKey;
  label: string;
  date: string;
  points: TreasuryCurvePoint[];
}

export interface TreasuryYieldRow {
  maturity: string;
  yield: number;
  oneDayBps: number;
  oneWeekBps: number;
  oneMonthBps: number;
  yearToDateBps: number;
}

export interface TreasurySpreadRow {
  label: string;
  valueBps: number;
  oneDayBps: number;
  oneWeekBps: number;
  oneMonthBps: number;
  yearToDateBps: number;
}

export interface TreasuryYieldCurveResponse {
  asOfDate: string;
  sourceUrl: string;
  curves: TreasuryCurveSnapshot[];
  yieldRows: TreasuryYieldRow[];
  spreadRows: TreasurySpreadRow[];
  source: {
    provider: "U.S. Department of the Treasury";
    label: "Daily Treasury Par Yield Curve Rates";
    url: string;
    fetchedAt: string;
  };
}

type TreasuryRecord = {
  date: string;
  timestamp: number;
  yields: Record<string, number>;
};

export class TreasuryYieldCurveError extends Error {}

const toTimestamp = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new TreasuryYieldCurveError(`Treasury CSV contains an invalid Date value: ${value}`);
  const [, month, day, year] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
};

const toIsoDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

const parseCsvRows = (csv: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];

    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
};

export function parseTreasuryYieldCurveCsv(csv: string): TreasuryRecord[] {
  const rows = parseCsvRows(csv);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new TreasuryYieldCurveError("Treasury CSV is empty.");

  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, "").trim());
  const dateIndex = headers.indexOf("Date");
  if (dateIndex < 0) throw new TreasuryYieldCurveError("Treasury CSV is missing the Date column.");

  const maturityIndexes = MATURITIES.map(([sourceLabel]) => {
    const index = headers.indexOf(sourceLabel);
    if (index < 0) throw new TreasuryYieldCurveError(`Treasury CSV is missing the ${sourceLabel} column.`);
    return index;
  });

  const records = dataRows
    .filter((row) => row[dateIndex])
    .map((row) => {
      const date = row[dateIndex];
      const yields: Record<string, number> = {};

      MATURITIES.forEach(([, label], maturityIndex) => {
        const raw = row[maturityIndexes[maturityIndex]]?.trim();
        const value = raw === "N/A" || !raw ? Number.NaN : Number(raw);
        yields[label] = value;
      });

      return { date: toIsoDate(toTimestamp(date)), timestamp: toTimestamp(date), yields };
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  if (records.length === 0) throw new TreasuryYieldCurveError("Treasury CSV contains no yield curve records.");
  return records;
}

const readXmlElement = (properties: string, name: string) => {
  const match = new RegExp(`<d:${name}(?:\\s[^>]*)?>([^<]*)<\\/d:${name}>`).exec(properties);
  return match?.[1]?.trim();
};

export function parseTreasuryYieldCurveXml(xml: string): TreasuryRecord[] {
  const records: TreasuryRecord[] = [];
  const propertiesPattern = /<m:properties>([\s\S]*?)<\/m:properties>/g;
  let match: RegExpExecArray | null;

  while ((match = propertiesPattern.exec(xml))) {
    const properties = match[1];
    const rawDate = readXmlElement(properties, "NEW_DATE");
    if (!rawDate) throw new TreasuryYieldCurveError("Treasury XML is missing NEW_DATE for a curve record.");
    const date = rawDate.slice(0, 10);
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp)) throw new TreasuryYieldCurveError(`Treasury XML contains an invalid NEW_DATE value: ${rawDate}`);

    const yields: Record<string, number> = {};
    for (const [, maturity] of MATURITIES) {
      const rawYield = readXmlElement(properties, TREASURY_XML_FIELD_BY_MATURITY[maturity]);
      yields[maturity] = rawYield ? Number(rawYield) : Number.NaN;
    }

    records.push({ date, timestamp, yields });
  }

  if (records.length === 0) throw new TreasuryYieldCurveError("Treasury XML contains no yield curve records.");
  return records.sort((left, right) => left.timestamp - right.timestamp);
}

const ensureCompleteCurve = (record: TreasuryRecord, label: string) => {
  for (const [, maturity] of MATURITIES) {
    if (!Number.isFinite(record.yields[maturity])) {
      throw new TreasuryYieldCurveError(`${label} (${record.date}) is missing the ${maturity} Treasury yield.`);
    }
  }
  return record;
};

const findLatestOnOrBefore = (records: TreasuryRecord[], cutoff: number, label: string) => {
  const record = [...records].reverse().find((candidate) => candidate.timestamp <= cutoff);
  if (!record) throw new TreasuryYieldCurveError(`Treasury CSV has no available record for ${label}.`);
  return ensureCompleteCurve(record, label);
};

const oneCalendarMonthEarlier = (timestamp: number) => {
  const date = new Date(timestamp);
  const previousMonth = date.getUTCMonth() === 0 ? 11 : date.getUTCMonth() - 1;
  const year = date.getUTCMonth() === 0 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, previousMonth + 1, 0)).getUTCDate();
  return Date.UTC(year, previousMonth, Math.min(date.getUTCDate(), lastDay));
};

const buildSnapshot = (key: TreasuryCurveKey, label: string, record: TreasuryRecord): TreasuryCurveSnapshot => ({
  key,
  label,
  date: record.date,
  points: MATURITIES.map(([, maturity, years]) => ({
    maturity,
    label: maturity,
    years,
    yield: record.yields[maturity],
  })),
});

const differenceInBps = (latest: number, previous: number) => Number(((latest - previous) * 100).toFixed(1));

const getSpread = (record: TreasuryRecord, longMaturity: string, shortMaturity: string) =>
  Number(((record.yields[longMaturity] - record.yields[shortMaturity]) * 100).toFixed(1));

const buildTreasuryYieldCurveResponseFromRecords = (records: TreasuryRecord[], fetchedAt: string, sourceUrl: string): TreasuryYieldCurveResponse => {
  const latest = ensureCompleteCurve(records[records.length - 1], "Latest published curve");
  const previous = findLatestOnOrBefore(records, latest.timestamp - 1, "Previous published curve");
  const oneWeek = findLatestOnOrBefore(records, latest.timestamp - 7 * 24 * 60 * 60 * 1000, "One-week comparison curve");
  const oneMonth = findLatestOnOrBefore(records, oneCalendarMonthEarlier(latest.timestamp), "One-month comparison curve");
  const startOfYear = records.find((record) => new Date(record.timestamp).getUTCFullYear() === new Date(latest.timestamp).getUTCFullYear());
  if (!startOfYear) throw new TreasuryYieldCurveError(`Treasury CSV has no start-of-year curve for ${latest.date.slice(0, 4)}.`);
  ensureCompleteCurve(startOfYear, "Start-of-year comparison curve");

  const comparisons = { previous, oneWeek, oneMonth, startOfYear };
  const curves = [
    buildSnapshot("latest", "Latest published", latest),
    buildSnapshot("oneWeek", "1 week ago", oneWeek),
    buildSnapshot("oneMonth", "1 month ago", oneMonth),
    buildSnapshot("startOfYear", "Start of year", startOfYear),
  ];

  const yieldRows = MATURITIES.map(([, maturity]) => ({
    maturity,
    yield: latest.yields[maturity],
    oneDayBps: differenceInBps(latest.yields[maturity], comparisons.previous.yields[maturity]),
    oneWeekBps: differenceInBps(latest.yields[maturity], comparisons.oneWeek.yields[maturity]),
    oneMonthBps: differenceInBps(latest.yields[maturity], comparisons.oneMonth.yields[maturity]),
    yearToDateBps: differenceInBps(latest.yields[maturity], comparisons.startOfYear.yields[maturity]),
  }));

  const spreadRows = [
    ["10Y - 2Y", "10Y", "2Y"],
    ["10Y - 3M", "10Y", "3M"],
  ].map(([label, longMaturity, shortMaturity]) => {
    const valueBps = getSpread(latest, longMaturity, shortMaturity);
    return {
      label,
      valueBps,
      oneDayBps: Number((valueBps - getSpread(comparisons.previous, longMaturity, shortMaturity)).toFixed(1)),
      oneWeekBps: Number((valueBps - getSpread(comparisons.oneWeek, longMaturity, shortMaturity)).toFixed(1)),
      oneMonthBps: Number((valueBps - getSpread(comparisons.oneMonth, longMaturity, shortMaturity)).toFixed(1)),
      yearToDateBps: Number((valueBps - getSpread(comparisons.startOfYear, longMaturity, shortMaturity)).toFixed(1)),
    };
  });

  return {
    asOfDate: latest.date,
    sourceUrl,
    curves,
    yieldRows,
    spreadRows,
    source: {
      provider: "U.S. Department of the Treasury",
      label: "Daily Treasury Par Yield Curve Rates",
      url: sourceUrl,
      fetchedAt,
    },
  };
}

export function buildTreasuryYieldCurveResponse(csv: string, fetchedAt = new Date().toISOString()): TreasuryYieldCurveResponse {
  return buildTreasuryYieldCurveResponseFromRecords(parseTreasuryYieldCurveCsv(csv), fetchedAt, TREASURY_YIELD_CURVE_SOURCE_URL);
}

export function buildTreasuryYieldCurveResponseFromXml(xmlDocuments: string[], fetchedAt = new Date().toISOString(), sourceUrl = TREASURY_YIELD_CURVE_SOURCE_URL): TreasuryYieldCurveResponse {
  const recordsByTimestamp = new Map<number, TreasuryRecord>();
  for (const document of xmlDocuments) {
    for (const record of parseTreasuryYieldCurveXml(document)) recordsByTimestamp.set(record.timestamp, record);
  }
  return buildTreasuryYieldCurveResponseFromRecords([...recordsByTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp), fetchedAt, sourceUrl);
}
