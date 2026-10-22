import type { SpxDecisionCockpitProjection } from "./spx-decision-ledger";
import type { SpxGexCollectionRecord } from "./spx-gex-collection-lifecycle";
import type { SpxGexHeatmapModel, SpxGexSessionSummary } from "./spx-gex-heatmap";
import { parseJsonResponse, SafeJsonResponseError } from "./safe-json-response";

export interface SpxGexHeatmapResponse {
  status: "READY" | "EMPTY" | "BINDING_MISSING" | "STORAGE_UNAVAILABLE" | "ERROR";
  errorCode: string | null;
  error?: string;
  availableDates: string[];
  selectedDate: string | null;
  sessions: SpxGexSessionSummary[];
  selectedSnapshot: SpxGexSessionSummary | null;
  heatmap: SpxGexHeatmapModel | null;
  decision: SpxDecisionCockpitProjection | null;
  collection: SpxGexCollectionRecord | null;
  collectionHealth?: { dueSlots: number; persistedSlots: number; provider: string | null; stage: string | null; failure: string | null } | null;
  warnings: string[];
}

export const emptySpxBoard: SpxGexHeatmapResponse = {
  status: "EMPTY", errorCode: null, availableDates: [], selectedDate: null,
  sessions: [], selectedSnapshot: null, heatmap: null, decision: null, collection: null, warnings: [],
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string");
const list = (value: unknown, valid: (item: Record<string, unknown>) => boolean) => Array.isArray(value) && value.every(item => record(item) && valid(item));
const session = (s: Record<string, unknown>) => typeof s.tradingDate === "string" && finite(s.snapshotMinuteEt) && typeof s.snapshotTimeEt === "string";
const pressureStates = ["POSITIVE_STRONGER", "POSITIVE_WEAKER", "NEGATIVE_DEEPER", "NEGATIVE_WEAKER", "FLIP_TO_POSITIVE", "FLIP_TO_NEGATIVE", "UNCHANGED", "NO_BASELINE", "NO_DATA", "OUTSIDE_COVERAGE"];
const candle = (c: Record<string, unknown>) => ["time", "open", "high", "low", "close", "volume"].every(k => finite(c[k]));
const pattern = (p: Record<string, unknown>) => ["id", "type", "name", "label", "category", "direction", "description"].every(k => typeof p[k] === "string")
  && ["fromIndex", "toIndex", "price", "confidence"].every(k => finite(p[k])) && Array.isArray(p.candleIndices) && p.candleIndices.every(finite);
const zone = (z: Record<string, unknown>) => typeof z.id === "string" && typeof z.type === "string"
  && ["price", "minPrice", "maxPrice", "strength", "distanceToLastPercent"].every(k => finite(z[k]))
  && list(z.touches, t => finite(t.index) && finite(t.price) && typeof t.type === "string");
const cell = (c: Record<string, unknown>) => finite(c.strike) && typeof c.expdate === "string" && nullableNumber(c.netGex)
  && ["repairNotes", "missingReasons", "activeSeries", "inactiveSeries"].every(k => c[k] === undefined || strings(c[k]));
const dateTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const priceSource = (value: unknown) => {
  if (!record(value) || !["yahoo", "0dtespx", "test"].includes(String(value.provider)) || typeof value.label !== "string" || !dateTime(value.fetchedAt)) return false;
  if (value.status !== undefined && !["READY", "STALE", "UNAVAILABLE"].includes(String(value.status))) return false;
  if (value.expectedMove !== undefined) {
    const em = value.expectedMove;
    if (!record(em) || !["READY", "STALE", "UNAVAILABLE"].includes(String(em.status))
      || !nullableNumber(em.value) || !(em.sampleAt === null || dateTime(em.sampleAt))) return false;
  }
  return true;
};
const decision = (d: unknown) => d == null || record(d) && record(d.councilTally) && record(d.cio) && record(d.riskGate) && record(d.delivery)
  && list(d.lifecycle, e => typeof e.stage === "string") && (d.councilAgents == null || list(d.councilAgents, a => Array.isArray(a.attempts)));

/** Validate the structures consumed by the Board before React or chart code can dereference them. */
export async function parseSpxBoardResponse<T>(response: Response, url: string, kind: "heatmap" | "pressure" | "compass" | "overlay" | "detail"): Promise<T> {
  const value = await parseJsonResponse<unknown>(response, url, { allowHttpError: true });
  const invalid = () => { throw new SafeJsonResponseError(`Invalid ${kind} response contract: ${url}`, response.status, response.headers.get("content-type") || "", response.headers.get("cf-ray"), "SCHEMA_INVALID"); };
  if (!record(value)) return invalid();
  // Budget/edge errors deliberately have smaller envelopes; never interpret them as successful data.
  if (!response.ok) {
    if (value.warnings !== undefined && !strings(value.warnings)) return invalid();
    if (typeof value.error !== "string" && typeof value.errorCode !== "string" && !strings(value.warnings)) return invalid();
    return value as T;
  }
  let valid = false;
  if (kind === "heatmap") {
    const h = value.heatmap;
    valid = strings(value.availableDates) && strings(value.warnings) && list(value.sessions, session) && decision(value.decision)
      && (value.status === "EMPTY" ? h === null : value.status === "READY" && record(h)
        && typeof value.selectedDate === "string" && record(value.selectedSnapshot) && session(value.selectedSnapshot)
        && record(h.session) && session(h.session) && h.session.tradingDate === value.selectedDate
        && h.session.snapshotMinuteEt === value.selectedSnapshot.snapshotMinuteEt
        && record(h.quote) && finite(h.quote.last) && strings(h.selectedExpiries)
        && Array.isArray(h.strikes) && h.strikes.every(finite)
        && list(h.cells, cell)
        && list(h.strikeProfiles, p => ["strike", "netGex", "netDex", "netVex", "netCex"].every(k => finite(p[k])) && list(p.tags, t => typeof t.label === "string" && typeof t.type === "string"))
        && record(h.zeroDte) && ["netGex", "netDex", "pinLevel", "gammaFlip", "topCallWallLevel", "topPutWallLevel"].every(k => h.zeroDte && ((h.zeroDte as Record<string, unknown>)[k] === null || finite((h.zeroDte as Record<string, unknown>)[k])))
        && record(h.source) && typeof h.source.note === "string" && record(h.premarketInterpretation));
  } else if (kind === "pressure") {
    const p = value.pressure;
    valid = strings(value.warnings) && (value.status === "EMPTY" ? p === null
      : ["READY", "DEGRADED"].includes(String(value.status)) && record(p)
        && p.tradingDate === value.selectedDate && record(p.baseline) && record(p.latest)
        && finite(p.baseline.snapshotMinuteEt) && typeof p.baseline.snapshotTimeEt === "string"
        && finite(p.latest.snapshotMinuteEt) && typeof p.latest.snapshotTimeEt === "string"
        && list(p.timeline, s => finite(s.snapshotMinuteEt) && typeof s.snapshotTimeEt === "string" && ["READY", "MISSING", "PENDING"].includes(String(s.status)))
        && list(p.rows, r => finite(r.strike) && nullableNumber(r.currentGex) && list(r.cells, c => finite(c.snapshotMinuteEt) && pressureStates.includes(String(c.state)) && finite(c.intensityPct) && ["currentGex", "baselineGex", "deltaGex", "strengthPct", "spot"].every(k => nullableNumber(c[k]))))
        && list(p.movers, m => finite(m.strike) && finite(m.deltaGex) && finite(m.currentGex) && finite(m.baselineGex) && pressureStates.includes(String(m.state)))
        && record(p.strikeRange) && ["lower", "upper", "step"].every(k => finite((p.strikeRange as Record<string, unknown>)[k])) && record(p.source) && strings(p.warnings));
  } else if (kind === "compass") {
    valid = value.ticker === "SPX" && typeof value.timeframe === "string" && strings(value.availableTimeframes)
      && list(value.candles, candle)
      && list(value.patterns, pattern) && list(value.zones, zone) && record(value.trend)
      && list(value.trend.labels, l => finite(l.index) && finite(l.price) && typeof l.label === "string")
      && record(value.summary) && priceSource(value.source) && strings(value.warnings);
  } else if (kind === "overlay") {
    valid = value.ticker === "SPX" && value.timeframe === "1m" && list(value.candles, c => finite(c.time) && finite(c.close))
      && priceSource(value.source) && strings(value.warnings);
  } else {
    valid = value.status === "EMPTY" ? value.detail === null : value.status === "READY" && record(value.detail) && cell(value.detail);
  }
  if (!valid) return invalid();
  return value as T;
}

export const spxFailureMessage = (status: number | null) => status === 429
  ? "Source is rate limited. Try again shortly."
  : status !== null && status >= 500 ? "Source is temporarily unavailable. Try again."
    : "The source could not be verified. Try again or open diagnostics.";
