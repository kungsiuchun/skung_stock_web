export interface SpxRequestLaneOptions {
  signal?: AbortSignal;
  retries?: number;
  retryDelaysMs?: number[];
  onRetry?: (attempt: number) => void;
}

const retryableStatuses = new Set([502, 503, 504]);
let tail: Promise<void> = Promise.resolve();

const abortError = () => new DOMException("SPX request was cancelled.", "AbortError");
const isDocumentHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const wait = (delayMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const timer = globalThis.setTimeout(resolve, delayMs);
  signal?.addEventListener("abort", () => {
    globalThis.clearTimeout(timer);
    reject(abortError());
  }, { once: true });
});

export const isSpxRequestAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** Serializes expensive SPX Pages reads and retries only transient transport failures. */
export const runSpxRequest = async <T extends Response>(task: () => Promise<T>, options: SpxRequestLaneOptions = {}): Promise<T> => {
  let release!: () => void;
  const previous = tail.catch(() => undefined);
  tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;

  try {
    const retries = options.retries ?? 2;
    const retryDelays = options.retryDelaysMs ?? [280, 820];
    for (let attempt = 0; ; attempt += 1) {
      if (options.signal?.aborted || (attempt > 0 && isDocumentHidden())) throw abortError();
      try {
        const response = await task();
        if (!retryableStatuses.has(response.status) || attempt >= retries) return response;
        await response.body?.cancel();
      } catch (error) {
        if (isSpxRequestAbort(error) || options.signal?.aborted || attempt >= retries) throw error;
      }
      options.onRetry?.(attempt + 1);
      await wait(retryDelays[Math.min(attempt, retryDelays.length - 1)] ?? 820, options.signal);
    }
  } finally {
    release();
  }
};

export const resetSpxRequestLaneForTests = () => { tail = Promise.resolve(); };
