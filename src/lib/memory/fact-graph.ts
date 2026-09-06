/**
 * Fact associations — link extracted facts to summaries and related facts.
 */

import { formatFactValue } from "@/lib/memory/format";

export type FactAssociation = {
  factId: string;
  key: string;
  value: string;
  category: "identity" | "behavioral" | "other";
  confidence: number;
  source: string | null;
  updatedAt: string;
  relatedSummaries: {
    id: string;
    date: string;
    excerpt: string;
    turnsCovered: number;
  }[];
  relatedFacts: { key: string; value: string; reason: string }[];
  live: boolean;
};

const IDENTITY_KEYS = new Set([
  "name", "age", "occupation", "location", "project", "projects", "goals", "skills", "interests",
]);
const BEHAVIORAL_KEYS = new Set([
  "response_length", "preferred_response_length", "technical_level", "communication_style",
  "preferred_topics", "tone_preference", "feedback_style",
]);

function factCategory(key: string): FactAssociation["category"] {
  const k = key.toLowerCase();
  if (BEHAVIORAL_KEYS.has(k)) return "behavioral";
  if (IDENTITY_KEYS.has(k)) return "identity";
  return "other";
}

function searchTerms(key: string, value: string): string[] {
  const terms = new Set<string>();
  const display = formatFactValue(value);
  if (display !== "—") {
    display.split(/[,;·]/).map(t => t.trim()).filter(t => t.length > 2).forEach(t => terms.add(t.toLowerCase()));
  }
  key.replace(/_/g, " ").split(/\s+/).filter(t => t.length > 3).forEach(t => terms.add(t.toLowerCase()));
  return [...terms];
}

function excerptAround(text: string, term: string, radius = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(term.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2) + (text.length > radius * 2 ? "…" : "");
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

type FactInput = {
  id: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  updatedAt: string;
};

type SummaryInput = {
  id: string;
  summary: string;
  turnsCovered: number;
  session: { createdAt: string };
};

export function buildFactAssociations(
  facts: FactInput[],
  summaries: SummaryInput[],
): FactAssociation[] {
  const visible = facts.filter(f => formatFactValue(f.value) !== "—");

  return visible.map(fact => {
    const terms = searchTerms(fact.key, fact.value);
    const relatedSummaries = summaries
      .map(s => {
        const match = terms.find(t => s.summary.toLowerCase().includes(t));
        if (!match && !s.summary.toLowerCase().includes(fact.key.replace(/_/g, " "))) return null;
        const term = match ?? fact.key.replace(/_/g, " ");
        return {
          id: s.id,
          date: s.session.createdAt,
          excerpt: excerptAround(s.summary, term),
          turnsCovered: s.turnsCovered,
        };
      })
      .filter(Boolean) as FactAssociation["relatedSummaries"];

    const relatedFacts = visible
      .filter(other => other.id !== fact.id)
      .map(other => {
        const reasons: string[] = [];
        const catA = factCategory(fact.key);
        const catB = factCategory(other.key);
        if (catA === catB && catA !== "other") reasons.push(`Same category (${catA})`);
        const factTerms = searchTerms(fact.key, fact.value);
        const otherVal = formatFactValue(other.value).toLowerCase();
        if (factTerms.some(t => otherVal.includes(t))) reasons.push("Shared topic or value");
        if (fact.source && fact.source === other.source) reasons.push("Extracted from same session");
        if (!reasons.length) return null;
        return {
          key: other.key,
          value: formatFactValue(other.value),
          reason: reasons[0]!,
        };
      })
      .filter(Boolean)
      .slice(0, 6) as FactAssociation["relatedFacts"];

    return {
      factId: fact.id,
      key: fact.key,
      value: formatFactValue(fact.value),
      category: factCategory(fact.key),
      confidence: fact.confidence,
      source: fact.source,
      updatedAt: fact.updatedAt,
      relatedSummaries,
      relatedFacts,
      live: fact.id.startsWith("live-"),
    };
  });
}

export function categoryLabel(cat: FactAssociation["category"]): string {
  switch (cat) {
    case "identity": return "Identity";
    case "behavioral": return "Communication";
    default: return "Other";
  }
}
