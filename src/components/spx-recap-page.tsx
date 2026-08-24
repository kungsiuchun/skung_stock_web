import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  ListFilter,
  Loader2,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TimelineStatus = "win" | "loss" | "flat" | "defense" | "ic" | "entry" | "pending";

interface RecapSummary {
  totalCallouts: number;
  tradesTaken: number;
  wins: number;
  losses: number;
  flatCloses: number;
  winRate: number | null;
  totalPnlPoints: number;
  defensiveHolds: number;
  icEvents: number;
}

interface TimelineItem {
  id: string;
  date?: string;
  ordinal?: number;
  time: string;
  timestamp: string | null;
  price: number | null;
  action: string;
  reasoning: string;
  pnl: number | null;
  status: TimelineStatus;
  eventType?: string;
  positionSide?: string;
  relatedEntryId?: string | null;
}

interface AnalyticsDay extends RecapSummary {
  date: string;
  firstCalloutAt: string | null;
  lastCalloutAt: string | null;
}

interface LearnedRule {
  sourceDate: string | null;
  text: string;
}

interface RecapData {
  availableDates: string[];
  selectedDate: string | null;
  summary: RecapSummary;
  timeline: TimelineItem[];
  auditReport: string;
  source?: "d1" | "kv" | "empty";
  warnings?: string[];
  analytics?: {
    days: AnalyticsDay[];
    summary: RecapSummary;
    learnedRules: LearnedRule[];
  };
  auditMeta?: {
    generatedAt: string | null;
    actionLogSize: number | null;
    learnedRules: string[];
  } | null;
  retention?: { rawDays: number; recapDays: number; availableDateLimit: number };
  performance?: {
    label: string;
    buckets: Array<{
      action: "OPEN_CALL" | "OPEN_PUT";
      regime: string;
      sampleCount: number;
      successCount: number;
      hitRate: number | null;
      averageReturn15m: number | null;
      averageMae30m: number | null;
      averageMfe30m: number | null;
    }>;
  };
}

const emptySummary: RecapSummary = {
  totalCallouts: 0,
  tradesTaken: 0,
  wins: 0,
  losses: 0,
  flatCloses: 0,
  winRate: null,
  totalPnlPoints: 0,
  defensiveHolds: 0,
  icEvents: 0,
};

const statusMeta: Record<TimelineStatus, { label: string; dot: string; border: string; text: string }> = {
  win: { label: "盈利", dot: "bg-emerald-400", border: "border-emerald-500/40", text: "text-emerald-300" },
  loss: { label: "止損", dot: "bg-rose-400", border: "border-rose-500/40", text: "text-rose-300" },
  flat: { label: "平手", dot: "bg-slate-300", border: "border-slate-500/40", text: "text-slate-200" },
  defense: { label: "防守", dot: "bg-sky-400", border: "border-sky-500/40", text: "text-sky-300" },
  ic: { label: "IC", dot: "bg-amber-400", border: "border-amber-500/40", text: "text-amber-300" },
  entry: { label: "入場", dot: "bg-violet-400", border: "border-violet-500/40", text: "text-violet-300" },
  pending: { label: "待確認", dot: "bg-zinc-500", border: "border-zinc-600", text: "text-zinc-300" },
};

const formatPrice = (price: number | null) => (price === null ? "N/A" : price.toFixed(2));

const formatPnl = (pnl: number | null) => {
  if (pnl === null) return "N/A";
  return `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} pts`;
};

const splitAuditReport = (report: string) => {
  const lines = report.split(/\r?\n/);
  const auditStart = lines.findIndex((line) => /每日審計清單|Audit Log/i.test(line));

  if (auditStart === -1) {
    return { before: report.trim(), after: "" };
  }

  const nextSection = lines.findIndex((line, index) => {
    if (index <= auditStart) return false;
    return /^(?:#{1,6}\s*)?(?:\S+\s*)?4[\s.、．)]/.test(line.trim());
  });

  return {
    before: lines.slice(0, auditStart).join("\n").trim(),
    after: nextSection === -1 ? "" : lines.slice(nextSection).join("\n").trim(),
  };
};

function AuditTimeline({ items, onSelect }: { items: TimelineItem[]; onSelect: (id: string) => void }) {
  if (items.length === 0) {
    return (
      <div className="border border-dashed border-white/10 py-8 text-center text-sm text-zinc-500">
        呢日未有可顯示嘅 audit timeline。
      </div>
    );
  }

  return (
    <div className="mt-5 border border-white/10 bg-black/20 p-4">
      <div className="mb-5 flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-black text-white">每日審計時間線</h3>
      </div>

      <ol className="relative ml-3 border-l border-white/10">
        {items.map((item) => {
          const meta = statusMeta[item.status];
          const pnlClass = item.pnl === null ? "text-zinc-500" : item.pnl < 0 ? "text-rose-300" : "text-emerald-300";

          return (
            <li key={item.id} className="relative pb-5 pl-6 last:pb-0">
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className={`absolute -left-[7px] top-1 h-3.5 w-3.5 border border-[#101118] ${meta.dot}`}
                aria-label={`查看 ${item.time} 詳細報告`}
              />
              <div className="border border-white/10 bg-[#0b0c11] p-3 hover:border-amber-500/35">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-black text-amber-200">{item.time} ET</span>
                  <span className={`border px-2 py-0.5 text-[11px] font-black ${meta.border} ${meta.text}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] font-bold text-zinc-500">SPX {formatPrice(item.price)}</span>
                  <span className={`text-[11px] font-black ${pnlClass}`}>{formatPnl(item.pnl)}</span>
                </div>
                <p className="text-sm font-bold text-zinc-100">{item.action}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{item.reasoning}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`min-h-[7.5rem] border ${accent} bg-[#101118] px-5 py-4 shadow-2xl shadow-black/20`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        <div className="text-zinc-500">{icon}</div>
      </div>
      <div className="mt-5 text-3xl font-black tracking-normal text-white sm:text-4xl">{value}</div>
    </div>
  );
}

export function SPXRecapPage() {
  const [data, setData] = useState<RecapData | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<TimelineStatus | "all">("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => data?.timeline.find((item) => item.id === selectedItemId) || null,
    [data?.timeline, selectedItemId],
  );

  const analyticsDays = data?.analytics?.days || [];
  const equityData = useMemo(() => {
    let cumulative = 0;
    return analyticsDays.map((day) => {
      cumulative = Number((cumulative + day.totalPnlPoints).toFixed(2));
      return {
        date: day.date.slice(5),
        fullDate: day.date,
        dailyPnl: day.totalPnlPoints,
        cumulative,
        winRate: day.winRate,
      };
    });
  }, [analyticsDays]);

  const filteredTimeline = useMemo(
    () => data?.timeline.filter((item) => statusFilter === "all" || item.status === statusFilter) || [],
    [data?.timeline, statusFilter],
  );

  const fetchRecap = async (date?: string, from?: string, to?: string) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/spx-recap${query}`);
      const payload = (await response.json()) as RecapData & { error?: string };

      if (!response.ok) throw new Error(payload.error || "SPX recap API failed");

      setData(payload);
      setSelectedDate(payload.selectedDate || "");
      if (payload.analytics?.days.length) {
        setRangeFrom(payload.analytics.days[0].date);
        setRangeTo(payload.analytics.days[payload.analytics.days.length - 1].date);
      }
      setSelectedItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SPX recap failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecap();
  }, []);

  const summary = data?.summary || emptySummary;
  const winRate = summary.winRate === null ? "N/A" : `${summary.winRate.toFixed(1)}%`;
  const pnlText = `${summary.totalPnlPoints > 0 ? "+" : ""}${summary.totalPnlPoints.toFixed(2)} pts`;
  const activeContentTitle = selectedItem ? `時段 ${selectedItem.time} 詳細報告` : "每日審計報告";
  const sourceLabel = data?.source === "d1" ? "D1 primary" : data?.source === "kv" ? "KV fallback" : "No data";
  const auditReportParts = useMemo(() => splitAuditReport(data?.auditReport || ""), [data?.auditReport]);
  const performance = data?.performance?.buckets || [];
  const performanceSamples = performance.reduce((sum, bucket) => sum + bucket.sampleCount, 0);
  const performanceWins = performance.reduce((sum, bucket) => sum + bucket.successCount, 0);
  const proxyHitRate = performanceSamples > 0 ? `${((performanceWins / performanceSamples) * 100).toFixed(1)}%` : "N/A";

  return (
    <div className="h-full w-full overflow-y-auto bg-[#08090d] px-4 pb-16 pt-8 text-zinc-100 sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
              <Activity className="h-3.5 w-3.5" />
              SPX Recap
            </div>
            <h1 className="text-3xl font-black tracking-normal text-white sm:text-5xl">每日情報</h1>
            <p className="mt-2 text-sm text-zinc-500">Telegram bot 歷史績效與 0DTE 審計報告</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className={`inline-flex h-11 items-center gap-2 border px-3 text-xs font-black uppercase tracking-[0.14em] ${
              data?.source === "d1"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/35 bg-amber-500/10 text-amber-200"
            }`}>
              <Database className="h-4 w-4" />
              {sourceLabel}
            </div>
            <div className="inline-flex h-11 items-center gap-2 border border-white/10 bg-[#101118] px-3 text-sm font-bold text-zinc-200">
              <Target className="h-4 w-4 text-amber-300" />
              <span>SPX</span>
            </div>
            <label className="inline-flex h-11 items-center gap-2 border border-white/10 bg-[#101118] px-3 text-sm font-bold text-zinc-200">
              <CalendarDays className="h-4 w-4 text-zinc-500" />
              <select
                value={selectedDate}
                onChange={(event) => void fetchRecap(event.target.value, rangeFrom, rangeTo)}
                className="min-w-[9.5rem] bg-transparent text-white outline-none"
                disabled={loading || !data?.availableDates.length}
              >
                {(data?.availableDates || []).map((date) => (
                  <option key={date} value={date} className="bg-[#101118] text-white">
                    {date}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <section className="mb-8 grid gap-4 md:grid-cols-3">
          <KpiCard label="SPX Proxy Samples" value={String(performanceSamples)} accent="border-sky-500/30" icon={<Target className="h-5 w-5" />} />
          <KpiCard label="15m Proxy Hit Rate" value={proxyHitRate} accent="border-amber-500/30" icon={<Activity className="h-5 w-5" />} />
          <KpiCard label="Retention" value={`${data?.retention?.recapDays || 90}d recap`} accent="border-violet-500/30" icon={<Database className="h-5 w-5" />} />
        </section>
        <p className="mb-8 text-xs text-zinc-500">{data?.performance?.label || "SPX direction proxy · not option P&L"}。Raw decision 保留 {data?.retention?.rawDays || 30} 日。</p>

        {Boolean(data?.warnings?.length) && (
          <div className="mb-6 border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs font-semibold leading-6 text-amber-100">
            {data?.warnings?.join(" | ")}
          </div>
        )}

        {error && (
          <div className="mb-6 border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm font-semibold text-rose-200">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex h-72 items-center justify-center border border-white/10 bg-[#101118]">
            <Loader2 className="h-6 w-6 animate-spin text-amber-300" />
          </div>
        ) : (
          <>
            <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="真實勝率"
                value={winRate}
                accent="border-amber-500/35"
                icon={<BarChart3 className="h-5 w-5" />}
              />
              <KpiCard
                label="實際出手"
                value={String(summary.tradesTaken)}
                accent="border-violet-500/25"
                icon={<Target className="h-5 w-5" />}
              />
              <KpiCard
                label="盈利 / 止損"
                value={`${summary.wins} / ${summary.losses}`}
                accent="border-emerald-500/25"
                icon={<CheckCircle2 className="h-5 w-5" />}
              />
              <KpiCard
                label="淨 PnL"
                value={pnlText}
                accent={summary.totalPnlPoints >= 0 ? "border-emerald-500/35" : "border-rose-500/35"}
                icon={
                  summary.totalPnlPoints >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />
                }
              />
            </section>

            <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="border border-white/10 bg-[#0f1016] px-4 py-3">
                <p className="text-xs text-zinc-500">總播報</p>
                <p className="mt-1 text-xl font-black">{summary.totalCallouts}</p>
              </div>
              <div className="border border-white/10 bg-[#0f1016] px-4 py-3">
                <p className="text-xs text-zinc-500">空倉防守</p>
                <p className="mt-1 text-xl font-black text-sky-300">{summary.defensiveHolds}</p>
              </div>
              <div className="border border-white/10 bg-[#0f1016] px-4 py-3">
                <p className="text-xs text-zinc-500">平手離場</p>
                <p className="mt-1 text-xl font-black text-zinc-200">{summary.flatCloses}</p>
              </div>
              <div className="border border-white/10 bg-[#0f1016] px-4 py-3">
                <p className="text-xs text-zinc-500">IC 事件</p>
                <p className="mt-1 text-xl font-black text-amber-300">{summary.icEvents}</p>
              </div>
            </section>

            <section className="mb-5 border border-white/10 bg-[#101118] p-4">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-white">
                    <BarChart3 className="h-4 w-4 text-amber-300" />
                    Range Analytics
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">只計結構化 callout / PnL，唔用 AI 補數。</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={rangeFrom}
                    onChange={(event) => setRangeFrom(event.target.value)}
                    className="h-9 border border-white/10 bg-[#08090d] px-3 text-xs font-bold text-white outline-none"
                    disabled={!data?.availableDates.length}
                  >
                    {(data?.availableDates || []).slice().reverse().map((date) => (
                      <option key={date} value={date} className="bg-[#101118]">
                        {date}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rangeTo}
                    onChange={(event) => setRangeTo(event.target.value)}
                    className="h-9 border border-white/10 bg-[#08090d] px-3 text-xs font-bold text-white outline-none"
                    disabled={!data?.availableDates.length}
                  >
                    {(data?.availableDates || []).slice().reverse().map((date) => (
                      <option key={date} value={date} className="bg-[#101118]">
                        {date}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void fetchRecap(selectedDate, rangeFrom, rangeTo)}
                    className="h-9 border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-black text-amber-100 hover:bg-amber-500/20"
                  >
                    更新區間
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="border border-white/10 bg-black/20 p-3">
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">PnL Equity Curve</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={equityData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}
                        labelStyle={{ color: "#fbbf24" }}
                      />
                      <Line type="monotone" dataKey="cumulative" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="border border-white/10 bg-black/20 p-3">
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Daily PnL</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={equityData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}
                        labelStyle={{ color: "#fbbf24" }}
                      />
                      <Bar dataKey="dailyPnl" radius={[2, 2, 0, 0]}>
                        {equityData.map((item) => (
                          <Cell key={item.fullDate} fill={item.dailyPnl >= 0 ? "#34d399" : "#fb7185"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="mb-5 border border-white/10 bg-[#101118] p-4">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
                  <Clock3 className="h-4 w-4 text-zinc-500" />
                  時段信號速覽
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedItemId(null)}
                  className={`h-9 border px-3 text-xs font-bold transition-colors ${
                    selectedItemId === null
                      ? "border-amber-400 bg-amber-500/15 text-amber-200"
                      : "border-white/10 text-zinc-400 hover:border-amber-400/50 hover:text-amber-200"
                  }`}
                >
                  <FileText className="mr-1 inline h-3.5 w-3.5" />
                  每日審計報告
                </button>
              </div>

              {data?.timeline.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
                  {data.timeline.map((item) => {
                    const meta = statusMeta[item.status];
                    const isActive = selectedItemId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedItemId(item.id)}
                        className={`h-8 border px-2 text-xs font-mono transition-colors ${isActive ? "border-amber-400 bg-amber-500/15 text-amber-100" : `${meta.border} text-zinc-300 hover:border-amber-400/60 hover:text-white`}`}
                      >
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 ${meta.dot}`} />
                        {item.time}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="border border-dashed border-white/10 py-10 text-center text-sm text-zinc-500">
                  呢日未有 callout 記錄。
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
                {Object.entries(statusMeta).map(([status, meta]) => (
                  <span key={status} className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 ${meta.dot}`} />
                    {meta.label}
                  </span>
                ))}
              </div>
            </section>

            <section className="mb-5 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="flex min-h-[28rem] flex-col border border-white/10 bg-[#101118] p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-black text-white">
                    <ListFilter className="h-4 w-4 text-amber-300" />
                    Callout Table
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as TimelineStatus | "all")}
                    className="h-9 border border-white/10 bg-[#08090d] px-3 text-xs font-bold text-white outline-none"
                  >
                    <option value="all" className="bg-[#101118]">全部狀態</option>
                    {Object.entries(statusMeta).map(([status, meta]) => (
                      <option key={status} value={status} className="bg-[#101118]">
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-h-[24rem] flex-1 overflow-auto border border-white/10">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="sticky top-0 bg-[#0b0c11] text-zinc-500">
                      <tr>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2">Price</th>
                        <th className="px-3 py-2">PnL</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTimeline.map((item) => (
                        <tr key={item.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                          <td className="px-3 py-2 font-mono text-zinc-300">{item.time}</td>
                          <td className={`px-3 py-2 font-bold ${statusMeta[item.status].text}`}>{statusMeta[item.status].label}</td>
                          <td className="px-3 py-2 text-zinc-400">{item.positionSide || "NONE"}</td>
                          <td className="px-3 py-2 font-mono text-zinc-300">{formatPrice(item.price)}</td>
                          <td className={`px-3 py-2 font-mono font-bold ${item.pnl !== null && item.pnl < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                            {formatPnl(item.pnl)}
                          </td>
                          <td className="max-w-[18rem] truncate px-3 py-2 text-zinc-300">{item.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-white/10 bg-[#101118] p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-black text-white">
                  <BookOpen className="h-4 w-4 text-amber-300" />
                  Learned Rules
                </div>
                <div className="space-y-3">
                  {(data?.analytics?.learnedRules || data?.auditMeta?.learnedRules?.map((text) => ({ sourceDate: selectedDate, text })) || [])
                    .slice(0, 8)
                    .map((rule, index) => (
                      <div key={`${rule.sourceDate || "kv"}-${index}`} className="border border-white/10 bg-black/20 p-3">
                        <p className="mb-1 text-[11px] font-bold text-amber-300">{rule.sourceDate || "SPX_WISDOM_BOOK"}</p>
                        <p className="text-xs leading-5 text-zinc-300">{rule.text}</p>
                      </div>
                    ))}
                  {!(data?.analytics?.learnedRules?.length || data?.auditMeta?.learnedRules?.length) && (
                    <p className="text-sm text-zinc-500">未有已存 learned rules。</p>
                  )}
                </div>
              </div>
            </section>

            <section className="mb-5 border border-white/10 bg-[#101118] p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-white">
                <CalendarDays className="h-4 w-4 text-amber-300" />
                Day-by-Day Summary
              </div>
              <div className="overflow-auto border border-white/10">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-[#0b0c11] text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Callouts</th>
                      <th className="px-3 py-2">Trades</th>
                      <th className="px-3 py-2">W/L/F</th>
                      <th className="px-3 py-2">Defense</th>
                      <th className="px-3 py-2">IC</th>
                      <th className="px-3 py-2">Win Rate</th>
                      <th className="px-3 py-2">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsDays.map((day) => (
                      <tr key={day.date} className="border-t border-white/5 hover:bg-white/[0.03]">
                        <td className="px-3 py-2 font-mono text-zinc-200">{day.date}</td>
                        <td className="px-3 py-2">{day.totalCallouts}</td>
                        <td className="px-3 py-2">{day.tradesTaken}</td>
                        <td className="px-3 py-2">{day.wins}/{day.losses}/{day.flatCloses}</td>
                        <td className="px-3 py-2 text-sky-300">{day.defensiveHolds}</td>
                        <td className="px-3 py-2 text-amber-300">{day.icEvents}</td>
                        <td className="px-3 py-2">{day.winRate === null ? "N/A" : `${day.winRate.toFixed(1)}%`}</td>
                        <td className={`px-3 py-2 font-mono font-bold ${day.totalPnlPoints < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                          {day.totalPnlPoints > 0 ? "+" : ""}{day.totalPnlPoints.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="border border-white/10 bg-[#101118] p-5 sm:p-7">
              <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div className="flex items-center gap-2 font-black text-white">
                  {selectedItem ? <Activity className="h-4 w-4 text-amber-300" /> : <FileText className="h-4 w-4 text-amber-300" />}
                  {activeContentTitle}
                </div>
                {selectedItem && (
                  <button type="button" onClick={() => setSelectedItemId(null)} className="text-xs font-bold text-zinc-500 hover:text-amber-200">
                    返回總結
                  </button>
                )}
              </div>

              {selectedItem ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="border border-white/10 bg-black/20 px-4 py-3">
                      <p className="text-xs text-zinc-500">美東時間</p>
                      <p className="mt-1 font-mono text-lg font-black text-white">{selectedItem.timestamp || selectedItem.time}</p>
                    </div>
                    <div className="border border-white/10 bg-black/20 px-4 py-3">
                      <p className="text-xs text-zinc-500">SPX 價格</p>
                      <p className="mt-1 font-mono text-lg font-black text-white">{formatPrice(selectedItem.price)}</p>
                    </div>
                    <div className={`border bg-black/20 px-4 py-3 ${statusMeta[selectedItem.status].border}`}>
                      <p className="text-xs text-zinc-500">狀態 / PnL</p>
                      <p className={`mt-1 text-lg font-black ${statusMeta[selectedItem.status].text}`}>
                        {statusMeta[selectedItem.status].label} · {formatPnl(selectedItem.pnl)}
                      </p>
                    </div>
                  </div>

                  <div className="border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
                      {selectedItem.status === "loss" ? <XCircle className="h-4 w-4 text-rose-300" /> : <Shield className="h-4 w-4 text-amber-300" />}
                      {selectedItem.action}
                    </div>
                    <p className="text-sm leading-7 text-zinc-300">{selectedItem.reasoning}</p>
                  </div>
                </div>
              ) : (
                <div className="max-w-none space-y-4 text-sm leading-7 text-zinc-300 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-amber-200 [&_h3]:pt-3 [&_h3]:text-base [&_h3]:font-black [&_h3]:text-white [&_li]:my-1 [&_li::marker]:text-amber-300 [&_strong]:text-white">
                  {auditReportParts.before && (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{auditReportParts.before}</ReactMarkdown>
                  )}
                  <AuditTimeline items={data?.timeline || []} onSelect={setSelectedItemId} />
                  {auditReportParts.after && (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{auditReportParts.after}</ReactMarkdown>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
