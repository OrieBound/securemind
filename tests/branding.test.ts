import { describe, expect, it } from "vitest";
import {
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
  PRODUCT_POSITIONING,
} from "@/lib/branding";

describe("product positioning", () => {
  it("keeps the SecureMind name and privacy-aware workspace line", () => {
    expect(PRODUCT_NAME).toBe("SecureMind");
    expect(PRODUCT_POSITIONING).toBe(
      "A privacy-aware AI workspace for managing models, knowledge, memory, cost, and sensitive-data risk.",
    );
    expect(PRODUCT_DESCRIPTION).toBe(`${PRODUCT_NAME} — ${PRODUCT_POSITIONING}`);
  });

  it("does not claim a security or compliance guarantee", () => {
    const blob = `${PRODUCT_DESCRIPTION}`.toLowerCase();
    for (const banned of ["pii-safe", "fully secure", "guaranteed", "compliance-ready"]) {
      expect(blob).not.toContain(banned);
    }
  });
});
