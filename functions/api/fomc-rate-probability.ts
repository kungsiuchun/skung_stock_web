import {
  buildFomcRateProbabilityResponse,
  POLYMARKET_FOMC_DECISION_URL,
  type PolymarketFomcEvent,
} from "../../src/lib/fomc-rate-probability";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", ...(init.headers || {}) },
});

export async function onRequest() {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(POLYMARKET_FOMC_DECISION_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Polymarket returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) throw new Error(`Polymarket returned ${contentType || "unknown content type"}.`);
    const payload = await response.json() as { events?: unknown };
    if (!Array.isArray(payload.events)) throw new Error("Polymarket response is missing events.");
    return json(buildFomcRateProbabilityResponse({ events: payload.events as PolymarketFomcEvent[], fetchedAt }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `FOMC prediction-market source failed: ${message}`, sourceUrl: POLYMARKET_FOMC_DECISION_URL, fetchedAt }, { status: 502 });
  }
}
