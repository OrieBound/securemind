"use client";

/**
 * Settings → Models catalog: browse every chat model this instance can reach.
 * Assignment stays on Complexity tiers — this list does not pick a route.
 */

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
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

/** How a saved vendor key should describe its models: listed from the key, in menus after Enable succeeds. */
export function vendorMenuPhrase(listed: number, inMenus: number): string | null {
  if (listed <= 0) return null;
  if (inMenus >= listed) return `${listed} in menus`;
  if (inMenus <= 0) return `${listed} listed · enable to use`;
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

/**
 * Where each model belongs in Settings. Only models that answered a test (or are installed locally)
 * feed chat menus. Models that failed here are kept apart so they never look usable.
 */
export type ModelGroups = {
  inMenus: CatalogModel[];
  /** Work here, but hidden from the menus on purpose. */
  hidden: CatalogModel[];
  /** Listed by the vendor, not tested yet. */
  notChecked: CatalogModel[];
  /** Tested here and did not answer. */
  failed: CatalogModel[];
};

export function partitionModels(models: CatalogModel[]): ModelGroups {
  const groups: ModelGroups = { inMenus: [], hidden: [], notChecked: [], failed: [] };
  for (const m of models) {
    if (isChatSelectableModel(m)) groups.inMenus.push(m);
    else if (m.verification === "failed") groups.failed.push(m);
    else if (m.hidden && (m.verification === "verified" || m.verification === "installed")) groups.hidden.push(m);
    else groups.notChecked.push(m);
  }
  return groups;
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
  onEnableRecommendedBedrock,
  recommendedBedrock,
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
  /** One click: test and turn on the recommended Bedrock models. Admin only. */
  onEnableRecommendedBedrock?: () => void;
  recommendedBedrock?: { available: boolean; busy: boolean; message: string | null };
}) {
  const [notCheckedOpen, setNotCheckedOpen] = useState(false);
  const notCheckedRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => partitionModels(models), [models]);
  const inMenus = groups.inMenus;
  const notInMenus = useMemo(
    () => [...groups.notChecked, ...groups.hidden, ...groups.failed],
    [groups],
  );
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
          Chat uses the models in this list, from every key that works. Models that have not been tested, are hidden, or do not answer here stay in the sections below.
        </p>
      ) : (
        <div className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-3">
          <p className="text-sm font-semibold text-foreground/90">
            Showing {providerLabel(providerFilter)} models
          </p>
          <p className="mt-1 text-[0.8rem] text-foreground/60 leading-relaxed">
            {filteredInMenus.length} ready for chat
            {filteredNotInMenus.length > 0 ? ` · ${filteredNotInMenus.length} still need Enable` : ""}.
            You opened this list from Connections. Enable adds a model to chat when it answers.
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

      {onTest && groups.notChecked.length > 0 && (
        <AddModelsPanel
          untested={groups.notChecked.length}
          inChat={inMenus.length}
          recommended={onEnableRecommendedBedrock && recommendedBedrock ? { ...recommendedBedrock, run: onEnableRecommendedBedrock } : null}
          onBrowse={() => {
            onProviderFilterChange?.("all");
            setNotCheckedOpen(true);
            requestAnimationFrame(() => notCheckedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}
        />
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

      <div ref={notCheckedRef} className="scroll-mt-4">
      <ModelGroupSection
        title="Not in chat yet"
        note="Press Enable on a model to test it once. A model that answers is added to the chat menus. If it cannot answer, it moves to Doesn't work here."
        emphasis
        open={notCheckedOpen || (providerFilter !== "all" && groups.notChecked.some(m => m.provider === providerFilter))}
        onOpenChange={setNotCheckedOpen}
        models={groups.notChecked}
        providerFilter={providerFilter}
        complexityTiers={complexityTiers}
        onTest={onTest}
        onToggleVisibility={onToggleVisibility}
        results={results}
        onProviderFilterChange={onProviderFilterChange}
      />
      </div>
      <ModelGroupSection
        title="Hidden from menus"
        note="These work here. You hid them, so chat does not offer them."
        models={groups.hidden}
        providerFilter={providerFilter}
        complexityTiers={complexityTiers}
        onTest={onTest}
        onToggleVisibility={onToggleVisibility}
        results={results}
        onProviderFilterChange={onProviderFilterChange}
      />
      <ModelGroupSection
        title="Doesn't work here"
        note="These were tested in this environment and did not answer. They are kept so you can try again after fixing access, a region or a network block."
        models={groups.failed}
        providerFilter={providerFilter}
        complexityTiers={complexityTiers}
        onTest={onTest}
        onToggleVisibility={onToggleVisibility}
        results={results}
        onProviderFilterChange={onProviderFilterChange}
        tone="problem"
      />
    </div>
  );
}

function ModelGroupSection({
  title,
  note,
  models,
  providerFilter,
  complexityTiers,
  onTest,
  onToggleVisibility,
  results,
  onProviderFilterChange,
  tone = "neutral",
  emphasis = false,
  open,
  onOpenChange,
}: {
  title: string;
  note: string;
  /** Draws attention to a section the reader needs to open to finish setup. */
  emphasis?: boolean;
  /** Controlled open state. Leave unset for the default behavior. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  models: CatalogModel[];
  providerFilter: ModelProviderId | "all";
  complexityTiers: ComplexityTiersBind | null;
  onTest?: (model: CatalogModel) => void;
  onToggleVisibility?: (model: CatalogModel) => Promise<void>;
  results?: Record<string, ModelTestResult>;
  onProviderFilterChange?: (next: ModelProviderId | "all") => void;
  tone?: "neutral" | "problem";
}) {
  const shown = providerFilter === "all" ? models : models.filter(m => m.provider === providerFilter);
  if (models.length === 0) return null;
  return (
    <details
      key={open === undefined ? providerFilter : undefined}
      open={open === undefined ? providerFilter !== "all" && shown.length > 0 : open}
      onToggle={open === undefined ? undefined : event => onOpenChange?.(event.currentTarget.open)}
      className={cn(
        "rounded-lg border bg-card",
        tone === "problem" ? "border-red-500/30" : emphasis ? "border-indigo-400/40 bg-indigo-500/[0.06]" : "border-border",
      )}
    >
      <summary className={cn(
        "flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm font-medium",
        emphasis ? "text-foreground/90" : "text-foreground/80",
      )}>
        <span>{title} · {shown.length}</span>
        {emphasis && (
          <span className="shrink-0 rounded-full border border-indigo-400/40 px-2.5 py-0.5 text-[0.72rem] text-indigo-200">
            {open ? "Hide list" : "Show list"}
          </span>
        )}
      </summary>
      <div className="border-t border-border px-2 py-2">
        <p className="px-1.5 pb-2 text-sm text-foreground/65">{note}</p>
        <ModelPickerList
          models={models}
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
  );
}

/**
 * Always-visible nudge above the model list. Models only reach chat after a test passes, and the
 * untested ones sit in a collapsed list, so this says so up front and offers the two ways forward.
 */
function AddModelsPanel({
  untested,
  inChat,
  recommended,
  onBrowse,
}: {
  untested: number;
  inChat: number;
  recommended: { available: boolean; busy: boolean; message: string | null; run: () => void } | null;
  onBrowse: () => void;
}) {
  return (
    <div className="rounded-xl border border-indigo-400/35 bg-indigo-500/[0.08] px-4 py-3.5" role="region" aria-label="Add models to chat">
      <p className="text-sm font-semibold text-foreground/90">
        {inChat === 0 ? "No models are in chat yet" : `${untested} more ${untested === 1 ? "model is" : "models are"} ready to add`}
      </p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-foreground/65">
        {untested} {untested === 1 ? "model was" : "models were"} found for your connections, but a model only appears in chat after it answers a quick test.
        Each test is one tiny request.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {recommended?.available && (
          <button
            type="button"
            disabled={recommended.busy}
            onClick={recommended.run}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
          >
            {recommended.busy ? "Enabling…" : "Enable recommended Bedrock models"}
          </button>
        )}
        <button
          type="button"
          onClick={onBrowse}
          className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-sm font-medium text-foreground/85 hover:bg-foreground/[0.06] cursor-pointer"
        >
          Choose from all {untested}
        </button>
      </div>
      {recommended?.available && !recommended.message && (
        <p className="mt-2 text-[0.72rem] text-foreground/50">
          Tests Amazon Nova Lite and Claude Haiku once each, and adds the ones that answer.
        </p>
      )}
      {recommended?.message && (
        <p className="mt-2 text-[0.8rem] leading-relaxed text-foreground/75" role="status">{recommended.message}</p>
      )}
    </div>
  );
}
