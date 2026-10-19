/**
 * Browser helpers for same-origin (localhost) vs remote API Gateway base URL.
 *
 * Leave NEXT_PUBLIC_API_BASE_URL unset for local Next `/api/*`.
 * When set (e.g. https://xxxx.execute-api.us-east-1.amazonaws.com/prod),
 * chat/warm hit that host and send Bearer when a client token is stored.
 */

const CLIENT_TOKEN_KEY = "sm_access_token_client";

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
}

export function usesRemoteApi(): boolean {
  return Boolean(apiBaseUrl());
}

/** Map app path `/api/chat` → remote `/chat` when using API Gateway. */
export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalized;

  // Gateway routes are /chat and /warm (see infra/template.yaml), not /api/*.
  const stripped = normalized.replace(/^\/api/, "") || "/";
  return `${base}${stripped}`;
}

export function storeClientAccessToken(token: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (token) sessionStorage.setItem(CLIENT_TOKEN_KEY, token);
    else sessionStorage.removeItem(CLIENT_TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function readClientAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(CLIENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function apiAuthHeaders(): HeadersInit {
  const token = readClientAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Same-origin /api/* fetch that still sends the sessionStorage Bearer.
 * Hosted chat already uses that token (API Gateway cannot see the HttpOnly cookie).
 * Knowledge/settings stay on Amplify — without this header they 401 when the
 * cookie is missing even though chat still works.
 */
export function sessionApiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = readClientAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "same-origin",
  });
}

/**
 * Copy the Amplify HttpOnly session onto sessionStorage for API Gateway chat.
 * Login already stores the token; a new tab only has the cookie.
 */
export async function ensureClientAccessToken(): Promise<void> {
  if (!usesRemoteApi()) return;
  if (readClientAccessToken()) return;
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as { accessToken?: string };
    if (data.accessToken) storeClientAccessToken(data.accessToken);
  } catch {
    /* chat will 401 without a token */
  }
}

/** Fire-and-forget warm so the first chat token is less likely to hit a cold start. */
export function warmChatConnection(): void {
  if (typeof window === "undefined") return;
  const url = usesRemoteApi() ? apiUrl("/warm") : "/api/warm";
  void fetch(url, {
    method: "POST",
    headers: { ...apiAuthHeaders() },
    credentials: usesRemoteApi() ? "omit" : "same-origin",
  }).catch(() => {});
}
