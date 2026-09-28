import { determineMarketBreadthFreshness } from "../../src/lib/market-breadth";
import { resolveMarketBreadthUnresolvedFailure, type MarketBreadthObjectStore } from "../../src/lib/market-breadth-r2";
import { readSectorRotationRelease } from "../../src/lib/sector-rotation-r2";

interface Context {
  request: Request;
  env: { MARKET_BREADTH_DATA?: MarketBreadthObjectStore };
  now?: Date;
}

const json = (body: unknown, status: number, cacheControl = "no-store") => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
});

export async function onRequest(context: Context) {
  if (context.request.method !== "GET") {
    return json({ status: "ERROR", errorCode: "METHOD_NOT_ALLOWED", message: "Only GET is supported." }, 405);
  }
  const bucket = context.env.MARKET_BREADTH_DATA;
  if (!bucket) {
    return json({ status: "ERROR", errorCode: "SECTOR_ROTATION_R2_BINDING_MISSING", message: "Sector rotation storage is not configured." }, 503);
  }
  try {
    const { status, snapshot } = await readSectorRotationRelease(bucket);
    if (!snapshot) {
      return json({ status: "EMPTY", errorCode: "SECTOR_ROTATION_INITIALIZATION_REQUIRED", message: "Sector rotation has not been published with a validated market breadth release yet." }, 404);
    }
    const unresolvedFailure = status ? resolveMarketBreadthUnresolvedFailure(status) : null;
    const freshness = determineMarketBreadthFreshness({
      generatedAt: snapshot.generatedAt,
      priceAsOf: snapshot.priceAsOf,
      now: context.now,
      latestFailure: unresolvedFailure
        ? { failedAt: unresolvedFailure.finishedAt, errorClass: unresolvedFailure.errorClass || unresolvedFailure.status }
        : null,
    });
    return json({ ...snapshot, status: "READY", freshness }, 200, "public, max-age=60, stale-while-revalidate=300");
  } catch {
    return json({ status: "ERROR", errorCode: "SECTOR_ROTATION_READ_FAILED", message: "Stored sector rotation data failed contract validation." }, 500);
  }
}
