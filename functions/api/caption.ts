import type { PagesFunction } from "@cloudflare/workers-types";
import type { Ai } from "@cloudflare/workers-types";

interface Env {
  image_caption_ai: Ai; // prefer Ai over any
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const formData = await context.request.formData();
    const imageFile = formData.get("image");

    // Stronger guard than a cast
    if (!(imageFile instanceof File)) {
      return new Response("No image file uploaded", { status: 400 });
    }

    const arrayBuffer = await imageFile.arrayBuffer();

    // IMPORTANT: convert to plain number[] (what the model schema accepts)
    const imageBytes = [...new Uint8Array(arrayBuffer)];

    // debug
    console.log({
      imageIsArray: Array.isArray(imageBytes),
      firstByte: imageBytes[0],
      length: imageBytes.length,
    });

    const result = await context.env.image_caption_ai.run(
      "@cf/llava-hf/llava-1.5-7b-hf",
      {
        image: imageBytes,
        prompt: "Describe this image in a short, poetic caption (under 20 words).",
        max_tokens: 50,
      }
    );

    // For this model, docs indicate output is a string description
    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};