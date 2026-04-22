import { Zap, TrendingUp, TrendingDown, AlignLeft, BarChart2 } from "lucide-react";

export interface DeepEarSignal {
  symbol: string;
  title: string;
  summary: string;
  sentiment: number; // 1: positive, -1: negative, 0: neutral
  confidence: number;
  intensity: number;
}

interface DeepEarSignalsCardProps {
  signals: DeepEarSignal[];
}

export function DeepEarSignalsCard({ signals }: DeepEarSignalsCardProps) {
  if (!signals || signals.length === 0) {
    return (
      <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-5 mt-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-500" />
            DeepEar 高頻預警
          </h3>
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider bg-gray-50 px-2 py-1 rounded">DEEPEAR LITE</span>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
          <Zap className="w-6 h-6 text-gray-300 mb-2" />
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">目前無市場異常波動信號</p>
          <p className="text-[10px] text-gray-400 mt-1">AI Agent 暫未偵測到該資產的高頻技術面異動</p>
        </div>
      </div>
    );
  }

  // To keep it compact, maybe only show the top 3 high intensity signals
  const topSignals = [...signals].sort((a, b) => b.intensity - a.intensity).slice(0, 3);

  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-5 mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Zap className="w-4 h-4 text-purple-500" />
          DeepEar 高頻預警
        </h3>
        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider bg-gray-50 px-2 py-1 rounded">DEEPEAR LITE</span>
      </div>

      <div className="space-y-4">
        {topSignals.map((sig, idx) => {
          const isPositive = sig.sentiment > 0;
          const isNegative = sig.sentiment < 0;
          const SentimentIcon = isPositive ? TrendingUp : (isNegative ? TrendingDown : AlignLeft);
          const sentimentColor = isPositive ? "text-green-500" : (isNegative ? "text-red-500" : "text-gray-500");
          const sentimentBg = isPositive ? "bg-green-50" : (isNegative ? "bg-red-50" : "bg-gray-50");
          const sentimentText = isPositive ? "正向 (漲/增)" : (isNegative ? "負向 (跌/減)" : "中性");

          return (
            <div key={idx} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h4 className="text-xs font-bold text-gray-800 line-clamp-1 flex items-center gap-2">
                     {sig.title}
                  </h4>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                {/* Sentiment */}
                <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${sentimentBg} w-fit`}>
                  <SentimentIcon className={`w-3.5 h-3.5 ${sentimentColor}`} />
                  <span className={`text-[10px] font-bold ${sentimentColor}`}>情緒: {sentimentText}</span>
                </div>

                {/* Intensity & Confidence */}
                <div className="flex items-center justify-end gap-3 text-[10px] text-gray-500 font-medium">
                  <div className="flex items-center gap-1" title="指標評分 (Intensity)">
                    <BarChart2 className="w-3 h-3" />
                    <span>強度 {sig.intensity}/10</span>
                  </div>
                  <div className="flex items-center gap-1" title="信心度 (Confidence)">
                    <Zap className="w-3 h-3" />
                    <span>信心 {Math.round(sig.confidence * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Summary */}
              <p className="text-[11px] text-gray-600 leading-relaxed bg-gray-50 p-2 rounded-lg mt-1 italic line-clamp-2">
                {sig.summary}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
