"use client";

/**
 * Settings → Models catalog: browse every chat model this instance can reach.
 * Assignment stays on Complexity tiers — this list does not pick a route.
 */

import { useMemo } from "react";
import {
  ModelPickerList,
  providerLabel,
  type CatalogModel,
  type ModelProviderId,
  type ModelTestResult,
} from "@/components/app/model-catalog";
import { COMPLEXITY_TIER_NAMES } from "@/lib/models/tier-assignment";
import type { ComplexityTiersBind } from "@/components/app/complexity-tiers-editor";

const PROVIDER_ORDER: ModelProviderId[] = [
  "groq",
  "openai",
  "anthropic",
  "google",
  "bedrock",
  "ollama",
];

export function providerCountsLine(models: CatalogModel[]): string {
  const counts = Object.fromEntries(PROVIDER_ORDER.map(p => [p, 0])) as Record<ModelProviderId, number>;
  for (const m of models) counts[m.provider] += 1;
  return PROVIDER_ORDER.filter(p => counts[p] > 0)
    .map(p => `${providerLabel(p)} ${counts[p]}`)
    .join(" · ");
}

/** One-line orientation — not a quality ranking or a capability guarantee. */
export function modelBlurb(model: CatalogModel): string {
  const note = model.note?.trim();
  if (note && !note.startsWith("Add an API key")) {
    if (note === "Ollama · local") return "Runs on this machine via Ollama.";
    if (note === "Ollama · not for chat") return "Installed in Ollama — not used for chat.";
    if (note === "Cross-region inference profile") return "Amazon Bedrock via a cross-region inference profile.";
    return note;
  }

  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();

  if (model.modality === "vision") return "Chat, including images.";

  if (model.provider === "google") {
    if (id.includes("flash-lite") || id.includes("flash_lite") || name.includes("flash-lite")) {
      return "Fast, inexpensive Gemini.";
    }
    if (id.includes("flash") || name.includes("flash")) return "Balanced Gemini speed and quality.";
    if (id.includes("pro") || name.includes("pro")) return "Higher-capacity Gemini.";
    if (id.includes("gemma") || name.includes("gemma")) return "Gemma via Google.";
    return "Google Gemini chat.";
  }

  if (model.provider === "groq") {
    if (id.includes("scout")) return "Groq chat; can take images.";
    if (id.includes("70b") || id.includes("120b") || id.includes("versatile")) {
      return "Larger Groq chat model.";
    }
    if (id.includes("instant") || id.includes("8b") || id.includes("20b") || id.includes("lite")) {
      return "Faster, inexpensive Groq chat.";
    }
    return "Cloud chat via Groq.";
  }

  if (model.provider === "openai") {
    if (id.includes("mini") || id.includes("nano")) return "Faster, lighter OpenAI chat.";
    return "OpenAI chat.";
  }

  if (model.provider === "anthropic") {
    if (id.includes("haiku")) return "Faster Anthropic chat.";
    return "Anthropic Claude chat.";
  }

  if (model.provider === "bedrock") return "Amazon Bedrock chat.";
  if (model.provider === "ollama") return "Runs on this machine via Ollama.";
  return "Chat model from a configured provider.";
}

function assignedTiers(bind: ComplexityTiersBind | null, modelId: string): string[] {
  if (!bind) return [];
  if (bind.modelSelectionMode === "fixed") {
    return bind.fixedModelId === modelId ? ["Fixed"] : [];
  }
  return COMPLEXITY_TIER_NAMES.filter(tier => bind.displayModelFor(tier) === modelId);
}

export function ModelInventory({
  models,
  loading,
  errors,
  complexityTiers,
  onTest,
  results,
  emptyLabel,
  blockedNotice,
}: {
  models: CatalogModel[];
  loading?: boolean;
  errors?: string[];
  complexityTiers: ComplexityTiersBind | null;
  onTest?: (model: CatalogModel) => void;
  results?: Record<string, ModelTestResult>;
  emptyLabel: string;
  /** Keys saved in Providers that the live catalog cannot list yet. */
  blockedNotice?: string | null;
}) {
  const counts = useMemo(() => providerCountsLine(models), [models]);

  return (
    <div className="space-y-3">
      <p className="text-[0.62rem] text-foreground/38 leading-relaxed">
        Every chat-capable model this instance can reach — Groq, Google, OpenAI, Anthropic,
        Bedrock, and Ollama. Embedding-only models are omitted. Assign what chat uses in{" "}
        <span className="text-foreground/55">Complexity tiers</span>. Credentials live in{" "}
        <span className="text-foreground/55">Providers</span>.{" "}
        <span className="text-foreground/55">Test</span> sends a short reachability call.
      </p>

      {counts && models.length > 0 && (
        <p className="text-[0.65rem] text-foreground/50">{counts}</p>
      )}

      {blockedNotice && (
        <p className="text-[0.62rem] text-amber-200/80 leading-relaxed">{blockedNotice}</p>
      )}

      {loading && models.length === 0 && (
        <p className="text-xs text-foreground/35">Loading catalog…</p>
      )}
      {errors && errors.length > 0 && (
        <p className="text-[0.65rem] text-amber-200/80">{errors.join(" · ")}</p>
      )}

      {(models.length > 0 || !loading) && (
        <ModelPickerList
          models={models}
          browse
          blurbFor={modelBlurb}
          assignedTiersFor={id => assignedTiers(complexityTiers, id)}
          onTest={onTest}
          results={results}
          alwaysShowProviderFilters
          maxHeightClass="max-h-[min(32rem,70vh)]"
          emptyLabel={emptyLabel}
        />
      )}
    </div>
  );
}
