import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pathToFileURL } from "node:url";

import { createMarketBreadthDataClient, type MarketBreadthDataClient } from "../src/lib/market-breadth-sources";
import {
  MARKET_BREADTH_STATUS_KEY,
  publishMarketBreadthAttempt,
  publishMarketBreadthRelease,
  readJsonObject,
  validateMarketBreadthStatus,
  type MarketBreadthAttempt,
  type MarketBreadthObjectStore,
  type MarketBreadthStatus,
} from "../src/lib/market-breadth-r2";
import { validateMarketBreadthSnapshot, type MarketBreadthSnapshot, type PriceBar, type SectorUniverse } from "../src/lib/market-breadth";
import {
  marketBreadthBackfillScope,
  marketBreadthRequiredSymbols,
  runMarketBreadthRefresh,
  type MarketBreadthRefreshRepository,
} from "../src/lib/market-breadth-refresh";

export interface PersistedMarketBreadthState {
  schemaVersion: 1;
  universe: SectorUniverse | null;
  series: Record<string, PriceBar[]>;
  attempts: Record<string, string[]>;
  latestSnapshot: MarketBreadthSnapshot | null;
  updatedAt: string;
}

export const pruneMarketBreadthStateForUniverse = (state: PersistedMarketBreadthState, universe: SectorUniverse) => {
  const allowed = new Set(marketBreadthRequiredSymbols(universe));
  state.series = Object.fromEntries(Object.entries(state.series).filter(([symbol]) => allowed.has(symbol)));
  const scope = marketBreadthBackfillScope(universe);
  state.attempts = state.attempts[scope] ? { [scope]: state.attempts[scope] } : {};
  state.universe = universe;
  return state;
};

const emptyState = (): PersistedMarketBreadthState => ({
  schemaVersion: 1, universe: null, series: {}, attempts: {}, latestSnapshot: null, updatedAt: new Date(0).toISOString(),
});

const parseState = (value: unknown): PersistedMarketBreadthState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyState();
  const state = value as Partial<PersistedMarketBreadthState>;
  if (state.schemaVersion !== 1 || !state.series || typeof state.series !== "object" || !state.attempts || typeof state.attempts !== "object") {
    throw new Error("MARKET_BREADTH_STATE_INVALID");
  }
  return {
    schemaVersion: 1,
    universe: state.universe || null,
    series: state.series as Record<string, PriceBar[]>,
    attempts: state.attempts as Record<string, string[]>,
    latestSnapshot: state.latestSnapshot ? validateMarketBreadthSnapshot(state.latestSnapshot) : null,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date(0).toISOString(),
  };
};

class StateRepository implements MarketBreadthRefreshRepository {
  readonly state: PersistedMarketBreadthState;
  lastAttempt: MarketBreadthAttempt | null = null;
  private startedAt = "";
  private mode: "DAILY" | "BACKFILL" = "DAILY";

  constructor(state: PersistedMarketBreadthState) { this.state = state; }
  async beginRun(input: { runId: string; mode: "DAILY" | "BACKFILL"; startedAt: string }) {
    this.startedAt = input.startedAt;
    this.mode = input.mode;
  }
  async finishRun(input: { runId: string; status: "READY" | "SKIPPED" | "FAILED" | "PARTIAL"; finishedAt: string; priceAsOf?: string | null; errorClass?: string | null }) {
    this.lastAttempt = {
      runId: input.runId,
      status: input.status,
      startedAt: this.startedAt,
      finishedAt: input.finishedAt,
      priceAsOf: input.priceAsOf || null,
      errorClass: input.errorClass || null,
    };
    this.state.updatedAt = input.finishedAt;
  }
  async readLatestSnapshot() { return this.state.latestSnapshot; }
  async readUniverse() { return this.state.universe; }
  async saveUniverse(universe: SectorUniverse) { pruneMarketBreadthStateForUniverse(this.state, universe); }
  async readSeries(symbols: string[]) { return new Map(symbols.map((symbol) => [symbol, this.state.series[symbol] || []])); }
  async saveSeries(series: Map<string, PriceBar[]>) { for (const [symbol, bars] of series) this.state.series[symbol] = bars; }
  async publish(snapshot: MarketBreadthSnapshot) { this.state.latestSnapshot = validateMarketBreadthSnapshot(snapshot); }
  async readBackfillAttempts(backfillScope: string) { return new Set(this.state.attempts[backfillScope] || []); }
  async recordBackfillAttempt(input: { backfillScope: string; symbol: string }) {
    this.state.attempts[input.backfillScope] = [...new Set([...(this.state.attempts[input.backfillScope] || []), input.symbol])];
  }
  serialize() { return JSON.stringify(this.state); }
}

class S3ObjectStore implements MarketBreadthObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}
  async get(key: string) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) throw new Error(`MARKET_BREADTH_OBJECT_BODY_MISSING:${key}`);
      return { text: () => result.Body!.transformToString() };
    } catch (error) {
      const code = error && typeof error === "object" ? String((error as { name?: unknown }).name || "") : "";
      if (code === "NoSuchKey" || code === "NotFound") return null;
      throw error;
    }
  }
  async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: value, ContentType: options?.httpMetadata?.contentType || "application/json; charset=utf-8" }));
  }
}

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
};

export const runGitHubMarketBreadthRefresh = async (input?: {
  store?: MarketBreadthObjectStore;
  now?: Date;
  mode?: "AUTO" | "BACKFILL" | "DAILY";
  backfillBatchSize?: number;
  client?: MarketBreadthDataClient;
}) => {
  const store = input?.store || new S3ObjectStore(new S3Client({
    region: "auto",
    endpoint: `https://${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: requiredEnv("MARKET_BREADTH_R2_ACCESS_KEY_ID"), secretAccessKey: requiredEnv("MARKET_BREADTH_R2_SECRET_ACCESS_KEY") },
  }), process.env.MARKET_BREADTH_R2_BUCKET?.trim() || "market-breadth-data");

  const rawStatus = await readJsonObject(store, MARKET_BREADTH_STATUS_KEY);
  const previousStatus: MarketBreadthStatus | null = rawStatus === null ? null : validateMarketBreadthStatus(rawStatus);
  const rawState = previousStatus ? await readJsonObject(store, previousStatus.state.key) : null;
  const repository = new StateRepository(rawState === null ? emptyState() : parseState(rawState));
  if (!repository.state.latestSnapshot && previousStatus?.current) throw new Error("MARKET_BREADTH_STATE_CURRENT_SNAPSHOT_MISSING");

  const requestedMode = input?.mode || (process.env.MARKET_BREADTH_MODE as "AUTO" | "BACKFILL" | "DAILY" | undefined) || "AUTO";
  const mode = requestedMode === "AUTO" ? repository.state.latestSnapshot ? "DAILY" : "BACKFILL" : requestedMode;
  const result = await runMarketBreadthRefresh({
    mode,
    repository,
    client: input?.client || createMarketBreadthDataClient({ apiKey: requiredEnv("MASSIVE_API_KEY") }),
    now: input?.now,
    backfillBatchSize: input?.backfillBatchSize || Number(process.env.MARKET_BREADTH_BACKFILL_BATCH_SIZE || 25),
  });
  const attempt = repository.lastAttempt;
  if (!attempt) throw new Error("MARKET_BREADTH_ATTEMPT_MISSING");
  if (result.status === "READY" && repository.state.latestSnapshot) {
    const releaseId = `${repository.state.latestSnapshot.priceAsOf}-${attempt.runId.slice(-12)}`;
    await publishMarketBreadthRelease(store, { previousStatus, releaseId, snapshot: repository.state.latestSnapshot, stateJson: repository.serialize(), attempt });
  } else {
    await publishMarketBreadthAttempt(store, { previousStatus, attempt, stateJson: repository.serialize() });
  }
  return result;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGitHubMarketBreadthRefresh().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "FAILED") process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`Market breadth refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
