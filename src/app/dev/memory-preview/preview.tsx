"use client";

import { useState } from "react";
import { MemoryDashboard, type MemoryFactRecord, type MemorySummaryRecord } from "@/components/app/memory-dashboard";
import type { MemoryOverview } from "@/lib/memory/overview-types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const FACTS: MemoryFactRecord[] = [
  { id: "f1", key: "name", value: "Alex Rivera", confidence: 0.9, source: null, updatedAt: daysAgo(12) },
  { id: "f2", key: "occupation", value: "Cloud engineer", confidence: 0.9, source: null, updatedAt: daysAgo(12), pinned: true },
  { id: "f3", key: "location", value: "Halifax, Nova Scotia", confidence: 0.85, source: null, updatedAt: daysAgo(9) },
  { id: "f4", key: "projects", value: "Migrating logging to OpenSearch; SecureMind rollout", confidence: 0.8, source: null, updatedAt: daysAgo(2) },
  { id: "f5", key: "goals", value: "Pass the AWS Solutions Architect Professional exam", confidence: 0.8, source: null, updatedAt: daysAgo(5), correctedAt: daysAgo(4) },
  { id: "f6", key: "preferred_response_length", value: "short", confidence: 0.8, source: null, updatedAt: daysAgo(7) },
  { id: "f7", key: "technical_level", value: "expert", confidence: 0.8, source: null, updatedAt: daysAgo(7) },
  { id: "f8", key: "on_call_rotation", value: "Weeks starting on Mondays", confidence: 0.7, source: null, updatedAt: daysAgo(1) },
];

const NOTES: MemorySummaryRecord[] = [
  {
    id: "s1",
    summary:
      "The user is migrating application logging to OpenSearch and asked how to size shards for roughly 200 GB a day. They prefer short answers, asked for a rollback plan, and said the cutover window is a weekend in November.",
    turnsCovered: 24,
    updatedAt: daysAgo(0),
    session: { id: "x1", createdAt: daysAgo(0) },
  },
  {
    id: "s2",
    summary: "The user asked for a study plan for the AWS Solutions Architect Professional exam.",
    turnsCovered: 8,
    updatedAt: daysAgo(5),
    session: { id: "x2", createdAt: daysAgo(5) },
  },
];

const OVERVIEW: MemoryOverview = {
  documents: [
    { id: "d1", name: "OpenSearch-sizing-guide.pdf", mimeType: "application/pdf", sizeBytes: 482_000, status: "ready", chunkCount: 41, redactionCount: 0, createdAt: daysAgo(6) },
    { id: "d2", name: "incident-2026-09-runbook.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 91_000, status: "ready", chunkCount: 12, redactionCount: 3, createdAt: daysAgo(4) },
    { id: "d3", name: "log-volumes-by-service.csv", mimeType: "text/csv", sizeBytes: 22_000, status: "ready", chunkCount: 5, redactionCount: 0, createdAt: daysAgo(3) },
    { id: "d4", name: "architecture-diagram.png", mimeType: "image/png", sizeBytes: 310_000, status: "processing", chunkCount: 0, redactionCount: 0, createdAt: daysAgo(0) },
    { id: "d5", name: "vendor-contract-scan.pdf", mimeType: "application/pdf", sizeBytes: 1_900_000, status: "failed", chunkCount: 0, redactionCount: 0, createdAt: daysAgo(1) },
  ],
  evidence: { answers: 124, usedKnowledgeRate: 0.41, citedRate: 0.33, groundedRate: 0.87 },
  privacy: {
    itemsReplaced: 27,
    byCategory: [
      { category: "email_address", count: 11 },
      { category: "aws_access_key", count: 6 },
      { category: "phone_number", count: 5 },
      { category: "credit_card", count: 3 },
      { category: "ip_address", count: 2 },
    ],
    bySource: [
      { source: "investigate", count: 19 },
      { source: "knowledge_document", count: 8 },
    ],
  },
};

export function MemoryPreview() {
  const [state, setState] = useState<"full" | "empty">("full");
  const empty = state === "empty";
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Preview with sample data:</span>
        <button type="button" onClick={() => setState("full")} className="underline underline-offset-4 cursor-pointer">Populated</button>
        <button type="button" onClick={() => setState("empty")} className="underline underline-offset-4 cursor-pointer">New workspace</button>
      </div>
      <MemoryDashboard
        workspaceId="preview"
        workspaceName="Mindy Locke"
        workspaceFacts={empty ? [] : FACTS}
        sessionSummaries={empty ? [] : NOTES}
        liveSessionSummary=""
        liveFacts={{}}
        memoryLoading={false}
        memoryStats={null}
        isActiveWorkspace={false}
        summarizedCount={0}
        overview={empty ? { documents: [], evidence: null, privacy: null } : OVERVIEW}
        onOpenKnowledge={() => undefined}
      />
    </div>
  );
}
