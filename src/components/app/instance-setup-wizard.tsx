"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/lib/branding";

type StorageChoice = "postgres" | "dynamodb";

type Props = {
  edition: "local" | "cloud";
  preferredStorage: StorageChoice;
  onDone: () => void;
};

/**
 * Blocking first-run wizard after the owner is signed in.
 * Records a vector-plane preference and a risk acknowledgement.
 * Does not provision databases from the UI.
 */
export function InstanceSetupWizard({ edition, preferredStorage, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [storage, setStorage] = useState<StorageChoice>(preferredStorage);
  const [riskAck, setRiskAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <div className="w-full max-w-md rounded-2xl border border-foreground/10 bg-popover p-6 shadow-2xl space-y-5">
        <div>
          <p className="text-meta uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)] font-medium">
            {PRODUCT_NAME}
          </p>
          <h1 className="text-title mt-1.5">
            {step === 1 ? "Data plane" : "Risk acknowledgement"}
          </h1>
          <p className="text-ui text-[var(--text-muted)] mt-2 leading-[var(--leading-body)]">
            {step === 1
              ? edition === "cloud"
                ? "Hosted installs use DynamoDB for Knowledge vectors (ADR 0007). Chat, workspaces, and settings still use the relational store on this build — this screen does not provision a new database."
                : "On-prem and localhost default to Postgres + pgvector. Choosing DynamoDB only records a preference; it does not create AWS tables from this UI."
              : "Detection and replacement reduce the chance that sensitive values leave this browser. They are not a guarantee of complete removal, security, or regulatory compliance. You remain responsible for reviewing content."}
          </p>
        </div>

        {step === 1 && (
          <fieldset className="space-y-3">
            <legend className="text-label uppercase tracking-wider text-[var(--text-muted)]">
              Vector plane
            </legend>
            <label className="flex gap-3 items-start rounded-lg border border-foreground/10 p-3 cursor-pointer">
              <input
                type="radio"
                name="storage"
                checked={storage === "dynamodb"}
                onChange={() => setStorage("dynamodb")}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">DynamoDB</span>
                <span className="text-ui text-[var(--text-muted)]">
                  Hosted AWS default. Requires the Terraform data plane.
                </span>
              </span>
            </label>
            <label className="flex gap-3 items-start rounded-lg border border-foreground/10 p-3 cursor-pointer">
              <input
                type="radio"
                name="storage"
                checked={storage === "postgres"}
                onChange={() => setStorage("postgres")}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">Postgres + pgvector</span>
                <span className="text-ui text-[var(--text-muted)]">
                  Local and on-prem default. Compose or your own Postgres.
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
              I understand that sanitization is risk reduction, not a guarantee, and that I must review content before relying on it.
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
