import { beforeEach, describe, expect, it } from "vitest";
import { authRateLimit, clientAddress, hitRateLimit, resetRateLimits } from "@/lib/rate-limit";

const req = (ip: string) => new Request("http://x/api/auth/login", { headers: { "x-forwarded-for": ip } });

describe("authRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows five attempts per account per minute, then answers 429", () => {
    for (let i = 0; i < 5; i++) expect(authRateLimit(req(`10.0.0.${i}`), "login", "a@example.test")).toBeNull();
    const res = authRateLimit(req("10.0.0.9"), "login", "A@example.test");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBeTruthy();
  });

  it("limits one address across many accounts", () => {
    for (let i = 0; i < 20; i++) expect(authRateLimit(req("10.1.1.1"), "login", `u${i}@example.test`)).toBeNull();
    expect(authRateLimit(req("10.1.1.1"), "login", "new@example.test")?.status).toBe(429);
  });

  it("keeps routes separate", () => {
    for (let i = 0; i < 5; i++) authRateLimit(req("10.2.2.2"), "login", "b@example.test");
    expect(authRateLimit(req("10.2.2.2"), "forgot", "b@example.test")).toBeNull();
  });

  it("ignores addresses the caller adds to X-Forwarded-For", () => {
    // The proxy appends the real address last; changing the first entry must not reset the count.
    for (let i = 0; i < 20; i++) {
      expect(authRateLimit(req(`198.51.100.${i}, 10.9.9.9`), "login", `s${i}@example.test`)).toBeNull();
    }
    expect(authRateLimit(req("198.51.100.250, 10.9.9.9"), "login", "t@example.test")?.status).toBe(429);
  });

  it("prefers CloudFront's viewer address and drops its port", () => {
    const r = new Request("http://x", {
      headers: { "cloudfront-viewer-address": "203.0.113.7:46532", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientAddress(r)).toBe("203.0.113.7");
    const v6 = new Request("http://x", { headers: { "cloudfront-viewer-address": "2001:db8::1:443" } });
    expect(clientAddress(v6)).toBe("2001:db8::1");
  });

  it("a full map drops its oldest keys instead of clearing every count", () => {
    for (let i = 0; i < 10_000; i++) hitRateLimit("flood", `k${i}`, 1, 60_000);
    for (let i = 0; i < 5; i++) authRateLimit(req("10.4.4.4"), "login", "late@example.test");
    for (let i = 0; i < 100; i++) hitRateLimit("flood2", `j${i}`, 1, 60_000);
    // The old code cleared the whole map here, which reset this account's count.
    expect(authRateLimit(req("10.4.4.5"), "login", "late@example.test")?.status).toBe(429);
  });
});
