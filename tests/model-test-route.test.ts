/**
 * The model reachability check spends money, so it is admin-only, and it must
 * report on the model that was actually asked for — never a fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const resolveAllowedModel = vi.fn();
const streamBedrockChat = vi.fn();
const streamGroqChat = vi.fn();
const streamOllamaChat = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return { ...actual, getIdentity: (...a: unknown[]) => getIdentity(...a) };
});
vi.mock("@/lib/models/allowlist", () => ({
  resolveAllowedModel: (...a: unknown[]) => resolveAllowedModel(...a),
}));
vi.mock("@/lib/models/bedrock", () => ({
  streamBedrockChat: (...a: unknown[]) => streamBedrockChat(...a),
}));
vi.mock("@/lib/models/groq", () => ({
  streamGroqChat: (...a: unknown[]) => streamGroqChat(...a),
}));
vi.mock("@/lib/models/ollama", () => ({
  streamOllamaChat: (...a: unknown[]) => streamOllamaChat(...a),
}));

async function* yields(...chunks: string[]) {
  for (const c of chunks) yield c;
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getIdentity.mockResolvedValue({
    userId: "admin-1",
    authenticated: true,
    role: "admin",
    groups: ["Admin"],
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("POST /api/models/test", () => {
  it("refuses a member — the check is billable", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: [],
    });
    const { POST } = await import("@/app/api/models/test/route");
    const res = await POST(post({ modelId: "amazon.nova-micro-v1:0" }));
    expect(res.status).toBe(403);
    expect(resolveAllowedModel).not.toHaveBeenCalled();
  });

  it("refuses a model that is not on the server allowlist", async () => {
    resolveAllowedModel.mockResolvedValue(null);
    const { POST } = await import("@/app/api/models/test/route");
    const res = await POST(post({ modelId: "made-up" }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_allowlisted");
    expect(streamBedrockChat).not.toHaveBeenCalled();
  });

  it("calls the requested provider directly, with no fallback", async () => {
    resolveAllowedModel.mockResolvedValue({
      provider: "bedrock",
      model: "amazon.nova-micro-v1:0",
    });
    streamBedrockChat.mockReturnValue(yields("OK"));

    const { POST } = await import("@/app/api/models/test/route");
    const body = await (await POST(post({ modelId: "amazon.nova-micro-v1:0" }))).json();

    expect(body.ok).toBe(true);
    expect(body.provider).toBe("bedrock");
    expect(body.sample).toBe("OK");
    // A Groq fallback here would report success for an unusable Bedrock model.
    expect(streamGroqChat).not.toHaveBeenCalled();
    expect(streamOllamaChat).not.toHaveBeenCalled();
  });

  it("turns an access-denied failure into an actionable reason", async () => {
    resolveAllowedModel.mockResolvedValue({ provider: "bedrock", model: "anthropic.x" });
    streamBedrockChat.mockImplementation(() => {
      throw Object.assign(new Error("User is not authorized to perform bedrock:InvokeModel"), {
        name: "AccessDeniedException",
      });
    });

    const { POST } = await import("@/app/api/models/test/route");
    const body = await (await POST(post({ modelId: "anthropic.x" }))).json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe("access_denied");
    expect(body.remediation).toMatch(/model access|InvokeModelWithResponseStream/i);
  });

  it("flags a retired model id distinctly from a permissions problem", async () => {
    resolveAllowedModel.mockResolvedValue({ provider: "bedrock", model: "anthropic.old" });
    streamBedrockChat.mockImplementation(() => {
      throw Object.assign(new Error("This model version has reached the end of its life."), {
        name: "ResourceNotFoundException",
      });
    });

    const { POST } = await import("@/app/api/models/test/route");
    const body = await (await POST(post({ modelId: "anthropic.old" }))).json();

    expect(body.code).toBe("not_available");
  });
});
