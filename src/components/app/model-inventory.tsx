"use client";

/**
 * Settings → Models catalog: browse every chat model this instance can reach.
 * Assignment stays on Complexity tiers — this list does not pick a route.
 */

import { useMemo } from "react";
import {
  ModelPickerList,
  isChatSelectableModel,
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
  "xai",
  "bedrock",
  "ollama",
];

/** How a saved vendor key should describe its models: listed from the key, in menus after a successful test. */
export function vendorMenuPhrase(listed: number, inMenus: number): string | null {
  if (listed <= 0) return null;
  if (inMenus >= listed) return `${listed} in menus`;
  if (inMenus <= 0) return `${listed} listed · test to use`;
  return `${inMenus} of ${listed} in menus`;
}

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
  if (model.access === "needs_enablement") {
    return "Listed for this region. Open Amazon Bedrock → Discover → Model catalog, open this model, and complete any Anthropic first-use form. Not Marketplace deployments. Chat cannot use it until that is done.";
  }
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

  if (model.provider === "xai") {
    if (id.includes("mini") || id.includes("fast")) return "Faster, lighter Grok chat.";
    return "Grok chat via xAI.";
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
  onToggleVisibility,
  results,
  emptyLabel,
  blockedNotice,
  providerFilter = "all",
  onProviderFilterChange,
}: {
  models: CatalogModel[];
  loading?: boolean;
  errors?: string[];
  complexityTiers: ComplexityTiersBind | null;
  onTest?: (model: CatalogModel) => void;
  onToggleVisibility?: (model: CatalogModel) => Promise<void>;
  results?: Record<string, ModelTestResult>;
  emptyLabel: string;
  /** Keys saved in Providers that the live catalog cannot list yet. */
  blockedNotice?: string | null;
  providerFilter?: ModelProviderId | "all";
  onProviderFilterChange?: (next: ModelProviderId | "all") => void;
}) {
  const inMenus = useMemo(() => models.filter(isChatSelectableModel), [models]);
  const notInMenus = useMemo(() => models.filter(m => !isChatSelectableModel(m)), [models]);
  const counts = useMemo(() => providerCountsLine(inMenus), [inMenus]);
  const filteredNotInMenus = useMemo(
    () => providerFilter === "all" ? notInMenus : notInMenus.filter(m => m.provider === providerFilter),
    [notInMenus, providerFilter],
  );
  const filteredInMenus = useMemo(
    () => providerFilter === "all" ? inMenus : inMenus.filter(m => m.provider === providerFilter),
    [inMenus, providerFilter],
  );
  const needsEnablement = models.some(m => m.access === "needs_enablement");
  const visibleErrors = (errors ?? []).filter(err => {
    if (providerFilter === "all") return true;
    const text = err.toLowerCase();
    const names = [providerFilter, providerLabel(providerFilter).toLowerCase()];
    if (providerFilter === "google") names.push("gemini");
    if (providerFilter === "xai") names.push("grok");
    return names.some(name => text.includes(name));
  });

  return (
    <div className="space-y-3">
      {providerFilter === "all" ? (
        <p className="text-sm text-foreground/60 leading-relaxed">
          Chat uses the models in this list. Untested ones stay under Not in menus until a test succeeds.
        </p>
      ) : (
        <div className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-3">
          <p className="text-sm font-semibold text-foreground/90">
            Showing {providerLabel(providerFilter)} models
          </p>
          <p className="mt-1 text-[0.8rem] text-foreground/60 leading-relaxed">
            {filteredInMenus.length} ready for chat
            {filteredNotInMenus.length > 0 ? ` · ${filteredNotInMenus.length} still need a test` : ""}.
            You opened this list from Connections. A successful test moves a model into chat.
          </p>
          {onProviderFilterChange && (
            <button
              type="button"
              onClick={() => onProviderFilterChange("all")}
              className="mt-2 text-[0.78rem] font-medium text-indigo-200 underline underline-offset-2 cursor-pointer"
            >
              Show every vendor
            </button>
          )}
        </div>
      )}

      {needsEnablement && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[0.65rem] text-amber-100/90 leading-relaxed">
          Some Bedrock models are listed but not turned on for this account. In AWS, open Bedrock → Discover → Model catalog and enable the model. They stay out of chat until then.
        </p>
      )}

      {counts && inMenus.length > 0 && providerFilter === "all" && (
        <p className="text-[0.65rem] text-foreground/50">{counts}</p>
      )}

      {blockedNotice && (
        <p className="text-[0.62rem] text-amber-200/80 leading-relaxed">{blockedNotice}</p>
      )}

      {loading && models.length === 0 && (
        <p className="text-xs text-foreground/35">Loading catalog…</p>
      )}
      {visibleErrors.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
          {visibleErrors.map(err => (
            <p key={err} className="text-[0.65rem] text-amber-100/90 leading-relaxed">
              {err}
            </p>
          ))}
        </div>
      )}

      {(models.length > 0 || !loading) && (
        <ModelPickerList
          models={inMenus}
          browse
          blurbFor={modelBlurb}
          assignedTiersFor={id => assignedTiers(complexityTiers, id)}
          onTest={onTest}
          onToggleVisibility={onToggleVisibility}
          results={results}
          alwaysShowProviderFilters
          providerFilter={providerFilter}
          onProviderFilterChange={onProviderFilterChange}
          maxHeightClass="max-h-[min(32rem,70vh)]"
          emptyLabel={inMenus.length === 0 && notInMenus.length > 0 ? "Nothing in menus yet." : emptyLabel}
        />
      )}

      {notInMenus.length > 0 && (
        <details
          key={providerFilter}
          open={providerFilter !== "all" && filteredNotInMenus.length > 0}
          className="rounded-lg border border-border bg-card"
        >
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-foreground/80">
            Not in chat yet · {filteredNotInMenus.length}
          </summary>
          <div className="border-t border-border px-2 py-2">
            <p className="px-1.5 pb-2 text-sm text-foreground/65">
              Check access tries each listed model once. A model that answers is added to the chat menus. Test still checks one model on its own.
            </p>
            <ModelPickerList
              models={notInMenus}
              browse
              blurbFor={modelBlurb}
              assignedTiersFor={id => assignedTiers(complexityTiers, id)}
              onTest={onTest}
              onToggleVisibility={onToggleVisibility}
              results={results}
              alwaysShowProviderFilters
              providerFilter={providerFilter}
              onProviderFilterChange={onProviderFilterChange}
              maxHeightClass="max-h-[min(24rem,50vh)]"
              emptyLabel="None."
            />
          </div>
        </details>
      )}
    </div>
  );
}
