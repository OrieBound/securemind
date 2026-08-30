import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/models/groq", () => ({
  hasGroqRuntime: vi.fn(),
  selectGroqApiKey: vi.fn(),
}));

vi.mock("@/lib/instance-config", () => ({
  instanceCanUseBedrock: vi.fn(),
  resolveRuntimeSecrets: vi.fn(),
  getInstanceAwsStatus: vi.fn(),
}));

vi.mock("@/lib/runtime-env", () => ({
  runtimeEdition: vi.fn(() => "local"),
}));

import { hasGroqRuntime } from "@/lib/models/groq";
import { instanceCanUseBedrock } from "@/lib/instance-config";
import {
  extractTextFromImage,
  ImageExtractError,
  isFailedExtractContent,
  pickImageExtractBackend,
  resolveImageExtractBackend,
} from "./image-extract";
import { scrubPII } from "./pii";

describe("extractTextFromImage", () => {
  beforeEach(() => {
    vi.mocked(hasGroqRuntime).mockResolvedValue(false);
    vi.mocked(instanceCanUseBedrock).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when Groq and Bedrock vision are both unavailable so stubs are not indexed", async () => {
    await expect(
      extractTextFromImage(Buffer.from("fake-image-bytes"), "image/png", "console.png"),
    ).rejects.toMatchObject({
      name: "ImageExtractError",
      code: "VISION_UNAVAILABLE",
    });
    await expect(resolveImageExtractBackend()).resolves.toBeNull();
  });

  it("does not require Groq when Bedrock is available", async () => {
    vi.mocked(instanceCanUseBedrock).mockResolvedValue(true);
    await expect(resolveImageExtractBackend()).resolves.toBe("bedrock");
  });

  it("prefers Bedrock over Groq on hosted so Groq is not required", () => {
    expect(
      pickImageExtractBackend({ edition: "cloud", groqOk: true, bedrockOk: true }),
    ).toBe("bedrock");
    expect(
      pickImageExtractBackend({ edition: "local", groqOk: true, bedrockOk: true }),
    ).toBe("groq");
  });

  it("detects legacy stub text as failed extract content", () => {
    expect(
      isFailedExtractContent(
        "Image: x.png\nExtraction: skipped (no GROQ_API_KEY)\nThe file is registered",
      ),
    ).toBe(true);
    expect(isFailedExtractContent("Image: shot.png\n\nActual transcript")).toBe(false);
  });

  it("scrubs PII from vision-extracted text before it would be persisted", () => {
    const extracted =
      "Image: shot.png\n\nContact on-call at alice@acme.io or call (415) 555-0142";
    const scrubbed = scrubPII(extracted);
    expect(scrubbed.hadRedactions).toBe(true);
    expect(scrubbed.sanitized).not.toContain("alice@acme.io");
    expect(scrubbed.sanitized).not.toContain("(415) 555-0142");
    expect(scrubbed.sanitized).toContain("[email redacted]");
  });

  it("rejects oversized images before calling a provider", async () => {
    vi.mocked(instanceCanUseBedrock).mockResolvedValue(true);
    const huge = Buffer.alloc(4 * 1024 * 1024 + 1);
    await expect(
      extractTextFromImage(huge, "image/png", "huge.png"),
    ).rejects.toBeInstanceOf(ImageExtractError);
  });
});
