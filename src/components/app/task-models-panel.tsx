"use client";

/**
 * Task models: one place for the small helper models that do a narrow job.
 *
 * Chat picks its model by complexity tier. A task model is chosen on purpose by an Admin and runs only
 * for its job. The file helper is OFF until an Admin picks a model, and it never falls back to another one.
 */

import { useEffect, useMemo, useState } from "react";
import { SelectMenu } from "@/components/ui/select-menu";
import { AdminOnlyNotice } from "@/components/app/admin-only-notice";
import { chatSelectableModels, type CatalogModel } from "@/components/app/model-catalog";

type Choice = { provider: string; model: string } | null;
type Payload = { purposes: Array<{ purpose: string; choice: Choice }>; canEdit: boolean };

const OFF = "";

type Props = {
  /** Live catalog models; only ones that passed a test are offered. */
  models: CatalogModel[];
  voiceLabel: string;
  voiceDestination: string;
  /** Opens the existing voice provider chooser (Admin only). */
  onChangeVoice?: () => void;
};

function vendorName(provider: string): string {
  const names: Record<string, string> = {
    openai: "OpenAI", anthropic: "Anthropic", google: "Google", xai: "xAI", groq: "Groq", bedrock: "Amazon Bedrock", ollama: "your local Ollama",
  };
  return names[provider] ?? provider;
}

export function TaskModelsPanel({ models, voiceLabel, voiceDestination, onChangeVoice }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CatalogModel | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/settings/task-models", { cache: "no-store" })
      .then(res => (res.ok ? (res.json() as Promise<Payload>) : Promise.reject(new Error())))
      .then(body => {
        if (live) setData(body);
      })
      .catch(() => {
        if (live) setError("Could not load task models.");
      });
    return () => {
      live = false;
    };
  }, []);

  const current = data?.purposes.find(p => p.purpose === "fileFormat")?.choice ?? null;
  const canEdit = data?.canEdit ?? false;
  const options = useMemo(() => {
    const picks = chatSelectableModels(models);
    const list = picks.map(m => ({ value: `${m.provider}::${m.id}`, label: m.name || m.id, hint: vendorName(m.provider) }));
    if (current && !list.some(o => o.value === `${current.provider}::${current.model}`)) {
      list.push({ value: `${current.provider}::${current.model}`, label: current.model, hint: `${vendorName(current.provider)} · not currently listed` });
    }
    return [{ value: OFF, label: "Off", hint: "Use only the automatic file conversion" }, ...list];
  }, [models, current]);

  async function save(model: CatalogModel | null, acknowledge = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/task-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "fileFormat",
          model: model?.id ?? null,
          provider: model?.provider,
          ...(acknowledge ? { acknowledgeExternalRisk: true } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Payload & { error?: string; needsConsent?: boolean };
      if (res.status === 422 && body.needsConsent && model && !acknowledge) {
        setPending(model);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Could not save.");
        return;
      }
      setPending(null);
      setData(body);
    } finally {
      setBusy(false);
    }
  }

  function onPick(value: string) {
    if (value === OFF) return void save(null);
    const [provider, ...rest] = value.split("::");
    const id = rest.join("::");
    const model = models.find(m => m.provider === provider && m.id === id);
    if (model) void save(model);
  }

  const selected = current ? `${current.provider}::${current.model}` : OFF;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8rem] font-semibold text-foreground/85">File helper</p>
          <span className="text-[0.68rem] text-foreground/55">{current ? "On" : "Off"}</span>
        </div>
        <p className="text-[0.75rem] text-foreground/65 leading-relaxed">
          When someone asks for a file and the chat model answers in plain text, SecureMind first converts the reply
          itself, with no model and no cost. If that cannot find the data, this helper can build the file instead.
          It only runs when you pick a model here, only for file requests, and never switches to another model.
        </p>
        <SelectMenu
          aria-label="File helper model"
          value={selected}
          options={options}
          disabled={!canEdit || busy}
          onChange={onPick}
        />
        {current && (
          <p className="text-[0.72rem] text-foreground/60">
            The reply text on screen is sent to {vendorName(current.provider)} for this job. Card numbers, SSNs and
            secrets are replaced first. Pick a small, reliable, low-cost model.
          </p>
        )}
        {!canEdit && data && <AdminOnlyNotice compact>An Admin picks the helper model. You can see which one is set.</AdminOnlyNotice>}
        {pending && (
          <div className="rounded-lg border border-[var(--border-strong)] bg-muted p-2.5 space-y-2">
            <p className="text-[0.75rem] text-foreground/75 leading-relaxed">
              This sends reply text to {vendorName(pending.provider)}, an outside vendor. Confirm you accept the vendor
              notice for this install.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(pending, true)}
                className="rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold border border-[var(--border-strong)] bg-muted text-foreground/85 hover:bg-[var(--surface-hover)]"
              >
                I accept, use {pending.name || pending.id}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-lg px-3 py-1.5 text-[0.75rem] text-foreground/65 hover:bg-[var(--surface-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-[0.72rem] text-red-400">{error}</p>}
      </div>

      <div className="space-y-1.5 border-t border-[var(--border-strong)] pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8rem] font-semibold text-foreground/85">Voice transcription</p>
          <span className="text-[0.68rem] text-foreground/55">{voiceLabel}</span>
        </div>
        <p className="text-[0.75rem] text-foreground/65 leading-relaxed">{voiceDestination}</p>
        {!canEdit && data && (
          <p className="text-[0.72rem] text-foreground/55">An Admin chooses the voice provider.</p>
        )}
        {canEdit && onChangeVoice && (
          <button
            type="button"
            onClick={onChangeVoice}
            className="rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold border border-[var(--border-strong)] bg-muted text-foreground/80 hover:bg-[var(--surface-hover)]"
          >
            Change
          </button>
        )}
      </div>

      <div className="space-y-1 border-t border-[var(--border-strong)] pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8rem] font-semibold text-foreground/85">Image generation</p>
          <span className="text-[0.68rem] text-foreground/55">Coming later</span>
        </div>
        <p className="text-[0.75rem] text-foreground/60 leading-relaxed">
          Images will be chosen here the same way, by an Admin, when that feature arrives.
        </p>
      </div>
    </div>
  );
}
