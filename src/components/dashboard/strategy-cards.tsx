import { CheckCircle2, TrendingUp } from "lucide-react";

interface StrategyCardsProps {
  signal: string;
  trend: string;
  price: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export function StrategyCards({ signal, trend, price, entry: propEntry, stopLoss, takeProfit }: StrategyCardsProps) {
  const safePrice = (typeof price === 'number' && isFinite(price)) ? price : 0;
  
  const getSignalColor = (sig: string) => {
    if (!sig) return "text-gray-400 border-gray-200 bg-gray-50";
    if (sig.includes("買入") || sig.includes("BUY")) return "text-green-600 border-green-200 bg-green-50";
    if (sig.includes("賣出") || sig.includes("SELL")) return "text-red-600 border-red-200 bg-red-50";
    return "text-blue-600 border-blue-200 bg-blue-50";
  };

  const signalStyle = getSignalColor(signal);

  const entry = (typeof propEntry === 'number' && isFinite(propEntry) && propEntry > 0) ? propEntry : safePrice;
  const secondary = entry * 0.98; 
  const sl = (typeof stopLoss === 'number' && isFinite(stopLoss) && stopLoss > 0) ? stopLoss : entry * 0.95;
  const tp = (typeof takeProfit === 'number' && isFinite(takeProfit) && takeProfit > 0) ? takeProfit : entry * 1.05;

  const formatPrice = (val: number) => {
    if (!isFinite(val)) return "---";
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
           <p className="text-[10px] font-bold text-blue-500 tracking-[0.2em] uppercase mb-1">Strategy Execution</p>
           <h3 className="text-lg font-bold text-gray-900">策略對沖與點位</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
          <div className="text-gray-400 text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            操作建議
          </div>
          <div className={`text-lg font-black px-4 py-1.5 rounded-xl border inline-block ${signalStyle}`}>
            {signal || "觀望"}
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
          <div className="text-gray-400 text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
            <TrendingUp className="w-3 h-3 text-yellow-500" />
            當前趨勢
          </div>
          <div className="text-lg font-black text-gray-900">
            {trend || "震盪"}
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-green-50 border border-green-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">理想買入</p>
            <p className="text-xl font-mono font-black text-green-600">{formatPrice(entry)}</p>
          </div>
          <div className="p-4 rounded-2xl bg-red-50 border border-red-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">止損價位</p>
            <p className="text-xl font-mono font-black text-red-600">{formatPrice(sl)}</p>
          </div>
          <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">二次補倉</p>
            <p className="text-xl font-mono font-black text-blue-600">{formatPrice(secondary)}</p>
          </div>
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">止盈目標</p>
            <p className="text-xl font-mono font-black text-amber-600">{formatPrice(tp)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
