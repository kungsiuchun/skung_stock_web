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
  // This endpoint declares JSON mode, not native constrained JSON Schema.
  const jsonMode = model === "google/gemma-4-31b-it:free";
  const schemaText = schema ? JSON.stringify(schema) : "";
  const requestMessages = jsonMode && schema ? [{ role: "system", content: `${messages[0]?.role === "system" ? messages[0].content + "\n" : ""}Write compact JSON with literal Unicode characters, no Markdown or unnecessary whitespace. Required JSON schema: ${schemaText}` }, ...messages.slice(messages[0]?.role === "system" ? 1 : 0)] : messages;
  const format = structured ? schema && !jsonMode ? { type: "json_schema", json_schema: { name: "research_report", strict: true, schema } } : { type: "json_object" } : undefined;
  const schemaHash = schema ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(schemaText))), b => b.toString(16).padStart(2, "0")).join("") : null;
  const payload = { model, max_tokens: 1536, temperature: 0, ...(model === "openrouter/free" ? {} : { reasoning: { enabled: false } }), messages: requestMessages, provider: { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: false, require_parameters: true }, ...(format ? { response_format: format } : {}) };
  const requestProof = { model: payload.model, format: payload.response_format?.type || "text", schemaHash, maxTokens: payload.max_tokens, temperature: payload.temperature, reasoningDisabled: payload.reasoning?.enabled === false, provider: payload.provider };
  try {
    const { response, text } = await fetchBoundedText("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      body: JSON.stringify(payload),
    }, 128 * 1024, 45_000);
    if (!response.ok) {
      let error: { error?: { metadata?: { raw?: unknown } } } | null = null;
      try { error = JSON.parse(text); } catch { /* Non-JSON provider errors retain only their HTTP status. */ }
      const raw = error?.error?.metadata?.raw;
      let upstreamStatus: unknown;
      if (typeof raw === "string") { try { upstreamStatus = JSON.parse(raw).status; } catch { /* Provider text is not retained. */ } }
      // Provider error strings can echo submitted questions or credentials.
      console.error(JSON.stringify({ event: "public_research_provider_error", request: requestProof, status: response.status,
        upstreamStatus: typeof upstreamStatus === "number" && Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599 ? upstreamStatus : undefined }));
      throw new PublicResearchLimitError(response.status === 429 ? "The free model provider has reached its allowance. No retry was sent." : `The free model provider is unavailable (HTTP ${response.status}). No retry was sent.`, response.status === 429 ? 429 : 502);
    }
    const data = JSON.parse(text) as { id?: string; provider?: string; choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; model?: string; usage?: { cost?: unknown; cost_details?: { upstream_inference_cost?: unknown }; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
    if (!isVerifiedFreeResearchModel(data.model, model)) throw new Error("The provider returned an unverified model identity; output rejected.");
    if (typeof data.usage?.cost !== "number" || !Number.isFinite(data.usage.cost) || data.usage.cost !== 0) throw new Error("The free provider did not prove zero cost; output rejected.");
    const upstreamCost = data.usage.cost_details?.upstream_inference_cost;
    if (upstreamCost !== undefined && upstreamCost !== null && (typeof upstreamCost !== "number" || !Number.isFinite(upstreamCost) || upstreamCost !== 0)) throw new Error("The provider reported an unverified upstream cost; output rejected.");
    const content = data.choices?.[0]?.message?.content;
    const completionTokens = data.usage?.completion_tokens, reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    const receipt = { request: requestProof, model: data.model, generationId: typeof data.id === "string" && /^gen-\d{10,16}-[A-Za-z0-9]{6,80}$/.test(data.id) ? data.id : undefined, provider: ["Google AI Studio", "Nvidia", "AtlasCloud", "Phala"].includes(data.provider || "") ? data.provider : undefined, finishReason: ["stop", "length", "tool_calls", "content_filter", "error"].includes(data.choices?.[0]?.finish_reason || "") ? data.choices?.[0]?.finish_reason : undefined, contentLength: typeof content === "string" ? content.length : 0, completionTokens: typeof completionTokens === "number" && Number.isSafeInteger(completionTokens) && completionTokens >= 0 ? completionTokens : undefined, reasoningTokens: typeof reasoningTokens === "number" && Number.isSafeInteger(reasoningTokens) && reasoningTokens >= 0 ? reasoningTokens : undefined, cost: data.usage.cost };
    if (typeof content !== "string" || !content.trim() || content.length > 24000 || data.choices?.[0]?.finish_reason === "length") {
      console.error(JSON.stringify({ event: "public_research_invalid_output", ...receipt, startsWithJsonObject: typeof content === "string" && /^\s*\{/.test(content), containsThinkingTag: typeof content === "string" && /<think(?:ing)?>/i.test(content) }));
      throw new Error(data.choices?.[0]?.finish_reason === "length" ? "The free model exhausted its output budget. No retry was sent." : "The free model returned empty or oversized content. No retry was sent.");
    }
    console.info(JSON.stringify({ event: "public_research_model_response", ...receipt }));
    return { content, model: data.model, quota };
  } catch (error) {
    if (error instanceof BoundedBodyError) throw new PublicResearchLimitError(error.kind === "timeout" ? "The free model timed out. No retry was sent." : "The free provider response exceeded its size limit. No retry was sent.", error.kind === "timeout" ? 504 : 502);
    throw error;
  }
}
