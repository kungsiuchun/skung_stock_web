// Verified zero prompt/completion prices from https://openrouter.ai/api/v1/models
// Catalogue checked 2026-10-25T10:24:42.153Z. Unknown identities fail closed; no runtime catalogue requests.
export const VERIFIED_FREE_RESEARCH_MODELS = [
  {
    "id": "recursive/flint-v1.0:free",
    "canonical": "recursive/flint-v1.0-20261021"
  },
  {
    "id": "xingchen-agi/xing4.0-29b-a4b:free",
    "canonical": "xingchen-agi/xing4.0-29b-a4b-20261015"
  },
  {
    "id": "nvidia/nemotron-3.5-super-vl:free",
    "canonical": "nvidia/nemotron-3.5-super-vl-20261015"
  },
  {
    "id": "dots-studio/dots-3-note-preview:free",
    "canonical": "dots-studio/dots-3-note-preview-20260813"
  },
  {
    "id": "liquid/lfm-2.5-2.6b:free",
    "canonical": "liquid/lfm-2.5-2.6b-20260811"
  },
  {
    "id": "nvidia/nemotron-3.5-lightning:free",
    "canonical": "nvidia/nemotron-3.5-lightning-20260807"
  },
  {
    "id": "thinkingmachines/inkling-small:free",
    "canonical": "thinkingmachines/inkling-small-20260730"
  },
  {
    "id": "poolside/laguna-s-2.1:free",
    "canonical": "poolside/laguna-s-2.1-20260720"
  },
  {
    "id": "thinkingmachines/inkling:free",
    "canonical": "thinkingmachines/inkling-20260715"
  },
  {
    "id": "poolside/laguna-xs-2.1:free",
    "canonical": "poolside/laguna-xs-2.1-20260625"
  },
  {
    "id": "cohere/north-mini-code:free",
    "canonical": "cohere/north-mini-code-20260617"
  },
  {
    "id": "nvidia/nemotron-3.5-content-safety:free",
    "canonical": "nvidia/nemotron-3.5-content-safety-20260604"
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "canonical": "nvidia/nemotron-3-ultra-550b-a55b-20260604"
  },
  {
    "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "canonical": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning-20260428"
  },
  {
    "id": "google/gemma-4-26b-a4b-it:free",
    "canonical": "google/gemma-4-26b-a4b-it-20260403"
  },
  {
    "id": "google/gemma-4-31b-it:free",
    "canonical": "google/gemma-4-31b-it-20260402"
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b:free",
    "canonical": "nvidia/nemotron-3-super-120b-a12b-20230311"
  },
  {
    "id": "openrouter/free",
    "canonical": "openrouter/free"
  }
] as const;

export function isVerifiedFreeResearchModel(value: unknown, requested?: string): value is string {
  if (typeof value !== "string") return false;
  return VERIFIED_FREE_RESEARCH_MODELS.some(row => row.id !== "openrouter/free" && (!requested || requested === "openrouter/free" || row.id === requested) && [row.id, row.canonical, row.id.replace(/:free$/, "")].includes(value));
}

export const isVerifiedFreeResearchRequest = (value: string) => VERIFIED_FREE_RESEARCH_MODELS.some(row => row.id === value);
