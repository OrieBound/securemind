import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/instance-config", () => ({
  resolveRuntimeSecrets: vi.fn(async () => ({
    primaryProvider: "auto",
    externalRiskAcknowledged: true,
    groqApiKey: "gsk_test",
  })),
}));

vi.mock("@/lib/models/groq", () => ({
  streamGroqChat: vi.fn(),
  hasGroqRuntime: vi.fn(async () => true),
  getGroqUnavailableReason: vi.fn(async () => null),
  GROQ_NOT_CONFIGURED_MESSAGE: "Groq is not configured.",
  VENDOR_RISK_REQUIRED_CODE: "VENDOR_RISK_REQUIRED",
  VENDOR_RISK_REQUIRED_MESSAGE: "Vendor risk required",
}));

vi.mock("@/lib/models/ollama", () => ({
  streamOllamaChat: vi.fn(),
  checkOllamaModel: vi.fn(async () => null),
  resolveOllamaChatModel: vi.fn((model: string) => model),
}));

vi.mock("@/lib/models/bedrock", () => ({
  streamBedrockChat: vi.fn(),
  isBedrockConfigured: vi.fn(async () => false),
  bedrockBlockReason: vi.fn(async () => "off"),
}));

vi.mock("@/lib/models/openai", () => ({
  streamOpenAIChat: vi.fn(),
  hasOpenAIRuntime: vi.fn(async () => false),
}));

vi.mock("@/lib/models/anthropic", () => ({
  streamAnthropicChat: vi.fn(),
  hasAnthropicRuntime: vi.fn(async () => false),
}));

vi.mock("@/lib/models/google", () => ({
  streamGoogleChat: vi.fn(),
  hasGoogleRuntime: vi.fn(async () => false),
}));

vi.mock("@/lib/models/xai", () => ({
  streamXaiChat: vi.fn(),
  hasXaiRuntime: vi.fn(async () => false),
}));

import { streamGroqChat } from "@/lib/models/groq";
import { streamOllamaChat } from "@/lib/models/ollama";
import { streamChat } from "@/lib/models/provider";

const groqStream = vi.mocked(streamGroqChat);
const ollamaStream = vi.mocked(streamOllamaChat);

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const delta of gen) out += delta;
  return out;
}

describe("streamChat Groq vs Ollama", () => {
  beforeEach(() => {
    groqStream.mockReset();
    ollamaStream.mockReset();
  });

  it("does not replace a refused Groq chat call with Ollama", async () => {
    groqStream.mockImplementation(async function* () {
      throw new Error(
        '403 {"error":{"message":"Access denied. Please check your network settings."}}',
      );
    });

    await expect(collect(streamChat({
      messages: [{ role: "user", content: "Hello there" }],
      model: "llama-3.3-70b-versatile",
      provider: "groq",
      tier: "Micro",
    }))).rejects.toThrow(/Whisper/);

    expect(ollamaStream).not.toHaveBeenCalled();
  });

  it("stays on Groq when the chat call succeeds", async () => {
    groqStream.mockImplementation(async function* () {
      yield "Hello from Groq";
    });

    await expect(collect(streamChat({
      messages: [{ role: "user", content: "Hello there" }],
      model: "llama-3.3-70b-versatile",
      provider: "groq",
    }))).resolves.toBe("Hello from Groq");

    expect(ollamaStream).not.toHaveBeenCalled();
  });
});
