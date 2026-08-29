/**
 * /api/transcribe forwards audio to an external provider using a server-held
 * key. It must never serve an unauthenticated caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ db: {} }));

const resolveRuntimeSecrets = vi.fn();
vi.mock("@/lib/instance-config", () => ({
  resolveRuntimeSecrets: (...args: unknown[]) => resolveRuntimeSecrets(...args),
}));

const saved: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveRuntimeSecrets.mockResolvedValue({ groqApiKey: null });
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
});

function post(body?: BodyInit) {
  return new NextRequest("http://localhost/api/transcribe", { method: "POST", body });
}

describe("POST /api/transcribe", () => {
  it("rejects an unauthenticated caller when fallback is disabled", async () => {
    setEnv("AUTH_MODE", "cognito");
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", "false");
    const { POST } = await import("@/app/api/transcribe/route");
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(resolveRuntimeSecrets).not.toHaveBeenCalled();
  });

  it("does not fall back to a raw env key when no provider is configured", async () => {
    setEnv("AUTH_MODE", "local");
    setEnv("GROQ_API_KEY", "gsk_should_not_be_used_directly");
    const { POST } = await import("@/app/api/transcribe/route");
    const res = await POST(post());
    expect(res.status).toBe(503);
    expect(resolveRuntimeSecrets).toHaveBeenCalled();
  });
});
