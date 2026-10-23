import { Activity } from "lucide-react";
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <div>
          <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-600" />
            交易風險快照
          </h3>
          <p className="mt-1 text-[10px] font-semibold leading-4 text-gray-500">
            Yahoo K 線資料，本地規則計算
          </p>
        </div>
      </div>

      {snapshot.invalidBarCount > 0 && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{snapshot.invalidBarCount} 筆日線價量資料無效，風險指標已停止計算。請刷新研究資料。</p>}
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

      <details className="mt-2 border-t border-slate-100 text-xs text-slate-500">
        <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">計算方式</summary>
        <p className="pb-2 leading-5">{snapshot.source}</p>
      </details>
    </div>
  );
}
