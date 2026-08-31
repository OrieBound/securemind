export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import {
  getPublicProviderStatus,
  getVendorConsentFlags,
  patchInstanceConfig,
  type PrimaryProvider,
} from "@/lib/instance-config";
import { isAdminRole, requireAdmin } from "@/lib/roles";
import { resetAwsCredentialCache } from "@/lib/aws-credentials";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    // Chat chrome only needs Groq-key + consent — skip AWS STS / profile probe.
    const noStore = { headers: { "Cache-Control": "no-store" } };
    if (req.nextUrl.searchParams.get("lite") === "1") {
      const flags = await getVendorConsentFlags();
      return Response.json({
        ...flags,
        role: identity.role,
        canEdit: isAdminRole(identity.role),
      }, noStore);
    }
    // "Re-check host" — credentials may have appeared since the last lookup
    // (e.g. the operator just ran `aws sso login`), so skip the detection cache.
    if (req.nextUrl.searchParams.get("recheck") === "1") {
      resetAwsCredentialCache();
    }
    const status = await getPublicProviderStatus();
    return Response.json({
      ...status,
      role: identity.role,
      canEdit: isAdminRole(identity.role),
    }, noStore);
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

    // Reject smuggled raw secret dumps in unexpected fields
    if ("value" in body || "raw" in body) {
      return Response.json({ error: "Invalid fields" }, { status: 422 });
    }

    // AWS credentials are never accepted over the wire — they come from the
    // deployment environment. Refuse loudly rather than silently ignoring.
    if (
      "bedrockAccessKeyId" in body ||
      "bedrockSecretAccessKey" in body ||
      "awsAccessKeyId" in body ||
      "awsSecretAccessKey" in body
    ) {
      return Response.json(
        {
          error:
            "SecureMind does not accept AWS credentials. Configure them in the environment " +
            "(aws sso login, a shared profile, or an instance role) and set ALLOW_REAL_AWS=true.",
        },
        { status: 422 },
      );
    }

    const primary = body.primaryProvider;
    const primaryProvider =
      primary === "auto" || primary === "groq" || primary === "bedrock" || primary === "ollama"
        ? (primary as PrimaryProvider)
        : undefined;

    const addKeyRaw = body.addKey;
    const addKey =
      addKeyRaw && typeof addKeyRaw === "object"
        ? {
            secret:
              typeof (addKeyRaw as { secret?: unknown }).secret === "string"
                ? (addKeyRaw as { secret: string }).secret
                : "",
            region:
              typeof (addKeyRaw as { region?: unknown }).region === "string"
                ? (addKeyRaw as { region: string }).region
                : undefined,
            label:
              typeof (addKeyRaw as { label?: unknown }).label === "string"
                ? (addKeyRaw as { label: string }).label
                : undefined,
            kind:
              typeof (addKeyRaw as { kind?: unknown }).kind === "string"
                ? ((addKeyRaw as { kind: string }).kind as
                    | "groq"
                    | "bedrock"
                    | "google"
                    | "openai"
                    | "anthropic"
                    | "azure"
                    | "unknown")
                : undefined,
          }
        : undefined;

    try {
      const status = await patchInstanceConfig(
        {
          primaryProvider,
          groqApiKey: typeof body.groqApiKey === "string" ? body.groqApiKey : undefined,
          clearGroqApiKey: body.clearGroqApiKey === true,
          awsProfile:
            typeof body.awsProfile === "string"
              ? body.awsProfile
              : body.awsProfile === null
                ? null
                : undefined,
          allowRealAws:
            typeof body.allowRealAws === "boolean" ? body.allowRealAws : undefined,
          bedrockRegion: typeof body.bedrockRegion === "string" ? body.bedrockRegion : undefined,
          bedrockChatModel:
            typeof body.bedrockChatModel === "string" ? body.bedrockChatModel : undefined,
          acknowledgeExternalRisk:
            typeof body.acknowledgeExternalRisk === "boolean"
              ? body.acknowledgeExternalRisk
              : undefined,
          addKey,
          removeKeyId: typeof body.removeKeyId === "string" ? body.removeKeyId : undefined,
        },
        identity.userId,
      );
      return Response.json({ ...status, role: identity.role, canEdit: true });
    } catch (patchErr) {
      const status =
        patchErr && typeof patchErr === "object" && "status" in patchErr
          ? Number((patchErr as { status: number }).status)
          : 0;
      if (status >= 400 && status < 500) {
        return Response.json(
          { error: patchErr instanceof Error ? patchErr.message : "Invalid request" },
          { status },
        );
      }
      throw patchErr;
    }
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
