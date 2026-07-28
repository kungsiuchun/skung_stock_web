export type SpxDecisionRunStatus = "SKIPPED" | "SUCCEEDED" | "FAILED";

export interface SpxDecisionRunResult {
  status: SpxDecisionRunStatus;
  runId: string | null;
  failureCode: string | null;
}

export interface SpxDecisionRunInput {
  isTradingWindow: boolean;
  skipReason: string | null;
  execute?: () => Promise<SpxDecisionRunResult>;
}

/**
 * The scheduler-facing decision-run seam. It owns the market-window gate;
 * the injected execution adapter owns market data, Council/CIO, Risk Gate,
 * persistence and delivery. Keeping those authorities behind this one seam
 * makes a skipped slot impossible to turn into a stale replay.
 */
export async function runSpxDecisionRun(input: SpxDecisionRunInput): Promise<SpxDecisionRunResult> {
  if (!input.isTradingWindow) {
    return { status: "SKIPPED", runId: null, failureCode: null };
  }

  if (!input.execute) throw new Error("SPX Decision Run requires an execution adapter during the trading window");
  return input.execute();
}
