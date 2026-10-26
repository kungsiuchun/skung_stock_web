import { determineMarketBreadthFreshness } from "../../src/lib/market-breadth";
import { MARKET_BREADTH_STATUS_KEY, readJsonObject, validateMarketBreadthStatus, resolveMarketBreadthUnresolvedFailure, type MarketBreadthObjectStore } from "../../src/lib/market-breadth-r2";
import { validateMarketContext } from "../../src/lib/market-context";
import { PublicResearchLimitError } from "../../src/lib/public-research-budget";

export async function onRequest({ request, env, now }: { request: Request; env: { MARKET_BREADTH_DATA?: MarketBreadthObjectStore }; now?: Date }) {
  const json = (body: unknown, status: number, cache = "no-store") => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
  if (request.method !== "GET") return json({ message: "Only GET is supported." }, 405);
  if (!env.MARKET_BREADTH_DATA) return json({ message: "Market summary storage is unavailable." }, 503);
  try {
    const raw = await readJsonObject(env.MARKET_BREADTH_DATA, MARKET_BREADTH_STATUS_KEY);
    if (!raw) return json({ message: "Market summary has not been published." }, 404);
    const status = validateMarketBreadthStatus(raw);
    if (!status.current?.contextKey) return json({ message: "The next market publication must include the compact summary." }, 404);
    const snapshot = validateMarketContext(await readJsonObject(env.MARKET_BREADTH_DATA, status.current.contextKey));
    if (snapshot.snapshotId !== status.current.snapshotId || snapshot.priceAsOf !== status.current.priceAsOf || snapshot.holdingsAsOf !== status.current.holdingsAsOf || snapshot.generatedAt !== status.current.publishedAt) throw new Error("Market summary pointer mismatch.");
    const failed = resolveMarketBreadthUnresolvedFailure(status);
    const freshness = determineMarketBreadthFreshness({ generatedAt: snapshot.generatedAt, priceAsOf: snapshot.priceAsOf, now,
      latestFailure: failed ? { failedAt: failed.finishedAt, errorClass: failed.errorClass || failed.status } : null });
    return json({ ...snapshot, freshness }, 200, "public, max-age=60");
  } catch (error) { return error instanceof PublicResearchLimitError ? json({ message: error.message }, error.status) : json({ message: "Published market summary failed validation." }, 502); }
}
