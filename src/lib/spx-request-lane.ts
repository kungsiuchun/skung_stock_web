export interface SpxRequestLaneOptions {
  signal?: AbortSignal;
  retries?: number;
  retryDelaysMs?: number[];
  attemptTimeoutMs?: number;
  onRetry?: (attempt: number) => void;
}

const retryableStatuses = new Set([502, 503, 504]);
let tail: Promise<void> = Promise.resolve();

const abortError = () => new DOMException("SPX request was cancelled.", "AbortError");
export class SpxRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`SPX request timed out after ${timeoutMs}ms.`);
    this.name = "SpxRequestTimeoutError";
  }
}

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
const isTransientRequestError = (error: unknown) => error instanceof SpxRequestTimeoutError || error instanceof TypeError;

const runAttempt = async <T extends Response>(
  task: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let rejectBoundary!: (error: unknown) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const onParentAbort = () => {
    controller.abort();
    rejectBoundary(abortError());
  };
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  if (parentSignal?.aborted) onParentAbort();
  timer = globalThis.setTimeout(() => {
    controller.abort();
    rejectBoundary(new SpxRequestTimeoutError(timeoutMs));
  }, timeoutMs);
  try {
    return await Promise.race([task(controller.signal), boundary]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
};

/** Serializes expensive SPX Pages reads and retries only transient transport failures. */
export const runSpxRequest = async <T extends Response>(task: (signal: AbortSignal) => Promise<T>, options: SpxRequestLaneOptions = {}): Promise<T> => {
  let release!: () => void;
  const previous = tail.catch(() => undefined);
  tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;

  try {
    const retries = options.retries ?? 1;
    const retryDelays = options.retryDelaysMs ?? [300];
    const attemptTimeoutMs = options.attemptTimeoutMs ?? 8_000;
    for (let attempt = 0; ; attempt += 1) {
      if (options.signal?.aborted || (attempt > 0 && isDocumentHidden())) throw abortError();
      try {
        const response = await runAttempt(task, options.signal, attemptTimeoutMs);
        if (!retryableStatuses.has(response.status) || attempt >= retries) return response;
        await response.body?.cancel();
      } catch (error) {
        if (isSpxRequestAbort(error) || options.signal?.aborted || attempt >= retries || !isTransientRequestError(error)) throw error;
      }
      options.onRetry?.(attempt + 1);
      await wait(retryDelays[Math.min(attempt, retryDelays.length - 1)] ?? 820, options.signal);
    }
  } finally {
    release();
  }
};

export const resetSpxRequestLaneForTests = () => { tail = Promise.resolve(); };
