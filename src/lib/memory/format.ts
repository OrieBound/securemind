/** Shared format helpers for memory facts (client + server safe). */

/** A fact key as it is stored and compared: trimmed, with inner whitespace collapsed. */
export function normalizeFactKey(key: string): string {
  return key.trim().replace(/\s+/g, " ");
}

export function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function formatFactValue(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "[object Object]") return "—";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return formatFactValue(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(raw)) {
    return raw.map(v => formatFactValue(v)).filter(v => v !== "—").join(", ") || "—";
  }
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => {
        const val = formatFactValue(v);
        return val === "—" ? null : `${humanizeKey(k)}: ${val}`;
      })
      .filter(Boolean)
      .join(" · ") || "—";
  }
  return String(raw);
}
