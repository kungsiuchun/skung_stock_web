import { Building, Target, DollarSign, PieChart, AlertCircle } from "lucide-react";

interface ValuationData {
  symbol?: string;
  pe_ratio?: string;
  peg_ratio?: string;
  eps?: string;
  analyst_target_price?: string | null;
  error?: string;
  rateLimited?: boolean;
}

export function ValuationWidget({ data, loading }: { data: ValuationData | null, loading: boolean }) {
  if (loading) {
    return (
      <div className="flex gap-4 animate-pulse mt-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 w-24 bg-gray-100 rounded-xl"></div>
        ))}
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="flex items-center gap-2 mt-4 text-xs text-orange-500 bg-orange-50 px-3 py-2 rounded-lg w-fit border border-orange-100">
        <AlertCircle className="w-4 h-4" />
        {data.rateLimited ? "Valuation Data: AlphaVantage Rate Limit Exceeded" : `Valuation: ${data.error}`}
      </div>
    );
  }

  if (!data || !data.pe_ratio) return null;

  const formatNumber = (val: string | null | undefined, type: 'currency' | 'ratio' = 'ratio') => {
    if (!val || val === "None" || val === "-") return "N/A";
    const num = Number(val);
    if (isNaN(num)) return val;
    return type === 'currency' ? `$${num.toFixed(2)}` : num.toFixed(2);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 mt-5">
      <div className="flex flex-col border border-gray-100 bg-gray-50/50 rounded-xl px-4 py-2 min-w-[100px]">
        <span className="text-[10px] uppercase font-bold text-gray-400 flex items-center gap-1 mb-1">
          <PieChart className="w-3 h-3" /> P/E Ratio
        </span>
        <span className="text-sm font-bold text-gray-800">{formatNumber(data.pe_ratio)}</span>
      </div>
      
      <div className="flex flex-col border border-gray-100 bg-gray-50/50 rounded-xl px-4 py-2 min-w-[100px]">
        <span className="text-[10px] uppercase font-bold text-gray-400 flex items-center gap-1 mb-1">
          <DollarSign className="w-3 h-3" /> EPS (TTM)
        </span>
        <span className="text-sm font-bold text-gray-800">{formatNumber(data.eps, 'currency')}</span>
      </div>

      <div className="flex flex-col border border-gray-100 bg-gray-50/50 rounded-xl px-4 py-2 min-w-[100px]">
        <span className="text-[10px] uppercase font-bold text-gray-400 flex items-center gap-1 mb-1">
          <Building className="w-3 h-3" /> PEG Ratio
        </span>
        <span className="text-sm font-bold text-gray-800">{formatNumber(data.peg_ratio)}</span>
      </div>

      <div className="flex flex-col border border-indigo-100 bg-indigo-50/30 rounded-xl px-4 py-2 min-w-[120px]">
        <span className="text-[10px] uppercase font-bold text-indigo-400 flex items-center gap-1 mb-1">
          <Target className="w-3 h-3" /> Analyst Target
        </span>
        <span className="text-sm font-bold text-indigo-700">{formatNumber(data.analyst_target_price, 'currency')}</span>
      </div>
    </div>
  );
}
