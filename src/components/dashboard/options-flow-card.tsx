interface OptionStrike {
  strike: number;
  callOI: number;
  putOI: number;
}

interface OptionsFlowProps {
  data: {
    totalCallOI: number;
    totalPutOI: number;
    ratio: number;
    topStrikes: OptionStrike[];
    expirationDate?: string;
    interpretation?: string;
    error?: string;
  };
}

export function OptionsFlowCard({ data }: OptionsFlowProps) {
  if (!data || data.error || !data.topStrikes || data.topStrikes.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col items-center justify-center text-center py-10 h-full min-h-[280px]">
         <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">無期權數據</p>
         <p className="text-[10px] text-gray-400 mt-2 px-2">
           {data?.error || "服務器暫未返回該標的的期權鏈數據。"}
         </p>
      </div>
    );
  }

  const formatValue = (val: number) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    return val.toString();
  };

  const isBullish = data.totalCallOI > data.totalPutOI;
  const highestSingleOI = Math.max(...data.topStrikes.flatMap(s => [s.callOI, s.putOI]), 1);

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm h-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">期權多空比 (C/P)</h3>
            {data.expirationDate && (
              <p className="text-[10px] text-gray-400 font-medium mt-0.5 tracking-wider border border-gray-100 bg-gray-50 px-1.5 py-0.5 rounded inline-block">EXP: {data.expirationDate}</p>
            )}
          </div>
          <div className={`text-xs font-bold ${isBullish ? 'text-green-500' : 'text-red-500'}`}>
            Call/Put {data.ratio.toFixed(2)}
          </div>
        </div>

        <div className="space-y-3 mt-2">
          <div className="flex justify-between px-12 text-[10px] text-gray-400 font-bold mb-1">
             <span>Put 未平倉 (看跌)</span>
             <span>Call 未平倉 (看漲)</span>
          </div>
          {data.topStrikes.map((cat, idx) => {
            const rowTotal = cat.callOI + cat.putOI || 1;
            // Use maximum single OI for width normalization to show proper VS scale
            const putWidth = Math.max((cat.putOI / highestSingleOI) * 100, 2);
            const callWidth = Math.max((cat.callOI / highestSingleOI) * 100, 2);
            const callDominates = cat.callOI >= cat.putOI;
            
            return (
              <div key={idx} className="flex items-center gap-2 w-full text-xs">
                <div className="w-10 text-gray-500 text-right font-medium">@{cat.strike}</div>
                <div className="flex-1 flex items-center">
                  {/* Outflow / Put side */}
                  <div className="flex-1 flex justify-end">
                    <div className={`h-4 rounded-l ${!callDominates ? 'bg-red-500' : 'bg-red-300'}`} style={{ width: `${putWidth}%` }} />
                  </div>
                  <div className="w-px h-5 bg-gray-200 mx-0.5" />
                  {/* Inflow / Call side */}
                  <div className="flex-1">
                    <div className={`h-4 rounded-r ${callDominates ? 'bg-green-500' : 'bg-green-300'}`} style={{ width: `${callWidth}%` }} />
                  </div>
                </div>
                <div className={`w-16 text-right font-bold tabular-nums text-gray-600`}>
                  {formatValue(rowTotal)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
        <p className="text-[10px] text-gray-600 leading-relaxed font-medium">
          {data.interpretation || (isBullish ? "Call 未平倉量佔優，市場預期偏向看漲。" : "Put 未平倉量佔優，市場避險情緒較高。")}
        </p>
      </div>
    </div>
  );
}
