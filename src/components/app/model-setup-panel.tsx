"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { apiAuthHeaders, apiUrl, usesRemoteApi } from "@/lib/client/api-base";
import { markBedrockHighlight } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { themeForRuntime } from "@/lib/provider-theme";
import { parseVoiceSttChoice, voiceProviderLabel, type VoiceSttChoice } from "@/lib/transcribe/backend";
import type { SettingsSection } from "@/components/app/settings-hub";

export type RuntimeStatusPayload = {
  edition: "local" | "cloud";
  deployment?: "docker" | "host" | "hosted";
  chatReady: boolean;
  code: string | null;
  capabilities: {
    detection: { ready: boolean; label: string };
    documentParsing: { ready: boolean; formats: string[] };
    imageOcr: { ready: boolean; sendsPixelsOffHost: boolean; note: string };
    voiceStt?: {
      ready: boolean;
      provider: VoiceSttChoice | null;
      choice?: VoiceSttChoice | null;
      note: string;
    };
    embeddings: { ready: boolean; provider: string | null };
  };
  model: {
    provider: string | null;
    model: string | null;
    connected: boolean;
    source: string | null;
  };
  setup: {
    edition: "local" | "cloud";
    title: string;
    message: string;
    settingsSection: SettingsSection;
    qualityNote: string;
    remoteNote: string | null;
    ollama: {
      reachable: boolean;
      installedChatModels: string[];
      recommendation: {
        primary: string;
        enhanced: string | null;
        lightweight: string;
        reason: string;
        useInstalled: string | null;
      };
      hardware: {
        cpuCount: number;
        totalMemGb: number;
        gpuName: string | null;
        gpuVramMb: number | null;
      };
    } | null;
    cloud: {
      recommended: "bedrock";
      byok: string[];
    } | null;
  } | null;
};

const STATUS_BAR_OPEN_KEY = "sm_runtime_status_open";

function Chip({
  ok,
  label,
  provider,
}: {
  ok: boolean;
  label: string;
  provider?: string | null;
}) {
  const theme = provider ? themeForRuntime(provider) : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem]",
        theme && ok
          ? theme.badge
          : ok
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200/85"
            : "border-amber-500/25 bg-amber-500/10 text-amber-200/85",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          theme && ok ? "bg-current opacity-80" : ok ? "bg-emerald-400/80" : "bg-amber-400/80",
        )}
      />
      {label}
    </span>
  );
}

export function RuntimeStatusBar({
  status,
  inUseLabel,
  inUseProvider,
}: {
  status: RuntimeStatusPayload | null;
  /** Overrides the provider chip — last reply or the model the next send will use. */
  inUseLabel?: string | null;
  inUseProvider?: string | null;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(STATUS_BAR_OPEN_KEY) !== "0");
    } catch {
      setOpen(true);
    }
  }, []);

  if (!status) return null;
  const providerLabel = inUseLabel
    ?? (status.model.provider
      ? `${status.model.provider}${status.model.model ? ` · ${status.model.model}` : ""}`
      : "No model provider");
  const providerChip = inUseProvider ?? status.model.provider;

  function toggle() {
    setOpen(current => {
      const next = !current;
      try {
        localStorage.setItem(STATUS_BAR_OPEN_KEY, next ? "1" : "0");
      } catch {
        // The row still toggles for this visit.
      }
      return next;
    });
  }

  return (
    <div className="mb-2 flex items-start gap-1.5 px-0.5">
      {open && (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <Chip ok={status.capabilities.detection.ready} label="Detection" />
          <Chip ok={status.capabilities.documentParsing.ready} label="Document parsing" />
          <Chip ok={status.chatReady} label={providerLabel} provider={providerChip} />
          {status.edition === "cloud" && (
            <Chip ok={status.capabilities.imageOcr.ready} label="Vision extract" />
          )}
          <Chip
            ok={status.capabilities.voiceStt?.ready === true}
            label={
              parseVoiceSttChoice(status.capabilities.voiceStt?.provider)
                ? `Voice · ${voiceProviderLabel(parseVoiceSttChoice(status.capabilities.voiceStt?.provider))}`
                : "Voice"
            }
          />
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Hide what's running" : "Show what's running"}
        title={open ? "Hide what's running" : "Show what's running"}
        className="ml-auto mt-0.5 flex size-5 pointer-coarse:size-9 shrink-0 items-center justify-center rounded-md text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/70 cursor-pointer"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}

export function ModelSetupPanel({
  status,
  onOpenSettings,
  onPulled,
}: {
  status: RuntimeStatusPayload;
  onOpenSettings: (section: SettingsSection) => void;
  onPulled: () => void;
}) {
  const setup = status.setup;
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);

  if (status.chatReady || !setup) return null;

  async function pullModel(model: string) {
    setPulling(model);
    setPullError(null);
    setPullNote("Starting download — this can take several minutes.");
    try {
      const res = await fetch(apiUrl("/api/models/ollama/pull"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...apiAuthHeaders(),
        },
        credentials: usesRemoteApi() ? "omit" : "same-origin",
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Pull failed (${res.status})`);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            try {
              const evt = JSON.parse(line) as { status?: string; error?: string };
              if (evt.error) throw new Error(evt.error);
              if (evt.status) setPullNote(evt.status);
            } catch (err) {
              if (err instanceof SyntaxError) continue;
              throw err;
            }
          }
        }
      }
      setPullNote("Model is ready.");
      onPulled();
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(null);
    }
  }

  const rec = setup.ollama?.recommendation;
  const hw = setup.ollama?.hardware;

  return (
    <div
      role="status"
      className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-3 space-y-2.5"
    >
      <div>
        <p className="text-[0.78rem] font-semibold text-amber-50/95">{setup.title}</p>
        <p className="mt-1 text-[0.72rem] leading-relaxed text-amber-100/75">{setup.message}</p>
      </div>

      <p className="text-[0.65rem] leading-relaxed text-foreground/45">{setup.qualityNote}</p>
      {setup.remoteNote && (
        <p className="text-[0.65rem] leading-relaxed text-foreground/45">{setup.remoteNote}</p>
      )}

      {setup.edition === "local" && setup.ollama && (
        <div className="space-y-2">
          <p className="text-[0.65rem] text-foreground/50">
            Ollama: {setup.ollama.reachable ? "reachable" : "not running"}
            {hw ? ` · ${hw.cpuCount} CPU · ${hw.totalMemGb} GB RAM` : ""}
            {hw?.gpuName ? ` · ${hw.gpuName}` : ""}
          </p>
          <p className="text-[0.65rem] leading-relaxed text-foreground/45">{rec?.reason}</p>
          {!setup.ollama.reachable && (
            <ol className="list-decimal list-inside space-y-1 text-[0.65rem] text-foreground/55 leading-relaxed">
              <li>
                Install from{" "}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-indigo-300/90 underline underline-offset-2"
                >
                  ollama.com/download
                </a>
              </li>
              <li>Start the app so it listens on port 11434.</li>
              <li>Return here to pull a chat model. Nothing is downloaded until you choose one.</li>
            </ol>
          )}
          {setup.ollama.reachable && rec && !rec.useInstalled && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={Boolean(pulling)}
                onClick={() => pullModel(rec.primary)}
                className="rounded-lg border border-indigo-400/35 bg-indigo-500/15 px-2.5 py-1.5 text-[0.68rem] font-medium text-indigo-100 hover:bg-indigo-500/25 cursor-pointer disabled:opacity-50"
              >
                {pulling === rec.primary ? "Pulling…" : `Pull ${rec.primary}`}
              </button>
              {rec.enhanced && rec.enhanced !== rec.primary && (
                <button
                  type="button"
                  disabled={Boolean(pulling)}
                  onClick={() => pullModel(rec.enhanced!)}
                  className="rounded-lg border border-foreground/15 bg-foreground/[0.04] px-2.5 py-1.5 text-[0.68rem] text-foreground/70 hover:bg-foreground/[0.08] cursor-pointer disabled:opacity-50"
                >
                  {pulling === rec.enhanced ? "Pulling…" : `Enhanced ${rec.enhanced}`}
                </button>
              )}
              {rec.lightweight !== rec.primary && (
                <button
                  type="button"
                  disabled={Boolean(pulling)}
                  onClick={() => pullModel(rec.lightweight)}
                  className="rounded-lg border border-foreground/15 bg-foreground/[0.04] px-2.5 py-1.5 text-[0.68rem] text-foreground/70 hover:bg-foreground/[0.08] cursor-pointer disabled:opacity-50"
                >
                  {pulling === rec.lightweight ? "Pulling…" : `Lightweight ${rec.lightweight}`}
                </button>
              )}
            </div>
          )}
          {pullNote && <p className="text-[0.62rem] text-foreground/50">{pullNote}</p>}
          {pullError && <p className="text-[0.62rem] text-amber-200/90">{pullError}</p>}
        </div>
      )}

      {setup.edition === "cloud" && setup.cloud && (
        <div className="space-y-1.5 text-[0.68rem] text-foreground/55 leading-relaxed">
          <p>
            Recommended: Amazon Bedrock using this deployment&apos;s IAM role — no long-lived AWS keys in the app.
          </p>
          <p>
            Other bring-your-own keys ({setup.cloud.byok.join(", ")}) can be added by an Admin. Detection, redaction,
            and document parsing stay available without a model.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => {
            markBedrockHighlight();
            onOpenSettings(setup.settingsSection ?? "providers");
          }}
          className="text-[0.72rem] font-medium text-indigo-200 underline underline-offset-2 hover:text-indigo-100 cursor-pointer"
        >
          Open Settings → Models
        </button>
        <a
          href="/getting-started"
          className="text-[0.72rem] font-medium text-indigo-200 underline underline-offset-2 hover:text-indigo-100"
        >
          Open Getting started (pictures)
        </a>
      </div>
    </div>
  );
}
