import type { SentimentApiResult, SentimentComponent } from "@/lib/market-sentiment";

interface SentimentGaugeProps {
  sentiment?: number | null;
  sentimentSource?: string;
  sentimentData?: SentimentApiResult | null;
  news?: { title: string }[];
  quantStrategies?: { name: string; score: number }[];
}

function clampScore(score: number | null | undefined) {
  return Math.max(0, Math.min(100, Number(score ?? 0)));
}

function labelForScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "N/A";
  if (score <= 20) return "Extreme fear";
  if (score <= 40) return "Fear";
  if (score <= 60) return "Neutral";
  if (score <= 80) return "Greed";
  return "Extreme greed";
}

function colorForScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "#94a3b8";
  if (score <= 42) return "#ef4444";
  if (score >= 58) return "#10b981";
  return "#8b5cf6";
}

function statusClass(status: SentimentComponent["status"]) {
  if (status === "bullish") return "bg-emerald-50 text-emerald-700";
  if (status === "bearish") return "bg-red-50 text-red-700";
  if (status === "neutral") return "bg-violet-50 text-violet-700";
  return "bg-slate-100 text-slate-500";
}

export function SentimentGauge({
  sentiment,
  sentimentSource,
  sentimentData,
  news = [],
  quantStrategies = [],
}: SentimentGaugeProps) {
  const score = sentimentData?.score ?? sentiment ?? null;
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const clampedScore = clampScore(score);
  const color = colorForScore(score);
  const sourceType = sentimentData?.sourceType || (hasScore ? "proxy" : "unavailable");
  const sourceLabel = sentimentData?.sourceLabel || sentimentSource || "not connected";
  const title = sourceType === "retail" ? "Retail sentiment" : sourceType === "proxy" ? "Market Mood Proxy" : "Sentiment unavailable";
  const coverage = sentimentData?.coverage || (hasScore ? "legacy score" : "0/4 components");
  const components = (sentimentData?.components || []).slice(0, 4);
  const warnings = sentimentData?.warnings || [];

  const radius = 50;
  const strokeWidth = 10;
  const center = 65;
  const calculateCoordinates = (value: number) => {
    const angle = 140 + (value / 100) * 260;
    const rad = (angle - 90) * (Math.PI / 180.0);
    return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
  };

  const start = calculateCoordinates(0);
  const end = calculateCoordinates(100);
  const current = calculateCoordinates(clampedScore);
  const bgPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 1 1 ${end.x} ${end.y}`;
  const currentLargeArcFlag = (clampedScore / 100) * 260 > 180 ? 1 : 0;
  const valPath = !hasScore || clampedScore === 0 ? "" : `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${currentLargeArcFlag} 1 ${current.x} ${current.y}`;

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest">
            {title} ({quantStrategies.length})
          </div>
          <div className="mt-1 text-[11px] font-bold text-gray-500">{coverage}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
          sourceType === "retail" ? "bg-emerald-50 text-emerald-700" : sourceType === "proxy" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"
        }`}>
          {sourceType}
        </span>
      </div>

      <div className="flex items-start gap-4">
        <div className="relative h-[110px] w-[110px] flex-shrink-0">
          <svg viewBox="0 0 130 130" className="h-full w-full">
            <defs>
              <linearGradient id="sentimentGaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <path d={bgPath} fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth} strokeLinecap="round" />
            {hasScore && (
              <path d={valPath} fill="none" stroke="url(#sentimentGaugeGradient)" strokeWidth={strokeWidth} strokeLinecap="round" />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
            <span className="text-2xl font-black text-gray-900">{hasScore ? clampedScore : "N/A"}</span>
            <span className="text-[9px] font-black uppercase tracking-wider" style={{ color }}>
              {labelForScore(score)}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {components.length > 0 ? (
            components.map((component) => (
              <div key={component.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-black text-gray-900">{component.label}</div>
                    <div className="mt-0.5 truncate text-[10px] font-semibold text-gray-500">{component.detail}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${statusClass(component.status)}`}>
                      {component.status}
                    </span>
                    <span className="w-7 text-right text-xs font-black text-gray-800">{component.score ?? "N/A"}</span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
              No usable sentiment or proxy components connected. Loaded news: {news.length}.
            </div>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-5 text-amber-800">
          {warnings[0]}
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 pt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Sentiment source: {sourceLabel}
      </div>
    </div>
  );
}
