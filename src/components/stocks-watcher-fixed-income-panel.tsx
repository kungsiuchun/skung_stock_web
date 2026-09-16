import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FomcRateProbabilityResponse } from "@/lib/fomc-rate-probability";
import type { TreasuryCurveKey, TreasuryYieldCurveResponse } from "@/lib/treasury-yield-curve";

const CURVE_STYLES: Array<{ key: TreasuryCurveKey; color: string }> = [
  { key: "latest", color: "#2fa8ff" }, { key: "oneWeek", color: "#8b9ab0" },
  { key: "oneMonth", color: "#d4a947" }, { key: "startOfYear", color: "#35c58a" },
];
const formatDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const formatBps = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
const changeClass = (value: number) => value > 0 ? "siw-up" : value < 0 ? "siw-down" : "";
const formatTimestamp = (timestamp: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(timestamp));

const readPayload = async <T,>(response: Response, requestUrl: string) => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) throw new Error(`Fixed Income API returned ${contentType || "unknown content type"} for ${requestUrl}.`);
  try { return JSON.parse(text) as T & { error?: string }; }
  catch (error) { throw new Error(`Fixed Income API returned invalid JSON for ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`); }
};

function ChangeCell({ value }: { value: number }) {
  return <td className={`siw-fixed-income-number ${changeClass(value)}`}>{formatBps(value)}</td>;
}

export function StocksWatcherFixedIncomePanel() {
  const [data, setData] = useState<TreasuryYieldCurveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fomc, setFomc] = useState<FomcRateProbabilityResponse | null>(null);
  const [fomcLoading, setFomcLoading] = useState(true);
  const [fomcError, setFomcError] = useState<string | null>(null);
  const loadTreasury = async (bypassCache = false) => {
    const requestUrl = `/api/treasury-yield-curve${bypassCache ? `?_=${Date.now()}` : ""}`;
    setLoading(true); setError(null);
    try {
      const response = await fetch(requestUrl, bypassCache ? { cache: "no-store" } : undefined);
      const payload = await readPayload<TreasuryYieldCurveResponse>(response, requestUrl);
      if (!response.ok) throw new Error(payload.error || `Fixed Income API failed with HTTP ${response.status}.`);
      setData(payload);
    } catch (requestError) { setData(null); setError(requestError instanceof Error ? requestError.message : "Fixed Income API failed."); }
    finally { setLoading(false); }
  };
  const loadFomc = async (bypassCache = false) => {
    const requestUrl = `/api/fomc-rate-probability${bypassCache ? `?_=${Date.now()}` : ""}`;
    setFomcLoading(true); setFomcError(null);
    try {
      const response = await fetch(requestUrl, bypassCache ? { cache: "no-store" } : undefined);
      const payload = await readPayload<FomcRateProbabilityResponse>(response, requestUrl);
      if (!response.ok) throw new Error(payload.error || `FOMC probability API failed with HTTP ${response.status}.`);
      setFomc(payload);
    } catch (requestError) { setFomc(null); setFomcError(requestError instanceof Error ? requestError.message : "FOMC probability API failed."); }
    finally { setFomcLoading(false); }
  };
  useEffect(() => { void loadTreasury(); void loadFomc(); }, []);

  const chartData = useMemo(() => {
    const latest = data?.curves.find((curve) => curve.key === "latest");
    if (!latest || !data) return [];
    return latest.points.map((point, index) => {
      const row: Record<string, string | number> = { maturity: point.label, years: point.years };
      for (const curve of data.curves) row[curve.key] = curve.points[index]?.yield ?? Number.NaN;
      return row;
    });
  }, [data]);
  const curveLabels = useMemo(() => new Map((data?.curves || []).map((curve) => [curve.key, `${curve.label} (${formatDate(curve.date)})`])), [data]);
  const yieldDomain = useMemo<[number, number]>(() => {
    const values = chartData.flatMap((row) => CURVE_STYLES.map((curve) => row[curve.key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
    if (values.length === 0) return [0, 1];
    const minimum = Math.min(...values); const maximum = Math.max(...values); const padding = Math.max(0.08, (maximum - minimum) * 0.2);
    return [Math.floor((minimum - padding) * 10) / 10, Math.ceil((maximum + padding) * 10) / 10];
  }, [chartData]);

  return <section className="siw-fixed-income" data-fixed-income-panel>
    <header className="siw-fixed-income-head"><div><span className="siw-eyebrow">Rates market</span><h2>U.S. Treasury Yield Curve</h2><p>Daily nominal par yields · official published curves, not intraday pricing.</p></div>{data && <span>As of {formatDate(data.asOfDate)}</span>}</header>
    {loading && <div className="siw-fixed-income-loading" aria-live="polite">Loading Treasury curve…</div>}
    {error && !loading && <div className="siw-fixed-income-error" role="alert"><strong>Treasury source unavailable</strong><span>{error}</span><button type="button" onClick={() => void loadTreasury(true)}>Retry source</button></div>}
    <section className="siw-fomc-probability" data-fomc-probability-panel>
      <header className="siw-fomc-probability-head"><div><span className="siw-eyebrow">Policy market</span><h3>Next FOMC decision</h3><p>Polymarket prediction-market implied probabilities — not Fed Funds futures or investment advice.</p></div>{fomc && <span>{formatDate(fomc.meeting.date)}</span>}</header>
      {fomcLoading && <div className="siw-fomc-probability-loading" aria-live="polite">Loading FOMC probability market…</div>}
      {fomcError && !fomcLoading && <div className="siw-fomc-probability-error" role="alert"><strong>FOMC probability source unavailable</strong><span>{fomcError}</span><button type="button" onClick={() => void loadFomc(true)}>Retry source</button></div>}
      {fomc && !fomcLoading && <><div className="siw-fomc-probability-bars">{fomc.meeting.outcomes.map((outcome) => <div className="siw-fomc-probability-row" key={outcome.key} data-fomc-probability-outcome={outcome.key}><span>{outcome.label}</span><div className="siw-fomc-probability-track"><div className={`siw-fomc-probability-fill siw-fomc-probability-fill-${outcome.key}`} style={{ width: `${outcome.probability}%` }} /></div><strong>{outcome.probability.toFixed(1)}%</strong></div>)}</div><div className="siw-fomc-probability-summary"><span>No hike (Cut + Hold)</span><strong>{fomc.meeting.noHikeProbability.toFixed(1)}%</strong></div><footer className="siw-fomc-probability-source"><span>Observed {formatTimestamp(fomc.meeting.observedAt)} · volume {fomc.meeting.volume.toLocaleString()}</span><a href={fomc.source.url} target="_blank" rel="noreferrer">{fomc.source.provider}: {fomc.source.label}<ExternalLink size={12} aria-hidden="true" /></a>{fomc.meeting.rawProbabilityTotal !== 1 && <span>Raw total {fomc.meeting.rawProbabilityTotal.toFixed(2)} → normalized</span>}</footer></>}
    </section>
    {data && !loading && <>
      <section className="siw-fixed-income-chart-card" data-fixed-income-chart><div className="siw-fixed-income-card-head"><div><span className="siw-eyebrow">Yield curve comparison</span><h3>Published curve versus historical snapshots</h3></div><span>Annual yield (%)</span></div><div className="siw-fixed-income-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 10, bottom: 4, left: -16 }}><CartesianGrid stroke="#183148" strokeDasharray="2 3" vertical={false} /><XAxis dataKey="maturity" tick={{ fill: "#7fa3c0", fontSize: 10 }} axisLine={{ stroke: "#1d3a54" }} tickLine={false} /><YAxis domain={yieldDomain} allowDataOverflow tickFormatter={(value: number) => `${value.toFixed(1)}%`} tick={{ fill: "#7fa3c0", fontSize: 10 }} axisLine={false} tickLine={false} width={50} /><Tooltip cursor={{ stroke: "#2fa8ff", strokeWidth: 1, strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 6, border: "1px solid #24435e", background: "#071624", boxShadow: "0 8px 24px rgba(0,0,0,.25)", fontSize: 12 }} labelStyle={{ color: "#e8f4ff" }} formatter={(value) => typeof value === "number" ? `${value.toFixed(2)}%` : String(value ?? "n/a")} /><Legend formatter={(value) => <span className="siw-fixed-income-legend">{curveLabels.get(value as TreasuryCurveKey) || value}</span>} />{CURVE_STYLES.map((curve) => <Line key={curve.key} type="monotone" dataKey={curve.key} stroke={curve.color} strokeWidth={curve.key === "latest" ? 2.5 : 1.6} dot={{ r: 2.4, fill: curve.color }} activeDot={{ r: 4 }} connectNulls />)}</LineChart></ResponsiveContainer></div></section>
      <section className="siw-fixed-income-table-card" data-fixed-income-table><div className="siw-fixed-income-card-head"><div><span className="siw-eyebrow">Treasury yields</span><h3>Level &amp; change in basis points</h3></div><span>Positive changes are green</span></div><div className="siw-fixed-income-table-wrap"><table><thead><tr><th>Maturity</th><th>Yield</th><th>1D (bps)</th><th>1W (bps)</th><th>1M (bps)</th><th>YTD (bps)</th></tr></thead><tbody>{data.yieldRows.map((row) => <tr key={row.maturity}><th>{row.maturity}</th><td className="siw-fixed-income-number">{row.yield.toFixed(2)}%</td><ChangeCell value={row.oneDayBps} /><ChangeCell value={row.oneWeekBps} /><ChangeCell value={row.oneMonthBps} /><ChangeCell value={row.yearToDateBps} /></tr>)}</tbody><tbody className="siw-fixed-income-spreads">{data.spreadRows.map((row) => <tr key={row.label}><th>{row.label}</th><td className="siw-fixed-income-number">{formatBps(row.valueBps)} bps</td><ChangeCell value={row.oneDayBps} /><ChangeCell value={row.oneWeekBps} /><ChangeCell value={row.oneMonthBps} /><ChangeCell value={row.yearToDateBps} /></tr>)}</tbody></table></div></section>
      <footer className="siw-fixed-income-source"><span>Fetched {formatDate(data.source.fetchedAt.slice(0, 10))}</span><a href={data.source.url} target="_blank" rel="noreferrer">{data.source.provider}: {data.source.label}<ExternalLink size={12} aria-hidden="true" /></a><button type="button" onClick={() => { void loadTreasury(true); void loadFomc(true); }} aria-label="Refresh rates and FOMC probability"><RefreshCw size={13} aria-hidden="true" /> Refresh</button></footer>
    </>}
  </section>;
}
