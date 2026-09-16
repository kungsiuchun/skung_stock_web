import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import type { StocksWatcherMacroSnapshot } from "@/lib/stocks-watcher-macro";
import { macroHeatClass } from "./stocks-watcher-macro-heat";
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

const formatDateTime = (date: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date(date));

const formatValue = (value: number) => new Intl.NumberFormat("en-US", {
  minimumFractionDigits: value >= 1_000 ? 0 : 2,
  maximumFractionDigits: value >= 1_000 ? 0 : 2,
}).format(value);

const changeClass = (value: number | null) => value === null ? "" : value > 0 ? "siw-up" : value < 0 ? "siw-down" : "";
const changeDirection = (value: number | null) => value === null ? "unavailable" : value > 0 ? "positive" : value < 0 ? "negative" : "unchanged";
const formatChange = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

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

  const marketCadence = useMemo(() => {
    const latest = (frequency: "daily" | "monthly") => {
      const dates = data?.markets.rows
        .filter((row) => row.frequency === frequency)
        .map((row) => row.asOf)
        .sort() || [];
      return dates[dates.length - 1];
    };
    return { daily: latest("daily"), monthly: latest("monthly") };
  }, [data]);

  return <section className="siw-macro" data-macro-panel>
    <header className="siw-macro-head">
      <div>
        <span className="siw-eyebrow">Macro dashboard</span>
        <h2>Commodities, Dollar &amp; Inflation</h2>
        <p>Official published benchmarks · daily rows use trading-day changes; monthly dates name the reporting month and leave 1D/1W blank.</p>
      </div>
      {data && <div className="siw-macro-meta">
        <span>Latest source date {formatDate(data.asOf)}</span>
        {cache && <small data-macro-cache-status={cache.status}>{cache.status === "stale" ? "Stale snapshot" : `Retrieved ${formatDateTime(cache.cachedAt)}`}</small>}
      </div>}
    </header>

    {loading && <div className="siw-macro-loading" aria-live="polite">Loading FRED macro series…</div>}
    {error && !loading && <div className="siw-macro-error" role="alert">
      <strong>Macro source unavailable</strong>
      <span>{error}</span>
      <button type="button" onClick={() => void load(true)}>Retry source</button>
    </div>}

    {data && !loading && <>
      {cache?.status === "stale" && <div className="siw-macro-stale" role="status" data-macro-cache-status="stale">
        Showing cached macro data from {formatDateTime(cache.cachedAt)} because the latest FRED refresh failed{cache.refreshError ? `: ${cache.refreshError}` : "."}
      </div>}

      <section className="siw-macro-card" data-macro-markets>
        <div className="siw-macro-card-head">
          <div><span className="siw-eyebrow">Market benchmarks</span><h3>Commodities &amp; U.S. Dollar</h3></div>
          <span data-macro-market-cadence>
            {marketCadence.daily && <>Daily through {formatDate(marketCadence.daily)}</>}
            {marketCadence.daily && marketCadence.monthly && <> · </>}
            {marketCadence.monthly && <>Monthly through {formatMonth(marketCadence.monthly.slice(0, 7))}</>}
          </span>
        </div>
        <div className="siw-macro-table-wrap">
          <table className="siw-macro-market-table">
            <thead><tr><th>Asset</th><th>Price / index</th>{marketColumns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{data.markets.rows.map((row) => <tr key={row.id}>
              <th><span>{row.label}</span><small>{row.seriesId} · {row.frequency} · {formatDate(row.asOf)}</small></th>
              <td className="siw-macro-number"><span>{formatValue(row.value)}</span><small>{row.unit}</small></td>
              {marketColumns.map(([label, key]) => <td key={label} className={`siw-macro-change ${changeClass(row.changes[key])}`} data-change-direction={changeDirection(row.changes[key])}>{formatChange(row.changes[key])}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="siw-macro-card" data-macro-inflation>
        <div className="siw-macro-card-head">
          <div><span className="siw-eyebrow">Inflation monitor</span><h3>Last 12 Monthly Releases</h3></div>
          <div className="siw-macro-card-tools">
            <span>Monthly through {formatMonth(data.inflation.asOf.slice(0, 7))}</span>
            <div className="siw-macro-heat-legend" aria-label="Conditional formatting: lower values blue, higher values red">
              <span><i className="is-cool" aria-hidden="true" /> Lower</span>
              <span><i className="is-hot" aria-hidden="true" /> Higher</span>
            </div>
          </div>
        </div>
        <div className="siw-macro-table-wrap">
          <table className="siw-macro-inflation-table">
            <thead><tr><th>Metric</th><th>Unit</th>{data.inflation.months.map((month) => <th key={month}>{formatMonth(month)}</th>)}</tr></thead>
            <tbody>{data.inflation.rows.map((row) => <tr key={row.id}>
              <th><span>{row.label}</span><small>{row.seriesIds.join(" + ")}</small></th>
              <td>{row.unit}</td>
              {row.values.map((value, index) => <td key={data.inflation.months[index]} className={`siw-macro-heat ${macroHeatClass(row.values, value)}`}>{value === null ? "—" : value.toFixed(2)}</td>)}
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
