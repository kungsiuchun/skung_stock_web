import { useMemo } from "react";

interface SentimentGaugeProps {
  sentiment: number;
  news?: { title: string }[];
  quantStrategies?: { name: string; score: number }[];
}

export function SentimentGauge({ sentiment, news = [], quantStrategies = [] }: SentimentGaugeProps) {
  const safeScore = (typeof sentiment === 'number' && isFinite(sentiment)) ? sentiment : 50;
  const clampedScore = Math.max(0, Math.min(100, safeScore));

  const getSentimentText = (s: number) => {
    if (s <= 20) return "極度恐慌";
    if (s <= 40) return "恐慌";
    if (s <= 60) return "中性";
    if (s <= 80) return "貪婪";
    return "極度貪婪";
  };

  const getSentimentColor = (s: number) => {
    if (s <= 40) return "#10b981"; // American Up/Bull is Green
    if (s <= 60) return "#a855f7";
    return "#ef4444"; // American Down/Bear is Red
  };

  const color = getSentimentColor(clampedScore);
  const text = getSentimentText(clampedScore);

  const radius = 50;
  const strokeWidth = 10;
  const center = 65;
  const calculateCoordinates = (value: number) => {
    const angle = 140 + (value / 100) * 260;
    const rad = (angle - 90) * (Math.PI / 180.0);
    return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
  };

  const start = calculateCoordinates(0);
  const end = calculateCoordinates(100);
  const current = calculateCoordinates(clampedScore);
  const bgPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 1 1 ${end.x} ${end.y}`;
  const currentLargeArcFlag = (clampedScore / 100) * 260 > 180 ? 1 : 0;
  const valPath = clampedScore === 0 ? "" : `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${currentLargeArcFlag} 1 ${current.x} ${current.y}`;

  // Dynamic insights derived from REAL news headlines + sentiment score
  const { bullishPoints, bearishPoints } = useMemo(() => {
    const bull: string[] = [];
    const bear: string[] = [];

    // Analyze actual news headlines if available
    if (news.length > 0) {
      const positiveKeywords = ['上漲', '突破', '新高', 'beat', 'surges', 'rally', 'upgrades', 'growth', 'positive', 'strong'];
      const negativeKeywords = ['下跌', '暴跌', '風險', 'falls', 'drop', 'downgrade', 'weak', 'risk', 'crash', 'sell'];
      
      const positiveNews = news.filter(n => positiveKeywords.some(k => n.title.toLowerCase().includes(k.toLowerCase())));
      const negativeNews = news.filter(n => negativeKeywords.some(k => n.title.toLowerCase().includes(k.toLowerCase())));

      if (positiveNews.length > 0) {
        bull.push(`近期 ${positiveNews.length} 則正面新聞，市場情緒偏向積極。`);
      }
      if (negativeNews.length > 0) {
        bear.push(`有 ${negativeNews.length} 則負面消息流出，需留意風險。`);
      }
    }

    // Score-based insights
    if (clampedScore > 60) {
      bull.push("情緒指數偏貪婪，短線資金仍有流入動能。");
      bear.push("過度樂觀可能觸發獲利回吐，建議控制追漲倉位。");
    } else if (clampedScore > 40) {
      bull.push("情緒中性偏穩，適合分批佈局。");
      bear.push("缺乏方向性共識，可能延續震盪整理。");
    } else {
      bull.push("市場恐慌期間歷史上常出現超跌反彈。");
      bear.push("恐慌情緒主導，資金撤離風險升高。");
    }

    if (bull.length < 2) bull.push("若價格守穩當前支撐位，有望企穩。");
    if (bear.length < 2) bear.push("後續需觀察成交量是否持續萎縮。");

    return { bullishPoints: bull.slice(0, 2), bearishPoints: bear.slice(0, 2) };
  }, [clampedScore, news]);

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
      <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">市場情緒與量化指標 ({quantStrategies.length})</div>
      
      <div className="flex items-start gap-4 mb-6">
        {/* Compact Gauge */}
        <div className="relative w-[110px] h-[110px] flex-shrink-0">
          <svg viewBox="0 0 130 130" className="w-full h-full">
            <defs>
              <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            <path d={bgPath} fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth} strokeLinecap="round" />
            {clampedScore > 0 && (
              <path d={valPath} fill="none" stroke="url(#gaugeGradient)" strokeWidth={strokeWidth} strokeLinecap="round" />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
            <span className="text-2xl font-black text-gray-900">{clampedScore}</span>
            <span className="text-[9px] font-black uppercase tracking-wider" style={{ color }}>{text}</span>
          </div>
        </div>

        {/* Insights inline */}
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-3">
          <div>
            <h4 className="text-xs font-black text-gray-800 mb-1.5">偏樂觀看法</h4>
            <ul className="space-y-1">
              {bullishPoints.map((p, i) => (
                <li key={i} className="text-xs leading-snug text-gray-500 flex items-start gap-1">
                  <span className="text-green-500 mt-px flex-shrink-0">•</span><span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-black text-gray-800 mb-1.5">偏謹慎看法</h4>
            <ul className="space-y-1">
              {bearishPoints.map((p, i) => (
                <li key={i} className="text-xs leading-snug text-gray-500 flex items-start gap-1">
                  <span className="text-red-500 mt-px flex-shrink-0">•</span><span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Removed Strategy Visuals per User Request */}
    </div>
  );
}
