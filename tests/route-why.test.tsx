/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteWhy } from "@/components/app/route-why";
import { applyEvidenceFloors, routeMessageSync } from "@/lib/models/route-message";
import { TIER_DEFINITIONS } from "@/lib/models/tier-definitions";

afterEach(() => cleanup());

describe("RouteWhy", () => {
  it("names the tier, its definition, every signal with its points, and the score", () => {
    const { card } = routeMessageSync({ message: "help me think through whether I should quit my job this year" });
    render(<RouteWhy card={card} />);
    expect(screen.getByText(`Why ${card.tier}?`)).toBeTruthy();
    expect(screen.getByText(TIER_DEFINITIONS.Plus.summary, { exact: false })).toBeTruthy();
    for (const s of card.signals) {
      expect(screen.getByText(s.label)).toBeTruthy();
    }
    expect(screen.getByText("Baseline")).toBeTruthy();
    expect(screen.getByText(String(card.score))).toBeTruthy();
  });

  it("explains a floor that raised the tier", () => {
    const sync = routeMessageSync({ message: "notice period?" }).card;
    const card = applyEvidenceFloors(sync, {
      message: "notice period?",
      evidencePassages: 2,
      evidenceDocuments: 1,
      attachmentChars: 0,
    });
    render(<RouteWhy card={card} />);
    expect(screen.getByText(/answers from your documents need a careful reader/)).toBeTruthy();
    expect(screen.getByText(/Light to Standard/)).toBeTruthy();
  });

  it("shows the tie-break and its cost when a small model broke a tie", () => {
    const { card } = routeMessageSync({ message: "can you give me a hand with the thing we were talking about" });
    render(
      <RouteWhy
        card={{ ...card, classifier: { used: true, model: "llama-3.1-8b-instant", tier: "Plus", costUsd: 0.0003 } }}
      />,
    );
    expect(screen.getByText(/small model broke a tie/i)).toBeTruthy();
    expect(screen.getByText(/<\$0\.01/)).toBeTruthy();
  });

  it("handles a card with no signals", () => {
    const { card } = routeMessageSync({ message: "   ", fallback: "Standard" });
    render(<RouteWhy card={card} />);
    expect(screen.getByText(/No signals fired/)).toBeTruthy();
  });

  it("is collapsed by default", () => {
    const { card } = routeMessageSync({ message: "thanks" });
    render(<RouteWhy card={card} />);
    const details = screen.getByTestId("route-why") as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });
});
