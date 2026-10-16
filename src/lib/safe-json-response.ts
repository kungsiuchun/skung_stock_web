export class SafeJsonResponseError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly contentType: string,
    readonly rayId: string | null,
  ) {
    super(message);
    this.name = "SafeJsonResponseError";
  }
}

const errorMessage = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as { message?: unknown; error?: unknown; errorCode?: unknown };
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error === "object" && typeof (payload.error as { message?: unknown }).message === "string") {
    return (payload.error as { message: string }).message;
  }
  return typeof payload.errorCode === "string" ? payload.errorCode : null;
};

export const parseJsonResponse = async <T>(
  response: Response,
  requestUrl: string,
  options: { allowHttpError?: boolean } = {},
): Promise<T> => {
  const contentType = response.headers.get("content-type") || "";
  const rayId = response.headers.get("cf-ray");
  const text = await response.text();
  if (!text.trim()) {
    throw new SafeJsonResponseError(
      `HTTP ${response.status}${rayId ? ` · Ray ${rayId}` : ""}: ${requestUrl} returned an empty response. Retry the request; if it persists, the service is unavailable.`,
      response.status,
      contentType,
      rayId,
    );
  }
  if (!contentType.toLowerCase().includes("application/json")) {
    const providerCode = text.match(/error code:\s*(\d+)/i)?.[1];
    const detail = [
      `HTTP ${response.status}`,
      providerCode ? `Cloudflare ${providerCode}` : null,
      rayId ? `Ray ${rayId}` : null,
    ].filter(Boolean).join(" · ");
    throw new SafeJsonResponseError(
      `${detail}: ${requestUrl} returned ${contentType || "unknown content"}, not JSON.`,
      response.status,
      contentType,
      rayId,
    );
  }
  try {
    const payload = JSON.parse(text) as T;
    if (!response.ok && !options.allowHttpError) {
      const detail = errorMessage(payload);
      throw new SafeJsonResponseError(
        `HTTP ${response.status}${rayId ? ` · Ray ${rayId}` : ""}: ${detail || `${requestUrl} failed. Retry the request or return to Market Lab.`}`,
        response.status,
        contentType,
        rayId,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof SafeJsonResponseError) throw error;
    throw new SafeJsonResponseError(
      `HTTP ${response.status}${rayId ? ` · Ray ${rayId}` : ""}: ${requestUrl} returned invalid JSON (${error instanceof Error ? error.message : String(error)}).`,
      response.status,
      contentType,
      rayId,
    );
  }
};
