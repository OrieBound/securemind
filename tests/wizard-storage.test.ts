import { describe, expect, it } from "vitest";
import { isValidWizardStorage, parseWizardStorage } from "@/lib/wizard-storage";

describe("wizard storage choices", () => {
  it("defaults hosted installs to DynamoDB and never offers Postgres there", () => {
    expect(parseWizardStorage(null, "cloud", "postgres")).toBe("dynamodb");
    expect(parseWizardStorage("postgres", "cloud", "postgres")).toBe("dynamodb");
    expect(isValidWizardStorage("postgres", "cloud")).toBe(false);
    expect(isValidWizardStorage("dynamodb", "cloud")).toBe(true);
    expect(isValidWizardStorage("neon", "cloud")).toBe(true);
    expect(isValidWizardStorage("aurora", "cloud")).toBe(true);
  });

  it("keeps Postgres as the local default", () => {
    expect(parseWizardStorage(null, "local", "postgres")).toBe("postgres");
    expect(isValidWizardStorage("postgres", "local")).toBe(true);
    expect(isValidWizardStorage("neon", "local")).toBe(false);
  });
});
