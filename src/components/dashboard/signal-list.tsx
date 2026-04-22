import { Zap, TrendingUp, TrendingDown, Radio } from "lucide-react";

interface Signal {
  title: string;
  summary: string;
  sentiment: number;
  confidence: number;
  intensity: number;
}

interface SignalListProps {
  signals: Signal[];
  generatedAt?: string;
}

export function SignalList({ signals, generatedAt }: SignalListProps) {
  if (!Array.isArray(signals)) {
    return (
      <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm h-full flex flex-col items-center justify-center text-center">
         <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-4">
            <Radio className="w-6 h-6 text-gray-400" />
         </div>
         <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">高頻預警頻道</p>
         <p className="text-[10px] text-gray-400 mt-2">暫無市場預警訊號</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-[10px] font-bold text-blue-600 tracking-[0.2em] uppercase mb-1">Market Signals</p>
          <h3 className="text-lg font-bold text-gray-900">DeepEar 高頻預警</h3>
        </div>
        <div className="text-[10px] font-mono text-gray-400">
          {generatedAt || "即時更新"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4 scrollbar-thin">
        {signals.map((signal, i) => (
          <div key={i} className="p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:border-blue-200 transition-all group">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${signal.sentiment > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                   {signal.sentiment > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                </div>
                <h4 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{signal.title}</h4>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="px-2 py-0.5 rounded-md bg-white border border-gray-200 text-[10px] font-bold text-gray-500">
                  可信度 {(signal.confidence * 10).toFixed(0)}%
                </div>
              </div>
            </div>
            
            <p className="text-xs text-gray-600 leading-relaxed mb-3 font-medium">
              {signal.summary}
            </p>

            <div className="flex items-center gap-4">
               <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${signal.intensity > 7 ? 'bg-orange-500' : 'bg-blue-500'}`}
                    style={{ width: `${signal.intensity * 10}%` }}
                  />
               </div>
               <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">強度 {signal.intensity}</span>
            </div>
          </div>
        ))}

        {signals.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center opacity-30 py-12 text-gray-400">
            <Zap className="w-12 h-12 mb-4" />
            <p className="text-sm">尚無追蹤信號</p>
          </div>
        ) }
      </div>
    </div>
  );
}
