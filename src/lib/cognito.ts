/**
 * Cognito (Floci or real AWS) helpers for server-side signup/login.
 *
 * Browser never talks to Cognito directly — API routes call these so the
 * endpoint URL and any future client secret stay on the server.
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ChangePasswordCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  AssociateSoftwareTokenCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  RespondToAuthChallengeCommand,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
  AuthFlowType,
  ChallengeNameType,
} from "@aws-sdk/client-cognito-identity-provider";
import { LOCAL_AWS_CREDENTIALS, LOCAL_AWS_ENDPOINT } from "@/lib/aws-endpoint";

function region(): string {
  return (
    process.env.COGNITO_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1"
  );
}

function clientId(): string {
  const id = process.env.COGNITO_CLIENT_ID;
  if (!id) throw new Error("COGNITO_CLIENT_ID is not set.");
  return id;
}

function poolId(): string | undefined {
  return process.env.COGNITO_USER_POOL_ID;
}

/**
 * Floci / local Cognito endpoint.
 *
 * Prefer the origin of COGNITO_ISSUER — that var is never cleared by
 * withRealAwsEndpoints(), so HMR (or a first import during a real-AWS window)
 * cannot pin this client to production Cognito. Fall back to the module-load
 * AWS_ENDPOINT_URL snapshot for older env layouts.
 */
function cognitoEndpoint(): string | undefined {
  const issuer = process.env.COGNITO_ISSUER?.trim();
  if (issuer) {
    try {
      return new URL(issuer).origin;
    } catch {
      /* fall through */
    }
  }
  return LOCAL_AWS_ENDPOINT;
}

let _client: CognitoIdentityProviderClient | null = null;
let _clientEndpoint: string | undefined;

function cip(): CognitoIdentityProviderClient {
  const endpoint = cognitoEndpoint();
  // Rebuild if the resolved endpoint changed (dev HMR / env reload).
  if (!_client || _clientEndpoint !== endpoint) {
    _client = new CognitoIdentityProviderClient({
      region: region(),
      ...(endpoint ? { endpoint } : {}),
      credentials: LOCAL_AWS_CREDENTIALS,
    });
    _clientEndpoint = endpoint;
  }
  return _client;
}

export type AuthTokens = {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
};

export async function cognitoSignUp(email: string, password: string): Promise<{ userConfirmed: boolean }> {
  const out = await cip().send(
    new SignUpCommand({
      ClientId: clientId(),
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
      ],
    }),
  );
  return { userConfirmed: Boolean(out.UserConfirmed) };
}

/**
 * Floci often auto-confirms; real Cognito may require a code.
 * When confirmation is required, the login route surfaces that to the UI.
 */
export async function cognitoConfirmSignUp(email: string, code: string): Promise<void> {
  await cip().send(
    new ConfirmSignUpCommand({
      ClientId: clientId(),
      Username: email,
      ConfirmationCode: code,
    }),
  );
}

type CognitoAuthResult = {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
};

function tokensFrom(result: CognitoAuthResult | undefined): AuthTokens | null {
  if (!result?.AccessToken) return null;
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn ?? 3600,
  };
}

/** First step of sign-in: either signed in, or the password was right and a code is needed. */
export type LoginStep =
  | { kind: "tokens"; tokens: AuthTokens }
  | { kind: "mfa"; session: string };

export async function cognitoLoginStart(email: string, password: string): Promise<LoginStep> {
  const out = await cip().send(
    new InitiateAuthCommand({
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: clientId(),
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  );

  const tokens = tokensFrom(out.AuthenticationResult);
  if (tokens) return { kind: "tokens", tokens };

  if (out.ChallengeName === ChallengeNameType.SOFTWARE_TOKEN_MFA && out.Session) {
    return { kind: "mfa", session: out.Session };
  }
  const challenge = out.ChallengeName;
  throw new Error(
    challenge
      ? `Additional auth challenge required: ${challenge}`
      : "Login failed - no access token returned.",
  );
}

/** Password sign-in for callers that cannot handle a code step. Throws if one is needed. */
export async function cognitoLogin(email: string, password: string): Promise<AuthTokens> {
  const step = await cognitoLoginStart(email, password);
  if (step.kind === "tokens") return step.tokens;
  throw new Error(`Additional auth challenge required: ${ChallengeNameType.SOFTWARE_TOKEN_MFA}`);
}

// -- Two-step verification (authenticator-app codes) --------------------------

export type MfaErrorCode =
  | "invalid_code"
  | "session_expired"
  | "not_enrolled"
  | "rate_limited"
  | "wrong_password"
  | "unavailable";

export class MfaError extends Error {
  readonly code: MfaErrorCode;
  readonly status: number;
  constructor(code: MfaErrorCode, message: string, status: number) {
    super(message);
    this.name = "MfaError";
    this.code = code;
    this.status = status;
  }
}

/** Turn a Cognito failure into one our routes can show. Never includes the provider's message. */
export function mapMfaError(err: unknown): MfaError {
  if (err instanceof MfaError) return err;
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "CodeMismatchException":
    case "ExpiredCodeException":
    case "EnableSoftwareTokenMFAException":
      return new MfaError(
        "invalid_code",
        "That code did not work. Check the latest code in your authenticator app.",
        422,
      );
    case "SoftwareTokenMFANotFoundException":
      return new MfaError("not_enrolled", "Two-step verification is not set up for this account.", 409);
    case "TooManyRequestsException":
    case "LimitExceededException":
    case "TooManyFailedAttemptsException":
      return new MfaError("rate_limited", "Too many attempts. Wait a minute and try again.", 429);
    case "NotAuthorizedException":
      return new MfaError(
        "session_expired",
        "That sign-in attempt expired. Enter your email and password again.",
        401,
      );
    default:
      return new MfaError("unavailable", "Two-step verification is unavailable right now.", 503);
  }
}

/**
 * Two-step verification needs real Amazon Cognito. The local stand-in used by Docker does
 * not implement authenticator-app codes, so the feature is hidden there rather than failing.
 */
export function cognitoMfaAvailable(): boolean {
  if (!cognitoConfigured()) return false;
  const endpoint = cognitoEndpoint();
  return !endpoint || endpoint.includes("amazonaws.com");
}

/** Second step of sign-in: the six-digit code from the app, plus the session from step one. */
export async function cognitoRespondToMfa(input: {
  email: string;
  session: string;
  code: string;
}): Promise<AuthTokens> {
  try {
    const out = await cip().send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId(),
        ChallengeName: ChallengeNameType.SOFTWARE_TOKEN_MFA,
        Session: input.session,
        ChallengeResponses: {
          USERNAME: input.email,
          SOFTWARE_TOKEN_MFA_CODE: input.code,
        },
      }),
    );
    const tokens = tokensFrom(out.AuthenticationResult);
    if (!tokens) throw new MfaError("unavailable", "Sign-in did not complete.", 503);
    return tokens;
  } catch (err) {
    throw mapMfaError(err);
  }
}

export async function cognitoMfaEnabled(accessToken: string): Promise<boolean> {
  const out = await cip().send(new GetUserCommand({ AccessToken: accessToken }));
  return (out.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
}

/** Start enrolment: Cognito makes a new secret for this user. Not active until verified. */
export async function cognitoMfaBeginSetup(accessToken: string): Promise<{ secret: string }> {
  try {
    const out = await cip().send(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }));
    if (!out.SecretCode) throw new MfaError("unavailable", "Could not start setup.", 503);
    return { secret: out.SecretCode };
  } catch (err) {
    throw mapMfaError(err);
  }
}

/** Finish enrolment: prove the app works by entering a code, then make it the sign-in method. */
export async function cognitoMfaCompleteSetup(accessToken: string, code: string): Promise<void> {
  try {
    const out = await cip().send(
      new VerifySoftwareTokenCommand({
        AccessToken: accessToken,
        UserCode: code,
        FriendlyDeviceName: "Authenticator app",
      }),
    );
    if (out.Status !== "SUCCESS") {
      throw new MfaError(
        "invalid_code",
        "That code did not work. Check the latest code in your authenticator app.",
        422,
      );
    }
    await cip().send(
      new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      }),
    );
  } catch (err) {
    throw mapMfaError(err);
  }
}

/** Ends every session for the token's user (refresh tokens stop working). Best effort for callers. */
export async function cognitoGlobalSignOut(accessToken: string): Promise<void> {
  await cip().send(new GlobalSignOutCommand({ AccessToken: accessToken }));
}

export async function cognitoMfaDisable(accessToken: string): Promise<void> {
  try {
    await cip().send(
      new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
      }),
    );
  } catch (err) {
    throw mapMfaError(err);
  }
}

/**
 * True if the password is right. Used before turning two-step verification off. A user who
 * has it on gets a code challenge back, which also proves the password, and is discarded.
 */
export async function cognitoCheckPassword(email: string, password: string): Promise<boolean> {
  try {
    await cognitoLoginStart(email, password);
    return true;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAuthorizedException" || name === "UserNotFoundException") return false;
    // Any other challenge ("Additional auth challenge required: ...") still proves the password.
    if (err instanceof Error && /Additional auth challenge required/.test(err.message)) return true;
    throw err;
  }
}

export function cognitoConfigured(): boolean {
  return Boolean(process.env.COGNITO_CLIENT_ID && (process.env.COGNITO_ISSUER || poolId()));
}

/** Authenticated user changes password (requires current access token). */
export async function cognitoChangePassword(
  accessToken: string,
  previousPassword: string,
  proposedPassword: string,
): Promise<void> {
  await cip().send(
    new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: previousPassword,
      ProposedPassword: proposedPassword,
    }),
  );
}

/**
 * Start forgot-password. Callers must not reveal whether the user exists —
 * swallow UserNotFoundException at the route layer.
 */
export async function cognitoForgotPassword(username: string): Promise<void> {
  await cip().send(
    new ForgotPasswordCommand({
      ClientId: clientId(),
      Username: username,
    }),
  );
}

export async function cognitoConfirmForgotPassword(
  username: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await cip().send(
    new ConfirmForgotPasswordCommand({
      ClientId: clientId(),
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    }),
  );
}
