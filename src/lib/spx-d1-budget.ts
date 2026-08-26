import { D1_DATABASE_BUDGETS, evaluateD1Budget, type D1BudgetDecision, type D1BudgetUsage } from "./d1-free-tier-budget";
import type { D1DatabaseLike } from "./spx-recap-d1";

export interface SpxD1BudgetReservation {
  operation: string;
  rowsRead: number;
  rowsWritten: number;
}

interface SpxD1BudgetRow {
  utc_day: string;
  rows_read: number;
  rows_written: number;
  last_deny_reason: string | null;
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const unavailable = (dayUtc: string, reason: "quota_state_invalid" | "quota_store_unavailable"): D1BudgetDecision => ({
  ...evaluateD1Budget({
    database: "SPX_RECAP_DB",
    currentUtcDay: dayUtc,
    usage: { dayUtc, rowsRead: 0, rowsWritten: 0 },
  }),
  allow: false,
  blocked: true,
  reason,
});

const usageFrom = (row: SpxD1BudgetRow): D1BudgetUsage | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.utc_day)
    || !Number.isInteger(row.rows_read) || row.rows_read < 0
    || !Number.isInteger(row.rows_written) || row.rows_written < 0) return null;
  return {
    dayUtc: row.utc_day,
    rowsRead: row.rows_read,
    rowsWritten: row.rows_written,
    lastDenyReason: row.last_deny_reason,
  };
};

export class SpxD1SafetyCutoffError extends Error {
  constructor(public readonly decision: D1BudgetDecision) {
    super(`SPX D1 safety cutoff: ${decision.reason}.`);
    this.name = "SpxD1SafetyCutoffError";
  }
}

/**
 * Reserves bounded SPX_RECAP_DB work atomically before an origin request.
 * The row is a site guard only; it is not Cloudflare's account-level meter.
 */
export const reserveSpxD1Budget = async (
  db: D1DatabaseLike,
  reservation: SpxD1BudgetReservation,
  now = new Date(),
): Promise<D1BudgetDecision> => {
  const dayUtc = utcDay(now);
  const budget = D1_DATABASE_BUDGETS.SPX_RECAP_DB;
  if (!/^[a-z0-9_.-]{1,80}$/i.test(reservation.operation)
    || !Number.isInteger(reservation.rowsRead) || reservation.rowsRead < 0
    || !Number.isInteger(reservation.rowsWritten) || reservation.rowsWritten < 0) {
    return unavailable(dayUtc, "quota_state_invalid");
  }
  const initialDecision = evaluateD1Budget({
    database: "SPX_RECAP_DB",
    currentUtcDay: dayUtc,
    usage: { dayUtc, rowsRead: 0, rowsWritten: 0 },
    rowsRead: reservation.rowsRead,
    rowsWritten: reservation.rowsWritten,
  });
  if (!initialDecision.allow) return initialDecision;
  try {
    const row = await db.prepare(`
      INSERT INTO spx_d1_budget_state (
        utc_day, rows_read, rows_written, last_operation, last_deny_reason, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(utc_day) DO UPDATE SET
        rows_read = spx_d1_budget_state.rows_read + ?,
        rows_written = spx_d1_budget_state.rows_written + ?,
        last_operation = ?,
        last_deny_reason = NULL,
        updated_at = ?
      WHERE spx_d1_budget_state.rows_read < ?
        AND spx_d1_budget_state.rows_written < ?
      RETURNING utc_day, rows_read, rows_written, last_deny_reason
    `).bind(
      dayUtc,
      reservation.rowsRead,
      reservation.rowsWritten,
      reservation.operation,
      now.toISOString(),
      reservation.rowsRead,
      reservation.rowsWritten,
      reservation.operation,
      now.toISOString(),
      budget.rowsRead - reservation.rowsRead,
      budget.rowsWritten - reservation.rowsWritten,
    ).first<SpxD1BudgetRow>();
    if (row) {
      const usage = usageFrom(row);
      return usage
        ? evaluateD1Budget({
          database: "SPX_RECAP_DB",
          currentUtcDay: dayUtc,
          usage: {
            ...usage,
            rowsRead: usage.rowsRead - reservation.rowsRead,
            rowsWritten: usage.rowsWritten - reservation.rowsWritten,
          },
          rowsRead: reservation.rowsRead,
          rowsWritten: reservation.rowsWritten,
        })
        : unavailable(dayUtc, "quota_state_invalid");
    }
    const current = await db.prepare(`
      SELECT utc_day, rows_read, rows_written, last_deny_reason
      FROM spx_d1_budget_state
      WHERE utc_day = ?
      LIMIT 1
    `).bind(dayUtc).first<SpxD1BudgetRow>();
    const usage = current ? usageFrom(current) : null;
    if (!usage) return unavailable(dayUtc, "quota_state_invalid");
    const decision = evaluateD1Budget({
      database: "SPX_RECAP_DB",
      currentUtcDay: dayUtc,
      usage,
      rowsRead: reservation.rowsRead,
      rowsWritten: reservation.rowsWritten,
    });
    return { ...decision, allow: false, blocked: true };
  } catch {
    return unavailable(dayUtc, "quota_store_unavailable");
  }
};
