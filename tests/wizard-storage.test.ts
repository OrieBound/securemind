import { describe, expect, it } from "vitest";
import { isValidWizardStorage, parseWizardStorage } from "@/lib/wizard-storage";

describe("wizard storage choices", () => {
  it("forces hosted installs to DynamoDB", () => {
    expect(parseWizardStorage(null, "cloud", "postgres")).toBe("dynamodb");
    expect(parseWizardStorage("postgres", "cloud", "postgres")).toBe("dynamodb");
    expect(parseWizardStorage("neon", "cloud", "postgres")).toBe("dynamodb");
    expect(parseWizardStorage("aurora", "cloud", "postgres")).toBe("dynamodb");
    expect(isValidWizardStorage("postgres", "cloud")).toBe(false);
    expect(isValidWizardStorage("dynamodb", "cloud")).toBe(true);
    expect(isValidWizardStorage("neon", "cloud")).toBe(false);
    expect(isValidWizardStorage("aurora", "cloud")).toBe(false);
  });

  it("uses Postgres exclusively for local setup, ignoring stale preferences and lab fallbacks", () => {
    expect(parseWizardStorage(null, "local", "postgres")).toBe("postgres");
    expect(isValidWizardStorage("postgres", "local")).toBe(true);
    expect(isValidWizardStorage("neon", "local")).toBe(false);
    expect(isValidWizardStorage("dynamodb", "local")).toBe(false);
    expect(parseWizardStorage("dynamodb", "local", "postgres")).toBe("postgres");
    expect(parseWizardStorage("dynamodb", "local", "dynamodb")).toBe("postgres");
    expect(parseWizardStorage(null, "local", "dynamodb")).toBe("postgres");
  });
});
