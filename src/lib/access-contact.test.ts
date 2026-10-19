import { describe, expect, it } from "vitest";
import { parseAccessContactUrl } from "./access-contact";

describe("parseAccessContactUrl", () => {
  it("accepts https and http links", () => {
    expect(parseAccessContactUrl("https://securemind.chat/contact/")).toBe("https://securemind.chat/contact/");
    expect(parseAccessContactUrl("  http://localhost:3010/contact  ")).toBe("http://localhost:3010/contact");
  });

  it("returns null when it is unset or blank", () => {
    expect(parseAccessContactUrl(undefined)).toBeNull();
    expect(parseAccessContactUrl("")).toBeNull();
    expect(parseAccessContactUrl("   ")).toBeNull();
  });

  it("rejects anything that is not an http(s) link", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "mailto:a@b.c", "ftp://x", "not a url", "//evil.example"]) {
      expect(parseAccessContactUrl(bad), bad).toBeNull();
    }
  });
});
