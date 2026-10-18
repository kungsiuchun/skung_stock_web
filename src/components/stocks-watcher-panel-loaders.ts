import type { FomcRateProbabilityResponse } from "../lib/fomc-rate-probability";
import type { MarketCacheMetadata } from "../lib/market-data-cache";
import { parseJsonResponse } from "../lib/safe-json-response";
import type { StocksWatcherMacroSnapshot } from "../lib/stocks-watcher-macro";
import type { TreasuryYieldCurveResponse } from "../lib/treasury-yield-curve";

export interface StocksWatcherMacroApiResponse {
  data?: StocksWatcherMacroSnapshot;
  cache?: MarketCacheMetadata;
  error?: string;
}

const requestUrl = (path: string, bypassBrowserCache: boolean) =>
  `${path}${bypassBrowserCache ? `?_=${Date.now()}` : ""}`;

export const loadStocksWatcherMacro = async (
  fetchImpl: typeof fetch,
  bypassBrowserCache = false,
): Promise<StocksWatcherMacroApiResponse & { data: StocksWatcherMacroSnapshot }> => {
  const url = requestUrl("/api/stocks-watcher-macro", bypassBrowserCache);
  const response = await fetchImpl(url, bypassBrowserCache ? { cache: "no-store" } : undefined);
  const payload = await parseJsonResponse<StocksWatcherMacroApiResponse>(response, url, { allowHttpError: true });
  if (!response.ok) throw new Error(payload.error || `Macro API failed with HTTP ${response.status}.`);
  if (!payload.data) throw new Error("Macro API response did not include data.");
  return payload as StocksWatcherMacroApiResponse & { data: StocksWatcherMacroSnapshot };
};

export const loadStocksWatcherTreasury = async (
  fetchImpl: typeof fetch,
  bypassCache = false,
): Promise<TreasuryYieldCurveResponse> => {
  const url = requestUrl("/api/treasury-yield-curve", bypassCache);
  const response = await fetchImpl(url, bypassCache ? { cache: "no-store" } : undefined);
  const payload = await parseJsonResponse<TreasuryYieldCurveResponse & { error?: string }>(response, url, { allowHttpError: true });
  if (!response.ok) throw new Error(payload.error || `Fixed Income API failed with HTTP ${response.status}.`);
  return payload;
};

export const loadStocksWatcherFomc = async (
  fetchImpl: typeof fetch,
  bypassCache = false,
): Promise<FomcRateProbabilityResponse> => {
  const url = requestUrl("/api/fomc-rate-probability", bypassCache);
  const response = await fetchImpl(url, bypassCache ? { cache: "no-store" } : undefined);
  const payload = await parseJsonResponse<FomcRateProbabilityResponse & { error?: string }>(response, url, { allowHttpError: true });
  if (!response.ok) throw new Error(payload.error || `FOMC probability API failed with HTTP ${response.status}.`);
  return payload;
};
