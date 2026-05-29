import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ExternalLink,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import type {
  StocksWatcherChartMode,
  StocksWatcherSnapshot,
  StocksWatcherStrikeRow,
} from "@/lib/stocks-intelligence-watcher";

interface StocksIntelligenceWatcherPageProps {
  onBackToWork: () => void;
}

const DEFAULT_WATCHLIST = ["TSLA", "MU", "IREN"];

const formatNumber = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const currency = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

const toShortExpiry = (expiry: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return expiry.slice(2);
  return expiry;
};

const modeLabel: Record<StocksWatcherChartMode, string> = {
  oi: "Open Interest",
  volume: "Options Volume",
  gex: "Option GEX",
};

const getMaxForMode = (rows: StocksWatcherStrikeRow[], mode: StocksWatcherChartMode) =>
  Math.max(
    1,
    ...rows.flatMap((row) => {
      if (mode === "oi") return [row.callOpenInterest, row.putOpenInterest];
      if (mode === "volume") return [row.callVolume, row.putVolume];
      return [Math.abs(row.callGex), Math.abs(row.putGex)];
    }),
  );

const getCallValue = (row: StocksWatcherStrikeRow, mode: StocksWatcherChartMode) => {
  if (mode === "oi") return row.callOpenInterest;
  if (mode === "volume") return row.callVolume;
  return row.callGex;
};

const getPutValue = (row: StocksWatcherStrikeRow, mode: StocksWatcherChartMode) => {
  if (mode === "oi") return row.putOpenInterest;
  if (mode === "volume") return row.putVolume;
  return row.putGex;
};

export function StocksIntelligenceWatcherPage({ onBackToWork }: StocksIntelligenceWatcherPageProps) {
  const [selectedSymbol, setSelectedSymbol] = useState("TSLA");
  const [query, setQuery] = useState("TSLA");
  const [mode, setMode] = useState<StocksWatcherChartMode>("volume");
  const [snapshot, setSnapshot] = useState<StocksWatcherSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_WATCHLIST;
    const saved = window.localStorage.getItem("stocks-intelligence-favorites");
    return saved ? JSON.parse(saved) as string[] : DEFAULT_WATCHLIST;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("stocks-intelligence-favorites", JSON.stringify(favorites));
    }
  }, [favorites]);

  const loadSnapshot = async (symbol: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/stocks-intelligence-watcher?symbol=${encodeURIComponent(symbol)}`);
      const body = await response.json() as StocksWatcherSnapshot;
      setSnapshot(body);
      setSelectedSymbol(body.symbol);
      setQuery(body.symbol);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSnapshot(selectedSymbol);
  }, []);

  const watchlist = useMemo(() => {
    const merged = Array.from(new Set([...favorites, selectedSymbol, ...DEFAULT_WATCHLIST])).filter(Boolean);
    return merged.slice(0, 8);
  }, [favorites, selectedSymbol]);

  const submitSearch = () => {
    const nextSymbol = query.trim().toUpperCase();
    if (nextSymbol) void loadSnapshot(nextSymbol);
  };

  const toggleFavorite = (symbol: string) => {
    setFavorites((current) =>
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : [symbol, ...current].slice(0, 12),
    );
  };

  const isPositive = (snapshot?.quote.change || 0) >= 0;
  const rows = snapshot?.strikes || [];
  const maxValue = getMaxForMode(rows, mode);
  const focusedRows = rows.slice(Math.max(0, Math.floor(rows.length / 2) - 14), Math.min(rows.length, Math.floor(rows.length / 2) + 15));

  return (
    <section className="h-full w-full overflow-hidden bg-[#080d14] text-slate-100">
      <div className="grid h-full grid-cols-1 pt-2 lg:grid-cols-[28rem_minmax(0,1fr)]">
        <aside className="border-r border-slate-700/50 bg-[#070b11] px-5 pb-5 pt-4 lg:h-full">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBackToWork}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Work Gallery
            </button>
            <button
              type="button"
              onClick={() => snapshot && void loadSnapshot(snapshot.symbol)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-blue-400 hover:text-blue-300"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitSearch();
                }}
                className="h-10 w-full rounded-md border border-slate-700 bg-[#0b111a] pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-blue-400"
                placeholder="Search ticker or company..."
              />
            </label>
            <button
              type="button"
              onClick={submitSearch}
              className="rounded-md border border-blue-400/50 bg-blue-500/15 px-4 text-xs font-bold uppercase tracking-[0.14em] text-blue-100 transition-colors hover:bg-blue-500/25"
            >
              Load
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <select className="h-9 flex-1 rounded-md border border-slate-700 bg-[#0b111a] px-3 text-sm text-white outline-none">
              <option>All Sectors</option>
              <option>Technology</option>
              <option>Energy</option>
            </select>
            <select className="h-9 flex-1 rounded-md border border-slate-700 bg-[#0b111a] px-3 text-sm text-white outline-none">
              <option>All Types</option>
              <option>Favorites</option>
              <option>Options Active</option>
            </select>
          </div>

          <div className="mt-3 flex items-center gap-2 border-b border-slate-800 pb-3">
            <button className="rounded-full border border-slate-700 px-4 py-1.5 text-sm text-slate-200">All Stocks</button>
            <button className="rounded-full border border-blue-400/60 bg-blue-500/20 px-4 py-1.5 text-sm font-semibold text-blue-100">
              FAV ({favorites.length})
            </button>
            <button
              type="button"
              onClick={() => toggleFavorite(selectedSymbol)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-slate-300 hover:border-blue-400 hover:text-blue-200"
              title="Toggle favorite"
            >
              <Star className={`h-4 w-4 ${favorites.includes(selectedSymbol) ? "fill-blue-300 text-blue-300" : ""}`} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[2rem_1fr_5rem_5rem_5rem] items-center border-b border-slate-800 pb-2 text-xs font-bold text-slate-400">
            <span />
            <span>Ticker</span>
            <span>Price</span>
            <span>Chg</span>
            <span>Chg%</span>
          </div>

          <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
            {watchlist.map((symbol) => {
              const selected = symbol === selectedSymbol;
              const rowQuote = selected ? snapshot?.quote : null;
              const change = rowQuote?.change ?? (symbol === "TSLA" ? 1.74 : symbol === "MU" ? -4.89 : -3.79);
              const rowPositive = change >= 0;

              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => void loadSnapshot(symbol)}
                  className={`grid w-full grid-cols-[2rem_1fr_5rem_5rem_5rem] items-center border-b border-slate-800 py-3 text-left text-sm transition-colors hover:bg-slate-900 ${selected ? "border-b-blue-400 bg-blue-500/5" : ""}`}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-slate-500 bg-slate-950" />
                  <span className="font-black text-white">{symbol}</span>
                  <span>{rowQuote ? currency(rowQuote.price) : symbol === "MU" ? "$123.52" : symbol === "IREN" ? "$64.05" : "$442.10"}</span>
                  <span className={rowPositive ? "text-emerald-400" : "text-red-400"}>{rowPositive ? "+" : ""}{change.toFixed(2)}</span>
                  <span className={rowPositive ? "text-emerald-400" : "text-red-400"}>
                    {rowPositive ? "+" : ""}{(rowQuote?.changePercent ?? (rowPositive ? 0.4 : -0.53)).toFixed(2)}%
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex min-w-0 flex-col overflow-hidden px-6 pb-6 pt-4">
          <header className="flex flex-col gap-4 border-b border-slate-800 pb-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="text-3xl font-black tracking-normal text-white">{snapshot?.symbol || selectedSymbol}</h1>
                <span className="text-2xl font-black">{snapshot ? currency(snapshot.quote.price) : "--"}</span>
                {snapshot && (
                  <span className={`font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {isPositive ? "+" : ""}{snapshot.quote.change.toFixed(2)} ({isPositive ? "+" : ""}{snapshot.quote.changePercent.toFixed(2)}%)
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-blue-200/70">
                {snapshot?.quote.companyName || "Stocks Intelligence watcher"} · {snapshot?.quote.asOf || "loading"}
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-1">
              {["Chart", "Fundamentals", "Stats", "Earnings", "Holders", "SEC Filings", "Options", "Short Vol", "News"].map((item) => (
                <button
                  key={item}
                  className={`h-10 border px-4 text-xs font-bold uppercase tracking-[0.08em] transition-colors ${
                    item === "Options"
                      ? "border-blue-400/50 bg-blue-500/15 text-blue-200"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {item}
                </button>
              ))}
              <button className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-300" title="Open">
                <ExternalLink className="h-4 w-4" />
              </button>
              <button className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-300" title="Close">
                <X className="h-4 w-4" />
              </button>
            </nav>
          </header>

          <section className="mt-3 rounded-md border border-slate-700/70 bg-[#0b111a] p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
              <span>Spot: <strong className="text-yellow-300">{snapshot ? currency(snapshot.spot) : "--"}</strong></span>
              <span className="text-slate-500">·</span>
              <span>ATM: <strong className="text-blue-300">{snapshot?.atm.toFixed(1) || "--"}</strong></span>
              <span className="text-emerald-400">{snapshot?.selectedTimeLabel || "loading"}</span>
            </div>
            <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-3 text-xs text-blue-200/70">
              <span>9AM</span>
              <div className="relative h-2 rounded-full bg-blue-950">
                <div className="absolute inset-y-0 left-0 w-[88%] rounded-full bg-blue-400" />
                <div className="absolute right-[10%] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-blue-300 shadow-[0_0_18px_rgba(96,165,250,0.7)]" />
              </div>
              <span>4:50PM</span>
            </div>
          </section>

          <section className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[28rem_minmax(0,1fr)]">
            <div className="min-h-0 overflow-hidden rounded-md border border-slate-800 bg-[#0b111a]">
              <div className="grid grid-cols-[1fr_5rem_5rem_5rem_3rem] border-b border-slate-800 px-4 py-3 text-xs font-black text-blue-200">
                <span>Exp ↑</span>
                <span>OI</span>
                <span>Str</span>
                <span>Volume</span>
                <span>Type</span>
              </div>
              <div className="max-h-[calc(100vh-25rem)] overflow-y-auto px-4">
                {(snapshot?.expiries || []).map((row, index) => (
                  <div
                    key={`${row.expiry}-${row.strike}-${index}`}
                    className={`grid grid-cols-[1fr_5rem_5rem_5rem_3rem] border-b border-slate-800 py-2 text-sm font-bold ${index === 0 ? "border-b-blue-400" : ""}`}
                  >
                    <span>{toShortExpiry(row.expiry)}</span>
                    <span>{formatNumber(row.openInterest)}</span>
                    <span>{row.strike}</span>
                    <span>{formatNumber(row.volume)}</span>
                    <span className={row.type === "C" ? "text-emerald-400" : "text-red-400"}>{row.type}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-col rounded-md border border-slate-800 bg-[#0b111a]">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">GEX: {snapshot?.gexRegime || "--"}</span>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">P/C: {snapshot?.putCallOpenInterest.toFixed(2) || "--"}</span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-400">{snapshot?.sweeps || 0} sweeps</span>
              </div>

              <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-4">
                {(["oi", "volume", "gex"] as StocksWatcherChartMode[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setMode(item)}
                    className={`border-b-2 px-3 py-3 text-sm font-semibold ${mode === item ? "border-blue-400 text-blue-300" : "border-transparent text-slate-300 hover:text-white"}`}
                  >
                    {item === "oi" ? "OI" : item === "volume" ? "Vol" : "GEX"}
                  </button>
                ))}
                {["Split", "Profile", "Prem", "Smile", "Greeks", "Term", "MaxP", "Trend", "3D", "Chain", "Flow", "DEX", "IV", "Mis$", "P/C"].map((item) => (
                  <button key={item} className="px-3 py-3 text-sm font-semibold text-slate-300 hover:text-white">{item}</button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-blue-100">
                      {modeLabel[mode]} by Strike — calls (green) vs puts (red)
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Source: {snapshot?.source === "stocks_intelligence_mcp" ? "Stocks Intelligence MCP" : "demo fallback"} · drag-to-zoom visual replicated as fixed range for now
                    </p>
                  </div>
                  <span className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-300">
                    Updated {snapshot ? new Date(snapshot.generatedAt).toLocaleString() : "--"}
                  </span>
                </div>

                {error && <p className="mb-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
                {snapshot?.warnings.map((warning) => (
                  <p key={warning} className="mb-3 rounded-md border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
                    {warning}
                  </p>
                ))}

                <div className="relative h-[28rem] overflow-x-auto overflow-y-hidden border-b border-l border-slate-800">
                  <div className="absolute inset-x-0 top-1/2 border-t border-slate-700/70" />
                  <div className="flex h-full min-w-[72rem] items-end gap-2 px-8 pb-10 pt-8">
                    {focusedRows.map((row) => {
                      const callValue = Math.abs(getCallValue(row, mode));
                      const putValue = Math.abs(getPutValue(row, mode));
                      const callHeight = Math.max(2, (callValue / maxValue) * 42);
                      const putHeight = Math.max(2, (putValue / maxValue) * 42);
                      const isSpotStrike = Math.abs(row.strike - (snapshot?.spot || row.strike)) < ((snapshot?.spot || 1) * 0.01);

                      return (
                        <div key={row.strike} className="relative flex h-full min-w-8 flex-col items-center justify-end">
                          {isSpotStrike && (
                            <div className="absolute bottom-10 top-2 border-l-2 border-dashed border-yellow-300/80">
                              <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-xs font-black text-yellow-300">
                                Spot {snapshot?.spot.toFixed(2)}
                              </span>
                            </div>
                          )}
                          <div className="flex h-[calc(50%-2rem)] items-end gap-1">
                            <div
                              className="w-3 rounded-t-sm bg-emerald-500/80"
                              style={{ height: `${callHeight}%` }}
                              title={`Call ${formatNumber(callValue)}`}
                            />
                          </div>
                          <div className="h-px w-full bg-slate-700" />
                          <div className="flex h-[calc(50%-2rem)] items-start gap-1">
                            <div
                              className="w-3 rounded-b-sm bg-red-500/75"
                              style={{ height: `${putHeight}%` }}
                              title={`Put ${formatNumber(putValue)}`}
                            />
                          </div>
                          <span className="absolute bottom-1 text-[0.68rem] font-semibold text-slate-500">{row.strike}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold text-blue-100">
                      <BarChart3 className="h-4 w-4" />
                      MCP Tool Runs · {snapshot?.availableTools.length || 0} tools
                    </div>
                    <div className="max-h-28 overflow-y-auto text-xs text-slate-400">
                      {(snapshot?.toolRuns || []).map((run) => (
                        <p key={`${run.name}-${run.detail}`} className={run.status === "ok" ? "text-emerald-300/90" : "text-yellow-200/90"}>
                          {run.name}: {run.status}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 xl:col-span-2">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold text-blue-100">
                      <Building2 className="h-4 w-4" />
                      Market Context
                    </div>
                    <p className="text-xs leading-5 text-slate-400">{snapshot?.marketContext.breadth}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{snapshot?.marketContext.relativeStrength}</p>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 xl:col-span-3">
                    <div className="mb-2 text-sm font-bold text-blue-100">Stocks Intelligence Tool Catalog</div>
                    <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                      {(snapshot?.availableTools || []).map((tool) => (
                        <span
                          key={tool.name}
                          title={tool.description || tool.name}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[0.68rem] font-semibold text-slate-300"
                        >
                          {tool.name}
                        </span>
                      ))}
                      {snapshot?.availableTools.length === 0 && (
                        <span className="text-xs text-slate-500">Tool list unavailable in fallback mode.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}
