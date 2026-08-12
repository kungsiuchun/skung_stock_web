import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ExternalLink, RefreshCw } from "lucide-react";
import type {
  BreadthCell,
  MarketBreadthRow,
  MarketBreadthSnapshot,
  SectorPerformanceRow,
  Sma200SlopeRow,
} from "@/lib/market-breadth";

interface MarketBreadthPageProps {
  onBackToWork: () => void;
}

type ReadyPayload = MarketBreadthSnapshot & {
  status: "READY";
  freshness: {
    status: "FRESH" | "STALE";
    reason: string;
    failedAt?: string;
    errorClass?: string;
  };
};

type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection };

const formatDate = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${value}T00:00:00Z`));

const formatTimestamp = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
}).format(new Date(value));

const formatPercent = (value: number | null, digits = 2) => value === null
  ? "—"
  : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;

const strengthClass = (value: number | null, neutralBand = 0) => {
  if (value === null || Math.abs(value) <= neutralBand) return "text-zinc-400";
  return value > 0 ? "text-emerald-400" : "text-rose-400";
};

const breadthClass = (value: number | null) => {
  if (value === null) return "text-zinc-500";
  if (value >= 60) return "text-emerald-400";
  if (value < 40) return "text-rose-400";
  return "text-zinc-300";
};

const sortedRows = <T,>(rows: T[], sort: SortState, valueFor: (row: T, key: string) => string | number | null) =>
  [...rows].sort((left, right) => {
    const leftValue = valueFor(left, sort.key);
    const rightValue = valueFor(right, sort.key);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const result = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
    return sort.direction === "asc" ? result : -result;
  });

const nextSort = (current: SortState, key: string): SortState => ({
  key,
  direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
});

export function MarketBreadthPage({ onBackToWork }: MarketBreadthPageProps) {
  const [data, setData] = useState<ReadyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [performanceSort, setPerformanceSort] = useState<SortState>({ key: "weightPct", direction: "desc" });
  const [breadthSort, setBreadthSort] = useState<SortState>({ key: "sector", direction: "asc" });
  const [slopeSort, setSlopeSort] = useState<SortState>({ key: "session200", direction: "desc" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmpty(false);
    try {
      const response = await fetch("/api/market-breadth", { headers: { Accept: "application/json" } });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("json")) throw new Error("Market breadth API returned a non-JSON response.");
      const payload = await response.json() as ReadyPayload | { status?: string; message?: string; errorCode?: string };
      if (response.status === 404 && payload.status === "EMPTY") {
        setData(null);
        setEmpty(true);
        return;
      }
      if (!response.ok || payload.status !== "READY") {
        const failure = payload as { message?: string; errorCode?: string };
        throw new Error(failure.message || failure.errorCode || `Market breadth API returned HTTP ${response.status}.`);
      }
      setData(payload as ReadyPayload);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const performanceRows = useMemo(() => sortedRows(
    data?.sectorPerformance.rows || [],
    performanceSort,
    (row, key) => key === "sector" ? row.sector : row[key as keyof SectorPerformanceRow] as number | null,
  ), [data, performanceSort]);
  const breadthRows = useMemo(() => sortedRows(
    data?.breadth.rows || [],
    breadthSort,
    (row, key) => key === "sector" ? row.sector : row.windows[key as keyof MarketBreadthRow["windows"]].pct,
  ), [data, breadthSort]);
  const slopeRows = useMemo(() => sortedRows(
    data?.sma200Slope.rows || [],
    slopeSort,
    (row, key) => key === "sector" ? row.sector : row.windows[key as keyof Sma200SlopeRow["windows"]],
  ), [data, slopeSort]);

  return (
    <section className="h-full overflow-y-auto overscroll-contain bg-[#0d0f10] px-4 py-5 font-mono text-zinc-100 sm:px-7 lg:px-10">
      <div className="mx-auto w-full max-w-[1540px]">
        <header className="border-b border-zinc-700 pb-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <button type="button" onClick={onBackToWork} className="mb-5 inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:text-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                <ArrowLeft className="h-3.5 w-3.5" /> Market Lab
              </button>
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-amber-500">Market internals / SPY universe</p>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.055em] text-zinc-100 sm:text-4xl">S&amp;P 500 MARKET BREADTH</h1>
              <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">
                Daily participation, sector leadership, and long-term trend strength. Values are derived EOD metrics, not intraday signals.
              </p>
            </div>
            <button type="button" disabled={loading} onClick={() => void load()} className="inline-flex w-fit items-center gap-2 border border-amber-500/70 bg-amber-500/10 px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-amber-400 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh view
            </button>
          </div>

          {data && (
            <div className="mt-5">
              <div className="grid grid-cols-2 gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-4 lg:grid-cols-5">
                <Meta label="Price date" value={formatDate(data.priceAsOf)} />
                <Meta label="Holdings date" value={formatDate(data.holdingsAsOf)} />
                <Meta label="Constituents" value={String(data.universeCount)} />
                <Meta label="SMA200 coverage" value={`${data.coverage.constituent200DayPct.toFixed(1)}%`} />
                <div className="col-span-2 bg-[#111416] px-3 py-3 sm:col-span-4 lg:col-span-1">
                  <p className="text-[0.58rem] font-bold uppercase tracking-[0.13em] text-zinc-600">Freshness</p>
                  <p className={`mt-1 text-xs font-black ${data.freshness.status === "FRESH" ? "text-emerald-400" : "text-amber-400"}`}>{data.freshness.status}</p>
                </div>
              </div>
              <p className="border-x border-b border-zinc-800 bg-[#111416] px-3 py-2 text-[0.6rem] leading-4 text-zinc-500">
                Sources: {data.sources.map((source) => `${source.provider} — ${source.role}`).join(" · ")}
              </p>
            </div>
          )}
        </header>

        {loading && <LoadingState />}
        {!loading && empty && <StatusPanel tone="empty" title="Initial backfill required" message="No READY market breadth snapshot exists yet. Run the authorized initial backfill before publishing this page." onRetry={load} />}
        {!loading && error && <StatusPanel tone="error" title="Market breadth unavailable" message={error} onRetry={load} />}

        {!loading && data && (
          <main className="space-y-5 py-6">
            {data.freshness.status === "STALE" && (
              <div className="border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-200" role="status">
                <span className="font-black">STALE SNAPSHOT</span> — showing the last successful {formatDate(data.priceAsOf)} close.
                {data.freshness.failedAt ? ` Latest refresh failed ${formatTimestamp(data.freshness.failedAt)}.` : ""}
                {data.freshness.errorClass ? ` Safe failure class: ${data.freshness.errorClass}.` : ""}
              </div>
            )}

            <Panel title="Sector Performance / Weight / Proxy Contribution" subtitle={`SPY 1D ${formatPercent(data.sectorPerformance.benchmark.oneDay)} · proxy gap ${formatPercent(data.sectorPerformance.reconciliationGapPctPoints, 3)} pp`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] border-collapse text-left text-xs" data-testid="sector-performance-table">
                  <thead><tr>
                    <SortableHeader label="Sector" sortKey="sector" sort={performanceSort} onSort={setPerformanceSort} sticky />
                    <SortableHeader label="Weight" sortKey="weightPct" sort={performanceSort} onSort={setPerformanceSort} numeric />
                    <SortableHeader label="Contrib 1D" sortKey="contribution1dPctPoints" sort={performanceSort} onSort={setPerformanceSort} numeric />
                    <SortableHeader label="1D" sortKey="oneDay" sort={performanceSort} onSort={setPerformanceSort} numeric />
                    <SortableHeader label="1W" sortKey="oneWeek" sort={performanceSort} onSort={setPerformanceSort} numeric />
                    <SortableHeader label="1M" sortKey="oneMonth" sort={performanceSort} onSort={setPerformanceSort} numeric />
                    <SortableHeader label="3M" sortKey="threeMonths" sort={performanceSort} onSort={setPerformanceSort} numeric />
                    <SortableHeader label="YTD" sortKey="yearToDate" sort={performanceSort} onSort={setPerformanceSort} numeric />
                  </tr></thead>
                  <tbody>
                    <tr className="border-y-2 border-zinc-500 bg-zinc-900/80 font-black">
                      <th className="sticky left-0 z-10 bg-zinc-900 px-3 py-2.5">S&amp;P 500 <span className="ml-2 text-zinc-600">SPY</span></th>
                      <td className="px-3 py-2.5 text-right tabular-nums">100.00%</td><td className="px-3 py-2.5 text-right text-zinc-500">—</td>
                      {(["oneDay", "oneWeek", "oneMonth", "threeMonths", "yearToDate"] as const).map((key) => <ValueCell key={key} value={data.sectorPerformance.benchmark[key]} />)}
                    </tr>
                    {performanceRows.map((row) => <tr key={row.etf} className="border-t border-zinc-800 hover:bg-zinc-900/70">
                      <th className="sticky left-0 z-10 bg-[#111416] px-3 py-2.5 font-bold group-hover:bg-zinc-900"><span>{row.sector}</span><span className="ml-2 text-zinc-600">{row.etf}</span></th>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">{row.weightPct.toFixed(2)}%</td>
                      <ValueCell value={row.contribution1dPctPoints} suffix=" pp" digits={3} />
                      <ValueCell value={row.oneDay} /><ValueCell value={row.oneWeek} /><ValueCell value={row.oneMonth} /><ValueCell value={row.threeMonths} /><ValueCell value={row.yearToDate} />
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid gap-5 xl:grid-cols-2">
              <Panel title="Market Breadth by Sector" subtitle="% of eligible constituents closing above each moving average">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-left text-xs" data-testid="breadth-table">
                    <thead><tr>
                      <SortableHeader label="Sector" sortKey="sector" sort={breadthSort} onSort={setBreadthSort} sticky />
                      {([5, 20, 50, 100, 200] as const).map((period) => <SortableHeader key={period} label={`> SMA${period}`} sortKey={`sma${period}`} sort={breadthSort} onSort={setBreadthSort} numeric />)}
                    </tr></thead>
                    <tbody>{breadthRows.map((row) => <tr key={row.sector} className="border-t border-zinc-800 hover:bg-zinc-900/70">
                      <th className="sticky left-0 z-10 bg-[#111416] px-3 py-2.5 font-bold">{row.sector}<span className="ml-2 text-zinc-600">{row.holdingCount}</span></th>
                      {(["sma5", "sma20", "sma50", "sma100", "sma200"] as const).map((key) => <BreadthValueCell key={key} cell={row.windows[key]} />)}
                    </tr>)}</tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="SMA200 Slope by Sector" subtitle="% change in each sector ETF's SMA200 over trading-session windows">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-left text-xs" data-testid="sma-slope-table">
                    <thead><tr>
                      <SortableHeader label="Sector" sortKey="sector" sort={slopeSort} onSort={setSlopeSort} sticky />
                      {([5, 20, 50, 100, 200] as const).map((period) => <SortableHeader key={period} label={`${period}D`} sortKey={`session${period}`} sort={slopeSort} onSort={setSlopeSort} numeric />)}
                    </tr></thead>
                    <tbody>{slopeRows.map((row) => <tr key={row.etf} className="border-t border-zinc-800 hover:bg-zinc-900/70">
                      <th className="sticky left-0 z-10 bg-[#111416] px-3 py-2.5 font-bold">{row.sector}<span className="ml-2 text-zinc-600">{row.etf}</span></th>
                      {(["session5", "session20", "session50", "session100", "session200"] as const).map((key) => <ValueCell key={key} value={row.windows[key]} />)}
                    </tr>)}</tbody>
                  </table>
                </div>
              </Panel>
            </div>

            <footer className="border-t border-zinc-800 pt-4 text-[0.65rem] leading-5 text-zinc-600">
              <p>Generated {formatTimestamp(data.generatedAt)} · Missing constituent history is excluded from the eligible denominator, never counted as below.</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {data.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-amber-400">
                  {source.provider}: {source.label}<ExternalLink className="h-3 w-3" />
                </a>)}
              </div>
              {data.warnings.length > 0 && <ul className="mt-3 list-disc pl-5 text-amber-300/80">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
            </footer>
          </main>
        )}
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#111416] px-3 py-3"><p className="text-[0.58rem] font-bold uppercase tracking-[0.13em] text-zinc-600">{label}</p><p className="mt-1 text-xs font-black text-zinc-200">{value}</p></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="overflow-hidden border border-zinc-800 bg-[#111416] shadow-[0_18px_45px_rgba(0,0,0,0.25)]">
    <div className="border-b border-zinc-800 px-3 py-3 sm:px-4"><h2 className="text-[0.72rem] font-black uppercase tracking-[0.12em] text-amber-500">{title}</h2><p className="mt-1 text-[0.62rem] leading-4 text-zinc-600">{subtitle}</p></div>
    {children}
  </section>;
}

function SortableHeader({ label, sortKey, sort, onSort, numeric = false, sticky = false }: { label: string; sortKey: string; sort: SortState; onSort: (sort: SortState) => void; numeric?: boolean; sticky?: boolean }) {
  const active = sort.key === sortKey;
  const Icon = active ? sort.direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th className={`bg-zinc-900 px-3 py-2.5 text-[0.61rem] font-black uppercase tracking-[0.08em] text-zinc-500 ${numeric ? "text-right" : "text-left"} ${sticky ? "sticky left-0 z-20" : ""}`}>
    <button type="button" onClick={() => onSort(nextSort(sort, sortKey))} className={`inline-flex items-center gap-1 hover:text-amber-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${numeric ? "ml-auto" : ""}`}>
      {label}<Icon className="h-3 w-3" />
    </button>
  </th>;
}

function ValueCell({ value, suffix = "%", digits = 2 }: { value: number | null; suffix?: string; digits?: number }) {
  return <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${strengthClass(value)}`}>{value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`}</td>;
}

function BreadthValueCell({ cell }: { cell: BreadthCell }) {
  return <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${breadthClass(cell.pct)}`} title={`${cell.above} above / ${cell.eligible} eligible / ${cell.total} total`}>
    {cell.pct === null ? "—" : `${cell.pct.toFixed(1)}%`}<span className="ml-1 text-[0.55rem] font-normal text-zinc-700">{cell.above}/{cell.eligible}</span>
  </td>;
}

function LoadingState() {
  return <div className="animate-pulse space-y-5 py-6" aria-label="Loading market breadth"><div className="h-80 border border-zinc-800 bg-zinc-900/50" /><div className="grid gap-5 xl:grid-cols-2"><div className="h-96 border border-zinc-800 bg-zinc-900/50" /><div className="h-96 border border-zinc-800 bg-zinc-900/50" /></div></div>;
}

function StatusPanel({ tone, title, message, onRetry }: { tone: "empty" | "error"; title: string; message: string; onRetry: () => Promise<void> }) {
  const errorTone = tone === "error";
  return <div className={`mt-7 border p-6 ${errorTone ? "border-rose-500/60 bg-rose-500/10" : "border-amber-500/50 bg-amber-500/10"}`}>
    <p className={`text-xs font-black uppercase tracking-[0.14em] ${errorTone ? "text-rose-400" : "text-amber-400"}`}>{title}</p>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">{message}</p>
    <button type="button" onClick={() => void onRetry()} className="mt-5 border border-zinc-500 px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.13em] text-zinc-200 hover:border-amber-400 hover:text-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">Retry</button>
  </div>;
}
