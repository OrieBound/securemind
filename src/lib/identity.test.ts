import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { assertAccessTokenClaims, getIdentity, LOCAL_USER_ID, roleFromGroups } from "./identity";

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
    expect(id.role).toBe("super_admin");
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

describe("roleFromGroups", () => {
  it("maps Owner to Super Admin and Admin/Operator to Admin", () => {
    expect(roleFromGroups(["Owner"])).toBe("super_admin");
    expect(roleFromGroups(["Admin"])).toBe("admin");
    expect(roleFromGroups(["admin"])).toBe("admin");
    expect(roleFromGroups(["Operator"])).toBe("admin");
    expect(roleFromGroups(["Member"])).toBe("member");
    expect(roleFromGroups([])).toBe("member");
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
    expect(id.role).toBe("member");
  });

  it("maps cognito:groups Admin to admin role", async () => {
    setEnv("AUTH_MODE", "jwt-hs256");
    setEnv("AUTH_DEV_JWT_SECRET", secret);
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", "false");
    const token = await new SignJWT({ "cognito:groups": ["Admin"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("admin-user")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    const id = await getIdentity(new Request("http://localhost/api/x", {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(id.role).toBe("admin");
    expect(id.groups).toContain("Admin");
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

describe("getIdentity — production fails closed", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    delete process.env.ALLOW_INSECURE_LOCAL_IDENTITY;
  });
  const prod = () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  };

  it("refuses the local identity in production unless explicitly allowed", async () => {
    prod();
    setEnv("AUTH_MODE", "local");
    await expect(getIdentity(new Request("http://x/api/a"))).rejects.toMatchObject({ status: 503 });
    process.env.ALLOW_INSECURE_LOCAL_IDENTITY = "true";
    expect((await getIdentity(new Request("http://x/api/a"))).userId).toBe(LOCAL_USER_ID);
  });

  it("rejects a missing token in cognito mode when the fallback variable is unset", async () => {
    prod();
    setEnv("AUTH_MODE", "cognito");
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", undefined);
    setEnv("COGNITO_ISSUER", "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x");
    await expect(getIdentity(new Request("http://x/api/a"))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a forged token in cognito mode when the fallback variable is unset", async () => {
    prod();
    setEnv("AUTH_MODE", "cognito");
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", undefined);
    setEnv("COGNITO_ISSUER", "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x");
    const req = new Request("http://x/api/a", { headers: { authorization: "Bearer forged.token.value" } });
    await expect(getIdentity(req)).rejects.toMatchObject({ status: 401 });
  });
});

describe("assertAccessTokenClaims", () => {
  const aws = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x";
  const floci = "http://floci:4566/pool";
  const ok = { token_use: "access", client_id: "cid" };

  it("accepts an access token from the configured client", () => {
    expect(() => assertAccessTokenClaims(ok, { clientId: "cid", issuer: aws })).not.toThrow();
  });
  it("rejects an ID token", () => {
    expect(() => assertAccessTokenClaims({ token_use: "id", aud: "cid" }, { clientId: "cid", issuer: aws })).toThrow();
    expect(() => assertAccessTokenClaims({ token_use: "id" }, { clientId: "cid", issuer: floci })).toThrow();
  });
  it("rejects a token from another client or without client_id", () => {
    expect(() => assertAccessTokenClaims({ ...ok, client_id: "other" }, { clientId: "cid", issuer: aws })).toThrow();
    expect(() => assertAccessTokenClaims({ token_use: "access" }, { clientId: "cid", issuer: aws })).toThrow();
  });
  it("fails closed on real Cognito when no client id is configured or token_use is missing", () => {
    expect(() => assertAccessTokenClaims(ok, { issuer: aws })).toThrow();
    expect(() => assertAccessTokenClaims({ client_id: "cid" }, { clientId: "cid", issuer: aws })).toThrow();
  });
});

describe("getIdentity — inactive accounts", () => {
  it("refuses a suspended account even when the local fallback is allowed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/user-profile", () => ({ getUserProfile: async () => ({ status: "suspended" }) }));
    vi.doMock("jose", async () => {
      const real = await vi.importActual<typeof import("jose")>("jose");
      return { ...real, createRemoteJWKSet: () => ({}), jwtVerify: async () => ({ payload: { sub: "u1", token_use: "access", client_id: "cid" } }) };
    });
    setEnv("AUTH_MODE", "cognito");
    setEnv("AUTH_ALLOW_LOCAL_FALLBACK", "true");
    setEnv("COGNITO_ISSUER", "http://floci:4566/pool");
    setEnv("COGNITO_CLIENT_ID", "cid");
    const { getIdentity: fresh } = await import("./identity");
    const req = new Request("http://x/api/a", { headers: { authorization: "Bearer a.b.c" } });
    await expect(fresh(req)).rejects.toMatchObject({ status: 403 });
    vi.doUnmock("@/lib/user-profile");
    vi.doUnmock("jose");
    vi.resetModules();
  });
});
