import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface FearIndexProps {
  data: {
    value: number;
    change_pct: number;
    history: number[];
  } | null;
}

export function FearIndexCard({ data }: FearIndexProps) {
  if (!data || data.value === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex items-center justify-center">
        <p className="text-xs text-gray-400 font-bold uppercase">恐慌指數取得中...</p>
      </div>
    );
  }

  const chartData = data.history.map((val, i) => ({ index: i, value: val }));
  
  let status = "平穩";
  if (data.value >= 20) status = "恐慌";
  else if (data.value >= 15) status = "偏緊張";
  
  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-5">
       <div className="flex justify-between items-start mb-3">
         <h3 className="text-sm font-bold text-gray-900">恐慌指數</h3>
         <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Yahoo Finance</span>
       </div>
       
       <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-gray-500 font-bold mb-0.5">最新值</div>
            <div className="text-xl font-black text-gray-900">{data.value.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 font-bold mb-0.5">日變化</div>
            <div className={`text-sm font-black ${data.change_pct > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {data.change_pct > 0 ? '+' : ''}{data.change_pct}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 font-bold mb-0.5">狀態</div>
            <div className="text-sm font-black text-gray-900">{status}</div>
          </div>
       </div>

       <p className="text-[10px] text-gray-400 mb-2">波動預期抬升，市場對突發信息和宏觀擾動更敏感。</p>

       <div className="w-full" style={{ height: 80 }}>
         <ResponsiveContainer width="100%" height={80}>
           <LineChart data={chartData}>
             <Line 
               type="monotone" 
               dataKey="value" 
               stroke="#d97706" 
               strokeWidth={2} 
               dot={false}
               isAnimationActive={false}
             />
           </LineChart>
         </ResponsiveContainer>
       </div>
    </div>
  );
}
