import type { D1BudgetDecision } from "../../src/lib/d1-free-tier-budget";
import { reserveSpxD1Budget, type SpxD1BudgetReservation } from "../../src/lib/spx-d1-budget";
import type { D1DatabaseLike } from "../../src/lib/spx-recap-d1";

const safeQuota = (decision: D1BudgetDecision) => ({
  database: decision.database,
  reason: decision.reason,
  projectedRowsRead: decision.projectedRowsRead,
  projectedRowsWritten: decision.projectedRowsWritten,
  readHeadroom: decision.readHeadroom,
  writeHeadroom: decision.writeHeadroom,
  resetsAtUtc: decision.resetsAtUtc,
});

/** Fail closed before an uncached SPX origin path can exceed its site allocation. */
export const reserveSpxApiBudget = async (
  db: D1DatabaseLike,
  reservation: SpxD1BudgetReservation,
) => {
  const decision = await reserveSpxD1Budget(db, reservation);
  console.log(JSON.stringify({
    event: "d1_budget_reservation",
    database: decision.database,
    operation: reservation.operation,
    reservedRowsRead: reservation.rowsRead,
    reservedRowsWritten: reservation.rowsWritten,
    allow: decision.allow,
    denyReason: decision.allow ? null : decision.reason,
    projectedRowsRead: decision.projectedRowsRead,
    projectedRowsWritten: decision.projectedRowsWritten,
    resetsAtUtc: decision.resetsAtUtc,
  }));
  if (decision.allow) return null;
  const unavailable = decision.reason === "quota_store_unavailable" || decision.reason === "quota_state_invalid";
  return new Response(JSON.stringify({
    status: unavailable ? "STORAGE_UNAVAILABLE" : "D1_SAFETY_CUTOFF",
    errorCode: unavailable ? "D1_QUOTA_STORE_UNAVAILABLE" : "D1_SAFETY_CUTOFF",
    error: unavailable
      ? "D1 quota state cannot be verified; the request was not executed."
      : "This request is blocked by the site D1 safety allocation before the UTC reset.",
    quota: safeQuota(decision),
  }), {
    status: unavailable ? 503 : 429,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
