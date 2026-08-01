import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { getIdentity, LOCAL_USER_ID } from "./identity";

const ENV_KEYS = [
  "AUTH_MODE",
  "AUTH_ALLOW_LOCAL_FALLBACK",
  "AUTH_DEV_JWT_SECRET",
  "COGNITO_ISSUER",
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key in saved) {
      const v = saved[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
      delete saved[key];
    }
  }
});

describe("getIdentity — local mode (default)", () => {
  it("returns the fixed local identity", async () => {
    setEnv("AUTH_MODE", "local");
    const id = await getIdentity(new Request("http://localhost/api/anything"));
    expect(id.userId).toBe(LOCAL_USER_ID);
    expect(id.authenticated).toBe(false);
  });

  it("ignores a userId in the query string", async () => {
    setEnv("AUTH_MODE", "local");
    const id = await getIdentity(new Request("http://localhost/api/x?userId=attacker"));
    expect(id.userId).toBe(LOCAL_USER_ID);
  });

  it("ignores a client-supplied identity header and forged bearer", async () => {
    setEnv("AUTH_MODE", "local");
    const id = await getIdentity(new Request("http://localhost/api/x", {
      headers: { "x-user-id": "attacker", authorization: "Bearer forged" },
    }));
    expect(id.userId).toBe(LOCAL_USER_ID);
    expect(id.authenticated).toBe(false);
  });

  it("ignores sm_access_token cookie in local mode", async () => {
    setEnv("AUTH_MODE", "local");
    const id = await getIdentity(new Request("http://localhost/api/x", {
      headers: { cookie: "sm_access_token=forged" },
    }));
    expect(id.userId).toBe(LOCAL_USER_ID);
    expect(id.authenticated).toBe(false);
  });

  it("ignores a userId in the request body", async () => {
    setEnv("AUTH_MODE", "local");
    const id = await getIdentity(new Request("http://localhost/api/x", {
      method: "POST",
      body: JSON.stringify({ userId: "attacker" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(id.userId).toBe(LOCAL_USER_ID);
  });

  it("does not consume the request body", async () => {
    setEnv("AUTH_MODE", "local");
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    await getIdentity(req);
    await expect(req.json()).resolves.toEqual({ message: "hello" });
  });
});

describe("getIdentity — jwt-hs256 mode", () => {
  const secret = "test-dev-secret-please-rotate";

  async function mint(sub: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
  }

  it("accepts a valid HS256 bearer token", async () => {
    setEnv("AUTH_MODE", "jwt-hs256");
    setEnv("AUTH_DEV_JWT_SECRET", secret);
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", "false");
    const token = await mint("user-abc");
    const id = await getIdentity(new Request("http://localhost/api/x", {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(id.userId).toBe("user-abc");
    expect(id.authenticated).toBe(true);
  });

  it("falls back to local when token is missing and fallback is allowed", async () => {
    setEnv("AUTH_MODE", "jwt-hs256");
    setEnv("AUTH_DEV_JWT_SECRET", secret);
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", "true");
    const id = await getIdentity(new Request("http://localhost/api/x"));
    expect(id.userId).toBe(LOCAL_USER_ID);
    expect(id.authenticated).toBe(false);
  });
});
