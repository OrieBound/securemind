import { describe, expect, it } from "vitest";
import {
  API_SECURITY_HEADERS,
  apiOriginsFromEnv,
  buildCsp,
  originOf,
  securityHeaders,
  securityOptionsFromEnv,
} from "./security-headers";

function directive(csp: string, name: string): string[] {
  const found = csp.split(";").map(d => d.trim()).find(d => d.startsWith(`${name} `) || d === name);
  return found ? found.split(/\s+/).slice(1) : [];
}

describe("origins", () => {
  it("reduces a URL to its origin and rejects anything else", () => {
    expect(originOf("https://abc.execute-api.us-east-1.amazonaws.com/prod")).toBe(
      "https://abc.execute-api.us-east-1.amazonaws.com",
    );
    expect(originOf("not a url")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });

  it("reads one or several API origins from the environment, without duplicates", () => {
    expect(apiOriginsFromEnv({})).toEqual([]);
    expect(
      apiOriginsFromEnv({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/prod, https://api.example.com/other, nope" }),
    ).toEqual(["https://api.example.com"]);
  });
});

describe("Content-Security-Policy", () => {
  const prod = buildCsp({ apiOrigins: ["https://api.example.com"], https: true });

  it("blocks framing, plugins and foreign base URLs and form targets", () => {
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
    expect(directive(prod, "default-src")).toEqual(["'self'"]);
  });

  it("only lets the browser connect to itself and the chat API", () => {
    expect(directive(prod, "connect-src")).toEqual(["'self'", "https://api.example.com"]);
    expect(prod).not.toMatch(/connect-src[^;]*\*/);
  });

  it("allows no third-party script, style or frame sources and no wildcards in script-src", () => {
    expect(directive(prod, "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(prod, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(prod).not.toContain("http:");
  });

  it("keeps eval and websockets out of production and in only for development", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/\bwss?:/);
    const dev = buildCsp({ dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toEqual(expect.arrayContaining(["ws:", "wss:"]));
  });

  it("upgrades insecure requests only when served over HTTPS", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(buildCsp({})).not.toContain("upgrade-insecure-requests");
  });

  it("still lets the app show avatars, charts, previews and microphone audio", () => {
    expect(directive(prod, "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:"]));
    expect(directive(prod, "media-src")).toContain("blob:");
    expect(directive(prod, "worker-src")).toContain("blob:");
  });

  it("ignores an API origin that is not a URL", () => {
    expect(directive(buildCsp({ apiOrigins: ["nonsense"] }), "connect-src")).toEqual(["'self'"]);
  });
});

describe("securityHeaders", () => {
  const byKey = (opts = {}) => Object.fromEntries(securityHeaders(opts).map(h => [h.key, h.value]));

  it("sets the full set on every response", () => {
    const h = byKey();
    expect(h["Content-Security-Policy"]).toBeTruthy();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  it("turns off every powerful feature except the microphone for this origin", () => {
    const policy = byKey()["Permissions-Policy"];
    expect(policy).toContain("microphone=(self)");
    for (const feature of ["camera", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it("adds HSTS only over HTTPS, so http://localhost is unaffected", () => {
    expect(byKey()["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey({ https: true })["Strict-Transport-Security"]).toMatch(/max-age=31536000/);
  });

  it("has no duplicate header names", () => {
    const keys = securityHeaders({ https: true }).map(h => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("environment", () => {
  it("is strict in production on the cloud edition", () => {
    const o = securityOptionsFromEnv({
      NODE_ENV: "production",
      SECUREMIND_EDITION: "cloud",
      NEXT_PUBLIC_API_BASE_URL: "https://x.execute-api.us-east-1.amazonaws.com/prod",
    });
    expect(o).toEqual({ apiOrigins: ["https://x.execute-api.us-east-1.amazonaws.com"], dev: false, https: true });
  });

  it("does not force HTTPS for the on-prem edition", () => {
    expect(securityOptionsFromEnv({ NODE_ENV: "production" }).https).toBe(false);
  });
});

describe("API headers", () => {
  it("stop content sniffing and leaking referrers", () => {
    expect(API_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(API_SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    expect(API_SECURITY_HEADERS["Strict-Transport-Security"]).toMatch(/max-age/);
  });
});
