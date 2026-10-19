/**
 * Two-step verification routes: the public code step of sign-in, and the signed-in routes to
 * check status, set up, verify and turn off. Cognito, identity and the database are mocked.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  available: true,
  identity: {
    userId: "user-1",
    email: "me@example.com",
    role: "member",
    authenticated: true,
    groups: [] as string[],
  } as Record<string, unknown>,
  loginStart: vi.fn(),
  respond: vi.fn(),
  enabled: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  disable: vi.fn(),
  checkPassword: vi.fn(),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { sub: "user-1" } }),
}));
vi.mock("@/lib/user-profile", () => ({ ensureUserProfile: vi.fn(async () => ({})) }));
vi.mock("@/lib/identity", async orig => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  getIdentity: vi.fn(async () => state.identity),
}));
vi.mock("@/lib/cognito", async orig => ({
  ...(await orig<typeof import("@/lib/cognito")>()),
  cognitoMfaAvailable: () => state.available,
  cognitoLoginStart: (...a: unknown[]) => state.loginStart(...a),
  cognitoRespondToMfa: (...a: unknown[]) => state.respond(...a),
  cognitoMfaEnabled: (...a: unknown[]) => state.enabled(...a),
  cognitoMfaBeginSetup: (...a: unknown[]) => state.begin(...a),
  cognitoMfaCompleteSetup: (...a: unknown[]) => state.complete(...a),
  cognitoMfaDisable: (...a: unknown[]) => state.disable(...a),
  cognitoCheckPassword: (...a: unknown[]) => state.checkPassword(...a),
}));

import { MfaError } from "@/lib/cognito";
import { resetRateLimits } from "@/lib/rate-limit";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as loginMfaPost } from "@/app/api/auth/login/mfa/route";
import { GET as statusGet } from "@/app/api/auth/mfa/route";
import { POST as setupPost } from "@/app/api/auth/mfa/setup/route";
import { POST as verifyPost } from "@/app/api/auth/mfa/verify/route";
import { POST as disablePost } from "@/app/api/auth/mfa/disable/route";

const SESSION = "s".repeat(40);
const tokens = { accessToken: "access-token", idToken: "id", refreshToken: "r", expiresIn: 1800 };

function req(method: string, path: string, body?: unknown, signedIn = false) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(signedIn ? { cookie: "sm_access_token=caller-token" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const savedEnv = {
  mode: process.env.AUTH_MODE,
  client: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
};

afterAll(() => {
  for (const [key, value] of [
    ["AUTH_MODE", savedEnv.mode],
    ["COGNITO_CLIENT_ID", savedEnv.client],
    ["COGNITO_ISSUER", savedEnv.issuer],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  resetRateLimits();
  process.env.AUTH_MODE = "cognito";
  process.env.COGNITO_CLIENT_ID = "client-1";
  process.env.COGNITO_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc";
  state.available = true;
  state.identity = { userId: "user-1", email: "me@example.com", role: "member", authenticated: true, groups: [] };
  for (const fn of [state.loginStart, state.respond, state.enabled, state.begin, state.complete, state.disable, state.checkPassword]) {
    fn.mockReset();
  }
});

describe("POST /api/auth/login", () => {
  it("signs in with a cookie when no code is needed", async () => {
    state.loginStart.mockResolvedValue({ kind: "tokens", tokens });
    const res = await loginPost(req("POST", "/api/auth/login", { email: "Me@Example.com", password: "pw" }));
    expect(res.status).toBe(200);
    expect(state.loginStart).toHaveBeenCalledWith("me@example.com", "pw");
    expect(res.headers.get("set-cookie")).toMatch(/sm_access_token=access-token.*HttpOnly.*SameSite=Lax/);
    expect(((await res.json()) as { accessToken: string }).accessToken).toBe("access-token");
  });

  it("asks for a code, and sets no cookie, when two-step verification is on", async () => {
    state.loginStart.mockResolvedValue({ kind: "mfa", session: SESSION });
    const res = await loginPost(req("POST", "/api/auth/login", { email: "me@example.com", password: "pw" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({ mfaRequired: true, session: SESSION });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("gives one generic answer for a wrong password", async () => {
    state.loginStart.mockRejectedValue(new Error("NotAuthorizedException"));
    const res = await loginPost(req("POST", "/api/auth/login", { email: "me@example.com", password: "bad" }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("Invalid email or password.");
  });

  it("requires an email and a password", async () => {
    expect((await loginPost(req("POST", "/api/auth/login", { email: "", password: "" }))).status).toBe(422);
  });
});

describe("POST /api/auth/login/mfa", () => {
  const body = { email: "me@example.com", session: SESSION, code: "123456" };

  it("signs in once the code is right", async () => {
    state.respond.mockResolvedValue(tokens);
    const res = await loginMfaPost(req("POST", "/api/auth/login/mfa", { ...body, code: "123 456" }));
    expect(res.status).toBe(200);
    expect(state.respond).toHaveBeenCalledWith({ email: "me@example.com", session: SESSION, code: "123456" });
    expect(res.headers.get("set-cookie")).toMatch(/sm_access_token=access-token/);
  });

  it("rejects a malformed code before calling Cognito", async () => {
    for (const code of ["", "12345", "1234567", "abcdef", 123456]) {
      const res = await loginMfaPost(req("POST", "/api/auth/login/mfa", { ...body, code }));
      expect(res.status, String(code)).toBe(422);
    }
    expect(state.respond).not.toHaveBeenCalled();
  });

  it("tells the browser to start over when the session is missing or implausible", async () => {
    for (const session of ["", "short", "x".repeat(9000), undefined]) {
      const res = await loginMfaPost(req("POST", "/api/auth/login/mfa", { ...body, session }));
      expect(res.status).toBe(401);
      expect(((await res.json()) as { restart: boolean }).restart).toBe(true);
    }
    expect(state.respond).not.toHaveBeenCalled();
  });

  it("returns a wrong code as a retryable error", async () => {
    state.respond.mockRejectedValue(new MfaError("invalid_code", "That code did not work.", 422));
    const res = await loginMfaPost(req("POST", "/api/auth/login/mfa", body));
    expect(res.status).toBe(422);
    const out = (await res.json()) as { code: string; restart: boolean };
    expect(out.code).toBe("invalid_code");
    expect(out.restart).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns an expired session as start-over, and throttling as 429", async () => {
    state.respond.mockRejectedValueOnce(new MfaError("session_expired", "expired", 401));
    const expired = await loginMfaPost(req("POST", "/api/auth/login/mfa", body));
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as { restart: boolean }).restart).toBe(true);

    state.respond.mockRejectedValueOnce(new MfaError("rate_limited", "slow down", 429));
    expect((await loginMfaPost(req("POST", "/api/auth/login/mfa", body))).status).toBe(429);
  });

  it("is off where Cognito cannot do codes", async () => {
    state.available = false;
    expect((await loginMfaPost(req("POST", "/api/auth/login/mfa", body))).status).toBe(501);
    expect(state.respond).not.toHaveBeenCalled();
  });
});

describe("signed-in routes need a real Cognito session", () => {
  it("explain, rather than fail, where two-step verification is unavailable", async () => {
    state.available = false;
    const status = await statusGet(req("GET", "/api/auth/mfa", undefined, true));
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ available: false, enabled: false, recommended: false });

    for (const call of [
      () => setupPost(req("POST", "/api/auth/mfa/setup", {}, true)),
      () => verifyPost(req("POST", "/api/auth/mfa/verify", { code: "123456" }, true)),
      () => disablePost(req("POST", "/api/auth/mfa/disable", { password: "pw" }, true)),
    ]) {
      expect((await call()).status).toBe(501);
    }
    expect(state.begin).not.toHaveBeenCalled();
  });

  it("refuse a caller with no session cookie, and never reach Cognito", async () => {
    for (const call of [
      () => setupPost(req("POST", "/api/auth/mfa/setup", {})),
      () => verifyPost(req("POST", "/api/auth/mfa/verify", { code: "123456" })),
      () => disablePost(req("POST", "/api/auth/mfa/disable", { password: "pw" })),
      () => statusGet(req("GET", "/api/auth/mfa")),
    ]) {
      expect((await call()).status).toBe(401);
    }
    expect(state.begin).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.disable).not.toHaveBeenCalled();
  });

  it("refuse an identity that is not authenticated", async () => {
    state.identity = { ...state.identity, authenticated: false };
    expect((await setupPost(req("POST", "/api/auth/mfa/setup", {}, true))).status).toBe(401);
  });
});

describe("GET /api/auth/mfa", () => {
  it("reports on or off, and recommends it only to people who manage the install", async () => {
    state.enabled.mockResolvedValue(false);
    const member = await (await statusGet(req("GET", "/api/auth/mfa", undefined, true))).json();
    expect(member).toEqual({ available: true, enabled: false, recommended: false });

    state.identity = { ...state.identity, role: "admin" };
    const admin = await (await statusGet(req("GET", "/api/auth/mfa", undefined, true))).json();
    expect(admin).toEqual({ available: true, enabled: false, recommended: true });

    state.enabled.mockResolvedValue(true);
    const enabled = await (await statusGet(req("GET", "/api/auth/mfa", undefined, true))).json();
    expect(enabled).toEqual({ available: true, enabled: true, recommended: false });
  });

  it("uses the caller's own token and is never cached", async () => {
    state.enabled.mockResolvedValue(true);
    const res = await statusGet(req("GET", "/api/auth/mfa", undefined, true));
    expect(state.enabled).toHaveBeenCalledWith("caller-token");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/auth/mfa/setup", () => {
  it("returns a link for the QR code and a typeable secret", async () => {
    state.enabled.mockResolvedValue(false);
    state.begin.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP" });
    const res = await setupPost(req("POST", "/api/auth/mfa/setup", {}, true));
    expect(res.status).toBe(200);
    expect(state.begin).toHaveBeenCalledWith("caller-token");
    const out = (await res.json()) as { otpauthUri: string; secret: string };
    expect(out.otpauthUri).toBe(
      "otpauth://totp/SecureMind:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=SecureMind&algorithm=SHA1&digits=6&period=30",
    );
    expect(out.secret).toBe("JBSW Y3DP EHPK 3PXP");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("will not replace a device that is already set up", async () => {
    state.enabled.mockResolvedValue(true);
    const res = await setupPost(req("POST", "/api/auth/mfa/setup", {}, true));
    expect(res.status).toBe(409);
    expect(state.begin).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/mfa/verify", () => {
  it("turns it on when the code is right", async () => {
    state.complete.mockResolvedValue(undefined);
    const res = await verifyPost(req("POST", "/api/auth/mfa/verify", { code: "123 456" }, true));
    expect(res.status).toBe(200);
    expect(state.complete).toHaveBeenCalledWith("caller-token", "123456");
    expect(await res.json()).toEqual({ ok: true, enabled: true });
  });

  it("rejects a malformed code without calling Cognito", async () => {
    for (const code of ["", "12345", "abcdef", undefined]) {
      expect((await verifyPost(req("POST", "/api/auth/mfa/verify", { code }, true))).status).toBe(422);
    }
    expect(state.complete).not.toHaveBeenCalled();
  });

  it("returns a wrong code as a retryable error and stays off", async () => {
    state.complete.mockRejectedValue(new MfaError("invalid_code", "That code did not work.", 422));
    const res = await verifyPost(req("POST", "/api/auth/mfa/verify", { code: "000000" }, true));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_code");
  });
});

describe("POST /api/auth/mfa/disable", () => {
  it("turns it off after checking the password", async () => {
    state.checkPassword.mockResolvedValue(true);
    state.disable.mockResolvedValue(undefined);
    const res = await disablePost(req("POST", "/api/auth/mfa/disable", { password: "pw" }, true));
    expect(res.status).toBe(200);
    expect(state.checkPassword).toHaveBeenCalledWith("me@example.com", "pw");
    expect(state.disable).toHaveBeenCalledWith("caller-token");
    expect(await res.json()).toEqual({ ok: true, enabled: false });
  });

  it("leaves it on when the password is wrong", async () => {
    state.checkPassword.mockResolvedValue(false);
    const res = await disablePost(req("POST", "/api/auth/mfa/disable", { password: "bad" }, true));
    expect(res.status).toBe(403);
    expect(state.disable).not.toHaveBeenCalled();
  });

  it("needs a password at all", async () => {
    const res = await disablePost(req("POST", "/api/auth/mfa/disable", {}, true));
    expect(res.status).toBe(422);
    expect(state.checkPassword).not.toHaveBeenCalled();
  });

  it("checks the password of the signed-in account, never an email sent in the body", async () => {
    state.checkPassword.mockResolvedValue(false);
    await disablePost(
      req("POST", "/api/auth/mfa/disable", { password: "pw", email: "victim@example.com", userId: "user-2" }, true),
    );
    expect(state.checkPassword).toHaveBeenCalledWith("me@example.com", "pw");
  });
});

describe("one user cannot act on another's two-step verification", () => {
  it("every signed-in route uses only the caller's token, and takes no user identifier", async () => {
    state.enabled.mockResolvedValue(false);
    state.begin.mockResolvedValue({ secret: "AAAA" });
    state.complete.mockResolvedValue(undefined);
    state.checkPassword.mockResolvedValue(true);
    state.disable.mockResolvedValue(undefined);
    const attacker = { userId: "user-2", username: "victim", email: "victim@example.com", token: "victim-token" };

    await statusGet(req("GET", "/api/auth/mfa?userId=user-2", undefined, true));
    await setupPost(req("POST", "/api/auth/mfa/setup", attacker, true));
    await verifyPost(req("POST", "/api/auth/mfa/verify", { ...attacker, code: "123456" }, true));
    await disablePost(req("POST", "/api/auth/mfa/disable", { ...attacker, password: "pw" }, true));

    for (const fn of [state.enabled, state.begin, state.complete, state.disable]) {
      for (const call of fn.mock.calls) expect(call[0]).toBe("caller-token");
    }
  });
});
