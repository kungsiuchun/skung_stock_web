import type { SpxGexHeatmapModel } from "@/lib/spx-gex-heatmap";
import { formatSpxGexCompactExposure } from "@/lib/spx-gex-heatmap";
import type { SpxGexPressureMatrixModel } from "@/lib/spx-gex-pressure-matrix";

export interface PressureOverview {
  model: SpxGexPressureMatrixModel | null;
  stale: boolean;
  loading: boolean;
  error: boolean;
}

const price = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "Unavailable";
const exposure = (n: number) => formatSpxGexCompactExposure(n, { signed: true });

export function SpxBoardOverview({ heatmap, pressure, stale, onEvidence }: {
  heatmap: SpxGexHeatmapModel;
  pressure: PressureOverview | null;
  stale: boolean;
  onEvidence: () => void;
}) {
  const g = heatmap.zeroDte;
  const q = heatmap.dataQuality;
  const flipDistance = g.gammaFlip === null ? null : heatmap.quote.last - g.gammaFlip;
  const p = pressure && pressure.model?.tradingDate === heatmap.session?.tradingDate ? pressure.model : null;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-700/70 bg-[#0b1724]" aria-label="Market structure overview" data-spx-board-overview="true">
      <div className="grid grid-cols-2 divide-x divide-slate-700/60 lg:grid-cols-4">
        <div className="p-3 sm:p-4">
          <div className="text-xs text-slate-400">Snapshot SPX</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">{price(heatmap.quote.last)}</div>
          <div className="mt-1 text-xs text-slate-300">{heatmap.session?.snapshotTimeEt} ET · {stale ? "Last verified" : "Delayed"}</div>
        </div>
        <div className="p-3 sm:p-4">
          <div className="text-xs text-slate-400">Gamma flip</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">{price(g.gammaFlip)}</div>
          <div className="mt-1 text-xs text-slate-300">{flipDistance === null ? "No level available" : `${flipDistance >= 0 ? "Above" : "Below"} by ${price(Math.abs(flipDistance))} pts`}</div>
        </div>
        <div className="border-t border-slate-700/60 p-3 sm:p-4 lg:border-t-0">
          <div className="text-xs text-slate-400">Call / put wall</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-white">{price(g.topCallWallLevel)} / {price(g.topPutWallLevel)}</div>
          <div className="mt-1 text-xs text-slate-300">Pin {price(g.pinLevel)} · zones, not guarantees</div>
        </div>
        <div className="border-t border-slate-700/60 p-3 sm:p-4 lg:border-t-0">
          <div className="text-xs text-slate-400">Snapshot quality</div>
          <div className="mt-1 font-mono text-lg font-semibold text-white">{q ? `${q.priced}/${q.total} priced` : "Unavailable"}</div>
          <div className="mt-1 text-xs text-amber-200">{q ? `${q.repaired} repaired · ${q.partial} partial · ${q.unpriced} unpriced · ${q.excluded} excluded` : "Quality not recorded"}</div>
          <button className="mt-1 min-h-8 text-xs text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2" onClick={onEvidence}>Inspect evidence →</button>
        </div>
      </div>
      <div className="border-t border-slate-700/60 bg-black/15 p-3 sm:px-4" data-spx-board-pressure-summary="true" role="status">
        <div className="flex flex-wrap items-baseline justify-between gap-1 text-xs">
          <span className="font-semibold text-slate-200">Session pressure change {pressure?.stale ? "· last verified" : pressure?.loading ? "· updating" : ""}</span>
          <span className="text-slate-400">{p ? `${p.tradingDate} · ${p.latest.snapshotTimeEt} vs ${p.baseline.snapshotTimeEt} ET · ${p.delayMinutes}m delayed` : pressure?.error ? "Unavailable · see matrix diagnostics" : "Waiting for verified baseline"}</span>
        </div>
        {p && p.warnings.length > 0 && <p className="mt-1 text-xs text-amber-200">Pressure data warning · inspect the matrix for coverage details.</p>}
        {p && <ol className="mt-2 grid gap-2 sm:grid-cols-3" aria-label="Largest session GEX changes">
          {p.movers.slice(0, 3).map(m => <li key={m.strike} className="flex flex-wrap items-center justify-between gap-x-2 rounded-md border border-slate-700/60 px-2.5 py-1.5 font-mono text-xs">
            <span className="font-bold text-white">{price(m.strike)}</span>
            <span className={m.deltaGex >= 0 ? "text-emerald-300" : "text-rose-300"}>Δ {exposure(m.deltaGex)}</span>
            <span className="w-full text-[10px] text-slate-400">{m.state.replace(/_/g, " ").toLowerCase()}</span>
          </li>)}
          {p.movers.length === 0 && <li className="text-xs text-slate-400">No comparable changes.</li>}
        </ol>}
      </div>
    </section>
  );
}
