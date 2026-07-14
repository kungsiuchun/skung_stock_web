import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, CircleDollarSign, ShieldAlert, Target } from "lucide-react";
import { selectTopQuantStrategies, type QuantStrategy } from "@/lib/finance-analyzer-contract";

interface StrategyCardsProps {
  quantStrategies: QuantStrategy[];
  recommendedTrade?: QuantStrategy | null;
}

const formatPrice = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const actionLabel = (strategy: QuantStrategy) => ({
  EXECUTABLE: "可執行",
  PENDING_TRIGGER: "等待觸發",
  NO_TRADE: "避免新倉",
  RESEARCH_ONLY: "研究限定",
})[strategy.tradeSetup.actionability];

const actionTone = (strategy: QuantStrategy) => ({
  EXECUTABLE: "bg-emerald-50 text-emerald-700 border-emerald-100",
  PENDING_TRIGGER: "bg-amber-50 text-amber-700 border-amber-100",
  NO_TRADE: "bg-red-50 text-red-700 border-red-100",
  RESEARCH_ONLY: "bg-slate-100 text-slate-600 border-slate-200",
})[strategy.tradeSetup.actionability];

const formatEntry = (strategy: QuantStrategy) => {
  const setup = strategy.tradeSetup;
  if (setup.entryType === "LIMIT_ZONE") return `${formatPrice(setup.entryLow)} – ${formatPrice(setup.entryHigh)}`;
  if (setup.entryType === "BREAKOUT_TRIGGER") return `突破 ${formatPrice(setup.triggerPrice)}`;
  return "等待條件";
};

const strategyInsight = (strategy: QuantStrategy) => strategy.tradeSetup.nextStep || strategy.reasons[0] || "策略未提供可驗證結論。";

export function StrategyCards({ quantStrategies, recommendedTrade }: StrategyCardsProps) {
  const [expandedStrategies, setExpandedStrategies] = useState<Set<string>>(new Set());
  const displayedStrategies = selectTopQuantStrategies(quantStrategies, 5);

  const toggleStrategy = (name: string) => {
    setExpandedStrategies((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-500">Deterministic Quant Engine</p>
          <h3 className="text-lg font-bold text-gray-900">量化策略結果與交易計劃</h3>
        </div>
        <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black text-gray-500">
          Top {displayedStrategies.length} of {quantStrategies.length}
        </span>
      </div>

      <div className="mb-6 space-y-2">
        {quantStrategies.length === 0 ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            量化策略結果不可用；不會以預設訊號代替。
          </div>
        ) : displayedStrategies.map((strategy, index) => {
          const key = `${strategy.name}-${index}`;
          const expanded = expandedStrategies.has(key);
          const scoreWidth = Math.max(0, Math.min(100, strategy.score));
          const setup = strategy.tradeSetup;
          return (
            <div key={key} className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleStrategy(key)}
                className="w-full p-3 text-left transition-colors hover:bg-blue-50"
              >
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{strategy.name}</span>
                  <span className={`rounded-lg border px-2 py-1 text-[10px] font-black ${actionTone(strategy)}`}>{actionLabel(strategy)}</span>
                  <span className="w-12 text-right font-mono text-sm font-black text-gray-700">{strategy.score}</span>
                  {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${scoreWidth}%` }} />
                </div>
                <p className="mt-2 truncate text-xs text-gray-600"><span className="font-bold text-gray-800">下一步：</span>{strategyInsight(strategy)}</p>
              </button>

              {expanded && (
                <div className="border-t border-gray-200 bg-white px-4 py-4 text-xs text-gray-600">
                  <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                    <p className="mb-1 font-black text-blue-800">判斷</p>
                    <p>{strategy.signal || actionLabel(strategy)} · 評分 {strategy.score}</p>
                    <p className="mt-1 font-semibold text-blue-800">下一步：{setup.nextStep}</p>
                  </div>
                  {strategy.reasons.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 flex items-center gap-1 font-black uppercase tracking-wider text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> 關鍵證據</p>
                      <ul className="space-y-1">{strategy.reasons.slice(0, 3).map((reason) => <li key={reason}>• {reason}</li>)}</ul>
                    </div>
                  )}
                  {strategy.risks.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 flex items-center gap-1 font-black uppercase tracking-wider text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> 風險／缺口</p>
                      <ul className="space-y-1">{strategy.risks.slice(0, 3).map((risk) => <li key={risk}>• {risk}</li>)}</ul>
                    </div>
                  )}

                  {setup.actionability === "EXECUTABLE" ? (
                    <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 font-mono text-[11px] sm:grid-cols-4">
                      <span><CircleDollarSign className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />入場 {formatEntry(strategy)}</span>
                      <span><ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-red-600" />SL {formatPrice(setup.stopLoss)}</span>
                      <span><Target className="mr-1 inline h-3.5 w-3.5 text-amber-600" />T1 {formatPrice(setup.target1)}</span>
                      <span>T2 {formatPrice(setup.target2)} · {setup.rewardRisk?.toFixed(2)}R</span>
                      <span className="col-span-2">失效：{setup.invalidation || "按止損執行。"}</span>
                      <span className="col-span-2">期權：支持 {formatPrice(setup.optionSupport)} / 阻力 {formatPrice(setup.optionResistance)}</span>
                    </div>
                  ) : (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="font-black text-gray-800">觸發／入場價：{formatEntry(strategy)}</p>
                      {setup.invalidation && <p className="mt-1">失效位：{setup.invalidation}</p>}
                      <p className="mt-1 text-gray-500">目前未達可執行交易資格；不顯示假止損或假目標。</p>
                    </div>
                  )}
                  <p className="mt-3 text-[10px] text-gray-400">資料時間：{strategy.asOf || "未提供"} · 期權狀態：{setup.optionsStatus}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">Recommended deterministic trade</p>
        {recommendedTrade?.tradeSetup.actionability === "EXECUTABLE" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-green-100 bg-green-50 p-4"><p className="mb-1 text-[10px] font-bold uppercase text-gray-400">策略／入場</p><p className="font-mono text-sm font-black text-green-700">{recommendedTrade.name}</p><p className="font-mono text-lg font-black text-green-600">{formatEntry(recommendedTrade)}</p></div>
            <div className="rounded-2xl border border-red-100 bg-red-50 p-4"><p className="mb-1 text-[10px] font-bold uppercase text-gray-400">止損價位</p><p className="font-mono text-xl font-black text-red-600">{formatPrice(recommendedTrade.tradeSetup.stopLoss)}</p></div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4"><p className="mb-1 text-[10px] font-bold uppercase text-gray-400">Target 1</p><p className="font-mono text-xl font-black text-amber-600">{formatPrice(recommendedTrade.tradeSetup.target1)}</p></div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><p className="mb-1 text-[10px] font-bold uppercase text-gray-400">回報／風險</p><p className="font-mono text-xl font-black text-blue-600">{recommendedTrade.tradeSetup.rewardRisk?.toFixed(2)}R</p></div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800">目前沒有通過所有規則與期權阻力檢查的可執行交易計劃；等待觸發，不強行出價。</div>
        )}
      </div>
    </div>
  );
}
