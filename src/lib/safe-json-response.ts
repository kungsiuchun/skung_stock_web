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

export const parseJsonResponse = async <T>(response: Response, requestUrl: string): Promise<T> => {
  const contentType = response.headers.get("content-type") || "";
  const rayId = response.headers.get("cf-ray");
  const text = await response.text();
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
    return JSON.parse(text) as T;
  } catch (error) {
    throw new SafeJsonResponseError(
      `HTTP ${response.status}${rayId ? ` · Ray ${rayId}` : ""}: ${requestUrl} returned invalid JSON (${error instanceof Error ? error.message : String(error)}).`,
      response.status,
      contentType,
      rayId,
    );
  }
};
