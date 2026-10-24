/**
 * Every chat provider adapter must hand the model the system prompt in the provider's own system
 * channel (never glued onto an old message), and must honour the per-turn reply limit.
 *
 * The app puts per-turn rules in the system prompt (for example "make a downloadable file"), so an
 * adapter that quietly weakens it makes one model behave differently from the rest. This test is what
 * stops a provider from drifting. Network calls are replaced with a recorder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/models/types";
import { MAX_REPLY_TOKENS } from "@/lib/models/types";

vi.mock("@/lib/models/vendor-secrets", () => ({
  resolveVendorApiKey: vi.fn(async () => "test-key"),
}));

const groqCreate = vi.fn();
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: groqCreate } };
  },
}));
vi.mock("@/lib/instance-config", () => ({
  resolveRuntimeSecrets: vi.fn(async () => ({ groqApiKey: "test-key" })),
  getVendorConsentFlags: vi.fn(async () => ({})),
}));

const SYSTEM = "SYSTEM-RULES-MARKER";
const conversation: ChatMessage[] = [
  { role: "system", content: SYSTEM },
  { role: "user", content: "first question" },
  { role: "assistant", content: "first answer" },
  { role: "user", content: "latest question" },
];

type Captured = { url: string; body: Record<string, unknown> };
let captured: Captured[] = [];

function emptySse(): Response {
  return new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  captured = [];
  groqCreate.mockReset();
  groqCreate.mockResolvedValue((async function* () {})());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return url.includes("11434") ? new Response("", { status: 200 }) : emptySse();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function drain(gen: AsyncGenerator<string>) {
  try {
    for await (const _ of gen) void _;
  } catch {
    /* an empty stream may end with an error; the request body is what matters */
  }
}

describe("system prompt reaches the model's system channel", () => {
  it("OpenAI: first message has the system role and the text appears once", async () => {
    const { streamOpenAIChat } = await import("@/lib/models/openai");
    await drain(streamOpenAIChat(conversation, "gpt-test"));
    const msgs = captured[0].body.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM });
    expect(JSON.stringify(msgs.slice(1))).not.toContain(SYSTEM);
  });

  it("Grok: first message has the system role", async () => {
    const { streamXaiChat } = await import("@/lib/models/xai");
    await drain(streamXaiChat(conversation, "grok-test"));
    const msgs = captured[0].body.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM });
  });

  it("Anthropic: system text is the top-level system field, not a message", async () => {
    const { streamAnthropicChat } = await import("@/lib/models/anthropic");
    await drain(streamAnthropicChat(conversation, "claude-test"));
    const body = captured[0].body as { system?: string; messages: Array<{ role: string }> };
    expect(body.system).toBe(SYSTEM);
    expect(body.messages.every(m => m.role !== "system")).toBe(true);
  });

  it("Gemini: system text is systemInstruction, not glued onto the oldest message", async () => {
    const { streamGoogleChat } = await import("@/lib/models/google");
    await drain(streamGoogleChat(conversation, "gemini-test"));
    const body = captured[0].body as { systemInstruction?: { parts: Array<{ text: string }> }; contents: unknown };
    expect(body.systemInstruction?.parts[0].text).toBe(SYSTEM);
    expect(JSON.stringify(body.contents)).not.toContain(SYSTEM);
  });

  it("Ollama: first message has the system role", async () => {
    const { streamOllamaChat } = await import("@/lib/models/ollama");
    await drain(streamOllamaChat(conversation, "llama-test"));
    const call = captured.find(c => c.url.includes("/api/chat"))!;
    const msgs = call.body.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM });
  });

  it("Groq: first message has the system role", async () => {
    const { streamGroqChat } = await import("@/lib/models/groq");
    await drain(streamGroqChat(conversation, "groq-test"));
    const msgs = (groqCreate.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM });
  });
});

describe("the reply limit is honoured and defaults stay as they were", () => {
  it("OpenAI, Grok and Anthropic use max_tokens", async () => {
    const { streamOpenAIChat } = await import("@/lib/models/openai");
    const { streamXaiChat } = await import("@/lib/models/xai");
    const { streamAnthropicChat } = await import("@/lib/models/anthropic");
    for (const stream of [streamOpenAIChat, streamXaiChat, streamAnthropicChat]) {
      captured = [];
      await drain(stream(conversation, "m"));
      expect(captured[0].body.max_tokens).toBe(MAX_REPLY_TOKENS);
      captured = [];
      await drain(stream(conversation, "m", undefined, undefined, undefined, 8192));
      expect(captured[0].body.max_tokens).toBe(8192);
    }
  });

  it("Gemini uses generationConfig.maxOutputTokens only when a limit is given", async () => {
    const { streamGoogleChat } = await import("@/lib/models/google");
    await drain(streamGoogleChat(conversation, "m"));
    expect((captured[0].body as { generationConfig?: unknown }).generationConfig).toBeUndefined();
    captured = [];
    await drain(streamGoogleChat(conversation, "m", undefined, undefined, undefined, 8192));
    expect((captured[0].body as { generationConfig?: { maxOutputTokens: number } }).generationConfig).toEqual({ maxOutputTokens: 8192 });
  });

  it("Ollama uses options.num_predict, keeping 2048 by default", async () => {
    const { streamOllamaChat } = await import("@/lib/models/ollama");
    await drain(streamOllamaChat(conversation, "m"));
    const first = captured.find(c => c.url.includes("/api/chat"))!;
    expect((first.body.options as { num_predict: number }).num_predict).toBe(2048);
    captured = [];
    await drain(streamOllamaChat(conversation, "m", undefined, undefined, 8192));
    const second = captured.find(c => c.url.includes("/api/chat"))!;
    expect((second.body.options as { num_predict: number }).num_predict).toBe(8192);
  });

  it("Groq uses max_tokens", async () => {
    const { streamGroqChat } = await import("@/lib/models/groq");
    await drain(streamGroqChat(conversation, "m"));
    expect((groqCreate.mock.calls[0][0] as { max_tokens: number }).max_tokens).toBe(MAX_REPLY_TOKENS);
    groqCreate.mockClear();
    groqCreate.mockResolvedValue((async function* () {})());
    await drain(streamGroqChat(conversation, "m", undefined, undefined, undefined, 8192));
    expect((groqCreate.mock.calls[0][0] as { max_tokens: number }).max_tokens).toBe(8192);
  });
});
