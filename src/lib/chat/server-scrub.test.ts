import { describe, expect, it } from "vitest";
import { scrubChatRequestServerSide } from "./server-scrub";

describe("scrubChatRequestServerSide", () => {
  it("replaces a card number and an AWS key that skipped the browser", () => {
    const { body, redactions } = scrubChatRequestServerSide({
      message: "card 4111 1111 1111 1111 and key AKIAIOSFODNN7EXAMPLE",
      history: [{ role: "user", content: "ssn 123-45-6789" }],
      attachmentExtracts: [{ id: "d1", name: "n", content: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789" }],
    });
    expect(body.message).not.toContain("4111 1111 1111 1111");
    expect(body.message).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(body.history?.[0].content).not.toContain("123-45-6789");
    expect(body.attachmentExtracts?.[0].content).not.toContain("ghp_");
    expect(redactions).toBeGreaterThanOrEqual(4);
  });

  it("leaves categories the person may keep (email, phone) and ordinary text alone", () => {
    const message = "Email ops@example.test or call 555-123-4567 about order 1234.";
    const { body, redactions } = scrubChatRequestServerSide({ message });
    expect(body.message).toBe(message);
    expect(redactions).toBe(0);
  });

  it("does not flag a number that fails the card checksum", () => {
    const { redactions } = scrubChatRequestServerSide({ message: "ref 4111 1111 1111 1112" });
    expect(redactions).toBe(0);
  });
});
