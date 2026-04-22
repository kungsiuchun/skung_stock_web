import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType } from 'lightweight-charts';

interface PriceVolumeChartProps {
  data: any[];
  symbol: string;
}

export function PriceVolumeChart({ data, symbol }: PriceVolumeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !data || data.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#64748b',
        fontFamily: "'Inter', -apple-system, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(0,0,0,0.03)' },
        horzLines: { color: 'rgba(0,0,0,0.03)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        horzLine: { color: 'rgba(0,0,0,0.1)', style: 2 },
        vertLine: { color: 'rgba(0,0,0,0.1)', style: 2 },
      },
      handleScroll: false,
      handleScale: false,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    // Volume histogram
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Transform data for lightweight-charts
    const candleData = data.map((d, i) => ({
      time: d.date_iso || `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: Number(d.open || d.price || 0),
      high: Number(d.high || d.price || 0),
      low: Number(d.low || d.price || 0),
      close: Number(d.price || 0),
    }));

    const volumeData = data.map((d, i) => ({
      time: d.date_iso || `2026-01-${String(i + 1).padStart(2, '0')}`,
      value: Number(d.volume || 0),
      color: Number(d.price || 0) >= Number(d.open || 0) ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="w-full h-[320px] flex items-center justify-center text-gray-400 text-sm">
        暫無走勢數據
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-gray-900">
          {symbol} 近期走勢（K 線圖）
        </h3>
        <div className="flex items-center gap-3 text-[10px] font-bold text-gray-400">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-500" /> 上漲</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" /> 下跌</span>
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 320 }} />
    </div>
  );
}
