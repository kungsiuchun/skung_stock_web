import { useEffect, useRef } from "react";

declare global {
  interface Window {
    FJWidgets?: any;
  }
}

export function FinancialJuiceWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only mount script once
    if (document.getElementById("FJ-Widgets")) return;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.id = "FJ-Widgets";
    const r = Math.floor(Math.random() * 10000);
    script.src = `https://feed.financialjuice.com/widgets/widgets.js?r=${r}`;
    
    script.onload = () => {
      if (window.FJWidgets) {
        new window.FJWidgets.createWidget({
          container: "financialjuice-news-widget-container",
          mode: "Light", // Adjusted to Light to roughly match the dashboard, or we can use Dark
          width: "100%",
          height: "450px",
          backColor: "ffffff",  
          fontColor: "1e2329",
          widgetType: "NEWS"
        });
      }
    };

    document.head.appendChild(script);

    return () => {
       // Optional: we can't easily wipe the iframe that FJ generates, but we can remove the script if needed.
       // However, keeping it around is fine for SPA.
    };
  }, []);

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm mt-6">
      <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">
        實時財經動態 (FinancialJuice)
      </div>
      <div 
        id="financialjuice-news-widget-container" 
        ref={containerRef}
        className="w-full rounded-2xl overflow-hidden shadow-inner border border-gray-50"
      />
    </div>
  );
}
