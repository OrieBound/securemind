import { describe, expect, it } from "vitest";
import { categoryLabel, percent, sourceLabel } from "./overview-types";

describe("memory overview labels", () => {
  it("turns detection categories into readable labels with proper acronyms", () => {
    expect(categoryLabel("email_address")).toBe("Email address");
    expect(categoryLabel("aws_access_key")).toBe("AWS access key");
    expect(categoryLabel("ip-address")).toBe("IP address");
    expect(categoryLabel("")).toBe("Other");
  });

  it("names where a replacement happened", () => {
    expect(sourceLabel("investigate")).toBe("Chat messages");
    expect(sourceLabel("knowledge_document")).toBe("Uploaded documents");
    expect(sourceLabel("image_ocr")).toBe("Images");
    expect(sourceLabel("something_new")).toBe("something new");
  });

  it("turns a rate into a whole percentage and tolerates missing data", () => {
    expect(percent(0.416)).toBe(42);
    expect(percent(1.4)).toBe(100);
    expect(percent(null)).toBeNull();
    expect(percent(Number.NaN)).toBeNull();
  });
});
