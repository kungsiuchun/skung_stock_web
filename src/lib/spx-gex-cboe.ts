import type {
  SpxGexCollectionCacheStatus,
  SpxGexCollectionQualitySummary,
  SpxGexDataClient,
  SpxGexMarketContext,
  SpxGexOptionChain,
  SpxGexOptionLeg,
} from "./spx-gex-heatmap";
import type { D1DatabaseLike } from "./spx-recap-d1";
import { NativeSpxGexYahooClient } from "./stocks-native-yahoo";

const CBOE_SPX_OPTIONS_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";
const CBOE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MARKET_TIME_ZONE = "America/New_York";

type OptionSide = "C" | "P";
type FetchJson = () => Promise<unknown>;
export type SpxGexCboeCachePolicy = "default" | "force_refresh";

const CBOE_FETCH_TIMEOUT_MS = 12_000;
const CBOE_FETCH_ATTEMPTS = 2;
const CBOE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CBOE_CACHE_EXPIRY_COUNT = 5;
const CBOE_CACHE_ROW_GUARD_BYTES = 1_800_000;
const CBOE_CACHE_PROVIDER = "cboe";
const CBOE_CACHE_KEY_PREFIX = "SPX:CBOE_DELAYED";

interface CboeFetchResult {
  payload: unknown;
  rawBytes?: number | null;
  fetchMs?: number | null;
}

interface CboeCacheRow {
  cache_key: string;
  trading_date: string;
  collected_minute_et: number;
  source_timestamp: string | null;
  spot: number;
  chains_json: string;
  pcr_value: number | null;
  raw_bytes: number | null;
  normalized_bytes: number | null;
  fetch_ms: number | null;
  created_at: string;
  expires_at: string;
}

interface CboeCacheWriteInput {
  cacheKey: string;
  tradingDate: string;
  collectedMinuteEt: number;
  sourceTimestamp?: string | null;
  spot: number;
  chains: SpxGexOptionChain[];
  pcrValue?: number | null;
  rawBytes?: number | null;
  fetchMs?: number | null;
  createdAt?: string;
  expiresAt?: string;
}

export interface ParsedCboeOptionSymbol {
  root: string;
  expiry: string;
  side: OptionSide;
  strike: number;
}

interface CboeNormalizedLeg extends SpxGexOptionLeg {
  expiry: string;
  side: OptionSide;
}

export const parseCboeOptionSymbol = (symbol: string): ParsedCboeOptionSymbol | null => {
  const match = symbol.match(/^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;
  const [, root, yy, mm, dd, side, strikeRaw] = match;
  const strike = Number(strikeRaw) / 1000;
  if (!Number.isFinite(strike)) return null;
  return {
    root,
    expiry: `${2000 + Number(yy)}-${mm}-${dd}`,
    side: side as OptionSide,
    strike,
  };
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? value as Record<string, any> : {};

const toOptionalNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const roundTo = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + 1e-9) * factor) / factor;
};

const roundOptional = (value: unknown, digits = 2) => {
  const number = toOptionalNumber(value);
  return number === null ? null : roundTo(number, digits);
};

const roundOptionalInteger = (value: unknown) => {
  const number = toOptionalNumber(value);
  return number === null ? null : Math.round(number);
};

const normalizeCboeIv = (value: unknown) => {
  const number = toOptionalNumber(value);
  if (number === null) return null;
  return number <= 3 ? roundTo(number * 100, 2) : roundTo(number, 2);
};

const todayEt = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const minuteEt = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
};

const cboeCacheBucketMinuteEt = (now: Date) => Math.floor(minuteEt(now) / 15) * 15;

export const buildCboeCacheKey = (tradingDate: string, collectedMinuteEt: number) =>
  `${CBOE_CACHE_KEY_PREFIX}:${tradingDate}:${collectedMinuteEt}`;

const normalizeCboeLeg = (row: Record<string, any>): CboeNormalizedLeg | null => {
  const option = String(row.option || "");
  const parsed = parseCboeOptionSymbol(option);
  if (!parsed || !["SPX", "SPXW"].includes(parsed.root)) return null;
  return {
    contractSymbol: option,
    contractRoot: parsed.root,
    settlement: parsed.root === "SPX" ? "AM" : "PM",
    lastTradeTime: typeof row.last_trade_time === "string" ? row.last_trade_time : null,
    expiry: parsed.expiry,
    side: parsed.side,
    strike: parsed.strike,
    lastPrice: roundOptional(row.last_trade_price),
    bid: roundOptional(row.bid),
    ask: roundOptional(row.ask),
    volume: roundOptionalInteger(row.volume),
    openInterest: roundOptionalInteger(row.open_interest),
    impliedVolatility: normalizeCboeIv(row.iv),
  };
};

export const parseCboeSpxOptionsPayload = (
  payload: unknown,
  options: { todayEt?: string } = {},
): SpxGexOptionChain[] => {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const rawOptions = Array.isArray(data.options) ? data.options.map(asRecord) : [];
  const legs = rawOptions.map(normalizeCboeLeg).filter((leg): leg is CboeNormalizedLeg => Boolean(leg));
  const allExpiries = Array.from(new Set(legs.map((leg) => leg.expiry))).sort();
  const today = options.todayEt;
  const firstEligibleExpiry = today
    ? allExpiries.find((expiry) => expiry >= today)
    : allExpiries[0];
  const expiries = firstEligibleExpiry
    ? allExpiries.filter((expiry) => expiry >= firstEligibleExpiry)
    : allExpiries;
  const spot = roundOptional(data.current_price) ?? roundOptional(data.price) ?? 0;
  const source = {
    provider: "cboe",
    label: "Cboe delayed",
    timestamp: typeof root.timestamp === "string" ? root.timestamp : null,
    url: CBOE_SPX_OPTIONS_URL,
  };

  return expiries.map((expiry) => {
    const expiryLegs = legs.filter((leg) => leg.expiry === expiry);
    return {
      symbol: "SPX",
      spot,
      expiries,
      selectedExpiry: expiry,
      calls: expiryLegs.filter((leg) => leg.side === "C"),
      puts: expiryLegs.filter((leg) => leg.side === "P"),
      source,
    };
  });
};

const isCboeFetchResult = (value: unknown): value is CboeFetchResult =>
  Boolean(value && typeof value === "object" && "payload" in (value as Record<string, unknown>));

const normalizeFetchResult = (value: unknown): CboeFetchResult => {
  if (isCboeFetchResult(value)) return value;
  return {
    payload: value,
    rawBytes: JSON.stringify(value).length,
    fetchMs: null,
  };
};

const withCacheSource = (chains: SpxGexOptionChain[], label: string, timestamp?: string | null) =>
  chains.map((chain) => ({
    ...chain,
    source: {
      ...(chain.source || { provider: CBOE_CACHE_PROVIDER }),
      provider: CBOE_CACHE_PROVIDER,
      label,
      timestamp: timestamp ?? chain.source?.timestamp ?? null,
      url: chain.source?.url || CBOE_SPX_OPTIONS_URL,
    },
  }));

const normalizeChainsForCache = (chains: SpxGexOptionChain[]) =>
  chains.slice(0, CBOE_CACHE_EXPIRY_COUNT).map((chain) => {
    const minStrike = chain.spot * 0.8;
    const maxStrike = chain.spot * 1.2;
    return {
      ...chain,
      calls: chain.calls.filter((leg) => leg.strike >= minStrike && leg.strike <= maxStrike),
      puts: chain.puts.filter((leg) => leg.strike >= minStrike && leg.strike <= maxStrike),
    };
  });

const summarizeParsedChains = (
  chains: SpxGexOptionChain[],
  rawLegCount: number,
  cacheStatus: SpxGexCollectionCacheStatus,
): SpxGexCollectionQualitySummary => {
  const legs = chains.flatMap((chain) => [...chain.calls, ...chain.puts]);
  return {
    rawLegCount,
    parsedLegCount: legs.length,
    zeroIvCount: legs.filter((leg) => leg.impliedVolatility === 0).length,
    missingIvCount: legs.filter((leg) => leg.impliedVolatility === null || leg.impliedVolatility === undefined).length,
    invalidBidAskCount: legs.filter((leg) => {
      const bid = leg.bid;
      const ask = leg.ask;
      return bid === null || bid === undefined || ask === null || ask === undefined
        || !Number.isFinite(bid) || !Number.isFinite(ask) || bid < 0 || ask <= 0 || ask < bid;
    }).length,
    missingOpenInterestCount: legs.filter((leg) => leg.openInterest === null || leg.openInterest === undefined).length,
    pricedCellCount: null,
    repairedCellCount: null,
    partialCellCount: null,
    unpricedCellCount: null,
    sourceTimestamp: chains[0]?.source?.timestamp || null,
    cacheStatus,
  };
};

export const summarizeCboePayloadQuality = (
  payload: unknown,
  cacheStatus: SpxGexCollectionCacheStatus,
): SpxGexCollectionQualitySummary => {
  const root = asRecord(payload);
  const rows: Record<string, any>[] = Array.isArray(asRecord(root.data).options)
    ? asRecord(root.data).options.map(asRecord)
    : [];
  const legs = rows.map(normalizeCboeLeg).filter((leg): leg is CboeNormalizedLeg => Boolean(leg));
  const summary = summarizeParsedChains([{
    symbol: "SPX",
    spot: 0,
    expiries: [],
    selectedExpiry: null,
    calls: legs.filter((leg) => leg.side === "C"),
    puts: legs.filter((leg) => leg.side === "P"),
    source: {
      provider: CBOE_CACHE_PROVIDER,
      label: "Cboe delayed",
      timestamp: typeof root.timestamp === "string" ? root.timestamp : null,
      url: CBOE_SPX_OPTIONS_URL,
    },
  }], rows.length, cacheStatus);
  return summary;
};

export const calculateCboePcrFromChains = (chains: SpxGexOptionChain[]) => {
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  for (const chain of chains) {
    totalCallVolume += chain.calls.reduce((sum, leg) => sum + Number(leg.volume || 0), 0);
    totalPutVolume += chain.puts.reduce((sum, leg) => sum + Number(leg.volume || 0), 0);
  }
  if (totalCallVolume <= 0) return null;
  return Math.round((totalPutVolume / totalCallVolume) * 100) / 100;
};

const rowToCacheResult = (row: CboeCacheRow, label: string) => {
  const chains = withCacheSource(JSON.parse(row.chains_json) as SpxGexOptionChain[], label, row.source_timestamp);
  return {
    chains,
    pcrValue: row.pcr_value === null || row.pcr_value === undefined ? calculateCboePcrFromChains(chains) : Number(row.pcr_value),
    sourceTimestamp: row.source_timestamp,
    normalizedBytes: Number(row.normalized_bytes || row.chains_json.length),
  };
};

export class CboeD1Cache {
  private readonly now: () => Date;

  constructor(private readonly db: D1DatabaseLike, options: { now?: () => Date } = {}) {
    this.now = options.now || (() => new Date());
  }

  async readFresh(cacheKey: string) {
    const row = await this.db
      .prepare("SELECT * FROM spx_cboe_option_chain_cache WHERE cache_key = ? AND expires_at > ?")
      .bind(cacheKey, this.now().toISOString())
      .first<CboeCacheRow>();
    return row ? rowToCacheResult(row, "Cboe delayed cache") : null;
  }

  async getLatestStaleCboeCacheForToday(tradingDate: string) {
    const row = await this.db
      .prepare(`
        SELECT * FROM spx_cboe_option_chain_cache
        WHERE trading_date = ?
        ORDER BY collected_minute_et DESC, created_at DESC
        LIMIT 1
      `)
      .bind(tradingDate)
      .first<CboeCacheRow>();
    return row ? rowToCacheResult(row, "Cboe delayed cache stale") : null;
  }

  async write(input: CboeCacheWriteInput) {
    const chainsJson = JSON.stringify(input.chains);
    const normalizedBytes = chainsJson.length;
    if (normalizedBytes > CBOE_CACHE_ROW_GUARD_BYTES) {
      return false;
    }

    const createdAt = input.createdAt || this.now().toISOString();
    const expiresAt = input.expiresAt || new Date(new Date(createdAt).getTime() + CBOE_CACHE_TTL_MS).toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO spx_cboe_option_chain_cache (
        cache_key, trading_date, collected_minute_et, source_timestamp, spot, chains_json,
        pcr_value, raw_bytes, normalized_bytes, fetch_ms, created_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        source_timestamp = excluded.source_timestamp,
        spot = excluded.spot,
        chains_json = excluded.chains_json,
        pcr_value = excluded.pcr_value,
        raw_bytes = excluded.raw_bytes,
        normalized_bytes = excluded.normalized_bytes,
        fetch_ms = excluded.fetch_ms,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `).bind(
      input.cacheKey,
      input.tradingDate,
      input.collectedMinuteEt,
      input.sourceTimestamp || null,
      input.spot,
      chainsJson,
      input.pcrValue ?? null,
      input.rawBytes ?? null,
      normalizedBytes,
      input.fetchMs ?? null,
      createdAt,
      expiresAt,
    );
    const prune = this.db
      .prepare("DELETE FROM spx_cboe_option_chain_cache WHERE expires_at < ?")
      .bind(this.now().toISOString());

    if (this.db.batch) await this.db.batch([upsert, prune]);
    else {
      await upsert.run();
      await prune.run();
    }
    return true;
  }
}

const fetchCboeJson = async () => {
  const errors: string[] = [];

  for (let attempt = 1; attempt <= CBOE_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CBOE_FETCH_TIMEOUT_MS);
    try {
      const started = Date.now();
      const response = await fetch(CBOE_SPX_OPTIONS_URL, {
        headers: {
          "User-Agent": CBOE_USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      }

      const text = await response.text();
      return {
        payload: JSON.parse(text) as unknown,
        rawBytes: text.length,
        fetchMs: Date.now() - started,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`attempt ${attempt}: ${message}`);
    }
  }

  throw new Error(`Cboe delayed options request failed after ${CBOE_FETCH_ATTEMPTS} attempts: ${errors.join(" | ")}`);
};

export class CboeSpxGexDataClient implements SpxGexDataClient {
  private readonly fetchJson: FetchJson;
  private readonly now: () => Date;
  private readonly cache: CboeD1Cache | null;
  private readonly cachePolicy: SpxGexCboeCachePolicy;
  private readonly allowStaleCache: boolean;
  private collectionQuality: SpxGexCollectionQualitySummary | null = null;
  private chainsPromise: Promise<SpxGexOptionChain[]> | null = null;

  constructor(options: {
    db?: D1DatabaseLike;
    fetchJson?: FetchJson;
    now?: () => Date;
    cachePolicy?: SpxGexCboeCachePolicy;
    allowStaleCache?: boolean;
  } = {}) {
    this.fetchJson = options.fetchJson || fetchCboeJson;
    this.now = options.now || (() => new Date());
    this.cache = options.db ? new CboeD1Cache(options.db, { now: this.now }) : null;
    this.cachePolicy = options.cachePolicy || "default";
    this.allowStaleCache = options.allowStaleCache !== false;
  }

  private async loadChains() {
    const now = this.now();
    const tradingDate = todayEt(now);
    const collectedMinuteEt = cboeCacheBucketMinuteEt(now);
    const cacheKey = buildCboeCacheKey(tradingDate, collectedMinuteEt);

    const freshCache = this.cachePolicy === "default" && this.cache
      ? await this.cache.readFresh(cacheKey).catch(() => null)
      : null;
    if (freshCache) {
      this.collectionQuality = summarizeParsedChains(
        freshCache.chains,
        freshCache.chains.flatMap((chain) => [...chain.calls, ...chain.puts]).length,
        "fresh",
      );
      return freshCache.chains;
    }

    try {
      const fetched = normalizeFetchResult(await this.fetchJson());
      const parsed = parseCboeSpxOptionsPayload(fetched.payload, { todayEt: tradingDate });
      const chains = normalizeChainsForCache(parsed);
      if (chains.length === 0) throw new Error("Cboe delayed options returned no active SPX expiries.");
      this.collectionQuality = summarizeCboePayloadQuality(
        fetched.payload,
        this.cachePolicy === "force_refresh" ? "force_refreshed" : "miss",
      );
      if (this.cache) {
        await this.cache.write({
          cacheKey,
          tradingDate,
          collectedMinuteEt,
          sourceTimestamp: chains[0]?.source?.timestamp || null,
          spot: chains[0]?.spot || 0,
          chains,
          pcrValue: calculateCboePcrFromChains(chains),
          rawBytes: fetched.rawBytes ?? null,
          fetchMs: fetched.fetchMs ?? null,
        }).catch(() => false);
      }
      return chains;
    } catch (error) {
      const staleCache = this.allowStaleCache && this.cachePolicy === "default" && this.cache
        ? await this.cache.getLatestStaleCboeCacheForToday(tradingDate).catch(() => null)
        : null;
      if (staleCache) {
        this.collectionQuality = summarizeParsedChains(
          staleCache.chains,
          staleCache.chains.flatMap((chain) => [...chain.calls, ...chain.puts]).length,
          "stale",
        );
        return staleCache.chains;
      }
      throw error;
    }
  }

  private async chains() {
    if (!this.chainsPromise) this.chainsPromise = this.loadChains();
    const chains = await this.chainsPromise;
    if (chains.length === 0) throw new Error("Cboe delayed options returned no active SPX expiries.");
    return chains;
  }

  async getQuotes() {
    const chain = await this.getOptionsChain();
    return [
      "| Ticker | Last | Change | Change % |",
      "| --- | ---: | ---: | ---: |",
      `| SPX | $${chain.spot.toFixed(2)} | n/a | n/a |`,
    ].join("\n");
  }

  async getOptions() {
    const chains = await this.chains();
    return `**Available expiries:** ${chains[0]?.expiries.join(", ") || "none"}`;
  }

  async getOptions0Dte() {
    const chain = await this.getOptionsChain();
    return `**Snapshot:** ${chain.source?.timestamp || new Date().toISOString()} **Session phase:** \`cboe_delayed\`\n**Expiry:** ${chain.selectedExpiry || "none"}`;
  }

  async getOptionsGex(expiry: string) {
    const chain = await this.getOptionsChain(expiry);
    return `**Snapshot:** ${chain.source?.timestamp || new Date().toISOString()} **Spot:** $${chain.spot.toFixed(2)}\n| Strike | Call OI | Put OI |\n| ---: | ---: | ---: |\n${chain.calls.map((call) => {
      const put = chain.puts.find((leg) => leg.strike === call.strike);
      return `| $${call.strike.toFixed(0)} | ${call.openInterest ?? "n/a"} | ${put?.openInterest ?? "n/a"} |`;
    }).join("\n")}`;
  }

  async getOptionsPcr() {
    return calculateCboePcrFromChains(await this.chains());
  }

  async getOptionsChain(expiry?: string): Promise<SpxGexOptionChain> {
    const chains = await this.chains();
    const selectedExpiry = expiry || chains[0]?.selectedExpiry;
    const chain = chains.find((item) => item.selectedExpiry === selectedExpiry);
    if (!chain) throw new Error(`Cboe delayed options returned no SPX chain for ${selectedExpiry || "front expiry"}.`);
    return chain;
  }

  getCollectionQualitySummary() {
    return this.collectionQuality;
  }
}

export class FallbackSpxGexDataClient implements SpxGexDataClient {
  private readonly primary: SpxGexDataClient;
  private readonly fallback: SpxGexDataClient;
  private selectedClientPromise: Promise<SpxGexDataClient> | null = null;
  private selectedClientResolved: SpxGexDataClient | null = null;

  constructor(options: { primary: SpxGexDataClient; fallback: SpxGexDataClient }) {
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  private async selectedClient() {
    if (!this.selectedClientPromise) {
      this.selectedClientPromise = (async () => {
        if (!this.primary.getOptionsChain) return this.fallback;
        try {
          await this.primary.getOptionsChain();
          this.selectedClientResolved = this.primary;
          return this.primary;
        } catch {
          this.selectedClientResolved = this.fallback;
          return this.fallback;
        }
      })();
    }
    return this.selectedClientPromise;
  }

  async getQuotes() {
    return (await this.selectedClient()).getQuotes();
  }

  async getOptions() {
    return (await this.selectedClient()).getOptions();
  }

  async getOptions0Dte() {
    return (await this.selectedClient()).getOptions0Dte();
  }

  async getOptionsGex(expiry: string) {
    return (await this.selectedClient()).getOptionsGex(expiry);
  }

  async getOptionsPcr() {
    const client = await this.selectedClient();
    return client.getOptionsPcr ? client.getOptionsPcr() : null;
  }

  async getOptionsChain(expiry?: string) {
    const client = await this.selectedClient();
    if (!client.getOptionsChain) throw new Error("Selected SPX GEX data client does not support structured option chains.");
    const chain = await client.getOptionsChain(expiry);
    if (client === this.fallback && chain.source) {
      return {
        ...chain,
        source: {
          ...chain.source,
          label: chain.source.label.includes("fallback") ? chain.source.label : `${chain.source.label} fallback`,
          fallbackFrom: "Cboe delayed",
        },
      };
    }
    return chain;
  }

  async getMarketContext(): Promise<SpxGexMarketContext> {
    const client = await this.selectedClient();
    if (client === this.fallback && this.fallback.getMarketContext) return this.fallback.getMarketContext();

    return {
      macroRegime: null,
      breadth: null,
      flow: null,
      latestHeadline: null,
      warnings: ["Cboe delayed source selected; Yahoo market context skipped to keep heatmap generation independent of Yahoo crumb/4xx failures."],
    };
  }

  getCollectionQualitySummary() {
    return this.selectedClientResolved?.getCollectionQualitySummary?.() || null;
  }
}

export const createCboeOnlySpxGexDataClient = (options: {
  db?: D1DatabaseLike;
  fetchJson?: FetchJson;
  now?: Date | (() => Date);
  cachePolicy?: SpxGexCboeCachePolicy;
  allowStaleCache?: boolean;
} = {}) =>
  new CboeSpxGexDataClient({
    db: options.db,
    fetchJson: options.fetchJson,
    now: typeof options.now === "function" ? options.now : options.now ? () => options.now as Date : undefined,
    cachePolicy: options.cachePolicy,
    allowStaleCache: options.allowStaleCache,
  });

export const createSpxGexIntradayDataClient = (options: {
  db?: D1DatabaseLike;
  fetchJson?: FetchJson;
  now?: Date | (() => Date);
} = {}) => {
  const primary = createCboeOnlySpxGexDataClient({
      db: options.db,
      fetchJson: options.fetchJson,
      now: options.now,
    });
  return new FallbackSpxGexDataClient({
    primary,
    fallback: new NativeSpxGexYahooClient(),
  });
};
