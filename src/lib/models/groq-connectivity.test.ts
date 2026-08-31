import { describe, expect, it } from "vitest";
import {
  classifyGroqError,
  formatGroqChatError,
  formatGroqConnectivityError,
  groqVendorStatusLabel,
} from "./groq-connectivity";

describe("formatGroqConnectivityError", () => {
  it("suggests VPN when fetch fails", () => {
    const msg = formatGroqConnectivityError(new TypeError("fetch failed"));
    expect(msg).toMatch(/VPN/i);
    expect(msg).toMatch(/api\.groq\.com/i);
  });

  it("suggests VPN on Groq 403 list response", () => {
    const msg = formatGroqConnectivityError(new Error("Groq models list failed (403)"));
    expect(msg).toMatch(/VPN/i);
  });

  it("reports bad key on 401", () => {
    const msg = formatGroqConnectivityError(new Error("Groq models list failed (401)"));
    expect(msg).toMatch(/rejected this API key/i);
  });

  it("reports bad key on chat 401", () => {
    const msg = formatGroqConnectivityError(new Error("401 Incorrect API key provided"));
    expect(msg).toMatch(/rejected this API key/i);
    expect(classifyGroqError(new Error("401 Incorrect API key provided"))).toBe("auth");
  });

  it("never tells the user to set GROQ_API_KEY after a failed chat call", () => {
    const msg = formatGroqChatError(new Error("401 Incorrect API key provided"));
    expect(msg).not.toMatch(/GROQ_API_KEY/);
    expect(msg).toMatch(/rejected this API key/i);
  });
});

describe("groqVendorStatusLabel", () => {
  it("does not call a stored key Connected when the catalog failed", () => {
    expect(groqVendorStatusLabel({
      riskAck: true,
      keySaved: true,
      modelCount: 0,
      catalogErrors: ["Groq rejected this API key. Re-paste the full key."],
    })).toBe("Key rejected");
    expect(groqVendorStatusLabel({
      riskAck: true,
      keySaved: true,
      modelCount: 0,
      catalogErrors: ["Could not reach Groq (api.groq.com). VPNs"],
    })).toBe("Unreachable");
  });

  it("says listed, not connected, when the catalog loaded", () => {
    expect(groqVendorStatusLabel({
      riskAck: true,
      keySaved: true,
      modelCount: 11,
      catalogErrors: [],
    })).toBe("Key saved · 11 models listed");
  });

  it("stays Not configured until a key is actually stored", () => {
    expect(groqVendorStatusLabel({
      riskAck: true,
      keySaved: false,
      modelCount: 0,
      catalogErrors: [],
    })).toBe("Not configured");
  });
});
