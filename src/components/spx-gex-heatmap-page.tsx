import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, CalendarDays, RefreshCw, Waves } from "lucide-react";
import type { SpxGexHeatmapCell, SpxGexHeatmapModel } from "@/lib/spx-gex-heatmap";

interface SpxGexHeatmapResponse {
  availableDates: string[];
  selectedDate: string | null;
  heatmap: SpxGexHeatmapModel | null;
  warnings: string[];
}

interface SPXGexHeatmapPageProps {
  onBackToWork: () => void;
}

const emptyPayload: SpxGexHeatmapResponse = {
  availableDates: [],
  selectedDate: null,
  heatmap: null,
  warnings: [],
};

const formatGexMillions = (value: number | null) => {
  if (value === null) return "-";
  const millions = value / 1_000_000;
  if (Math.abs(millions) < 0.005) return "+0.00";
  return `${millions > 0 ? "+" : ""}${millions.toFixed(2)}`;
};

const formatCompactGex = (value: number | null) => {
  if (value === null) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${value >= 0 ? "+" : ""}${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${value >= 0 ? "+" : ""}${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${value >= 0 ? "+" : ""}${(value / 1_000).toFixed(0)}K`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}`;
};

const getCellStyle = (value: number | null, globalMax: number) => {
  if (value === null) return { backgroundColor: "#10161e", color: "#5f6b7a" };
  const strength = Math.min(1, Math.abs(value) / Math.max(1, globalMax));
  const base = 18;
  const rgb = value >= 0
    ? [
        Math.round(base + (34 - base) * strength),
        Math.round(base + (255 - base) * strength),
        Math.round(base + (94 - base) * strength),
      ]
    : [
        Math.round(base + (220 - base) * strength),
        Math.round(base + (38 - base) * strength),
        Math.round(base + (38 - base) * strength),
      ];

  return {
    backgroundColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    color: strength > 0.16 ? "#f8fbff" : "#9fc5ff",
  };
};

const findNearestStrike = (strikes: number[], target: number | null | undefined) => {
  if (!target || strikes.length === 0) return null;
  return [...strikes].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? null;
};

export function SPXGexHeatmapPage({ onBackToWork }: SPXGexHeatmapPageProps) {
  const [data, setData] = useState<SpxGexHeatmapResponse>(emptyPayload);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHeatmap = async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : "";
      const response = await fetch(`/api/spx-gex-heatmap${query}`);
      const payload = (await response.json()) as SpxGexHeatmapResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "SPX GEX heatmap API failed");
      setData(payload);
      setSelectedDate(payload.selectedDate || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "SPX GEX heatmap failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHeatmap();
  }, []);

  const heatmap = data.heatmap;
  const cellByKey = useMemo(() => {
    const map = new Map<string, SpxGexHeatmapCell>();
    for (const cell of heatmap?.cells || []) {
      map.set(`${cell.strike}:${cell.expdate}`, cell);
    }
    return map;
  }, [heatmap?.cells]);
  const globalMax = useMemo(
    () => Math.max(1, ...(heatmap?.cells || []).map((cell) => Math.abs(cell.netGex || 0))),
    [heatmap?.cells],
  );
  const gammaFlipRow = findNearestStrike(heatmap?.strikes || [], heatmap?.zeroDte.gammaFlip);
  const pinRow = findNearestStrike(heatmap?.strikes || [], heatmap?.zeroDte.pinLevel);
  const spotRow = findNearestStrike(heatmap?.strikes || [], heatmap?.quote.last);

  return (
    <section className="h-full w-full overflow-y-auto bg-[#070b10] px-4 pb-10 pt-6 text-white sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-5 border-b border-sky-400/15 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              onClick={onBackToWork}
              className="mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-sky-200/70 transition-colors hover:text-sky-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Work gallery
            </button>
            <div className="mb-3 inline-flex items-center gap-2 border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-sky-200">
              <Waves className="h-3.5 w-3.5" />
              SPX GEX Heatmap
            </div>
            <h1 className="text-3xl font-black tracking-normal text-white sm:text-5xl">Premarket Gamma Map</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Stored as D1 JSON snapshots with a seven trading-day retention window.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300">
              <CalendarDays className="h-4 w-4 text-sky-200" />
              <select
                value={selectedDate}
                onChange={(event) => void loadHeatmap(event.target.value)}
                className="bg-transparent text-sm font-bold text-white outline-none"
              >
                {data.availableDates.length === 0 ? (
                  <option value="">No snapshots</option>
                ) : (
                  data.availableDates.map((date) => (
                    <option key={date} value={date} className="bg-[#111827] text-white">
                      {date}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              onClick={() => void loadHeatmap(selectedDate)}
              className="inline-flex h-10 w-10 items-center justify-center border border-sky-300/20 bg-sky-300/10 text-sky-100 transition-colors hover:bg-sky-300/20"
              title="Refresh heatmap"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-2 border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {data.warnings.length > 0 && (
          <div className="flex items-center gap-2 border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            {data.warnings.join(" ")}
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center border border-white/10 bg-white/[0.03] text-sm uppercase tracking-[0.2em] text-zinc-500">
            Loading SPX GEX
          </div>
        ) : heatmap ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="Spot" value={`$${heatmap.quote.last.toFixed(2)}`} />
              <Metric label="0DTE NetGEX" value={formatCompactGex(heatmap.zeroDte.netGex)} />
              <Metric label="Gamma Flip" value={heatmap.zeroDte.gammaFlip ? `$${heatmap.zeroDte.gammaFlip.toFixed(0)}` : "n/a"} />
              <Metric label="Snapshot" value={heatmap.snapshot || heatmap.generatedAt} />
            </div>

            <div className="overflow-x-auto border border-[#2c3540] bg-[#090e15]">
              <div className="border-b border-[#2c3540] bg-[#0d131b] px-4 py-3 text-xs font-black leading-5 text-sky-100">
                Active expiries start from 0DTE front expiry {heatmap.zeroDte.expiry} | Pin{" "}
                {heatmap.zeroDte.pinLevel ? `$${heatmap.zeroDte.pinLevel.toFixed(0)}` : "n/a"} | Gamma flip{" "}
                {heatmap.zeroDte.gammaFlip ? `$${heatmap.zeroDte.gammaFlip.toFixed(0)}` : "n/a"} | Call wall{" "}
                {heatmap.zeroDte.topCallWall || "n/a"} | Put wall {heatmap.zeroDte.topPutWall || "n/a"} | Charm{" "}
                {heatmap.zeroDte.charmRegime || "n/a"}
              </div>
              <table className="min-w-[1080px] w-full table-fixed border-collapse font-mono text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 w-64 border border-[#2c3540] bg-[#151c25] px-3 py-2 text-center text-sky-300">
                      Strike
                    </th>
                    {heatmap.selectedExpiries.map((expiry) => (
                      <th key={expiry} className="border border-[#2c3540] bg-[#151c25] px-3 py-2 text-center text-sky-300">
                        {expiry}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.strikes.map((strike) => {
                    const badges = [
                      strike === spotRow ? "Spot" : null,
                      strike === gammaFlipRow ? "Gamma flip" : null,
                      strike === pinRow ? "Pin" : null,
                      strike === heatmap.zeroDte.topCallWallLevel ? "Call wall" : null,
                      strike === heatmap.zeroDte.topPutWallLevel ? "Put wall" : null,
                    ].filter(Boolean);

                    return (
                      <tr
                        key={strike}
                        className={
                          strike === spotRow
                            ? "border-y-[3px] border-yellow-200"
                            : strike === gammaFlipRow
                              ? "border-y-[3px] border-dashed border-sky-300"
                              : ""
                        }
                      >
                        <th className="sticky left-0 z-10 border border-[#2c3540] bg-[#141a22] px-3 py-2 text-left text-sky-100">
                          {strike.toFixed(0)}
                          {badges.length > 0 && <span className="ml-2 text-xs text-yellow-100">{badges.join(" / ")}</span>}
                        </th>
                        {heatmap.selectedExpiries.map((expiry) => {
                          const cell = cellByKey.get(`${strike}:${expiry}`);
                          return (
                            <td
                              key={`${strike}-${expiry}`}
                              className="border border-[#2c3540] px-3 py-2 text-right font-black tabular-nums"
                              style={getCellStyle(cell?.netGex ?? null, globalMax)}
                              title={`${expiry} / ${strike} / ${formatCompactGex(cell?.netGex ?? null)}`}
                            >
                              {formatGexMillions(cell?.netGex ?? null)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="border-t-[3px] border-white">
                    <th className="sticky left-0 z-10 border border-[#2c3540] bg-[#141a22] px-3 py-2 text-left text-yellow-100">
                      Total NetGEX
                    </th>
                    {heatmap.totals.map((total) => (
                      <td
                        key={total.expdate}
                        className="border border-[#2c3540] px-3 py-2 text-right font-black text-white tabular-nums"
                        style={getCellStyle(total.netGex, globalMax)}
                      >
                        {formatGexMillions(total.netGex)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-3 border border-white/10 bg-white/[0.03] text-center">
            <Activity className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-500">No retained SPX GEX heatmap snapshots found.</p>
          </div>
        )}
      </div>
    </section>
  );
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/10 bg-white/[0.04] px-4 py-3">
    <div className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    <div className="mt-2 break-words text-lg font-black text-white">{value}</div>
  </div>
);
