import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/models/groq", () => ({
  hasGroqRuntime: vi.fn(),
}));

import { hasGroqRuntime } from "@/lib/models/groq";
import { extractTextFromImage, ImageExtractError, isFailedExtractContent } from "./image-extract";
import { scrubPII } from "./pii";

describe("extractTextFromImage", () => {
  const prevKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    vi.mocked(hasGroqRuntime).mockResolvedValue(false);
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevKey;
    vi.restoreAllMocks();
  });

  it("throws when Groq is unavailable so stubs are not indexed", async () => {
    await expect(
      extractTextFromImage(Buffer.from("fake-image-bytes"), "image/png", "console.png"),
    ).rejects.toBeInstanceOf(ImageExtractError);
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
});
