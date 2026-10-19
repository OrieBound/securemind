"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/lib/branding";
import { ProductMark } from "@/components/app/product-mark";
import type { WizardStorageChoice } from "@/lib/wizard-storage";

type Props = {
  edition: "local" | "cloud";
  onDone: () => void;
};

/**
 * Blocking first-run wizard after the owner is signed in.
 * Records a storage preference and a risk acknowledgement.
 * Does not provision databases from the UI.
 */
export function InstanceSetupWizard({ edition, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [riskAck, setRiskAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storage: WizardStorageChoice = edition === "cloud" ? "dynamodb" : "postgres";

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
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <ProductMark size={40} className="size-10 shrink-0" />
            <div>
              <p className="text-meta uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)] font-medium">
                {PRODUCT_NAME}
              </p>
              <h1 className="text-title mt-1.5">
                {step === 1
                  ? edition === "cloud"
                    ? "Hosted data store"
                    : "Local data store"
                  : "Before you start"}
              </h1>
            </div>
          </div>
          <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
            {step === 1
              ? edition === "cloud"
                ? "This hosted workspace stores everything in Amazon DynamoDB — workspaces, chat, Knowledge, memory, and Insights. There is no Postgres on this install."
                : "This local installation uses Postgres with pgvector for workspace data and Knowledge search."
              : "SecureMind is an open-source AI workspace with tools to help identify and replace sensitive information. It adds a layer of assistance, but detection can miss things. Your judgment and careful review remain essential."}
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
          <div className="rounded-lg border border-foreground/10 p-3 space-y-2">
            <p className="flex items-center gap-2">
              <span className="text-sm font-medium">Postgres + pgvector</span>
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-indigo-200">
                Local store
              </span>
            </p>
            <p className="text-ui text-[var(--text-muted)]">
              Postgres stores your workspace data. The pgvector extension supports Knowledge search.
              Docker keeps the database in a persistent volume across app restarts and rebuilds.
            </p>
          </div>
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
              I understand that I remain responsible for my decisions and any
              information I choose to enter, upload, or share through SecureMind.
            </span>
          </label>
        )}

        {step === 2 && (
          <p className="text-meta text-[var(--text-muted)] leading-[var(--leading-body)]">
            SecureMind is provided as is. The project and its contributors do not
            guarantee complete detection, security, or compliance, or accept
            responsibility for information disclosed through its use.
          </p>
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
