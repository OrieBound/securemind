import { describe, expect, it } from "vitest";
import { decideTurn } from "./decide-turn";
import { stripConversationalPrefixes } from "./normalize";

function expectNoRetrieval(message: string) {
  const d = decideTurn({ message });
  expect(d.shouldRetrieve, message).toBe(false);
  expect(d.showSourcesUi, message).toBe(false);
  expect(d.showGroundingBadge, message).toBe(false);
}

function expectRetrieve(message: string) {
  const d = decideTurn({ message });
  expect(d.shouldRetrieve, message).toBe(true);
  expect(d.showSourcesUi, message).toBe(true);
}

describe("stripConversationalPrefixes", () => {
  it("exposes the substantive question after a greeting", () => {
    const { remainder, strippedPrefix } = stripConversationalPrefixes(
      "Hello, what caused the outage?",
    );
    expect(strippedPrefix).toBe(true);
    expect(remainder.toLowerCase()).toContain("what caused the outage");
  });
});

describe("decideTurn matrix", () => {
  it("social — no retrieval", () => {
    for (const m of [
      "Hello",
      "Hello there, sir.",
      "Good morning, team.",
      "Thanks, that helps.",
      "Tell me a joke.",
      "I just want to talk to you.",
    ]) {
      expectNoRetrieval(m);
      expect(decideTurn({ message: m }).mode).toMatch(/social/);
    }
  });

  it("greeting + substantive question retrieves", () => {
    expectRetrieve("Hello, what caused the outage?");
    expect(decideTurn({ message: "Hello, what caused the outage?" }).mode).toBe(
      "investigation",
    );
  });

  it("thanks + runbook question retrieves", () => {
    const d = decideTurn({ message: "Thanks—what does our runbook say next?" });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("workspace_grounded");
  });

  it("short ops query is not suppressed", () => {
    const d = decideTurn({ message: "KMS error?" });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("investigation");
  });

  it("general knowledge skips workspace retrieval", () => {
    const d = decideTurn({ message: "What is AWS KMS?" });
    expect(d.shouldRetrieve).toBe(false);
    expect(d.mode).toBe("general");
    expect(d.showSourcesUi).toBe(false);
  });

  it("tell me about X skips workspace retrieval", () => {
    const d = decideTurn({ message: "Tell me about lava." });
    expect(d.shouldRetrieve).toBe(false);
    expect(d.mode).toBe("general");
  });

  it("bare 'document' without workspace deixis does not force retrieval", () => {
    const d = decideTurn({
      message: "I have this document I would like you to review.",
    });
    expect(d.shouldRetrieve).toBe(false);
  });

  it("attached document review uses attachment mode", () => {
    const d = decideTurn({
      message: "I have this document I would like you to review.",
      hasAttachments: true,
    });
    expect(d.mode).toBe("attachment");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.sourceScope).toBe("current_attachment");
  });

  it("workspace KMS runbook retrieves", () => {
    expectRetrieve("What does our KMS runbook require?");
  });

  it("postmortem question retrieves", () => {
    expectRetrieve("Based on the postmortem, why did deployment fail?");
  });

  it("app help skips operational retrieval", () => {
    const d = decideTurn({ message: "How do I upload Knowledge?" });
    expect(d.shouldRetrieve).toBe(false);
    expect(d.mode).toBe("app_help");
  });

  it("which source follows prior citations", () => {
    const d = decideTurn({
      message: "Which source supports that?",
      priorTurnHadCitations: true,
    });
    expect(d.mode).toBe("grounded_follow_up");
    expect(d.shouldRetrieve).toBe(true);
  });

  it("what happened without context clarifies", () => {
    const d = decideTurn({ message: "What happened?" });
    expect(d.mode).toBe("ambiguous");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.responseStyle).toBe("clarify");
  });

  it("what happened after sourced answer is grounded follow-up", () => {
    const d = decideTurn({
      message: "What happened?",
      priorTurnHadCitations: true,
    });
    expect(d.mode).toBe("grounded_follow_up");
    expect(d.shouldRetrieve).toBe(true);
  });

  it("attachment without instruction clarifies", () => {
    const d = decideTurn({ message: "Hello", hasImages: true });
    expect(d.mode).toBe("attachment");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.responseStyle).toBe("clarify");
  });

  it("compare screenshot with runbook retrieves workspace", () => {
    const d = decideTurn({
      message: "Compare this screenshot with our recovery runbook.",
      hasImages: true,
    });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.sourceScope).toBe("workspace");
  });

  it("summarize attached screenshot stays attachment-scoped", () => {
    const d = decideTurn({
      message: "Summarize this attached screenshot.",
      hasImages: true,
    });
    expect(d.mode).toBe("attachment");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.sourceScope).toBe("current_attachment");
  });
});
