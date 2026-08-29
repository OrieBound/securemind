/**
 * Turn image bytes into searchable text for Knowledge ingest.
 *
 * Failed or skipped vision extract must not be indexed as Knowledge.
 */

import Groq from "groq-sdk";
import { hasGroqRuntime } from "@/lib/models/groq";

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

const MAX_VISION_BYTES = 4 * 1024 * 1024;

const EXTRACT_PROMPT =
  "You extract searchable knowledge from an operations or security screenshot.\n" +
  "1. Transcribe all readable text exactly (UI labels, log lines, IDs, errors).\n" +
  "2. Then add a short plain-language summary of what the image shows (2–4 sentences).\n" +
  "3. Do not invent text that is not visible. If nothing is readable, say so.\n" +
  "Output plain text only — no markdown fences.";

export class ImageExtractError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ImageExtractError";
    this.code = code;
  }
}

export function isFailedExtractContent(text: string): boolean {
  return /Extraction:\s*(skipped|failed|vision model returned empty)/i.test(text);
}

/**
 * Extract searchable text from an image buffer.
 * Throws ImageExtractError when vision is unavailable or fails — do not persist stubs.
 */
export async function extractTextFromImage(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  if (!(await hasGroqRuntime())) {
    throw new ImageExtractError(
      "Image text could not be extracted. Add a Groq key (or use a text document) and retry.",
      "VISION_UNAVAILABLE",
    );
  }
  if (buffer.length > MAX_VISION_BYTES) {
    throw new ImageExtractError(
      `Image is too large for vision extract (over ${MAX_VISION_BYTES} bytes).`,
      "IMAGE_TOO_LARGE",
    );
  }

  try {
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    const completion = await client.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new ImageExtractError(
        "The vision model returned no readable text from this image.",
        "EMPTY_VISION",
      );
    }

    return `Image: ${filename}\nMIME: ${mimeType}\n\n${text}`;
  } catch (err) {
    if (err instanceof ImageExtractError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[image-extract] vision extract failed:", msg.slice(0, 160));
    throw new ImageExtractError(
      "Image extraction failed. The file was not indexed as Knowledge.",
      "VISION_FAILED",
    );
  }
}
