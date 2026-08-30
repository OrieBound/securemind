"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/lib/branding";
import { cn } from "@/lib/utils";
import type { WizardStorageChoice } from "@/lib/wizard-storage";

type LocalChoice = "postgres" | "dynamodb";

type Props = {
  edition: "local" | "cloud";
  preferredStorage: WizardStorageChoice;
  onDone: () => void;
};

function initialLocal(preferred: WizardStorageChoice): LocalChoice {
  return preferred === "dynamodb" ? "dynamodb" : "postgres";
}

/**
 * Blocking first-run wizard after the owner is signed in.
 * Records a storage preference and a risk acknowledgement.
 * Does not provision databases from the UI.
 */
export function InstanceSetupWizard({ edition, preferredStorage, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [localStorage, setLocalStorage] = useState<LocalChoice>(() => initialLocal(preferredStorage));
  const [riskAck, setRiskAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storage: WizardStorageChoice = edition === "cloud" ? "dynamodb" : localStorage;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageBackend: storage, riskAck: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save setup.");
        return;
      }
      onDone();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-2xl border border-foreground/10 bg-popover p-6 shadow-2xl space-y-5">
        <div>
          <p className="text-meta uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)] font-medium">
            {PRODUCT_NAME}
          </p>
          <h1 className="text-title mt-1.5">
            {step === 1
              ? edition === "cloud"
                ? "Hosted data store"
                : "Choose your data store"
              : "Before you start"}
          </h1>
          <p className="text-ui text-[var(--text-muted)] mt-2 leading-[var(--leading-body)]">
            {step === 1
              ? edition === "cloud"
                ? "This hosted workspace stores everything in Amazon DynamoDB — workspaces, chat, Knowledge, memory, and Insights. There is no Postgres on this install."
                : "On this machine the default is Postgres with pgvector. DynamoDB is optional and only records a preference until you connect a table."
              : "SecureMind helps you work with AI in a workspace that detects and replaces sensitive values before they leave this browser. That reduces risk. It cannot catch everything, and it is not a promise of complete security or compliance."}
          </p>
        </div>

        {step === 1 && edition === "cloud" && (
          <div className="rounded-lg border border-foreground/10 p-3 space-y-2">
            <p className="flex items-center gap-2">
              <span className="text-sm font-medium">DynamoDB</span>
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-indigo-200">
                Cloud store
              </span>
            </p>
            <ul className="space-y-1 text-ui text-[var(--text-muted)] list-disc pl-4">
              <li>Ready on this hosted install for Knowledge search and app data.</li>
              <li>You pay for what you use, not a database server sitting idle.</li>
            </ul>
            <p className="text-ui text-[var(--text-muted)] pt-1">
              Managed Postgres (Neon or Aurora) is not offered here. It may come back later as an all-SQL option — not mixed with DynamoDB.
            </p>
          </div>
        )}

        {step === 1 && edition === "local" && (
          <fieldset className="space-y-3">
            <legend className="text-label uppercase tracking-wider text-[var(--text-muted)]">
              Local options
            </legend>
            <label className={cn("flex gap-3 items-start rounded-lg border p-3 cursor-pointer", localStorage === "postgres" ? "border-[var(--primary-soft-foreground)]/40 bg-foreground/[0.03]" : "border-foreground/10")}>
              <input
                type="radio"
                name="storage"
                checked={localStorage === "postgres"}
                onChange={() => setLocalStorage("postgres")}
                className="mt-1"
              />
              <span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">Postgres + pgvector</span>
                  <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-indigo-200">
                    Default
                  </span>
                </span>
                <span className="text-ui text-[var(--text-muted)]">
                  Best for localhost and Docker. Flatter, always-on database cost if you host Postgres yourself.
                </span>
              </span>
            </label>
            <label className={cn("flex gap-3 items-start rounded-lg border p-3 cursor-pointer", localStorage === "dynamodb" ? "border-[var(--primary-soft-foreground)]/40 bg-foreground/[0.03]" : "border-foreground/10")}>
              <input
                type="radio"
                name="storage"
                checked={localStorage === "dynamodb"}
                onChange={() => setLocalStorage("dynamodb")}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">DynamoDB</span>
                <span className="text-ui text-[var(--text-muted)]">
                  Pay-per-use. Records a preference only — this screen does not create AWS tables.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {step === 2 && (
          <label className="flex gap-3 items-start rounded-lg border border-foreground/10 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={riskAck}
              onChange={e => setRiskAck(e.target.checked)}
              className="mt-1"
            />
            <span className="text-ui leading-[var(--leading-body)]">
              I understand this is a help, not a guarantee. Filters can miss things.
              I will review what I send, I use this at my own risk, and the operators
              of this instance are not responsible if sensitive information gets past detection.
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="text-meta text-red-300/90">{error}</p>
        )}

        <div className="flex gap-2">
          {step === 2 && (
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1"
              onClick={() => { setStep(1); setError(null); }}
            >
              Back
            </Button>
          )}
          {step === 1 ? (
            <Button type="button" className="h-10 flex-1" onClick={() => setStep(2)}>
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              className="h-10 flex-1"
              disabled={busy || !riskAck}
              onClick={() => void finish()}
            >
              {busy ? "Saving…" : "Finish setup"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
