import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config security headers", () => {
  it("applies the security headers to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const keys = rules[0].headers.map(h => h.key);
    for (const required of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ]) {
      expect(keys, required).toContain(required);
    }
  });

  it("keeps the standalone output the Docker image and Amplify depend on", () => {
    expect(nextConfig.output).toBe("standalone");
  });
});

import { securityOptionsFromEnv as optionsFromEnv } from "@/lib/security-headers";

describe("HTTPS option for Docker behind the TLS front end", () => {
  it("turns on HTTPS headers when SECUREMIND_HTTPS is true", () => {
    expect(optionsFromEnv({ NODE_ENV: "production", SECUREMIND_HTTPS: "true" }).https).toBe(true);
    expect(optionsFromEnv({ NODE_ENV: "production" }).https).toBe(false);
  });
});
