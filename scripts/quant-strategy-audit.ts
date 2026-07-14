import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  assertResearchBars,
  runQuantResearchSuite,
  type BacktestConfig,
  type ResearchBar,
} from "../functions/api/agent/strategies/research";

interface AuditInput {
  dataSource: string;
  universe?: string;
  bars: ResearchBar[];
  config?: Partial<BacktestConfig>;
  retrievedAt?: string;
  sourceLocator?: string;
}

interface YahooChartPayload {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
  };
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseAuditInput(path: string): AuditInput {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object") {
    throw new Error("Audit input must be a JSON object.");
  }
  const input = value as Partial<AuditInput> & {
    reproducibility?: Partial<AuditInput> & { normalizedBars?: unknown };
  };
  const persisted = input.reproducibility;
  const dataSource = input.dataSource ?? persisted?.dataSource;
  const bars = input.bars ?? persisted?.normalizedBars;
  const config = input.config ?? persisted?.config;
  if (typeof dataSource !== "string" || dataSource.trim() === "") {
    throw new Error("Audit input requires a non-empty dataSource declaration.");
  }
  if (!Array.isArray(bars)) {
    throw new Error("Audit input requires an OHLCV bars array.");
  }
  assertResearchBars(bars as ResearchBar[]);
  return {
    dataSource,
    universe: typeof (input.universe ?? persisted?.universe) === "string" ? input.universe ?? persisted?.universe : undefined,
    bars: bars as ResearchBar[],
    config,
    retrievedAt: typeof (input.retrievedAt ?? persisted?.retrievedAt) === "string" ? input.retrievedAt ?? persisted?.retrievedAt : undefined,
    sourceLocator: typeof (input.sourceLocator ?? persisted?.sourceLocator) === "string" ? input.sourceLocator ?? persisted?.sourceLocator : undefined,
  };
}

function requireYahooScalar(value: number | null | undefined, label: string, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Yahoo diagnostic input is missing ${label} at index ${index}.`);
  }
  return value;
}

async function fetchYahooDiagnostic(symbol: string, range: string): Promise<AuditInput> {
  if (!/^[A-Za-z0-9.^=-]+$/.test(symbol)) {
    throw new Error("Yahoo diagnostic symbol contains unsupported characters.");
  }
  if (!/^(?:[1-9][0-9]*[dmy]|ytd|max)$/.test(range)) {
    throw new Error("Yahoo diagnostic range must be like 5y, 365d, ytd, or max.");
  }

  const encodedSymbol = encodeURIComponent(symbol.toUpperCase());
  const sourceLocator = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=${range}&events=history&includeAdjustedClose=true`;
  const response = await fetch(sourceLocator, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) {
    throw new Error(`Yahoo diagnostic fetch failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as YahooChartPayload;
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const adjustedClose = result?.indicators?.adjclose?.[0]?.adjclose;
  const timestamps = result?.timestamp;
  if (!timestamps || !quote?.open || !quote.high || !quote.low || !quote.close || !quote.volume || !adjustedClose) {
    throw new Error("Yahoo diagnostic response lacks complete daily OHLCV or adjusted-close data.");
  }
  if (
    timestamps.length !== quote.open.length ||
    timestamps.length !== quote.high.length ||
    timestamps.length !== quote.low.length ||
    timestamps.length !== quote.close.length ||
    timestamps.length !== quote.volume.length ||
    timestamps.length !== adjustedClose.length
  ) {
    throw new Error("Yahoo diagnostic response has inconsistent array lengths.");
  }

  const bars: ResearchBar[] = timestamps.map((timestamp, index) => {
    const close = requireYahooScalar(quote.close?.[index], "close", index);
    const adjusted = requireYahooScalar(adjustedClose[index], "adjusted close", index);
    if (close <= 0 || adjusted <= 0) {
      throw new Error(`Yahoo diagnostic response has non-positive close at index ${index}.`);
    }
    const adjustment = adjusted / close;
    const open = requireYahooScalar(quote.open?.[index], "open", index) * adjustment;
    const high = requireYahooScalar(quote.high?.[index], "high", index) * adjustment;
    const low = requireYahooScalar(quote.low?.[index], "low", index) * adjustment;
    const volume = requireYahooScalar(quote.volume?.[index], "volume", index);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`Yahoo diagnostic response has invalid timestamp at index ${index}.`);
    }
    return {
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close: adjusted,
      volume,
    };
  });
  // Yahoo's final daily bar can represent an in-progress or subsequently
  // revised session. Exclude it rather than letting a partial close leak into
  // a supposedly end-of-day signal.
  const completedBars = bars.slice(0, -1);
  assertResearchBars(completedBars);

  return {
    dataSource: "Yahoo Finance Chart API diagnostic snapshot; adjusted OHLC derives from adjusted-close ratio, the latest provider bar is excluded, and the source is not point-in-time certified.",
    universe: `${symbol.toUpperCase()} only; single-ETF diagnostic baseline, not a survivorship-safe cross-sectional universe.`,
    bars: completedBars,
    retrievedAt: new Date().toISOString(),
    sourceLocator,
  };
}

const inputPath = readArgument("--input");
const yahooSymbol = readArgument("--yahoo-symbol");
const yahooRange = readArgument("--range") ?? "5y";
const outputPath = readArgument("--output");
if (Boolean(inputPath) === Boolean(yahooSymbol)) {
  throw new Error("Provide exactly one of --input <ohlcv.json> or --yahoo-symbol <symbol>.");
}
if (yahooSymbol && !process.argv.includes("--accept-yahoo-diagnostic")) {
  throw new Error("Yahoo mode is diagnostic-only; pass --accept-yahoo-diagnostic to acknowledge it cannot certify institutional research.");
}

const input = inputPath
  ? parseAuditInput(resolve(inputPath))
  : await fetchYahooDiagnostic(yahooSymbol as string, yahooRange);

const suite = runQuantResearchSuite(input.bars, input.config);
const normalizedBars = JSON.stringify(input.bars);
const report = {
  schemaVersion: 1,
  reproducibility: {
    inputPath: inputPath ? resolve(inputPath) : null,
    sourceLocator: input.sourceLocator ?? null,
    dataSource: input.dataSource,
    universe: input.universe ?? "undeclared",
    retrievedAt: input.retrievedAt ?? null,
    dataRange: { start: input.bars[0].date, end: input.bars.at(-1)?.date },
    config: suite.reports[0]?.config ?? null,
    normalizedBarSha256: createHash("sha256").update(normalizedBars).digest("hex"),
    normalizedBars: input.bars,
    randomSeed: null,
    note: "Rules are deterministic; randomSeed is intentionally null.",
  },
  suite,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  const resolvedOutputPath = resolve(outputPath);
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, serialized, "utf8");
  console.log(`Quant strategy audit written to ${resolvedOutputPath}`);
} else {
  console.log(serialized);
}
