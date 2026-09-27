import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ExternalLink, RefreshCw, Search } from "lucide-react";
import { SECTOR_ROTATION_WINDOWS, validateSectorRotationSnapshot, type RotationWindow, type SectorRotationHolding, type SectorRotationRow, type SectorRotationSnapshot } from "@/lib/sector-rotation";
import type { BreadthCell, MarketBreadthFreshness } from "@/lib/market-breadth";
import "./sector-rotation-page.css";

type ReadyPayload = SectorRotationSnapshot & { status: "READY"; freshness: MarketBreadthFreshness };
type Sort = { key: string; direction: "asc" | "desc" };
const COLORS = ["#f6ad49", "#64b5f6", "#57c785", "#df8383", "#b99ee8", "#70ccd0", "#e7cb72", "#b4c982", "#e58fc4", "#96a8c4", "#b1a191"];
const percent = (value: number | null, digits = 2) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
const weight = (value: number) => `${value.toFixed(2)}%`;
const signed = (value: number | null, digits = 3) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const tone = (value: number | null) => value === null || value === 0 ? "sr-muted" : value > 0 ? "sr-positive" : "sr-negative";
const shortDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const timestamp = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
const quadrantClass = (quadrant: string) => `sr-quadrant sr-${quadrant.toLowerCase()}`;

function sortRows<T>(rows: T[], sort: Sort, value: (row: T, key: string) => string | number | null) {
  return [...rows].sort((a, b) => {
    const left = value(a, sort.key);
    const right = value(b, sort.key);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? result : -result;
  });
}

function parseReady(value: unknown): ReadyPayload {
  if (!value || typeof value !== "object" || (value as { status?: unknown }).status !== "READY") throw new Error("The sector rotation API did not return a ready snapshot.");
  const freshness = (value as { freshness?: MarketBreadthFreshness }).freshness;
  if (!freshness || !["FRESH", "STALE"].includes(freshness.status) || !["CURRENT", "LATEST_REFRESH_FAILED", "SNAPSHOT_TOO_OLD"].includes(freshness.reason)
    || (freshness.failedAt !== undefined && (typeof freshness.failedAt !== "string" || !Number.isFinite(Date.parse(freshness.failedAt))))
    || (freshness.errorClass !== undefined && typeof freshness.errorClass !== "string")) throw new Error("Sector rotation freshness metadata is invalid.");
  return { ...validateSectorRotationSnapshot(value), status: "READY", freshness };
}

export function SectorRotationPage({ onBackToWork }: { onBackToWork: () => void }) {
  const [data, setData] = useState<ReadyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; message: string; code?: string } | null>(null);
  const [windowKey, setWindowKey] = useState<RotationWindow>("oneMonth");
  const [trailWeeks, setTrailWeeks] = useState(12);
  const [selectedEtf, setSelectedEtf] = useState("XLK");
  const [sectorSort, setSectorSort] = useState<Sort>({ key: "oneMonth", direction: "desc" });
  const [stockSort, setStockSort] = useState<Sort>({ key: "proxy", direction: "desc" });
  const [search, setSearch] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sector-rotation", { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!(response.headers.get("content-type") || "").toLowerCase().includes("json")) throw new Error("The sector rotation service returned a non-JSON response.");
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = payload && typeof payload === "object" ? payload as { status?: unknown; message?: unknown; errorCode?: unknown } : {};
        if (response.status === 404 && failure.status === "EMPTY") {
          setData(null);
          setError({ title: "Sector rotation is not published yet", message: typeof failure.message === "string" ? failure.message : "No completed EOD sector rotation snapshot is available.", code: typeof failure.errorCode === "string" ? failure.errorCode : undefined });
          return;
        }
        throw new Error([typeof failure.message === "string" ? failure.message : `Sector rotation returned HTTP ${response.status}.`, typeof failure.errorCode === "string" ? `(${failure.errorCode})` : ""].filter(Boolean).join(" "));
      }
      const ready = parseReady(payload);
      setData(ready);
      setSelectedEtf((current) => ready.sectors.some((row) => row.etf === current) ? current : ready.sectors[0].etf);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setData(null);
      setError({ title: "Sector rotation unavailable", message: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);

  const selected = data?.sectors.find((row) => row.etf === selectedEtf) || null;
  const selectedHoldings = useMemo(() => data?.holdings.filter((row) => row.sectorEtf === selectedEtf) || [], [data, selectedEtf]);
  const windowLabel = SECTOR_ROTATION_WINDOWS.find((item) => item.key === windowKey)!.label;
  const sectors = useMemo(() => sortRows(data?.sectors || [], sectorSort, (row, key) => {
    if (key === "sector") return row.sector;
    if (key === "quadrant") return row.rotation.quadrant;
    if (key === "breadth") return row.breadth.outperformingSpy[windowKey].pct;
    if (key === "sma50" || key === "sma200") return row.breadth[key].pct;
    return row.relativeToSpy[key as RotationWindow];
  }), [data, sectorSort, windowKey]);
  const stocks = useMemo(() => sortRows(selectedHoldings.filter((row) => `${row.ticker} ${row.name}`.toLowerCase().includes(search.trim().toLowerCase())), stockSort, (row, key) => {
    if (key === "ticker") return row.ticker;
    if (key === "return") return row.returns[windowKey];
    if (key === "rsSpy") return row.relativeToSpy[windowKey];
    if (key === "rsSector") return row.relativeToSector[windowKey];
    if (key === "spyWeight") return row.spyWeightPct;
    if (key === "sectorWeight") return row.sectorWeightPct;
    return row.contributionProxy[windowKey];
  }), [selectedHoldings, stockSort, search, windowKey]);
  const topWeights = useMemo(() => [...selectedHoldings].sort((a, b) => b.sectorWeightPct - a.sectorWeightPct), [selectedHoldings]);
  const drivers = useMemo(() => selectedHoldings.filter((row) => (row.contributionProxy[windowKey] ?? 0) > 0).sort((a, b) => b.contributionProxy[windowKey]! - a.contributionProxy[windowKey]!).slice(0, 5), [selectedHoldings, windowKey]);
  const drags = useMemo(() => selectedHoldings.filter((row) => (row.contributionProxy[windowKey] ?? 0) < 0).sort((a, b) => a.contributionProxy[windowKey]! - b.contributionProxy[windowKey]!).slice(0, 5), [selectedHoldings, windowKey]);
  const select = (etf: string) => { setSelectedEtf(etf); setSearch(""); };
  const weeklyDates = data?.sectors.flatMap((row) => row.rotation.asOf ? [row.rotation.asOf] : []).sort() || [];

  return <section className="sr-page" data-sector-rotation data-testid="rotation-page">
    <div className="sr-wrap">
      <header className="sr-header">
        <button className="sr-back" type="button" onClick={onBackToWork}><ArrowLeft size={14} /> Market Lab</button>
        <div className="sr-heading"><div><p className="sr-eyebrow">Market internals / L1 sectors</p><h1>SPY SECTOR ROTATION</h1><p className="sr-subtitle">Follow relative leadership. Inspect participation. Find the stocks supporting each sector.</p></div>
          <button className="sr-reload" type="button" onClick={() => void load()} disabled={loading} title="Reload the published EOD snapshot"><RefreshCw size={14} className={loading ? "sr-spin" : ""} /> Reload EOD</button>
        </div>
        <div className="sr-method-note">Sector ETF overview vs SPY · Stock detail uses current SPY members and weights · Price returns, excluding dividends · Transparent 10-week / 4-week model, not official JdK RRG.</div>
        {data && <div className="sr-metadata"><Meta label="EOD price date" value={date(data.priceAsOf)} /><Meta label="Holdings date" value={date(data.holdingsAsOf)} /><Meta label="Weekly rotation close" value={weeklyDates.length ? date(weeklyDates[weeklyDates.length - 1]) : "Unavailable"} /><Meta label="SPY universe" value={`${data.universeCount} names`} /><Meta label="Snapshot" value={data.freshness.status} tone={data.freshness.status === "FRESH" ? "sr-positive" : "sr-amber"} /></div>}
      </header>

      {data && <p className="sr-source-metadata" data-testid="source-metadata">Sources: State Street dated SPY / sector holdings · Massive split-adjusted EOD closes · {windowLabel} stock coverage {data.coverage.eligibleByWindow[windowKey]} / {data.universeCount} · excludes dividends.</p>}

      {loading && <div className="sr-status sr-loading" role="status"><RefreshCw className="sr-spin" size={20} /><h2>Loading published sector rotation</h2><p>Reading the latest completed EOD snapshot.</p></div>}
      {!loading && error && <div className="sr-status sr-error" role="alert" data-testid="rotation-error"><h2>{error.title}</h2><p>{error.message}</p>{error.code && <p className="sr-muted">{error.code}</p>}<button type="button" className="sr-reload" onClick={() => void load()}>Retry</button></div>}
      {!loading && data && selected && <div className="sr-body">
        {data.freshness.status === "STALE" && <div className="sr-warning" role="status" data-testid="stale-banner"><strong>STALE SNAPSHOT</strong> · Last successful close: {date(data.priceAsOf)}. {data.freshness.failedAt ? `Latest refresh failed ${timestamp(data.freshness.failedAt)}. ` : "The published snapshot is older than the expected EOD window. "}{data.freshness.errorClass && `Failure: ${data.freshness.errorClass}.`}</div>}
        <div className="sr-toolbar"><div className="sr-control"><span>Return window</span><div role="group" aria-label="Return window">{SECTOR_ROTATION_WINDOWS.map((item) => <button type="button" key={item.key} aria-pressed={windowKey === item.key} onClick={() => setWindowKey(item.key)}>{item.label}</button>)}</div></div><div className="sr-control"><span>Weekly trail</span><div role="group" aria-label="Weekly trail length">{[4, 8, 12].map((weeks) => <button type="button" key={weeks} aria-pressed={trailWeeks === weeks} onClick={() => setTrailWeeks(weeks)}>{weeks}w</button>)}</div></div><p>11 sector ETFs · benchmark SPY · <strong>{selected.etf}</strong> selected</p></div>
        <div className="sr-charts">
          <Panel title="Relative rotation" subtitle="Weekly sector ETF / SPY · 100 = own moving-average baseline" className="sr-chart-panel"><RotationChart rows={data.sectors} selected={selectedEtf} weeks={trailWeeks} onSelect={select} /><p className="sr-chart-caption">Click a dot or ETF below to inspect its stocks. Trails use completed weekly closes; quadrant classification stays weekly when the return window changes.</p></Panel>
          <Panel title="Relative strength vs SPY" subtitle={`${windowLabel} · rebased to 100 · top 3 / bottom 3 + selected sector`} className="sr-chart-panel"><RelativeChart rows={data.sectors} selected={selectedEtf} windowKey={windowKey} onSelect={select} /><p className="sr-chart-caption">Above 100 = outperforming SPY since this window's starting close. Relative leadership can occur while absolute prices fall.</p></Panel>
        </div>
        <Panel title="Sector RS ranking" subtitle="Select a sector to link both charts and the stock detail · click a header to sort">
          <div className="sr-table-scroll"><table className="sr-table sr-sector-table" data-testid="sector-ranking"><caption className="sr-sr-only">Sector ETF relative strength ranking versus SPY, sector stock breadth, and weekly quadrants.</caption><thead><tr><SortHeader label="Sector / ETF" sortKey="sector" sort={sectorSort} setSort={setSectorSort} />{SECTOR_ROTATION_WINDOWS.map((item) => <SortHeader key={item.key} label={`RS ${item.label}`} sortKey={item.key} sort={sectorSort} setSort={setSectorSort} />)}<SortHeader label={`Beat SPY ${windowLabel}`} sortKey="breadth" sort={sectorSort} setSort={setSectorSort} /><SortHeader label="> SMA50" sortKey="sma50" sort={sectorSort} setSort={setSectorSort} /><SortHeader label="> SMA200" sortKey="sma200" sort={sectorSort} setSort={setSectorSort} /><SortHeader label="Quadrant" sortKey="quadrant" sort={sectorSort} setSort={setSectorSort} /></tr></thead><tbody>{sectors.map((row) => <tr key={row.etf} className={row.etf === selectedEtf ? "sr-selected" : ""} onClick={() => select(row.etf)} data-sector-etf={row.etf}><th scope="row"><button type="button" className="sr-sector-name" onClick={(event) => { event.stopPropagation(); select(row.etf); }} aria-pressed={row.etf === selectedEtf}><span className="sr-ticker" style={{ color: COLORS[data.sectors.findIndex((item) => item.etf === row.etf) % COLORS.length] }}>{row.etf}</span>{row.sector}<small>{row.holdingCount} SPY names · {weight(row.weightPct)} SPY weight</small></button></th>{SECTOR_ROTATION_WINDOWS.map((item) => <Value key={item.key} value={row.relativeToSpy[item.key]} />)}<Breadth cell={row.breadth.outperformingSpy[windowKey]} /><Breadth cell={row.breadth.sma50} /><Breadth cell={row.breadth.sma200} /><td><span className={quadrantClass(row.rotation.quadrant)}>{row.rotation.quadrant}</span></td></tr>)}</tbody></table></div>
          <p className="sr-panel-note">RS = (sector ETF price growth ÷ SPY price growth − 1) × 100. Breadth uses individual current SPY constituents, with eligible / total coverage shown.</p>
        </Panel>

        <section className="sr-drilldown" aria-labelledby="sr-stock-heading">
          <div className="sr-drilldown-heading"><div><p className="sr-eyebrow">Inside the sector / current SPY basket</p><h2 id="sr-stock-heading" data-testid="selected-sector">{selected.sector} <span>{selected.etf}</span></h2></div><span className={quadrantClass(selected.rotation.quadrant)}>{selected.rotation.quadrant}</span></div>
          <div className="sr-context"><Metric label={`${selected.etf} return ${windowLabel}`} value={percent(selected.returns[windowKey])} className={tone(selected.returns[windowKey])} note={`SPY ${percent(data.benchmark.returns[windowKey])}`} /><Metric label={`RS vs SPY ${windowLabel}`} value={percent(selected.relativeToSpy[windowKey])} className={tone(selected.relativeToSpy[windowKey])} note="ETF relative price growth" /><Metric label={`Stocks beating SPY ${windowLabel}`} value={selected.breadth.outperformingSpy[windowKey].pct === null ? "—" : weight(selected.breadth.outperformingSpy[windowKey].pct!)} note={coverageNote(selected.breadth.outperformingSpy[windowKey])} /><Metric label="Above SMA50 / SMA200" value={`${selected.breadth.sma50.pct === null ? "—" : selected.breadth.sma50.pct.toFixed(0) + "%"} / ${selected.breadth.sma200.pct === null ? "—" : selected.breadth.sma200.pct.toFixed(0) + "%"}`} note={`Eligible ${selected.breadth.sma50.eligible} / ${selected.breadth.sma200.eligible} of ${selected.holdingCount}`} /><Metric label="Largest current basket weight" value={topWeights[0] ? weight(topWeights[0].sectorWeightPct) : "—"} note={topWeights[0]?.ticker || "Unavailable"} /><Metric label="Top 3 concentration" value={weight(topWeights.slice(0, 3).reduce((sum, row) => sum + row.sectorWeightPct, 0))} note="Share of current SPY sector basket" /></div>
          <p className="sr-participation-note">Positive price returns over {windowLabel}: <strong>{selected.breadth.positiveReturn[windowKey].pct === null ? "Unavailable" : `${selected.breadth.positiveReturn[windowKey].pct.toFixed(1)}%`}</strong> of eligible stocks · {coverageNote(selected.breadth.positiveReturn[windowKey])}. High relative strength can coexist with weak absolute participation.</p>
          <div className="sr-driver-grid"><DriverPanel title={`Largest positive drivers / ${windowLabel}`} rows={drivers} windowKey={windowKey} /><DriverPanel title={`Largest negative drags / ${windowLabel}`} rows={drags} windowKey={windowKey} /></div>
          <Panel title="Constituent detail" subtitle="Current SPY weights · sector weight = SPY stock weight ÷ total SPY sector weight">
            <div className="sr-stock-toolbar"><label className="sr-search"><Search size={15} /><span className="sr-sr-only">Search sector stocks by ticker or company</span><input aria-label="Search stocks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticker or company" type="search" /></label><p>{stocks.length} / {selectedHoldings.length} stocks shown · {windowLabel} window</p></div>
            <div className="sr-table-scroll"><table className="sr-table sr-stock-table" data-testid="stock-table"><caption className="sr-sr-only">Current sector constituents: absolute returns, relative strength, current weights, estimated contribution and moving-average participation.</caption><thead><tr><SortHeader label="Stock" sortKey="ticker" sort={stockSort} setSort={setStockSort} /><SortHeader label={`Return ${windowLabel}`} sortKey="return" sort={stockSort} setSort={setStockSort} /><SortHeader label="RS vs SPY" sortKey="rsSpy" sort={stockSort} setSort={setStockSort} /><SortHeader label={`RS vs ${selected.etf}`} sortKey="rsSector" sort={stockSort} setSort={setStockSort} /><SortHeader label="SPY weight" sortKey="spyWeight" sort={stockSort} setSort={setStockSort} /><SortHeader label="Sector weight" sortKey="sectorWeight" sort={stockSort} setSort={setStockSort} /><SortHeader label="Driver proxy (pp)" sortKey="proxy" sort={stockSort} setSort={setStockSort} /><th scope="col">&gt; SMA50 / 200</th></tr></thead><tbody>{stocks.map((row) => <tr key={row.ticker}><th scope="row"><strong>{row.ticker}</strong><small>{row.name}</small></th><Value value={row.returns[windowKey]} /><Value value={row.relativeToSpy[windowKey]} /><Value value={row.relativeToSector[windowKey]} /><td>{weight(row.spyWeightPct)}</td><td>{weight(row.sectorWeightPct)}</td><Value value={row.contributionProxy[windowKey]} unit=" pp" digits={3} /><td className="sr-sma-status"><span className={row.aboveSma50 === null ? "sr-muted" : row.aboveSma50 ? "sr-positive" : "sr-negative"}>{row.aboveSma50 === null ? "—" : row.aboveSma50 ? "Yes" : "No"}</span> / <span className={row.aboveSma200 === null ? "sr-muted" : row.aboveSma200 ? "sr-positive" : "sr-negative"}>{row.aboveSma200 === null ? "—" : row.aboveSma200 ? "Yes" : "No"}</span></td></tr>)}</tbody></table>{stocks.length === 0 && <p className="sr-empty-result" role="status">No stocks match this search.</p>}</div>
            <p className="sr-panel-note">Driver proxy = current normalized SPY sector weight × stock price return. This estimates contribution to the current SPY basket; it does not reproduce {selected.etf} holdings or historical index contribution. Missing windows remain unavailable.</p>
          </Panel>
        </section>
        <details className="sr-methodology"><summary>Methodology, coverage & sources</summary><div><p>The overview uses the 11 Select Sector SPDR ETFs relative to SPY. Weekly RS-Ratio = 100 × (ETF / SPY) ÷ its 10-week simple average. RS-Momentum = 100 × RS-Ratio ÷ its 4-week simple average. Leading: both above 100; Weakening: ratio above, momentum below; Lagging: both below; Improving: ratio below, momentum above. Neutral denotes a value on the 100 boundary. This is a transparent custom model, not the proprietary JdK calculation.</p><p>Ranking windows use 21 / 63 / 126 / 252 completed trading sessions. Returns use split-adjusted prices, excluding dividends. Current sector members and weights are applied to stock detail; historical membership and historical-weight attribution are unavailable. Breadth excludes ineligible histories instead of counting them as falling stocks.</p><p>Generated {timestamp(data.generatedAt)} · snapshot {data.snapshotId} · source snapshot {data.sourceSnapshotId}</p><div className="sr-source-links"><a href="https://www.ssga.com/uk/en_gb/institutional/etfs/state-street-spdr-sp-500-etf-trust-spy" target="_blank" rel="noreferrer">State Street: SPY / sector holdings <ExternalLink size={12} /></a><a href="https://massive.com/docs/rest/stocks/aggregates/daily-market-summary" target="_blank" rel="noreferrer">Massive: split-adjusted daily closes <ExternalLink size={12} /></a></div>{data.warnings.length > 0 && <ul className="sr-warning-list">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div></details>
      </div>}
    </div>
  </section>;
}

function Meta({ label, value, tone: color = "" }: { label: string; value: string; tone?: string }) { return <div><span>{label}</span><strong className={color}>{value}</strong></div>; }
function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: ReactNode; className?: string }) { return <section className={`sr-panel ${className}`}><header><h2>{title}</h2><p>{subtitle}</p></header>{children}</section>; }
function Metric({ label, value, note, className = "" }: { label: string; value: string; note: string; className?: string }) { return <div><span>{label}</span><strong className={className}>{value}</strong><small>{note}</small></div>; }
function SortHeader({ label, sortKey, sort, setSort }: { label: string; sortKey: string; sort: Sort; setSort: (value: Sort) => void }) {
  const active = sort.key === sortKey;
  const Icon = active ? sort.direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th scope="col" aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => setSort({ key: sortKey, direction: active && sort.direction === "desc" ? "asc" : "desc" })}>{label}<Icon size={12} /></button></th>;
}
function Value({ value, unit = "%", digits = 2 }: { value: number | null; unit?: string; digits?: number }) { return <td className={tone(value)}>{value === null ? <span title="Insufficient aligned price history">—</span> : `${signed(value, digits)}${unit}`}</td>; }
function coverageNote(cell: BreadthCell) { return `${cell.above} / ${cell.eligible} eligible · ${cell.total} total`; }
function Breadth({ cell }: { cell: BreadthCell }) { return <td title={coverageNote(cell)} className={cell.pct === null ? "sr-muted" : cell.pct >= 60 ? "sr-positive" : cell.pct < 40 ? "sr-negative" : ""}>{cell.pct === null ? "—" : `${cell.pct.toFixed(0)}%`}<small>{cell.eligible}/{cell.total} eligible</small></td>; }
function DriverPanel({ title, rows, windowKey }: { title: string; rows: SectorRotationHolding[]; windowKey: RotationWindow }) { return <section className="sr-driver-panel"><h3>{title}</h3><p>Current SPY basket contribution proxy</p><div>{rows.map((row) => <span key={row.ticker} className="sr-driver-chip" title={`${row.name} · ${weight(row.sectorWeightPct)} sector weight · ${percent(row.returns[windowKey])} price return`}><b>{row.ticker}</b><strong className={tone(row.contributionProxy[windowKey])}>{signed(row.contributionProxy[windowKey])} pp</strong><small>{percent(row.returns[windowKey])} return</small></span>)}{rows.length === 0 && <span className="sr-muted">No eligible {title.includes("positive") ? "positive" : "negative"} contributions.</span>}</div></section>; }

function RotationChart({ rows, selected, weeks, onSelect }: { rows: SectorRotationRow[]; selected: string; weeks: number; onSelect: (etf: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const plot = { x: 64, y: 28, width: 560, height: 346 };
  const points = rows.flatMap((row) => row.rotation.trail.slice(-weeks));
  const ratioRange = Math.max(.5, ...points.map((point) => Math.abs(point.rsRatio - 100))) * 1.18;
  const momentumRange = Math.max(.5, ...points.map((point) => Math.abs(point.rsMomentum - 100))) * 1.18;
  const x = (value: number) => plot.x + ((value - 100 + ratioRange) / (ratioRange * 2)) * plot.width;
  const y = (value: number) => plot.y + ((100 + momentumRange - value) / (momentumRange * 2)) * plot.height;
  const detail = rows.find((row) => row.etf === (hovered || selected));
  const ticks = [-1, -.5, 0, .5, 1];
  return <div className="sr-chart"><svg viewBox="0 0 660 430" role="group" aria-label="Weekly relative rotation chart. Select sector dots using Tab then Enter, or use the ETF buttons below." data-testid="rotation-chart">
    <rect x={plot.x} y={plot.y} width={plot.width / 2} height={plot.height / 2} fill="#153e53" fillOpacity=".35" /><rect x={x(100)} y={plot.y} width={plot.width / 2} height={plot.height / 2} fill="#173f2c" fillOpacity=".35" /><rect x={plot.x} y={y(100)} width={plot.width / 2} height={plot.height / 2} fill="#542630" fillOpacity=".3" /><rect x={x(100)} y={y(100)} width={plot.width / 2} height={plot.height / 2} fill="#574527" fillOpacity=".3" />
    {ticks.map((tick) => <g key={tick}><line x1={x(100 + tick * ratioRange)} y1={plot.y} x2={x(100 + tick * ratioRange)} y2={plot.y + plot.height} stroke={tick === 0 ? "#73807d" : "#273133"} strokeWidth={tick === 0 ? 1.5 : 1} /><line x1={plot.x} y1={y(100 + tick * momentumRange)} x2={plot.x + plot.width} y2={y(100 + tick * momentumRange)} stroke={tick === 0 ? "#73807d" : "#273133"} strokeWidth={tick === 0 ? 1.5 : 1} /><text x={x(100 + tick * ratioRange)} y={plot.y + plot.height + 20} textAnchor="middle" className="sr-axis-tick">{(100 + tick * ratioRange).toFixed(1)}</text><text x={plot.x - 9} y={y(100 + tick * momentumRange) + 4} textAnchor="end" className="sr-axis-tick">{(100 + tick * momentumRange).toFixed(1)}</text></g>)}
    <text x={plot.x + 10} y={plot.y + 17} className="sr-chart-quadrant sr-chart-improving">IMPROVING</text><text x={plot.x + plot.width - 10} y={plot.y + 17} textAnchor="end" className="sr-chart-quadrant sr-chart-leading">LEADING</text><text x={plot.x + 10} y={plot.y + plot.height - 9} className="sr-chart-quadrant sr-chart-lagging">LAGGING</text><text x={plot.x + plot.width - 10} y={plot.y + plot.height - 9} textAnchor="end" className="sr-chart-quadrant sr-chart-weakening">WEAKENING</text>
    <text x={plot.x + plot.width / 2} y="419" textAnchor="middle" className="sr-axis-title">RS-Ratio / 10-week baseline</text><text x="16" y={plot.y + plot.height / 2} textAnchor="middle" transform={`rotate(-90 16 ${plot.y + plot.height / 2})`} className="sr-axis-title">RS-Momentum / 4-week baseline</text>
    {rows.map((row, index) => {
      const trail = row.rotation.trail.slice(-weeks);
      const current = trail[trail.length - 1];
      if (!current) return null;
      const color = COLORS[index % COLORS.length];
      const active = row.etf === selected;
      return <g key={row.etf}><polyline points={trail.map((point) => `${x(point.rsRatio)},${y(point.rsMomentum)}`).join(" ")} fill="none" stroke={color} strokeWidth={active ? 2.7 : 1.4} opacity={active ? 1 : .52} />{trail.slice(0, -1).map((point) => <circle key={point.date} cx={x(point.rsRatio)} cy={y(point.rsMomentum)} r={active ? 2.2 : 1.4} fill={color} opacity={active ? .75 : .4} />)}{active && <circle cx={x(current.rsRatio)} cy={y(current.rsMomentum)} r="10" fill="none" stroke={color} strokeWidth="1.2" />}
        <circle cx={x(current.rsRatio)} cy={y(current.rsMomentum)} r={active ? 6 : 4.5} fill={color} stroke="#101415" strokeWidth="1.5" pointerEvents="none" /><circle cx={x(current.rsRatio)} cy={y(current.rsMomentum)} r="12" fill="transparent" role="button" tabIndex={0} aria-pressed={active} aria-label={`${row.etf} ${row.sector}, ${row.rotation.quadrant}, RS-Ratio ${current.rsRatio.toFixed(2)}, RS-Momentum ${current.rsMomentum.toFixed(2)}`} data-etf={row.etf} onClick={() => onSelect(row.etf)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.etf); } }} onMouseEnter={() => setHovered(row.etf)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(row.etf)} onBlur={() => setHovered(null)}><title>{row.sector} / {row.etf}: {row.rotation.quadrant} · {date(current.date)}</title></circle>{(active || hovered === row.etf) && <text x={x(current.rsRatio) + (current.rsRatio > 100 + ratioRange * .72 ? -9 : 9)} y={y(current.rsMomentum) - 8} textAnchor={current.rsRatio > 100 + ratioRange * .72 ? "end" : "start"} fill={color} className={`sr-dot-label ${active ? "sr-dot-selected" : ""}`}>{row.etf}</text>}</g>;
    })}
  </svg><div className="sr-chart-readout" aria-live="polite">{detail ? <><strong>{detail.etf}</strong> {detail.sector} · <span className={quadrantClass(detail.rotation.quadrant)}>{detail.rotation.quadrant}</span> · Ratio {detail.rotation.rsRatio?.toFixed(2) ?? "—"} / momentum {detail.rotation.rsMomentum?.toFixed(2) ?? "—"}</> : "No eligible weekly rotation history."}</div><div className="sr-legend" role="group" aria-label="Select sector">{rows.map((row, index) => <button key={row.etf} type="button" aria-pressed={row.etf === selected} onClick={() => onSelect(row.etf)} title={row.sector}><i style={{ backgroundColor: COLORS[index % COLORS.length] }} />{row.etf}</button>)}</div></div>;
}

function RelativeChart({ rows, selected, windowKey, onSelect }: { rows: SectorRotationRow[]; selected: string; windowKey: RotationWindow; onSelect: (etf: string) => void }) {
  const ranked = [...rows].filter((row) => row.relativeToSpy[windowKey] !== null).sort((a, b) => b.relativeToSpy[windowKey]! - a.relativeToSpy[windowKey]!);
  const visible = rows.filter((row) => row.etf === selected || ranked.slice(0, 3).includes(row) || ranked.slice(-3).includes(row));
  const allPoints = visible.flatMap((row) => row.performance[windowKey]);
  if (!allPoints.length) return <div className="sr-chart-unavailable">This window has insufficient common-date history. Choose a shorter return window.</div>;
  const plot = { x: 54, y: 28, width: 570, height: 346 };
  const dates = [...new Set(allPoints.map((point) => point.date))].sort();
  const start = Date.parse(dates[0]);
  const end = Date.parse(dates[dates.length - 1]);
  const low = Math.min(100, ...allPoints.map((point) => point.relativeValue));
  const high = Math.max(100, ...allPoints.map((point) => point.relativeValue));
  const padding = Math.max(.5, (high - low) * .12);
  const min = low - padding;
  const max = high + padding;
  const x = (value: string) => plot.x + ((Date.parse(value) - start) / Math.max(1, end - start)) * plot.width;
  const y = (value: number) => plot.y + ((max - value) / (max - min)) * plot.height;
  const selectedRow = rows.find((row) => row.etf === selected);
  return <div className="sr-chart"><svg viewBox="0 0 660 430" role="img" aria-label={`Sector ETF relative price growth versus SPY rebased to 100. Selected ${selected}, relative return ${percent(selectedRow?.relativeToSpy[windowKey] ?? null)}.`} data-testid="relative-performance-chart">
    {[0, .25, .5, .75, 1].map((tick) => <g key={tick}><line x1={plot.x} y1={y(min + tick * (max - min))} x2={plot.x + plot.width} y2={y(min + tick * (max - min))} stroke="#273133" /><text x={plot.x - 9} y={y(min + tick * (max - min)) + 4} textAnchor="end" className="sr-axis-tick">{(min + tick * (max - min)).toFixed(1)}</text></g>)}
    {[dates[0], dates[Math.floor((dates.length - 1) / 2)], dates[dates.length - 1]].filter((item, index, list) => list.indexOf(item) === index).map((item, index, list) => <g key={item}><line x1={x(item)} y1={plot.y} x2={x(item)} y2={plot.y + plot.height} stroke="#273133" /><text x={x(item)} y={plot.y + plot.height + 22} textAnchor={index === 0 ? "start" : index === list.length - 1 ? "end" : "middle"} className="sr-axis-tick">{shortDate(item)}</text></g>)}
    <line x1={plot.x} y1={y(100)} x2={plot.x + plot.width} y2={y(100)} stroke="#a1a7a4" strokeDasharray="5 5" /><text x={plot.x + plot.width - 4} y={y(100) - 7} textAnchor="end" className="sr-axis-tick">SPY / 100</text>
    {visible.map((row) => { const series = row.performance[windowKey]; const color = COLORS[rows.indexOf(row) % COLORS.length]; const last = series[series.length - 1]; return <g key={row.etf}><polyline points={series.map((point) => `${x(point.date)},${y(point.relativeValue)}`).join(" ")} fill="none" stroke={color} strokeWidth={row.etf === selected ? 3 : 1.6} opacity={row.etf === selected ? 1 : .65}><title>{row.sector}: {percent(row.relativeToSpy[windowKey])} relative to SPY</title></polyline>{last && <circle cx={x(last.date)} cy={y(last.relativeValue)} r={row.etf === selected ? 4 : 2.5} fill={color}><title>{row.etf} {date(last.date)}: {last.relativeValue.toFixed(2)}</title></circle>}</g>; })}
    <text x={plot.x + plot.width / 2} y="419" textAnchor="middle" className="sr-axis-title">Relative price growth / rebased 100</text>
  </svg><div className="sr-chart-readout"><strong>{selected}</strong> vs SPY: <span className={tone(selectedRow?.relativeToSpy[windowKey] ?? null)}>{percent(selectedRow?.relativeToSpy[windowKey] ?? null)}</span> · SPY benchmark stays at 100</div><div className="sr-legend" role="group" aria-label="Relative strength plotted sectors">{visible.map((row) => <button type="button" key={row.etf} aria-pressed={selected === row.etf} title={row.sector} onClick={() => onSelect(row.etf)}><i style={{ backgroundColor: COLORS[rows.indexOf(row) % COLORS.length] }} />{row.etf}</button>)}</div></div>;
}
