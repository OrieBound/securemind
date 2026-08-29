export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { isAdminRole, requireAdmin } from "@/lib/roles";
import {
  applySecurityPolicy,
  clearPendingProposal,
  getSecurityPolicy,
  isPiiSensitivityTier,
  normalizeSafeTermsInput,
  proposeSecurityPolicy,
} from "@/lib/security-policy";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const policy = await getSecurityPolicy();
    return Response.json({
      ...policy,
      role: identity.role,
      canEdit: isAdminRole(identity.role),
      canPropose: true,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

export async function PUT(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.clearPending === true) {
      const policy = await clearPendingProposal();
      return Response.json({ ...policy, canEdit: true });
    }

    if (!isPiiSensitivityTier(body.piiSensitivity)) {
      return Response.json({ error: "Invalid piiSensitivity" }, { status: 422 });
    }

    const termsRaw = body.safeTerms !== undefined ? normalizeSafeTermsInput(body.safeTerms) : null;
    if (termsRaw && "error" in termsRaw) {
      return Response.json({ error: termsRaw.error }, { status: 422 });
    }

    const current = await getSecurityPolicy();
    const safeTerms = termsRaw ?? current.safeTerms;

    const result = await applySecurityPolicy({
      actorUserId: identity.userId,
      piiSensitivity: body.piiSensitivity,
      safeTerms,
    });
    return Response.json({
      ...result.policy,
      canEdit: true,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

/** Member (or Admin) proposes a policy change; Admin must accept via PUT. */
export async function POST(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!isPiiSensitivityTier(body.piiSensitivity)) {
      return Response.json({ error: "Invalid piiSensitivity" }, { status: 422 });
    }
    const termsRaw =
      body.safeTerms !== undefined ? normalizeSafeTermsInput(body.safeTerms) : undefined;
    if (termsRaw && "error" in termsRaw) {
      return Response.json({ error: termsRaw.error }, { status: 422 });
    }

    const policy = await proposeSecurityPolicy({
      actorUserId: identity.userId,
      piiSensitivity: body.piiSensitivity,
      safeTerms: Array.isArray(termsRaw) ? termsRaw : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    return Response.json({
      ...policy,
      role: identity.role,
      canEdit: isAdminRole(identity.role),
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
