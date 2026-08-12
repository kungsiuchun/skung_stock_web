import { determineMarketBreadthFreshness } from "../../src/lib/market-breadth";
import { readMarketBreadthRelease, type MarketBreadthObjectStore } from "../../src/lib/market-breadth-r2";

interface Context {
  request: Request;
  env: { MARKET_BREADTH_DATA?: MarketBreadthObjectStore };
  now?: Date;
}

const json = (body: unknown, status: number, cacheControl = "no-store") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
  },
});

export async function onRequest(context: Context) {
  if (context.request.method !== "GET") {
    return json({ status: "ERROR", errorCode: "METHOD_NOT_ALLOWED", message: "Only GET is supported." }, 405);
  }
  const bucket = context.env.MARKET_BREADTH_DATA;
  if (!bucket) {
    return json({
      status: "ERROR",
      errorCode: "MARKET_BREADTH_R2_BINDING_MISSING",
      message: "Market breadth storage is not configured.",
    }, 503);
  }

  try {
    const { status, snapshot } = await readMarketBreadthRelease(bucket);
    if (!snapshot) {
      return json({
        status: "EMPTY",
        errorCode: "INITIAL_BACKFILL_REQUIRED",
        message: "Market breadth initial backfill has not published a snapshot yet.",
      }, 404);
    }
    const freshness = determineMarketBreadthFreshness({
      generatedAt: snapshot.generatedAt,
      priceAsOf: snapshot.priceAsOf,
      now: context.now,
      latestFailure: status?.lastAttempt.status === "FAILED" || status?.lastAttempt.status === "PARTIAL"
        ? { failedAt: status.lastAttempt.finishedAt, errorClass: status.lastAttempt.errorClass || status.lastAttempt.status }
        : null,
    });
    return json({ ...snapshot, status: "READY", freshness }, 200, "public, max-age=60, stale-while-revalidate=300");
  } catch (error) {
    return json({
      status: "ERROR",
      errorCode: "MARKET_BREADTH_READ_FAILED",
      message: "Stored market breadth data failed contract validation.",
    }, 500);
  }
}
