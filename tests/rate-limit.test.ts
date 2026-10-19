import { beforeEach, describe, expect, it } from "vitest";
import { authRateLimit, resetRateLimits } from "@/lib/rate-limit";

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
});
