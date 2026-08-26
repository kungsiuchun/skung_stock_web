import type { SpxGexHeatmapModel } from "./spx-gex-heatmap";
import type { SpxGexPressureFrame } from "./spx-gex-pressure-matrix";
import type { D1DatabaseLike } from "./spx-recap-d1";

export interface SpxGexPressureProjectionRow {
  trading_date: string;
  snapshot_minute_et: number;
  snapshot_time_et: string;
  collected_minute_et: number;
  collected_time_et: string;
  generated_at: string;
  spot: number;
  expiry: string;
  calculation_engine_version: number;
  provider: string;
  fallback_from: string | null;
  source_timestamp: string | null;
  snapshot_id: string;
  payload_hash: string;
  gex_json: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * This is the complete public Pressure read model. It is built only after the
 * canonical snapshot validates, so runtime readers never walk snapshot_json.
 */
export const buildSpxGexPressureProjection = (heatmap: SpxGexHeatmapModel): SpxGexPressureFrame => {
  const session = heatmap.session;
  const canonical = heatmap.canonical;
  if (!session || !canonical?.snapshotId || !canonical.payloadHash) {
    throw new Error("SPX GEX pressure projection requires a canonical session snapshot.");
  }
  const expiry = heatmap.zeroDte.expiry || heatmap.selectedExpiries[0];
  const gexByStrike = heatmap.cells
    .filter((cell) => cell.expdate === expiry && finite(cell.strike) && finite(cell.netGex))
    .map((cell) => ({ strike: cell.strike, netGex: cell.netGex as number }));
  if (!expiry || gexByStrike.length === 0) {
    throw new Error("SPX GEX pressure projection requires finite 0DTE strike exposure.");
  }
  return {
    tradingDate: session.tradingDate,
    snapshotMinuteEt: session.snapshotMinuteEt,
    snapshotTimeEt: session.snapshotTimeEt,
    collectedMinuteEt: session.collectedMinuteEt,
    collectedTimeEt: session.collectedTimeEt,
    spot: session.spot,
    expiry,
    calculationEngineVersion: heatmap.source.calculationEngineVersion || 1,
    provider: canonical.provider,
    fallbackFrom: canonical.fallbackFrom,
    sourceTimestamp: canonical.sourceTimestamp,
    snapshotId: canonical.snapshotId,
    gexByStrike,
  };
};

export const prepareSpxGexPressureProjectionUpsert = (
  db: D1DatabaseLike,
  heatmap: SpxGexHeatmapModel,
) => {
  const frame = buildSpxGexPressureProjection(heatmap);
  return db.prepare(`
    INSERT INTO spx_gex_pressure_projections (
      trading_date, snapshot_minute_et, snapshot_time_et,
      collected_minute_et, collected_time_et, generated_at, spot, expiry,
      calculation_engine_version, provider, fallback_from, source_timestamp,
      snapshot_id, payload_hash, gex_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trading_date, snapshot_minute_et) DO UPDATE SET
      snapshot_time_et = excluded.snapshot_time_et,
      collected_minute_et = excluded.collected_minute_et,
      collected_time_et = excluded.collected_time_et,
      generated_at = excluded.generated_at,
      spot = excluded.spot,
      expiry = excluded.expiry,
      calculation_engine_version = excluded.calculation_engine_version,
      provider = excluded.provider,
      fallback_from = excluded.fallback_from,
      source_timestamp = excluded.source_timestamp,
      snapshot_id = excluded.snapshot_id,
      payload_hash = excluded.payload_hash,
      gex_json = excluded.gex_json,
      updated_at = excluded.updated_at
  `).bind(
    frame.tradingDate,
    frame.snapshotMinuteEt,
    frame.snapshotTimeEt,
    frame.collectedMinuteEt,
    frame.collectedTimeEt,
    heatmap.generatedAt,
    frame.spot,
    frame.expiry,
    frame.calculationEngineVersion,
    frame.provider,
    frame.fallbackFrom,
    frame.sourceTimestamp,
    frame.snapshotId,
    heatmap.canonical!.payloadHash,
    JSON.stringify(frame.gexByStrike),
    heatmap.generatedAt,
    heatmap.generatedAt,
  );
};

