import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_MODEL_ENHANCED,
  LOCAL_MODEL_LIGHTWEIGHT,
  LOCAL_MODEL_PREFERRED,
  isAllowedOllamaPull,
  missingOllamaModels,
  pickInstalledChatModel,
  recommendLocalModels,
  type HardwareSnapshot,
} from "@/lib/models/local-recommendations";
import { decideChatRuntime, MODEL_PROVIDER_REQUIRED_CODE } from "@/lib/models/resolve-chat-runtime";
import { selectGroqApiKey } from "@/lib/models/groq";
import { isHostedRuntime, runtimeEdition } from "@/lib/runtime-env";

const modestHw: HardwareSnapshot = {
  cpuCount: 8,
  totalMemGb: 16,
  gpuName: null,
  gpuVramMb: null,
};

function baseInput(over: Partial<Parameters<typeof decideChatRuntime>[0]> = {}) {
  return {
    edition: "local" as const,
    routedProvider: "groq" as const,
    routedModel: "openai/gpt-oss-120b",
    activeMode: "Standard",
    hasImages: false,
    primaryProvider: "auto" as const,
    groqOk: false,
    groqBlock: "missing_key" as const,
    bedrockOk: false,
    bedrockBlock: "No AWS credentials found on this host.",
    ollamaReachable: true,
    ollamaChatModels: [] as string[],
    hardware: modestHw,
    override: null,
    ...over,
  };
}

describe("local Ollama recommendations", () => {
  it("uses an already installed chat model and does not invent a pull", () => {
    const rec = recommendLocalModels(modestHw, ["nomic-embed-text", "llama3.2:3b"]);
    expect(rec.useInstalled).toBe("llama3.2:3b");
    expect(pickInstalledChatModel(["nomic-embed-text"])).toBeNull();
  });

  it("prefers llama3.2:3b among installed tags when a GPU is present", () => {
    expect(pickInstalledChatModel(["gemma3:4b", "llama3.2:3b"], { gpuVramMb: 8192 })).toBe("llama3.2:3b");
  });

  it("prefers the 1B tag on CPU when it is already installed", () => {
    expect(pickInstalledChatModel(
      ["llama3.2:3b", "llama3.2:1b"],
      { gpuVramMb: null },
    )).toBe("llama3.2:1b");
  });

  it("recommends a lightweight tag on constrained RAM", () => {
    const rec = recommendLocalModels({
      cpuCount: 2,
      totalMemGb: 4,
      gpuName: null,
      gpuVramMb: null,
    }, []);
    expect(rec.primary).toBe(LOCAL_MODEL_LIGHTWEIGHT);
    expect(rec.enhanced).toBeNull();
    expect(rec.useInstalled).toBeNull();
  });

  it("offers gemma3:4b as enhanced on capable hardware", () => {
    const rec = recommendLocalModels({
      cpuCount: 16,
      totalMemGb: 32,
      gpuName: "RTX",
      gpuVramMb: 8192,
    }, []);
    expect(rec.primary).toBe(LOCAL_MODEL_PREFERRED);
    expect(rec.enhanced).toBe(LOCAL_MODEL_ENHANCED);
  });

  it("allowlists guided pulls only", () => {
    expect(isAllowedOllamaPull("llama3.2:3b")).toBe(true);
    expect(isAllowedOllamaPull("llama3.2:70b")).toBe(false);
  });

  it("skips Docker/default pulls when the tag is already installed", () => {
    expect(missingOllamaModels(
      ["nomic-embed-text:latest", "llama3.2:3b"],
      ["nomic-embed-text", "llama3.2:3b"],
    )).toEqual([]);
    expect(missingOllamaModels(
      ["nomic-embed-text"],
      ["nomic-embed-text", "llama3.2:3b"],
    )).toEqual(["llama3.2:3b"]);
  });
});

describe("decideChatRuntime", () => {
  it("uses an installed Ollama model when Groq is missing locally", () => {
    const d = decideChatRuntime(baseInput({ ollamaChatModels: ["llama3.2:3b"] }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.provider).toBe("ollama");
      expect(d.model).toBe("llama3.2:3b");
      expect(d.source).toBe("ollama-installed");
    }
  });

  it("does not silently pick Groq on a cloud install without BYOK or Bedrock", () => {
    const d = decideChatRuntime(baseInput({
      edition: "cloud",
      groqOk: false,
      bedrockOk: false,
      ollamaChatModels: ["llama3.2:3b"],
    }));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe(MODEL_PROVIDER_REQUIRED_CODE);
      expect(d.setup.edition).toBe("cloud");
      expect(d.setup.cloud?.recommended).toBe("bedrock");
    }
  });

  it("uses Bedrock on cloud when IAM is ready", () => {
    const d = decideChatRuntime(baseInput({
      edition: "cloud",
      bedrockOk: true,
      bedrockBlock: null,
    }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.provider).toBe("bedrock");
    }
  });

  it("keeps Groq when the operator configured it locally", () => {
    const d = decideChatRuntime(baseInput({ groqOk: true, groqBlock: null }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.provider).toBe("groq");
      expect(d.source).toBe("groq");
    }
  });

  it("blocks with guided setup when nothing is ready", () => {
    const d = decideChatRuntime(baseInput({ ollamaReachable: false }));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe(MODEL_PROVIDER_REQUIRED_CODE);
      expect(d.setup.title).toMatch(/Model provider required/i);
    }
  });

  it("uses an explicit Groq override when Groq is configured", () => {
    const d = decideChatRuntime(baseInput({
      groqOk: true,
      groqBlock: null,
      ollamaChatModels: ["llama3.2:latest"],
      override: { provider: "groq", model: "llama-3.3-70b-versatile" },
    }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.provider).toBe("groq");
      expect(d.model).toBe("llama-3.3-70b-versatile");
      expect(d.source).toBe("override");
    }
  });

  it("does not silently swap a Groq override to Ollama when Groq is missing", () => {
    const d = decideChatRuntime(baseInput({
      groqOk: false,
      groqBlock: "missing_key",
      ollamaChatModels: ["llama3.2:latest"],
      override: { provider: "groq", model: "llama-3.1-8b-instant" },
    }));
    expect(d.ok).toBe(false);
  });

  it("honors a Google override even when Ollama is the live fallback", () => {
    const d = decideChatRuntime(baseInput({
      ollamaChatModels: ["llama3.2:latest"],
      override: { provider: "google", model: "gemini-2.0-flash" },
    }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.provider).toBe("google");
      expect(d.model).toBe("gemini-2.0-flash");
      expect(d.source).toBe("override");
    }
  });
});

describe("hosted Groq key selection", () => {
  const keys = ["AWS_LAMBDA_FUNCTION_NAME", "AMPLIFY_HOSTING", "SECUREMIND_EDITION"] as const;
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  function snap() {
    for (const k of keys) prev[k] = process.env[k];
  }

  it("ignores env Groq on hosted runtimes", () => {
    snap();
    process.env.AWS_LAMBDA_FUNCTION_NAME = "api";
    delete process.env.SECUREMIND_EDITION;
    expect(isHostedRuntime()).toBe(true);
    expect(runtimeEdition()).toBe("cloud");
    expect(selectGroqApiKey({
      groqApiKey: "env-key",
      instanceGroqApiKey: null,
    })).toBeNull();
    expect(selectGroqApiKey({
      groqApiKey: "env-key",
      instanceGroqApiKey: "pasted-key",
    })).toBe("pasted-key");
  });

  it("uses env Groq locally", () => {
    snap();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AMPLIFY_HOSTING;
    process.env.SECUREMIND_EDITION = "local";
    expect(isHostedRuntime()).toBe(false);
    expect(selectGroqApiKey({
      groqApiKey: "env-key",
      instanceGroqApiKey: null,
    })).toBe("env-key");
  });
});
