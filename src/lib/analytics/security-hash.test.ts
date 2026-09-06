import { describe, expect, it } from "vitest";
import { parseSecurityHash, securityPageSection } from "./security-hash";

describe("parseSecurityHash", () => {
  it("defaults to policy when the hash is empty", () => {
    expect(securityPageSection("")).toBe("policy");
    expect(securityPageSection("#detection-policy")).toBe("policy");
    expect(securityPageSection("#security-charts")).toBe("charts");
  });

  it("opens the detection log for a record hash", () => {
    expect(securityPageSection("#pii-record-abc")).toBe("log");
    expect(securityPageSection("#detection-log")).toBe("log");
  });

  it("opens policy when requested", () => {
    expect(securityPageSection("#detection-policy")).toBe("policy");
  });

  it("reads log, policy, and charts targets", () => {
    expect(parseSecurityHash("#detection-log")).toEqual({ kind: "log" });
    expect(parseSecurityHash("detection-log")).toEqual({ kind: "log" });
    expect(parseSecurityHash("#detection-policy")).toEqual({ kind: "policy" });
    expect(parseSecurityHash("#security-charts")).toEqual({ kind: "charts" });
  });

  it("reads a record target", () => {
    expect(parseSecurityHash("#pii-record-abc")).toEqual({ kind: "record", recordId: "abc" });
  });

  it("ignores empty or unknown hashes", () => {
    expect(parseSecurityHash("")).toBeNull();
    expect(parseSecurityHash("#pii-record-")).toBeNull();
    expect(parseSecurityHash("#charts")).toBeNull();
  });
});
