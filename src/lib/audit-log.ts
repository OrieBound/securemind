/**
 * Append-only audit trail for administrative and security-sensitive actions.
 *
 * Records who (the caller's identity, from getIdentity), what, to whom and the outcome.
 * Never pass a password, key, token, code or message text: `detail` is short plain context
 * and is cut to 200 characters. Writing never throws, so a failed audit write cannot turn an
 * admin action into an error; it logs a warning instead.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Identity } from "@/lib/identity";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";
import { usesHostedAppStore } from "@/lib/workspaces/store";

export type AuditEntry = {
  id: string;
  at: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  target: string | null;
  outcome: string;
  detail: string | null;
};

export async function recordAudit(
  actor: Pick<Identity, "userId" | "email" | "role">,
  action: string,
  opts: { target?: string | null; outcome?: "ok" | "denied" | "failed"; detail?: string | null } = {},
): Promise<void> {
  const row: AuditEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actorUserId: actor.userId,
    actorEmail: actor.email ?? null,
    actorRole: actor.role,
    action: action.slice(0, 80),
    target: opts.target ? opts.target.slice(0, 200) : null,
    outcome: opts.outcome ?? "ok",
    detail: opts.detail ? opts.detail.slice(0, 200) : null,
  };
  try {
    if (usesHostedAppStore()) {
      await hostedAppStore().putAudit(row);
    } else {
      await db.auditEvent.create({
        data: { ...row, at: new Date(row.at) },
      });
    }
  } catch (err) {
    console.warn("[audit] write failed", err instanceof Error ? err.name : "error");
  }
}

export async function listAudit(take = 200): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(1, take), 500);
  if (usesHostedAppStore()) {
    return hostedAppStore().listAudit(limit);
  }
  const rows = await db.auditEvent.findMany({ orderBy: { at: "desc" }, take: limit });
  return rows.map(r => ({ ...r, at: r.at.toISOString() }));
}
