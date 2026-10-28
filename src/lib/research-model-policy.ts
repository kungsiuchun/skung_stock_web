import { isVerifiedFreeResearchModel, isVerifiedFreeResearchRequest } from "./free-research-models";

// Official model/endpoint metadata checked 2026-10-28. Only this paid model is approved.
export const PUBLIC_RESEARCH_MODEL = "openai/gpt-6-luna";
export const PUBLIC_RESEARCH_MAX_TOKENS = 1536;
export const PUBLIC_RESEARCH_DAILY_MICRO_USD = 100_000;

export function researchModelPolicy(model: string) {
  if (model === PUBLIC_RESEARCH_MODEL) return { paid: true };
  if (isVerifiedFreeResearchRequest(model)) return { paid: false };
  return null;
}

export function isVerifiedResearchModel(value: unknown, requested?: string): value is string {
  return ((!requested || requested === PUBLIC_RESEARCH_MODEL) &&
    (value === PUBLIC_RESEARCH_MODEL || value === "openai/gpt-6-luna-20260922")) ||
    isVerifiedFreeResearchModel(value, requested);
}

/** UTF-8 bytes bound text tokens; include schema/template overhead, cache writes
 * ($0.125/M input), max output ($0.50/M), and a 20% margin. No refund or settlement.
 * The 64KB request ceiling also stays below the long-context pricing threshold. */
export function researchCostReservation(payload: string) {
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > 64 * 1024) throw new Error("The research request exceeds its cost limit.");
  return Math.ceil((bytes + 4096) * 0.15 + PUBLIC_RESEARCH_MAX_TOKENS * 0.6);
}
