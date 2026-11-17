import { isAllowedWatcherEmail, parseCookie, verifyWatcherSession } from "../../src/lib/stocks-watcher-auth";

interface Env {
  STOCKS_WATCHER_SESSION_SECRET?: string;
  STOCKS_WATCHER_ALLOWED_EMAIL?: string;
  image_caption_ai?: { run(model: string, inputs: { task: "query"; image: string; question: string; reasoning: false; stream: false; max_tokens: number }): Promise<unknown> };
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const authorizeOwner = async (request: Request, env: Env) => {
  if (!env.STOCKS_WATCHER_SESSION_SECRET || !env.STOCKS_WATCHER_ALLOWED_EMAIL) {
    return json({ error: "Owner sign-in is not configured for this tool." }, 503);
  }
  const session = await verifyWatcherSession(parseCookie(request, "stocks_watcher_session"), env.STOCKS_WATCHER_SESSION_SECRET);
  if (!session) return json({ error: "Sign in as the site owner to generate captions." }, 401);
  if (!isAllowedWatcherEmail(session.email, env.STOCKS_WATCHER_ALLOWED_EMAIL)) {
    return json({ error: "Caption generation is available only to the site owner." }, 403);
  }
  return null;
};

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const denied = await authorizeOwner(request, env);
  if (denied) return denied;
  if (!env.image_caption_ai) return json({ error: "Caption generation is unavailable because its AI service is not configured." }, 503);
  return json({ available: true });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const denied = await authorizeOwner(context.request, context.env);
    if (denied) return denied;
    const origin = context.request.headers.get("Origin");
    if (!origin || origin !== new URL(context.request.url).origin) return json({ error: "Caption requests must come from this site." }, 403);
    if (!context.env.image_caption_ai) return json({ error: "Caption generation is unavailable because its AI service is not configured." }, 503);
    const formData = await context.request.formData();
    const imageFile = formData.get("image");

    // Stronger guard than a cast
    if (!(imageFile instanceof File)) {
      return json({ error: "No image file uploaded" }, 400);
    }
    if (!["image/png", "image/jpeg"].includes(imageFile.type)) {
      return json({ error: "Choose a PNG or JPG image." }, 415);
    }
    if (imageFile.size === 0 || imageFile.size > 5 * 1024 * 1024) {
      return json({ error: "Choose a non-empty image no larger than 5 MB." }, imageFile.size === 0 ? 400 : 413);
    }

    const arrayBuffer = await imageFile.arrayBuffer();

    const imageBytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let offset = 0; offset < imageBytes.length; offset += 32768) {
      binary += String.fromCharCode(...imageBytes.subarray(offset, offset + 32768));
    }

    const result = await context.env.image_caption_ai.run(
      "@cf/moondream/moondream3.1-9B-A2B",
      {
        task: "query",
        image: `data:${imageFile.type};base64,${btoa(binary)}`,
        question: "Describe this image in a short, poetic caption (under 20 words).",
        reasoning: false,
        stream: false,
        max_tokens: 50,
      }
    );

    const answer = result && typeof result === "object" && "answer" in result ? result.answer : null;
    if (typeof answer !== "string" || !answer.trim()) return json({ error: "The caption service returned no usable caption. Retry or choose another image." }, 502);
    return json({ success: true, result: answer.trim() });
  } catch {
    return json({ error: "Caption generation failed. Retry or choose another image." }, 500);
  }
};
