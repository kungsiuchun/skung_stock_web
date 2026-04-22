import { Activity, TrendingUp, TrendingDown, Crosshair } from "lucide-react";

interface TechnicalData {
  ma_alignment?: string;
  is_bullish?: boolean;
  is_bearish?: boolean;
  rsi_14?: number;
  rsi_signal?: string;
  rsi_status?: "oversold" | "overbought" | "neutral";
  position_percent?: number;
  error?: string;
}

export function TechnicalRadar({ data, loading }: { data: TechnicalData | null, loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-white border border-gray-100 shadow-sm rounded-3xl p-5 mb-6 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
        <div className="h-10 w-full bg-gray-100 rounded mb-3"></div>
        <div className="h-10 w-full bg-gray-100 rounded"></div>
      </div>
    );
  }

  if (data?.error || !data) {
    return null; // Fail silently or hide if no technical data
  }

  // American Convention: Green = Good/Up/Buy Signal (RSI < 30 is technically a buy signal/oversold), Red = Bad/Down/Risk
  // Wait, RSI > 70 is overbought, risk is high, so Red.
  // RSI < 30 is oversold, risk is low, so Green.
  
  let rsiColor = "text-gray-600 bg-gray-100";
  let rsiBarColor = "bg-gray-400";
  if (data.rsi_status === "overbought") {
    rsiColor = "text-red-600 bg-red-50";
    rsiBarColor = "bg-red-500";
  } else if (data.rsi_status === "oversold") {
    rsiColor = "text-green-600 bg-green-50";
    rsiBarColor = "bg-green-500";
  } else {
    // Gradient map based on RSI value
    if (data.rsi_14 && data.rsi_14 > 50) {
      rsiBarColor = "bg-orange-300"; // Leaning warm
    } else {
      rsiBarColor = "bg-emerald-300"; // Leaning cool
    }
  }

  const maIcon = data.is_bullish ? <TrendingUp className="w-4 h-4 text-green-500" /> : 
                 data.is_bearish ? <TrendingDown className="w-4 h-4 text-red-500" /> : 
                 <Activity className="w-4 h-4 text-gray-400" />;

  const maBg = data.is_bullish ? "bg-green-50 border-green-100" : 
               data.is_bearish ? "bg-red-50 border-red-100" : 
               "bg-gray-50 border-gray-100";

  return (
    <div className="bg-white border border-gray-100 shadow-sm rounded-3xl p-5 mb-6">
      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
        <Crosshair className="w-4 h-4 text-blue-500" />
        技術指標雷達 (Tech Radar)
      </h3>

      <div className="space-y-4">
        {/* MA Alignment */}
        <div className={`flex items-center justify-between p-3 rounded-xl border ${maBg}`}>
          <div className="flex items-center gap-2">
            {maIcon}
            <span className="text-xs font-bold text-gray-700">均線排列 (MA)</span>
          </div>
          <span className="text-xs font-bold text-gray-900">{data.ma_alignment}</span>
        </div>

        {/* RSI Meter */}
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-700">RSI (14天)</span>
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${rsiColor}`}>
              {data.rsi_14} - {data.rsi_signal}
            </div>
          </div>
          
          {/* Progress Bar for RSI */}
          <div className="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className={`absolute top-0 left-0 h-full ${rsiBarColor}`} 
              style={{ width: `${Math.min(100, Math.max(0, data.rsi_14 || 50))}%` }}
            ></div>
            {/* Markers for 30 and 70 */}
            <div className="absolute top-0 bottom-0 left-[30%] w-px bg-white/50 border-r border-dashed border-gray-400"></div>
            <div className="absolute top-0 bottom-0 left-[70%] w-px bg-white/50 border-r border-dashed border-gray-400"></div>
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-gray-400 font-bold px-1">
            <span>超賣 (0-30)</span>
            <span>中性</span>
            <span>超買 (70-100)</span>
          </div>
        </div>

      </div>
    </div>
  );
}
