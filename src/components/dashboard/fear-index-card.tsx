import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import {
  buildVixChartData,
  getVixChartDomain,
  getVixRangeLabel,
  getVixStatus,
  getVixTone,
} from "@/lib/vix-visualization";

interface FearIndexProps {
  data: {
    value: number;
    change_pct: number;
    history: number[];
  } | null;
}

const toneStyles = {
  calm: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-100",
    line: "#059669",
    fill: "#d1fae5",
  },
  watch: {
    badge: "bg-amber-50 text-amber-700 border-amber-100",
    line: "#d97706",
    fill: "#fef3c7",
  },
  stress: {
    badge: "bg-red-50 text-red-700 border-red-100",
    line: "#dc2626",
    fill: "#fee2e2",
  },
} as const;

export function FearIndexCard({ data }: FearIndexProps) {
  if (!data || data.value === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex items-center justify-center">
        <p className="text-xs text-gray-400 font-bold uppercase">恐慌指數取得中...</p>
      </div>
    );
  }

  const chartData = buildVixChartData(data.history);
  const domain = getVixChartDomain(data.history);
  const latestPoint = chartData[chartData.length - 1];
  const status = getVixStatus(data.value);
  const tone = getVixTone(data.value);
  const styles = toneStyles[tone];
  const rangeLabel = getVixRangeLabel(data.history);
  const gradientId = `vixArea-${tone}`;
  const positiveChange = data.change_pct > 0;

  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-black text-gray-950">恐慌指數</h3>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">30D VIX trend</p>
        </div>
        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Yahoo Finance</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="text-[10px] text-gray-500 font-bold mb-0.5">最新值</div>
          <div className="text-2xl font-black text-gray-950 tabular-nums">{data.value.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="text-[10px] text-gray-500 font-bold mb-0.5">日變化</div>
          <div className={`text-sm font-black tabular-nums ${positiveChange ? "text-green-600" : "text-red-500"}`}>
            {positiveChange ? "+" : ""}
            {data.change_pct.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="text-[10px] text-gray-500 font-bold mb-1">狀態</div>
          <div className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${styles.badge}`}>
            {status}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white px-2 py-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Range {rangeLabel}</div>
          <div className="text-[10px] font-bold text-gray-400">Watch line 20</div>
        </div>

        <div className="h-[132px] w-full min-w-0">
          <ResponsiveContainer width="100%" height={132}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={styles.fill} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={styles.fill} stopOpacity={0.16} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="index"
                type="number"
                domain={[0, Math.max(chartData.length - 1, 1)]}
                ticks={[0, Math.floor((chartData.length - 1) / 2), Math.max(chartData.length - 1, 0)]}
                tickFormatter={(value) => chartData.find((point) => point.index === value)?.label ?? ""}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 700 }}
              />
              <YAxis
                orientation="right"
                domain={domain}
                width={30}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 700 }}
                tickFormatter={(value) => Number(value).toFixed(0)}
              />
              <ReferenceLine y={20} stroke="#f97316" strokeDasharray="4 4" strokeWidth={1.2} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={styles.line}
                strokeWidth={2.4}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, stroke: "#ffffff", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {latestPoint && (
                <ReferenceDot
                  x={latestPoint.index}
                  y={latestPoint.value}
                  r={4}
                  fill={styles.line}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
