export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import {
  getSecuritySummary,
  resolveWorkspaceScope,
} from "@/lib/analytics/queries";
import { resolveAnalyticsSubject } from "@/lib/analytics/subject";
import { recordSecurityEvents } from "@/lib/analytics/write";
import type { AnalyticsRange, SecurityOutcome, SecuritySource } from "@/lib/analytics/types";
import { riskLevelForCategory } from "@/lib/analytics/types";

const RANGES = new Set<AnalyticsRange>(["today", "7d", "30d", "all"]);
const SOURCES = new Set<SecuritySource>(["investigate", "knowledge_document", "image_ocr"]);
const OUTCOMES = new Set<SecurityOutcome>([
  "redacted",
  "blocked",
  "safe_listed",
  "dismissed",
  "reviewed",
]);

export async function GET(req: NextRequest) {
  let identity;
  try {
    identity = await getIdentity(req);
  } catch (err) {
    if (err instanceof IdentityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const subject = await resolveAnalyticsSubject(identity, url.searchParams.get("asUser"));
  if (!subject.ok) {
    return NextResponse.json({ error: subject.error }, { status: subject.status });
  }

  const rangeParam = (url.searchParams.get("range") ?? "30d") as AnalyticsRange;
  const range = RANGES.has(rangeParam) ? rangeParam : "30d";
  const workspaceParam = url.searchParams.get("workspaceId");

  const scope = await resolveWorkspaceScope(subject.userId, workspaceParam);
  if (!scope.ok) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const summary = await getSecuritySummary({
      userId: subject.userId,
      range,
      workspaceId: scope.workspaceId,
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[analytics/security] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to load security analytics. Restart the dev server after schema changes." },
      { status: 500 },
    );
  }
}

/**
 * POST — ingest sanitized security events from the client (chat scrub path).
 * Body never accepts raw detected values — only category/count/outcome metadata.
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await getIdentity(req));
  } catch (err) {
    if (err instanceof IdentityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventsRaw = (body as { events?: unknown }).events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) {
    return NextResponse.json({ error: "events array required" }, { status: 422 });
  }
  if (eventsRaw.length > 50) {
    return NextResponse.json({ error: "Too many events" }, { status: 422 });
  }

  const workspaceId = (body as { workspaceId?: unknown }).workspaceId;
  const ws =
    typeof workspaceId === "string" && workspaceId
      ? await resolveWorkspaceScope(userId, workspaceId)
      : { ok: true as const, workspaceId: null };
  if (!ws.ok) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const sensitivity =
    typeof (body as { sensitivity?: unknown }).sensitivity === "string"
      ? ((body as { sensitivity: string }).sensitivity)
      : null;

  const prepared: Parameters<typeof recordSecurityEvents>[0] = [];
  for (const raw of eventsRaw) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const category = typeof e.category === "string" ? e.category.slice(0, 64) : "";
    const source = typeof e.source === "string" ? e.source : "";
    const outcome = typeof e.outcome === "string" ? e.outcome : "";
    if (!category || !SOURCES.has(source as SecuritySource) || !OUTCOMES.has(outcome as SecurityOutcome)) {
      continue;
    }
    // Reject any attempt to smuggle raw values
    if ("value" in e || "raw" in e || "detected" in e || "context" in e) {
      return NextResponse.json(
        { error: "Events must not include raw or context fields" },
        { status: 422 },
      );
    }
    const resourceKind =
      e.resourceKind === "message" || e.resourceKind === "document"
        ? e.resourceKind
        : null;
    prepared.push({
      userId,
      workspaceId: ws.workspaceId,
      source: source as SecuritySource,
      category,
      outcome: outcome as SecurityOutcome,
      count: typeof e.count === "number" && e.count > 0 ? Math.min(e.count, 1000) : 1,
      sensitivity,
      resourceKind,
      resourceId: typeof e.resourceId === "string" ? e.resourceId.slice(0, 64) : null,
      riskLevel: riskLevelForCategory(category),
    });
  }

  if (prepared.length === 0) {
    return NextResponse.json({ error: "No valid events" }, { status: 422 });
  }

  const count = await recordSecurityEvents(prepared);
  return NextResponse.json({ recorded: count }, { status: 201 });
}
