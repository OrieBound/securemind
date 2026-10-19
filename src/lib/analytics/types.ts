export type SecuritySource = "investigate" | "knowledge_document" | "image_ocr";
export type SecurityOutcome =
  | "redacted"
  | "blocked"
  | "safe_listed"
  | "dismissed"
  | "reviewed";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type InferenceStatus = "ok" | "error" | "aborted";
export type GroundingStatus =
  | "not_applicable"
  | "grounded"
  | "partial"
  | "uncited"
  | "invalid"
  | "declined"
  | "insufficient_evidence"
  /** @deprecated Prefer not_applicable — kept for older InferenceEvent rows. */
  | "n/a";

export type AnalyticsRange = "today" | "7d" | "30d" | "all";

export function riskLevelForCategory(category: string): RiskLevel {
  const c = category.toLowerCase();
  if (c === "secret" || c === "ssn" || c.includes("card")) return "critical";
  if (c === "email" || c === "phone" || c === "id number") return "high";
  if (c === "ipv4" || c === "address") return "medium";
  return "low";
}

export function resolveDateRange(range: AnalyticsRange): { from: Date | null; to: Date } {
  const to = new Date();
  if (range === "all") return { from: null, to };
  const from = new Date(to);
  if (range === "today") {
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  if (range === "7d") {
    from.setDate(from.getDate() - 7);
    return { from, to };
  }
  from.setDate(from.getDate() - 30);
  return { from, to };
}
