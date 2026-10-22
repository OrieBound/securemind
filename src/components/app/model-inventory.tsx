"use client";

/**
 * Settings → Models catalog: browse every chat model this instance can reach.
 * Assignment stays on Complexity tiers — this list does not pick a route.
 */

import { useMemo, useState } from "react";
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

export type InventoryView = "chat" | "add" | "broken" | "hidden";

/** The tab a reader should land on: where the next useful thing to do is. */
export function defaultInventoryView(groups: ModelGroups): InventoryView {
  return groups.inMenus.length === 0 && groups.notChecked.length > 0 ? "add" : "chat";
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
  awsEnableUrl,
  view: controlledView,
  onViewChange,
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
  /** Where an administrator turns Bedrock models on in AWS. */
  awsEnableUrl?: string;
  /** Selected tab. Leave unset to let the list choose. */
  view?: InventoryView | null;
  onViewChange?: (view: InventoryView) => void;
}) {
  const groups = useMemo(() => partitionModels(models), [models]);
  const [ownView, setOwnView] = useState<InventoryView | null>(null);
  const picked = controlledView !== undefined ? controlledView : ownView;
  const setView = (next: InventoryView) => {
    if (onViewChange) onViewChange(next);
    else setOwnView(next);
  };
  const view: InventoryView =
    picked && (picked !== "hidden" || groups.hidden.length > 0) ? picked : defaultInventoryView(groups);

  const counts = useMemo(() => providerCountsLine(groups.inMenus), [groups.inMenus]);
  const needsEnablement = groups.notChecked.some(m => m.access === "needs_enablement");
  const visibleErrors = (errors ?? []).filter(err => {
    if (providerFilter === "all") return true;
    const text = err.toLowerCase();
    const names = [providerFilter, providerLabel(providerFilter).toLowerCase()];
    if (providerFilter === "google") names.push("gemini");
    if (providerFilter === "xai") names.push("grok");
    return names.some(name => text.includes(name));
  });

  const tabs: { id: InventoryView; label: string; count: number; attention?: boolean }[] = [
    { id: "chat", label: "In chat", count: groups.inMenus.length },
    { id: "add", label: "Add more", count: groups.notChecked.length, attention: groups.notChecked.length > 0 },
    { id: "broken", label: "Not working", count: groups.failed.length },
    ...(groups.hidden.length > 0 ? [{ id: "hidden" as const, label: "Hidden", count: groups.hidden.length }] : []),
  ];

  const listFor = (items: CatalogModel[], maxHeightClass: string, empty: string) => (
    <ModelPickerList
      models={items}
      browse
      blurbFor={modelBlurb}
      assignedTiersFor={id => assignedTiers(complexityTiers, id)}
      onTest={onTest}
      onToggleVisibility={onToggleVisibility}
      results={results}
      alwaysShowProviderFilters
      providerFilter={providerFilter}
      onProviderFilterChange={onProviderFilterChange}
      awsEnableUrl={awsEnableUrl}
      maxHeightClass={maxHeightClass}
      emptyLabel={empty}
    />
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-foreground/75 leading-relaxed">
          Chat can use the models under <span className="font-medium text-foreground/90">In chat</span>. A model gets there after it answers one quick test, and{" "}
          <span className="font-medium text-foreground/90">Add more</span> is where you run those tests.
        </p>
        {counts && providerFilter === "all" && groups.inMenus.length > 0 && (
          <p className="mt-1.5 text-xs text-foreground/50">{counts}</p>
        )}
      </div>

      {blockedNotice && <p className="text-[0.62rem] text-amber-200/80 leading-relaxed">{blockedNotice}</p>}
      {loading && models.length === 0 && <p className="text-xs text-foreground/35">Loading catalog…</p>}
      {visibleErrors.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
          {visibleErrors.map(err => (
            <p key={err} className="text-[0.65rem] text-amber-100/90 leading-relaxed">{err}</p>
          ))}
        </div>
      )}

      <div role="tablist" aria-label="Model list" className="flex flex-wrap gap-1 border-b border-foreground/10">
        {tabs.map(tab => {
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`models-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`models-panel-${tab.id}`}
              onClick={() => setView(tab.id)}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium cursor-pointer transition-colors",
                active ? "border-[var(--primary)] text-foreground" : "border-transparent text-foreground/55 hover:text-foreground/85",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.7rem] tabular-nums",
                  tab.attention && !active
                    ? "bg-indigo-500/25 text-indigo-100"
                    : "bg-foreground/[0.08] text-foreground/60",
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {view === "chat" && (
        <div id="models-panel-chat" role="tabpanel" aria-labelledby="models-tab-chat" className="space-y-3">
          <p className="text-[0.8rem] text-foreground/60 leading-relaxed">
            These answered a test and appear in chat. <span className="text-foreground/75">Re-check</span> runs the test again, useful if a key or plan changes. <span className="text-foreground/75">Hide</span> keeps a model out of the chat menus.
          </p>
          {listFor(
            groups.inMenus,
            "max-h-[min(32rem,70vh)]",
            groups.notChecked.length > 0 ? "Nothing is in chat yet. Open Add more to turn models on." : emptyLabel,
          )}
        </div>
      )}

      {view === "add" && (
        <div id="models-panel-add" role="tabpanel" aria-labelledby="models-tab-add" className="space-y-3">
          <p className="text-[0.8rem] text-foreground/60 leading-relaxed">
            These were found with your keys but have not answered a test yet. Press <span className="text-foreground/80">Enable</span> on a model: it gets one tiny test message, and if it answers it moves to In chat.
          </p>
          {recommendedBedrock?.available && onEnableRecommendedBedrock && (
            <div className="rounded-xl border border-indigo-400/35 bg-indigo-500/[0.08] px-4 py-3.5">
              <button
                type="button"
                disabled={recommendedBedrock.busy}
                onClick={onEnableRecommendedBedrock}
                className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
              >
                {recommendedBedrock.busy ? "Enabling…" : "Enable recommended Bedrock models"}
              </button>
              {!recommendedBedrock.message && (
                <p className="mt-2 text-[0.75rem] text-foreground/55">Tests Amazon Nova Lite and Claude Haiku once each and adds the ones that answer.</p>
              )}
              {recommendedBedrock.message && (
                <p className="mt-2 text-[0.8rem] leading-relaxed text-foreground/75" role="status">{recommendedBedrock.message}</p>
              )}
            </div>
          )}
          {needsEnablement && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3.5">
              <p className="text-[0.85rem] font-medium text-amber-50/95">Some Bedrock models need to be turned on in AWS first</p>
              <p className="mt-1 text-[0.78rem] leading-relaxed text-amber-100/80">
                Bedrock lists them, but your AWS account has not switched them on. SecureMind cannot do that for you. Turn on the ones you want in the AWS console, then come back and press Enable.
              </p>
              {awsEnableUrl && (
                <a
                  href={awsEnableUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[0.8rem] font-medium text-amber-50 hover:bg-amber-400/20"
                >
                  Open the Bedrock model catalog in AWS ↗
                </a>
              )}
            </div>
          )}
          {listFor(groups.notChecked, "max-h-[min(32rem,70vh)]", "Nothing waiting. Every model found has been tested.")}
        </div>
      )}

      {view === "broken" && (
        <div id="models-panel-broken" role="tabpanel" aria-labelledby="models-tab-broken" className="space-y-3">
          <p className="text-[0.8rem] text-foreground/60 leading-relaxed">
            These were tested here and did not answer, usually because your plan or AWS account does not include them. They are kept so you can try again after fixing access, a region or a network block.
          </p>
          {listFor(groups.failed, "max-h-[min(32rem,70vh)]", "Nothing failed a test.")}
        </div>
      )}

      {view === "hidden" && (
        <div id="models-panel-hidden" role="tabpanel" aria-labelledby="models-tab-hidden" className="space-y-3">
          <p className="text-[0.8rem] text-foreground/60 leading-relaxed">
            These work here. You hid them, so chat does not offer them. Press Show to bring one back.
          </p>
          {listFor(groups.hidden, "max-h-[min(24rem,50vh)]", "None.")}
        </div>
      )}
    </div>
  );
}
