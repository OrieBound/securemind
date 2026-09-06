import { describe, expect, it } from "vitest";
import { parseSecurityHash } from "./security-hash";

describe("parseSecurityHash", () => {
  it("reads the detection log target", () => {
    expect(parseSecurityHash("#detection-log")).toEqual({ kind: "log" });
    expect(parseSecurityHash("detection-log")).toEqual({ kind: "log" });
  });

  it("reads policy and charts targets", () => {
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
