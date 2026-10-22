"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Cloud, ExternalLink, HardDrive, KeyRound, LayoutList, Mic, RefreshCw, Shield, SlidersHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  ModelPickerList,
  buildSettingsCatalogModels,
  chatSelectableModels,
  useModelCatalog,
  useModelTester,
  type CatalogModel,
} from "@/components/app/model-catalog";
import { ModelInventory, partitionModels, providerCountsLine, vendorMenuPhrase, type InventoryView } from "@/components/app/model-inventory";
import { ComplexityTiersEditor, type ComplexityTiersBind } from "@/components/app/complexity-tiers-editor";
import {
  formatGroqConnectivityError,
  groqVendorStatusLabel,
  GROQ_VPN_SETTINGS_NOTE,
} from "@/lib/models/groq-connectivity";
import { consumeBedrockHighlight, HIGHLIGHT_BEDROCK_KEY } from "@/lib/onboarding";
import { deriveKeyHealth, keyNeedsAttention, relativeTime, type KeyHealth } from "@/lib/models/key-health";
import { planRecommendedBedrock, recommendedNeedingConsole } from "@/lib/models/bedrock-recommended";
import { VoiceSttSetupDialog } from "@/components/app/voice-stt-setup";
import {
  voiceProviderDestination,
  voiceProviderLabel,
  type VoiceSttChoice,
} from "@/lib/transcribe/backend";
import type { RuntimeEdition } from "@/lib/runtime-env";
import {
  detectProviderKey,
  isRejectedKeyKind,
  type DetectedKeyKind,
} from "@/lib/provider-key-detect";
import {
  WIRED_VENDOR_APIS,
  isWiredVendorKind,
  type WiredVendorKind,
} from "@/lib/vendor-providers";
import {
  CATALOG_THEME,
  PROVIDER_THEME,
  themeForVendor,
  type ProviderTheme,
} from "@/lib/provider-theme";

type KeyInventoryItem = {
  id: string;
  kind: string;
  label: string;
  description: string;
  hint: string | null;
  source: "instance" | "env" | "local" | "aws-chain";
  status: "ready" | "incomplete" | "stored" | "local";
  region?: string | null;
  catalog: "groq" | "bedrock" | "ollama" | "google" | "openai" | "anthropic" | "xai" | "none";
  managedByEnvironment?: boolean;
};

type AwsStatus = {
  allowRealAws: boolean;
  lockedByEnvironment: boolean;
  detected: boolean;
  source: string;
  region: string | null;
  profile: string | null;
  availableProfiles: string[];
  hint: string | null;
  looksLikeFloci: boolean;
  expiresAt: string | null;
  caller: {
    accountId: string | null;
    arn: string | null;
    roleName: string | null;
    sessionName: string | null;
  } | null;
  error: string | null;
};

type ProviderStatus = {
  edition?: RuntimeEdition;
  deployment?: "docker" | "host" | "hosted";
  primaryProvider: "auto" | "groq" | "bedrock" | "ollama";
  hasGroqKey: boolean;
  hasEnvGroqKey: boolean;
  bedrockRegion: string | null;
  bedrockChatModel: string | null;
  externalRiskAckAt: string | null;
  voiceSttChoice?: VoiceSttChoice | null;
  canEdit: boolean;
  role: "super_admin" | "admin" | "member";
  aws: AwsStatus;
  keys: KeyInventoryItem[];
};

type Props = {
  complexityTiers: ComplexityTiersBind;
  onProvidersChanged?: () => void;
};

type VendorCatalogKind = "groq" | "google" | "openai" | "anthropic" | "xai" | "none";

function isVendorCatalog(catalog: KeyInventoryItem["catalog"]): catalog is VendorCatalogKind {
  return (
    catalog === "groq" ||
    catalog === "google" ||
    catalog === "openai" ||
    catalog === "anthropic" ||
    catalog === "xai" ||
    catalog === "none"
  );
}

const CONNECTIONS_THEME = {
  label: "Connections",
  badge: "text-foreground/70 bg-foreground/[0.06] border-foreground/15",
  icon: "text-foreground/70",
  borderOpen: "border-foreground/25",
  bgOpen: "bg-foreground/[0.03]",
  surface: "border-foreground/15 bg-foreground/[0.06]",
} as const;

type SettingsModuleId = "tiers" | "vendor" | "bedrock" | "local" | "models" | "voice";

export function InferenceSettings(props: Props) {
  const complexityTiers = props.complexityTiers;
  const onProvidersChanged = props.onProvidersChanged;
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [groq, setGroq] = useState<CatalogModel[]>([]);
  const [bedrock, setBedrock] = useState<CatalogModel[]>([]);
  const [ollama, setOllama] = useState<CatalogModel[]>([]);
  const [openai, setOpenai] = useState<CatalogModel[]>([]);
  const [anthropic, setAnthropic] = useState<CatalogModel[]>([]);
  const [google, setGoogle] = useState<CatalogModel[]>([]);
  const [xai, setXai] = useState<CatalogModel[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [providersReady, setProvidersReady] = useState(false);
  const [refreshingModule, setRefreshingModule] = useState<SettingsModuleId | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [riskAck, setRiskAck] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<
    "all" | "groq" | "bedrock" | "ollama" | "openai" | "anthropic" | "google" | "xai"
  >("all");
  /** Connections stays open on arrival. Vendor APIs start expanded inside it. */
  const [connectionsOpen, setConnectionsOpen] = useState(true);
  const [openModule, setOpenModule] = useState<SettingsModuleId | null>("vendor");
  const pickedProviderDefault = useRef(false);
  const { results, test } = useModelTester();
  const sharedCatalog = useModelCatalog();
  const [inventoryView, setInventoryView] = useState<InventoryView | null>(null);
  const [recommendedRun, setRecommendedRun] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  // modelFilter only scopes the picker chips when a credential row is selected.

  const [keyDraft, setKeyDraft] = useState("");
  const [keyRegion, setKeyRegion] = useState("us-east-1");
  const [keyLabel, setKeyLabel] = useState("");
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [setupRun, setSetupRun] = useState<{
    provider: WiredVendorKind;
    done: number;
    total: number;
  } | null>(null);
  const setupCancel = useRef(false);

  const detection = useMemo(() => detectProviderKey(keyDraft), [keyDraft]);
  const rejected = isRejectedKeyKind(detection.kind);

  const applyProviderStatus = useCallback((p: ProviderStatus) => {
    setStatus(p);
    if (p.bedrockRegion) setKeyRegion(p.bedrockRegion);
    const ack = Boolean(p.externalRiskAckAt);
    setRiskAck(ack);
    setSelectedKeyId(prev => {
      const stillValid =
        prev &&
        p.keys.some(k => {
          if (k.id !== prev) return false;
          // Hide vendor selection when consent is off
          if (!ack && isVendorCatalog(k.catalog)) return false;
          return true;
        });
      if (stillValid) return prev;
      const primary = p.primaryProvider;
      const pool = ack
        ? p.keys
        : p.keys.filter(k => k.catalog === "bedrock" || k.catalog === "ollama");
      const match =
        pool.find(k => k.catalog === primary && (k.status === "ready" || k.status === "local")) ??
        pool.find(k => k.status === "ready" || k.status === "local") ??
        pool[0] ??
        null;
      return match?.id ?? null;
    });
  }, []);

  const applyCatalog = useCallback((c: {
    groq: CatalogModel[];
    bedrock: CatalogModel[];
    ollama: CatalogModel[];
    openai: CatalogModel[];
    anthropic: CatalogModel[];
    google: CatalogModel[];
    xai?: CatalogModel[];
    errors: string[];
  }) => {
    setGroq(c.groq);
    setBedrock(c.bedrock);
    setOllama(c.ollama);
    setOpenai(c.openai ?? []);
    setAnthropic(c.anthropic ?? []);
    setGoogle(c.google ?? []);
    setXai(c.xai ?? []);
    setErrors(c.errors ?? []);
  }, []);

  /**
   * Re-fetch provider status and/or model catalog for one module (or the whole page).
   * Bedrock uses ?recheck=1 so AWS chain / SSO changes show up without a browser reload.
   */
  const refresh = useCallback(async (opts?: {
    recheckAws?: boolean;
    providers?: boolean;
    catalog?: boolean;
    /** When set, only that module shows a spinner — page content stays visible. */
    module?: SettingsModuleId | null;
  }) => {
    const {
      recheckAws = false,
      providers = true,
      catalog = true,
      module = null,
    } = opts ?? {};

    if (module) setRefreshingModule(module);
    else setLoading(true);

    try {
      if (providers) {
        const pRes = await fetch(
          `/api/settings/providers${recheckAws ? "?recheck=1" : ""}`,
          { credentials: "same-origin" },
        );
        if (pRes.ok) {
          applyProviderStatus((await pRes.json()) as ProviderStatus);
          setProvidersReady(true);
        }
      }
      if (catalog) {
        const cRes = await fetch(
          `/api/models/catalog${recheckAws || module ? "?fresh=1" : ""}`,
          { credentials: "same-origin" },
        );
        if (cRes.ok) {
          applyCatalog(
            (await cRes.json()) as {
              groq: CatalogModel[];
              bedrock: CatalogModel[];
              ollama: CatalogModel[];
              openai: CatalogModel[];
              anthropic: CatalogModel[];
              google: CatalogModel[];
              xai: CatalogModel[];
              errors: string[];
            },
          );
        }
      }
    } finally {
      if (module) setRefreshingModule(null);
      else setLoading(false);
    }
  }, [applyCatalog, applyProviderStatus]);

  const refreshModule = useCallback(
    async (id: SettingsModuleId) => {
      setNote(null);
      switch (id) {
        case "vendor":
          // Consent + stored keys; catalog so Groq counts update after a new key.
          await refresh({ module: id, providers: true, catalog: true, recheckAws: false });
          await sharedCatalog.refresh();
          setNote("Vendor APIs refreshed");
          break;
        case "bedrock":
          // Full AWS host re-check (profiles, caller identity, billable gate).
          await refresh({ module: id, providers: true, catalog: true, recheckAws: true });
          await sharedCatalog.refresh();
          setNote("Bedrock status refreshed");
          break;
        case "local":
          // Re-probe Ollama reachability via catalog.
          await refresh({ module: id, providers: true, catalog: true, recheckAws: false });
          await sharedCatalog.refresh();
          setNote("Local models refreshed");
          break;
        case "voice":
          await refresh({ module: id, providers: true, catalog: false, recheckAws: false });
          setNote("Voice transcription refreshed");
          break;
        case "tiers":
        case "models":
          await refresh({ module: id, providers: true, catalog: true, recheckAws: false });
          await sharedCatalog.refresh();
          setNote("Model catalog refreshed");
          break;
      }
    },
    [refresh, sharedCatalog.refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    setupCancel.current = true;
  }, []);

  const runSetupCheck = useCallback(async (provider: WiredVendorKind, recheck = false) => {
    const startedAt = Date.now();
    setupCancel.current = false;
    setSetupRun({ provider, done: 0, total: 0 });
    setNote(recheck ? "Re-checking this key. Each model that failed before is tried once more." : "Checking which models this key can use. Each model is tried once.");
    let checked = 0;
    let ready = 0;
    let throttles = 0;
    try {
      for (;;) {
        if (setupCancel.current) return;
        const res = await fetch("/api/models/verify-setup", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, fresh: checked === 0, ...(recheck ? { recheckSince: startedAt } : {}) }),
        });
        let data: {
          done?: boolean;
          stopped?: boolean;
          ok?: boolean | null;
          remaining?: number;
          code?: string | null;
          message?: string | null;
          error?: string;
        } = {};
        try {
          data = await res.json();
        } catch {
          setNote("Could not check model access.");
          return;
        }
        if (!res.ok) {
          setNote(data.error ?? "Could not check model access.");
          return;
        }
        if (data.stopped) {
          setNote(data.message ?? "This account cannot run models yet. The rest were left unchecked.");
          return;
        }
        if (data.done) {
          setNote(
            ready > 0
              ? `${ready} models are ready for chat.`
              : checked === 0
                ? "These models were already checked for this key."
                : "No listed model answered. They stay out of the chat menus.",
          );
          return;
        }
        checked += 1;
        if (data.ok) ready += 1;
        setSetupRun({
          provider,
          done: checked,
          total: checked + (data.remaining ?? 0),
        });
        if (data.code === "throttled") {
          throttles += 1;
          if (throttles >= 3) {
            setNote("The provider is rate limiting the check. Press Check access again in a moment.");
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          throttles = 0;
        }
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not check model access.");
    } finally {
      setSetupRun(null);
      await refresh({ providers: false, catalog: true, module: "models" });
      await sharedCatalog.refresh();
    }
  }, [refresh, sharedCatalog]);

  useEffect(() => {
    if (pickedProviderDefault.current) return;
    try {
      if (sessionStorage.getItem(HIGHLIGHT_BEDROCK_KEY) === "1") {
        pickedProviderDefault.current = true;
        setConnectionsOpen(true);
        setOpenModule("bedrock");
      }
    } catch {
      /* private browsing */
    }
  }, []);

  useEffect(() => {
    void sharedCatalog.ensureLoaded();
  }, [sharedCatalog.ensureLoaded]);

  async function save(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setNote(null);
    let sweep: WiredVendorKind | null = null;
    try {
      const res = await fetch("/api/settings/providers", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: { error?: string } & Partial<ProviderStatus> = {};
      try {
        data = (await res.json()) as { error?: string } & Partial<ProviderStatus>;
      } catch {
        setNote(res.ok ? okMsg : `Save failed (HTTP ${res.status}).`);
        return;
      }
      if (!res.ok) {
        setNote(data.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      setStatus(data as ProviderStatus);
      setKeyDraft("");
      setKeyLabel("");
      await refresh();
      await sharedCatalog.refresh();
      const addedGroq =
        (typeof body.addKey === "object" &&
          body.addKey &&
          (body.addKey as { kind?: string }).kind === "groq") ||
        typeof body.groqApiKey === "string";
      if (addedGroq) {
        try {
          const catRes = await fetch("/api/models/catalog?fresh=1", { credentials: "same-origin" });
          if (catRes.ok) {
            const cat = (await catRes.json()) as {
              groq: CatalogModel[];
              errors?: string[];
            };
            applyCatalog(cat as Parameters<typeof applyCatalog>[0]);
            if ((cat.groq?.length ?? 0) === 0) {
              const detail = cat.errors?.length
                ? formatGroqConnectivityError(new Error(cat.errors.join(" ")))
                : formatGroqConnectivityError(new Error("Groq returned no text models."));
              setNote(`Key saved, but Groq is not reachable yet — ${detail}`);
              onProvidersChanged?.();
              return;
            }
          }
        } catch {
          /* refresh already ran */
        }
      }
      const addedKind =
        typeof body.addKey === "object" && body.addKey
          ? (body.addKey as { kind?: string }).kind
          : undefined;
      if (isWiredVendorKind(addedKind ?? "")) sweep = addedKind as WiredVendorKind;
      if (!sweep) setNote(okMsg);
      onProvidersChanged?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save provider settings.");
    } finally {
      setBusy(false);
    }
    if (sweep) await runSetupCheck(sweep);
  }

  const canEdit = status?.canEdit ?? false;
  const keys = status?.keys ?? [];
  /** Third-party vendor keys — gated behind external-risk consent. */
  const vendorKeys = keys.filter(k => isVendorCatalog(k.catalog));
  /** Local Ollama + AWS Bedrock — not covered by vendor consent. */
  const localAwsKeys = keys.filter(k => k.catalog === "bedrock" || k.catalog === "ollama");
  const selectedKey = keys.find(k => k.id === selectedKeyId) ?? null;

  const allModels = useMemo(
    () => buildSettingsCatalogModels(sharedCatalog.catalog),
    [sharedCatalog.catalog],
  );

  const blockedVendorNotice = useMemo(() => {
    if (riskAck) return null;
    const labels: string[] = [];
    const check = (
      catalog: "google" | "openai" | "anthropic" | "xai",
      label: string,
      count: number,
    ) => {
      const has = keys.some(
        k => k.catalog === catalog && (k.status === "ready" || k.status === "stored"),
      );
      if (has && count === 0) labels.push(label);
    };
    check("google", "Google", sharedCatalog.catalog.google.length);
    check("openai", "OpenAI", sharedCatalog.catalog.openai.length);
    check("anthropic", "Anthropic", sharedCatalog.catalog.anthropic.length);
    check("xai", "Grok", sharedCatalog.catalog.xai?.length ?? 0);
    if (labels.length === 0) return null;
    const verb = labels.length === 1 ? "is" : "are";
    return `${labels.join(", ")} ${verb} configured in Connections, but Vendor APIs are not allowed, so those models are not listed yet. Allow Vendor APIs above to include them.`;
  }, [riskAck, keys, sharedCatalog.catalog.google.length, sharedCatalog.catalog.openai.length, sharedCatalog.catalog.anthropic.length, sharedCatalog.catalog.xai]);

  const ollamaChatModels = useMemo(
    () => chatSelectableModels(ollama),
    [ollama],
  );
  const ollamaEmbedModels = useMemo(
    () => ollama.filter(m => m.modality !== "text"),
    [ollama],
  );

  const modelCount = (p: WiredVendorKind | "bedrock" | "ollama") =>
    p === "groq"
      ? groq.length
      : p === "bedrock"
        ? bedrock.length
        : p === "ollama"
          ? ollama.length
          : p === "openai"
            ? openai.length
            : p === "anthropic"
              ? anthropic.length
              : p === "xai"
                ? xai.length
                : google.length;

  const inMenuCount = (p: WiredVendorKind) =>
    chatSelectableModels(allModels.filter(m => m.provider === p)).length;

  const inMenuModels = useMemo(() => chatSelectableModels(allModels), [allModels]);

  /** Tests the newest listed version of each recommended Bedrock family and keeps the ones that answer. */
  const enableRecommendedBedrock = useCallback(async () => {
    const plan = planRecommendedBedrock(allModels);
    if (plan.length === 0) return;
    setRecommendedRun({ busy: true, message: "Starting…" });
    const added: string[] = [];
    const missed: string[] = [];
    for (const family of plan) {
      let done = false;
      for (const candidate of family.candidates) {
        setRecommendedRun({ busy: true, message: `Checking ${candidate.name}…` });
        const outcome = await test(candidate, { refresh: false });
        if (outcome.ok) {
          added.push(candidate.name);
          done = true;
          break;
        }
      }
      if (!done) missed.push(family.label);
    }
    await sharedCatalog.refresh();
    const needConsole = recommendedNeedingConsole(allModels);
    const parts: string[] = [];
    if (added.length > 0) parts.push(`Added to chat: ${added.join(", ")}.`);
    if (missed.length > 0) {
      parts.push(`Could not add ${missed.join(" or ")}. Check that the model is turned on for your AWS account (Bedrock, Discover, Model catalog), then try again.`);
    }
    if (needConsole.length > 0) {
      parts.push(`${needConsole.join(" and ")} must be turned on in the Bedrock console first.`);
    }
    setRecommendedRun({ busy: false, message: parts.join(" ") || "Nothing to add." });
  }, [allModels, test, sharedCatalog]);

  function openAvailableModels(provider: "groq" | "google" | "openai" | "anthropic" | "xai") {
    setModelFilter(provider);
    setInventoryView(null);
    setOpenModule("models");
    void sharedCatalog.ensureLoaded();
    window.setTimeout(() => {
      document.getElementById("inference-module-models")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }

  /** From the Bedrock card: open the model list on the tab where models are turned on. */
  function reviewBedrockModels() {
    setModelFilter("all");
    setInventoryView("add");
    setOpenModule("models");
    void sharedCatalog.ensureLoaded();
    window.setTimeout(() => {
      document.getElementById("inference-module-models")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  const aws = status?.aws ?? null;
  const hosted = status?.edition === "cloud";
  const bedrockConsoleUrl = `https://console.aws.amazon.com/bedrock/home?region=${encodeURIComponent(status?.bedrockRegion ?? "us-east-1")}#/model-catalog`;
  const bedrockReady = Boolean(
    aws &&
      aws.allowRealAws &&
      !aws.lockedByEnvironment &&
      (hosted || (aws.detected && !aws.looksLikeFloci && status?.bedrockRegion)),
  );
  const ollamaKey = localAwsKeys.find(k => k.catalog === "ollama");
  const ollamaChatCount = ollamaChatModels.length;
  const ollamaEmbedCount = ollamaEmbedModels.length;
  const ollamaReady = ollamaChatCount > 0 || ollamaEmbedCount > 0;

  function toggleModule(id: SettingsModuleId) {
    const inConnections = id === "vendor" || id === "bedrock" || id === "local" || id === "voice";
    if (inConnections) setConnectionsOpen(true);
    else setConnectionsOpen(false);
    setOpenModule(prev => (prev === id ? null : id));
  }

  if (!providersReady) {
    return <InferenceSettingsSkeleton />;
  }

  if (!status) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-center space-y-3">
        <p className="text-sm text-foreground/70">Could not load provider settings.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {status.role !== "super_admin" && status.role !== "admin" && (
        <p className="text-[0.72rem] text-foreground/45 px-0.5">
          View connections and model assignments. An Admin must add credentials.
        </p>
      )}

      <SettingsModule
        id="models"
        className="order-2"
        open={openModule === "models"}
        onToggle={() => {
          toggleModule("models");
          void sharedCatalog.ensureLoaded();
        }}
        onRefresh={() => void refreshModule("models")}
        refreshing={refreshingModule === "models"}
        icon={<LayoutList className={cn("size-4", CATALOG_THEME.icon)} aria-hidden />}
        title="Your models"
        subtitle={(() => {
          const g = partitionModels(allModels);
          if (allModels.length === 0) return "Chat models from every configured credential";
          const parts = [`${g.inMenus.length} in chat`];
          if (g.notChecked.length > 0) parts.push(`${g.notChecked.length} to add`);
          if (g.failed.length > 0) parts.push(`${g.failed.length} not working`);
          return parts.join(" · ");
        })()}
        badge={
          <ModuleBadge tone={inMenuModels.length > 0 ? "ok" : "neutral"}>
            {sharedCatalog.loading || loading || refreshingModule === "models"
              ? "…"
              : inMenuModels.length > 0
                ? `${inMenuModels.length} in chat`
                : `${allModels.length} listed`}
          </ModuleBadge>
        }
        theme={CATALOG_THEME}
      >
        <ModelInventory
          models={allModels}
          loading={sharedCatalog.loading || loading}
          errors={[...new Set([...errors, ...sharedCatalog.catalog.errors])]}
          complexityTiers={complexityTiers}
          onTest={canEdit ? m => void test(m) : undefined}
          onEnableRecommendedBedrock={canEdit ? () => void enableRecommendedBedrock() : undefined}
          recommendedBedrock={{
            available: planRecommendedBedrock(allModels).length > 0,
            busy: recommendedRun.busy,
            message: recommendedRun.message,
          }}
          onToggleVisibility={canEdit ? async m => {
            const res = await fetch("/api/models/catalog", {
              method: "PATCH",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ modelId: m.id, provider: m.provider, hidden: !m.hidden }),
            });
            if (!res.ok) throw new Error("Could not save model visibility");
            await sharedCatalog.refresh();
          } : undefined}
          results={results}
          blockedNotice={blockedVendorNotice}
          emptyLabel="No chat models yet. Connect a vendor key, Ollama, or Bedrock in Connections above."
          providerFilter={modelFilter}
          onProviderFilterChange={setModelFilter}
          awsEnableUrl={aws?.allowRealAws ? bedrockConsoleUrl : undefined}
          view={inventoryView}
          onViewChange={setInventoryView}
        />
      </SettingsModule>

      <SettingsModule
        id="tiers"
        className="order-3"
        open={openModule === "tiers"}
        onToggle={() => toggleModule("tiers")}
        onRefresh={() => void refreshModule("tiers")}
        refreshing={refreshingModule === "tiers"}
        icon={<SlidersHorizontal className={cn("size-4", CATALOG_THEME.icon)} aria-hidden />}
        title="Complexity tiers"
        subtitle={
          complexityTiers.modelSelectionMode === "fixed"
            ? "Every message uses one fixed model"
            : "Chat routes by complexity — same assignments as Insights"
        }
        badge={
          <ModuleBadge tone="ok">
            {complexityTiers.modelSelectionMode === "fixed" ? "Fixed" : "Auto"}
          </ModuleBadge>
        }
        theme={CATALOG_THEME}
      >
        <ComplexityTiersEditor variant="page" {...complexityTiers} />
      </SettingsModule>

      <SettingsModule
        id="connections"
        className="order-1"
        open={connectionsOpen}
        onToggle={() => setConnectionsOpen(open => !open)}
        icon={<Cloud className={cn("size-4", CONNECTIONS_THEME.icon)} aria-hidden />}
        title="Connections"
        subtitle={
          hosted
            ? "Vendor APIs and Amazon Bedrock."
            : "Vendor APIs, Amazon Bedrock, and Ollama on this machine."
        }
        badge={<ModuleBadge tone="neutral">Model sources</ModuleBadge>}
        theme={CONNECTIONS_THEME}
      >
      <div className="flex flex-col gap-3">
      <SettingsModule
        id="vendor"
        className="order-1"
        open={openModule === "vendor"}
        onToggle={() => toggleModule("vendor")}
        onRefresh={() => void refreshModule("vendor")}
        refreshing={refreshingModule === "vendor"}
        icon={<Shield className={cn("size-4", PROVIDER_THEME.groq.icon)} aria-hidden />}
        title="External Vendor APIs"
        subtitle={riskAck ? "External vendors enabled" : "Consent required before vendor setup"}
        badge={
          <ModuleBadge tone={riskAck ? "ok" : "warn"}>
            {riskAck ? "Allowed" : "Blocked"}
          </ModuleBadge>
        }
        theme={PROVIDER_THEME.groq}
      >
        <div className="space-y-3">
          <p className="text-sm text-foreground/70 leading-relaxed">
            Two steps for each vendor. <span className="font-medium text-foreground/85">Key setup</span> stays on this row and shows where to create the key. <span className="font-medium text-foreground/85">Review models</span> moves you to the model list further down, where Enable adds a model to chat when it answers.
          </p>
          <details className="text-[0.68rem] text-foreground/40">
            <summary className="cursor-pointer text-foreground/55">Learn more</summary>
            <p className="mt-2 leading-relaxed">
              Matches become placeholders and cannot be restored. Uncheck to turn vendor APIs off. Bedrock and Ollama are separate.
            </p>
          </details>
          <label
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors",
              canEdit && !busy
                ? "cursor-pointer border-[var(--border-strong)] bg-muted hover:bg-[var(--surface-hover)]"
                : "cursor-not-allowed opacity-60 border-border bg-secondary",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-[var(--primary)] rounded border-border"
              checked={riskAck}
              disabled={!canEdit || busy}
              onChange={e => {
                const next = e.target.checked;
                setRiskAck(next);
                if (!next && selectedKey && isVendorCatalog(selectedKey.catalog)) {
                  const fallback = localAwsKeys.find(
                    k => k.status === "ready" || k.status === "local",
                  );
                  setSelectedKeyId(fallback?.id ?? null);
                  if (fallback?.catalog === "bedrock" || fallback?.catalog === "ollama") {
                    setModelFilter(fallback.catalog);
                  }
                }
                void save(
                  { acknowledgeExternalRisk: next },
                  next
                    ? "Vendor API risk acknowledged — Groq etc. may be used"
                    : "Vendor API consent revoked — Groq etc. disabled",
                );
              }}
            />
            <span className="text-[0.78rem] text-foreground leading-snug">
              I understand detected personal data is replaced before vendor calls. The scan can miss things, and I still review what I send.
            </span>
          </label>

          {riskAck && (
            <div className="rounded-lg border border-[var(--border-strong)] bg-elevated px-3.5 py-3.5 space-y-3">
              {canEdit && (
                <div className="rounded-lg border border-[var(--primary-border)] bg-[var(--primary-soft)] px-4 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-primary" aria-hidden />
                    <p className="text-sm font-semibold text-foreground">Add a vendor API key</p>
                  </div>
                  <label htmlFor="vendor-key-input" className="sr-only">Vendor API key</label>
                  <input
                    id="vendor-key-input"
                    type="password"
                    value={keyDraft}
                    onChange={e => setKeyDraft(e.target.value)}
                    placeholder="Paste a vendor API key (Groq, Gemini, Grok, OpenAI…)"
                    autoComplete="off"
                    disabled={busy}
                    className="w-full h-11 rounded-lg border border-[var(--primary-border)] bg-card px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {keyDraft.trim() && (
                    <div className="rounded-md bg-card border border-border px-2.5 py-2">
                      <p className="text-[0.7rem] text-foreground/80 font-medium">{detection.label}</p>
                      <p className="text-[0.6rem] text-foreground/40 mt-0.5 leading-relaxed">
                        {detection.description}
                      </p>
                      {!rejected && detection.wired && detection.kind !== "unknown" && (
                        <p className="text-[0.58rem] text-emerald-200/75 mt-1">
                          {detection.label} is supported. Saving the key checks each listed model once.
                        </p>
                      )}
                      {!rejected && !detection.wired && detection.kind !== "unknown" && (
                        <p className="text-[0.58rem] text-amber-200/70 mt-1">
                          Key will be stored, but chat for this vendor is not wired yet.
                        </p>
                      )}
                    </div>
                  )}
                  {rejected && (
                    <p className="text-[0.62rem] text-red-300/80 leading-relaxed">
                      AWS credentials are not pasted here. Open the Amazon Bedrock module (profile /
                      SSO on this host).
                    </p>
                  )}
                  {!rejected &&
                    (detection.kind === "unknown" || !detection.wired) &&
                    keyDraft.trim() && (
                      <input
                        type="text"
                        value={keyLabel}
                        onChange={e => setKeyLabel(e.target.value)}
                        placeholder="Optional label (e.g. GCP prod)"
                        className="w-full h-9 rounded-lg border border-border bg-elevated px-3 text-xs text-foreground/80 placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                      />
                    )}
                  <button
                    type="button"
                    disabled={busy || !keyDraft.trim() || rejected}
                    onClick={() =>
                      void save(
                        {
                          addKey: {
                            secret: keyDraft.trim(),
                            region: keyRegion.trim() || undefined,
                            label: keyLabel.trim() || undefined,
                            kind: detection.kind as DetectedKeyKind,
                          },
                          ...(detection.kind === "groq"
                            ? { primaryProvider: "groq" as const }
                            : {}),
                        },
                        `${detection.label} saved`,
                      )
                    }
                    className={cn(
                      "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                      "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:opacity-45 disabled:pointer-events-none cursor-pointer",
                    )}
                  >
                    Save key
                  </button>
                </div>
              )}
              <SupportedVendorsPanel
                keys={vendorKeys}
                modelCounts={{
                  groq: groq.length,
                  openai: openai.length,
                  anthropic: anthropic.length,
                  google: google.length,
                  xai: xai.length,
                }}
                catalogErrors={errors}
                riskAck={riskAck}
                canEdit={canEdit}
                busy={busy}
                setupRun={setupRun}
                onCheckAccess={provider => void runSetupCheck(provider)}
                onRecheck={provider => void runSetupCheck(provider, true)}
                keyHealth={{
                  groq: deriveKeyHealth(allModels.filter(m => m.provider === "groq")),
                  openai: deriveKeyHealth(allModels.filter(m => m.provider === "openai")),
                  anthropic: deriveKeyHealth(allModels.filter(m => m.provider === "anthropic")),
                  google: deriveKeyHealth(allModels.filter(m => m.provider === "google")),
                  xai: deriveKeyHealth(allModels.filter(m => m.provider === "xai")),
                }}
                unverifiedCounts={{
                  groq: allModels.filter(m => m.provider === "groq" && (m.verification === undefined || m.verification === "unverified") && !m.hidden && m.modality !== "other").length,
                  openai: allModels.filter(m => m.provider === "openai" && (m.verification === undefined || m.verification === "unverified") && !m.hidden && m.modality !== "other").length,
                  anthropic: allModels.filter(m => m.provider === "anthropic" && (m.verification === undefined || m.verification === "unverified") && !m.hidden && m.modality !== "other").length,
                  google: allModels.filter(m => m.provider === "google" && (m.verification === undefined || m.verification === "unverified") && !m.hidden && m.modality !== "other").length,
                  xai: allModels.filter(m => m.provider === "xai" && (m.verification === undefined || m.verification === "unverified") && !m.hidden && m.modality !== "other").length,
                }}
                inMenuCounts={{
                  groq: inMenuCount("groq"),
                  openai: inMenuCount("openai"),
                  anthropic: inMenuCount("anthropic"),
                  google: inMenuCount("google"),
                  xai: inMenuCount("xai"),
                }}
                onOpenModels={openAvailableModels}
                onRemove={k => void save({ removeKeyId: k.id }, `Removed ${k.label}`)}
              />

              {vendorKeys.some(k => k.catalog === "groq") && groq.length === 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2.5 space-y-2">
                  <p className="text-[0.68rem] font-medium text-amber-200">
                    Groq key saved, but no models loaded
                  </p>
                  <p className="text-[0.62rem] text-foreground/55 leading-relaxed">
                    Chat will not use Groq until this server can list models. Voice uses Groq Whisper, a different endpoint, so transcription can still work.
                  </p>
                  {errors.length > 0 && (
                    <p className="text-[0.62rem] text-amber-200/80 font-mono">{errors.join(" · ")}</p>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy || refreshingModule === "vendor"}
                      onClick={() => void (async () => {
                        await refresh({ module: "vendor", providers: false, catalog: true });
                        await sharedCatalog.refresh();
                      })()}
                      className={cn(
                        "inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/15",
                        "px-2.5 py-1 text-[0.68rem] font-semibold text-amber-100",
                        "hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer",
                      )}
                    >
                      {refreshingModule === "vendor" ? "Checking…" : "Check key"}
                    </button>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </SettingsModule>

      <SettingsModule
        id="bedrock"
        className="order-2"
        open={openModule === "bedrock"}
        onToggle={() => toggleModule("bedrock")}
        onRefresh={() => void refreshModule("bedrock")}
        refreshing={refreshingModule === "bedrock"}
        icon={<Cloud className={cn("size-4", PROVIDER_THEME.bedrock.icon)} aria-hidden />}
        title="Amazon Bedrock"
        subtitle="Bedrock requests run in your AWS account and may incur AWS usage charges."
        badge={
          <ModuleBadge tone={bedrockReady ? "ok" : "warn"}>
            {bedrockReady ? "Ready" : "Not ready"}
          </ModuleBadge>
        }
        theme={PROVIDER_THEME.bedrock}
      >
        <div className="space-y-3">
            <BedrockEnvironmentCard
              aws={status.aws}
              region={status.bedrockRegion}
              canEdit={canEdit}
              busy={busy || refreshingModule === "bedrock"}
              hosted={hosted}
              docker={status.deployment === "docker"}
              embedded
              consoleUrl={bedrockConsoleUrl}
              onReviewModels={reviewBedrockModels}
              onSave={save}
              onRecheck={() => refreshModule("bedrock")}
            />
        </div>
      </SettingsModule>

      <SettingsModule
        id="voice"
        className="order-4"
        open={openModule === "voice"}
        onToggle={() => toggleModule("voice")}
        onRefresh={() => void refreshModule("voice")}
        refreshing={refreshingModule === "voice"}
        icon={<Mic className="size-4 text-foreground/55" aria-hidden />}
        title="Voice transcription"
        subtitle={voiceProviderDestination(status.voiceSttChoice)}
        badge={
          <ModuleBadge tone={status.voiceSttChoice ? "ok" : "warn"}>
            {voiceProviderLabel(status.voiceSttChoice)}
          </ModuleBadge>
        }
        theme={CATALOG_THEME}
      >
        <div className="space-y-3">
          {status.voiceSttChoice === "groq" && (
            <p className="text-[0.75rem] text-foreground/70 leading-relaxed">
              Microphone audio is sent to <span className="font-medium text-foreground/85">Groq Whisper</span>.
              Amazon Transcribe is not called for voice.
            </p>
          )}
          {status.voiceSttChoice === "transcribe" && (
            <p className="text-[0.75rem] text-foreground/70 leading-relaxed">
              Microphone audio is sent to{" "}
              <span className="font-medium text-foreground/85">Amazon Transcribe</span> in this AWS
              account. Groq is not called for voice.
            </p>
          )}
          {!status.voiceSttChoice && (
            <p className="text-[0.75rem] text-foreground/60 leading-relaxed">
              The first microphone use asks you to pick Groq Whisper or Amazon Transcribe. Only the
              one you pick receives spoken audio.
            </p>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setVoiceSetupOpen(true)}
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold border border-[var(--border-strong)] bg-muted text-foreground/80 hover:bg-[var(--surface-hover)]"
            >
              {status.voiceSttChoice ? "Change voice provider" : "Choose voice provider"}
            </button>
          )}
        </div>
      </SettingsModule>

      {!hosted && (
      <SettingsModule
        id="local"
        open={openModule === "local"}
        onToggle={() => toggleModule("local")}
        onRefresh={() => void refreshModule("local")}
        refreshing={refreshingModule === "local"}
        icon={<HardDrive className={cn("size-4", PROVIDER_THEME.ollama.icon)} aria-hidden />}
        title="Local models"
        className="order-3"
        subtitle="Ollama on this machine — chat fallback and embeddings"
        badge={
          <ModuleBadge tone={ollamaChatCount > 0 ? "ok" : ollamaReady ? "warn" : "warn"}>
            {ollamaReady
              ? ollamaChatCount > 0
                ? `${ollamaChatCount} chat${ollamaEmbedCount > 0 ? ` · ${ollamaEmbedCount} embed` : ""}`
                : "No chat model"
              : "Not running"}
          </ModuleBadge>
        }
        theme={PROVIDER_THEME.ollama}
      >
        <div className="space-y-3">
          <p className="text-[0.72rem] text-muted-foreground">
            These stay on this machine. Use a chat model for conversation and nomic-embed-text for Knowledge.
          </p>
          <details className="text-[0.68rem] text-foreground/45">
            <summary className="cursor-pointer text-foreground/55">Details</summary>
            <p className="mt-2 leading-relaxed">
              Pull models with <code className="font-mono text-foreground/65">ollama pull llama3.2</code>.
              Embedding models cannot be assigned to chat tiers.
            </p>
          </details>

          <div
            className={cn(
              "rounded-lg border px-3 py-2.5 flex items-start justify-between gap-2",
              PROVIDER_THEME.ollama.surface,
            )}
          >
            <div className="min-w-0">
              <p className="text-[0.75rem] font-medium text-foreground/85">
                {ollamaKey?.label ?? "Ollama (local)"}
              </p>
              <p className="text-[0.6rem] text-foreground/40 mt-0.5 leading-snug">
                {ollamaReady
                  ? ollamaChatCount > 0
                    ? `${ollamaChatCount} chat model${ollamaChatCount === 1 ? "" : "s"} ready for conversations.`
                    : "Embedding model(s) only — pull a chat model (e.g. llama3.2) to use Ollama for chat."
                  : ollamaKey?.description ??
                    "No credential — Ollama models run on this machine only."}
              </p>
              {ollamaEmbedCount > 0 && (
                <p className="text-[0.58rem] text-foreground/35 mt-1">
                  Installed for Knowledge:{" "}
                  {ollamaEmbedModels.map(m => m.name).join(", ")}
                </p>
              )}
            </div>
            <StatusChip
              status={ollamaChatCount > 0 ? "local" : ollamaReady ? "incomplete" : "incomplete"}
              catalog="ollama"
              vendorKind="ollama"
              count={ollamaChatCount}
            />
          </div>

          {!ollamaReady && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 space-y-2">
              <p className="text-[0.68rem] font-medium text-amber-300">
                Get Ollama working
              </p>
              <ol className="space-y-1.5 text-[0.62rem] text-foreground/55 leading-relaxed list-decimal list-inside">
                <li>
                  Install from{" "}
                  <a
                    href="https://ollama.com/download"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-indigo-300/85 underline underline-offset-2 hover:text-indigo-200"
                  >
                    ollama.com/download
                  </a>{" "}
                  (or run the Ollama Docker image).
                </li>
                <li>
                  Start the service so it listens on port{" "}
                  <code className="font-mono text-foreground/70">11434</code> (Desktop app usually
                  does this automatically).
                </li>
                <li>
                  Pull at least one <span className="text-foreground/70">chat</span> model and the{" "}
                  <span className="text-foreground/70">embedding</span> model (Knowledge):
                  <code className="mt-1 block font-mono text-[0.6rem] text-foreground/70 bg-foreground/[0.06] rounded px-2 py-1.5 whitespace-pre-wrap">
                    {`ollama pull llama3.2          # chat\nollama pull nomic-embed-text  # Knowledge search only`}
                  </code>
                </li>
                <li>
                  Then open <span className="text-foreground/75">Settings → Models</span> —
                  you should see an Ollama filter with your pulls. Use <span className="text-foreground/75">Test</span> to
                  confirm a model answers.
                </li>
              </ol>
            </div>
          )}

          {ollamaReady && (
            <div className="rounded-lg border border-border bg-muted px-3 py-2.5 space-y-1.5">
              <p className="text-[0.65rem] font-medium text-foreground/60">Tips</p>
              <ul className="space-y-1 text-[0.6rem] text-foreground/45 leading-relaxed list-disc list-inside">
                <li>
                  Override the base URL with{" "}
                  <code className="font-mono text-foreground/60">OLLAMA_BASE_URL</code> in{" "}
                  <code className="font-mono text-foreground/60">.env.local</code> if Ollama is not on
                  localhost.
                </li>
                <li>
                  Default chat model:{" "}
                  <code className="font-mono text-foreground/60">OLLAMA_CHAT_MODEL</code> /{" "}
                  <code className="font-mono text-foreground/60">OLLAMA_FALLBACK_MODEL</code>.
                  Embeddings: <code className="font-mono text-foreground/60">OLLAMA_EMBED_MODEL</code>.
                </li>
                <li>
                  Without Groq/Bedrock, map every complexity tier to a chat Ollama model in
                  Insights → Models — never <code className="font-mono">nomic-embed-text</code>.
                </li>
                <li>
                  No API key and no vendor-risk consent — chat/embed traffic stays on this machine.
                </li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  setConnectionsOpen(false);
                  setOpenModule("models");
                  void sharedCatalog.ensureLoaded();
                }}
                className={cn(
                  "mt-1 text-[0.7rem] font-medium underline underline-offset-2 cursor-pointer",
                  PROVIDER_THEME.ollama.icon,
                  "hover:opacity-90",
                )}
              >
                Browse Ollama models in Available models
              </button>
            </div>
          )}
        </div>
      </SettingsModule>
      )}
      </div>
      </SettingsModule>

      {note && <p className="order-4 text-[0.68rem] text-indigo-200/80 px-0.5">{note}</p>}

      <div className="order-5">
      <VoiceSttSetupDialog
        open={voiceSetupOpen}
        onClose={() => setVoiceSetupOpen(false)}
        onSaved={async () => {
          setVoiceSetupOpen(false);
          await refresh({ providers: true, catalog: false });
          onProvidersChanged?.();
        }}
      />
      </div>
    </div>
  );
}

function ModuleBadge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded border font-semibold",
        tone === "ok" && "text-emerald-300 border-emerald-500/40 bg-emerald-500/15",
        tone === "warn" && "text-amber-300 border-amber-500/40 bg-amber-500/15",
        tone === "neutral" && "text-foreground/60 border-border bg-muted",
      )}
    >
      {children}
    </span>
  );
}

function SettingsModule({
  id,
  open,
  onToggle,
  onRefresh,
  refreshing = false,
  icon,
  title,
  subtitle,
  badge,
  theme,
  className,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  icon: ReactNode;
  title: string;
  subtitle: string;
  badge: ReactNode;
  theme: ProviderTheme | typeof CATALOG_THEME;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        /* Solid card chrome — open state is a coloured border, not a pastel wash */
        "rounded-xl border bg-card transition-colors shadow-[var(--shadow-sm)]",
        open ? "overflow-visible" : "overflow-hidden",
        open
          ? cn(theme.borderOpen, "shadow-[var(--shadow-md)]")
          : "border-[var(--border-strong)]",
        className,
      )}
    >
      <div className="flex items-stretch gap-0.5 pr-2">
        <button
          type="button"
          id={`inference-module-${id}`}
          aria-expanded={open}
          aria-controls={`inference-panel-${id}`}
          onClick={onToggle}
          className="min-w-0 flex-1 flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-muted/70 transition-colors"
        >
          <span className="shrink-0 mt-0.5">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground/90">{title}</span>
              {badge}
            </span>
            <span className="block text-[0.65rem] text-foreground/40 mt-0.5 leading-snug">
              {subtitle}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-foreground/35 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {onRefresh && (
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={refreshing}
            title={`Refresh ${title}`}
            aria-label={`Refresh ${title}`}
            className={cn(
              "shrink-0 self-center rounded-lg p-2 transition-colors cursor-pointer",
              "text-foreground/35 hover:text-foreground/75 hover:bg-foreground/[0.06]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <RefreshCw
              className={cn("size-3.5", refreshing && "animate-spin")}
              aria-hidden
            />
          </button>
        )}
      </div>
      {open && (
        <div
          id={`inference-panel-${id}`}
          role="region"
          aria-labelledby={`inference-module-${id}`}
          className="px-4 pb-5 pt-0 border-t border-border bg-elevated overflow-visible"
        >
          <div className="pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  env: "Environment variables",
  "shared-profile": "Shared profile / SSO login",
  "container-role": "Container role",
  "instance-role": "Instance role",
  "web-identity": "Web identity token",
  none: "Not found",
};

const COMMON_REGIONS = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-2",
  "ap-northeast-1",
];

function LocalBedrockSignIn({
  docker,
  profile,
  hasProfiles,
}: {
  docker: boolean;
  profile: string | null;
  hasProfiles: boolean;
}) {
  const loginProfile = profile || "your-profile";
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-3 text-sm text-foreground/75 space-y-2">
      <p className="font-semibold text-foreground/90">Sign in on this computer</p>
      <p className="leading-relaxed">
        {docker
          ? "Docker reads the AWS CLI config on this computer. SecureMind does not store AWS keys."
          : "This app reads the AWS CLI config on this computer. SecureMind does not store AWS keys."}
      </p>
      <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
        {!hasProfiles && (
          <li>
            One time, create a profile:{" "}
            <code className="font-mono text-foreground/85">aws configure sso</code>
          </li>
        )}
        <li>
          Sign in:{" "}
          <code className="font-mono text-foreground/85">aws sso login --profile {loginProfile}</code>
        </li>
        <li>{hasProfiles ? "Press Re-check host, then choose that profile." : "Press Re-check host."}</li>
      </ol>
      <p className="leading-relaxed text-foreground/60">
        A working sign-in shows Found and the AWS account id. When the session expires, run the
        sign-in command again and press Re-check host.
      </p>
    </div>
  );
}

export function BedrockEnvironmentCard({
  aws,
  region,
  canEdit,
  busy,
  hosted = false,
  docker = false,
  embedded = false,
  consoleUrl,
  onReviewModels,
  onSave,
  onRecheck,
}: {
  aws: AwsStatus;
  region: string | null;
  canEdit: boolean;
  busy: boolean;
  /** Hosted install: chat uses Lambda IAM, not a laptop profile. */
  hosted?: boolean;
  /** Local Compose app: AWS CLI files are mounted from this computer. */
  docker?: boolean;
  /** When true, omit outer card chrome (parent SettingsModule already provides it). */
  embedded?: boolean;
  /** Where Bedrock models are turned on in the AWS console, for this region. */
  consoleUrl: string;
  /** Opens the model list on the tab where models are added to chat. */
  onReviewModels: () => void;
  onSave: (body: Record<string, unknown>, okMsg: string) => Promise<void>;
  onRecheck: () => Promise<void>;
}) {
  const usable = hosted
    ? aws.allowRealAws && !aws.lockedByEnvironment
    : aws.allowRealAws && aws.detected && !aws.looksLikeFloci && Boolean(region);
  const profiles = aws.availableProfiles ?? [];
  const ackRef = useRef<HTMLLabelElement>(null);
  const [spotlight, setSpotlight] = useState(false);

  useEffect(() => {
    if (!consumeBedrockHighlight()) return;
    setSpotlight(true);
    const id = window.setTimeout(() => {
      ackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
    const off = window.setTimeout(() => setSpotlight(false), 6000);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(off);
    };
  }, []);

  const body = (
    <>
      {!embedded && (
        <div className="flex items-start gap-3">
          <Cloud
            className={cn(
              "size-5 shrink-0 mt-0.5",
              usable ? "text-emerald-300/90" : "text-amber-300/90",
            )}
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground/85">Amazon Bedrock</p>
              <span
                className={cn(
                  "text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded border font-semibold",
                  usable
                    ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/20"
                    : "text-amber-300 border-amber-500/40 bg-amber-500/15",
                )}
              >
                {usable ? "Ready" : "Not ready"}
              </span>
            </div>
            <p className="text-[0.62rem] text-foreground/40 mt-1 leading-relaxed">
              Runs in your AWS account via the local credential chain — not a third-party vendor key.
            </p>
          </div>
        </div>
      )}

      {embedded && (
        <p className="text-sm text-foreground/70 leading-relaxed">
          {hosted
            ? "Enable Amazon Bedrock for this hosted install. Chat runs through this deployment’s IAM role. SecureMind does not take AWS access keys, and it cannot enable model access or set AWS billing limits for you."
            : "Enable Amazon Bedrock. Sign in with the AWS CLI on this computer, then choose a profile. SecureMind does not take AWS access keys, and it cannot enable model access or set AWS billing limits for you."}
        </p>
      )}

      {canEdit && (
        <label
          ref={ackRef}
          id="bedrock-acknowledgement"
          className={cn(
            "flex items-start gap-3 rounded-lg border px-3 py-3 text-[0.78rem] transition-colors",
            aws.lockedByEnvironment
              ? "text-muted-foreground cursor-not-allowed border-border bg-muted opacity-70"
              : aws.allowRealAws
                ? "text-foreground cursor-pointer border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/[0.14]"
                : "text-foreground cursor-pointer border-amber-500/35 bg-amber-500/[0.08] hover:bg-amber-500/[0.12]",
            spotlight && "ring-4 ring-indigo-400/90 shadow-[0_0_0_6px_rgba(99,102,241,0.25)]",
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-[var(--primary)] cursor-pointer disabled:cursor-not-allowed"
            checked={aws.allowRealAws}
            disabled={busy || aws.lockedByEnvironment}
            onChange={e =>
              void onSave(
                { allowRealAws: e.target.checked },
                e.target.checked ? "Billable AWS calls enabled" : "Billable AWS calls disabled",
              )
            }
          />
          <span className="leading-snug">
            {spotlight ? (
              <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wide text-indigo-300">
                Check this box
              </span>
            ) : null}
            I understand that enabling Bedrock permits SecureMind to make billable model requests in
            my AWS account.
            {aws.lockedByEnvironment
              ? " Locked off by ALLOW_REAL_AWS=false in this host environment."
              : ""}
          </span>
        </label>
      )}

      {!aws.allowRealAws && (
        <details className="text-[0.68rem] text-foreground/45" open={hosted}>
          <summary className="cursor-pointer text-foreground/55">What you need</summary>
          {hosted ? (
            <ol className="mt-2 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>Check the box above (Admin). That is the app-side billing acknowledgement.</li>
              <li>
                In the same AWS account as this install, open{" "}
                <a
                  href={consoleUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-indigo-300/80 underline underline-offset-2"
                >
                  Bedrock model catalog
                </a>{" "}
                and enable at least one text chat model.
              </li>
              <li>Come back to chat and send a message. IAM for invoke is already on this deployment.</li>
            </ol>
          ) : (
            <ul className="mt-2 space-y-1 list-disc list-inside leading-relaxed">
              <li>An AWS profile or SSO session on this host</li>
              <li>Bedrock model access in the AWS console</li>
              <li>IAM permissions for invoke and model listing</li>
            </ul>
          )}
          <a
            href="https://console.aws.amazon.com/billing/home#/budgets"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 mt-2 text-indigo-300/80 underline underline-offset-2"
          >
            AWS Budgets
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </details>
      )}

      {aws.allowRealAws && (
        <>
          {!hosted && (!aws.detected || aws.looksLikeFloci) && (
            <LocalBedrockSignIn
              docker={docker}
              profile={aws.profile}
              hasProfiles={profiles.length > 0}
            />
          )}
          <ol className="space-y-3" aria-label="Turn on Bedrock models">
            <li className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-semibold text-emerald-200">1</span>
              <div>
                <p className="text-sm font-medium text-foreground/85">Allow Bedrock in SecureMind <span className="ml-1 text-emerald-300/90">Done</span></p>
                <p className="text-[0.78rem] text-foreground/55 leading-relaxed">
                  {hosted
                    ? "Chat runs through this install’s IAM role. Nothing to create by hand."
                    : "Chat uses the AWS profile on this computer."}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-xs font-semibold text-amber-100">2</span>
              <div>
                <p className="text-sm font-medium text-foreground/85">Turn the models on in your AWS account</p>
                <p className="text-[0.78rem] text-foreground/55 leading-relaxed">
                  AWS lists many models but only runs the ones your account has switched on. SecureMind cannot do this step for you. Anthropic models may ask a short form the first time.
                </p>
                <a
                  href={consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[0.8rem] font-medium text-amber-50 hover:bg-amber-400/20"
                >
                  Open the Bedrock model catalog in AWS ↗
                </a>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/25 text-xs font-semibold text-indigo-100">3</span>
              <div>
                <p className="text-sm font-medium text-foreground/85">Add them to chat</p>
                <p className="text-[0.78rem] text-foreground/55 leading-relaxed">
                  Back here, press Enable on each model you turned on. One tiny test message confirms it answers.
                </p>
                <button
                  type="button"
                  onClick={onReviewModels}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-[0.8rem] font-medium text-foreground/85 hover:bg-foreground/[0.06] cursor-pointer"
                >
                  Go to Add more
                </button>
              </div>
            </li>
          </ol>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-foreground/35">Credentials</dt>
            <dd className={
              hosted || (aws.detected && !aws.looksLikeFloci)
                ? "text-emerald-200/85"
                : "text-amber-200/85"
            }>
              {hosted
                ? "This deployment’s IAM role (chat Lambda)"
                : aws.detected
                ? aws.looksLikeFloci
                  ? "Local sign-in only — choose an AWS profile"
                  : `Found${aws.hint ? ` (${aws.hint})` : ""}`
                : "Not found on this computer"}
            </dd>
            <dt className="text-foreground/35">Source</dt>
            <dd className="text-foreground/60">{SOURCE_LABELS[aws.source] ?? aws.source}</dd>
            <dt className="text-foreground/35">Region</dt>
            <dd className={region ? "text-emerald-200/80 font-mono" : "text-amber-200/80"}>
              {region ?? "Not set"}
            </dd>
            {aws.caller?.accountId && (
              <>
                <dt className="text-foreground/35">Account</dt>
                <dd className="text-foreground/60 font-mono">{aws.caller.accountId}</dd>
              </>
            )}
          </dl>

          {canEdit && (
            <div className="space-y-2.5">
              {!hosted && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs uppercase tracking-wider text-foreground/45 font-semibold">
                    AWS profile
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRecheck()}
                    className="text-xs text-foreground/55 hover:text-foreground/80 disabled:opacity-40 cursor-pointer"
                  >
                    Re-check host
                  </button>
                </div>
                <SelectMenu
                  aria-label="AWS profile"
                  value={aws.profile ?? ""}
                  disabled={busy}
                  placeholder="Choose a profile"
                  options={[
                    {
                      value: "",
                      label: profiles.length > 0 ? "Choose a profile" : "No profiles visible yet",
                      hint: docker ? "From this computer's AWS CLI" : "AWS CLI on this computer",
                    },
                    ...profiles.map(p => ({
                      value: p,
                      label: p,
                      hint: "AWS CLI profile",
                    })),
                  ]}
                  onChange={v =>
                    void onSave(
                      { awsProfile: v || null },
                      v ? `Profile → ${v}` : "Using default credentials",
                    )
                  }
                />
              </div>
              )}
              <div>
                <label className="block text-[0.6rem] uppercase tracking-wider text-foreground/30 font-semibold mb-1">
                  Region
                </label>
                <SelectMenu
                  aria-label="Bedrock region"
                  mono
                  value={region ?? ""}
                  disabled={busy}
                  placeholder="Select a region…"
                  options={[
                    ...COMMON_REGIONS.map(r => ({ value: r, label: r })),
                    ...(region && !COMMON_REGIONS.includes(region)
                      ? [{ value: region, label: region }]
                      : []),
                  ]}
                  onChange={v => void onSave({ bedrockRegion: v }, `Region → ${v}`)}
                />
              </div>
            </div>
          )}

          {!usable && aws.error && (
            <p className="text-sm text-[var(--warning)] leading-relaxed">{aws.error}</p>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-4 space-y-3",
        usable
          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
          : "border-amber-500/35 bg-amber-500/[0.05]",
      )}
    >
      {body}
    </div>
  );
}

function StatusChip({
  status,
  catalog,
  vendorKind,
  count,
  inMenus,
}: {
  status: KeyInventoryItem["status"];
  catalog: KeyInventoryItem["catalog"];
  vendorKind?: string;
  count: number;
  inMenus?: number;
}) {
  const wiredVendorCatalog =
    catalog === "groq" ||
    catalog === "google" ||
    catalog === "openai" ||
    catalog === "anthropic" ||
    catalog === "xai";
  const menuPhrase = wiredVendorCatalog && status === "ready" && count > 0 && inMenus !== undefined
    ? vendorMenuPhrase(count, inMenus)
    : null;
  const label =
    status === "ready" && wiredVendorCatalog && count === 0
      ? "No models"
      : menuPhrase
        ? menuPhrase
        : status === "ready"
          ? `${count} models`
          : status === "local"
            ? `${count} models`
            : status === "incomplete"
              ? "Incomplete"
              : "Stored";
  const kind =
    vendorKind ??
    (catalog === "groq" ||
    catalog === "bedrock" ||
    catalog === "ollama" ||
    catalog === "google" ||
    catalog === "openai" ||
    catalog === "anthropic"
      ? catalog
      : "unknown");
  const theme = themeForVendor(kind);
  return (
    <span
      className={cn(
        "shrink-0 text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded border",
        status === "ready" || status === "local"
          ? count === 0 && catalog === "groq"
            ? "text-amber-200/80 border-amber-500/30 bg-amber-500/10"
            : theme.badge
          : status === "incomplete"
            ? "text-amber-200/80 border-amber-500/30 bg-amber-500/10"
            : "text-foreground/40 border-foreground/10 bg-foreground/[0.03]",
        catalog === "none" && status === "stored" && "normal-case",
      )}
    >
      {label}
    </span>
  );
}

function vendorNextStep(
  v: (typeof WIRED_VENDOR_APIS)[number],
  configured: boolean,
  models: number,
  inMenus: number,
  riskAck: boolean,
): string {
  if (!riskAck) return "Allow vendor APIs above before this key can be used.";
  if (!configured) return `No key yet. Open Key setup to create one, then paste it in the box below. ${v.blurb}`;
  if (models <= 0) return "Key is saved. Models have not loaded, so chat cannot use this vendor yet.";
  if (inMenus <= 0) return `The key works. ${models} models are listed. Check access tries each one once for this key and adds the ones that answer.`;
  if (inMenus < models) return `${inMenus} of ${models} models are ready for chat. Check access tries any that have not been checked for this key.`;
  return `${inMenus} models are ready for chat.`;
}

function SupportedVendorsPanel({
  keys,
  modelCounts,
  inMenuCounts,
  catalogErrors,
  riskAck,
  canEdit,
  busy,
  setupRun,
  unverifiedCounts,
  keyHealth,
  onCheckAccess,
  onRecheck,
  onOpenModels,
  onRemove,
}: {
  keys: KeyInventoryItem[];
  modelCounts: Record<WiredVendorKind, number>;
  inMenuCounts: Record<WiredVendorKind, number>;
  unverifiedCounts: Record<WiredVendorKind, number>;
  catalogErrors: string[];
  riskAck: boolean;
  canEdit: boolean;
  busy: boolean;
  setupRun: { provider: WiredVendorKind; done: number; total: number } | null;
  keyHealth: Record<WiredVendorKind, KeyHealth | null>;
  onCheckAccess: (kind: WiredVendorKind) => void;
  onRecheck: (kind: WiredVendorKind) => void;
  onOpenModels: (kind: WiredVendorKind) => void;
  onRemove: (key: KeyInventoryItem) => void;
}) {
  const [openKind, setOpenKind] = useState<WiredVendorKind | null>(null);
  const keyed = (kind: WiredVendorKind) =>
    keys.some(k => k.kind === kind && k.status === "ready");

  return (
    <ul className="space-y-2">
      {WIRED_VENDOR_APIS.map(v => {
        const stored = keys.find(k => k.kind === v.kind && (k.status === "ready" || k.status === "stored"));
        const configured = Boolean(stored) || keyed(v.kind);
        const models = modelCounts[v.kind];
        const inMenus = inMenuCounts[v.kind];
        const open = openKind === v.kind;
        const baseStatus = v.kind === "groq"
          ? groqVendorStatusLabel({
              riskAck,
              keySaved: configured,
              modelCount: models,
              catalogErrors,
            })
          : !riskAck
            ? "Consent needed"
            : configured
              ? "Connected"
              : "Not configured";
        const health = configured && riskAck ? keyHealth[v.kind] : null;
        const needsAttention = keyNeedsAttention(health);
        const status = needsAttention && health ? health.label : baseStatus;
        const warn = needsAttention || /rejected|Unreachable|0 models|Consent/i.test(status);
        const removable = Boolean(
          canEdit &&
          stored &&
          stored.source === "instance" &&
          (stored.id === "groq-instance" || stored.id.startsWith("extra:")),
        );
        return (
          <li
            key={v.kind}
            className="rounded-xl border border-border bg-card px-3.5 py-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[0.95rem] font-semibold text-foreground">{v.productName}</p>
                  {v.mark && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded border px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-wide",
                        themeForVendor(v.kind).badge,
                      )}
                    >
                      {v.mark}
                    </span>
                  )}
                  {stored?.hint && (
                    <span
                      className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/75"
                      title="Masked key identifier. Only the start and the last four characters are shown. The full secret is never shown."
                    >
                      Key {stored.hint}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-foreground/70 leading-relaxed">
                  {vendorNextStep(v, configured, models, inMenus, riskAck)}
                </p>
                {health && health.state !== "unchecked" && (
                  <p
                    role={needsAttention ? "alert" : undefined}
                    className={cn(
                      "mt-1.5 text-[0.8rem] leading-relaxed",
                      needsAttention ? "text-amber-200" : "text-foreground/55",
                    )}
                  >
                    {needsAttention ? (
                      <>
                        <span className="font-semibold">{health.label}.</span> {health.detail}
                      </>
                    ) : (
                      health.detail
                    )}
                    {relativeTime(health.checkedAt) ? ` Last checked ${relativeTime(health.checkedAt)}.` : ""}
                  </p>
                )}
              </div>
              <span className={cn(
                "shrink-0 rounded-md border px-2 py-1 text-xs font-semibold",
                warn
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-100"
                  : configured
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                    : "border-border bg-muted text-foreground/55",
              )}>
                {status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenKind(open ? null : v.kind)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-elevated px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted cursor-pointer"
              >
                Key setup
                <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
              </button>
              {setupRun?.provider === v.kind ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-100 opacity-80 cursor-wait"
                >
                  {setupRun.total > 0
                    ? `Checking ${setupRun.done} of ${setupRun.total}…`
                    : "Checking access…"}
                </button>
              ) : unverifiedCounts[v.kind] > 0 && canEdit ? (
                <button
                  type="button"
                  disabled={busy || setupRun !== null}
                  onClick={() => onCheckAccess(v.kind)}
                  className="inline-flex items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/25 disabled:opacity-45 cursor-pointer"
                >
                  Check access
                </button>
              ) : null}
              {needsAttention && canEdit && !setupRun ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRecheck(v.kind)}
                  className="inline-flex items-center rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer"
                >
                  Re-check key
                </button>
              ) : null}
              {models > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenModels(v.kind)}
                  className="inline-flex items-center rounded-lg border border-[var(--border-strong)] bg-elevated px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted cursor-pointer"
                >
                  {inMenus > 0 ? "Review models" : "View models"}
                </button>
              )}
              {removable && stored && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${stored.label}`}
                  onClick={() => onRemove(stored)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--destructive-border)] bg-[var(--destructive-soft)] px-3 py-2 text-sm font-semibold text-destructive hover:brightness-95 disabled:opacity-45 cursor-pointer"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Remove
                </button>
              )}
            </div>
            {open && (
              <div className="mt-3 rounded-lg border border-border bg-elevated px-3 py-3 space-y-2 text-sm text-foreground/75">
                <p>Key format: {v.keyHint}.</p>
                <a
                  href={v.keyCreateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-indigo-200 underline underline-offset-2"
                >
                  {v.keyCreateLabel}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
                <p className="text-foreground/55 leading-relaxed">
                  {v.docsNote ?? (v.kind === "groq" ? GROQ_VPN_SETTINGS_NOTE : "Create the key on that page, paste it below, then review the models.")}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md bg-foreground/[0.07] animate-pulse", className)}
      aria-hidden
    />
  );
}

function InferenceSettingsModuleSkeleton({ expanded = false }: { expanded?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border-strong)] bg-card overflow-hidden shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <SkeletonBar className="size-4 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonBar className="h-3.5 w-32" />
            <SkeletonBar className="h-4 w-16 rounded-full" />
          </div>
          <SkeletonBar className="h-2.5 w-full max-w-sm" />
        </div>
        <SkeletonBar className="size-4 shrink-0" />
      </div>
      {expanded && (
        <div className="border-t border-border bg-elevated px-4 pb-4 pt-3 space-y-3">
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-[92%]" />
          <SkeletonBar className="h-11 w-full rounded-lg" />
          <SkeletonBar className="h-24 w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function InferenceSettingsSkeleton() {
  return (
    <div
      className="space-y-3"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading models"
    >
      <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-4 py-3.5 space-y-2.5">
        <SkeletonBar className="h-2.5 w-16" />
        <SkeletonBar className="h-4 w-56" />
        <SkeletonBar className="h-2.5 w-full max-w-lg" />
      </div>

      <InferenceSettingsModuleSkeleton expanded />
      <InferenceSettingsModuleSkeleton />
      <InferenceSettingsModuleSkeleton />

      <p className="text-[0.62rem] text-foreground/35 px-0.5 animate-pulse">
        Loading models…
      </p>
    </div>
  );
}
