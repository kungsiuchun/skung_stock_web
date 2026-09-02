import type { SpxGexHeatmapModel } from "./spx-gex-heatmap";
import { isFreshSpx0DteSample } from "./spx-price-action-compass";

const OPEN_MINUTE_ET = 9 * 60 + 30;
const CLOSE_MINUTE_ET = 16 * 60;
const SLOT_MINUTES = 15;
const STRIKE_STEP = 5;
const STRIKE_BUFFER = 50;
const MOVER_LIMIT = 10;

export type SpxGexPressureState =
  | "POSITIVE_STRONGER"
  | "POSITIVE_WEAKER"
  | "NEGATIVE_DEEPER"
  | "NEGATIVE_WEAKER"
  | "FLIP_TO_POSITIVE"
  | "FLIP_TO_NEGATIVE"
  | "UNCHANGED"
  | "NO_BASELINE"
  | "NO_DATA";

export interface SpxGexPressureTimelineSlot {
  snapshotMinuteEt: number;
  snapshotTimeEt: string;
  collectedMinuteEt: number | null;
  collectedTimeEt: string | null;
  status: "READY" | "MISSING" | "PENDING";
  spot: number | null;
  sourceTimestamp: string | null;
}

export interface SpxGexPressureCell {
  snapshotMinuteEt: number;
  state: SpxGexPressureState;
  baselineGex: number | null;
  currentGex: number | null;
  deltaGex: number | null;
  strengthPct: number | null;
  intensityPct: number;
  spot: number | null;
}

export interface SpxGexPressureRow {
  strike: number;
  currentGex: number | null;
  cells: SpxGexPressureCell[];
}

export interface SpxGexPressureMover {
  rank: number;
  strike: number;
  state: SpxGexPressureState;
  baselineGex: number;
  currentGex: number;
  deltaGex: number;
  strengthPct: number | null;
  intensityPct: number;
}

export interface SpxGexPressureMatrixModel {
  tradingDate: string;
  mode: "0DTE";
  expiry: string;
  delayMinutes: number;
  baseline: {
    snapshotMinuteEt: number;
    snapshotTimeEt: string;
    collectedMinuteEt: number;
    collectedTimeEt: string;
    isOfficialOpen: boolean;
  };
  latest: {
    snapshotMinuteEt: number;
    snapshotTimeEt: string;
    collectedTimeEt: string;
    spot: number;
  };
  timeline: SpxGexPressureTimelineSlot[];
  strikeRange: { lower: number; upper: number; step: number };
  rows: SpxGexPressureRow[];
  movers: SpxGexPressureMover[];
  source: {
    provider: string;
    fallbackFrom: string | null;
    sourceTimestamp: string | null;
    snapshotId: string | null;
  };
  warnings: string[];
}

export interface SpxGexPressureSpotCandle {
  time: number;
  close: number;
}

export interface SpxGexPressureSpotPoint {
  time: number;
  minuteEt: number;
  timeEt: string;
  price: number;
}

export interface SpxGexPressureAxisTick extends SpxGexPressureTimelineSlot {
  isMajor: boolean;
  isLatest: boolean;
}

export interface SpxGexPressureChartPoint {
  x: number;
  y: number;
  minuteEt: number;
  timeEt: string;
  price: number;
}

export interface SpxGexPressureChartGeometry {
  resolution: "1m" | "15m-fallback";
  pointCount: number;
  segments: SpxGexPressureChartPoint[][];
  latestPoint: SpxGexPressureChartPoint | null;
  spotGuide: { price: number; y: number; timeEt: string } | null;
  expectedMoveRange: { value: number; upper: { price: number; y: number }; lower: { price: number; y: number } } | null;
}

export const resolveSpxGexExpectedMoveOverlay = (input: {
  source: {
    provider?: string | null;
    status?: "READY" | "STALE" | "UNAVAILABLE";
    latestSampleAt?: string | null;
    expectedMove?: { status: "READY" | "UNAVAILABLE"; value: number | null; sampleAt: string | null; errorCode: string | null };
  } | null | undefined;
  selectedDate: string;
  currentTradingDate: string;
  nowMs?: number;
}) => {
  const nowMs = input.nowMs ?? Date.now();
  const source = input.source;
  const currentContextIsFresh = input.selectedDate === input.currentTradingDate
    && source?.provider === "0dtespx"
    && source.status === "READY"
    && isFreshSpx0DteSample(source.latestSampleAt, nowMs);
  if (!currentContextIsFresh) return { expectedMove: null, warning: null };
  const expectedMove = source.expectedMove;
  if (expectedMove?.status === "READY"
    && finite(expectedMove.value)
    && expectedMove.value > 0
    && isFreshSpx0DteSample(expectedMove.sampleAt, nowMs)) {
    return { expectedMove: expectedMove.value, warning: null };
  }
  const errorCode = expectedMove?.errorCode
    || (expectedMove?.sampleAt ? "ZERO_DTE_SPX_EXPECTED_MOVE_STALE" : "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE");
  return { expectedMove: null, warning: `0DTESPX Expected Move unavailable (${errorCode}).` };
};

export interface SpxGexPressureFrame {
  tradingDate: string;
  snapshotMinuteEt: number;
  snapshotTimeEt: string;
  collectedMinuteEt: number;
  collectedTimeEt: string;
  spot: number;
  expiry: string;
  calculationEngineVersion: number;
  provider: string;
  fallbackFrom: string | null;
  sourceTimestamp: string | null;
  snapshotId: string | null;
  gexByStrike: Array<{ strike: number; netGex: number }>;
}

export interface SpxGexPressureTooltipPositionInput {
  anchor: { left: number; top: number; width: number; height: number };
  viewport: { width: number; height: number };
  tooltip: { width: number; height: number };
  gap?: number;
  margin?: number;
}

const ET_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const toEtDateMinute = (time: number) => {
  const parts = Object.fromEntries(
    ET_DATE_TIME_FORMATTER.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
  const hours = Number(parts.hour);
  const minutes = Number(parts.minute);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return {
    tradingDate: `${parts.year}-${parts.month}-${parts.day}`,
    minuteEt: hours * 60 + minutes,
    timeEt: `${parts.hour}:${parts.minute}`,
  };
};

export const getLatestSpxGexSpotPoint = (
  candles: SpxGexPressureSpotCandle[],
  tradingDate: string,
): SpxGexPressureSpotPoint | null => {
  let latest: SpxGexPressureSpotPoint | null = null;
  for (const candle of candles) {
    if (!finite(candle.time) || !finite(candle.close) || candle.close <= 0) continue;
    const et = toEtDateMinute(candle.time);
    if (!et || et.tradingDate !== tradingDate || et.minuteEt < OPEN_MINUTE_ET || et.minuteEt > CLOSE_MINUTE_ET) continue;
    const point = { time: candle.time, minuteEt: et.minuteEt, timeEt: et.timeEt, price: candle.close };
    if (!latest || point.time > latest.time) latest = point;
  }
  return latest;
};

export const extendSpxGexPressureForSession = (
  pressure: SpxGexPressureMatrixModel,
  clock: { tradingDate: string; minuteEt: number },
): SpxGexPressureMatrixModel => {
  const existingSlots = new Map(pressure.timeline.map((slot) => [slot.snapshotMinuteEt, slot]));
  const isCurrentDate = pressure.tradingDate === clock.tradingDate;
  const timeline: SpxGexPressureTimelineSlot[] = [];
  for (let minute = OPEN_MINUTE_ET; minute <= CLOSE_MINUTE_ET; minute += SLOT_MINUTES) {
    const existing = existingSlots.get(minute);
    if (existing) {
      timeline.push(existing);
      continue;
    }
    const due = !isCurrentDate || clock.minuteEt >= minute + pressure.delayMinutes;
    timeline.push({
      snapshotMinuteEt: minute,
      snapshotTimeEt: formatMinuteEt(minute),
      collectedMinuteEt: null,
      collectedTimeEt: null,
      status: due ? "MISSING" : "PENDING",
      spot: null,
      sourceTimestamp: null,
    });
  }
  const cellsByStrikeMinute = new Map(
    pressure.rows.flatMap((row) => row.cells.map((cell) => [`${row.strike}:${cell.snapshotMinuteEt}`, cell] as const)),
  );
  const rows = pressure.rows.map((row) => ({
    ...row,
    cells: timeline.map((slot) => cellsByStrikeMinute.get(`${row.strike}:${slot.snapshotMinuteEt}`) || ({
      snapshotMinuteEt: slot.snapshotMinuteEt,
      state: "NO_DATA" as const,
      baselineGex: null,
      currentGex: null,
      deltaGex: null,
      strengthPct: null,
      intensityPct: 0,
      spot: null,
    })),
  }));
  return { ...pressure, timeline, rows };
};

export const buildSpxGexOneMinuteSpotSegments = (
  candles: SpxGexPressureSpotCandle[],
  tradingDate: string,
  startMinuteEt: number,
  endMinuteEt: number,
): SpxGexPressureSpotPoint[][] => {
  const pointsByMinute = new Map<number, SpxGexPressureSpotPoint>();
  for (const candle of candles) {
    if (!finite(candle.time) || !finite(candle.close) || candle.close <= 0) continue;
    const et = toEtDateMinute(candle.time);
    if (!et || et.tradingDate !== tradingDate || et.minuteEt < startMinuteEt || et.minuteEt > endMinuteEt) continue;
    pointsByMinute.set(et.minuteEt, {
      time: candle.time,
      minuteEt: et.minuteEt,
      timeEt: et.timeEt,
      price: candle.close,
    });
  }

  const points = [...pointsByMinute.values()].sort((a, b) => a.minuteEt - b.minuteEt || a.time - b.time);
  const segments: SpxGexPressureSpotPoint[][] = [];
  let active: SpxGexPressureSpotPoint[] = [];
  for (const point of points) {
    if (active.length > 0 && point.minuteEt - active[active.length - 1].minuteEt > 1) {
      segments.push(active);
      active = [];
    }
    active.push(point);
  }
  if (active.length > 0) segments.push(active);
  return segments;
};

export const buildSpxGexPressureAxisTicks = (
  timeline: SpxGexPressureTimelineSlot[],
): SpxGexPressureAxisTick[] => {
  const latestMinute = timeline.length > 0 ? timeline[timeline.length - 1].snapshotMinuteEt : null;
  return timeline.map((slot, index) => ({
    ...slot,
    isLatest: slot.snapshotMinuteEt === latestMinute,
    isMajor: index === 0
      || (slot.snapshotMinuteEt - OPEN_MINUTE_ET) % 60 === 0
      || slot.snapshotMinuteEt === latestMinute,
  }));
};

const clamp = (value: number, lower: number, upper: number) => Math.min(Math.max(value, lower), upper);

export const buildSpxGexPressureChartGeometry = (
  pressure: SpxGexPressureMatrixModel,
  oneMinuteSegments: SpxGexPressureSpotPoint[][],
  cellWidth: number,
  rowHeight: number,
  expectedMove: number | null = null,
): SpxGexPressureChartGeometry => {
  const width = pressure.timeline.length * cellWidth;
  const height = pressure.rows.length * rowHeight;
  const usableHeight = Math.max(0, height - rowHeight);
  const priceRange = Math.max(1, pressure.strikeRange.upper - pressure.strikeRange.lower);
  const firstMinute = pressure.timeline[0]?.snapshotMinuteEt ?? pressure.baseline.snapshotMinuteEt;
  const toPoint = (point: Pick<SpxGexPressureSpotPoint, "minuteEt" | "timeEt" | "price">): SpxGexPressureChartPoint => ({
    x: clamp(cellWidth / 2 + ((point.minuteEt - firstMinute) / SLOT_MINUTES) * cellWidth, cellWidth / 2, Math.max(cellWidth / 2, width - cellWidth / 2)),
    y: clamp(((pressure.strikeRange.upper - point.price) / priceRange) * usableHeight + rowHeight / 2, rowHeight / 2, Math.max(rowHeight / 2, height - rowHeight / 2)),
    minuteEt: point.minuteEt,
    timeEt: point.timeEt,
    price: point.price,
  });

  const oneMinutePointCount = oneMinuteSegments.reduce((total, segment) => total + segment.length, 0);
  const usingOneMinute = oneMinutePointCount >= 2;
  const segments = usingOneMinute
    ? oneMinuteSegments.map((segment) => segment.map(toPoint))
    : pressure.timeline.reduce<SpxGexPressureChartPoint[][]>((result, slot) => {
        if (slot.status !== "READY" || slot.spot === null) return result;
        const point = toPoint({ minuteEt: slot.snapshotMinuteEt, timeEt: slot.snapshotTimeEt, price: slot.spot });
        const previousSlot = pressure.timeline.find((item) => item.snapshotMinuteEt === slot.snapshotMinuteEt - SLOT_MINUTES);
        if (!previousSlot || previousSlot.status !== "READY" || result.length === 0) result.push([point]);
        else result[result.length - 1].push(point);
        return result;
      }, []);
  const latestSegment = segments.length > 0 ? segments[segments.length - 1] : null;
  const latestPoint = latestSegment && latestSegment.length > 0 ? latestSegment[latestSegment.length - 1] : null;
  const expectedMoveRange = usingOneMinute && latestPoint && finite(expectedMove) && expectedMove > 0
    ? {
      value: expectedMove,
      upper: { price: latestPoint.price + expectedMove, y: toPoint({ ...latestPoint, price: latestPoint.price + expectedMove }).y },
      lower: { price: latestPoint.price - expectedMove, y: toPoint({ ...latestPoint, price: latestPoint.price - expectedMove }).y },
    }
    : null;
  return {
    resolution: usingOneMinute ? "1m" : "15m-fallback",
    pointCount: usingOneMinute ? oneMinutePointCount : segments.reduce((total, segment) => total + segment.length, 0),
    segments,
    latestPoint,
    spotGuide: latestPoint ? { price: latestPoint.price, y: latestPoint.y, timeEt: latestPoint.timeEt } : null,
    expectedMoveRange,
  };
};

export const getSpxGexPressureTooltipPosition = ({
  anchor,
  viewport,
  tooltip,
  gap = 10,
  margin = 8,
}: SpxGexPressureTooltipPositionInput) => {
  const preferredTop = anchor.top - tooltip.height - gap;
  const belowTop = anchor.top + anchor.height + gap;
  const top = preferredTop >= margin
    ? preferredTop
    : clamp(belowTop, margin, Math.max(margin, viewport.height - tooltip.height - margin));
  const left = clamp(
    anchor.left + anchor.width / 2 - tooltip.width / 2,
    margin,
    Math.max(margin, viewport.width - tooltip.width - margin),
  );
  return { left, top, placement: preferredTop >= margin ? "top" as const : "bottom" as const };
};

const formatMinuteEt = (minute: number) => {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const pressureState = (baseline: number, current: number): SpxGexPressureState => {
  if (baseline > 0 && current < 0) return "FLIP_TO_NEGATIVE";
  if (baseline < 0 && current > 0) return "FLIP_TO_POSITIVE";
  if (baseline === current) return "UNCHANGED";
  if (current > 0) return Math.abs(current) > Math.abs(baseline) ? "POSITIVE_STRONGER" : "POSITIVE_WEAKER";
  if (current < 0) return Math.abs(current) > Math.abs(baseline) ? "NEGATIVE_DEEPER" : "NEGATIVE_WEAKER";
  if (baseline > 0) return "POSITIVE_WEAKER";
  if (baseline < 0) return "NEGATIVE_WEAKER";
  return "UNCHANGED";
};

const strengthPct = (baseline: number, current: number) => baseline === 0
  ? null
  : ((Math.abs(current) - Math.abs(baseline)) / Math.abs(baseline)) * 100;

const frontExpiry = (snapshot: SpxGexHeatmapModel) => snapshot.zeroDte.expiry || snapshot.selectedExpiries[0] || null;

const frontGexByStrike = (snapshot: SpxGexHeatmapModel, expiry: string) => {
  const values = new Map<number, number>();
  for (const cell of snapshot.cells) {
    if (cell.expdate !== expiry || !finite(cell.netGex)) continue;
    if (values.has(cell.strike)) throw new Error(`Duplicate 0DTE GEX cell for ${expiry} strike ${cell.strike}.`);
    values.set(cell.strike, cell.netGex);
  }
  return values;
};

export const toSpxGexPressureFrame = (snapshot: SpxGexHeatmapModel): SpxGexPressureFrame => {
  if (!snapshot.session) throw new Error("SPX GEX pressure snapshot is missing session metadata.");
  const expiry = frontExpiry(snapshot);
  if (!expiry) throw new Error("SPX GEX pressure snapshot is missing a 0DTE expiry.");
  return {
    tradingDate: snapshot.session.tradingDate,
    snapshotMinuteEt: snapshot.session.snapshotMinuteEt,
    snapshotTimeEt: snapshot.session.snapshotTimeEt,
    collectedMinuteEt: snapshot.session.collectedMinuteEt,
    collectedTimeEt: snapshot.session.collectedTimeEt,
    spot: snapshot.quote.last,
    expiry,
    calculationEngineVersion: snapshot.source.calculationEngineVersion
      ?? snapshot.canonical?.calculationEngineVersion
      ?? 1,
    provider: snapshot.canonical?.provider || snapshot.source.provider || "unknown",
    fallbackFrom: snapshot.canonical?.fallbackFrom ?? snapshot.source.fallbackFrom ?? null,
    sourceTimestamp: snapshot.canonical?.sourceTimestamp ?? snapshot.source.sourceTimestamp ?? null,
    snapshotId: snapshot.canonical?.snapshotId ?? null,
    gexByStrike: [...frontGexByStrike(snapshot, expiry)].map(([strike, netGex]) => ({ strike, netGex })),
  };
};

export const buildSpxGexPressureMatrixFromFrames = (input: SpxGexPressureFrame[]): SpxGexPressureMatrixModel => {
  if (input.length === 0) throw new Error("SPX GEX pressure matrix requires at least one snapshot.");
  const sortedSnapshots = [...input].sort((a, b) => a.snapshotMinuteEt - b.snapshotMinuteEt);
  const latestEngineVersion = sortedSnapshots[sortedSnapshots.length - 1].calculationEngineVersion;
  let compatibleStart = sortedSnapshots.length - 1;
  while (compatibleStart > 0 && sortedSnapshots[compatibleStart - 1].calculationEngineVersion === latestEngineVersion) compatibleStart -= 1;
  const snapshots = sortedSnapshots.slice(compatibleStart);
  const compatibilityWarning = compatibleStart > 0
    ? `Calculation engine changed to v${latestEngineVersion}; baseline reset to the first compatible snapshot.`
    : null;
  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  const tradingDate = first.tradingDate;
  const expiry = first.expiry;

  const byMinute = new Map<number, SpxGexPressureFrame>();
  for (const snapshot of snapshots) {
    if (snapshot.tradingDate !== tradingDate) throw new Error("SPX GEX pressure snapshots span multiple trading dates.");
    if (snapshot.expiry !== expiry) throw new Error(`SPX GEX pressure expiry changed within ${tradingDate}.`);
    if ((snapshot.snapshotMinuteEt - OPEN_MINUTE_ET) % SLOT_MINUTES !== 0) {
      throw new Error(`SPX GEX pressure snapshot ${snapshot.snapshotTimeEt} is not on a 15-minute slot.`);
    }
    if (byMinute.has(snapshot.snapshotMinuteEt)) throw new Error(`Duplicate SPX GEX pressure slot ${snapshot.snapshotTimeEt}.`);
    byMinute.set(snapshot.snapshotMinuteEt, snapshot);
  }

  const timeline: SpxGexPressureTimelineSlot[] = [];
  for (let minute = OPEN_MINUTE_ET; minute <= latest.snapshotMinuteEt; minute += SLOT_MINUTES) {
    const snapshot = byMinute.get(minute);
    timeline.push({
      snapshotMinuteEt: minute,
      snapshotTimeEt: formatMinuteEt(minute),
      collectedMinuteEt: snapshot?.collectedMinuteEt ?? null,
      collectedTimeEt: snapshot?.collectedTimeEt ?? null,
      status: snapshot ? "READY" : "MISSING",
      spot: snapshot?.spot ?? null,
      sourceTimestamp: snapshot?.sourceTimestamp ?? null,
    });
  }

  const spots = snapshots.map((snapshot) => snapshot.spot).filter(finite);
  if (spots.length !== snapshots.length) throw new Error("SPX GEX pressure snapshot is missing a finite spot.");
  const lower = Math.floor((Math.min(...spots) - STRIKE_BUFFER) / STRIKE_STEP) * STRIKE_STEP;
  const upper = Math.ceil((Math.max(...spots) + STRIKE_BUFFER) / STRIKE_STEP) * STRIKE_STEP;
  const strikes: number[] = [];
  for (let strike = upper; strike >= lower; strike -= STRIKE_STEP) strikes.push(strike);

  const gexByMinute = new Map<number, Map<number, number>>();
  for (const snapshot of snapshots) gexByMinute.set(snapshot.snapshotMinuteEt, new Map(snapshot.gexByStrike.map(({ strike, netGex }) => [strike, netGex])));
  const baselineValues = gexByMinute.get(first.snapshotMinuteEt)!;
  const latestValues = gexByMinute.get(latest.snapshotMinuteEt)!;

  let dailyMaxDelta = 0;
  const rawRows = strikes.map((strike) => {
    const baselineGex = baselineValues.get(strike);
    const cells = timeline.map<SpxGexPressureCell>((slot) => {
      const currentGex = gexByMinute.get(slot.snapshotMinuteEt)?.get(strike);
      if (!finite(currentGex)) {
        return { snapshotMinuteEt: slot.snapshotMinuteEt, state: "NO_DATA", baselineGex: finite(baselineGex) ? baselineGex : null, currentGex: null, deltaGex: null, strengthPct: null, intensityPct: 0, spot: slot.spot };
      }
      if (!finite(baselineGex)) {
        return { snapshotMinuteEt: slot.snapshotMinuteEt, state: "NO_BASELINE", baselineGex: null, currentGex, deltaGex: null, strengthPct: null, intensityPct: 0, spot: slot.spot };
      }
      const deltaGex = currentGex - baselineGex;
      dailyMaxDelta = Math.max(dailyMaxDelta, Math.abs(deltaGex));
      return { snapshotMinuteEt: slot.snapshotMinuteEt, state: pressureState(baselineGex, currentGex), baselineGex, currentGex, deltaGex, strengthPct: strengthPct(baselineGex, currentGex), intensityPct: 0, spot: slot.spot };
    });
    return { strike, currentGex: latestValues.get(strike) ?? null, cells };
  });

  const rows = rawRows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      intensityPct: finite(cell.deltaGex) && dailyMaxDelta > 0 ? Math.round((Math.abs(cell.deltaGex) / dailyMaxDelta) * 100) : 0,
    })),
  }));

  const latestMinute = latest.snapshotMinuteEt;
  const moverCandidates = rows
    .map((row) => ({ row, cell: row.cells.find((cell) => cell.snapshotMinuteEt === latestMinute) }))
    .filter((entry): entry is { row: SpxGexPressureRow; cell: SpxGexPressureCell & { baselineGex: number; currentGex: number; deltaGex: number } } =>
      Boolean(entry.cell && finite(entry.cell.baselineGex) && finite(entry.cell.currentGex) && finite(entry.cell.deltaGex) && Math.abs(entry.cell.deltaGex) > 0))
    .sort((a, b) => Math.abs(b.cell.deltaGex) - Math.abs(a.cell.deltaGex)
      || Math.abs(b.cell.currentGex) - Math.abs(a.cell.currentGex)
      || b.row.strike - a.row.strike)
    .slice(0, MOVER_LIMIT);
  const topMoverDelta = Math.abs(moverCandidates[0]?.cell.deltaGex ?? 0);
  const movers = moverCandidates.map(({ row, cell }, index) => ({
    rank: index + 1,
    strike: row.strike,
    state: cell.state,
    baselineGex: cell.baselineGex,
    currentGex: cell.currentGex,
    deltaGex: cell.deltaGex,
    strengthPct: cell.strengthPct,
    intensityPct: topMoverDelta > 0 ? Math.round((Math.abs(cell.deltaGex) / topMoverDelta) * 100) : 0,
  }));

  const warnings: string[] = [];
  if (compatibilityWarning) warnings.push(compatibilityWarning);
  if (first.snapshotMinuteEt !== OPEN_MINUTE_ET) {
    warnings.push(`09:30 ET snapshot is missing; baseline uses ${first.snapshotTimeEt} ET.`);
  }

  return {
    tradingDate,
    mode: "0DTE",
    expiry,
    delayMinutes: first.collectedMinuteEt - first.snapshotMinuteEt,
    baseline: {
      snapshotMinuteEt: first.snapshotMinuteEt,
      snapshotTimeEt: first.snapshotTimeEt,
      collectedMinuteEt: first.collectedMinuteEt,
      collectedTimeEt: first.collectedTimeEt,
      isOfficialOpen: first.snapshotMinuteEt === OPEN_MINUTE_ET,
    },
    latest: {
      snapshotMinuteEt: latest.snapshotMinuteEt,
      snapshotTimeEt: latest.snapshotTimeEt,
      collectedTimeEt: latest.collectedTimeEt,
      spot: latest.spot,
    },
    timeline,
    strikeRange: { lower, upper, step: STRIKE_STEP },
    rows,
    movers,
    source: {
      provider: latest.provider,
      fallbackFrom: latest.fallbackFrom,
      sourceTimestamp: latest.sourceTimestamp,
      snapshotId: latest.snapshotId,
    },
    warnings,
  };
};

export const buildSpxGexPressureMatrix = (input: SpxGexHeatmapModel[]): SpxGexPressureMatrixModel =>
  buildSpxGexPressureMatrixFromFrames(input.map(toSpxGexPressureFrame));
