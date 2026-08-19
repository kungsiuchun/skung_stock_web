export type OptionsVisualFreshness = "fresh" | "stale" | "unknown";

export interface OptionsVisualCapabilities {
  chain: boolean;
  openInterest: boolean;
  volume: boolean;
  gex: boolean;
  dex: boolean;
  greeks: boolean;
  ivSmile: boolean;
}

export interface OptionsVisualModel {
  provider: string;
  expiry: string | null;
  spot: number | null;
  capturedAt: string | null;
  methodology: string | null;
  freshness: OptionsVisualFreshness;
  capabilities: OptionsVisualCapabilities;
  chain: Record<string, unknown> | null;
  strikeRows: Record<string, unknown>[];
  unavailableReasons: Partial<Record<keyof OptionsVisualCapabilities, string>>;
}

const DEFAULT_MAX_SOURCE_AGE_MS = 30 * 60 * 60 * 1000;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const rows = (value: unknown) => Array.isArray(value)
  ? value.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
  : [];

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const hasFinite = (items: Record<string, unknown>[], keys: string[], predicate: (value: number) => boolean = () => true) =>
  items.some((item) => keys.some((key) => finite(item[key]) && predicate(item[key] as number)));

const normalizeExpiry = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

export const optionsExpiryMatchesRequest = (chainRaw: unknown, requestedExpiry: unknown) => {
  const envelope = record(chainRaw);
  const chain = record(envelope?.chain) || envelope;
  const requested = normalizeExpiry(requestedExpiry);
  const returned = normalizeExpiry(chain?.selectedExpiry);
  return Boolean(requested && returned && requested === returned);
};

export const normalizeOptionsVisualModel = ({
  chainRaw,
  exposureRaw,
  now = Date.now(),
  maxSourceAgeMs = DEFAULT_MAX_SOURCE_AGE_MS,
}: {
  chainRaw: unknown;
  exposureRaw: unknown;
  now?: number;
  maxSourceAgeMs?: number;
}): OptionsVisualModel => {
  const chainEnvelope = record(chainRaw);
  const nestedChain = record(chainEnvelope?.chain);
  const chain = nestedChain || (chainEnvelope && (Array.isArray(chainEnvelope.calls) || Array.isArray(chainEnvelope.puts)) ? chainEnvelope : null);
  const exposureEnvelope = record(exposureRaw);
  const strikeRows = rows(exposureEnvelope?.exposures ?? exposureEnvelope?.rows);
  const calls = rows(chain?.calls);
  const puts = rows(chain?.puts);
  const legs = [...calls, ...puts];
  const provenance = record(chainEnvelope?.provenance) || record(exposureEnvelope?.provenance);
  const capturedAt = typeof provenance?.capturedAt === "string" ? provenance.capturedAt : null;
  const capturedAtMs = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  const freshness: OptionsVisualFreshness = Number.isFinite(capturedAtMs)
    ? now - capturedAtMs > maxSourceAgeMs ? "stale" : "fresh"
    : "unknown";

  const capabilities: OptionsVisualCapabilities = {
    chain: legs.length > 0,
    openInterest: hasFinite(legs, ["openInterest"], (value) => value > 0),
    volume: hasFinite(legs, ["volume"], (value) => value >= 0),
    gex: hasFinite(strikeRows, ["netGex", "callGex", "putGex"]),
    dex: hasFinite(strikeRows, ["netDex", "callDex", "putDex"]),
    greeks: hasFinite(legs, ["gamma", "delta", "impliedVolatility"]),
    ivSmile: hasFinite(legs, ["impliedVolatility"], (value) => value >= 0),
  };

  const unavailableReasons: OptionsVisualModel["unavailableReasons"] = {};
  if (!capabilities.chain) unavailableReasons.chain = "No structured option chain is available for this expiry.";
  if (!capabilities.openInterest) unavailableReasons.openInterest = "The active source did not provide positive open interest for this expiry.";
  if (!capabilities.volume) unavailableReasons.volume = "The active source did not provide option volume for this expiry.";
  if (!capabilities.gex) unavailableReasons.gex = "The active source did not provide auditable GEX inputs for this expiry.";
  if (!capabilities.dex) unavailableReasons.dex = "The active source did not provide auditable DEX inputs for this expiry.";
  if (!capabilities.greeks) unavailableReasons.greeks = "The active source did not provide option Greeks for this expiry.";
  if (!capabilities.ivSmile) unavailableReasons.ivSmile = "The active source did not provide implied volatility by strike.";

  return {
    provider: typeof provenance?.provider === "string"
      ? provenance.provider
      : typeof chainEnvelope?.source === "string"
        ? chainEnvelope.source
        : typeof exposureEnvelope?.source === "string"
          ? exposureEnvelope.source
          : "unavailable",
    expiry: typeof chain?.selectedExpiry === "string" ? chain.selectedExpiry : null,
    spot: finite(chain?.spot) ? chain.spot : null,
    capturedAt,
    methodology: typeof provenance?.methodology === "string" ? provenance.methodology : null,
    freshness,
    capabilities,
    chain,
    strikeRows,
    unavailableReasons,
  };
};
