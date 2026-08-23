import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortfolioBacktestResult, PortfolioDividendPolicy, PortfolioRebalancePolicy } from "@/lib/portfolio-backtest";

interface PortfolioBacktestPageProps {
  onBackToWork: () => void;
}

type PositionDraft = { id: number; ticker: string; weight: string };
type BacktestResponse = { data: PortfolioBacktestResult; cache: { status: "hit" | "refreshed" | "stale" | "bypassed" } };
type TickerVerification = { ticker: string; displayName: string; eligibility: "verified_us_etf"; exchange: string };

const MAX_POSITIONS = 10;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = (value: number | null, digits = 2) => value === null ? "Unavailable" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const initialEnd = () => new Date().toISOString().slice(0, 10);
const initialStart = () => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 5);
  return date.toISOString().slice(0, 10);
};
const hasBasisPointPrecision = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value.trim());
const basisPointsFor = (value: string) => hasBasisPointPrecision(value) ? Number(value) * 100 : Number.NaN;

export function PortfolioBacktestPage({ onBackToWork }: PortfolioBacktestPageProps) {
  const [positions, setPositions] = useState<PositionDraft[]>([{ id: 1, ticker: "", weight: "" }]);
  const [startingCapital, setStartingCapital] = useState("10000");
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [rebalancePolicy, setRebalancePolicy] = useState<PortfolioRebalancePolicy>("none");
  const [dividendPolicy, setDividendPolicy] = useState<PortfolioDividendPolicy>("reinvest");
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickerVerification, setTickerVerification] = useState<TickerVerification[] | null>(null);
  const [validatingTickers, setValidatingTickers] = useState(false);

  const allocationBasisPoints = useMemo(() => positions.reduce((sum, position) => sum + (Number.isInteger(basisPointsFor(position.weight)) ? basisPointsFor(position.weight) : 0), 0), [positions]);
  const allocationPrecisionValid = positions.every((position) => Number.isInteger(basisPointsFor(position.weight)));
  const allocationValid = positions.length > 0 && positions.every((position) => /^[A-Za-z0-9.^-]{1,16}$/.test(position.ticker.trim()) && Number.isInteger(basisPointsFor(position.weight)) && basisPointsFor(position.weight) > 0) && allocationBasisPoints === 10_000;
  const updatePosition = (id: number, field: "ticker" | "weight", value: string) => {
    setPositions((current) => current.map((position) => position.id === id ? { ...position, [field]: field === "ticker" ? value.toUpperCase() : value } : position));
    setResult(null);
    setTickerVerification(null);
  };
  const addPosition = () => {
    if (positions.length >= MAX_POSITIONS) return;
    setPositions((current) => [...current, { id: Math.max(0, ...current.map((position) => position.id)) + 1, ticker: "", weight: "" }]);
    setResult(null);
    setTickerVerification(null);
  };
  const removePosition = (id: number) => {
    if (positions.length === 1) return;
    setPositions((current) => current.filter((position) => position.id !== id));
    setResult(null);
    setTickerVerification(null);
  };
  const verifyTickers = async () => {
    const tickers = positions.map((position) => position.ticker.trim().toUpperCase());
    if (tickers.length === 0 || tickers.some((ticker) => !/^[A-Z0-9.^-]{1,16}$/.test(ticker)) || new Set(tickers).size !== tickers.length) {
      setError("Enter unique, valid ETF tickers before requesting server-side ETF verification.");
      return;
    }
    setError(null);
    setTickerVerification(null);
    setValidatingTickers(true);
    try {
      const response = await fetch("/api/portfolio-backtest", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operation: "validate", tickers }),
      });
      const payload = await response.json() as { data?: { instruments?: TickerVerification[] }; error?: { message?: string } };
      if (!response.ok || !payload.data?.instruments) throw new Error(payload.error?.message || `ETF verification returned HTTP ${response.status}.`);
      setTickerVerification(payload.data.instruments);
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : String(verificationError));
    } finally {
      setValidatingTickers(false);
    }
  };
  const runBacktest = async () => {
    setError(null);
    setResult(null);
    if (!allocationValid) {
      setError("Enter 1–10 US ETF tickers with positive weights in 0.01% increments totaling exactly 100.00%.");
      return;
    }
    const capital = Number(startingCapital);
    if (!Number.isFinite(capital) || capital <= 0) {
      setError("Starting capital must be a positive USD amount.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
      setError("Choose a valid chronological date range.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/portfolio-backtest", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          startingCapital: capital,
          positions: positions.map((position) => ({ ticker: position.ticker.trim().toUpperCase(), basisPoints: basisPointsFor(position.weight) })),
          startDate,
          endDate,
          rebalancePolicy,
          dividendPolicy,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) throw new Error("The backtest API returned a non-JSON response.");
      const payload = await response.json() as BacktestResponse | { error?: { message?: string } };
      if (!response.ok || !("data" in payload)) throw new Error((payload as { error?: { message?: string } }).error?.message || `Backtest API returned HTTP ${response.status}.`);
      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setLoading(false);
    }
  };

  return <section className="h-full overflow-y-auto overscroll-contain bg-[#0d0f10] px-4 py-5 font-mono text-zinc-100 sm:px-7 lg:px-10">
    <div className="mx-auto w-full max-w-[1540px]">
      <header className="border-b border-zinc-700 pb-5">
        <button type="button" onClick={onBackToWork} className="mb-5 inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
          <ArrowLeft className="h-3.5 w-3.5" /> Market Lab
        </button>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-emerald-400">EOD historical simulation / USD</p>
            <h1 className="mt-2 text-2xl font-black tracking-[-0.055em] text-zinc-100 sm:text-4xl">PORTFOLIO VS SPY</h1>
            <p className="mt-3 max-w-3xl text-xs leading-5 text-zinc-500">Build a US ETF allocation, choose dividend and rebalancing policies, then compare the same historical sessions against SPY. This is a historical model, not investment advice.</p>
          </div>
          {result && <div className={`border px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.14em] ${result.cache.status === "stale" ? "border-amber-500/50 bg-amber-500/10 text-amber-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}`}>
            Cache: {result.cache.status}
          </div>}
        </div>
      </header>

      <main className="grid gap-5 py-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form onSubmit={(event) => { event.preventDefault(); void runBacktest(); }} className="h-fit border border-zinc-800 bg-[#111416] p-4 sm:p-5" noValidate>
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3"><div><p className="text-[0.62rem] font-bold uppercase tracking-[0.15em] text-zinc-500">Portfolio specification</p><h2 className="mt-1 text-lg font-black">US-listed ETFs</h2></div><BarChart3 className="h-5 w-5 text-emerald-400" /></div>
          <label className="mt-5 block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Starting capital (USD)<input value={startingCapital} onChange={(event) => { setStartingCapital(event.target.value); setResult(null); }} inputMode="decimal" className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400" aria-label="Starting capital" /></label>
          <div className="mt-5 grid grid-cols-2 gap-3"><label className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Start date<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setResult(null); }} className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-400" aria-label="Start date" /></label><label className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">End date<input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setResult(null); }} className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-400" aria-label="End date" /></label></div>
          <div className="mt-5 space-y-2"><div className="flex items-center justify-between"><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">ETF allocation</p><span className={allocationValid ? "text-xs font-black text-emerald-400" : "text-xs font-black text-rose-400"}>{allocationPrecisionValid ? `${(allocationBasisPoints / 100).toFixed(2)}%` : "Use 0.01% increments"}</span></div>{positions.map((position) => <div key={position.id} className="grid grid-cols-[1fr_96px_30px] gap-2"><input value={position.ticker} onChange={(event) => updatePosition(position.id, "ticker", event.target.value)} placeholder="VTI" className="min-w-0 border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm uppercase text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-emerald-400" aria-label="ETF ticker" /><input value={position.weight} onChange={(event) => updatePosition(position.id, "weight", event.target.value)} inputMode="decimal" placeholder="60.00" className="min-w-0 border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-emerald-400" aria-label="ETF allocation percent" /><button type="button" disabled={positions.length === 1} onClick={() => removePosition(position.id)} aria-label={`Remove ${position.ticker || "ETF"}`} className="border border-zinc-800 text-zinc-500 hover:border-rose-400 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 className="mx-auto h-3.5 w-3.5" /></button></div>)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"><button type="button" disabled={positions.length >= MAX_POSITIONS} onClick={addPosition} className="inline-flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-zinc-400 hover:text-emerald-400 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add ETF</button><button type="button" disabled={validatingTickers} onClick={() => void verifyTickers()} className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-zinc-400 hover:text-emerald-400 disabled:opacity-40">{validatingTickers ? "Verifying ETF tickers..." : "Verify ETF tickers"}</button></div>
          {tickerVerification && <div className="mt-3 border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100" data-testid="verified-etf-tickers">{tickerVerification.map((instrument) => <p key={instrument.ticker}><span className="font-black">{instrument.ticker}</span> · {instrument.displayName} · {instrument.exchange} · verified US ETF</p>)}</div>}
          <div className="mt-5 grid gap-3"><label className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Rebalancing<select value={rebalancePolicy} onChange={(event) => { setRebalancePolicy(event.target.value as PortfolioRebalancePolicy); setResult(null); }} className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400" aria-label="Rebalancing policy"><option value="none">No rebalancing</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label><label className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Dividend policy<select value={dividendPolicy} onChange={(event) => { setDividendPolicy(event.target.value as PortfolioDividendPolicy); setResult(null); }} className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400" aria-label="Dividend policy"><option value="reinvest">Reinvest dividends</option><option value="cash">Hold dividends as cash</option></select></label></div>
          <button type="submit" disabled={loading} className="mt-6 inline-flex w-full items-center justify-center gap-2 border border-emerald-400/70 bg-emerald-400/10 px-4 py-3 text-[0.68rem] font-black uppercase tracking-[0.15em] text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50">{loading ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Fetching and simulating EOD history</> : "Run backtest"}</button>
          {loading && <p role="status" className="mt-2 text-center text-[0.62rem] text-zinc-500">Verifying US ETF eligibility, aligning completed sessions, and calculating the comparison.</p>}
          <p className="mt-4 text-[0.62rem] leading-4 text-zinc-600">Fractional shares. No taxes, trading costs, slippage, cash interest, or execution assumptions. Non-reinvested dividends remain zero-yield cash.</p>
        </form>

        <div className="min-w-0 space-y-5">
          {error && <div className="border border-rose-500/50 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100" role="alert"><span className="font-black uppercase tracking-[0.12em]">Backtest unavailable</span><p className="mt-1 text-rose-200/80">{error}</p><button type="button" onClick={() => void runBacktest()} disabled={loading} className="mt-3 border border-rose-400/60 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.12em] text-rose-100 hover:bg-rose-400/10 disabled:opacity-50">Retry last backtest</button></div>}
          {!result && !error && <div className="flex min-h-[420px] items-center justify-center border border-dashed border-zinc-800 bg-[#111416] p-8 text-center"><div><BarChart3 className="mx-auto h-9 w-9 text-zinc-700" /><h2 className="mt-4 text-lg font-black text-zinc-300">Configure an ETF mix</h2><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-zinc-600">Add one or more US-listed ETFs whose weights total 100.00%. SPY is always the benchmark.</p></div></div>}
          {result && <ResultsPanel result={result.data} />}
        </div>
      </main>
    </div>
  </section>;
}

function ResultsPanel({ result }: { result: PortfolioBacktestResult }) {
  const chartData = result.curve.map((point) => ({ ...point, label: dateLabel(point.date) }));
  return <>
    <div className="grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Portfolio ending value" value={usd.format(result.endingValue)} tone="text-emerald-300" /><Stat label="SPY ending value" value={usd.format(result.benchmarkEndingValue)} /><Stat label="Portfolio return" value={percent(result.metrics.cumulativeReturn)} tone={result.metrics.cumulativeReturn >= 0 ? "text-emerald-300" : "text-rose-300"} /><Stat label="Vs SPY" value={percent(result.excessCumulativeReturn)} tone={result.excessCumulativeReturn >= 0 ? "text-emerald-300" : "text-rose-300"} /></div>
    <section className="border border-zinc-800 bg-[#111416] p-4 sm:p-5"><div className="flex flex-col justify-between gap-2 border-b border-zinc-800 pb-4 sm:flex-row sm:items-end"><div><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Same-session comparison</p><h2 className="mt-1 text-lg font-black">Growth of capital</h2></div><p className="text-[0.62rem] text-zinc-500">Effective {result.effectiveRange.start} → {result.effectiveRange.end} · {result.effectiveRange.sessionCount} sessions</p></div><div className="mt-5 h-[310px] min-w-0" data-testid="portfolio-performance-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 2, left: -16 }}><CartesianGrid stroke="#27272a" strokeDasharray="3 3" /><XAxis dataKey="label" minTickGap={40} tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}`} tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [`${Number(value ?? 0).toFixed(2)}`, name === "portfolioIndexed" ? "Portfolio" : "SPY"]} contentStyle={{ background: "#09090b", border: "1px solid #3f3f46", fontSize: 12 }} /><Legend formatter={(value) => value === "portfolioIndexed" ? "Portfolio" : "SPY"} /><Line type="monotone" dataKey="portfolioIndexed" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="benchmarkIndexed" stroke="#a1a1aa" strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></section>
    <div className="grid gap-5 lg:grid-cols-2"><section className="border border-zinc-800 bg-[#111416] p-4 sm:p-5"><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Risk and return</p><dl className="mt-4 grid grid-cols-2 gap-px border border-zinc-800 bg-zinc-800"><Metric label="CAGR" value={percent(result.metrics.cagr)} /><Metric label="Volatility" value={percent(result.metrics.annualizedVolatility)} /><Metric label="Max drawdown" value={percent(result.metrics.maxDrawdown)} /><Metric label="Sharpe (0% RF)" value={result.metrics.sharpeRatio === null ? "Unavailable" : result.metrics.sharpeRatio.toFixed(2)} /></dl></section><section className="border border-zinc-800 bg-[#111416] p-4 sm:p-5"><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Methodology and provenance</p><div className="mt-4 space-y-2 text-xs leading-5 text-zinc-400"><p><span className="font-bold text-zinc-200">Policy:</span> {result.rebalancePolicy} rebalancing · {result.dividendPolicy === "reinvest" ? "dividends reinvested" : "dividends held as zero-yield cash"}</p><p><span className="font-bold text-zinc-200">Requested:</span> {result.requestedRange.start} → {result.requestedRange.end}</p><p><span className="font-bold text-zinc-200">Effective:</span> {result.effectiveRange.start} → {result.effectiveRange.end} · {result.effectiveRange.sessionCount} completed shared sessions</p><p><span className="font-bold text-zinc-200">Source:</span> {result.dataSource.provider} · {result.dataSource.role} · as of {result.sourceAsOf}</p><p><span className="font-bold text-zinc-200">Excluded sessions:</span> {result.excludedSessions.length ? result.excludedSessions.join(", ") : "None — incomplete shared sessions fail closed."}</p><p><span className="font-bold text-zinc-200">Rebalances:</span> {result.rebalancedOn.length ? result.rebalancedOn.join(", ") : "None"}</p><p className="text-zinc-600">No taxes, trading costs, slippage, cash interest, execution limits, or forecasts. Methodology {result.methodologyVersion}.</p></div></section></div>
    {result.warnings.length > 0 && <div className="border border-amber-500/50 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100" role="status"><span className="font-black uppercase tracking-[0.12em]">Data warning</span><p>{result.warnings.join(" ")}</p></div>}
    <section className="overflow-x-auto border border-zinc-800 bg-[#111416] p-4 sm:p-5"><p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Ending portfolio composition</p><table className="mt-4 w-full min-w-[620px] text-left text-xs"><thead className="border-b border-zinc-800 text-[0.6rem] uppercase tracking-[0.12em] text-zinc-600"><tr><th className="pb-2">ETF</th><th className="pb-2 text-right">Target</th><th className="pb-2 text-right">Ending weight</th><th className="pb-2 text-right">Ending value</th><th className="pb-2 text-right">Cash dividends</th></tr></thead><tbody>{result.positions.map((position) => <tr key={position.ticker} className="border-b border-zinc-900 last:border-0"><td className="py-3 font-bold text-zinc-200">{position.ticker}<span className="ml-2 font-normal text-zinc-600">{position.displayName}</span></td><td className="py-3 text-right tabular-nums text-zinc-400">{position.targetWeightPct.toFixed(2)}%</td><td className="py-3 text-right tabular-nums text-zinc-400">{position.endingWeightPct.toFixed(2)}%</td><td className="py-3 text-right tabular-nums text-zinc-200">{usd.format(position.endingValue)}</td><td className="py-3 text-right tabular-nums text-zinc-400">{usd.format(position.cashDividendValue)}</td></tr>)}</tbody></table></section>
  </>;
}

function Stat({ label, value, tone = "text-zinc-100" }: { label: string; value: string; tone?: string }) { return <div className="bg-[#111416] p-4"><p className="text-[0.58rem] font-bold uppercase tracking-[0.13em] text-zinc-600">{label}</p><p className={`mt-2 text-xl font-black tracking-tight ${tone}`}>{value}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-[#111416] p-3"><dt className="text-[0.58rem] font-bold uppercase tracking-[0.12em] text-zinc-600">{label}</dt><dd className="mt-1 text-sm font-black text-zinc-200">{value}</dd></div>; }
