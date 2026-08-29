/**
 * Regression matrix from the natural-conversation / memory-provenance transcript.
 */
import { describe, expect, it } from "vitest";
import { decideTurn, needsOperationalPrompt } from "./decide-turn";

describe("transcript regression — natural conversation", () => {
  it("I just want to talk to you — social, no retrieval", () => {
    const d = decideTurn({ message: "I just want to talk to you." });
    expect(d.mode).toBe("social");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.showSourcesUi).toBe(false);
    expect(d.showGroundingBadge).toBe(false);
    expect(needsOperationalPrompt(d)).toBe(false);
  });

  it("Tell me about lava — general, no retrieval", () => {
    const d = decideTurn({ message: "Tell me about lava." });
    expect(d.mode).toBe("general");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.showSourcesUi).toBe(false);
    expect(d.showGroundingBadge).toBe(false);
    expect(needsOperationalPrompt(d)).toBe(false);
  });

  it("lava permission — social, no workspace redirect cues in policy", () => {
    const d = decideTurn({
      message:
        "Lava is not relevant to our conversation. I just want to talk to you about it.",
    });
    expect(d.shouldRetrieve).toBe(false);
    expect(d.showSourcesUi).toBe(false);
    expect(["social", "general"]).toContain(d.mode);
  });

  it("where did you learn that — provenance ask, no retrieval", () => {
    const d = decideTurn({ message: "Cool, where did you learn that?" });
    expect(d.mode).toBe("general");
    expect(d.reasonCode).toBe("provenance-ask");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.showSourcesUi).toBe(false);
  });

  it("you said that, not me — correction, no retrieval", () => {
    const d = decideTurn({ message: "Right, you said that. Not me." });
    expect(d.mode).toBe("social");
    expect(d.reasonCode).toBe("user-correction");
    expect(d.shouldRetrieve).toBe(false);
    expect(d.showGroundingBadge).toBe(false);
  });

  it("be my friend — casual social, no ops redirect", () => {
    const d = decideTurn({ message: "I just want you to be my friend." });
    expect(d.mode).toBe("social");
    expect(d.shouldRetrieve).toBe(false);
    expect(needsOperationalPrompt(d)).toBe(false);
  });

  it("workspace investigation still retrieves", () => {
    const d = decideTurn({
      message: "What does our incident report say about the outage?",
    });
    expect(d.shouldRetrieve).toBe(true);
    expect(d.showSourcesUi).toBe(true);
    expect(needsOperationalPrompt(d)).toBe(true);
  });
});
