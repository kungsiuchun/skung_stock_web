export interface SpxExecutionStop {
  price: number;
  trigger: "touch" | "bar_close";
  timeframe: "5m" | "15m" | null;
}

/** All execution prices are underlying SPX index points, never option premiums. */
export interface SpxExecutionPlan {
  schemaVersion: 1;
  underlying: "SPX";
  entryZone: { low: number; high: number };
  stop: SpxExecutionStop;
  targets: number[];
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const price = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);

export function readSpxExecutionFields(value: { buy_zone?: unknown; stop_loss?: unknown; targets?: unknown }): SpxExecutionPlan | null {
  const zone = value.buy_zone, stop = value.stop_loss, targets = value.targets;
  if (!record(zone) || !exactKeys(zone, ["low", "high"]) || !price(zone.low) || !price(zone.high) || zone.low >= zone.high
    || !record(stop) || !exactKeys(stop, ["price", "trigger", "timeframe"]) || !price(stop.price)
    || !(stop.trigger === "touch" && stop.timeframe === null || stop.trigger === "bar_close" && (stop.timeframe === "5m" || stop.timeframe === "15m"))
    || !Array.isArray(targets) || targets.length === 0 || !targets.every(price)) return null;
  return { schemaVersion: 1, underlying: "SPX", entryZone: { low: zone.low, high: zone.high }, stop: { price: stop.price, trigger: stop.trigger as SpxExecutionStop["trigger"], timeframe: stop.timeframe as SpxExecutionStop["timeframe"] }, targets: [...targets] };
}

export function readSpxExecutionPlan(value: unknown): SpxExecutionPlan | null {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "underlying", "entryZone", "stop", "targets"]) || value.schemaVersion !== 1 || value.underlying !== "SPX") return null;
  return readSpxExecutionFields({ buy_zone: value.entryZone, stop_loss: value.stop, targets: value.targets });
}

export function hasSpxExecutionGeometry(plan: SpxExecutionPlan, action: "OPEN_CALL" | "OPEN_PUT") {
  return action === "OPEN_CALL"
    ? plan.stop.price < plan.entryZone.low && plan.targets.every(target => target > plan.entryZone.high)
    : plan.stop.price > plan.entryZone.high && plan.targets.every(target => target < plan.entryZone.low);
}

export function spxExecutionDisplay(plan: SpxExecutionPlan | null) {
  return plan ? {
    entry: `${plan.entryZone.low} - ${plan.entryZone.high}`,
    invalidation: plan.stop.trigger === "touch" ? String(plan.stop.price) : `${plan.stop.timeframe} close ${plan.stop.price < plan.entryZone.low ? "below" : "above"} ${plan.stop.price}`,
    targets: plan.targets.map(String),
  } : { entry: null, invalidation: null, targets: [] as string[] };
}
