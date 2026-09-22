/**
 * Picker search: match the friendly name and id, plus vendor shortcuts.
 * Family words (claude, nova) belong on the model, not on every Bedrock row.
 */

import type { RuntimeProviderId } from "@/lib/provider-theme";
import { themeForRuntime } from "@/lib/provider-theme";

export type ModelSearchFields = {
  id: string;
  name: string;
  provider: string;
  note?: string;
};

/** Vendor-only — not model families. "cla" must not list every Bedrock model. */
export const VENDOR_SEARCH_ALIASES: Record<RuntimeProviderId, string[]> = {
  groq: ["groq", "groc", "cloud"],
  bedrock: ["bedrock", "aws", "amazon"],
  ollama: ["ollama", "olama", "local", "on-prem", "onprem"],
  openai: ["openai"],
  anthropic: ["anthropic"],
  google: ["google", "gemini"],
  xai: ["xai", "x.ai"],
};

function tokensOf(raw: string): string[] {
  return raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function vendorMatches(provider: string, token: string): boolean {
  const label = themeForRuntime(provider).label.toLowerCase();
  if (token.length >= 2 && label.includes(token)) return true;
  const aliases = VENDOR_SEARCH_ALIASES[provider as RuntimeProviderId];
  if (!aliases) return false;
  return aliases.some(alias => {
    if (token === alias) return true;
    if (token.length >= 3 && alias.startsWith(token)) return true;
    if (token.length >= 3 && token.startsWith(alias)) return true;
    return false;
  });
}

function fieldsHaystack(m: ModelSearchFields): string {
  return `${m.name} ${m.id} ${m.note ?? ""}`.toLowerCase();
}

/** Every whitespace token must hit name, id, note, or the vendor. */
export function matchesModelQuery(m: ModelSearchFields, rawQuery: string): boolean {
  const tokens = tokensOf(rawQuery);
  if (tokens.length === 0) return true;
  const fields = fieldsHaystack(m);
  return tokens.every(t => fields.includes(t) || vendorMatches(m.provider, t));
}

/** Higher ranks first when the query is non-empty. */
export function modelQueryRank(m: ModelSearchFields, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 0;
  const name = m.name.toLowerCase();
  const id = m.id.toLowerCase();
  if (name === q) return 400;
  if (name.startsWith(q)) return 300;
  if (name.includes(q)) return 200;
  if (id.includes(q)) return 100;
  return 1;
}

export function compareModelsForQuery(
  a: ModelSearchFields,
  b: ModelSearchFields,
  rawQuery: string,
): number {
  if (!rawQuery.trim()) return 0;
  const rank = modelQueryRank(b, rawQuery) - modelQueryRank(a, rawQuery);
  if (rank !== 0) return rank;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

const GEO_PREFIX: Array<[string, string]> = [
  ["global.", "Global"],
  ["us.", "US"],
  ["eu.", "EU"],
  ["apac.", "APAC"],
];

/** Short row qualifier instead of the raw model id. Full id stays on the title tooltip. */
export function modelPickerHint(m: Pick<ModelSearchFields, "id" | "note">): string | null {
  const id = m.id.toLowerCase();
  for (const [prefix, label] of GEO_PREFIX) {
    if (id.startsWith(prefix)) return label;
  }
  const note = m.note?.trim();
  if (!note || note.startsWith("Add an API key")) return null;
  if (note === "Cross-region inference profile") return null;
  if (note === "Ollama · local") return null;
  return note;
}
