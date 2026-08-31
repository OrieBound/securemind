"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Loader2, Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WIRED_VENDOR_APIS } from "@/lib/vendor-providers";
import type { VoiceSttChoice } from "@/lib/transcribe/backend";

const GROQ = WIRED_VENDOR_APIS.find(v => v.kind === "groq");

type VoiceSttStatus = {
  hasGroqKey?: boolean;
  hasEnvGroqKey?: boolean;
  groqReady?: boolean;
  voiceSttChoice?: VoiceSttChoice | null;
  allowRealAws?: boolean;
  transcribeAvailable?: boolean;
  canEdit?: boolean;
};

export function VoiceSttSetupDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<VoiceSttStatus | null>(null);
  const [choice, setChoice] = useState<VoiceSttChoice | null>(null);
  const [audioAck, setAudioAck] = useState(false);
  const [enableAws, setEnableAws] = useState(false);
  const [groqKey, setGroqKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGroqKey("");
    setAudioAck(false);
    setEnableAws(false);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings/voice-stt", { credentials: "same-origin" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || "Could not load transcription settings.");
        }
        const data = (await res.json()) as VoiceSttStatus;
        if (cancelled) return;
        setStatus(data);
        setChoice(data.voiceSttChoice ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const canEdit = Boolean(status?.canEdit);
  const groqReady = Boolean(status?.groqReady || status?.hasGroqKey || groqKey.trim());
  const awsReady = Boolean(status?.allowRealAws || status?.transcribeAvailable || enableAws);
  const canConfirm =
    Boolean(choice) &&
    audioAck &&
    !busy &&
    ((choice === "groq" && groqReady) || (choice === "transcribe" && awsReady));

  async function save() {
    if (!choice || !audioAck) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/voice-stt", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          acknowledgeVoiceAudio: true,
          groqApiKey: choice === "groq" && groqKey.trim() ? groqKey.trim() : undefined,
          enableBillableAws: choice === "transcribe" && enableAws ? true : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not save transcription settings.");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-stt-title"
    >
      <div className="w-full max-w-lg max-h-[min(90dvh,40rem)] overflow-y-auto rounded-2xl bg-popover border border-foreground/10 p-6 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] border border-[var(--primary-border)]">
            <Mic className="size-5 text-[var(--primary-soft-foreground)]" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="voice-stt-title" className="text-section">
              Choose a transcription provider
            </h2>
            <p className="text-sm text-foreground/50 mt-1.5 leading-relaxed">
              Voice does not run until you pick one. This is not the chat model — it is speech-to-text
              only. While you speak, a live preview appears above the waveform. Done writes a final
              transcript into the composer (it can differ slightly from the preview). Send still waits
              for you.
            </p>
          </div>
        </div>

        <div
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 text-[0.78rem] text-amber-100/90 leading-relaxed"
          role="note"
        >
          What you say is sent to the provider as audio. SecureMind cannot redact or replace values
          in that recording. After the words appear in the composer, detection runs on the text
          before you send a chat message — that is risk reduction, not a guarantee, and it does not
          apply to audio that already left.
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">Transcription provider</legend>
          <OptionCard
            selected={choice === "groq"}
            onSelect={() => setChoice("groq")}
            title="Groq Whisper"
            badge="Usually $0 on their free tier"
          >
            <p>
              Spoken audio is sent to Groq Cloud under the key you create. SecureMind does not
              control where Groq processes that audio, how long they keep it, or which region they
              use. The free plan does not require a credit card; rate limits apply, and paid Whisper
              is billed by Groq if you leave the free plan.
            </p>
            {GROQ && (
              <a
                href={GROQ.keyCreateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
              >
                {GROQ.keyCreateLabel}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
            {choice === "groq" && (
              <div className="mt-3 space-y-2">
                {status?.groqReady || status?.hasGroqKey ? (
                  <p className="text-foreground/55">A Groq key is already stored on this instance.</p>
                ) : canEdit ? (
                  <label className="block space-y-1">
                    <span className="text-foreground/55">Paste Groq API key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="gsk_…"
                      value={groqKey}
                      onChange={e => setGroqKey(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground"
                    />
                  </label>
                ) : (
                  <p className="text-foreground/55">
                    Ask an Admin to save a Groq key in Settings → Providers, then return here.
                  </p>
                )}
              </div>
            )}
          </OptionCard>

          <OptionCard
            selected={choice === "transcribe"}
            onSelect={() => setChoice("transcribe")}
            title="Amazon Transcribe"
            badge="Billed on this AWS account"
          >
            <p>
              Spoken audio is sent to Amazon Transcribe in this AWS account — the same account as
              Bedrock (IAM; no AWS keys in SecureMind). It does not go to Groq. It still leaves this
              app host; AWS processes it. Transcribe minutes are billed separately from Bedrock chat
              tokens. Standard streaming is typically about $0.024 per minute after AWS’s small
              new-account allowance. Confirm current rates in the AWS billing console.
            </p>
            {choice === "transcribe" && (
              <div className="mt-3 space-y-2">
                {status?.allowRealAws || status?.transcribeAvailable ? (
                  <p className="text-foreground/55">
                    Billable AWS is already on for this instance. Transcribe will use that account.
                  </p>
                ) : canEdit ? (
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableAws}
                      onChange={e => setEnableAws(e.target.checked)}
                      onClick={e => e.stopPropagation()}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <span>
                      Enable billable AWS for this instance (same toggle as Bedrock). Amazon
                      Transcribe will be billed on this AWS account.
                    </span>
                  </label>
                ) : (
                  <p className="text-foreground/55">
                    Ask an Admin to enable billable AWS in Settings → Providers.
                  </p>
                )}
              </div>
            )}
          </OptionCard>
        </fieldset>

        <p className="text-[0.68rem] text-foreground/40 leading-relaxed">
          On-prem Whisper (audio stays on this machine) is not offered on hosted SecureMind. Browser
          speech APIs that send audio to Google are not offered either.
        </p>

        <label className="flex items-start gap-2.5 rounded-xl border border-foreground/8 bg-foreground/[0.03] px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={audioAck}
            onChange={e => setAudioAck(e.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span className="text-[0.78rem] text-foreground/70 leading-relaxed">
            I understand that spoken audio is sent to the provider I chose, that SecureMind cannot
            redact that audio, and that composer detection only runs on the transcribed text before
            chat send.
          </span>
        </label>

        {error && (
          <p className="text-[0.78rem] text-red-300/90" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="ghost" className="text-foreground/50" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={() => void save()}>
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Use this provider"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OptionCard({
  selected,
  onSelect,
  title,
  badge,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "block rounded-xl border px-3.5 py-3 cursor-pointer transition-colors",
        selected
          ? "border-[var(--primary-border)] bg-[var(--surface-selected)]"
          : "border-border bg-card hover:border-[var(--primary-border)]",
      )}
      onClick={onSelect}
    >
      <span className="flex items-start gap-2.5">
        <input
          type="radio"
          name="voice-stt-choice"
          checked={selected}
          onChange={onSelect}
          className="mt-1 accent-[var(--primary)]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            <span className="text-[0.65rem] uppercase tracking-wide text-foreground/40">{badge}</span>
          </span>
          <span className="mt-1 block text-[0.72rem] text-foreground/55 leading-relaxed">{children}</span>
        </span>
      </span>
    </div>
  );
}
