export const D1_FREE_TIER_DAILY_LIMITS = {
  rowsRead: 5_000_000,
  rowsWritten: 100_000,
} as const;

export const D1_SITE_GUARD_RATIO = 0.7;

export const D1_DATABASE_BUDGETS = {
  MARKET_CACHE_DB: {
    database: "MARKET_CACHE_DB",
    rowsRead: 1_000_000,
    rowsWritten: 20_000,
  },
  SPX_RECAP_DB: {
    database: "SPX_RECAP_DB",
    rowsRead: 2_500_000,
    rowsWritten: 50_000,
  },
} as const;

export type D1DatabaseBudgetName = keyof typeof D1_DATABASE_BUDGETS;
export type D1BudgetBlockReason =
  | "within_budget"
  | "utc_day_reset"
  | "read_threshold_exceeded"
  | "write_threshold_exceeded"
  | "invalid_observation"
  | "quota_state_invalid"
  | "quota_store_unavailable";

export interface D1BudgetUsage {
  dayUtc: string;
  rowsRead: number;
  rowsWritten: number;
  lastDenyReason?: string | null;
}

export interface D1BudgetDecision {
  allow: boolean;
  blocked: boolean;
  reason: D1BudgetBlockReason;
  database: D1DatabaseBudgetName;
  currentDayUtc: string;
  usageDayUtc: string;
  dayReset: boolean;
  observedRowsRead: number;
  observedRowsWritten: number;
  projectedRowsRead: number;
  projectedRowsWritten: number;
  readHeadroom: number;
  writeHeadroom: number;
  resetsAtUtc: string;
  lastDenyReason: string | null;
  blockedDimensions: Array<"read" | "write">;
}

export interface EvaluateD1BudgetInput {
  database: D1DatabaseBudgetName;
  currentUtcDay?: string | Date;
  usage?: D1BudgetUsage;
  rowsRead?: number;
  rowsWritten?: number;
}

const dayFrom = (value: string | Date | undefined) => {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

export const d1UtcResetAt = (dayUtc: string) => {
  const date = new Date(`${dayUtc}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "invalid";
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
};

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
  ? Math.floor(value)
  : null;

/**
 * This evaluates the site's internal allocation, not Cloudflare's account-wide
 * meter. A deny is therefore a safety cutoff, never proof that Cloudflare has
 * exhausted the account's free tier.
 */
export const evaluateD1Budget = (input: EvaluateD1BudgetInput): D1BudgetDecision => {
  const budget = D1_DATABASE_BUDGETS[input.database];
  const currentDayUtc = dayFrom(input.currentUtcDay);
  const usageDayUtc = input.usage?.dayUtc || currentDayUtc || "invalid";
  const usageRead = count(input.usage?.rowsRead ?? 0);
  const usageWritten = count(input.usage?.rowsWritten ?? 0);
  const observedRowsRead = count(input.rowsRead ?? 0);
  const observedRowsWritten = count(input.rowsWritten ?? 0);
  const invalid = !currentDayUtc || !/^\d{4}-\d{2}-\d{2}$/.test(usageDayUtc)
    || usageRead === null || usageWritten === null || observedRowsRead === null || observedRowsWritten === null;
  const dayReset = !invalid && usageDayUtc !== currentDayUtc;
  const baseRead = dayReset || invalid ? 0 : usageRead!;
  const baseWritten = dayReset || invalid ? 0 : usageWritten!;
  const projectedRowsRead = baseRead + (observedRowsRead ?? 0);
  const projectedRowsWritten = baseWritten + (observedRowsWritten ?? 0);
  const blockedDimensions: Array<"read" | "write"> = [];
  if (!invalid && projectedRowsRead >= budget.rowsRead) blockedDimensions.push("read");
  if (!invalid && projectedRowsWritten >= budget.rowsWritten) blockedDimensions.push("write");
  const reason: D1BudgetBlockReason = invalid
    ? "invalid_observation"
    : blockedDimensions.includes("read")
      ? "read_threshold_exceeded"
      : blockedDimensions.includes("write")
        ? "write_threshold_exceeded"
        : dayReset
          ? "utc_day_reset"
          : "within_budget";
  return {
    allow: !invalid && blockedDimensions.length === 0,
    blocked: invalid || blockedDimensions.length > 0,
    reason,
    database: input.database,
    currentDayUtc: currentDayUtc || "invalid",
    usageDayUtc,
    dayReset,
    observedRowsRead: observedRowsRead ?? 0,
    observedRowsWritten: observedRowsWritten ?? 0,
    projectedRowsRead,
    projectedRowsWritten,
    readHeadroom: Math.max(0, budget.rowsRead - projectedRowsRead),
    writeHeadroom: Math.max(0, budget.rowsWritten - projectedRowsWritten),
    resetsAtUtc: d1UtcResetAt(currentDayUtc || usageDayUtc),
    lastDenyReason: input.usage?.lastDenyReason || null,
    blockedDimensions,
  };
};

export interface D1DailyCostModel {
  name: string;
  database: D1DatabaseBudgetName;
  runs: number;
  rowsReadPerRun: number;
  rowsWrittenPerRun: number;
}

export const D1_DAILY_COST_MODELS: readonly D1DailyCostModel[] = [
  { name: "pressure_matrix_refresh", database: "SPX_RECAP_DB", runs: 390, rowsReadPerRun: 40, rowsWrittenPerRun: 10 },
  { name: "gex_heatmap_refresh", database: "SPX_RECAP_DB", runs: 390, rowsReadPerRun: 120, rowsWrittenPerRun: 10 },
  { name: "spx_collection_scheduler", database: "SPX_RECAP_DB", runs: 27, rowsReadPerRun: 150, rowsWrittenPerRun: 80 },
  { name: "robinhood_eod_status", database: "SPX_RECAP_DB", runs: 1, rowsReadPerRun: 50, rowsWrittenPerRun: 20 },
  { name: "watcher_cold_or_refresh", database: "MARKET_CACHE_DB", runs: 500, rowsReadPerRun: 23, rowsWrittenPerRun: 10 },
  { name: "finance_candlestick_backtest_refresh", database: "MARKET_CACHE_DB", runs: 500, rowsReadPerRun: 3, rowsWrittenPerRun: 10 },
  { name: "bounded_cache_maintenance", database: "MARKET_CACHE_DB", runs: 4, rowsReadPerRun: 100, rowsWrittenPerRun: 50 },
];

export const simulateD1DailyCosts = (models: readonly D1DailyCostModel[] = D1_DAILY_COST_MODELS) => {
  const totals = {
    MARKET_CACHE_DB: { rowsRead: 0, rowsWritten: 0 },
    SPX_RECAP_DB: { rowsRead: 0, rowsWritten: 0 },
  } as Record<D1DatabaseBudgetName, { rowsRead: number; rowsWritten: number }>;
  for (const model of models) {
    if (!Number.isInteger(model.runs) || model.runs < 0 || model.rowsReadPerRun < 0 || model.rowsWrittenPerRun < 0) {
      throw new Error(`Invalid D1 daily cost model: ${model.name}`);
    }
    totals[model.database].rowsRead += model.runs * model.rowsReadPerRun;
    totals[model.database].rowsWritten += model.runs * model.rowsWrittenPerRun;
  }
  const total = {
    rowsRead: totals.MARKET_CACHE_DB.rowsRead + totals.SPX_RECAP_DB.rowsRead,
    rowsWritten: totals.MARKET_CACHE_DB.rowsWritten + totals.SPX_RECAP_DB.rowsWritten,
  };
  return { totals, total };
};
