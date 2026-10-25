export class BoundedBodyError extends Error {
  constructor(readonly kind: "size" | "timeout") {
    super(kind === "size" ? "Body exceeds its byte limit." : "Body read timed out.");
    this.name = "BoundedBodyError";
  }
}

/** Count bytes before decoding or parsing, including chunked bodies. */
export async function readBoundedText(message: Request | Response, maxBytes: number, timeoutMs = 10_000): Promise<string> {
  if (Number(message.headers.get("Content-Length")) > maxBytes) {
    void message.body?.cancel().catch(() => undefined);
    throw new BoundedBodyError("size");
  }
  if (!message.body) return "";
  const reader = message.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new BoundedBodyError("timeout")); void reader.cancel().catch(() => undefined); }, timeoutMs);
  });
  const consume = async () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        size += chunk.value.byteLength;
        if (size > maxBytes) { void reader.cancel().catch(() => undefined); throw new BoundedBodyError("size"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
  };
  try { return await Promise.race([consume(), timeout]); }
  finally { clearTimeout(timer); }
}

/** The deadline covers headers and body; caller cancellation is retained. */
export async function fetchBoundedText(url: string, init: RequestInit = {}, maxBytes = 2 * 1024 * 1024, timeoutMs = 12_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await readBoundedText(response, maxBytes, Math.max(1, timeoutMs - (Date.now() - started)));
    return { response, text };
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw new BoundedBodyError("timeout");
    throw error;
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
