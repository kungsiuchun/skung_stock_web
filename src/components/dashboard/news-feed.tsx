import { ExternalLink, RefreshCw } from "lucide-react";

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  time?: string;
  summary?: string;
}

interface NewsFeedProps {
  news: NewsItem[];
}

export function NewsFeed({ news }: NewsFeedProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-sm h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
           <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center border border-orange-100">
              <RefreshCw className="w-4 h-4 text-orange-500" />
           </div>
           <h3 className="text-sm font-bold text-gray-900 tracking-[0.2em] uppercase">Relevant Market News</h3>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {news.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-4">
            暫無相關新聞資訊
          </div>
        ) : (
          news.map((item, i) => (
            <div key={i} className="group p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:border-blue-200 transition-all">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                   <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter bg-blue-100 px-1.5 py-0.5 rounded">
                         {item.source || "News"}
                      </span>
                      {item.time && <span className="text-[10px] font-mono text-gray-400">{item.time}</span>}
                   </div>
                  <a 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-900 text-sm font-medium leading-relaxed group-hover:text-blue-600 transition-colors block"
                  >
                    {item.title}
                  </a>
                  {item.summary && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">
                      {item.summary}
                    </p>
                  )}
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                   <ExternalLink className="w-3 h-3 text-blue-500" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
