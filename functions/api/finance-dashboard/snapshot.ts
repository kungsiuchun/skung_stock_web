import { onRequestPost as runAgentChat } from "../agent/chat";
import { onRequest as getFundamentals } from "../fundamentals";
import { onRequest as getNews } from "../news";
import { onRequest as getSentiment } from "../sentiment";
import { onRequest as getTechnicalRadar } from "../technical-radar";
import { onRequest as getVix } from "../vix";
import { buildFinanceDashboardSnapshot } from "../../../src/lib/finance-dashboard-snapshot";
import { MarketCacheQuotaExceededError, resolveMarketCache } from "../../../src/lib/market-data-cache";
import type { D1DatabaseLike } from "../../../src/lib/spx-recap-d1";
import { reserveMarketCacheRefreshQuota } from "../../../src/lib/stocks-watcher-refresh-quota";

interface Env {
  MARKET_CACHE_DB?: D1DatabaseLike;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  ADANOS_API_KEY?: string;
  FRED_API_KEY?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
});

const parseJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    throw new Error(`Expected JSON response, received HTTP ${response.status}.`);
  }
};

const requestFor = (request: Request, path: string, init?: RequestInit) =>
  new Request(new URL(path, request.url), init);

const validSymbol = (value: unknown) => {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) throw new Error("Invalid stock symbol.");
  return symbol;
};

export async function onRequestPost(context: { request: Request; env: Env }) {
  let body: { symbol?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Expected a JSON request body." }, 400);
  }

  let symbol: string;
  try {
    symbol = validSymbol(body.symbol);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  try {
    const resolved = await resolveMarketCache({
      db: context.env.MARKET_CACHE_DB,
      scope: "finance-dashboard-snapshot",
      symbol,
      params: { symbol, quantStrategySchemaVersion: "v3" },
      refreshQuotaGuard: context.env.MARKET_CACHE_DB
        ? () => reserveMarketCacheRefreshQuota(context.env.MARKET_CACHE_DB!, { operation: "finance_dashboard" })
        : undefined,
      load: async () => {
        const agentRequest = requestFor(context.request, "/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            surface: "finance_dashboard",
            message: `分析 ${symbol}。先使用 get_realtime_quote、get_options_chain、run_algorithmic_strategy（strategy_name=all），然後輸出完整繁體中文 Dashboard 報告。`,
            history: [],
          }),
        });
        const symbolPath = encodeURIComponent(symbol);
        const [agentResponse, newsResponse, vixResponse, fundamentalsResponse, technicalResponse, sentimentResponse] = await Promise.all([
          runAgentChat({ request: agentRequest, env: context.env } as any),
          getNews({ request: requestFor(context.request, `/api/news?symbol=${symbolPath}`), env: context.env }),
          getVix({ request: requestFor(context.request, "/api/vix"), env: context.env }),
          getFundamentals({ request: requestFor(context.request, `/api/fundamentals?symbol=${symbolPath}`), env: context.env }),
          getTechnicalRadar({ request: requestFor(context.request, `/api/technical-radar?symbol=${symbolPath}`), env: context.env }),
          getSentiment({ request: requestFor(context.request, `/api/sentiment?symbol=${symbolPath}`), env: context.env }),
        ]);
        const [agent, news, vix, fundamentals, technical, sentiment] = await Promise.all([
          parseJson(agentResponse),
          parseJson(newsResponse),
          parseJson(vixResponse),
          parseJson(fundamentalsResponse),
          parseJson(technicalResponse),
          parseJson(sentimentResponse),
        ]);
        if (!agentResponse.ok || !agent.success) {
          throw new Error(typeof agent.error === "string" ? agent.error : `Dashboard agent failed with HTTP ${agentResponse.status}.`);
        }
        return buildFinanceDashboardSnapshot({ symbol, agent, news, vix, fundamentals, technical, sentiment });
      },
    });

    return json({ data: resolved.value, cache: resolved.cache }, resolved.cache.status === "stale" ? 206 : 200);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof MarketCacheQuotaExceededError ? "D1_SAFETY_CUTOFF" : null,
    }, error instanceof MarketCacheQuotaExceededError ? 429 : 502);
  }
}
