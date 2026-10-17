import { beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-cognito-identity-provider", async orig => ({
  ...(await orig<typeof import("@aws-sdk/client-cognito-identity-provider")>()),
  CognitoIdentityProviderClient: class {
    send = aws.send;
  },
}));

import {
  MfaError,
  cognitoCheckPassword,
  cognitoLogin,
  cognitoLoginStart,
  cognitoMfaAvailable,
  cognitoMfaBeginSetup,
  cognitoMfaCompleteSetup,
  cognitoMfaDisable,
  cognitoMfaEnabled,
  cognitoRespondToMfa,
  mapMfaError,
} from "./cognito";

type Sent = { name: string; input: Record<string, unknown> };
const sent = (): Sent[] =>
  aws.send.mock.calls.map(([cmd]) => ({ name: cmd.constructor.name, input: cmd.input as Record<string, unknown> }));

function awsError(name: string) {
  const err = new Error(`secret detail from ${name}`);
  err.name = name;
  return err;
}

const tokens = { AccessToken: "access", IdToken: "id", RefreshToken: "refresh", ExpiresIn: 1800 };
const saved = {
  id: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  pool: process.env.COGNITO_USER_POOL_ID,
};

beforeEach(() => {
  aws.send.mockReset();
  process.env.COGNITO_CLIENT_ID = "client-1";
  process.env.COGNITO_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc";
  delete process.env.COGNITO_USER_POOL_ID;
});

describe("sign-in, first step", () => {
  it("returns tokens when no code is needed", async () => {
    aws.send.mockResolvedValue({ AuthenticationResult: tokens });
    const step = await cognitoLoginStart("a@example.com", "pw");
    expect(step).toEqual({
      kind: "tokens",
      tokens: { accessToken: "access", idToken: "id", refreshToken: "refresh", expiresIn: 1800 },
    });
    expect(sent()[0].name).toBe("InitiateAuthCommand");
  });

  it("asks for a code, with the session, when two-step verification is on", async () => {
    aws.send.mockResolvedValue({ ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "session-abc" });
    expect(await cognitoLoginStart("a@example.com", "pw")).toEqual({ kind: "mfa", session: "session-abc" });
  });

  it("still rejects any other challenge, as before", async () => {
    aws.send.mockResolvedValue({ ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "s" });
    await expect(cognitoLoginStart("a@example.com", "pw")).rejects.toThrow(/NEW_PASSWORD_REQUIRED/);
  });

  it("keeps cognitoLogin's old contract: tokens, or a thrown error if a code is needed", async () => {
    aws.send.mockResolvedValueOnce({ AuthenticationResult: tokens });
    expect((await cognitoLogin("a@example.com", "pw")).accessToken).toBe("access");
    aws.send.mockResolvedValueOnce({ ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s" });
    await expect(cognitoLogin("a@example.com", "pw")).rejects.toThrow(/SOFTWARE_TOKEN_MFA/);
  });
});

describe("sign-in, second step", () => {
  it("sends the code and session to Cognito and returns tokens", async () => {
    aws.send.mockResolvedValue({ AuthenticationResult: tokens });
    const out = await cognitoRespondToMfa({ email: "a@example.com", session: "s".repeat(30), code: "123456" });
    expect(out.accessToken).toBe("access");
    expect(sent()[0]).toEqual({
      name: "RespondToAuthChallengeCommand",
      input: {
        ClientId: "client-1",
        ChallengeName: "SOFTWARE_TOKEN_MFA",
        Session: "s".repeat(30),
        ChallengeResponses: { USERNAME: "a@example.com", SOFTWARE_TOKEN_MFA_CODE: "123456" },
      },
    });
  });

  it.each([
    ["CodeMismatchException", "invalid_code", 422],
    ["ExpiredCodeException", "invalid_code", 422],
    ["NotAuthorizedException", "session_expired", 401],
    ["TooManyRequestsException", "rate_limited", 429],
    ["LimitExceededException", "rate_limited", 429],
    ["SomethingNewException", "unavailable", 503],
  ])("maps %s to %s", async (name, code, status) => {
    aws.send.mockRejectedValue(awsError(name));
    const err = await cognitoRespondToMfa({ email: "a@example.com", session: "s".repeat(30), code: "000000" }).catch(e => e);
    expect(err).toBeInstanceOf(MfaError);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it("never passes the provider's message through to the user", async () => {
    aws.send.mockRejectedValue(awsError("CodeMismatchException"));
    const err = await cognitoRespondToMfa({ email: "a@example.com", session: "s".repeat(30), code: "000000" }).catch(e => e);
    expect(err.message).not.toContain("secret detail");
  });

  it("fails clearly if Cognito returns neither tokens nor an error", async () => {
    aws.send.mockResolvedValue({});
    const err = await cognitoRespondToMfa({ email: "a@example.com", session: "s".repeat(30), code: "123456" }).catch(e => e);
    expect(err.code).toBe("unavailable");
  });
});

describe("setting up", () => {
  it("asks Cognito for a secret using the caller's own access token", async () => {
    aws.send.mockResolvedValue({ SecretCode: "JBSWY3DPEHPK3PXP" });
    expect(await cognitoMfaBeginSetup("my-token")).toEqual({ secret: "JBSWY3DPEHPK3PXP" });
    expect(sent()[0]).toEqual({ name: "AssociateSoftwareTokenCommand", input: { AccessToken: "my-token" } });
  });

  it("turns it on only after the code is verified, then makes it the preferred method", async () => {
    aws.send.mockResolvedValueOnce({ Status: "SUCCESS" }).mockResolvedValueOnce({});
    await cognitoMfaCompleteSetup("my-token", "123456");
    const calls = sent();
    expect(calls.map(c => c.name)).toEqual(["VerifySoftwareTokenCommand", "SetUserMFAPreferenceCommand"]);
    expect(calls[0].input).toMatchObject({ AccessToken: "my-token", UserCode: "123456" });
    expect(calls[1].input).toEqual({
      AccessToken: "my-token",
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  });

  it("does not turn it on when the code is wrong", async () => {
    aws.send.mockResolvedValueOnce({ Status: "ERROR" });
    const err = await cognitoMfaCompleteSetup("my-token", "000000").catch(e => e);
    expect(err.code).toBe("invalid_code");
    expect(sent().map(c => c.name)).toEqual(["VerifySoftwareTokenCommand"]);
  });

  it("maps the exception Cognito raises for a wrong setup code", async () => {
    aws.send.mockRejectedValueOnce(awsError("EnableSoftwareTokenMFAException"));
    expect((await cognitoMfaCompleteSetup("t", "000000").catch(e => e)).code).toBe("invalid_code");
  });
});

describe("status and turning off", () => {
  it("reads whether an authenticator app is on for the user", async () => {
    aws.send.mockResolvedValueOnce({ UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] });
    expect(await cognitoMfaEnabled("t")).toBe(true);
    aws.send.mockResolvedValueOnce({ UserMFASettingList: [] });
    expect(await cognitoMfaEnabled("t")).toBe(false);
    aws.send.mockResolvedValueOnce({});
    expect(await cognitoMfaEnabled("t")).toBe(false);
  });

  it("turns it off by setting the preference to disabled", async () => {
    aws.send.mockResolvedValue({});
    await cognitoMfaDisable("t");
    expect(sent()[0]).toEqual({
      name: "SetUserMFAPreferenceCommand",
      input: { AccessToken: "t", SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } },
    });
  });
});

describe("password check before turning it off", () => {
  it("accepts a right password whether or not a code would be asked for", async () => {
    aws.send.mockResolvedValueOnce({ AuthenticationResult: tokens });
    expect(await cognitoCheckPassword("a@example.com", "pw")).toBe(true);
    aws.send.mockResolvedValueOnce({ ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s" });
    expect(await cognitoCheckPassword("a@example.com", "pw")).toBe(true);
  });

  it("rejects a wrong password and an unknown user", async () => {
    aws.send.mockRejectedValueOnce(awsError("NotAuthorizedException"));
    expect(await cognitoCheckPassword("a@example.com", "bad")).toBe(false);
    aws.send.mockRejectedValueOnce(awsError("UserNotFoundException"));
    expect(await cognitoCheckPassword("nobody@example.com", "bad")).toBe(false);
  });

  it("does not hide an outage as a wrong password", async () => {
    aws.send.mockRejectedValueOnce(awsError("InternalErrorException"));
    await expect(cognitoCheckPassword("a@example.com", "pw")).rejects.toThrow();
  });
});

describe("availability", () => {
  it("is on for real Amazon Cognito", () => {
    expect(cognitoMfaAvailable()).toBe(true);
  });

  it("is off for the local stand-in used by Docker", () => {
    process.env.COGNITO_ISSUER = "http://floci:4566/us-east-1_local";
    expect(cognitoMfaAvailable()).toBe(false);
  });

  it("is off when Cognito is not configured", () => {
    delete process.env.COGNITO_CLIENT_ID;
    expect(cognitoMfaAvailable()).toBe(false);
  });

  it("restores the environment", () => {
    for (const [key, value] of [
      ["COGNITO_CLIENT_ID", saved.id],
      ["COGNITO_ISSUER", saved.issuer],
      ["COGNITO_USER_POOL_ID", saved.pool],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    expect(mapMfaError(new Error("x")).code).toBe("unavailable");
  });
});
