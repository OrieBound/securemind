import { describe, expect, it } from "vitest";
import {
  applySpeculativeKnowledgeHits,
  decideTurn,
  shouldSkipKnowledgeSearch,
} from "./decide-turn";
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

  it("asks about a provided tenancy document retrieve Knowledge", () => {
    const d = decideTurn({
      message:
        "What is the base rent and parking cost of the premise in tenancy document provided?",
    });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("workspace_grounded");
    expect(d.showSourcesUi).toBe(true);
  });

  it("asks about the attached document retrieve Knowledge", () => {
    const d = decideTurn({
      message: "Tell me anything about the document attached.",
    });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("workspace_grounded");
    expect(d.showSourcesUi).toBe(true);
  });

  it("tell me about the document retrieves Knowledge", () => {
    const d = decideTurn({ message: "Tell me about the document." });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("workspace_grounded");
  });

  it("asks about emails inside that document retrieve Knowledge", () => {
    const d = decideTurn({
      message: "Do you have access to any of the email addresses inside that document?",
    });
    expect(d.shouldRetrieve).toBe(true);
  });

  it("follow-up after an attachment retrieves even without file deixis", () => {
    const d = decideTurn({
      message: "Could you confirm the main subjects mentioned?",
      priorTurnHadAttachments: true,
    });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("grounded_follow_up");
  });

  it("follow-up that the answer is in memory retrieves Knowledge", () => {
    const d = decideTurn({
      message: "I already did. It should be in your memory",
    });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.mode).toBe("workspace_grounded");
  });

  it("speculative search is allowed for general questions, not social", () => {
    const general = decideTurn({ message: "What is AWS KMS?" });
    expect(general.shouldRetrieve).toBe(false);
    expect(shouldSkipKnowledgeSearch(general)).toBe(false);
    const promoted = applySpeculativeKnowledgeHits(general, 2);
    expect(promoted.shouldRetrieve).toBe(true);
    expect(promoted.mode).toBe("workspace_grounded");
    expect(promoted.reasonCode).toBe("speculative-retrieve-hit");

    const social = decideTurn({ message: "Thanks" });
    expect(shouldSkipKnowledgeSearch(social)).toBe(true);
    expect(applySpeculativeKnowledgeHits(social, 5).shouldRetrieve).toBe(false);

    expect(applySpeculativeKnowledgeHits(general, 0).shouldRetrieve).toBe(false);

    const provenance = decideTurn({ message: "Cool, where did you learn that?" });
    expect(shouldSkipKnowledgeSearch(provenance)).toBe(true);
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

describe("terse questions and short follow-ups", () => {
  it("searches Knowledge for a terse fragment instead of asking to clarify", () => {
    const d = decideTurn({ message: "notice period?" });
    expect(d.mode).toBe("ambiguous");
    expect(d.reasonCode).toBe("short-unclear");
    expect(d.preferMicroTier).toBe(false);
    expect(shouldSkipKnowledgeSearch(d)).toBe(false);
  });

  it("upgrades that fragment to grounded only when a strong hit exists", () => {
    const d = decideTurn({ message: "late fee" });
    expect(applySpeculativeKnowledgeHits(d, 0).mode).toBe("ambiguous");
    const promoted = applySpeculativeKnowledgeHits(d, 1);
    expect(promoted.shouldRetrieve).toBe(true);
    expect(promoted.mode).toBe("workspace_grounded");
    expect(promoted.showSourcesUi).toBe(true);
  });

  it("still skips search for deictic fragments that point at the last answer", () => {
    expect(shouldSkipKnowledgeSearch(decideTurn({ message: "this?" }))).toBe(true);
    expect(shouldSkipKnowledgeSearch(decideTurn({ message: "Is this correct?" }))).toBe(true);
  });

  it("treats a short question after a grounded answer as a follow-up without a cue word", () => {
    const d = decideTurn({ message: "who signs it?", priorTurnWasGrounded: true });
    expect(d.mode).toBe("grounded_follow_up");
    expect(d.reasonCode).toBe("short-follow-up-prior-grounding");
    expect(d.shouldRetrieve).toBe(true);
    expect(d.requiresWorkspaceEvidence).toBe(false);
  });

  it("does not turn general knowledge, long messages, or acknowledgements into follow-ups", () => {
    const general = decideTurn({
      message: "What is the capital of Canada?",
      priorTurnWasGrounded: true,
    });
    expect(general.reasonCode).not.toBe("short-follow-up-prior-grounding");

    const long = decideTurn({
      message: "Please write me a detailed marketing plan for launching a bakery in a new neighbourhood this spring.",
      priorTurnWasGrounded: true,
    });
    expect(long.reasonCode).not.toBe("short-follow-up-prior-grounding");

    expect(decideTurn({ message: "thanks", priorTurnWasGrounded: true }).mode).toBe("social");
  });

  it("does not make a short question a follow-up when nothing grounded came before", () => {
    const d = decideTurn({ message: "who signs it?" });
    expect(d.reasonCode).toBe("short-unclear");
  });
});

