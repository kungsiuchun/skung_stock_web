import { buildFinancialJuiceNewsWidgetSrc } from "@/lib/financial-juice-widget";

const FINANCIAL_JUICE_CONTAINER_ID = "financialjuice-news-widget-container";
const FINANCIAL_JUICE_HEIGHT = "450px";

export function FinancialJuiceWidget() {
  const src = buildFinancialJuiceNewsWidgetSrc({
    container: FINANCIAL_JUICE_CONTAINER_ID,
    mode: "Light",
    width: "100%",
    height: FINANCIAL_JUICE_HEIGHT,
    backColor: "ffffff",
    fontColor: "1e2329",
  });

  return (
    <div className="mt-6 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400">
        實時財經動態 (FinancialJuice)
      </div>
      <div
        id={FINANCIAL_JUICE_CONTAINER_ID}
        className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-inner"
        style={{ minHeight: FINANCIAL_JUICE_HEIGHT }}
      >
        <iframe
          title="FinancialJuice real-time news feed"
          src={src}
          height={FINANCIAL_JUICE_HEIGHT}
          width="100%"
          scrolling="no"
          frameBorder="0"
          referrerPolicy="no-referrer-when-downgrade"
          className="block w-full border-0"
          style={{ height: FINANCIAL_JUICE_HEIGHT }}
        />
      </div>
    </div>
  );
}
