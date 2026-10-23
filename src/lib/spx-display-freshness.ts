import { isFreshSpx0DteSample, SPX_0DTE_STALE_AFTER_MS } from "./spx-price-action-compass";

export interface SpxDisplaySource {
  provider?: string;
  sessionState?: string;
  status?: "READY" | "STALE" | "UNAVAILABLE";
  latestSampleAt?: string | null;
  expectedMove?: {
    status: "READY" | "STALE" | "UNAVAILABLE";
    sampleAt: string | null;
    errorCode: string | null;
  };
}

/** A loaded LIVE response still ages when market-hour network polling stops. */
export const projectSpxDisplaySource = <T extends SpxDisplaySource>(source: T, nowMs: number, failed = false): T => {
  if (source.provider !== "0dtespx") return source;
  const live = source.sessionState === "LIVE";
  const priceExpired = live && source.status === "READY" && !isFreshSpx0DteSample(source.latestSampleAt, nowMs);
  const move = source.expectedMove;
  const moveExpired = live && move?.status === "READY" && !isFreshSpx0DteSample(move.sampleAt, nowMs);
  return {
    ...source,
    status: failed || priceExpired ? "STALE" : source.status,
    ...(move && (failed || moveExpired) ? { expectedMove: {
      ...move, status: "STALE" as const,
      errorCode: move.errorCode || "ZERO_DTE_SPX_EXPECTED_MOVE_STALE",
    } } : {}),
  };
};

/** The next display transition needs one local timer, never another API read. */
export const getSpxDisplayExpiryDelay = (source: SpxDisplaySource | null | undefined, nowMs: number): number | null => {
  if (source?.provider !== "0dtespx" || source.sessionState !== "LIVE") return null;
  const samples = [
    source.status === "READY" ? source.latestSampleAt : null,
    source.expectedMove?.status === "READY" ? source.expectedMove.sampleAt : null,
  ];
  const deadlines = samples.filter((sample) => isFreshSpx0DteSample(sample, nowMs))
    .map((sample) => Date.parse(sample!) + SPX_0DTE_STALE_AFTER_MS + 1 - nowMs);
  return deadlines.length ? Math.min(...deadlines) : null;
};
