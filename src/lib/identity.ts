/**
 * Server-derived request identity.
 *
 * Every route must obtain its `userId` here. Routes must never read a user or
 * tenant identifier from the request body, query string, or a client-controlled
 * header — doing so lets any caller act as any user simply by changing a
 * parameter.
 *
 * Until Cognito lands this returns a fixed single-user identity. The value is
 * the same as before, but the trust boundary is now correct: the client cannot
 * influence it. Wiring real auth becomes a change to this one function.
 */

/** The only identity that exists before authentication is wired up. */
export const LOCAL_USER_ID = "local";

export type Identity = {
  userId: string;
};

/**
 * Resolve the caller's identity.
 *
 * Async because JWT verification will be, and callers should not need to change
 * shape when that happens.
 */
export async function getIdentity(_req: Request): Promise<Identity> {
  // Phase C: verify the Cognito access token and return its `sub` claim.
  return { userId: LOCAL_USER_ID };
}
