import { ExternalLink } from "lucide-react";

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
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">相關新聞</h3>

      <div className="flex flex-col gap-4">
        {news.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-4">
            暫無相關新聞資訊
          </div>
        ) : (
          news.map((item, i) => (
        <div key={i} className="group p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:border-blue-200 transition-colors">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0 flex-1">
                   <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter bg-blue-100 px-1.5 py-0.5 rounded">
                         {item.source || "News"}
                      </span>
                      <span className="text-[10px] font-mono text-gray-500">{item.time?.trim() || "發布時間未提供"}</span>
                   </div>
                  <a 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block break-words text-sm font-medium leading-relaxed text-gray-900 transition-colors group-hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
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
