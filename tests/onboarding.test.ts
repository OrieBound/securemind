import { describe, expect, it } from "vitest";
import {
  chatUnreachableMessage,
  defaultWorkspaceHello,
  isLegacyDefaultHello,
  noModelAssistantReply,
} from "@/lib/onboarding";

describe("onboarding copy", () => {
  it("detects the previous first-workspace hello", () => {
    expect(isLegacyDefaultHello(
      "Hi — I'm **Mindy Locke**, your first workspace.\n\nFeel free to change my name anytime in **Workspace** settings. When you're ready, upload Knowledge or ask a question — I'll stay grounded in what you add here.",
    )).toBe(true);
    expect(isLegacyDefaultHello("Hi — I'm Mindy Locke, your first workspace here.")).toBe(false);
  });

  it("points hosted users at Bedrock acknowledgement and the guide", () => {
    const hello = defaultWorkspaceHello("Mindy Locke", "cloud");
    expect(hello).toContain("Getting started");
    expect(hello).toContain("/getting-started");
    expect(hello).toContain("settings=providers");
    expect(hello).toContain("highlight=bedrock");
    expect(hello).not.toContain("ADR");

    const reply = noModelAssistantReply("cloud");
    expect(reply).toContain("billable model requests");
    expect(reply).toContain("Getting started");
    expect(reply).toContain("I understand that enabling Bedrock");
    expect(reply).toContain("not an IAM role");
  });

  it("does not tell hosted users to start a local dev server", () => {
    expect(chatUnreachableMessage("cloud")).not.toMatch(/dev server/i);
    expect(chatUnreachableMessage("cloud")).toContain("Getting started");
  });
});
