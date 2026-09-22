"use client";

/**
 * Shared model catalog for every place the user picks a model.
 *
 * One source of truth: `/api/models/catalog`. Any model from any configured
 * credential can be chosen anywhere, so the only thing that matters in the UI
 * is that its origin is unmistakable — hence the provider badge on every row.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { themeForRuntime } from "@/lib/provider-theme";
import {
  flattenLiveCatalog,
  type ReferenceCatalogSlice,
} from "@/lib/models/reference-catalog";
import { isChatUsableModelId, type CatalogModel } from "@/lib/models/catalog-shared";
import { modelKey } from "@/lib/models/model-availability";
import {
  compareModelsForQuery,
  matchesModelQuery,
  modelPickerHint,
} from "@/lib/models/model-search";

export type { CatalogModel };

export type ModelCatalog = {
  groq: CatalogModel[];
  bedrock: CatalogModel[];
  ollama: CatalogModel[];
  openai: CatalogModel[];
  anthropic: CatalogModel[];
  google: CatalogModel[];
  xai: CatalogModel[];
  errors: string[];
};

const EMPTY: ModelCatalog = {
  groq: [],
  bedrock: [],
  ollama: [],
  openai: [],
  anthropic: [],
  google: [],
  xai: [],
  errors: [],
};

type CatalogState = {
  catalog: ModelCatalog;
  all: CatalogModel[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Fetch once when a picker actually opens — not on every page load. */
  ensureLoaded: () => Promise<void>;
  /** True after the first catalog response, including a failed list. */
  loaded: boolean;
  byId: (id: string) => CatalogModel | null;
};

const CatalogContext = createContext<CatalogState | null>(null);

/** Shares one catalog fetch between the settings pane and the Insights rail. */
export function ModelCatalogProvider({ children }: { children: React.ReactNode }) {
  const value = useLoadCatalog();
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

function useLoadCatalog(enabled = true): CatalogState {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async (fresh: boolean) => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await fetch(
        fresh ? "/api/models/catalog?fresh=1" : "/api/models/catalog",
        { credentials: "same-origin" },
      );
      const data = res.ok ? (await res.json()) as ModelCatalog : null;
      if (requestId !== requestIdRef.current) return;
      if (data) setCatalog(data);
      else setCatalog({ ...EMPTY, errors: ["Could not load model availability. Refresh to retry."] });
      loadedRef.current = true;
      setLoaded(true);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setCatalog({ ...EMPTY, errors: ["Could not load model availability. Refresh to retry."] });
      loadedRef.current = true;
      setLoaded(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [enabled]);

  /** Manual reload — called from event handlers, never from an effect on mount. */
  const refresh = useCallback(async () => {
    loadedRef.current = false;
    await load(true);
  }, [load]);

  const ensureLoaded = useCallback(async () => {
    if (!enabled || loadedRef.current) return;
    await load(false);
  }, [enabled, load]);

  const all = useMemo(() => flattenLiveCatalog(catalog), [catalog]);

  const byId = useCallback((id: string) => all.find(m => m.id === id) ?? null, [all]);

  return { catalog, all, loading, refresh, ensureLoaded, loaded, byId };
}

/** Catalog from context when available, otherwise a local fetch. */
export function useModelCatalog(): CatalogState {
  const ctx = useContext(CatalogContext);
  const local = useLoadCatalog(!ctx);
  return ctx ?? local;
}

export type ModelProviderId = CatalogModel["provider"];

/** Listed as chat-capable; Settings retains hidden, failed, and unverified entries. */
export function isListedChatModel(m: Pick<CatalogModel, "id" | "modality">): boolean {
  return m.modality !== "other" && isChatUsableModelId(m.id);
}

/** Menus only include models chat can run: a passed test, or an installed local chat model. */
export function isChatSelectableModel(m: CatalogModel): boolean {
  if (!isListedChatModel(m) || m.hidden || m.access === "needs_enablement") return false;
  return m.verification === "verified" || (m.provider === "ollama" && m.verification === "installed");
}

export function menuStatusLabel(m: CatalogModel): string {
  if (m.hidden) return "Not in menus · hidden";
  if (m.access === "needs_enablement") return "Not in menus · enable in AWS";
  if (m.verification === "failed") {
    const code = m.verificationCode ? ` · ${m.verificationCode.replaceAll("_", " ")}` : "";
    return `Not in menus · check failed${code}`;
  }
  if (m.verification === "verified" || m.verification === "installed") return "In menus";
  return "Not in menus · test to add";
}

export function chatSelectableModels(models: CatalogModel[]): CatalogModel[] {
  return models.filter(isChatSelectableModel);
}

export function settingsCatalogModels(models: CatalogModel[]): CatalogModel[] {
  return models.filter(isListedChatModel);
}

/** Live catalog only — unconfigured vendors do not appear in operational pickers. */
export function buildPickerModels(catalog: ReferenceCatalogSlice): CatalogModel[] {
  return flattenLiveCatalog(catalog);
}

export function buildChatPickerModels(catalog: ReferenceCatalogSlice): CatalogModel[] {
  return chatSelectableModels(buildPickerModels(catalog));
}

/** Settings keeps all listed chat candidates available to test and show again. */
export function buildSettingsCatalogModels(catalog: ReferenceCatalogSlice): CatalogModel[] {
  return settingsCatalogModels(buildPickerModels(catalog));
}

const PROVIDER_STYLES: Record<ModelProviderId, { label: string; className: string }> = {
  groq: {
    label: themeForRuntime("groq").label,
    className: themeForRuntime("groq").badge,
  },
  bedrock: {
    label: themeForRuntime("bedrock").label,
    className: themeForRuntime("bedrock").badge,
  },
  ollama: {
    label: themeForRuntime("ollama").label,
    className: themeForRuntime("ollama").badge,
  },
  openai: {
    label: themeForRuntime("openai").label,
    className: themeForRuntime("openai").badge,
  },
  anthropic: {
    label: themeForRuntime("anthropic").label,
    className: themeForRuntime("anthropic").badge,
  },
  google: {
    label: themeForRuntime("google").label,
    className: themeForRuntime("google").badge,
  },
  xai: {
    label: themeForRuntime("xai").label,
    className: themeForRuntime("xai").badge,
  },
};

export function providerLabel(provider: ModelProviderId): string {
  return PROVIDER_STYLES[provider].label;
}

/**
 * Best-effort vendor guess when the live catalog has not loaded yet, so collapsed
 * tier rows still show a badge instead of a bare model name.
 */
export function guessProvider(modelId: string): ModelProviderId | null {
  const id = modelId.toLowerCase();
  if (
    id.startsWith("amazon.") ||
    id.startsWith("us.") ||
    id.startsWith("global.") ||
    id.startsWith("eu.") ||
    id.startsWith("apac.") ||
    id.includes(".anthropic.") ||
    id.includes(".meta.") ||
    id.includes(".amazon.") ||
    id.includes(".cohere.") ||
    id.includes(".mistral.")
  ) {
    return "bedrock";
  }
  if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) {
    return "openai";
  }
  if (id.startsWith("claude") || id.includes("anthropic")) return "anthropic";
  if (id.startsWith("grok")) return "xai";
  if (id.startsWith("gemini") || id.startsWith("models/gemini")) return "google";
  if (id.includes(":") && !id.includes("/")) return "ollama";
  if (
    id.includes("llama") ||
    id.includes("qwen") ||
    id.includes("gpt-oss") ||
    id.includes("groq") ||
    id.startsWith("openai/") ||
    id.startsWith("meta-llama/")
  ) {
    return "groq";
  }
  return null;
}

export function ProviderBadge({
  provider,
  className,
}: {
  provider: ModelProviderId;
  className?: string;
}) {
  const style = PROVIDER_STYLES[provider];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide shrink-0",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

/** Where a model runs, in one sentence — used under grouped lists. */
export function providerOrigin(provider: ModelProviderId): string {
  if (provider === "groq") return "Runs on Groq using the saved API key.";
  if (provider === "bedrock") return "Runs on AWS Bedrock using the selected profile's credentials.";
  if (provider === "openai") return "Runs on OpenAI using the saved API key.";
  if (provider === "anthropic") return "Runs on Anthropic using the saved API key.";
  if (provider === "google") return "Runs on Gemini using the saved API key.";
  if (provider === "xai") return "Runs on xAI Grok using the saved API key.";
  return "Ollama (local) — runs on this machine only. Nothing leaves the host.";
}

/** Display name that always includes the vendor, e.g. "Llama 3.3 70B · Groq". */
export function modelDisplayName(model: Pick<CatalogModel, "name" | "provider">): string {
  return `${model.name} · ${providerLabel(model.provider)}`;
}

export type ModelTestResult = {
  ok: boolean;
  latencyMs?: number;
  sample?: string;
  code?: string;
  message?: string;
  remediation?: string | null;
  pending?: boolean;
};

const PROVIDER_ORDER: CatalogModel["provider"][] = [
  "groq",
  "openai",
  "anthropic",
  "google",
  "xai",
  "bedrock",
  "ollama",
];

type ProviderFilter = "all" | ModelProviderId;

/**
 * Searchable, provider-filtered model list.
 *
 * Shared by Settings and the Insights rail so a model is picked the same way
 * everywhere — and always shows where it comes from.
 */
export function ModelPickerList({
  models,
  selectedId,
  onSelect,
  onTest,
  onToggleVisibility,
  results,
  emptyLabel = "No models available.",
  maxHeightClass = "max-h-72",
  autoFocusSearch = false,
  showProviderFilter = true,
  alwaysShowProviderFilters = false,
  initialProviderFilter = "all",
  providerFilter: controlledProviderFilter,
  onProviderFilterChange,
  selectedBadgeLabel = "Selected",
  browse = false,
  blurbFor,
  assignedTiersFor,
}: {
  models: CatalogModel[];
  selectedId?: string | null;
  onSelect?: (model: CatalogModel) => void;
  onTest?: (model: CatalogModel) => void;
  onToggleVisibility?: (model: CatalogModel) => Promise<void>;
  results?: Record<string, ModelTestResult>;
  emptyLabel?: string;
  maxHeightClass?: string;
  autoFocusSearch?: boolean;
  /** Chip row to filter by vendor. Default on. */
  showProviderFilter?: boolean;
  /** Show vendor chips even when only one provider has models. Default off. */
  alwaysShowProviderFilters?: boolean;
  /** Prefill the vendor chip (e.g. after selecting a Bedrock credential). */
  initialProviderFilter?: ProviderFilter;
  /** When set, the vendor chips follow this value. */
  providerFilter?: ProviderFilter;
  onProviderFilterChange?: (next: ProviderFilter) => void;
  /** Label shown on the active row (e.g. "In use" for fixed-model mode). */
  selectedBadgeLabel?: string;
  /** Review-only directory — rows do not assign a model. */
  browse?: boolean;
  blurbFor?: (model: CatalogModel) => string;
  assignedTiersFor?: (modelId: string) => string[];
}) {
  const [query, setQuery] = useState("");
  const [savingVisibility, setSavingVisibility] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [internalProviderFilter, setInternalProviderFilter] = useState<ProviderFilter>(initialProviderFilter);
  const providerFilter = controlledProviderFilter ?? internalProviderFilter;
  const setProviderFilter = (next: ProviderFilter) => {
    onProviderFilterChange?.(next);
    if (controlledProviderFilter === undefined) setInternalProviderFilter(next);
  };
  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(() => {
    const c: Record<ModelProviderId, number> = {
      groq: 0,
      bedrock: 0,
      ollama: 0,
      openai: 0,
      anthropic: 0,
      google: 0,
      xai: 0,
    };
    for (const m of models) c[m.provider] += 1;
    return c;
  }, [models]);

  const availableProviders = useMemo(() => {
    const withModels = PROVIDER_ORDER.filter(p => counts[p] > 0);
    if (alwaysShowProviderFilters) {
      return PROVIDER_ORDER.filter(p => withModels.includes(p));
    }
    return withModels;
  }, [alwaysShowProviderFilters, counts]);

  const groups = useMemo(() => {
    const q = query.trim();
    const scoped =
      providerFilter === "all" ? models : models.filter(m => m.provider === providerFilter);
    return PROVIDER_ORDER.map(provider => {
      const items = scoped
        .filter(m => m.provider === provider && matchesModelQuery(m, q))
        .slice()
        .sort((a, b) => compareModelsForQuery(a, b, q));
      return { provider, items };
    }).filter(g => g.items.length > 0);
  }, [models, query, providerFilter]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const showSearch = models.length > 6;
  const showFilter =
    showProviderFilter &&
    (alwaysShowProviderFilters ? availableProviders.length > 0 : availableProviders.length > 1);

  useEffect(() => {
    if (!selectedId) return;
    // Bring the active model into view after mount / selection change.
    const id = window.setTimeout(() => {
      selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [selectedId, providerFilter, query]);

  return (
    <div className="space-y-2">
      {visibilityError && <p role="alert" className="text-xs text-red-400">{visibilityError}</p>}
      {(showSearch || showFilter) && (
        <div className="space-y-1.5">
          {showSearch && (
            <input
              type="search"
              value={query}
              autoFocus={autoFocusSearch}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or id…"
              aria-label="Search models by name or id"
              className="w-full h-8 rounded-lg border border-[var(--border-strong)] bg-elevated px-2.5 text-xs text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            />
          )}

          {showFilter && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by vendor">
              <FilterChip
                active={providerFilter === "all"}
                onClick={() => setProviderFilter("all")}
                label="All"
                count={models.length}
              />
              {availableProviders.map(p => (
                <FilterChip
                  key={p}
                  active={providerFilter === p}
                  onClick={() => setProviderFilter(p)}
                  label={providerLabel(p)}
                  count={counts[p]}
                  provider={p}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {total === 0 && (
        <p className="text-[0.65rem] text-foreground/35 px-1 py-2">
          {query || providerFilter !== "all"
            ? "No models match that name or id. Try Claude, Nova, or part of the model id."
            : emptyLabel}
        </p>
      )}

      <div
        role={browse ? "list" : "listbox"}
        aria-label="Available models"
        className={cn("overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-card", maxHeightClass)}
      >
        {groups.map(group => (
          <div key={group.provider}>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted px-2.5 py-1.5 border-b border-border">
              <ProviderBadge provider={group.provider} />
              <span className="text-[0.58rem] text-foreground/45 truncate">
                {group.items.length} model{group.items.length === 1 ? "" : "s"}
              </span>
            </div>
            {group.items.map(m => {
              const selected = !browse && selectedId === m.id;
              const result = results?.[modelKey(m)];
              const blurb = browse ? blurbFor?.(m) : undefined;
              const tiers = browse ? assignedTiersFor?.(m.id) ?? [] : [];
              const hint = modelPickerHint(m);
              const rowTitle = `${m.name} · ${m.id}`;
              const identity = (
                <>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        "text-[0.72rem] font-medium truncate",
                        selected ? "text-indigo-100" : "text-foreground/75",
                      )}
                    >
                      {m.name}
                    </span>
                    <ProviderBadge provider={m.provider} className="opacity-90" />
                    {browse && m.access === "needs_enablement" && (
                      <span className="inline-flex items-center shrink-0 rounded-md border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wider text-amber-100/90">
                        Needs enablement
                      </span>
                    )}
                    {selected && (
                      <span className="inline-flex items-center gap-0.5 shrink-0 rounded-md bg-indigo-500/25 border border-indigo-400/35 px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wider text-indigo-200">
                        <Check className="size-2.5" aria-hidden />
                        {selectedBadgeLabel}
                      </span>
                    )}
                  </span>
                  {browse && (
                    <span className="block mt-1 text-[0.6rem] text-foreground/60">
                      {menuStatusLabel(m)}
                      {m.checkedAt && <span> · {new Date(m.checkedAt).toLocaleString()}</span>}
                    </span>
                  )}
                  {hint && (
                    <span className="block text-[0.58rem] text-foreground/40 truncate mt-0.5">
                      {hint}
                    </span>
                  )}
                  {browse && blurb && (
                    <span className="block text-[0.6rem] text-foreground/48 leading-relaxed mt-1">
                      {blurb}
                    </span>
                  )}
                  {browse && tiers.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-1.5">
                      {tiers.map(tier => (
                        <span
                          key={tier}
                          className="text-[0.5rem] uppercase tracking-wide px-1.5 py-0.5 rounded border border-indigo-400/30 bg-indigo-500/15 text-indigo-200/90 font-semibold"
                        >
                          {tier}
                        </span>
                      ))}
                    </span>
                  )}
                </>
              );
              return (
                <div
                  key={`${m.provider}:${m.id}`}
                  ref={selected ? selectedRowRef : undefined}
                  role={browse ? "listitem" : undefined}
                  className={cn(
                    "border-b border-border/70 last:border-0",
                    selected && "bg-indigo-500/18 ring-1 ring-inset ring-indigo-400/35",
                  )}
                >
                  <div className={cn("flex gap-2 px-2.5 py-2", browse ? "items-start" : "items-center")}>
                    {browse || !onSelect ? (
                      <div className="flex-1 min-w-0" title={rowTitle}>{identity}</div>
                    ) : (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        title={rowTitle}
                        onClick={() => onSelect(m)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        {identity}
                      </button>
                    )}

                    {result && (
                      <span
                        className={cn(
                          "text-[0.55rem] font-mono px-1.5 py-0.5 rounded shrink-0",
                          result.pending
                            ? "text-foreground/40 bg-foreground/[0.06]"
                            : result.ok
                              ? "text-emerald-300/90 bg-emerald-400/12"
                              : "text-red-300/90 bg-red-400/12",
                        )}
                      >
                        {result.pending
                          ? "testing…"
                          : result.ok
                            ? `ok ${result.latencyMs}ms`
                            : "failed"}
                      </span>
                    )}

                    {onTest && (
                      <button
                        type="button"
                        disabled={result?.pending}
                        onClick={() => onTest(m)}
                        className="shrink-0 rounded-md border border-border bg-elevated px-2 py-1 text-[0.58rem] font-medium text-foreground/70 hover:border-[var(--border-strong)] hover:text-foreground disabled:opacity-40 cursor-pointer"
                      >
                        Test
                      </button>
                    )}
                    {browse && onToggleVisibility && (
                      <button
                        type="button"
                        aria-label={`${m.hidden ? "Show" : "Hide"} ${m.name} in model menus`}
                        disabled={savingVisibility !== null}
                        onClick={async () => {
                          setSavingVisibility(modelKey(m));
                          setVisibilityError(null);
                          try { await onToggleVisibility(m); }
                          catch { setVisibilityError("Could not save model visibility. Try again."); }
                          finally { setSavingVisibility(null); }
                        }}
                        className="shrink-0 rounded-md border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[0.58rem] text-foreground/75 hover:bg-indigo-500/20 disabled:opacity-40 cursor-pointer"
                      >
                        {savingVisibility === modelKey(m) ? "Saving…" : m.hidden ? "Show" : "Hide"}
                      </button>
                    )}
                  </div>

                  {result && !result.pending && !result.ok && (
                    <div className="px-2.5 pb-2 -mt-0.5">
                      <p className="text-[0.58rem] text-red-200/70 leading-relaxed">
                        {result.remediation ?? result.message}
                      </p>
                      {result.remediation && result.message && (
                        <p className="text-[0.55rem] text-foreground/25 mt-0.5 leading-relaxed">
                          {result.message}
                        </p>
                      )}
                    </div>
                  )}
                  {result?.ok && result.sample && (
                    <p className="px-2.5 pb-2 -mt-0.5 text-[0.58rem] text-emerald-200/60">
                      Replied “{result.sample}”
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  provider,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  provider?: ModelProviderId;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[0.62rem] font-medium cursor-pointer transition-colors",
        active
          ? provider
            ? cn(PROVIDER_STYLES[provider].className, "border-current/40")
            : "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
          : "border-border bg-elevated text-foreground/60 hover:border-[var(--border-strong)] hover:text-foreground",
      )}
    >
      {label}
      <span className="text-[0.55rem] opacity-70 tabular-nums">{count}</span>
    </button>
  );
}

/** Runs the reachability check and tracks per-model results. */
export function useModelTester() {
  const [results, setResults] = useState<Record<string, ModelTestResult>>({});
  const { refresh } = useModelCatalog();

  const test = useCallback(async (model: CatalogModel) => {
    setResults(prev => ({ ...prev, [modelKey(model)]: { ok: false, pending: true } }));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: model.id, provider: model.provider }),
      });
      const data = (await res.json()) as ModelTestResult & { error?: string };
      setResults(prev => ({
        ...prev,
        [modelKey(model)]: res.ok
          ? { ...data, pending: false }
          : { ok: false, pending: false, message: data.error ?? `Request failed (${res.status})` },
      }));
    } catch (err) {
      setResults(prev => ({
        ...prev,
        [modelKey(model)]: {
          ok: false,
          pending: false,
          message: err instanceof Error ? err.message : "Test failed",
        },
      }));
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { results, test };
}
