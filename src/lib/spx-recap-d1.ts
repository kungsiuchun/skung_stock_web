import {
  type AuditPayload,
  type DailyMemory,
  type DayAnalyticsItem,
  type NormalizedRecapDay,
  type RecapSummary,
  type TimelineItem,
  buildSummary,
  normalizeRecapDay,
  stableHash,
} from "./spx-recap-normalizer";

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  run: () => Promise<unknown>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
  batch?: (statements: D1PreparedStatementLike[]) => Promise<unknown[]>;
}

export interface D1AuditRow {
  date: string;
  report: string | null;
  learned_rules_json: string | null;
  action_log_size: number | null;
  generated_at: string | null;
}

interface D1DayRow {
  date: string;
  total_callouts: number;
  trades_taken: number;
  wins: number;
  losses: number;
  flat_closes: number;
  win_rate: number | null;
  total_pnl_points: number;
  defensive_holds: number;
  ic_events: number;
  first_callout_at: string | null;
  last_callout_at: string | null;
}

interface D1CalloutRow {
  id: string;
  date: string;
  ordinal: number;
  time_et: string;
  timestamp_text: string | null;
  price: number | null;
  action: string;
  reasoning: string;
  pnl: number | null;
  status: TimelineItem["status"];
  event_type: TimelineItem["eventType"];
  position_side: TimelineItem["positionSide"];
  related_entry_id: string | null;
  raw_json: string;
}

export interface D1RecapPayload {
  day: NormalizedRecapDay;
  audit: AuditPayload | null;
}

export interface AgentSignalOutcome {
  runId: string;
  date: string;
  timeEt: string;
  agentKey: string;
  decision: string;
  confidence: number;
  ruleVerdict: string;
  dataQuality: unknown;
  entrySpx: number;
  outcome5m?: number | null;
  outcome15m?: number | null;
  outcome30m?: number | null;
  success15m?: boolean | null;
}

export interface PendingAgentSignalOutcome {
  runId: string;
  date: string;
  timeEt: string;
  agentKey: string;
  decision: string;
  entrySpx: number;
}

export interface AgentCalibrationWeight {
  sampleCount: number;
  successCount: number;
  hitRate: number | null;
  weight: number;
}

const nowIso = () => new Date().toISOString();

const asNumber = (value: unknown) => Number(value || 0);

const dayRowToSummary = (row: D1DayRow): RecapSummary => ({
  totalCallouts: asNumber(row.total_callouts),
  tradesTaken: asNumber(row.trades_taken),
  wins: asNumber(row.wins),
  losses: asNumber(row.losses),
  flatCloses: asNumber(row.flat_closes),
  winRate: row.win_rate === null || row.win_rate === undefined ? null : Number(row.win_rate),
  totalPnlPoints: Number(row.total_pnl_points || 0),
  defensiveHolds: asNumber(row.defensive_holds),
  icEvents: asNumber(row.ic_events),
});

const calloutRowToTimelineItem = (row: D1CalloutRow): TimelineItem => ({
  id: row.id,
  date: row.date,
  ordinal: Number(row.ordinal),
  time: row.time_et,
  timestamp: row.timestamp_text,
  price: row.price === null || row.price === undefined ? null : Number(row.price),
  action: row.action,
  reasoning: row.reasoning,
  pnl: row.pnl === null || row.pnl === undefined ? null : Number(row.pnl),
  status: row.status,
  eventType: row.event_type,
  positionSide: row.position_side,
  relatedEntryId: row.related_entry_id,
  rawJson: row.raw_json,
});

export const auditRowToPayload = (row: D1AuditRow | null): AuditPayload | null => {
  if (!row || !row.report) return null;

  let learnedRules: string[] = [];
  try {
    const parsed = JSON.parse(row.learned_rules_json || "[]");
    if (Array.isArray(parsed)) {
      learnedRules = parsed.filter((rule: unknown): rule is string => typeof rule === "string");
    }
  } catch {
    learnedRules = [];
  }

  return {
    date: row.date,
    generatedAt: row.generated_at,
    report: row.report,
    learnedRules,
    actionLogSize: row.action_log_size,
  };
};

const buildDayStatements = (db: D1DatabaseLike, normalized: NormalizedRecapDay, sourceUpdatedAt: string) => {
  const { summary } = normalized;
  const statements = [
    db.prepare(`
      INSERT INTO spx_days (
        date, total_callouts, trades_taken, wins, losses, flat_closes, win_rate,
        total_pnl_points, defensive_holds, ic_events, first_callout_at, last_callout_at,
        source_updated_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_callouts = excluded.total_callouts,
        trades_taken = excluded.trades_taken,
        wins = excluded.wins,
        losses = excluded.losses,
        flat_closes = excluded.flat_closes,
        win_rate = excluded.win_rate,
        total_pnl_points = excluded.total_pnl_points,
        defensive_holds = excluded.defensive_holds,
        ic_events = excluded.ic_events,
        first_callout_at = excluded.first_callout_at,
        last_callout_at = excluded.last_callout_at,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at
    `).bind(
      normalized.date,
      summary.totalCallouts,
      summary.tradesTaken,
      summary.wins,
      summary.losses,
      summary.flatCloses,
      summary.winRate,
      summary.totalPnlPoints,
      summary.defensiveHolds,
      summary.icEvents,
      normalized.firstCalloutAt,
      normalized.lastCalloutAt,
      sourceUpdatedAt,
      sourceUpdatedAt,
      sourceUpdatedAt,
    ),
    db.prepare("DELETE FROM spx_callouts WHERE date = ?").bind(normalized.date),
  ];

  for (const item of normalized.timeline) {
    statements.push(
      db.prepare(`
        INSERT INTO spx_callouts (
          id, date, ordinal, time_et, timestamp_text, price, action, reasoning, pnl,
          status, event_type, position_side, related_entry_id, raw_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.id,
        item.date,
        item.ordinal,
        item.time,
        item.timestamp,
        item.price,
        item.action,
        item.reasoning,
        item.pnl,
        item.status,
        item.eventType,
        item.positionSide,
        item.relatedEntryId,
        item.rawJson,
        sourceUpdatedAt,
        sourceUpdatedAt,
      ),
    );
  }

  return statements;
};

const buildAuditStatements = (db: D1DatabaseLike, audit: AuditPayload, updatedAt: string) => {
  const learnedRulesJson = JSON.stringify(audit.learnedRules);
  const statements = [
    db.prepare(`
      INSERT INTO spx_audits (
        date, report, learned_rules_json, action_log_size, generated_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        report = excluded.report,
        learned_rules_json = excluded.learned_rules_json,
        action_log_size = excluded.action_log_size,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
    `).bind(
      audit.date,
      audit.report,
      learnedRulesJson,
      audit.actionLogSize,
      audit.generatedAt,
      updatedAt,
      updatedAt,
    ),
  ];

  for (const rule of audit.learnedRules) {
    const ruleHash = stableHash(rule);
    statements.push(
      db.prepare(`
        INSERT INTO spx_wisdom_rules (id, source_date, rule_hash, rule_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_date, rule_hash) DO UPDATE SET
          rule_text = excluded.rule_text,
          updated_at = excluded.updated_at
      `).bind(`${audit.date}-${ruleHash}`, audit.date, ruleHash, rule, updatedAt, updatedAt),
    );
  }

  return statements;
};

const runStatements = async (db: D1DatabaseLike, statements: D1PreparedStatementLike[]) => {
  if (db.batch) {
    await db.batch(statements);
    return;
  }

  for (const statement of statements) {
    await statement.run();
  }
};

export const upsertRecapDay = async (
  db: D1DatabaseLike,
  date: string,
  memory: DailyMemory,
  audit?: AuditPayload | null,
) => {
  const updatedAt = nowIso();
  const normalized = normalizeRecapDay(date, memory);
  const statements = buildDayStatements(db, normalized, updatedAt);

  if (audit) {
    statements.push(...buildAuditStatements(db, audit, updatedAt));
  }

  await runStatements(db, statements);
  return normalized;
};

export const upsertRecapAudit = async (db: D1DatabaseLike, audit: AuditPayload) => {
  await runStatements(db, buildAuditStatements(db, audit, nowIso()));
};

export const upsertAgentSignalOutcome = async (db: D1DatabaseLike, outcome: AgentSignalOutcome) => {
  const updatedAt = nowIso();
  await db.prepare(`
    INSERT INTO spx_agent_signal_outcomes (
      run_id, date, time_et, agent_key, decision, confidence, rule_verdict,
      data_quality_json, entry_spx,
      outcome_5m, outcome_15m, outcome_30m, success_15m,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      decision = excluded.decision,
      confidence = excluded.confidence,
      rule_verdict = excluded.rule_verdict,
      data_quality_json = excluded.data_quality_json,
      entry_spx = excluded.entry_spx,
      outcome_5m = excluded.outcome_5m,
      outcome_15m = excluded.outcome_15m,
      outcome_30m = excluded.outcome_30m,
      success_15m = excluded.success_15m,
      updated_at = excluded.updated_at
  `).bind(
    outcome.runId,
    outcome.date,
    outcome.timeEt,
    outcome.agentKey,
    outcome.decision,
    outcome.confidence,
    outcome.ruleVerdict,
    JSON.stringify(outcome.dataQuality ?? null),
    outcome.entrySpx,
    outcome.outcome5m ?? null,
    outcome.outcome15m ?? null,
    outcome.outcome30m ?? null,
    outcome.success15m == null ? null : outcome.success15m ? 1 : 0,
    updatedAt,
    updatedAt,
  ).run();
};

export const readPendingAgentSignalOutcomes = async (db: D1DatabaseLike, date: string) => {
  const result = await db.prepare(`
    SELECT run_id, date, time_et, agent_key, decision, entry_spx
    FROM spx_agent_signal_outcomes
    WHERE date = ? AND success_15m IS NULL
    ORDER BY time_et ASC
  `).bind(date).all<{
    run_id: string;
    date: string;
    time_et: string;
    agent_key: string;
    decision: string;
    entry_spx: number;
  }>();
  return (result.results || []).map((row): PendingAgentSignalOutcome => ({
    runId: row.run_id,
    date: row.date,
    timeEt: row.time_et,
    agentKey: row.agent_key,
    decision: row.decision,
    entrySpx: Number(row.entry_spx),
  }));
};

export const updateAgentSignalOutcomeResults = async (
  db: D1DatabaseLike,
  runId: string,
  outcome: { outcome5m?: number | null; outcome15m?: number | null; outcome30m?: number | null; success15m?: boolean | null },
) => {
  await db.prepare(`
    UPDATE spx_agent_signal_outcomes
    SET outcome_5m = COALESCE(?, outcome_5m),
        outcome_15m = COALESCE(?, outcome_15m),
        outcome_30m = COALESCE(?, outcome_30m),
        success_15m = COALESCE(?, success_15m),
        updated_at = ?
    WHERE run_id = ?
  `).bind(
    outcome.outcome5m ?? null,
    outcome.outcome15m ?? null,
    outcome.outcome30m ?? null,
    outcome.success15m == null ? null : outcome.success15m ? 1 : 0,
    nowIso(),
    runId,
  ).run();
};

const defaultAgentWeight = (): AgentCalibrationWeight => ({
  sampleCount: 0,
  successCount: 0,
  hitRate: null,
  weight: 1,
});

const calibrationWeightFromHitRate = (sampleCount: number, successCount: number): AgentCalibrationWeight => {
  if (sampleCount < 20) {
    return {
      sampleCount,
      successCount,
      hitRate: sampleCount > 0 ? Number((successCount / sampleCount).toFixed(2)) : null,
      weight: 1,
    };
  }
  const hitRate = Number((successCount / sampleCount).toFixed(2));
  const weight = Math.max(0.7, Math.min(1.3, Number((1 + (hitRate - 0.5)).toFixed(2))));
  return { sampleCount, successCount, hitRate, weight };
};

export const readAgentCalibrationWeights = async (db: D1DatabaseLike) => {
  const result = await db.prepare(`
    SELECT agent_key, COUNT(*) AS sample_count, SUM(success_15m) AS success_count
    FROM spx_agent_signal_outcomes
    WHERE success_15m IS NOT NULL
    GROUP BY agent_key
  `).all<{ agent_key: string; sample_count: number; success_count: number | null }>();
  const weights: Record<"QM" | "CM" | "NT" | "PA", AgentCalibrationWeight> = {
    QM: defaultAgentWeight(),
    CM: defaultAgentWeight(),
    NT: defaultAgentWeight(),
    PA: defaultAgentWeight(),
  };
  for (const row of result.results || []) {
    const key = String(row.agent_key || "").toUpperCase();
    if (key === "QM" || key === "CM" || key === "NT" || key === "PA") {
      weights[key] = calibrationWeightFromHitRate(Number(row.sample_count || 0), Number(row.success_count || 0));
    }
  }
  return weights;
};

export const listD1AvailableDates = async (db: D1DatabaseLike) => {
  const result = await db.prepare("SELECT date FROM spx_days ORDER BY date DESC").all<{ date: string }>();
  return (result.results || []).map((row) => row.date);
};

export const readD1RecapDay = async (db: D1DatabaseLike, date: string): Promise<D1RecapPayload | null> => {
  const dayRow = await db.prepare("SELECT * FROM spx_days WHERE date = ?").bind(date).first<D1DayRow>();
  if (!dayRow) return null;

  const callouts = await db
    .prepare("SELECT * FROM spx_callouts WHERE date = ? ORDER BY ordinal ASC")
    .bind(date)
    .all<D1CalloutRow>();
  const auditRow = await db.prepare("SELECT * FROM spx_audits WHERE date = ?").bind(date).first<D1AuditRow>();
  const timeline = (callouts.results || []).map(calloutRowToTimelineItem);

  return {
    day: {
      date,
      summary: dayRowToSummary(dayRow),
      timeline,
      firstCalloutAt: dayRow.first_callout_at,
      lastCalloutAt: dayRow.last_callout_at,
    },
    audit: auditRowToPayload(auditRow),
  };
};

export const readD1Analytics = async (db: D1DatabaseLike, fromDate: string, toDate: string) => {
  const daysResult = await db
    .prepare("SELECT * FROM spx_days WHERE date BETWEEN ? AND ? ORDER BY date ASC")
    .bind(fromDate, toDate)
    .all<D1DayRow>();
  const rulesResult = await db
    .prepare("SELECT source_date, rule_text FROM spx_wisdom_rules WHERE source_date BETWEEN ? AND ? ORDER BY source_date DESC, created_at DESC LIMIT 20")
    .bind(fromDate, toDate)
    .all<{ source_date: string; rule_text: string }>();

  const days: DayAnalyticsItem[] = (daysResult.results || []).map((row) => ({
    date: row.date,
    ...dayRowToSummary(row),
    firstCalloutAt: row.first_callout_at,
    lastCalloutAt: row.last_callout_at,
  }));

  const summary = buildSummary(
    days.flatMap((day) =>
      Array.from({ length: day.totalCallouts }, (_, index): TimelineItem => ({
        id: `${day.date}-analytics-${index}`,
        date: day.date,
        ordinal: index + 1,
        time: "--:--",
        timestamp: null,
        price: null,
        action: "",
        reasoning: "",
        pnl: null,
        status: "pending",
        eventType: "unknown",
        positionSide: "NONE",
        relatedEntryId: null,
        rawJson: "{}",
      })),
    ),
  );

  return {
    days,
    summary: {
      ...summary,
      totalCallouts: days.reduce((sum, day) => sum + day.totalCallouts, 0),
      tradesTaken: days.reduce((sum, day) => sum + day.tradesTaken, 0),
      wins: days.reduce((sum, day) => sum + day.wins, 0),
      losses: days.reduce((sum, day) => sum + day.losses, 0),
      flatCloses: days.reduce((sum, day) => sum + day.flatCloses, 0),
      totalPnlPoints: Number(days.reduce((sum, day) => sum + day.totalPnlPoints, 0).toFixed(2)),
      defensiveHolds: days.reduce((sum, day) => sum + day.defensiveHolds, 0),
      icEvents: days.reduce((sum, day) => sum + day.icEvents, 0),
      winRate: (() => {
        const wins = days.reduce((sum, day) => sum + day.wins, 0);
        const losses = days.reduce((sum, day) => sum + day.losses, 0);
        return wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null;
      })(),
    },
    learnedRules: (rulesResult.results || []).map((row) => ({
      sourceDate: row.source_date,
      text: row.rule_text,
    })),
  };
};
