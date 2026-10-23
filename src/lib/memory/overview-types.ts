/** Shape of GET /api/memory/overview. Counts and names only. */

export type MemoryOverviewDocument = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  chunkCount: number;
  redactionCount: number;
  createdAt: string;
};

export type MemoryOverview = {
  documents: MemoryOverviewDocument[];
  /** Null when no answers have been recorded for this workspace yet. */
  evidence: {
    answers: number;
    usedKnowledgeRate: number | null;
    citedRate: number | null;
    groundedRate: number | null;
  } | null;
  /** Null when nothing has been replaced in this workspace yet. */
  privacy: {
    itemsReplaced: number;
    byCategory: Array<{ category: string; count: number }>;
    bySource: Array<{ source: string; count: number }>;
  } | null;
};

const SOURCE_LABELS: Record<string, string> = {
  investigate: "Chat messages",
  knowledge_document: "Uploaded documents",
  image_ocr: "Images",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}

const ACRONYMS = new Set(["aws", "api", "ip", "ssn", "sin", "url", "id", "jwt", "pii", "gcp", "ssh", "iban"]);

export function categoryLabel(category: string): string {
  const words = category.split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return "Other";
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

export function percent(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return Math.max(0, Math.min(100, Math.round(rate * 100)));
}
