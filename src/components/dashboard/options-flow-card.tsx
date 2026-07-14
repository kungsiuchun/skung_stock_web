interface OptionStrike {
  strike: number;
  callOI: number;
  putOI: number;
}

interface OptionsFlowProps {
  symbol?: string;
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

const buildWatcherHref = (symbol?: string) => {
  const normalized = (symbol || "").trim().toUpperCase();
  const suffix = /^[A-Z0-9.^-]{1,12}$/.test(normalized) ? `?symbol=${encodeURIComponent(normalized)}` : "";
  return `#/work/stocks-intelligence-watcher${suffix}`;
};

export function OptionsFlowCard({ data, symbol }: OptionsFlowProps) {
  const hasOpenInterest = Boolean(data?.topStrikes?.some((row) => row.callOI + row.putOI > 0));

  if (!data || data.error || !hasOpenInterest) {
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
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">Yahoo stock options chain</p>
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
            // Use maximum single OI for width normalization to show proper VS scale
            const putWidth = (cat.putOI / highestSingleOI) * 100;
            const callWidth = (cat.callOI / highestSingleOI) * 100;
            const callDominates = cat.callOI >= cat.putOI;
            
            return (
              <div key={idx} className="grid w-full grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-1 text-xs">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="w-8 shrink-0 text-right font-bold tabular-nums text-gray-600">{formatValue(cat.putOI)}</span>
                  <div className="flex-1 border-r border-gray-200 py-0.5 pr-0.5">
                    <div className={`ml-auto h-3 rounded-l ${!callDominates ? 'bg-red-500' : 'bg-red-300'}`} style={{ width: `${putWidth}%` }} />
                  </div>
                </div>
                <div className="text-center font-medium text-gray-500">@{cat.strike}</div>
                <div className="flex min-w-0 items-center gap-1">
                  <div className="flex-1 border-l border-gray-200 py-0.5 pl-0.5">
                    <div className={`h-3 rounded-r ${callDominates ? 'bg-green-500' : 'bg-green-300'}`} style={{ width: `${callWidth}%` }} />
                  </div>
                  <span className="w-8 shrink-0 font-bold tabular-nums text-gray-600">{formatValue(cat.callOI)}</span>
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
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Stock chain layer</span>
          <a
            href={buildWatcherHref(symbol)}
            className="text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-700"
          >
            Open in Watcher
          </a>
        </div>
      </div>
    </div>
  );
}
