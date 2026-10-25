import { describe, expect, it } from "vitest";
import { fitReplyToLimit, parseGroqOutputLimit } from "./groq";
import { formatGroqConnectivityError } from "./groq-connectivity";

const OTPM =
  '429 {"error":{"message":"Request too large for model `x` in organization `o` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 3063. reduce max_tokens","type":"tokens","code":"rate_limit_exceeded"}}';

describe("Groq output-token cap", () => {
  it("reads the enforced limit from an OTPM 429", () => {
    expect(parseGroqOutputLimit(new Error(OTPM))).toBe(1000);
  });

  it("ignores other errors, including other 429s", () => {
    expect(parseGroqOutputLimit(new Error("401 invalid api key"))).toBeNull();
    expect(parseGroqOutputLimit(new Error("429 rate_limit_exceeded on requests per minute: Limit 30"))).toBeNull();
  });

  it("fits the reply under the cap with a floor", () => {
    expect(fitReplyToLimit(1000)).toBe(800);
    expect(fitReplyToLimit(100)).toBe(256);
  });

  it("shows a plain message for a rate limit", () => {
    expect(formatGroqConnectivityError(new Error(OTPM))).toMatch(/rate limiting/);
  });
});
