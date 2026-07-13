import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TreasuryCurveKey, TreasuryYieldCurveResponse } from "@/lib/treasury-yield-curve";

interface FixedIncomePageProps {
  onBackToWork: () => void;
}

const curveStyles: Array<{ key: TreasuryCurveKey; color: string }> = [
  { key: "latest", color: "#b85c38" },
  { key: "oneWeek", color: "#2e628d" },
  { key: "oneMonth", color: "#70747a" },
  { key: "startOfYear", color: "#3d815d" },
];

const formatDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
};

const formatBps = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;

const changeClass = (value: number) => {
  if (value > 0) return "text-[#16734b]";
  if (value < 0) return "text-[#b83232]";
  return "text-[#565b61]";
};

const readPayload = async (response: Response, requestUrl: string) => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Fixed Income API returned ${contentType || "unknown content type"} for ${requestUrl}.`);
  }

  try {
    return JSON.parse(text) as TreasuryYieldCurveResponse & { error?: string };
  } catch (error) {
    throw new Error(`Fixed Income API returned invalid JSON for ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export function FixedIncomePage({ onBackToWork }: FixedIncomePageProps) {
  const [data, setData] = useState<TreasuryYieldCurveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (bypassCache = false) => {
    const requestUrl = `/api/treasury-yield-curve${bypassCache ? `?_=${Date.now()}` : ""}`;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(requestUrl, bypassCache ? { cache: "no-store" } : undefined);
      const payload = await readPayload(response, requestUrl);
      if (!response.ok) throw new Error(payload.error || `Fixed Income API failed with HTTP ${response.status}.`);
      setData(payload);
    } catch (requestError) {
      setData(null);
      setError(requestError instanceof Error ? requestError.message : "Fixed Income API failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const chartData = useMemo(() => {
    const latest = data?.curves.find((curve) => curve.key === "latest");
    if (!latest || !data) return [];

    return latest.points.map((point, index) => {
      const row: Record<string, string | number> = { maturity: point.label, years: point.years };
      for (const curve of data.curves) row[curve.key] = curve.points[index]?.yield ?? Number.NaN;
      return row;
    });
  }, [data]);

  const curveLabels = useMemo(
    () => new Map((data?.curves || []).map((curve) => [curve.key, `${curve.label} (${formatDate(curve.date)})`])),
    [data],
  );

  const yieldDomain = useMemo<[number, number]>(() => {
    const values = chartData.flatMap((row) => curveStyles
      .map((curve) => row[curve.key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));

    if (values.length === 0) return [0, 1];

    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const padding = Math.max(0.08, (maximum - minimum) * 0.2);

    return [
      Math.floor((minimum - padding) * 10) / 10,
      Math.ceil((maximum + padding) * 10) / 10,
    ];
  }, [chartData]);

  return (
    <section className="h-full overflow-y-auto overscroll-contain bg-[#f2f4f5] px-4 py-6 font-mono text-[#20252b] sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="flex flex-col gap-5 border-b-2 border-[#252a30] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              type="button"
              onClick={onBackToWork}
              className="mb-5 inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#5a626b] transition-colors hover:text-[#b85c38] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b85c38]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Market Lab
            </button>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-black tracking-[-0.06em] sm:text-3xl">U.S. TREASURIES</h1>
              <span className="text-xs font-bold tracking-[0.14em] text-[#69717b]">FIXED INCOME</span>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[#59616b]">
              Daily nominal par yields, compared across published Treasury curves. Values are official CMT observations, not intraday pricing.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(true)}
            className="inline-flex w-fit items-center gap-2 border border-[#b85c38] bg-[#b85c38] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#97472a] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b85c38] focus-visible:ring-offset-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh data
          </button>
        </header>

        {loading && <FixedIncomeSkeleton />}

        {error && !loading && (
          <div className="mt-8 border border-[#b83232] bg-[#fff5f4] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b83232]">Treasury source unavailable</p>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-[#552221]">{error}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-5 border border-[#b83232] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#b83232] hover:bg-[#b83232] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b83232]"
            >
              Retry source
            </button>
          </div>
        )}

        {data && !loading && (
          <main className="py-7">
            <section className="border border-[#cbd0d4] bg-white p-3 shadow-[0_14px_35px_rgba(38,44,51,0.08)] sm:p-5">
              <div className="flex flex-col gap-3 border-b border-[#d9dde0] pb-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#b85c38]">Yield curve comparison</p>
                  <h2 className="mt-1 text-base font-black tracking-[-0.035em]">Published curve versus historical snapshots</h2>
                </div>
                <p className="text-[0.68rem] leading-5 text-[#66707a]">As of {formatDate(data.asOfDate)} · Y-axis: annual yield (%)</p>
              </div>

              <div className="mt-5 h-[340px] min-w-0 sm:h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 14, bottom: 4, left: -16 }}>
                    <CartesianGrid stroke="#d9dde0" strokeDasharray="2 3" vertical={false} />
                    <XAxis dataKey="maturity" tick={{ fill: "#5e6770", fontSize: 11 }} axisLine={{ stroke: "#b9c0c6" }} tickLine={false} />
                    <YAxis domain={yieldDomain} allowDataOverflow tickFormatter={(value: number) => `${value.toFixed(1)}%`} tick={{ fill: "#5e6770", fontSize: 11 }} axisLine={false} tickLine={false} width={54} />
                    <Tooltip
                      cursor={{ stroke: "#b85c38", strokeWidth: 1, strokeDasharray: "3 3" }}
                      contentStyle={{ borderRadius: 0, border: "1px solid #b9c0c6", boxShadow: "0 8px 24px rgba(38,44,51,0.12)", fontSize: 12 }}
                      formatter={(value) => typeof value === "number" ? `${value.toFixed(2)}%` : String(value ?? "n/a")}
                    />
                    <Legend formatter={(value) => <span className="text-[0.65rem] font-bold text-[#4e565e]">{curveLabels.get(value as TreasuryCurveKey) || value}</span>} />
                    {curveStyles.map((curve) => (
                      <Line key={curve.key} type="monotone" dataKey={curve.key} stroke={curve.color} strokeWidth={curve.key === "latest" ? 2.5 : 1.8} dot={{ r: 2.8, fill: curve.color }} activeDot={{ r: 4.5 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="mt-7 overflow-hidden border border-[#cbd0d4] bg-white shadow-[0_14px_35px_rgba(38,44,51,0.08)]">
              <div className="flex flex-col gap-2 border-b border-[#cbd0d4] px-4 py-4 sm:px-5">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#b85c38]">Treasury yields</p>
                <p className="text-[0.68rem] text-[#66707a]">Level & change in basis points. Positive yield changes are green; negative are red.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="bg-[#edf0f1] text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[#565e67]">
                    <tr>
                      <th className="px-4 py-3 sm:px-5">Maturity</th>
                      <th className="px-4 py-3 text-right">Yield</th>
                      <th className="px-4 py-3 text-right">1D (bps)</th>
                      <th className="px-4 py-3 text-right">1W (bps)</th>
                      <th className="px-4 py-3 text-right">1M (bps)</th>
                      <th className="px-4 py-3 text-right">YTD (bps)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.yieldRows.map((row) => (
                      <tr key={row.maturity} className="border-t border-[#e3e6e8] hover:bg-[#fcfaf8]">
                        <th className="px-4 py-2.5 font-bold text-[#323940] sm:px-5">{row.maturity}</th>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">{row.yield.toFixed(2)}%</td>
                        <ChangeCell value={row.oneDayBps} />
                        <ChangeCell value={row.oneWeekBps} />
                        <ChangeCell value={row.oneMonthBps} />
                        <ChangeCell value={row.yearToDateBps} />
                      </tr>
                    ))}
                  </tbody>
                  <tbody className="border-t-2 border-[#60666d] bg-[#faf7f2]">
                    {data.spreadRows.map((row) => (
                      <tr key={row.label}>
                        <th className="px-4 py-2.5 font-black text-[#323940] sm:px-5">{row.label}</th>
                        <td className="px-4 py-2.5 text-right font-black tabular-nums">{formatBps(row.valueBps)} bps</td>
                        <ChangeCell value={row.oneDayBps} />
                        <ChangeCell value={row.oneWeekBps} />
                        <ChangeCell value={row.oneMonthBps} />
                        <ChangeCell value={row.yearToDateBps} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="mt-6 border-t border-[#cbd0d4] pt-4 text-[0.66rem] leading-5 text-[#65707a]">
              <p>Published source updates after the Treasury releases its daily curve. Fetched {formatDate(data.source.fetchedAt.slice(0, 10))}.</p>
              <a href={data.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-bold text-[#8e442a] underline underline-offset-2 hover:text-[#6f321f]">
                {data.source.provider}: {data.source.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            </footer>
          </main>
        )}
      </div>
    </section>
  );
}

function ChangeCell({ value }: { value: number }) {
  return <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${changeClass(value)}`}>{formatBps(value)}</td>;
}

function FixedIncomeSkeleton() {
  return (
    <div className="mt-7 animate-pulse space-y-7">
      <div className="h-[470px] border border-[#cbd0d4] bg-white p-5">
        <div className="h-4 w-44 bg-[#dfe3e5]" />
        <div className="mt-5 h-[385px] bg-[linear-gradient(135deg,#f1f3f4_25%,#e7ebed_25%,#e7ebed_50%,#f1f3f4_50%,#f1f3f4_75%,#e7ebed_75%)] bg-[length:24px_24px]" />
      </div>
      <div className="h-[360px] border border-[#cbd0d4] bg-white" />
    </div>
  );
}
