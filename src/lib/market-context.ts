import type { MarketBreadthSnapshot } from "./market-breadth";
import type { SectorRotationSnapshot } from "./sector-rotation";

export interface MarketContextSnapshot {
  schemaVersion: 1; snapshotId: string; priceAsOf: string; holdingsAsOf: string; generatedAt: string;
  benchmark: MarketBreadthSnapshot["sectorPerformance"]["benchmark"];
  participation: { above: number; eligible: number; total: number; pct: number | null };
  sectors: Array<{ sector: string; etf: string; oneDay: number | null; oneMonth: number | null; relativeOneMonth: number | null; quadrant: string }>;
  warnings: string[];
}

export function buildMarketContext(snapshot: MarketBreadthSnapshot, rotation: SectorRotationSnapshot | null): MarketContextSnapshot {
  if (rotation && (rotation.sourceSnapshotId !== snapshot.snapshotId || rotation.priceAsOf !== snapshot.priceAsOf)) throw new Error("Market context source identity mismatch.");
  const cells = snapshot.breadth.rows.map(row => row.windows.sma200);
  const above = cells.reduce((sum, row) => sum + row.above, 0);
  const eligible = cells.reduce((sum, row) => sum + row.eligible, 0);
  return {
    schemaVersion: 1, snapshotId: snapshot.snapshotId, priceAsOf: snapshot.priceAsOf, holdingsAsOf: snapshot.holdingsAsOf, generatedAt: snapshot.generatedAt,
    benchmark: snapshot.sectorPerformance.benchmark,
    participation: { above, eligible, total: snapshot.universeCount, pct: eligible ? 100 * above / eligible : null },
    sectors: snapshot.sectorPerformance.rows.map(row => ({ sector: row.sector, etf: row.etf, oneDay: row.oneDay, oneMonth: row.oneMonth,
      relativeOneMonth: rotation?.sectors.find(sector => sector.etf === row.etf)?.relativeToSpy.oneMonth ?? null,
      quadrant: rotation?.sectors.find(sector => sector.etf === row.etf)?.rotation.quadrant ?? "Unavailable" })),
    warnings: [...snapshot.warnings, ...(rotation?.warnings ?? [])],
  };
}

export function validateMarketContext(value: unknown): MarketContextSnapshot {
  const row = value as MarketContextSnapshot;
  const finiteOrNull = (n: unknown) => n === null || typeof n === "number" && Number.isFinite(n);
  if (!row || row.schemaVersion !== 1 || typeof row.snapshotId !== "string" || !row.snapshotId
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.priceAsOf) || !/^\d{4}-\d{2}-\d{2}$/.test(row.holdingsAsOf)
    || !Number.isFinite(Date.parse(row.generatedAt)) || row.benchmark?.symbol !== "SPY" || !finiteOrNull(row.benchmark.oneDay)
    || !row.participation || ![row.participation.above, row.participation.eligible, row.participation.total].every(n => Number.isInteger(n) && n >= 0)
    || row.participation.above > row.participation.eligible || row.participation.eligible > row.participation.total
    || !finiteOrNull(row.participation.pct) || row.participation.pct !== (row.participation.eligible ? 100 * row.participation.above / row.participation.eligible : null)
    || !Array.isArray(row.sectors) || row.sectors.length !== 11 || new Set(row.sectors.map(s => s.etf)).size !== 11
    || row.sectors.some(s => typeof s.etf !== "string" || typeof s.sector !== "string" || typeof s.quadrant !== "string" || ![s.oneDay, s.oneMonth, s.relativeOneMonth].every(finiteOrNull))
    || !Array.isArray(row.warnings) || row.warnings.some(s => typeof s !== "string") || new TextEncoder().encode(JSON.stringify(row)).byteLength > 30000) throw new Error("Published market context is invalid.");
  return row;
}
