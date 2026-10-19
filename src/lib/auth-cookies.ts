/** HttpOnly cookie helpers for the Cognito access token. */

export const ACCESS_COOKIE = "sm_access_token";

export function accessCookieHeader(token: string, maxAgeSec: number): string {
  const parts = [
    `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(60, maxAgeSec)}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearAccessCookieHeader(): string {
  const parts = [
    `${ACCESS_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export const SETUP_COMPLETE_COOKIE = "sm_setup_complete";

export function setupCompleteCookieHeader(): string {
  const parts = [
    `${SETUP_COMPLETE_COOKIE}=1`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 365}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function readSetupCompleteCookie(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SETUP_COMPLETE_COOKIE) {
      return rest.join("=") === "1";
    }
  }
  return false;
}

export function readAccessTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (header) {
    const m = /^Bearer\s+(\S+)/i.exec(header);
    if (m?.[1]) return m[1];
  }
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === ACCESS_COOKIE) {
      const v = rest.join("=");
      return v ? decodeURIComponent(v) : null;
    }
  }
  return null;
}
