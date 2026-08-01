/**
 * Turn image bytes into searchable text for Knowledge ingest.
 *
 * Ops screenshots (console pages, log panes, tickets) often carry the real
 * evidence. We ask Groq's vision model for a plain transcript + short scene
 * summary when GROQ_API_KEY is set. The result is scrubbed by scrubDocumentText
 * before persist — screenshots can contain emails, phones, and secrets too.
 *
 * Without Groq, we store a minimal stub so the file still appears in Knowledge.
 */

import Groq from "groq-sdk";
import { isGroqAvailable } from "@/lib/models/groq";

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

/** Cap payload size sent to the vision API (base64 expands ~4/3). */
const MAX_VISION_BYTES = 4 * 1024 * 1024;

const EXTRACT_PROMPT =
  "You extract searchable knowledge from an operations or security screenshot.\n" +
  "1. Transcribe all readable text exactly (UI labels, log lines, IDs, errors).\n" +
  "2. Then add a short plain-language summary of what the image shows (2–4 sentences).\n" +
  "3. Do not invent text that is not visible. If nothing is readable, say so.\n" +
  "Output plain text only — no markdown fences.";

function imageStub(mimeType: string, byteLength: number, filename: string, reason: string): string {
  return (
    `Image: ${filename}\n` +
    `MIME: ${mimeType}\n` +
    `Size: ${byteLength} bytes\n` +
    `Extraction: ${reason}\n` +
    `The file is registered in this workspace's Knowledge library.`
  );
}

/**
 * Extract searchable text from an image buffer.
 * Never throws — callers always get a non-empty string suitable for scrubbing.
 */
export async function extractTextFromImage(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  if (!isGroqAvailable()) {
    return imageStub(mimeType, buffer.length, filename, "skipped (no GROQ_API_KEY)");
  }
  if (buffer.length > MAX_VISION_BYTES) {
    return imageStub(
      mimeType,
      buffer.length,
      filename,
      `skipped (image larger than ${MAX_VISION_BYTES} bytes for vision extract)`,
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
      return imageStub(mimeType, buffer.length, filename, "vision model returned empty text");
    }

    return (
      `Image: ${filename}\n` +
      `MIME: ${mimeType}\n\n` +
      `${text}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[image-extract] vision extract failed:", msg.slice(0, 160));
    return imageStub(mimeType, buffer.length, filename, `failed (${msg.slice(0, 80)})`);
  }
}
