/**
 * Curated model lists for UI pickers when a vendor has no live catalog yet.
 * Live catalog entries always win on id collision — reference rows are browse-only
 * until an API key (or Bedrock / Ollama setup) makes them routable.
 */

import type { CatalogModel } from "./catalog-shared";
import { BEDROCK_TEXT_MODELS } from "./catalog-shared";

export const UNCONFIGURED_VENDOR_NOTE =
  "Add an API key in Settings → Models to use this model.";

/** Router defaults + common Groq chat models. */
export const REFERENCE_GROQ: CatalogModel[] = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq", modality: "text" },
  { id: "qwen/qwen3-32b", name: "Qwen3 32B", provider: "groq", modality: "text" },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", provider: "groq", modality: "text" },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B",
    provider: "groq",
    modality: "text",
  },
  { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", provider: "groq", modality: "text" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: "groq", modality: "text" },
];

export const REFERENCE_OPENAI: CatalogModel[] = [
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", modality: "text" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", modality: "text" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", modality: "text" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", modality: "text" },
  { id: "o1", name: "o1", provider: "openai", modality: "text" },
  { id: "o3-mini", name: "o3-mini", provider: "openai", modality: "text" },
];

export const REFERENCE_ANTHROPIC: CatalogModel[] = [
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", modality: "text" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", modality: "text" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", modality: "text" },
];

export const REFERENCE_GOOGLE: CatalogModel[] = [
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", modality: "text" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google", modality: "text" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "google", modality: "text" },
];

export const REFERENCE_OLLAMA: CatalogModel[] = [
  {
    id: "llama3.2",
    name: "Llama 3.2",
    provider: "ollama",
    modality: "text",
    note: "Pull locally: ollama pull llama3.2",
  },
  {
    id: "mistral",
    name: "Mistral",
    provider: "ollama",
    modality: "text",
    note: "Pull locally: ollama pull mistral",
  },
];

export type ReferenceCatalogSlice = Pick<
  ModelCatalogShape,
  "groq" | "bedrock" | "ollama" | "openai" | "anthropic" | "google" | "xai"
>;

type ModelCatalogShape = {
  groq: CatalogModel[];
  bedrock: CatalogModel[];
  ollama: CatalogModel[];
  openai: CatalogModel[];
  anthropic: CatalogModel[];
  google: CatalogModel[];
  xai: CatalogModel[];
};

export function isReferenceOnlyModel(model: Pick<CatalogModel, "note">): boolean {
  return model.note === UNCONFIGURED_VENDOR_NOTE;
}

export function mergeProviderModels(live: CatalogModel[], reference: CatalogModel[]): CatalogModel[] {
  const byId = new Map(live.map(m => [m.id, m]));
  for (const ref of reference) {
    if (!byId.has(ref.id)) {
      byId.set(ref.id, {
        ...ref,
        note: ref.note ?? UNCONFIGURED_VENDOR_NOTE,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Flat list for pickers — live catalog merged with curated reference rows. */
export function mergeCatalogWithReference(catalog: ReferenceCatalogSlice): CatalogModel[] {
  return [
    ...mergeProviderModels(catalog.groq, REFERENCE_GROQ),
    ...mergeProviderModels(catalog.openai, REFERENCE_OPENAI),
    ...mergeProviderModels(catalog.anthropic, REFERENCE_ANTHROPIC),
    ...mergeProviderModels(catalog.google, REFERENCE_GOOGLE),
    ...(catalog.xai ?? []),
    ...(catalog.bedrock.length > 0
      ? catalog.bedrock
      : mergeProviderModels(catalog.bedrock, BEDROCK_TEXT_MODELS)),
    ...mergeProviderModels(catalog.ollama, REFERENCE_OLLAMA),
  ];
}

export function flattenLiveCatalog(catalog: ReferenceCatalogSlice): CatalogModel[] {
  return [
    ...catalog.groq,
    ...catalog.openai,
    ...catalog.anthropic,
    ...catalog.google,
    ...(catalog.xai ?? []),
    ...catalog.bedrock,
    ...catalog.ollama,
  ];
}
