import assert from "node:assert/strict";
import test from "node:test";

import {
  readPendingAgentSignalOutcomes,
  readAgentCalibrationWeights,
  updateAgentSignalOutcomeResults,
  upsertAgentSignalOutcome,
  type AgentSignalOutcome,
} from "../src/lib/spx-recap-d1";

class CalibrationStatement {
  private values: unknown[] = [];

  constructor(private readonly db: CalibrationD1, private readonly query: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.includes("INSERT INTO spx_agent_signal_outcomes")) {
      const [
        run_id,
        date,
        time_et,
        agent_key,
        decision,
        confidence,
        rule_verdict,
        data_quality_json,
        entry_spx,
        outcome_5m,
        outcome_15m,
        outcome_30m,
        success_15m,
        created_at,
        updated_at,
      ] = this.values;
      this.db.rows.set(String(run_id), {
        run_id,
        date,
        time_et,
        agent_key,
        decision,
        confidence,
        rule_verdict,
        data_quality_json,
        entry_spx,
        outcome_5m,
        outcome_15m,
        outcome_30m,
        success_15m,
        created_at,
        updated_at,
      });
    } else if (this.query.includes("UPDATE spx_agent_signal_outcomes")) {
      const [outcome_5m, outcome_15m, outcome_30m, success_15m, updated_at, run_id] = this.values;
      const row = this.db.rows.get(String(run_id));
      if (row) {
        row.outcome_5m = outcome_5m ?? row.outcome_5m;
        row.outcome_15m = outcome_15m ?? row.outcome_15m;
        row.outcome_30m = outcome_30m ?? row.outcome_30m;
        row.success_15m = success_15m ?? row.success_15m;
        row.updated_at = updated_at;
      }
    }
    return {};
  }

  async first<T = Record<string, unknown>>() {
    return null as T | null;
  }

  async all<T = Record<string, unknown>>() {
    if (this.query.includes("FROM spx_agent_signal_outcomes") && this.query.includes("success_15m IS NULL")) {
      return {
        results: [...this.db.rows.values()]
          .filter((row) => row.date === this.values[0] && (row.success_15m === null || row.success_15m === undefined))
          .map((row) => ({
            run_id: row.run_id,
            date: row.date,
            time_et: row.time_et,
            agent_key: row.agent_key,
            decision: row.decision,
            entry_spx: row.entry_spx,
          })) as T[],
      };
    }

    if (this.query.includes("FROM spx_agent_signal_outcomes")) {
      const rows = [...this.db.rows.values()];
      const byAgent = new Map<string, { agent_key: string; sample_count: number; success_count: number }>();
      for (const row of rows) {
        if (row.success_15m === null || row.success_15m === undefined) continue;
        const key = String(row.agent_key);
        const aggregate = byAgent.get(key) || { agent_key: key, sample_count: 0, success_count: 0 };
        aggregate.sample_count += 1;
        aggregate.success_count += Number(row.success_15m || 0);
        byAgent.set(key, aggregate);
      }
      return { results: [...byAgent.values()] as T[] };
    }
    return { results: [] as T[] };
  }
}

class CalibrationD1 {
  readonly rows = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    return new CalibrationStatement(this, query);
  }
}

const outcome = (id: string, agentKey: string, success15m: boolean): AgentSignalOutcome => ({
  runId: id,
  date: "2026-06-29",
  timeEt: "10:00:00",
  agentKey,
  decision: "OPEN_CALL",
  confidence: 70,
  ruleVerdict: "TRADE_ALLOWED",
  dataQuality: { overallStatus: "OK" },
  entrySpx: 7400,
  outcome5m: 4,
  outcome15m: success15m ? 8 : -5,
  outcome30m: success15m ? 12 : -9,
  success15m,
});

test("agent calibration keeps default weights until each agent has at least 20 outcomes", async () => {
  const db = new CalibrationD1();
  for (let index = 0; index < 19; index += 1) {
    await upsertAgentSignalOutcome(db, outcome(`qm-${index}`, "QM", true));
  }

  const weights = await readAgentCalibrationWeights(db);

  assert.equal(weights.QM.sampleCount, 19);
  assert.equal(weights.QM.weight, 1);
});

test("agent calibration derives bounded weights from 15m hit rate after 20 samples", async () => {
  const db = new CalibrationD1();
  for (let index = 0; index < 15; index += 1) {
    await upsertAgentSignalOutcome(db, outcome(`cm-win-${index}`, "CM", true));
  }
  for (let index = 0; index < 5; index += 1) {
    await upsertAgentSignalOutcome(db, outcome(`cm-loss-${index}`, "CM", false));
  }

  const weights = await readAgentCalibrationWeights(db);

  assert.equal(weights.CM.sampleCount, 20);
  assert.equal(weights.CM.hitRate, 0.75);
  assert.equal(weights.CM.weight, 1.25);
});

test("agent signal journal can list pending rows and update 15m outcomes", async () => {
  const db = new CalibrationD1();
  await upsertAgentSignalOutcome(db, {
    ...outcome("pa-pending", "PA", true),
    success15m: null,
    outcome15m: null,
  });

  const pending = await readPendingAgentSignalOutcomes(db, "2026-06-29");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].runId, "pa-pending");

  await updateAgentSignalOutcomeResults(db, "pa-pending", { outcome15m: 6.5, success15m: true });
  const weights = await readAgentCalibrationWeights(db);

  assert.equal(weights.PA.sampleCount, 1);
  assert.equal(weights.PA.successCount, 1);
});
