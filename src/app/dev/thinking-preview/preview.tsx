"use client";

import { useState } from "react";
import { ThinkingIndicator } from "@/components/app/app-shell";

export function ThinkingPreview() {
  const [now] = useState(() => Date.now());
  const cases: Array<{ label: string; startedAt: number; provider?: string }> = [
    { label: "Just sent (0s)", startedAt: now },
    { label: "After 4 seconds", startedAt: now - 4_000 },
    { label: "Slow reply (12 seconds)", startedAt: now - 12_000 },
    { label: "Local model, just sent", startedAt: now, provider: "ollama" },
    { label: "Local model, 14 seconds", startedAt: now - 14_000, provider: "ollama" },
  ];
  return (
    <div className="mx-auto w-full max-w-xl space-y-8 px-5 py-8">
      {cases.map(c => (
        <div key={c.label}>
          <p className="mb-2 text-xs text-muted-foreground">{c.label}</p>
          <ThinkingIndicator startedAt={c.startedAt} provider={c.provider} onStop={() => undefined} onOpenSettings={() => undefined} />
        </div>
      ))}
    </div>
  );
}
