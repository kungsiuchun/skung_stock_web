import type { D1DatabaseLike } from "../../../src/lib/spx-recap-d1";
import { reservePublicAiAttempt, PublicResearchLimitError } from "../../../src/lib/public-research-budget";
import { BoundedBodyError, fetchBoundedText } from "../../../src/lib/bounded-body";
import { isVerifiedFreeResearchModel, isVerifiedFreeResearchRequest } from "../../../src/lib/free-research-models";

export interface FreeResearchEnv { MARKET_CACHE_DB?: D1DatabaseLike; OPENROUTER_API_KEY?: string; PUBLIC_RESEARCH_MODEL?: string; OPENROUTER_MODEL?: string }
export async function callFreeResearchModel(env: FreeResearchEnv, messages: Array<{ role: string; content: string }>, structured = false, schema?: Record<string, unknown>) {
  const model = env.PUBLIC_RESEARCH_MODEL || "openrouter/free";
  if (!isVerifiedFreeResearchRequest(model)) throw new PublicResearchLimitError("Public research is paused: the configured model is not verified free.", 503);
  if (!env.OPENROUTER_API_KEY) throw new PublicResearchLimitError("The free research assistant is not configured.", 503);
  const quota = await reservePublicAiAttempt(env.MARKET_CACHE_DB);
  try {
    const { response, text } = await fetchBoundedText("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model, max_tokens: 1536, ...(model === "openrouter/free" ? {} : { reasoning: { enabled: false } }), messages, provider: { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: false }, ...(structured ? { response_format: schema ? { type: "json_schema", json_schema: { name: "research_report", strict: true, schema } } : { type: "json_object" } } : {}) }),
    }, 128 * 1024, 45_000);
    if (!response.ok) {
      let error: { error?: { message?: unknown; metadata?: { provider_name?: string; raw?: unknown } } } | null = null;
      try { error = JSON.parse(text); } catch { /* Non-JSON provider errors retain only their HTTP status. */ }
      const message = typeof error?.error?.message === "string" ? error.error.message.replaceAll(env.OPENROUTER_API_KEY, "[redacted]").slice(0, 250) : "No provider detail";
      const raw = error?.error?.metadata?.raw;
      let upstreamStatus: unknown; let upstreamTitle: unknown;
      if (typeof raw === "string") { try { const parsed = JSON.parse(raw); upstreamStatus = parsed.status; upstreamTitle = parsed.title; } catch { /* Provider text is not retained. */ } }
      console.error(JSON.stringify({ event: "public_research_provider_error", status: response.status, detail: message, provider: error?.error?.metadata?.provider_name,
        upstreamStatus: typeof upstreamStatus === "number" ? upstreamStatus : undefined, upstreamTitle: typeof upstreamTitle === "string" ? upstreamTitle.slice(0, 80) : undefined }));
      throw new PublicResearchLimitError(response.status === 429 ? "The free model provider has reached its allowance. No retry was sent." : `The free model provider is unavailable (HTTP ${response.status}). No retry was sent.`, response.status === 429 ? 429 : 502);
    }
    const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; model?: string; usage?: { cost?: unknown; cost_details?: { upstream_inference_cost?: unknown }; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
    if (!isVerifiedFreeResearchModel(data.model, model)) throw new Error("The provider returned an unverified model identity; output rejected.");
    if (typeof data.usage?.cost !== "number" || !Number.isFinite(data.usage.cost) || data.usage.cost !== 0) throw new Error("The free provider did not prove zero cost; output rejected.");
    const upstreamCost = data.usage.cost_details?.upstream_inference_cost;
    if (upstreamCost !== undefined && upstreamCost !== null && (typeof upstreamCost !== "number" || !Number.isFinite(upstreamCost) || upstreamCost !== 0)) throw new Error("The provider reported an unverified upstream cost; output rejected.");
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim() || content.length > 24000 || data.choices?.[0]?.finish_reason === "length") {
      console.error(JSON.stringify({ event: "public_research_invalid_output", model: data.model, finishReason: data.choices?.[0]?.finish_reason, contentLength: typeof content === "string" ? content.length : 0, completionTokens: data.usage?.completion_tokens, reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens }));
      throw new Error(data.choices?.[0]?.finish_reason === "length" ? "The free model exhausted its output budget. No retry was sent." : "The free model returned empty or oversized content. No retry was sent.");
    }
    return { content, model: data.model, quota };
  } catch (error) {
    if (error instanceof BoundedBodyError) throw new PublicResearchLimitError(error.kind === "timeout" ? "The free model timed out. No retry was sent." : "The free provider response exceeded its size limit. No retry was sent.", error.kind === "timeout" ? 504 : 502);
    throw error;
  }
}
