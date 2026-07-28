import type { SpxGexTelegramSummary } from "./spx-gex-heatmap";
import type { MarketSnapshot } from "./spx-decision-pipeline";

export interface SpxMarketSnapshotInput {
  runId: string;
  scheduledAt: Date;
  snapshotAt: Date;
  spxLatestAt?: Date | null;
  spxM5LatestAt?: Date | null;
  vixLatestAt?: Date | null;
  gexSnapshotAt?: string | null;
  gexProvider?: string | null;
  gexFallbackFrom?: string | null;
  dataQuality: { overallStatus: "OK" | "WARN" | "BLOCK"; hardBlocks: string[]; warnings: string[] };
  facts: MarketSnapshot["facts"];
  gexSummary?: SpxGexTelegramSummary | null;
  boardDeepLink: string | null;
  replayEvidence: MarketSnapshot["replayEvidence"];
}

export const normalizeSpxReplaySeries = (rows: any[]): Array<Record<string, unknown>> => rows.map((row) => ({
  date: row.date instanceof Date ? row.date.toISOString() : String(row.date || ""),
  open: finiteOrNull(row.open), high: finiteOrNull(row.high), low: finiteOrNull(row.low),
  close: finiteOrNull(row.close), volume: finiteOrNull(row.volume),
}));

export function buildSpxMarketSnapshot(input: SpxMarketSnapshotInput): MarketSnapshot {
  const ageMs = (observedAt: Date | null | undefined) => observedAt ? Math.max(0, input.snapshotAt.getTime() - observedAt.getTime()) : null;
  const freshnessStatus = (age: number | null, maxAgeMs: number) => age === null ? "MISSING" : age <= maxAgeMs ? "OK" : "STALE";
  const spxAge = ageMs(input.spxLatestAt);
  const spxM5Age = ageMs(input.spxM5LatestAt);
  const vixAge = ageMs(input.vixLatestAt);
  const gexDate = input.gexSnapshotAt ? new Date(input.gexSnapshotAt) : null;
  const gexAge = gexDate && Number.isFinite(gexDate.getTime()) ? ageMs(gexDate) : null;
  return {
    runId: input.runId, scheduledAt: input.scheduledAt.toISOString(), snapshotAt: input.snapshotAt.toISOString(),
    sourceFreshness: {
      spxYahoo: { source: "Yahoo Finance ^GSPC chart", observedAt: input.spxLatestAt?.toISOString() || null, ageMs: spxAge, status: freshnessStatus(spxAge, 20 * 60_000) },
      spxM5Yahoo: { source: "Yahoo Finance ^GSPC 5m chart", observedAt: input.spxM5LatestAt?.toISOString() || null, ageMs: spxM5Age, status: freshnessStatus(spxM5Age, 10 * 60_000) },
      vixYahoo: { source: "Yahoo Finance ^VIX chart", observedAt: input.vixLatestAt?.toISOString() || null, ageMs: vixAge, status: freshnessStatus(vixAge, 20 * 60_000) },
      canonicalGex: { source: `Canonical SPX GEX Board snapshot (${input.gexProvider || "unknown provider"})`, observedAt: gexDate && Number.isFinite(gexDate.getTime()) ? gexDate.toISOString() : null, ageMs: gexAge, status: gexAge !== null && gexAge <= 35 * 60_000 && input.gexFallbackFrom ? "FALLBACK" : freshnessStatus(gexAge, 35 * 60_000) },
    },
    dataQuality: { status: input.dataQuality.overallStatus, hardBlocks: [...input.dataQuality.hardBlocks], warnings: [...input.dataQuality.warnings] },
    facts: input.facts, gexSummary: input.gexSummary || null, normalizedContext: null, boardDeepLink: input.boardDeepLink,
    replayGrade: input.replayEvidence?.replayGrade || "UNAVAILABLE", replayEvidence: input.replayEvidence, rawSnapshotAvailable: false,
  };
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
