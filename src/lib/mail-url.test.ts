import { afterEach, describe, expect, it } from "vitest";
import { appSignInUrl } from "./mail";

const keep = { a: process.env.APP_PUBLIC_URL, b: process.env.NEXTAUTH_URL };
afterEach(() => {
  process.env.APP_PUBLIC_URL = keep.a;
  process.env.NEXTAUTH_URL = keep.b;
  if (keep.a === undefined) delete process.env.APP_PUBLIC_URL;
  if (keep.b === undefined) delete process.env.NEXTAUTH_URL;
});

const req = (host: string, proto?: string) =>
  new Request("http://internal/", { headers: { host, ...(proto ? { "x-forwarded-proto": proto } : {}) } });

describe("sign-in address in admin messages", () => {
  it("uses the address the admin is on when none is configured", () => {
    delete process.env.APP_PUBLIC_URL;
    delete process.env.NEXTAUTH_URL;
    expect(appSignInUrl(req("app.securemind.chat"))).toBe("https://app.securemind.chat/");
    expect(appSignInUrl(req("localhost:3000"))).toBe("http://localhost:3000/");
    expect(appSignInUrl(req("app.example.com", "https"))).toBe("https://app.example.com/");
  });

  it("lets APP_PUBLIC_URL win and ignores odd host values", () => {
    process.env.APP_PUBLIC_URL = "https://portal.example.org/";
    expect(appSignInUrl(req("app.securemind.chat"))).toBe("https://portal.example.org/");
    delete process.env.APP_PUBLIC_URL;
    delete process.env.NEXTAUTH_URL;
    expect(appSignInUrl(req("evil.com/<script>"))).toBe("http://localhost:3000/");
  });
});
