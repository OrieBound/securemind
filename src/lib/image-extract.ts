/**
 * Turn image bytes into searchable text for Knowledge ingest.
 *
 * Groq is optional (local env or Admin BYOK). Hosted installs typically have
 * no Groq key — vision extract uses Bedrock (Nova Lite) when billable AWS is on.
 * Failed or skipped vision extract must not be indexed as Knowledge.
 */

import Groq from "groq-sdk";
import { hasGroqRuntime, selectGroqApiKey } from "@/lib/models/groq";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import {
  getInstanceAwsStatus,
  instanceCanUseBedrock,
  resolveRuntimeSecrets,
} from "@/lib/instance-config";
import { runtimeEdition } from "@/lib/runtime-env";

const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

/** Default: Nova Lite (TEXT + IMAGE). Override with BEDROCK_VISION_MODEL. */
const BEDROCK_VISION_MODEL =
  process.env.BEDROCK_VISION_MODEL ?? "amazon.nova-lite-v1:0";

const MAX_VISION_BYTES = 4 * 1024 * 1024;

const EXTRACT_PROMPT =
  "You extract searchable knowledge from an operations or security screenshot.\n" +
  "1. Transcribe all readable text exactly (UI labels, log lines, IDs, errors).\n" +
  "2. Then add a short plain-language summary of what the image shows (2–4 sentences).\n" +
  "3. Do not invent text that is not visible. If nothing is readable, say so.\n" +
  "Output plain text only — no markdown fences.";

const VISION_UNAVAILABLE_MESSAGE =
  "Image text could not be extracted. Enable Amazon Bedrock, add an optional Groq key, or upload a text document.";

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

export type ImageExtractBackend = "groq" | "bedrock";

/** Hosted: Bedrock first (IAM, no Groq required). Local: Groq first if configured. */
export function pickImageExtractBackend(opts: {
  edition: "local" | "cloud";
  groqOk: boolean;
  bedrockOk: boolean;
}): ImageExtractBackend | null {
  if (opts.edition === "cloud") {
    if (opts.bedrockOk) return "bedrock";
    if (opts.groqOk) return "groq";
    return null;
  }
  if (opts.groqOk) return "groq";
  if (opts.bedrockOk) return "bedrock";
  return null;
}

export async function resolveImageExtractBackend(): Promise<ImageExtractBackend | null> {
  const [groqOk, bedrockOk] = await Promise.all([
    hasGroqRuntime(),
    instanceCanUseBedrock(),
  ]);
  return pickImageExtractBackend({
    edition: runtimeEdition(),
    groqOk,
    bedrockOk,
  });
}

function converseImageFormat(
  mimeType: string,
): "png" | "jpeg" | "gif" | "webp" | null {
  const m = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpeg";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  return null;
}

async function extractViaGroq(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const secrets = await resolveRuntimeSecrets();
  const apiKey = selectGroqApiKey(secrets);
  if (!apiKey) {
    throw new ImageExtractError(VISION_UNAVAILABLE_MESSAGE, "VISION_UNAVAILABLE");
  }
  const client = new Groq({ apiKey });
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const completion = await client.chat.completions.create({
    model: GROQ_VISION_MODEL,
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
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

async function extractViaBedrock(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const format = converseImageFormat(mimeType);
  if (!format) {
    throw new ImageExtractError(
      "That image format cannot be sent to Bedrock vision. Use PNG, JPEG, GIF, or WebP, or upload a text document.",
      "IMAGE_UNSUPPORTED",
    );
  }

  const secrets = await resolveRuntimeSecrets();
  const status = await getInstanceAwsStatus();
  const modelId = BEDROCK_VISION_MODEL;

  const text = await withRealAwsEndpoints(async () => {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const endpoint = process.env.AWS_ENDPOINT_URL_BEDROCK || undefined;
    const credentials = status.profile
      ? (await import("@aws-sdk/credential-providers")).fromNodeProviderChain({
          profile: status.profile,
        })
      : undefined;
    const client = new BedrockRuntimeClient({
      region: secrets.bedrockRegion,
      ...(credentials ? { credentials } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
    const response = await client.send(
      new ConverseCommand({
        modelId,
        messages: [
          {
            role: "user",
            content: [
              { text: EXTRACT_PROMPT },
              {
                image: {
                  format,
                  source: { bytes: new Uint8Array(buffer) },
                },
              },
            ],
          },
        ],
      }),
    );
    return (
      response.output?.message?.content
        ?.map(block => ("text" in block ? block.text : "") ?? "")
        .join("\n")
        .trim() ?? ""
    );
  });

  return text;
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
  if (buffer.length > MAX_VISION_BYTES) {
    throw new ImageExtractError(
      `Image is too large for vision extract (over ${MAX_VISION_BYTES} bytes).`,
      "IMAGE_TOO_LARGE",
    );
  }

  const backend = await resolveImageExtractBackend();
  if (!backend) {
    throw new ImageExtractError(VISION_UNAVAILABLE_MESSAGE, "VISION_UNAVAILABLE");
  }

  try {
    const text =
      backend === "bedrock"
        ? await extractViaBedrock(buffer, mimeType)
        : await extractViaGroq(buffer, mimeType);
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
