import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, type Time } from "lightweight-charts";
import type { WorkspaceBar, WorkspaceRange } from "@/lib/watcher-workspace";

export function WatcherWorkspaceChart({ bars, range, theme, symbol, rejectedBars = 0 }: { bars: WorkspaceBar[]; range: WorkspaceRange; theme: "dark" | "light"; symbol: string; rejectedBars?: number }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || bars.length < 2) return;
    const light = theme === "light";
    const chart = createChart(container.current, { autoSize: true, height: 370,
      layout: { background: { type: ColorType.Solid, color: light ? "#ffffff" : "#08131f" }, textColor: light ? "#52677d" : "#93a7bd", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: light ? "#edf2f7" : "#132338" }, horzLines: { color: light ? "#edf2f7" : "#132338" } },
      rightPriceScale: { borderColor: light ? "#d4dfe9" : "#203043", scaleMargins: { top: .08, bottom: .23 } },
      timeScale: { borderColor: light ? "#d4dfe9" : "#203043", rightOffset: 3 }, handleScroll: { vertTouchDrag: false },
    });
    const up = light ? "#11765b" : "#55c8a0";
    const down = light ? "#b63c51" : "#ee8793";
    const price = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
    price.setData(bars.map(row => ({ ...row, time: row.date as Time })));
    volume.setData(bars.map(row => ({ time: row.date as Time, value: row.volume, color: `${row.close >= row.open ? up : down}44` })));
    const sma = chart.addSeries(LineSeries, { color: light ? "#0967c7" : "#53a7ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "SMA50" });
    sma.setData(rejectedBars ? [] : bars.flatMap((row, index) => index < 49 ? [] : [{ time: row.date as Time, value: bars.slice(index - 49, index + 1).reduce((sum, item) => sum + item.close, 0) / 50 }]));
    const length = range === "1mo" ? 21 : range === "3mo" ? 63 : 252;
    const showRange = () => chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - length), to: bars.length + 2 });
    showRange();
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => { showRange(); resizeFrame = null; });
    });
    observer.observe(container.current);
    return () => { observer.disconnect(); if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame); chart.remove(); };
  }, [bars, range, theme, rejectedBars]);
  return <div className="ww-chart" ref={container} role="img" aria-label={`${symbol} daily candlestick and volume chart, ${range}. ${rejectedBars ? "SMA unavailable after invalid bars." : "Blue line: SMA50."} Last bar ${bars[bars.length - 1]?.date || "unavailable"}.`} />;
}
