export const STOCKS_WATCHER_DEFAULT_SYMBOL = "NVDA";

const STOCKS_WATCHER_SYMBOL_PATTERN = /^[A-Z0-9.^-]{1,12}$/;

export function normalizeStocksWatcherRouteSymbol(value: string | null | undefined): string | null {
  const symbol = (value || "").trim().toUpperCase();
  return STOCKS_WATCHER_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function getStocksWatcherInitialSymbolFromHash(hash: string): string {
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) return STOCKS_WATCHER_DEFAULT_SYMBOL;

  const params = new URLSearchParams(hash.slice(queryStart + 1));
  return normalizeStocksWatcherRouteSymbol(params.get("symbol")) || STOCKS_WATCHER_DEFAULT_SYMBOL;
}
