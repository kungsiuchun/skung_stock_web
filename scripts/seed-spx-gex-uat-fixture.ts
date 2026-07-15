import { readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { buildSpxGexUatFixture } from "../src/lib/spx-gex-uat-fixture";

const repoRoot = process.cwd();
const persistTo = path.resolve(repoRoot, ".wrangler", "spx-uat");
const fixture = buildSpxGexUatFixture();
const session = fixture.session;
const canonical = fixture.canonical;

if (!session || !canonical || fixture.cells.length !== 480 || fixture.selectedExpiries.length !== 5) {
  throw new Error("SPX GEX UAT fixture contract failed before D1 seed.");
}

const quote = (value: unknown) => `'${String(value ?? "").replace(/'/g, "''")}'`;
const json = (value: unknown) => quote(JSON.stringify(value));
const runId = "uat-spx-board-2026-07-13-1445-et";
const createdAt = "2026-07-13T18:45:10.000Z";
const slotId = `${session.tradingDate}:${session.snapshotMinuteEt}`;
const council = {
  status: "OK",
  latencyMs: 480,
  degradedReason: null,
  agents: (["QM", "CM", "NT", "PA"] as const).map((agent, index) => ({
    agent,
    decision: "HOLD",
    confidence: 58 + index,
    evidenceRefs: agent === "CM" ? ["gex.gammaFlip", "spx.last"] : ["spx.last", "spx.vwap"],
    modelStatus: "AI",
    fallbackStatus: null,
    latencyMs: 105 + index * 8,
    reasoning: `${agent} UAT fixture: normalized canonical facts do not confirm a direction entry.`,
    valid: true,
    attempts: [{
      attempt: 1,
      model: "uat-fixture",
      status: "SUCCESS",
      latencyMs: 105 + index * 8,
      httpStatus: 200,
      errorCategory: null,
      finishReason: "stop",
      contentLength: 128 + index,
      responseHash: `uat-${agent.toLowerCase()}-normalized-hash`,
    }],
  })),
};
const cioDecision = {
  action: "HOLD",
  confidence: 61,
  thesis: "UAT fixture: Council found no snapshot-backed entry edge.",
  entry: null,
  invalidation: null,
  targets: [],
  noTradeConditions: ["No verified directional edge"],
  evidenceRefs: ["spx.last", "gex.gammaFlip"],
  modelStatus: "AI",
  latencyMs: 160,
  attempts: [{
    attempt: 1,
    model: "uat-fixture",
    status: "SUCCESS",
    latencyMs: 160,
    httpStatus: 200,
    errorCategory: null,
    finishReason: "stop",
    contentLength: 196,
    responseHash: "uat-cio-normalized-hash",
  }],
};
const riskGate = { disposition: "PASS", reason: "No safety veto.", action: "HOLD" };
const snapshot = {
  runId,
  scheduledAt: "2026-07-13T18:45:00.000Z",
  snapshotAt: fixture.generatedAt,
  sourceFreshness: {
    canonicalGex: { source: "LOCAL FIXTURE", observedAt: fixture.generatedAt, ageMs: 0, status: "OK" },
  },
  dataQuality: { status: "OK", hardBlocks: [], warnings: [] },
  facts: {
    "spx.last": fixture.quote.last,
    "spx.vwap": 7524.2,
    "gex.gammaFlip": fixture.zeroDte.gammaFlip,
  },
  boardDeepLink: `#/work/spx-gex-heatmap?date=${session.tradingDate}&snapshot=${session.snapshotMinuteEt}`,
  replayGrade: "NORMALIZED_CANONICAL",
  replayEvidence: {
    replayGrade: "NORMALIZED_CANONICAL",
    vendorRawPayloadsPersisted: false,
    gex: {
      snapshotId: canonical.snapshotId,
      payloadHash: canonical.payloadHash,
      schemaVersion: canonical.schemaVersion,
      provider: canonical.provider,
      fallbackFrom: canonical.fallbackFrom,
      sourceTimestamp: canonical.sourceTimestamp,
      facts: canonical.facts,
      dataQuality: canonical.dataQuality,
    },
    normalizedSeries: { spx15m: [], spx5m: [], spxD1: [], spxH1: [], vix15m: [], vix9d: [] },
  },
  rawSnapshotAvailable: false,
};

const lifecycleStages = [
  "SCHEDULED",
  "LOCK_ACQUIRED",
  "SNAPSHOT_READY",
  "COUNCIL_COMPLETED",
  "CIO_DECIDED",
  "RISK_GATED",
  "PERSISTED",
];
const lifecycleSql = lifecycleStages.map((stage, index) => `
INSERT OR IGNORE INTO spx_run_lifecycle_events
  (run_id, stage, stage_rank, attempt, occurred_at, latency_ms, payload_json, created_at)
VALUES
  (${quote(runId)}, ${quote(stage)}, ${index}, 0, ${quote(createdAt)}, ${index === 0 ? "NULL" : index * 25}, '{}', ${quote(createdAt)});`).join("\n");
const collectionEventsSql = ["SCHEDULED", "FETCHED", "NORMALIZED", "PERSISTED"].map((stage, index) => `
INSERT OR IGNORE INTO spx_gex_collection_events
  (slot_id, stage, attempt, occurred_at, payload_json, created_at)
VALUES
  (${quote(slotId)}, ${quote(stage)}, 0, ${quote(createdAt)}, ${json({ source: "LOCAL_FIXTURE", cellCount: fixture.cells.length })}, ${quote(createdAt)});`).join("\n");

const sql = `
INSERT INTO spx_gex_intraday_snapshots
  (trading_date, snapshot_minute_et, snapshot_time_et, generated_at, ticker, spot, snapshot_json, created_at, updated_at)
VALUES
  (${quote(session.tradingDate)}, ${session.snapshotMinuteEt}, ${quote(session.snapshotTimeEt)}, ${quote(fixture.generatedAt)}, 'SPX', ${fixture.quote.last}, ${json(fixture)}, ${quote(createdAt)}, ${quote(createdAt)})
ON CONFLICT(trading_date, snapshot_minute_et) DO UPDATE SET
  snapshot_time_et=excluded.snapshot_time_et,
  generated_at=excluded.generated_at,
  spot=excluded.spot,
  snapshot_json=excluded.snapshot_json,
  updated_at=excluded.updated_at;

INSERT INTO spx_gex_collection_runs
  (slot_id, trading_date, snapshot_minute_et, snapshot_time_et, collected_minute_et, collected_time_et, current_stage, snapshot_id, payload_hash, provider, fallback_from, error, created_at, updated_at)
VALUES
  (${quote(slotId)}, ${quote(session.tradingDate)}, ${session.snapshotMinuteEt}, ${quote(session.snapshotTimeEt)}, ${session.collectedMinuteEt}, ${quote(session.collectedTimeEt)}, 'PERSISTED', ${quote(canonical.snapshotId)}, ${quote(canonical.payloadHash)}, ${quote(canonical.provider)}, NULL, NULL, ${quote(createdAt)}, ${quote(createdAt)})
ON CONFLICT(slot_id) DO UPDATE SET
  current_stage='PERSISTED', snapshot_id=excluded.snapshot_id, payload_hash=excluded.payload_hash, provider=excluded.provider, error=NULL, updated_at=excluded.updated_at;
${collectionEventsSql}

INSERT INTO spx_decision_runs
  (run_id, scheduled_at, current_stage, snapshot_at, snapshot_json, source_freshness_json, data_quality_json, replay_grade, gex_snapshot_id, gex_payload_hash, council_json, cio_decision_json, risk_gate_json, final_decision_json, final_action, degraded, degraded_reason, created_at, updated_at)
VALUES
  (${quote(runId)}, '2026-07-13T18:45:00.000Z', 'PERSISTED', ${quote(fixture.generatedAt)}, ${json(snapshot)}, ${json(snapshot.sourceFreshness)}, ${json(snapshot.dataQuality)}, 'NORMALIZED_CANONICAL', ${quote(canonical.snapshotId)}, ${quote(canonical.payloadHash)}, ${json(council)}, ${json(cioDecision)}, ${json(riskGate)}, ${json(cioDecision)}, 'HOLD', 0, NULL, ${quote(createdAt)}, ${quote(createdAt)})
ON CONFLICT(run_id) DO UPDATE SET
  current_stage='PERSISTED', snapshot_json=excluded.snapshot_json, council_json=excluded.council_json, cio_decision_json=excluded.cio_decision_json, risk_gate_json=excluded.risk_gate_json, final_decision_json=excluded.final_decision_json, final_action='HOLD', degraded=0, degraded_reason=NULL, updated_at=excluded.updated_at;
${lifecycleSql}
`;

const sqliteDirectory = path.join(persistTo, "v3", "d1", "miniflare-D1DatabaseObject");
const sqliteFiles = (await readdir(sqliteDirectory)).filter((file) => file.endsWith(".sqlite"));
if (sqliteFiles.length !== 1) {
  throw new Error(`Expected one isolated D1 SQLite file after migrations, found ${sqliteFiles.length}.`);
}
const database = new DatabaseSync(path.join(sqliteDirectory, sqliteFiles[0]));
try {
  database.exec("BEGIN IMMEDIATE");
  database.exec(sql);
  database.exec("COMMIT");
} catch (error) {
  try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
  throw error;
} finally {
  database.close();
}

console.log(`[SPX UAT] Seeded ${fixture.cells.length} cells / ${fixture.selectedExpiries.length} expiries / ${canonical.payloadHash}`);
