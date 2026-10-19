/**
 * Two-phase tier routing in the chat path (prepareChatTurn).
 *
 * Real code runs for turn policy, routing, evidence floors, evidence selection and the
 * runtime decision. Only the outside world is mocked: database, Ollama, Groq availability,
 * retrieval, the cost cap and analytics.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Hit = {
  id: string;
  content: string;
  category: string;
  similarity: number;
  score: number;
  documentId: string;
  documentName: string;
};

const state = vi.hoisted(() => ({
  capped: false,
  hits: [] as unknown[],
  ollama: { reachable: false, tags: [] as string[] },
  override: null as null | { provider: string; model: string },
  classify: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/models/ollama", async orig => ({
  ...(await orig<typeof import("@/lib/models/ollama")>()),
  probeOllama: async () => state.ollama,
  checkOllamaModel: async () => null,
}));
vi.mock("@/lib/models/bedrock", async orig => ({
  ...(await orig<typeof import("@/lib/models/bedrock")>()),
  bedrockBlockReason: async () => "Amazon Bedrock is not configured.",
}));
vi.mock("@/lib/models/groq", async orig => ({
  ...(await orig<typeof import("@/lib/models/groq")>()),
  hasGroqRuntime: async () => true,
  getGroqUnavailableReason: async () => null,
  classifyComplexityLlm: (...args: unknown[]) => state.classify(...args),
}));
vi.mock("@/lib/instance-config", async orig => ({
  ...(await orig<typeof import("@/lib/instance-config")>()),
  resolveRuntimeSecrets: async () =>
    ({
      primaryProvider: null,
      groqApiKey: "gsk_test",
      instanceGroqApiKey: "gsk_test",
      externalRiskAcknowledged: true,
      bedrockChatModel: null,
    }) as never,
}));
vi.mock("@/lib/models/allowlist", () => ({
  resolveAllowedModel: async (id: string) =>
    state.override && state.override.model === id ? state.override : null,
}));
vi.mock("@/lib/memory", async orig => ({
  ...(await orig<typeof import("@/lib/memory")>()),
  retrieveCombinedContext: async () => ({ documentHits: state.hits, facts: [] }),
}));
vi.mock("@/lib/workspaces/store", async orig => ({
  ...(await orig<typeof import("@/lib/workspaces/store")>()),
  findOwnedWorkspace: async (_user: string, id: string) => ({ id, name: "Mindy Locke", context: null }),
}));
vi.mock("@/lib/documents/persist", () => ({ getPersistedDocument: async () => null }));
vi.mock("@/lib/analytics/write", () => ({ recordInferenceEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/cost-cap", async orig => ({
  ...(await orig<typeof import("@/lib/cost-cap")>()),
  getUserCostCapStatus: async () => ({
    capped: state.capped,
    spentUsd: state.capped ? 10 : 0,
    capUsd: 10,
    resetsAt: "2026-11-01T00:00:00Z",
    warningLevel: state.capped ? "blocked" : "none",
  }),
}));
vi.mock("@/lib/models/local-recommendations", async orig => ({
  ...(await orig<typeof import("@/lib/models/local-recommendations")>()),
  probeHardware: () => ({}) as never,
}));

import { prepareChatTurn } from "@/lib/chat/run-chat-stream";
import { routeModel } from "@/lib/models/router";

function hit(documentId: string, i = 0): Hit {
  return {
    id: `${documentId}-${i}`,
    content: "Notice period is 60 days.",
    category: "document",
    similarity: 0.7,
    score: 0.75,
    documentId,
    documentName: `${documentId}.docx`,
  };
}

async function prepare(message: string, extra: Record<string, unknown> = {}) {
  const r = await prepareChatTurn("alice", {
    message,
    workspaceId: "ws-1",
    history: [],
    ...extra,
  } as never);
  if (!r.ok) throw new Error(`prepare failed: ${JSON.stringify(r.body)}`);
  return r.ctx;
}

beforeEach(() => {
  state.capped = false;
  state.hits = [];
  state.ollama = { reachable: false, tags: [] };
  state.override = null;
  state.classify.mockReset();
  state.classify.mockResolvedValue({ mode: "Standard", wasAuto: false });
});

describe("evidence-aware floors in the chat path", () => {
  it("runs a general question on its message-only tier when no document is found", async () => {
    const ctx = await prepare("What is the capital of Canada?");
    expect(ctx.activeMode).toBe("Light");
    expect(ctx.model).toBe(routeModel("chat", "Light").model);
    expect(ctx.scoreCard.adjustments.some(a => a.id === "evidence-floor")).toBe(false);
  });

  it("raises a document question to Standard and switches to that tier's model", async () => {
    state.hits = [hit("d1", 0), hit("d1", 1)];
    const ctx = await prepare("What is the notice period in the tenancy agreement?");
    expect(ctx.activeMode).toBe("Standard");
    expect(ctx.model).toBe(routeModel("chat", "Standard").model);
    expect(ctx.scoreCard.tier).toBe("Standard");
    expect(ctx.scoreCard.scoreTier).toBe("Light");
    expect(ctx.scoreCard.adjustments.at(-1)).toMatchObject({ id: "evidence-floor", from: "Light", to: "Standard" });
  });

  it("raises a summary of several documents to Plus", async () => {
    state.hits = [hit("d1"), hit("d2"), hit("d3")];
    const ctx = await prepare("Summarize the agreements and list the risks");
    expect(ctx.activeMode).toBe("Plus");
    expect(ctx.model).toBe(routeModel("chat", "Plus").model);
  });

  it("does not raise a general question whose only hits are weak", async () => {
    state.hits = [{ ...hit("d1"), similarity: 0.45, score: 0.5 }];
    const ctx = await prepare("What is the capital of Canada?");
    expect(ctx.activeMode).toBe("Light");
    expect(ctx.turn.shouldRetrieve).toBe(false);
  });

  it("raises a general question when a strong match upgrades it to grounded", async () => {
    state.hits = [hit("d1")];
    const ctx = await prepare("What is the capital of Canada?");
    expect(ctx.turn.shouldRetrieve).toBe(true);
    expect(ctx.activeMode).toBe("Standard");
  });

  it("keeps the first-pass model, and says why, when the higher tier would breach the cost cap", async () => {
    state.capped = true;
    state.ollama = { reachable: true, tags: ["llama3.2:3b", "nomic-embed-text"] };
    state.override = { provider: "ollama", model: "llama3.2:3b" };
    state.hits = [hit("d1"), hit("d1", 1)];
    const ctx = await prepare("What is the notice period in the tenancy agreement?", {
      modelOverrides: { Light: "llama3.2:3b" },
    });
    expect(ctx.provider).toBe("ollama");
    expect(ctx.activeMode).toBe("Light");
    const note = ctx.scoreCard.adjustments.at(-1);
    expect(note).toMatchObject({ id: "not-applied" });
    expect(note?.label).toMatch(/cost cap/);
  });

  it("never lowers a tier and leaves a social turn on Micro", async () => {
    state.hits = [hit("d1")];
    const ctx = await prepare("thanks");
    expect(ctx.activeMode).toBe("Micro");
    expect(ctx.scoreCard.adjustments.some(a => a.id === "evidence-floor")).toBe(false);
  });

  it("records a turn-policy Micro on the score card", async () => {
    const ctx = await prepare("how are you doing");
    expect(ctx.activeMode).toBe("Micro");
    expect(ctx.scoreCard.tier).toBe("Micro");
    expect(ctx.scoreCard.adjustments.some(a => a.id === "turn-policy")).toBe(true);
  });
});

describe("terse and follow-up document questions", () => {
  it("searches for a terse fragment and answers it from the document on Standard", async () => {
    state.hits = [hit("d1"), hit("d1", 1)];
    const ctx = await prepare("notice period?");
    expect(ctx.turn.shouldRetrieve).toBe(true);
    expect(ctx.activeMode).toBe("Standard");
  });

  it("still asks to clarify a terse fragment when nothing matches", async () => {
    const ctx = await prepare("notice period?");
    expect(ctx.turn.shouldRetrieve).toBe(false);
    expect(ctx.turn.mode).toBe("ambiguous");
  });
});

describe("score card in the response context", () => {
  it("carries the card, whose tier is the tier that ran", async () => {
    state.hits = [hit("d1")];
    const ctx = await prepare("What is the notice period in the tenancy agreement?");
    expect(ctx.scoreCard.tier).toBe(ctx.activeMode);
    expect(ctx.scoreCard.v).toBe(1);
    expect(JSON.stringify(ctx.scoreCard)).not.toContain("tenancy");
  });

  it("carries the tie-break cost so it is added to the turn's recorded cost", async () => {
    state.classify.mockResolvedValue({
      mode: "Standard",
      wasAuto: true,
      model: "llama-3.1-8b-instant",
      usage: { promptTokens: 300, completionTokens: 2 },
    });
    const ctx = await prepare("can you give me a hand with the thing we were talking about earlier");
    expect(state.classify).toHaveBeenCalledTimes(1);
    expect(ctx.scoreCard.classifier.used).toBe(true);
    expect(ctx.scoreCard.classifier.costUsd).toBeGreaterThan(0);
  });
});
