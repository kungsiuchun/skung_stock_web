import type { D1DatabaseLike } from "../../../src/lib/spx-recap-d1";
import { reservePublicAiAttempt, PublicResearchLimitError } from "../../../src/lib/public-research-budget";

export interface FreeResearchEnv { MARKET_CACHE_DB?: D1DatabaseLike; OPENROUTER_API_KEY?: string; PUBLIC_RESEARCH_MODEL?: string; OPENROUTER_MODEL?: string }
export async function callFreeResearchModel(env: FreeResearchEnv, messages: Array<{ role: string; content: string }>, structured = false, schema?: Record<string, unknown>) {
  if (env.PUBLIC_RESEARCH_MODEL && env.PUBLIC_RESEARCH_MODEL !== "openrouter/free" && !env.PUBLIC_RESEARCH_MODEL.endsWith(":free")) throw new PublicResearchLimitError("Public research is paused: a paid model configuration is not permitted.", 503);
  if (!env.OPENROUTER_API_KEY) throw new PublicResearchLimitError("The free research assistant is not configured. Market data and plans remain available.", 503);
  const model = env.PUBLIC_RESEARCH_MODEL || "openrouter/free";
  const quota = await reservePublicAiAttempt(env.MARKET_CACHE_DB);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model, max_tokens: 1536, ...(model === "openrouter/free" ? {} : { reasoning: { enabled: false } }), messages, provider: { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: false }, ...(structured ? { response_format: schema ? { type: "json_schema", json_schema: { name: "research_report", strict: true, schema } } : { type: "json_object" } } : {}) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: { message?: unknown; metadata?: { provider_name?: string; raw?: unknown } } } | null;
      const message = typeof error?.error?.message === "string" ? error.error.message.replaceAll(env.OPENROUTER_API_KEY, "[redacted]").slice(0, 250) : "No provider detail";
      const raw = error?.error?.metadata?.raw;
      let upstreamStatus: unknown; let upstreamTitle: unknown;
      if (typeof raw === "string") { try { const parsed = JSON.parse(raw); upstreamStatus = parsed.status; upstreamTitle = parsed.title; } catch { /* Provider text is not retained. */ } }
      console.error(JSON.stringify({ event: "public_research_provider_error", status: response.status, detail: message, provider: error?.error?.metadata?.provider_name,
        upstreamStatus: typeof upstreamStatus === "number" ? upstreamStatus : undefined, upstreamTitle: typeof upstreamTitle === "string" ? upstreamTitle.slice(0, 80) : undefined }));
      throw new PublicResearchLimitError(response.status === 429 ? "The free model provider has reached its allowance. No retry was sent." : `The free model provider is unavailable (HTTP ${response.status}). No retry was sent.`, response.status === 429 ? 429 : 502);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; model?: string; usage?: { cost?: unknown; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
    if (typeof data.usage?.cost !== "number" || !Number.isFinite(data.usage.cost) || data.usage.cost !== 0) throw new Error("The free provider did not prove zero cost; output rejected.");
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim() || content.length > 24000 || data.choices?.[0]?.finish_reason === "length") {
      console.error(JSON.stringify({ event: "public_research_invalid_output", model: data.model, finishReason: data.choices?.[0]?.finish_reason, contentLength: typeof content === "string" ? content.length : 0, completionTokens: data.usage?.completion_tokens, reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens }));
      throw new Error(data.choices?.[0]?.finish_reason === "length" ? "The free model exhausted its output budget. No retry was sent." : "The free model returned empty or oversized content. No retry was sent.");
    }
    return { content, model: data.model || model, quota };
  } catch (error) {
    if (controller.signal.aborted) throw new PublicResearchLimitError("The free model timed out. No retry was sent.", 504);
    throw error;
  } finally { clearTimeout(timer); }
}
