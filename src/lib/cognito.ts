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
  AuthFlowType,
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

export async function cognitoLogin(email: string, password: string): Promise<AuthTokens> {
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

  const result = out.AuthenticationResult;
  if (!result?.AccessToken) {
    const challenge = out.ChallengeName;
    throw new Error(
      challenge
        ? `Additional auth challenge required: ${challenge}`
        : "Login failed — no access token returned.",
    );
  }

  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn ?? 3600,
  };
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
