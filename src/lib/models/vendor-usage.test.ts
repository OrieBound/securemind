import { describe, expect, it } from "vitest";
import {
  createAnthropicUsageTracker,
  parseOpenAiSseStream,
  usageFromGeminiChunk,
  usageFromOpenAiChunk,
  type VendorUsage,
} from "./vendor-stream";

function sse(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(lines.map(l => `data: ${l}\n\n`).join("")));
      controller.close();
    },
  });
}

describe("vendor token usage", () => {
  it("reads usage from the final OpenAI-compatible chunk while still yielding text", async () => {
    const seen: VendorUsage[] = [];
    const out: string[] = [];
    const body = sse([
      JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }),
      "[DONE]",
    ]);
    for await (const delta of parseOpenAiSseStream(body, u => seen.push(u))) out.push(delta);
    expect(out.join("")).toBe("Hello");
    expect(seen).toEqual([{ promptTokens: 12, completionTokens: 3 }]);
  });

  it("works without a usage callback and ignores chunks with no usage", async () => {
    const out: string[] = [];
    const body = sse([JSON.stringify({ choices: [{ delta: { content: "x" } }], usage: null })]);
    for await (const delta of parseOpenAiSseStream(body)) out.push(delta);
    expect(out).toEqual(["x"]);
    expect(usageFromOpenAiChunk({ usage: null })).toBeNull();
    expect(usageFromOpenAiChunk({ usage: { prompt_tokens: "9" } })).toBeNull();
  });

  it("combines Anthropic input (message_start) and output (message_delta) tokens", () => {
    const t = createAnthropicUsageTracker();
    expect(t.push({ type: "content_block_delta" })).toBeNull();
    expect(
      t.push({
        type: "message_start",
        message: { usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 1 } },
      }),
    ).toEqual({ promptTokens: 150, completionTokens: 1 });
    expect(t.push({ type: "message_delta", usage: { output_tokens: 42 } })).toEqual({
      promptTokens: 150,
      completionTokens: 42,
    });
  });

  it("returns nothing from Anthropic until input tokens are known", () => {
    const t = createAnthropicUsageTracker();
    expect(t.push({ type: "message_delta", usage: { output_tokens: 7 } })).toBeNull();
  });

  it("counts Gemini thinking tokens as output", () => {
    expect(
      usageFromGeminiChunk({
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
      }),
    ).toEqual({ promptTokens: 10, completionTokens: 50 });
    expect(usageFromGeminiChunk({ candidates: [] })).toBeNull();
    expect(usageFromGeminiChunk({ usageMetadata: { promptTokenCount: 10 } })).toBeNull();
  });
});
