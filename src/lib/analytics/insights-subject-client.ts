/** Browser stash so Admin → View keeps the subject even if the query string is dropped. */

import type { InsightsSubjectScope } from "@/components/analytics/analytics-shell";

export const INSIGHTS_SUBJECT_KEY = "sm_insights_subject";

export function stashInsightsSubject(subject: InsightsSubjectScope | null) {
  if (typeof window === "undefined") return;
  try {
    if (!subject?.userId) {
      sessionStorage.removeItem(INSIGHTS_SUBJECT_KEY);
      return;
    }
    sessionStorage.setItem(INSIGHTS_SUBJECT_KEY, JSON.stringify(subject));
  } catch {
    /* quota / private mode */
  }
}

export function readStashedInsightsSubject(): InsightsSubjectScope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(INSIGHTS_SUBJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InsightsSubjectScope;
    if (!parsed?.userId || typeof parsed.userId !== "string") return null;
    return {
      userId: parsed.userId,
      label:
        typeof parsed.label === "string" && parsed.label.trim()
          ? parsed.label
          : parsed.userId === "local"
            ? "Local user"
            : parsed.userId,
      email: typeof parsed.email === "string" ? parsed.email : null,
    };
  } catch {
    return null;
  }
}
