import type { SpxDecisionCockpitProjection } from "./spx-decision-ledger";
import type { SpxGexCollectionAttempt, SpxGexCollectionRecord } from "./spx-gex-collection-lifecycle";
import type { SpxGexHeatmapModel, SpxGexSessionSummary } from "./spx-gex-heatmap";
import { parseJsonResponse, SafeJsonResponseError } from "./safe-json-response";

export interface SpxGexCollectionHealth {
  dueSlots: number;
  persistedSlots: number;
  missingSnapshotMinutesEt: number[];
  incompleteSlotIds: string[];
  failedSlotIds: string[];
  provider: string | null;
  fallbackFrom: string | null;
  stage: string | null;
  failure: string | null;
  updatedAt: string | null;
}

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
  collectionAttempts?: SpxGexCollectionAttempt[];
  collectionHealth?: SpxGexCollectionHealth | null;
  warnings: string[];
}

export const emptySpxBoard: SpxGexHeatmapResponse = {
  status: "EMPTY", errorCode: null, availableDates: [], selectedDate: null,
  sessions: [], selectedSnapshot: null, heatmap: null, decision: null, collection: null,
  collectionAttempts: [], collectionHealth: null, warnings: [],
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);
const nonNegativeInteger = (value: unknown) => integer(value) && value >= 0;
const nullableNumber = (value: unknown) => value === null || finite(value);
const nullableString = (value: unknown) => value === null || typeof value === "string";
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string");
const oneOf = (value: unknown, values: readonly unknown[]) => values.includes(value);
const list = (value: unknown, valid: (item: Record<string, unknown>) => boolean) => Array.isArray(value) && value.every(item => record(item) && valid(item));
const optional = (object: Record<string, unknown>, key: string, valid: (value: unknown) => boolean) => object[key] === undefined || valid(object[key]);

const isIsoDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

const dateTime = (value: unknown) => {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (Number.isFinite(Date.parse(value))) return true;
  const date = value.slice(0, 10);
  return isIsoDate(date) && /^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?: ?ET)?$/.test(value);
};

const etTime = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?: ET)?$/.test(value);
const minuteEt = (value: unknown) => integer(value) && value >= 0 && value <= 24 * 60;
const bounded = (value: unknown, lower: number, upper: number) => finite(value) && value >= lower && value <= upper;
const nullableDateTime = (value: unknown) => value === null || dateTime(value);
const nullableIsoDate = (value: unknown) => value === null || isIsoDate(value);

const pressureStates = ["POSITIVE_STRONGER", "POSITIVE_WEAKER", "NEGATIVE_DEEPER", "NEGATIVE_WEAKER", "FLIP_TO_POSITIVE", "FLIP_TO_NEGATIVE", "UNCHANGED", "NO_BASELINE", "NO_DATA", "OUTSIDE_COVERAGE"] as const;
const patternTypes = ["PIN_BAR_BULLISH", "PIN_BAR_BEARISH", "ENGULFING_BULLISH", "ENGULFING_BEARISH", "MORNING_STAR", "EVENING_STAR", "DOJI", "INSIDE_BAR", "DOUBLE_TOP", "DOUBLE_BOTTOM", "HEAD_AND_SHOULDERS", "INVERSE_HEAD_AND_SHOULDERS", "TRIANGLE_ASCENDING", "TRIANGLE_DESCENDING", "TRIANGLE_SYMMETRICAL"] as const;
const patternCategories = ["candle", "structure", "compression"] as const;
const patternDirections = ["bullish", "bearish", "neutral"] as const;
const timeframes = ["1m", "5m", "15m", "4h", "1d"] as const;
const pressureStatuses = ["READY", "DEGRADED", "EMPTY", "BINDING_MISSING", "STORAGE_UNAVAILABLE", "ERROR"] as const;
const heatmapStatuses = ["READY", "EMPTY", "BINDING_MISSING", "STORAGE_UNAVAILABLE", "ERROR"] as const;
const expectedMoveErrorCodes = [
  null,
  "ZERO_DTE_SPX_EXPECTED_MOVE_UNAVAILABLE",
  "ZERO_DTE_SPX_EXPECTED_MOVE_STALE",
  "ZERO_DTE_SPX_EXPECTED_MOVE_INVALID",
  "ZERO_DTE_SPX_EXPECTED_MOVE_FUTURE",
  "ZERO_DTE_SPX_EXPECTED_MOVE_LAGGED",
] as const;

const session = (value: Record<string, unknown>) => isIsoDate(value.tradingDate)
  && minuteEt(value.snapshotMinuteEt)
  && etTime(value.snapshotTimeEt)
  && minuteEt(value.collectedMinuteEt)
  && etTime(value.collectedTimeEt)
  && dateTime(value.generatedAt)
  && bounded(value.spot, 0, Number.POSITIVE_INFINITY);

const candle = (value: Record<string, unknown>) => finite(value.time)
  && isIsoDate(value.date_iso)
  && bounded(value.open, 0, Number.POSITIVE_INFINITY)
  && bounded(value.high, 0, Number.POSITIVE_INFINITY)
  && bounded(value.low, 0, Number.POSITIVE_INFINITY)
  && bounded(value.close, 0, Number.POSITIVE_INFINITY)
  && bounded(value.volume, 0, Number.POSITIVE_INFINITY)
  && (value.high as number) >= Math.max(value.open as number, value.close as number, value.low as number)
  && (value.low as number) <= Math.min(value.open as number, value.close as number, value.high as number);

const pattern = (value: Record<string, unknown>, candleCount: number) => {
  const fromIndex = value.fromIndex;
  const toIndex = value.toIndex;
  return typeof value.id === "string"
    && oneOf(value.type, patternTypes)
    && typeof value.name === "string"
    && typeof value.label === "string"
    && oneOf(value.category, patternCategories)
    && oneOf(value.direction, patternDirections)
    && typeof value.description === "string"
    && integer(fromIndex) && (fromIndex as number) >= 0 && (fromIndex as number) < candleCount
    && integer(toIndex) && (toIndex as number) >= (fromIndex as number) && (toIndex as number) < candleCount
    && finite(value.price)
    && bounded(value.confidence, 0, 1)
    && Array.isArray(value.candleIndices)
    && value.candleIndices.length > 0
    && value.candleIndices.every(index => integer(index) && (index as number) >= (fromIndex as number) && (index as number) <= (toIndex as number) && (index as number) < candleCount);
};

const zone = (value: Record<string, unknown>) => typeof value.id === "string"
  && oneOf(value.type, ["support", "resistance", "flip"])
  && finite(value.price)
  && finite(value.minPrice)
  && finite(value.maxPrice)
  && (value.minPrice as number) <= (value.price as number)
  && (value.price as number) <= (value.maxPrice as number)
  && nonNegativeInteger(value.strength)
  && finite(value.distanceToLastPercent)
  && list(value.touches, touch => integer(touch.index) && (touch.index as number) >= 0 && finite(touch.price) && oneOf(touch.type, ["high", "low"]));

const priceActionSource = (value: unknown) => {
  if (!record(value) || !oneOf(value.provider, ["0dtespx", "yahoo", "test"]) || typeof value.label !== "string"
    || typeof value.symbol !== "string" || typeof value.range !== "string" || typeof value.interval !== "string"
    || !dateTime(value.fetchedAt) || typeof value.note !== "string") return false;
  if (!optional(value, "latestSampleAt", nullableDateTime)
    || !optional(value, "priceAgeMs", item => item === null || finite(item))
    || !optional(value, "status", item => oneOf(item, ["READY", "STALE", "UNAVAILABLE"]))
    || !optional(value, "sessionState", item => oneOf(item, ["UPCOMING", "LIVE", "FINALIZING", "CLOSED", "UNAVAILABLE"]))
    || !optional(value, "sessionDate", nullableIsoDate)
    || !optional(value, "sessionStartAt", nullableDateTime)
    || !optional(value, "sessionEndAt", nullableDateTime)
    || !optional(value, "routingReason", item => typeof item === "string")) return false;
  if (value.expectedMove !== undefined) {
    if (!record(value.expectedMove)
      || !oneOf(value.expectedMove.status, ["READY", "STALE", "UNAVAILABLE"])
      || !nullableNumber(value.expectedMove.value)
      || !nullableDateTime(value.expectedMove.sampleAt)
      || !optional(value.expectedMove, "ageMs", item => item === null || finite(item))
      || !optional(value.expectedMove, "lagMs", item => item === null || finite(item))
      || !optional(value.expectedMove, "errorCode", item => oneOf(item, expectedMoveErrorCodes))) return false;
  }
  if (value.sharedCache !== undefined) {
    if (!record(value.sharedCache)
      || !oneOf(value.sharedCache.status, ["HIT", "REFRESHED", "STALE", "BYPASSED"])
      || !dateTime(value.sharedCache.cachedAt)
      || !bounded(value.sharedCache.ageMs, 0, Number.POSITIVE_INFINITY)
      || !bounded(value.sharedCache.refreshAfterMs, 0, Number.POSITIVE_INFINITY)
      || typeof value.sharedCache.refreshing !== "boolean"
      || !optional(value.sharedCache, "refreshError", item => typeof item === "string")) return false;
  }
  return true;
};

const priceActionSummary = (value: unknown, patterns: Record<string, unknown>[], candleCount: number) => {
  if (!record(value)
    || !nullableNumber(value.latestClose)
    || !nullableNumber(value.latestChange)
    || !nullableNumber(value.latestChangePercent)
    || !(value.nearestSupport === null || record(value.nearestSupport) && zone(value.nearestSupport))
    || !(value.nearestResistance === null || record(value.nearestResistance) && zone(value.nearestResistance))
    || !(value.latestPattern === null || record(value.latestPattern) && pattern(value.latestPattern, candleCount))
    || !record(value.patternCounts)) return false;
  if (!Object.entries(value.patternCounts).every(([key, count]) => oneOf(key, patternTypes) && nonNegativeInteger(count))) return false;
  const latestPattern = value.latestPattern;
  return latestPattern === null || record(latestPattern) && patterns.some(candidate => candidate.id === latestPattern.id);
};

const pressureTimeline = (value: Record<string, unknown>) => minuteEt(value.snapshotMinuteEt)
  && etTime(value.snapshotTimeEt)
  && (value.collectedMinuteEt === null || minuteEt(value.collectedMinuteEt))
  && (value.collectedTimeEt === null || etTime(value.collectedTimeEt))
  && oneOf(value.status, ["READY", "MISSING", "PENDING"])
  && nullableNumber(value.spot)
  && nullableDateTime(value.sourceTimestamp);

const pressureCell = (value: Record<string, unknown>) => minuteEt(value.snapshotMinuteEt)
  && oneOf(value.state, pressureStates)
  && nullableNumber(value.baselineGex)
  && nullableNumber(value.currentGex)
  && nullableNumber(value.deltaGex)
  && nullableNumber(value.strengthPct)
  && bounded(value.intensityPct, 0, 100)
  && nullableNumber(value.spot);

const pressureMover = (value: Record<string, unknown>) => finite(value.strike)
  && oneOf(value.state, pressureStates)
  && finite(value.baselineGex)
  && finite(value.currentGex)
  && finite(value.deltaGex)
  && nullableNumber(value.strengthPct)
  && bounded(value.intensityPct, 0, 100);

const pressureMovers = (value: unknown) => Array.isArray(value)
  && value.length <= 10
  && value.every((item, index) => record(item) && item.rank === index + 1 && pressureMover(item));

const pressure = (value: unknown) => {
  if (!record(value)
    || !isIsoDate(value.tradingDate)
    || value.mode !== "0DTE"
    || !isIsoDate(value.expiry)
    || !nonNegativeInteger(value.delayMinutes)
    || !record(value.baseline)
    || !minuteEt(value.baseline.snapshotMinuteEt)
    || !etTime(value.baseline.snapshotTimeEt)
    || !minuteEt(value.baseline.collectedMinuteEt)
    || !etTime(value.baseline.collectedTimeEt)
    || typeof value.baseline.isOfficialOpen !== "boolean"
    || !record(value.latest)
    || !minuteEt(value.latest.snapshotMinuteEt)
    || !etTime(value.latest.snapshotTimeEt)
    || !etTime(value.latest.collectedTimeEt)
    || !bounded(value.latest.spot, 0, Number.POSITIVE_INFINITY)
    || !list(value.timeline, pressureTimeline)
    || !record(value.strikeRange)
    || !bounded(value.strikeRange.lower, 0, Number.POSITIVE_INFINITY)
    || !bounded(value.strikeRange.upper, 0, Number.POSITIVE_INFINITY)
    || !((value.strikeRange.lower as number) <= (value.strikeRange.upper as number))
    || !bounded(value.strikeRange.step, 0, Number.POSITIVE_INFINITY)
    || (value.strikeRange.step as number) <= 0
    || !list(value.rows, row => finite(row.strike) && nullableNumber(row.currentGex) && list(row.cells, pressureCell))
    || !pressureMovers(value.movers)
    || !record(value.source)
    || typeof value.source.provider !== "string"
    || !nullableString(value.source.fallbackFrom)
    || !nullableDateTime(value.source.sourceTimestamp)
    || !nullableString(value.source.snapshotId)
    || !strings(value.warnings)) return false;
  return true;
};

const heatmapCell = (value: Record<string, unknown>) => {
  if (!finite(value.strike) || !isIsoDate(value.expdate) || !nullableNumber(value.netGex)) return false;
  const numericFields = [
    "callGex", "putGex", "netDex", "netVex", "netCex", "callOpenInterest", "putOpenInterest", "totalOpenInterest", "totalVolume",
    "avgIv", "callIv", "putIv", "callRawIv", "putRawIv", "callIvPercent", "putIvPercent", "callBid", "callAsk", "callMid",
    "callLastPrice", "putBid", "putAsk", "putMid", "putLastPrice", "gammaIv", "gammaIvPercent", "callEffectiveOpenInterest",
    "putEffectiveOpenInterest", "callVolume", "putVolume", "yearsToExpiry", "dteHours", "contractMultiplier", "riskFreeRate",
  ];
  if (!numericFields.every(field => optional(value, field, nullableNumber))
    || !optional(value, "approximate", item => typeof item === "boolean")
    || !optional(value, "callIvSource", item => oneOf(item, ["reported", "repaired_from_mid", "excluded_low_time_value", "unpriced", "missing", "absent"]))
    || !optional(value, "putIvSource", item => oneOf(item, ["reported", "repaired_from_mid", "excluded_low_time_value", "unpriced", "missing", "absent"]))
    || !optional(value, "pricingQuality", item => oneOf(item, ["priced", "repaired", "partial", "unpriced"]))
    || !optional(value, "repairNotes", strings)
    || !optional(value, "missingReasons", strings)
    || !optional(value, "callOpenInterestStatus", item => oneOf(item, ["reported", "missing", "absent"]))
    || !optional(value, "putOpenInterestStatus", item => oneOf(item, ["reported", "missing", "absent"]))
    || !optional(value, "callIvStatus", item => oneOf(item, ["reported", "missing", "absent"]))
    || !optional(value, "putIvStatus", item => oneOf(item, ["reported", "missing", "absent"]))
    || !optional(value, "calculationTimestamp", dateTime)
    || !optional(value, "model", item => oneOf(item, ["black_scholes_gamma_exposure", "black_scholes_gamma_exposure_blended_iv"]))
    || !optional(value, "activeSeries", strings)
    || !optional(value, "inactiveSeries", strings)
    || !optional(value, "activeContractCount", nonNegativeInteger)
    || !optional(value, "pricedContractCount", nonNegativeInteger)) return false;
  return true;
};

const dataQualitySummary = (value: unknown): value is Record<string, unknown> => record(value)
  && nonNegativeInteger(value.total)
  && nonNegativeInteger(value.priced)
  && nonNegativeInteger(value.repaired)
  && nonNegativeInteger(value.partial)
  && nonNegativeInteger(value.unpriced)
  && nonNegativeInteger(value.excluded)
  && (value.priced as number) + (value.repaired as number) + (value.partial as number) + (value.unpriced as number) === (value.total as number);

const dataQualityMatchesCells = (value: unknown, cells: Record<string, unknown>[]) => {
  if (!dataQualitySummary(value)) return false;
  return value.total === cells.length
    && value.priced === cells.filter(cell => cell.pricingQuality === "priced").length
    && value.repaired === cells.filter(cell => cell.pricingQuality === "repaired").length
    && value.partial === cells.filter(cell => cell.pricingQuality === "partial").length
    && value.unpriced === cells.filter(cell => cell.pricingQuality === "unpriced" || cell.pricingQuality === undefined).length
    && value.excluded === cells.filter(cell => cell.callIvSource === "excluded_low_time_value" || cell.putIvSource === "excluded_low_time_value").length;
};

const heatmap = (value: unknown) => {
  if (!record(value)
    || !dateTime(value.generatedAt)
    || value.ticker !== "SPX"
    || !record(value.quote)
    || value.quote.ticker !== "SPX"
    || !bounded(value.quote.last, 0, Number.POSITIVE_INFINITY)
    || typeof value.quote.change !== "string"
    || typeof value.quote.changePercent !== "string"
    || !nullableString(value.snapshot)
    || !(value.session === null || record(value.session) && session(value.session))
    || !Array.isArray(value.selectedExpiries)
    || !value.selectedExpiries.every(isIsoDate)
    || !record(value.strikeRange)
    || !finite(value.strikeRange.lower)
    || !finite(value.strikeRange.upper)
    || (value.strikeRange.lower as number) > (value.strikeRange.upper as number)
    || !Array.isArray(value.strikes)
    || !value.strikes.every(item => finite(item))
    || !list(value.cells, heatmapCell)
    || !Array.isArray(value.totals)
    || !value.totals.every(item => record(item)
      && isIsoDate(item.expdate)
      && finite(item.netGex)
      && optional(item, "netDex", finite)
      && optional(item, "netVex", finite)
      && optional(item, "netCex", finite))
    || !list(value.strikeProfiles, profile => finite(profile.strike)
      && finite(profile.netGex) && finite(profile.callGex) && finite(profile.putGex)
      && finite(profile.netDex) && finite(profile.netVex) && finite(profile.netCex)
      && nonNegativeInteger(profile.totalOpenInterest) && nonNegativeInteger(profile.totalVolume)
      && nullableIsoDate(profile.dominantExpiry)
      && list(profile.tags, tag => oneOf(tag.type, ["now", "pin", "gamma_flip", "upper_shelf", "near_resistance", "minor_resistance", "big_call_wall", "resistance_zone", "lower_shelf", "air_gap", "oi_spike", "key_support", "structural_support"])
       && typeof tag.label === "string" && oneOf(tag.severity, ["info", "watch", "major"]) && typeof tag.source === "string"))) return false;
  if (!record(value.zeroDte)
    || !isIsoDate(value.zeroDte.expiry)
    || !nullableString(value.zeroDte.sessionPhase)
    || !nullableString(value.zeroDte.nowEt)
    || !nullableNumber(value.zeroDte.pinLevel)
    || !nullableNumber(value.zeroDte.gammaFlip)
    || !nullableNumber(value.zeroDte.netGex)
    || !nullableNumber(value.zeroDte.netDex)
    || !optional(value.zeroDte, "netVex", nullableNumber)
    || !optional(value.zeroDte, "netCex", nullableNumber)
    || !nullableString(value.zeroDte.topCallWall)
    || !nullableNumber(value.zeroDte.topCallWallLevel)
    || !nullableString(value.zeroDte.topPutWall)
    || !nullableNumber(value.zeroDte.topPutWallLevel)
    || !nullableString(value.zeroDte.charmRegime)) return false;
  if (!record(value.premarketInterpretation)
    || typeof value.premarketInterpretation.paragraph !== "string"
    || !record(value.premarketInterpretation.levels)
    || !strings([value.premarketInterpretation.levels.dividingLine, value.premarketInterpretation.levels.upside, value.premarketInterpretation.levels.downside])
    || !oneOf(value.premarketInterpretation.regime, ["bullish_above_flip", "bearish_below_flip", "pinning_range", "mixed"])
    || !nullableString(value.premarketInterpretation.context)
    || !strings(value.premarketInterpretation.warnings)) return false;
  if (!record(value.source)
    || typeof value.source.quoteTool !== "string"
    || typeof value.source.optionExpiryTool !== "string"
    || typeof value.source.gexTool !== "string"
    || typeof value.source.zeroDteTool !== "string"
    || !nonNegativeInteger(value.source.gexTopRows)
    || typeof value.source.note !== "string"
    || !optional(value.source, "provider", item => typeof item === "string")
    || !optional(value.source, "fallbackFrom", nullableString)
    || !optional(value.source, "sourceTimestamp", nullableDateTime)
    || !optional(value.source, "calculationEngineVersion", nonNegativeInteger)) return false;
  if (value.dataQuality !== undefined && !dataQualityMatchesCells(value.dataQuality, value.cells as Record<string, unknown>[])) return false;
  if (value.canonical !== undefined && value.canonical !== null && (!record(value.canonical)
    || typeof value.canonical.snapshotId !== "string"
    || value.canonical.schemaVersion !== 1
    || value.canonical.replayGrade !== "NORMALIZED_CANONICAL"
    || !dateTime(value.canonical.generatedAt)
    || !isIsoDate(value.canonical.tradingDate)
    || !minuteEt(value.canonical.snapshotMinuteEt)
    || !etTime(value.canonical.snapshotTimeEt)
    || !minuteEt(value.canonical.collectedMinuteEt)
    || !etTime(value.canonical.collectedTimeEt)
    || typeof value.canonical.provider !== "string"
    || !nullableString(value.canonical.fallbackFrom)
    || !nullableDateTime(value.canonical.sourceTimestamp)
    || typeof value.canonical.payloadHash !== "string"
    || !(value.canonical.dataQuality === null || dataQualityMatchesCells(value.canonical.dataQuality, value.cells as Record<string, unknown>[]))
    || !optional(value.canonical, "calculationEngineVersion", nonNegativeInteger))) return false;
  return true;
};

const collectionQuality = (value: unknown) => record(value)
  && nonNegativeInteger(value.rawLegCount)
  && nonNegativeInteger(value.parsedLegCount)
  && nonNegativeInteger(value.zeroIvCount)
  && nonNegativeInteger(value.missingIvCount)
  && nonNegativeInteger(value.invalidBidAskCount)
  && nonNegativeInteger(value.missingOpenInterestCount)
  && (value.pricedCellCount === null || nonNegativeInteger(value.pricedCellCount))
  && (value.repairedCellCount === null || nonNegativeInteger(value.repairedCellCount))
  && (value.partialCellCount === null || nonNegativeInteger(value.partialCellCount))
  && (value.unpricedCellCount === null || nonNegativeInteger(value.unpricedCellCount))
  && nullableDateTime(value.sourceTimestamp)
  && oneOf(value.cacheStatus, ["miss", "fresh", "stale", "force_refreshed"]);

const collectionAttempt = (value: Record<string, unknown>) => typeof value.slotId === "string"
  && minuteEt(value.snapshotMinuteEt)
  && nonNegativeInteger(value.attempt) && (value.attempt as number) > 0
  && oneOf(value.status, ["PENDING", "FAILED", "ACCEPTED"])
  && dateTime(value.occurredAt)
  && nullableDateTime(value.acceptedAt)
  && nullableString(value.failureReason)
  && (value.quality === null || collectionQuality(value.quality));

const collectionRecord = (value: unknown) => record(value)
  && typeof value.slotId === "string"
  && isIsoDate(value.tradingDate)
  && minuteEt(value.snapshotMinuteEt)
  && minuteEt(value.collectedMinuteEt)
  && oneOf(value.currentStage, ["SCHEDULED", "FETCHED", "NORMALIZED", "PERSISTED", "FAILED"])
  && nullableString(value.snapshotId)
  && nullableString(value.payloadHash)
  && nullableString(value.provider)
  && nullableString(value.fallbackFrom)
  && nullableString(value.error)
  && dateTime(value.updatedAt);

const collectionHealth = (value: unknown) => value === null || record(value)
  && nonNegativeInteger(value.dueSlots)
  && nonNegativeInteger(value.persistedSlots)
  && (value.persistedSlots as number) <= (value.dueSlots as number)
  && Array.isArray(value.missingSnapshotMinutesEt) && value.missingSnapshotMinutesEt.every(minuteEt)
  && (value.missingSnapshotMinutesEt as unknown[]).length <= (value.dueSlots as number)
  && strings(value.incompleteSlotIds)
  && (value.incompleteSlotIds as string[]).length <= (value.dueSlots as number)
  && strings(value.failedSlotIds)
  && value.failedSlotIds.length <= (value.incompleteSlotIds as string[]).length
  && value.failedSlotIds.every(slotId => (value.incompleteSlotIds as string[]).includes(slotId))
  && nullableString(value.provider)
  && nullableString(value.fallbackFrom)
  && nullableString(value.stage)
  && nullableString(value.failure)
  && nullableDateTime(value.updatedAt);

const modelAttempt = (value: Record<string, unknown>) => nonNegativeInteger(value.attempt)
  && (value.attempt as number) > 0
  && typeof value.model === "string"
  && optional(value, "requestedModel", item => typeof item === "string")
  && optional(value, "resolvedModel", nullableString)
  && optional(value, "provider", nullableString)
  && optional(value, "responseId", nullableString)
  && oneOf(value.status, ["SUCCESS", "TIMEOUT", "HTTP_ERROR", "UPSTREAM_ERROR", "UNAPPROVED_PROVIDER", "MISSING_CHOICE", "EMPTY_CONTENT", "OUTPUT_NOT_JSON", "SCHEMA_INVALID", "OUTPUT_TRUNCATED", "DEADLINE_EXCEEDED", "INPUT_BUDGET_EXCEEDED", "REQUEST_FAILED"])
  && bounded(value.latencyMs, 0, Number.POSITIVE_INFINITY)
  && (value.httpStatus === null || integer(value.httpStatus) && (value.httpStatus as number) >= 100 && (value.httpStatus as number) <= 599)
  && nullableString(value.errorCategory)
  && nullableString(value.finishReason)
  && nonNegativeInteger(value.contentLength)
  && nullableString(value.responseHash)
  && optional(value, "promptTokens", item => item === null || nonNegativeInteger(item))
  && optional(value, "completionTokens", item => item === null || nonNegativeInteger(item))
  && optional(value, "reasoningTokens", item => item === null || nonNegativeInteger(item))
  && optional(value, "totalTokens", item => item === null || nonNegativeInteger(item))
  && optional(value, "cost", item => item === null || bounded(item, 0, Number.POSITIVE_INFINITY));

const decision = (value: unknown) => {
  if (value === null) return true;
  if (!record(value) || typeof value.runId !== "string" || !dateTime(value.scheduledAt)
    || !oneOf(value.currentStage, ["SCHEDULED", "LOCK_ACQUIRED", "SNAPSHOT_READY", "COUNCIL_COMPLETED", "CIO_DECIDED", "RISK_GATED", "PERSISTED", "DELIVERY_ATTEMPTED", "DELIVERED", "DELIVERY_FAILED"])) return false;
  const councilTally = value.councilTally;
  const councilAgents = value.councilAgents;
  if (!record(councilTally)
    || !["CALL", "PUT", "HOLD", "INVALID"].every(key => nonNegativeInteger(councilTally[key]))
    || !Array.isArray(councilAgents)
    || !councilAgents.every(agent => record(agent)
      && oneOf(agent.agent, ["QM", "CM", "NT", "PA"])
      && oneOf(agent.decision, ["CALL", "PUT", "HOLD"])
      && bounded(agent.confidence, 0, 100)
      && typeof agent.reasoning === "string"
      && typeof agent.valid === "boolean"
      && typeof agent.modelStatus === "string"
      && Array.isArray(agent.attempts)
     && agent.attempts.every(item => record(item) && modelAttempt(item)))) return false;
  const action = (item: unknown) => item === null || oneOf(item, ["OPEN_CALL", "OPEN_PUT", "HOLD", "CLOSE"]);
  const cio = value.cio;
  const riskGate = value.riskGate;
  const delivery = value.delivery;
  const lifecycle = value.lifecycle;
  if (!record(cio)
    || !action(cio.action)
    || !bounded(cio.confidence, 0, 100)
    || typeof cio.modelStatus !== "string"
    || !oneOf(cio.decisionStatus, ["EXECUTED", "CIO_UNAVAILABLE", "COUNCIL_UNAVAILABLE", "MARKET_DATA_BLOCKED", "INVALID_OUTPUT", "PIPELINE_FAILED"])
    || !record(riskGate)
    || !oneOf(riskGate.disposition, ["PASS", "VETO_TO_HOLD", "REQUIRE_CLOSE", "NOT_RUN"])
    || typeof riskGate.reason !== "string"
    || !action(riskGate.action)
    || !action(value.finalAction)
    || typeof value.degraded !== "boolean"
    || !nullableString(value.degradedReason)
    || !oneOf(value.replayGrade, ["NORMALIZED_CANONICAL", "PARTIAL_NORMALIZED", "UNAVAILABLE"])
    || !record(delivery)
    || !oneOf(delivery.status, ["PENDING", "SENDING", "FAILED", "DELIVERED", "NOT_QUEUED"])
    || !nonNegativeInteger(delivery.attemptCount)
    || !nullableString(delivery.telegramMessageId)
    || !nullableString(delivery.error)
    || !Array.isArray(lifecycle)
    || !lifecycle.every(event => record(event)
      && oneOf(event.stage, ["SCHEDULED", "LOCK_ACQUIRED", "SNAPSHOT_READY", "COUNCIL_COMPLETED", "CIO_DECIDED", "RISK_GATED", "PERSISTED", "DELIVERY_ATTEMPTED", "DELIVERED", "DELIVERY_FAILED"])
      && dateTime(event.occurredAt)
      && (event.latencyMs === null || bounded(event.latencyMs, 0, Number.POSITIVE_INFINITY))
      && nonNegativeInteger(event.attempt))) return false;
  return true;
};

const invalidResponse = (kind: string, response: Response, url: string): never => {
  throw new SafeJsonResponseError(`Invalid ${kind} response contract: ${url}`, response.status, response.headers.get("content-type") || "", response.headers.get("cf-ray"), "SCHEMA_INVALID");
};

const validErrorEnvelope = (value: Record<string, unknown>) => {
  const hasError = typeof value.error === "string" && value.error.trim() !== "";
  const hasErrorCode = typeof value.errorCode === "string" && value.errorCode.trim() !== "";
  return (value.error === undefined || typeof value.error === "string")
    && (value.errorCode === undefined || value.errorCode === null || typeof value.errorCode === "string")
    && (value.status === undefined || typeof value.status === "string")
    && (value.warnings === undefined || strings(value.warnings))
    && (hasError || hasErrorCode);
};

export interface SpxFailureDetails {
  httpStatus: number | null;
  code: string;
  requestUrl: string;
  rayId: string | null;
}

export const buildSpxFailureDetails = (input: {
  response?: Response;
  error?: unknown;
  requestUrl: string;
  fallbackCode: string;
  responseCode?: unknown;
}): SpxFailureDetails => {
  const safeError = input.error instanceof SafeJsonResponseError ? input.error : null;
  return {
    httpStatus: safeError?.httpStatus ?? input.response?.status ?? null,
    code: safeError?.code ?? (typeof input.responseCode === "string" && input.responseCode ? input.responseCode : input.fallbackCode),
    requestUrl: input.requestUrl,
    rayId: safeError?.rayId ?? input.response?.headers.get("cf-ray") ?? null,
  };
};

export const formatSpxFailureDetails = (details: SpxFailureDetails | null) => details
  ? [`HTTP ${details.httpStatus ?? "UNKNOWN"}`, `CODE ${details.code}`, `REQUEST ${details.requestUrl}`, details.rayId ? `RAY ${details.rayId}` : null].filter(Boolean).join(" · ")
  : "No diagnostic identity available.";

export async function parseSpxBoardResponse<T>(response: Response, url: string, kind: "heatmap" | "pressure" | "compass" | "overlay" | "detail"): Promise<T> {
  const value = await parseJsonResponse<unknown>(response, url, { allowHttpError: true });
  if (!record(value)) return invalidResponse(kind, response, url);
  if (oneOf(value.status, ["ERROR", "BINDING_MISSING", "STORAGE_UNAVAILABLE"]) && !validErrorEnvelope(value)) {
    return invalidResponse(kind, response, url);
  }
  if (!response.ok) {
    if (!validErrorEnvelope(value)) return invalidResponse(kind, response, url);
    return value as T;
  }
  let valid = false;
  if (kind === "heatmap") {
    valid = oneOf(value.status, heatmapStatuses)
      && (value.errorCode === null || typeof value.errorCode === "string")
      && Array.isArray(value.availableDates) && value.availableDates.every(isIsoDate)
      && nullableIsoDate(value.selectedDate)
      && list(value.sessions, session)
      && (value.selectedSnapshot === null || record(value.selectedSnapshot) && session(value.selectedSnapshot))
      && decision(value.decision)
      && (value.collection === null || collectionRecord(value.collection))
      && (value.collectionAttempts === undefined || list(value.collectionAttempts, collectionAttempt))
      && (value.collectionHealth === undefined || collectionHealth(value.collectionHealth))
      && strings(value.warnings)
      && (value.status === "READY"
        ? record(value.heatmap)
          && heatmap(value.heatmap)
          && typeof value.selectedDate === "string"
          && record(value.selectedSnapshot)
          && session(value.selectedSnapshot)
          && record(value.heatmap.session)
          && session(value.heatmap.session)
          && value.heatmap.session.tradingDate === value.selectedDate
          && value.heatmap.session.snapshotMinuteEt === value.selectedSnapshot.snapshotMinuteEt
        : value.heatmap === null && value.selectedSnapshot === null);
  } else if (kind === "pressure") {
    valid = oneOf(value.status, pressureStatuses)
      && (value.errorCode === null || typeof value.errorCode === "string")
      && nullableIsoDate(value.selectedDate)
      && list(value.invalidSnapshots, snapshot => minuteEt(snapshot.snapshotMinuteEt) && etTime(snapshot.snapshotTimeEt)
        && oneOf(snapshot.reasonCode, ["SNAPSHOT_JSON_MALFORMED", "SESSION_CONTRACT_INCOMPLETE", "NO_AUDITED_BLENDED_IV_CELLS"]))
      && list(value.collectionAttempts, collectionAttempt)
      && strings(value.warnings)
      && (value.status === "READY" || value.status === "DEGRADED"
        ? record(value.pressure) && pressure(value.pressure) && value.pressure.tradingDate === value.selectedDate
        : value.pressure === null);
  } else if (kind === "compass") {
    const candleCount = Array.isArray(value.candles) ? value.candles.length : -1;
    valid = value.ticker === "SPX"
      && oneOf(value.timeframe, timeframes)
      && Array.isArray(value.availableTimeframes) && value.availableTimeframes.every(item => oneOf(item, timeframes))
      && Array.isArray(value.candles) && value.candles.every(item => record(item) && candle(item))
      && Array.isArray(value.patterns) && value.patterns.every(item => record(item) && pattern(item, candleCount))
      && Array.isArray(value.zones) && value.zones.every(item => record(item) && zone(item))
      && record(value.trend)
      && oneOf(value.trend.direction, ["UP", "DOWN", "SIDEWAYS"])
      && bounded(value.trend.strength, 0, 100)
      && Array.isArray(value.trend.labels)
      && value.trend.labels.every(label => record(label) && integer(label.index) && (label.index as number) >= 0 && (label.index as number) < candleCount && oneOf(label.label, ["HH", "HL", "LH", "LL"]) && finite(label.price))
      && priceActionSummary(value.summary, value.patterns as Record<string, unknown>[], candleCount)
      && priceActionSource(value.source)
      && strings(value.warnings);
  } else if (kind === "overlay") {
    valid = value.ticker === "SPX"
      && value.timeframe === "1m"
      && Array.isArray(value.candles)
      && value.candles.every(item => record(item) && finite(item.time) && finite(item.close))
      && priceActionSource(value.source)
      && strings(value.warnings);
  } else {
    valid = oneOf(value.status, ["EMPTY", "READY"])
      && (value.status === "EMPTY" ? value.detail === null : record(value.detail) && heatmapCell(value.detail));
  }
  if (!valid) return invalidResponse(kind, response, url);
  return value as T;
}

export const spxFailureMessage = (status: number | null) => status === 429
  ? "Source is rate limited. Try again shortly."
  : status !== null && status >= 500 ? "Source is temporarily unavailable. Try again."
    : "The source could not be verified. Try again or open diagnostics.";
