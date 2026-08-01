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
  AuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";

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

let _client: CognitoIdentityProviderClient | null = null;

function cip(): CognitoIdentityProviderClient {
  if (!_client) {
    const endpoint = process.env.AWS_ENDPOINT_URL || undefined;
    _client = new CognitoIdentityProviderClient({
      region: region(),
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });
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
