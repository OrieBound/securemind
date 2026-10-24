export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { patchInstanceConfig, ProviderConfigError } from "@/lib/instance-config";
import { isAdminRole, requireAdmin, type AppRole } from "@/lib/roles";
import { resolveAllowedModel } from "@/lib/models/allowlist";
import { getTaskModels, parseTaskPurpose, setTaskModel, taskModelBlockReason, TASK_PURPOSES } from "@/lib/models/task-models";

async function payload(role: AppRole) {
  const choices = await getTaskModels();
  return {
    purposes: TASK_PURPOSES.map(purpose => ({
      purpose,
      choice: choices[purpose] ? { provider: choices[purpose]!.provider, model: choices[purpose]!.model } : null,
    })),
    role,
    canEdit: isAdminRole(role),
  };
}

/** Any signed-in member can see which helper is set; only an Admin can change it. */
export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    return Response.json(await payload(identity.role), { headers: { "Cache-Control": "no-store" } });
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

    const purpose = parseTaskPurpose(body.purpose);
    if (!purpose) return Response.json({ error: "Unknown task." }, { status: 422 });

    // `model: null` turns the helper off.
    if (body.model === null || body.model === "") {
      await setTaskModel(purpose, null, identity.userId);
      return Response.json(await payload(identity.role));
    }

    const requested = typeof body.model === "string" ? body.model.trim() : "";
    const provider = typeof body.provider === "string" ? body.provider : undefined;
    // Only a model the live catalog lists and that is ready to use can be approved.
    const found = await resolveAllowedModel(requested);
    const allowed = found && (!provider || found.provider === provider) ? found : null;
    if (!allowed) {
      return Response.json({ error: "That model is not available on this install." }, { status: 422 });
    }

    const blocked = await taskModelBlockReason(allowed.provider);
    if (blocked) {
      const needsConsent = allowed.provider !== "bedrock" && allowed.provider !== "ollama";
      if (!(needsConsent && body.acknowledgeExternalRisk === true)) {
        return Response.json({ error: blocked, needsConsent }, { status: 422 });
      }
      try {
        await patchInstanceConfig({ acknowledgeExternalRisk: true }, identity.userId);
      } catch (patchErr) {
        if (patchErr instanceof ProviderConfigError) {
          return Response.json({ error: patchErr.message }, { status: patchErr.status });
        }
        throw patchErr;
      }
    }

    await setTaskModel(purpose, { provider: allowed.provider, model: allowed.model }, identity.userId);
    return Response.json(await payload(identity.role));
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
