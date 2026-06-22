import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, Gauge, Pause, Play, RefreshCw, Waves } from "lucide-react";
import type { SpxGexHeatmapCell, SpxGexHeatmapModel, SpxGexSessionSummary, SpxGexStrikeProfile } from "@/lib/spx-gex-heatmap";

interface SpxGexHeatmapResponse {
  availableDates: string[];
  selectedDate: string | null;
  sessions: SpxGexSessionSummary[];
  selectedSnapshot: SpxGexSessionSummary | null;
  heatmap: SpxGexHeatmapModel | null;
  warnings: string[];
}

interface SPXGexHeatmapPageProps {
  onBackToWork: () => void;
}

const emptyPayload: SpxGexHeatmapResponse = {
  availableDates: [],
  selectedDate: null,
  sessions: [],
  selectedSnapshot: null,
  heatmap: null,
  warnings: [],
};

const formatCompact = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${value >= 0 ? "" : "-"}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${value >= 0 ? "" : "-"}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${value >= 0 ? "" : "-"}${(abs / 1_000).toFixed(1)}K`;
  return `${value >= 0 ? "" : "-"}${abs.toFixed(0)}`;
};

const formatSignedCompact = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : "-"}${formatCompact(Math.abs(value))}`;
};

const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
};

const formatNumber = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const formatYears = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(6);
};

const cellAuditLines = (cell: SpxGexHeatmapCell | undefined) => {
  if (!cell) return [];
  if (cell.model !== "black_scholes_gamma_exposure") {
    return [
      `Strike ${cell.strike} ${cell.expdate}`,
      "Audit inputs unavailable",
    ];
  }
  return [
    `Strike ${cell.strike} ${cell.expdate}`,
    `Net GEX ${formatSignedCompact(cell.netGex)} = Call ${formatSignedCompact(cell.callGex)} + Put ${formatSignedCompact(cell.putGex)}`,
    `Call IV ${formatPercent(cell.callIvPercent)} / Put IV ${formatPercent(cell.putIvPercent)}`,
    `Call OI ${formatNumber(cell.callOpenInterest)} / Put OI ${formatNumber(cell.putOpenInterest)}`,
    `Effective OI C ${formatNumber(cell.callEffectiveOpenInterest)} / P ${formatNumber(cell.putEffectiveOpenInterest)}`,
    `DTE ${formatNumber(cell.dteHours)}h / t=${formatYears(cell.yearsToExpiry)}`,
    `Formula: Net = Call gamma exposure - Put gamma exposure`,
    `Model ${cell.model} @ ${cell.calculationTimestamp || "-"}`,
  ];
};

const cellStyle = (value: number | null | undefined, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return { backgroundColor: "#07111a", color: "#526171" };
  const strength = Math.min(1, Math.abs(value) / Math.max(1, max));
  if (value >= 0) {
    const green = Math.round(52 + 175 * strength);
    return { backgroundColor: `rgb(${Math.round(12 + 48 * strength)}, ${green}, ${Math.round(46 + 28 * strength)})`, color: "#f7fff8" };
  }
  const red = Math.round(88 + 178 * strength);
  return { backgroundColor: `rgb(${red}, ${Math.round(28 + 34 * strength)}, ${Math.round(46 + 28 * strength)})`, color: "#fff7f7" };
};

const exposureColor = (value: number) => value >= 0 ? "#d000d4" : "#20d6c8";

const nearestStrike = (strikes: number[], spot: number | null | undefined) => {
  if (typeof spot !== "number" || !Number.isFinite(spot) || strikes.length === 0) return null;
  return strikes.reduce((nearest, strike) => (Math.abs(strike - spot) < Math.abs(nearest - spot) ? strike : nearest));
};

const tagClass = (severity: string) =>
  severity === "major"
    ? "border border-yellow-300/35 bg-yellow-300/15 text-yellow-100"
    : severity === "watch"
      ? "border border-pink-300/25 bg-pink-400/10 text-pink-100"
      : "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100";

type RowRangeMode = "auto" | "all";

const buildFallbackProfiles = (heatmap: SpxGexHeatmapModel): SpxGexStrikeProfile[] => {
  if (heatmap.strikeProfiles?.length) return heatmap.strikeProfiles;
  const cellByStrike = new Map<number, SpxGexHeatmapCell[]>();
  for (const cell of heatmap.cells) {
    cellByStrike.set(cell.strike, [...(cellByStrike.get(cell.strike) || []), cell]);
  }
  return heatmap.strikes.map((strike) => {
    const cells = cellByStrike.get(strike) || [];
    return {
      strike,
      netGex: cells.reduce((sum, cell) => sum + Number(cell.netGex || 0), 0),
      callGex: cells.reduce((sum, cell) => sum + Number(cell.callGex || 0), 0),
      putGex: cells.reduce((sum, cell) => sum + Number(cell.putGex || 0), 0),
      netDex: cells.reduce((sum, cell) => sum + Number(cell.netDex || 0), 0),
      netVex: cells.reduce((sum, cell) => sum + Number(cell.netVex || 0), 0),
      netCex: cells.reduce((sum, cell) => sum + Number(cell.netCex || 0), 0),
      totalOpenInterest: cells.reduce((sum, cell) => sum + Number(cell.totalOpenInterest || 0), 0),
      totalVolume: cells.reduce((sum, cell) => sum + Number(cell.totalVolume || 0), 0),
      dominantExpiry: null,
      tags: [],
    };
  });
};

export function SPXGexHeatmapPage({ onBackToWork }: SPXGexHeatmapPageProps) {
  const [data, setData] = useState<SpxGexHeatmapResponse>(emptyPayload);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(900);
  const [rowRangeMode, setRowRangeMode] = useState<RowRangeMode>("auto");

  const loadHeatmap = async (
    date?: string,
    snapshotMinute?: number | null,
    options: { bypassCache?: boolean } = {},
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (snapshotMinute !== null && snapshotMinute !== undefined) params.set("snapshot", String(snapshotMinute));
      if (options.bypassCache) params.set("_", String(Date.now()));
      const response = await fetch(
        `/api/spx-gex-heatmap${params.toString() ? `?${params.toString()}` : ""}`,
        options.bypassCache ? { cache: "no-store" } : undefined,
      );
      const payload = (await response.json()) as SpxGexHeatmapResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "SPX GEX heatmap API failed");
      setData(payload);
      setSelectedDate(payload.selectedDate || "");
      setSelectedMinute(payload.selectedSnapshot?.snapshotMinuteEt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SPX GEX heatmap failed");
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHeatmap();
  }, []);

  useEffect(() => {
    if (!playing || data.sessions.length <= 1 || !selectedDate) return undefined;
    const timer = window.setInterval(() => {
      const currentIndex = Math.max(0, data.sessions.findIndex((session) => session.snapshotMinuteEt === selectedMinute));
      const next = data.sessions[(currentIndex + 1) % data.sessions.length];
      if (next) void loadHeatmap(selectedDate, next.snapshotMinuteEt);
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [data.sessions, playing, selectedDate, selectedMinute, speedMs]);

  const heatmap = data.heatmap;
  const cellByKey = useMemo(() => {
    const map = new Map<string, SpxGexHeatmapCell>();
    for (const cell of heatmap?.cells || []) map.set(`${cell.strike}:${cell.expdate}`, cell);
    return map;
  }, [heatmap?.cells]);
  const profiles = useMemo(() => heatmap ? buildFallbackProfiles(heatmap) : [], [heatmap]);
  const profileByStrike = useMemo(() => new Map(profiles.map((row) => [row.strike, row])), [profiles]);
  const maxGex = useMemo(
    () => Math.max(1, ...(heatmap?.cells || []).map((cell) => Math.abs(cell.netGex || 0)), ...profiles.map((row) => Math.abs(row.netGex))),
    [heatmap?.cells, profiles],
  );
  const exposureMax = useMemo(() => ({
    dex: Math.max(1, ...profiles.map((row) => Math.abs(row.netDex))),
    vex: Math.max(1, ...profiles.map((row) => Math.abs(row.netVex))),
    cex: Math.max(1, ...profiles.map((row) => Math.abs(row.netCex))),
  }), [profiles]);
  const laneExposureAvailable = useMemo(() => ({
    dex: profiles.some((row) => Math.abs(row.netDex) > 0),
    vex: profiles.some((row) => Math.abs(row.netVex) > 0),
    cex: profiles.some((row) => Math.abs(row.netCex) > 0),
  }), [profiles]);
  const visibleStrikes = useMemo(() => {
    if (!heatmap || rowRangeMode === "all") return heatmap?.strikes || [];
    const spot = heatmap.quote.last;
    const autoStrikes = heatmap.strikes.filter((strike) => Math.abs(strike - spot) <= 100);
    return autoStrikes.length > 0 ? autoStrikes : heatmap.strikes;
  }, [heatmap, rowRangeMode]);
  const spotStrike = useMemo(() => nearestStrike(heatmap?.strikes || [], heatmap?.quote.last), [heatmap?.quote.last, heatmap?.strikes]);
  const summaryExposureAvailable = useMemo(() => ({
    dex: laneExposureAvailable.dex || Math.abs(heatmap?.zeroDte.netDex || 0) > 0,
    vex: laneExposureAvailable.vex || Math.abs(heatmap?.zeroDte.netVex || 0) > 0,
    cex: laneExposureAvailable.cex || Math.abs(heatmap?.zeroDte.netCex || 0) > 0,
  }), [
    heatmap?.zeroDte.netCex,
    heatmap?.zeroDte.netDex,
    heatmap?.zeroDte.netVex,
    laneExposureAvailable.cex,
    laneExposureAvailable.dex,
    laneExposureAvailable.vex,
  ]);
  const selectedSessionIndex = Math.max(0, data.sessions.findIndex((session) => session.snapshotMinuteEt === selectedMinute));
  const selectedSession = data.selectedSnapshot || heatmap?.session || null;
  const isDelayedSnapshot = Boolean(
    selectedSession &&
    selectedSession.collectedMinuteEt !== undefined &&
    selectedSession.collectedMinuteEt !== selectedSession.snapshotMinuteEt,
  );
  const sourceText = heatmap
    ? `${isDelayedSnapshot ? `15-min delayed Yahoo snapshot · collected ${selectedSession?.collectedTimeEt} ET. ` : ""}${heatmap.source.note}`
    : "";

  return (
    <section className="h-full w-full overflow-y-auto bg-[#02070d] px-3 pb-8 pt-4 text-white sm:px-5 lg:px-7">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-cyan-400/20 pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <button
              onClick={onBackToWork}
              className="mb-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/70 transition-colors hover:text-cyan-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Work gallery
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-black tracking-normal text-white sm:text-4xl">SPX Intraday GEX Board</h1>
              {heatmap && (
                <span className="border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-mono text-xs font-black text-cyan-100">
                  Spot ${heatmap.quote.last.toFixed(2)}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              Strike-by-expiry GEX matrix with deterministic structure labels and DEX/VEX/CEX exposure lanes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 items-center gap-2 border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-300">
              <CalendarDays className="h-4 w-4 text-cyan-200" />
              <select
                value={selectedDate}
                onChange={(event) => {
                  setPlaying(false);
                  void loadHeatmap(event.target.value, null);
                }}
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
              onClick={() => {
                setPlaying(false);
                void loadHeatmap(undefined, null, { bypassCache: true });
              }}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 transition-colors hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              title="Refresh latest DB snapshot"
              aria-label="Refresh latest DB snapshot"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {error && <Notice tone="red" text={error} />}
        {data.warnings.length > 0 && <Notice tone="amber" text={data.warnings.join(" ")} />}

        {loading && !heatmap ? (
          <div className="flex h-72 items-center justify-center border border-white/10 bg-white/[0.03] text-sm uppercase tracking-[0.2em] text-zinc-500">
            Loading SPX GEX
          </div>
        ) : heatmap ? (
          <>
            <section className="border border-[#123142] bg-[#06111a] p-3">
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label="Snapshot" value={heatmap.session?.snapshotTimeEt || "n/a"} />
                <Metric label="0DTE NetGEX" value={formatSignedCompact(heatmap.zeroDte.netGex)} />
                <Metric label="DEX" value={summaryExposureAvailable.dex ? formatSignedCompact(heatmap.zeroDte.netDex) : "-"} />
                <Metric label="VEX" value={summaryExposureAvailable.vex ? formatSignedCompact(heatmap.zeroDte.netVex) : "-"} />
                <Metric label="CEX" value={summaryExposureAvailable.cex ? formatSignedCompact(heatmap.zeroDte.netCex) : "-"} />
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <button
                  onClick={() => setPlaying((value) => !value)}
                  disabled={data.sessions.length <= 1}
                  className="inline-flex h-10 w-12 items-center justify-center border border-pink-400/30 bg-pink-400/15 text-pink-100 transition-colors hover:bg-pink-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                  title={playing ? "Pause timeline" : "Play timeline"}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, data.sessions.length - 1)}
                    value={selectedSessionIndex}
                    onChange={(event) => {
                      const next = data.sessions[Number(event.target.value)];
                      setPlaying(false);
                      if (next) void loadHeatmap(selectedDate, next.snapshotMinuteEt);
                    }}
                    className="w-full accent-cyan-300"
                  />
                  <div className="mt-1 flex justify-between gap-2 overflow-hidden font-mono text-[10px] font-black text-cyan-200/70">
                    {data.sessions.map((session) => (
                      <button
                        key={session.snapshotMinuteEt}
                        onClick={() => {
                          setPlaying(false);
                          void loadHeatmap(selectedDate, session.snapshotMinuteEt);
                        }}
                        className={session.snapshotMinuteEt === selectedMinute ? "text-yellow-300" : "text-cyan-200/55"}
                      >
                        {session.snapshotTimeEt}
                      </button>
                    ))}
                  </div>
                </div>
                <select
                  value={speedMs}
                  onChange={(event) => setSpeedMs(Number(event.target.value))}
                  className="h-10 border border-white/10 bg-[#08131d] px-3 text-sm font-bold text-white outline-none"
                >
                  <option value={1400}>1X</option>
                  <option value={900}>2X</option>
                  <option value={500}>3X</option>
                </select>
              </div>
            </section>

            <section className="overflow-x-auto border border-[#123142] bg-[#030910]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#123142] bg-[#06111a] px-3 py-2">
                <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/70">
                  {visibleStrikes.length} / {heatmap.strikes.length} strikes
                </div>
                <div className="inline-flex h-9 items-center border border-cyan-300/20 bg-cyan-300/10 p-0.5">
                  {(["auto", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRowRangeMode(mode)}
                      className={`h-7 px-3 font-mono text-[11px] font-black uppercase transition-colors ${
                        rowRangeMode === mode ? "bg-cyan-200 text-[#03111a]" : "text-cyan-100 hover:bg-cyan-300/15"
                      }`}
                      aria-pressed={rowRangeMode === mode}
                    >
                      {mode === "auto" ? "Auto" : "All"}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full min-w-[1540px] table-fixed border-collapse font-mono text-[11px]">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <HeaderCell width="70px">STRIKE</HeaderCell>
                    {heatmap.selectedExpiries.map((expiry) => (
                      <HeaderCell key={expiry}>{expiry.slice(5)}</HeaderCell>
                    ))}
                    <HeaderCell width="76px">STRIKE</HeaderCell>
                    <HeaderCell width="365px">NET GEX / STRUCTURE</HeaderCell>
                    <HeaderCell width="220px">DEX</HeaderCell>
                    <HeaderCell width="220px">VEX</HeaderCell>
                    <HeaderCell width="220px">CEX</HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {visibleStrikes.map((strike) => {
                    const profile = profileByStrike.get(strike);
                    const isSpotStrike = strike === spotStrike;
                    return (
                      <tr key={strike} className={isSpotStrike ? "bg-yellow-400/10" : ""}>
                        <StrikeCell strike={strike} isSpotStrike={isSpotStrike} />
                        {heatmap.selectedExpiries.map((expiry) => {
                          const cell = cellByKey.get(`${strike}:${expiry}`);
                          const auditLines = cellAuditLines(cell);
                          return (
                            <td
                              key={`${strike}-${expiry}`}
                              className="group relative border border-[#102433] px-1.5 py-[2px] text-right font-black tabular-nums"
                              style={cellStyle(cell?.netGex, maxGex)}
                              title={auditLines.join("\n")}
                              data-gex-audit-cell={cell ? "true" : undefined}
                            >
                              <span>{formatCompact(cell?.netGex)}</span>
                              {cell && (
                                <span
                                  className="pointer-events-none absolute left-1/2 top-full z-50 hidden w-80 -translate-x-1/2 whitespace-normal border border-cyan-300/35 bg-[#02070d] p-2 text-left text-[10px] font-semibold leading-4 text-cyan-50 shadow-2xl shadow-black/60 group-hover:block"
                                  data-gex-audit-tooltip="true"
                                >
                                  {auditLines.map((line) => (
                                    <span key={line} className="block">
                                      {line}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <StrikeCell strike={strike} isSpotStrike={isSpotStrike} />
                        <td className="border border-[#102433] bg-[#050c14] px-1.5 py-[2px]">
                          <div className="grid grid-cols-[150px_72px_1fr] items-center gap-2">
                            <ExposureBar value={profile?.netGex || 0} max={maxGex} />
                            <span className="text-right font-black text-cyan-100">{formatSignedCompact(profile?.netGex)}</span>
                            <span className="flex min-h-4 flex-wrap items-center gap-1 overflow-hidden">
                              {isSpotStrike && (
                                <span className="border border-yellow-300/45 bg-yellow-300/15 px-1 py-0 text-[9px] font-black text-yellow-100">
                                  Spot ${heatmap.quote.last.toFixed(2)}
                                </span>
                              )}
                              {(profile?.tags || []).map((tag) => (
                                <span key={tag.type} className={`px-1 py-0 text-[9px] font-black ${tagClass(tag.severity)}`}>
                                  {tag.label}
                                </span>
                              ))}
                            </span>
                          </div>
                        </td>
                        <ExposureCell value={laneExposureAvailable.dex ? profile?.netDex : null} max={exposureMax.dex} />
                        <ExposureCell value={laneExposureAvailable.vex ? profile?.netVex : null} max={exposureMax.vex} />
                        <ExposureCell value={laneExposureAvailable.cex ? profile?.netCex : null} max={exposureMax.cex} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="grid gap-3 text-xs text-zinc-400 lg:grid-cols-[1fr_360px]">
              <div className="border border-[#123142] bg-[#050c14] p-3 leading-6">{heatmap.premarketInterpretation.paragraph}</div>
              <div className="border border-[#123142] bg-[#050c14] p-3">
                <div className="mb-2 flex items-center gap-2 font-black uppercase tracking-[0.16em] text-cyan-200">
                  <Gauge className="h-4 w-4" />
                  Source
                </div>
                <div className="leading-6">{sourceText}</div>
              </div>
            </section>
          </>
        ) : (
          <div className="flex h-72 flex-col items-center justify-center gap-3 border border-white/10 bg-white/[0.03] text-center">
            <Waves className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-500">No retained SPX GEX snapshots found.</p>
          </div>
        )}
      </div>
    </section>
  );
}

const Notice = ({ tone, text }: { tone: "red" | "amber"; text: string }) => (
  <div className={`flex items-center gap-2 border px-4 py-3 text-sm ${tone === "red" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
    <AlertTriangle className="h-4 w-4" />
    {text}
  </div>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-[#123142] bg-black/20 px-3 py-2">
    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
    <div className="mt-1 truncate font-mono text-lg font-black text-white">{value}</div>
  </div>
);

const HeaderCell = ({ children, width }: { children: string; width?: string }) => (
  <th className="border border-[#102433] bg-[#07121c] px-1.5 py-1.5 text-center font-black text-cyan-300" style={{ width }}>
    {children}
  </th>
);

const StrikeCell = ({ strike, isSpotStrike }: { strike: number; isSpotStrike: boolean }) => (
  <th className={`border border-[#102433] px-1.5 py-[2px] text-right font-black tabular-nums ${isSpotStrike ? "bg-yellow-300/15 text-yellow-100" : "bg-[#06121c] text-cyan-300"}`}>
    {strike.toLocaleString("en-US", { maximumFractionDigits: 0 })}
  </th>
);

const ExposureBar = ({ value, max }: { value: number; max: number }) => {
  const width = `${Math.max(2, Math.min(100, (Math.abs(value) / Math.max(1, max)) * 100))}%`;
  return (
    <div className="h-2.5 overflow-hidden bg-[#07111b]">
      <div className="h-full" style={{ width, background: `linear-gradient(90deg, ${exposureColor(value)}, transparent)` }} />
    </div>
  );
};

const ExposureCell = ({ value, max }: { value: number | null | undefined; max: number }) => (
  <td className="border border-[#102433] bg-[#050c14] px-1.5 py-[2px]">
    <div className="grid grid-cols-[1fr_72px] items-center gap-2">
      {typeof value === "number" && Number.isFinite(value) ? <ExposureBar value={value} max={max} /> : <div className="h-2.5 bg-[#07111b]" />}
      <span className="text-right font-black tabular-nums text-cyan-50">{formatSignedCompact(value)}</span>
    </div>
  </td>
);
