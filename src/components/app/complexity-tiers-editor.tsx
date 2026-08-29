"use client";

/**
 * Complexity-tier (and fixed-model) assignment.
 * Used in the Insights rail (compact) and Settings → Models (full page).
 * Both share AppShell state so a change in either place applies immediately.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ModelPickerList,
  ProviderBadge,
  isChatSelectableModel,
  type CatalogModel,
  type ModelProviderId,
} from "@/components/app/model-catalog";
import { DEFAULT_TIER_MODELS } from "@/lib/models/tier-assignment";
import { isChatUsableModelId } from "@/lib/models/catalog-shared";

const TIERS = ["Max", "Plus", "Standard", "Light", "Micro"] as const;
type Tier = (typeof TIERS)[number];

const TIER_HELP: Record<Tier, string> = {
  Max: "Hardest problems and deep technical work",
  Plus: "Planning, analysis, and longer reasoning",
  Standard: "Everyday questions — the default route",
  Light: "Short how-to, facts, and instructions",
  Micro: "Brief acknowledgements and one-line replies",
};

export type LastRouteSummary = {
  mode?: string;
  provider: string;
  model: string;
};

export type ComplexityTiersEditorProps = {
  variant: "rail" | "page";
  modelSelectionMode: "auto" | "fixed";
  onModelSelectionModeChange: (mode: "auto" | "fixed") => void;
  modeModelOverrides: Record<string, string>;
  onAssignTier: (tier: string, modelId: string | null) => void;
  fixedModelId: string;
  onFixedModelIdChange: (id: string) => void;
  lastRoute: LastRouteSummary | null;
  chatCatalogModels: CatalogModel[];
  labelFor: (id: string) => string;
  providerFor: (id: string) => ModelProviderId | null;
  displayModelFor: (tier: string) => string;
  tierStatus: (modelId: string) => { ready: boolean; notForChat: boolean };
  usageCount?: (tier: string) => number;
  changedTiers?: Record<string, number>;
  cloudDefaultsWillRun: boolean;
  groqCatalogReady: boolean;
  ollamaCatalogReady: boolean;
  localFallbackModel: string | null;
  onNeedCatalog?: () => void;
  onOpenSettings?: () => void;
  beforeList?: ReactNode;
  afterList?: ReactNode;
};

export type ComplexityTiersBind = Omit<
  ComplexityTiersEditorProps,
  "variant" | "beforeList" | "afterList" | "onOpenSettings"
>;

export function ComplexityTiersEditor({
  variant,
  modelSelectionMode,
  onModelSelectionModeChange,
  modeModelOverrides,
  onAssignTier,
  fixedModelId,
  onFixedModelIdChange,
  lastRoute,
  chatCatalogModels,
  labelFor,
  providerFor,
  displayModelFor,
  tierStatus,
  usageCount,
  changedTiers,
  cloudDefaultsWillRun,
  groqCatalogReady,
  ollamaCatalogReady,
  localFallbackModel,
  onNeedCatalog,
  onOpenSettings,
  beforeList,
  afterList,
}: ComplexityTiersEditorProps) {
  const isPage = variant === "page";
  const initialPageTier =
    lastRoute?.mode && TIERS.includes(lastRoute.mode as Tier) ? lastRoute.mode : "Standard";
  const [openPicker, setOpenPicker] = useState<string | null>(isPage ? initialPageTier : null);
  const picking = modelSelectionMode === "auto" && Boolean(openPicker) && !isPage;

  useEffect(() => {
    if (openPicker || modelSelectionMode === "fixed") onNeedCatalog?.();
  }, [openPicker, modelSelectionMode, onNeedCatalog]);

  useEffect(() => {
    if (!openPicker || isPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPicker, isPage]);

  function assign(tier: string, id: string) {
    if (!isChatUsableModelId(id)) return;
    const def = DEFAULT_TIER_MODELS[tier as Tier];
    onAssignTier(tier, def && id === def ? null : id);
    if (!isPage) setOpenPicker(null);
  }

  return (
    <div className={cn(isPage && "space-y-4")}>
      <div className={cn(
        "flex gap-1 p-0.5 bg-foreground/5 rounded-lg mb-2 border border-foreground/10",
        isPage && "max-w-md mb-3",
      )}>
        <button
          type="button"
          onClick={() => {
            onModelSelectionModeChange("auto");
            if (!isPage) setOpenPicker(null);
          }}
          className={cn(
            "flex-1 text-[0.7rem] font-medium rounded-md py-1.5 transition-all duration-150 cursor-pointer",
            isPage && "py-2 text-[0.78rem]",
            modelSelectionMode === "auto"
              ? "bg-indigo-500/25 text-indigo-200 shadow-sm ring-1 ring-indigo-400/30"
              : "text-foreground/50 hover:text-foreground/75",
          )}
        >
          Complexity tiers
        </button>
        <button
          type="button"
          onClick={() => {
            onModelSelectionModeChange("fixed");
            setOpenPicker(null);
          }}
          className={cn(
            "flex-1 text-[0.7rem] font-medium rounded-md py-1.5 transition-all duration-150 cursor-pointer",
            isPage && "py-2 text-[0.78rem]",
            modelSelectionMode === "fixed"
              ? "bg-indigo-500/25 text-indigo-200 shadow-sm ring-1 ring-indigo-400/30"
              : "text-foreground/50 hover:text-foreground/75",
          )}
        >
          Fixed model
        </button>
      </div>

      {modelSelectionMode === "auto" ? (
        <p className={cn("text-foreground/40 mb-2", isPage ? "text-[0.78rem] leading-relaxed" : "text-[0.65rem]")}>
          {isPage
            ? "Each complexity tier has its own model. Chat classifies the request, then uses the model on that row. Changes apply on the next matching message — the same list as Insights."
            : "Requests are automatically routed by complexity. Each row is the model that tier will actually run. Click a row to change it."}
        </p>
      ) : (
        <p className={cn("text-foreground/40 mb-2", isPage ? "text-[0.78rem]" : "text-[0.65rem]")}>
          Every message uses the selected model.
        </p>
      )}

      {modelSelectionMode === "auto" && !groqCatalogReady && !ollamaCatalogReady && (
        <p className="text-[0.65rem] leading-relaxed text-amber-300/85 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-2 mb-2">
          <span className="font-semibold text-amber-200">No cloud or local chat model.</span>{" "}
          {isPage
            ? "Add a vendor, Bedrock, or Ollama model in the sections below."
            : "Open Settings → Providers to add a credential."}
        </p>
      )}
      {modelSelectionMode === "auto" && groqCatalogReady && (
        <p className="text-[0.65rem] leading-relaxed text-foreground/45 bg-foreground/[0.04] border border-foreground/10 rounded-lg px-2.5 py-2 mb-2">
          {lastRoute ? (
            <>
              Last reply used{" "}
              <span className="font-medium text-foreground/70">
                {lastRoute.provider === "ollama" ? "Ollama" : lastRoute.provider}
              </span>{" "}
              <code className="font-mono text-foreground/60">{labelFor(lastRoute.model)}</code>
              {lastRoute.mode ? ` on ${lastRoute.mode}` : ""}. The matching row is highlighted.
            </>
          ) : cloudDefaultsWillRun ? (
            <>Each row is the model that tier will use. Click a row to change it.</>
          ) : (
            <>
              Cloud defaults are not running yet, so unassigned tiers show the local model that chat will use.
            </>
          )}
        </p>
      )}
      {modelSelectionMode === "auto" && !groqCatalogReady && ollamaCatalogReady && (
        <p className="text-[0.65rem] leading-relaxed text-foreground/45 bg-foreground/[0.04] border border-foreground/10 rounded-lg px-2.5 py-2 mb-2">
          Live chat uses{" "}
          <span className="font-medium text-foreground/70">Ollama</span>
          {localFallbackModel ? ` (${localFallbackModel})` : ""} until you assign a cloud model that is set up.
        </p>
      )}

      {modelSelectionMode === "auto" && !picking && beforeList}

      {modelSelectionMode === "fixed" && (
        <div className={cn("space-y-2 mb-1", isPage && "space-y-3")}>
          <div className="rounded-xl border border-indigo-400/35 bg-indigo-500/12 px-3 py-2.5">
            <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-indigo-300/75">
              In use for every message
            </p>
            <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
              {providerFor(fixedModelId) && (
                <ProviderBadge provider={providerFor(fixedModelId)!} />
              )}
              <span className="text-[0.8rem] font-semibold text-indigo-100 truncate">
                {labelFor(fixedModelId)}
              </span>
            </div>
            <code className="mt-1 block font-mono text-[0.58rem] text-indigo-200/45 truncate">
              {fixedModelId}
            </code>
            <p className="mt-2 text-[0.62rem] text-indigo-200/55 leading-relaxed">
              Click any model below to switch. Applies to the next chat message — no save step.
            </p>
          </div>
          <ModelPickerList
            models={chatCatalogModels}
            selectedId={fixedModelId}
            onSelect={m => onFixedModelIdChange(m.id)}
            maxHeightClass={isPage ? "max-h-[min(28rem,50vh)]" : "max-h-none"}
            selectedBadgeLabel="In use"
            emptyLabel="No models available — add a credential in Settings → Providers."
          />
        </div>
      )}

      {modelSelectionMode === "auto" && picking && openPicker && (
        <RailPicker
          tier={openPicker}
          displayModelId={displayModelFor(openPicker)}
          hasOverride={Boolean(modeModelOverrides[openPicker] && isChatUsableModelId(modeModelOverrides[openPicker]))}
          labelFor={labelFor}
          providerFor={providerFor}
          models={chatCatalogModels}
          onSelect={id => assign(openPicker, id)}
          onDone={() => setOpenPicker(null)}
          onReset={() => {
            onAssignTier(openPicker, null);
            setOpenPicker(null);
          }}
          onSwitchTier={setOpenPicker}
        />
      )}

      {modelSelectionMode === "auto" && isPage && (
        <div className="grid gap-4 xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] items-start">
          <div className="space-y-1.5">
            {TIERS.map(tier => (
              <TierRow
                key={tier}
                variant="page"
                tier={tier}
                displayModelId={displayModelFor(tier)}
                isPickerOpen={openPicker === tier}
                hasOverride={Boolean(modeModelOverrides[tier] && isChatUsableModelId(modeModelOverrides[tier]))}
                justChanged={Boolean(changedTiers?.[tier])}
                lastUsed={lastRoute?.mode === tier}
                usage={usageCount?.(tier) ?? 0}
                labelFor={labelFor}
                providerFor={providerFor}
                status={tierStatus(displayModelFor(tier))}
                onToggle={() => setOpenPicker(tier)}
              />
            ))}
          </div>
          {openPicker && (
            <PagePicker
              tier={openPicker}
              displayModelId={displayModelFor(openPicker)}
              hasOverride={Boolean(modeModelOverrides[openPicker] && isChatUsableModelId(modeModelOverrides[openPicker]))}
              labelFor={labelFor}
              models={chatCatalogModels}
              onSelect={id => assign(openPicker, id)}
              onReset={() => onAssignTier(openPicker, null)}
            />
          )}
        </div>
      )}

      {modelSelectionMode === "auto" && !picking && !isPage && (
        <div className="space-y-0.5">
          {TIERS.map(tier => (
            <TierRow
              key={tier}
              variant="rail"
              tier={tier}
              displayModelId={displayModelFor(tier)}
              isPickerOpen={false}
              hasOverride={Boolean(modeModelOverrides[tier] && isChatUsableModelId(modeModelOverrides[tier]))}
              justChanged={Boolean(changedTiers?.[tier])}
              lastUsed={lastRoute?.mode === tier}
              usage={usageCount?.(tier) ?? 0}
              labelFor={labelFor}
              providerFor={providerFor}
              status={tierStatus(displayModelFor(tier))}
              onToggle={() => setOpenPicker(tier)}
            />
          ))}
        </div>
      )}

      {modelSelectionMode === "auto" && !picking && afterList}

      {variant === "rail" && onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-2 w-full text-left text-[0.62rem] text-indigo-300/70 hover:text-indigo-200 underline underline-offset-2 cursor-pointer"
        >
          Open full-size editor in Settings
        </button>
      )}
    </div>
  );
}

function TierRow({
  variant,
  tier,
  displayModelId,
  isPickerOpen,
  hasOverride,
  justChanged,
  lastUsed,
  usage,
  labelFor,
  providerFor,
  status,
  onToggle,
}: {
  variant: "rail" | "page";
  tier: string;
  displayModelId: string;
  isPickerOpen: boolean;
  hasOverride: boolean;
  justChanged: boolean;
  lastUsed: boolean;
  usage: number;
  labelFor: (id: string) => string;
  providerFor: (id: string) => ModelProviderId | null;
  status: { ready: boolean; notForChat: boolean };
  onToggle: () => void;
}) {
  const isPage = variant === "page";
  const provider = providerFor(displayModelId);
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isPickerOpen ? `Choosing model for ${tier}` : `Change model for ${tier}`}
      aria-pressed={isPickerOpen}
      aria-label={
        isPickerOpen
          ? `Choosing model for ${tier}`
          : `Change model for ${tier} tier, currently ${labelFor(displayModelId)}`
      }
      className={cn(
        "w-full text-left rounded-lg group cursor-pointer transition-all duration-150",
        isPage ? "px-3 py-2.5 border" : "flex items-center justify-between gap-2 px-2 py-1.5 -mx-0.5",
        isPage
          ? isPickerOpen
            ? "border-indigo-400/40 bg-indigo-500/12 ring-1 ring-indigo-400/25"
            : "border-foreground/10 bg-foreground/[0.03] hover:border-indigo-400/25 hover:bg-foreground/[0.06]"
          : cn(
            "hover:bg-foreground/6 active:bg-foreground/8 hover:ring-1 hover:ring-indigo-400/25",
            lastUsed && "bg-indigo-500/10 ring-1 ring-indigo-400/35",
          ),
      )}
    >
      <div className={cn(!isPage && "flex items-center justify-between gap-2 w-full")}>
        <div className="flex items-center gap-1.5 min-w-0">
          {isPage && (
            <span
              className={cn(
                "size-2 rounded-full shrink-0",
                isPickerOpen ? "bg-indigo-400" : "bg-foreground/20",
              )}
              aria-hidden
            />
          )}
          <span className={cn(
            "font-semibold shrink-0",
            isPage ? "text-[0.85rem] text-foreground/85" : "text-xs text-foreground/70 group-hover:text-foreground",
          )}>
            {tier}
          </span>
          {usage > 0 && (
            <span
              className="min-w-[1.25rem] text-center text-[0.65rem] font-mono font-semibold tabular-nums rounded-md px-1.5 py-0.5 shrink-0 border bg-indigo-500/20 text-indigo-300 border-indigo-500/25"
              title={`${usage} hit${usage === 1 ? "" : "s"} in selected range`}
            >
              {usage}
            </span>
          )}
          {justChanged && (
            <span className="text-[0.5rem] uppercase tracking-wider text-emerald-300/90 bg-emerald-400/12 border border-emerald-400/30 px-1 py-0.5 rounded shrink-0">
              Changed
            </span>
          )}
          {lastUsed && !justChanged && (
            <span className="text-[0.5rem] uppercase tracking-wider text-indigo-200/90 bg-indigo-400/15 border border-indigo-400/30 px-1 py-0.5 rounded shrink-0">
              Last reply
            </span>
          )}
        </div>
        {isPage && (
          <p className="mt-0.5 text-[0.65rem] text-foreground/40 leading-snug">{TIER_HELP[tier as Tier]}</p>
        )}
        <div className={cn("flex items-center gap-1.5 min-w-0", isPage && "mt-1.5")}>
          {!isPage && (
            <span className="text-[0.58rem] font-medium shrink-0 transition-opacity duration-150 text-indigo-300/70 opacity-0 group-hover:opacity-100">
              Change model
            </span>
          )}
          {provider && (
            status.ready ? (
              <ProviderBadge provider={provider} />
            ) : (
              <span className="text-[0.5rem] uppercase tracking-wider font-semibold text-amber-400/90 bg-amber-400/10 border border-amber-400/25 px-1 py-0.5 rounded shrink-0">
                {status.notForChat ? "Not for chat" : "Not set up"}
              </span>
            )
          )}
          <code
            title={labelFor(displayModelId)}
            className={cn(
              "text-[0.62rem] font-mono px-1.5 py-0.5 rounded-md truncate border",
              isPage ? "max-w-full" : "max-w-[11rem]",
              justChanged
                ? "text-emerald-200 bg-emerald-400/15 border-emerald-400/40"
                : hasOverride
                  ? "text-indigo-200/90 bg-indigo-500/15 border-indigo-400/30"
                  : "text-foreground/70 bg-elevated border-border",
            )}
          >
            {labelFor(displayModelId)}
          </code>
          {!isPage && (
            <ChevronRight className="size-3 shrink-0 text-transparent group-hover:text-indigo-300/50" />
          )}
          {isPage && isPickerOpen && (
            <span className="ml-auto text-[0.62rem] text-indigo-300/80 shrink-0">Editing</span>
          )}
        </div>
      </div>
    </button>
  );
}

function RailPicker({
  tier,
  displayModelId,
  hasOverride,
  labelFor,
  providerFor,
  models,
  onSelect,
  onDone,
  onReset,
  onSwitchTier,
}: {
  tier: string;
  displayModelId: string;
  hasOverride: boolean;
  labelFor: (id: string) => string;
  providerFor: (id: string) => ModelProviderId | null;
  models: CatalogModel[];
  onSelect: (id: string) => void;
  onDone: () => void;
  onReset: () => void;
  onSwitchTier: (tier: string) => void;
}) {
  const provider = providerFor(displayModelId);
  return (
    <div className="rounded-xl border border-indigo-400/30 bg-foreground/[0.03] overflow-hidden mb-1">
      <div className="flex items-start justify-between gap-2 px-2.5 py-2 border-b border-indigo-400/15 bg-indigo-500/[0.08]">
        <div className="min-w-0">
          <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-indigo-300/70">
            Choosing for {tier}
          </p>
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            {provider && <ProviderBadge provider={provider} />}
            <span className="text-[0.72rem] font-medium text-foreground/80 truncate">
              {labelFor(displayModelId)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          title="Return to the tier list (Esc)"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[0.72rem] font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] cursor-pointer"
        >
          <Check className="size-3.5" aria-hidden />
          Done
        </button>
      </div>
      <div className="flex gap-1 px-2 pt-2 overflow-x-auto">
        {TIERS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onSwitchTier(t)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[0.62rem] font-medium cursor-pointer border",
              t === tier
                ? "bg-indigo-500/20 text-indigo-100 border-indigo-400/35"
                : "text-foreground/45 border-transparent hover:bg-foreground/6 hover:text-foreground/70",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="px-2.5 pt-1.5 pb-1 text-[0.58rem] text-foreground/40">
        Search, then click a model. It is assigned to {tier} immediately. Esc or Done returns to the list.
      </p>
      <div className="px-1.5 pb-1.5">
        <ModelPickerList
          models={models}
          selectedId={displayModelId}
          autoFocusSearch
          maxHeightClass="max-h-72"
          selectedBadgeLabel="Using"
          emptyLabel="No models available — add a credential in Settings → Providers."
          onSelect={opt => {
            if (!isChatUsableModelId(opt.id) || !isChatSelectableModel(opt)) return;
            onSelect(opt.id);
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-foreground/8">
        {hasOverride ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[0.62rem] text-foreground/40 hover:text-foreground/70 cursor-pointer"
          >
            Reset to default
          </button>
        ) : (
          <span className="text-[0.58rem] text-foreground/30">Default for this tier</span>
        )}
        <button
          type="button"
          onClick={onDone}
          title="Return to the tier list (Esc)"
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[0.72rem] font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] cursor-pointer"
        >
          <Check className="size-3.5" aria-hidden />
          Done
        </button>
      </div>
    </div>
  );
}

function PagePicker({
  tier,
  displayModelId,
  hasOverride,
  labelFor,
  models,
  onSelect,
  onReset,
}: {
  tier: string;
  displayModelId: string;
  hasOverride: boolean;
  labelFor: (id: string) => string;
  models: CatalogModel[];
  onSelect: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-indigo-400/25 bg-foreground/[0.03] p-4 min-h-[22rem]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-indigo-300/70">
            Assign to {tier}
          </p>
          <p className="mt-1 text-[0.85rem] font-medium text-foreground/80">
            {TIER_HELP[tier as Tier]}
          </p>
          <p className="mt-1 text-[0.68rem] text-foreground/45">
            Currently {labelFor(displayModelId)}. Click a model to use it on the next {tier} request.
          </p>
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={onReset}
            className="text-[0.7rem] text-foreground/45 hover:text-foreground/75 cursor-pointer underline underline-offset-2"
          >
            Reset to default
          </button>
        )}
      </div>
      <ModelPickerList
        models={models}
        selectedId={displayModelId}
        autoFocusSearch
        maxHeightClass="max-h-[min(32rem,55vh)]"
        selectedBadgeLabel="Using"
        emptyLabel="No models available — add a vendor key, Bedrock, or a local Ollama chat model in Settings → Providers."
        onSelect={opt => {
          if (!isChatUsableModelId(opt.id) || !isChatSelectableModel(opt)) return;
          onSelect(opt.id);
        }}
      />
    </div>
  );
}
