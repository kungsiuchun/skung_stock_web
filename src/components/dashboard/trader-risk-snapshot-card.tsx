import { Activity, BarChart3 } from "lucide-react";
import { deriveTraderRiskSnapshot, type TraderRiskCandle, type TraderRiskBar } from "@/lib/trader-risk-snapshot";

interface TraderRiskSnapshotCardProps {
  data: TraderRiskCandle[];
}

const toneClass: Record<TraderRiskBar["tone"], string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
  red: "bg-red-50 text-red-700 border-red-100",
  gray: "bg-gray-50 text-gray-500 border-gray-100",
};

export function TraderRiskSnapshotCard({ data }: TraderRiskSnapshotCardProps) {
  const snapshot = deriveTraderRiskSnapshot(data);

  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-600" />
            交易風險快照
          </h3>
          <p className="mt-1 text-[10px] font-semibold leading-4 text-gray-500">
            Yahoo K 線資料，本地規則計算
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-cyan-100 bg-cyan-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-cyan-700">
          DATA FIRST
        </span>
      </div>

      <div className="divide-y divide-gray-100">
        {snapshot.bars.map((bar) => (
          <div key={bar.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-black text-gray-900">{bar.label}</p>
              <p className="mt-0.5 text-[10px] font-medium text-gray-500">{bar.detail}</p>
            </div>
            <div className={`shrink-0 rounded-xl border px-3 py-2 text-right ${toneClass[bar.tone]}`}>
              <p className="text-[12px] font-black tabular-nums">{bar.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
        <BarChart3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
        <p className="text-[10px] font-semibold leading-4 text-gray-500">{snapshot.source}</p>
      </div>
    </div>
  );
}
