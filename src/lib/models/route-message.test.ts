import { describe, expect, it } from "vitest";
import { isTrivialMessage, routeMessageSync } from "./route-message";

describe("isTrivialMessage", () => {
  it("treats casual greetings as Micro-tier trivial", () => {
    expect(isTrivialMessage("Hello there sir!")).toBe(true);
    expect(isTrivialMessage("hi")).toBe(true);
    expect(isTrivialMessage("good morning")).toBe(true);
  });

  it("does not treat ops questions as trivial", () => {
    expect(isTrivialMessage("What failed in the last deploy?")).toBe(false);
  });

  it("never treats image turns as trivial", () => {
    expect(isTrivialMessage("hi", true)).toBe(false);
  });
});

describe("routeMessageSync", () => {
  it("routes greetings to Micro without evidence-seeking score path", () => {
    const r = routeMessageSync({ message: "Hello there sir!" });
    expect(r.isTrivial).toBe(true);
    expect(r.tier).toBe("Micro");
  });
});
