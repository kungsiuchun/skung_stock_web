import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import type { MacroInflationRow, StocksWatcherMacroSnapshot } from "@/lib/stocks-watcher-macro";
import "./stocks-watcher-macro-panel.css";

interface MacroApiResponse {
  data?: StocksWatcherMacroSnapshot;
  cache?: MarketCacheMetadata;
  error?: string;
}

const readPayload = async (response: Response, requestUrl: string) => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Macro API returned ${contentType || "unknown content type"} for ${requestUrl}.`);
  }
  try {
    return JSON.parse(text) as MacroApiResponse;
  } catch (error) {
    throw new Error(`Macro API returned invalid JSON for ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const formatDate = (date: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${date}T00:00:00Z`));

const formatMonth = (month: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
}).format(new Date(`${month}-01T00:00:00Z`));

const formatValue = (value: number) => new Intl.NumberFormat("en-US", {
  minimumFractionDigits: value >= 1_000 ? 0 : 2,
  maximumFractionDigits: value >= 1_000 ? 0 : 2,
}).format(value);

const changeClass = (value: number | null) => value === null ? "" : value > 0 ? "siw-up" : value < 0 ? "siw-down" : "";
const formatChange = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const heatClass = (row: MacroInflationRow, value: number | null) => {
  if (value === null) return "is-empty";
  const finite = row.values.filter((entry): entry is number => entry !== null && Number.isFinite(entry));
  if (finite.length < 2) return "is-neutral";
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const midpoint = (minimum + maximum) / 2;
  const denominator = Math.max(maximum - midpoint, midpoint - minimum, Number.EPSILON);
  const intensity = Math.max(1, Math.min(4, Math.ceil((Math.abs(value - midpoint) / denominator) * 4)));
  return value >= midpoint ? `is-hot-${intensity}` : `is-cool-${intensity}`;
};

export function StocksWatcherMacroPanel() {
  const [data, setData] = useState<StocksWatcherMacroSnapshot | null>(null);
  const [cache, setCache] = useState<MarketCacheMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (bypassBrowserCache = false) => {
    const requestUrl = `/api/stocks-watcher-macro${bypassBrowserCache ? `?_=${Date.now()}` : ""}`;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(requestUrl, bypassBrowserCache ? { cache: "no-store" } : undefined);
      const payload = await readPayload(response, requestUrl);
      if (!response.ok) throw new Error(payload.error || `Macro API failed with HTTP ${response.status}.`);
      if (!payload.data) throw new Error("Macro API response did not include data.");
      setData(payload.data);
      setCache(payload.cache || null);
    } catch (requestError) {
      setData(null);
      setCache(null);
      setError(requestError instanceof Error ? requestError.message : "Macro API failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const marketColumns = useMemo(() => [
    ["1D", "oneDay"],
    ["1W", "oneWeek"],
    ["1M", "oneMonth"],
    ["3M", "threeMonth"],
    ["YTD", "yearToDate"],
  ] as const, []);

  return <section className="siw-macro" data-macro-panel>
    <header className="siw-macro-head">
      <div>
        <span className="siw-eyebrow">Macro dashboard</span>
        <h2>Commodities, Dollar &amp; Inflation</h2>
        <p>Official published benchmarks · daily rows use trading-day changes; monthly rows leave 1D/1W blank.</p>
      </div>
      {data && <span>Latest source date {formatDate(data.asOf)}</span>}
    </header>

    {loading && <div className="siw-macro-loading" aria-live="polite">Loading FRED macro series…</div>}
    {error && !loading && <div className="siw-macro-error" role="alert">
      <strong>Macro source unavailable</strong>
      <span>{error}</span>
      <button type="button" onClick={() => void load(true)}>Retry source</button>
    </div>}

    {data && !loading && <>
      {cache?.status === "stale" && <div className="siw-macro-stale" role="status">Showing stale cached macro data because the latest FRED refresh failed.</div>}

      <section className="siw-macro-card" data-macro-markets>
        <div className="siw-macro-card-head">
          <div><span className="siw-eyebrow">Market benchmarks</span><h3>Commodities &amp; U.S. Dollar</h3></div>
          <span>As of {formatDate(data.markets.asOf)}</span>
        </div>
        <div className="siw-macro-table-wrap">
          <table className="siw-macro-market-table">
            <thead><tr><th>Asset</th><th>Price / index</th>{marketColumns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{data.markets.rows.map((row) => <tr key={row.id}>
              <th><span>{row.label}</span><small>{row.seriesId} · {row.frequency} · {formatDate(row.asOf)}</small></th>
              <td className="siw-macro-number"><span>{formatValue(row.value)}</span><small>{row.unit}</small></td>
              {marketColumns.map(([label, key]) => <td key={label} className={`siw-macro-change ${changeClass(row.changes[key])}`}>{formatChange(row.changes[key])}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="siw-macro-card" data-macro-inflation>
        <div className="siw-macro-card-head">
          <div><span className="siw-eyebrow">Inflation monitor</span><h3>Last 12 Monthly Releases</h3></div>
          <span>Higher values shade red · lower values shade blue</span>
        </div>
        <div className="siw-macro-table-wrap">
          <table className="siw-macro-inflation-table">
            <thead><tr><th>Metric</th><th>Unit</th>{data.inflation.months.map((month) => <th key={month}>{formatMonth(month)}</th>)}</tr></thead>
            <tbody>{data.inflation.rows.map((row) => <tr key={row.id}>
              <th><span>{row.label}</span><small>{row.seriesIds.join(" + ")}</small></th>
              <td>{row.unit}</td>
              {row.values.map((value, index) => <td key={data.inflation.months[index]} className={`siw-macro-heat ${heatClass(row, value)}`}>{value === null ? "—" : value.toFixed(2)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <footer className="siw-macro-source">
        <span>{data.source.note}</span>
        <div>
          <a href={data.source.url} target="_blank" rel="noreferrer">{data.source.provider}<ExternalLink size={12} aria-hidden="true" /></a>
          <a href={data.source.termsUrl} target="_blank" rel="noreferrer">Terms<ExternalLink size={12} aria-hidden="true" /></a>
          <button type="button" onClick={() => void load(true)} aria-label="Reload macro dashboard"><RefreshCw size={13} aria-hidden="true" /> Reload</button>
        </div>
      </footer>
    </>}
  </section>;
}
