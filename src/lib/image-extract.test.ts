import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/models/groq", () => ({
  isGroqAvailable: vi.fn(),
}));

import { isGroqAvailable } from "@/lib/models/groq";
import { extractTextFromImage } from "./image-extract";
import { scrubPII } from "./pii";

describe("extractTextFromImage", () => {
  const prevKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    vi.mocked(isGroqAvailable).mockReturnValue(false);
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevKey;
    vi.restoreAllMocks();
  });

  it("returns a searchable stub when Groq is unavailable", async () => {
    const text = await extractTextFromImage(
      Buffer.from("fake-image-bytes"),
      "image/png",
      "console.png",
    );
    expect(text).toContain("Image: console.png");
    expect(text).toContain("no GROQ_API_KEY");
    expect(text).toContain("Knowledge library");
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
