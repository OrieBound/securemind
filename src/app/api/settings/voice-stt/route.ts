export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import {
  getVendorConsentFlags,
  instanceCanUseBedrock,
  patchInstanceConfig,
  ProviderConfigError,
} from "@/lib/instance-config";
import { isAdminRole, requireAdmin } from "@/lib/roles";
import { isHostedRuntime } from "@/lib/runtime-env";
import { parseVoiceSttChoice } from "@/lib/transcribe/backend";

function groqReadyForStt(flags: { hasGroqKey: boolean; hasEnvGroqKey: boolean }): boolean {
  if (isHostedRuntime()) return flags.hasGroqKey;
  return flags.hasGroqKey || flags.hasEnvGroqKey;
}

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const flags = await getVendorConsentFlags();
    return Response.json({
      ...flags,
      groqReady: groqReadyForStt(flags),
      transcribeAvailable: await instanceCanUseBedrock(),
      role: identity.role,
      canEdit: isAdminRole(identity.role),
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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const choice = parseVoiceSttChoice(body.choice);
    if (!choice) {
      return Response.json(
        { error: "Choose Groq Whisper or Amazon Transcribe." },
        { status: 422 },
      );
    }
    if (body.acknowledgeVoiceAudio !== true) {
      return Response.json(
        {
          error:
            "Confirm that spoken audio is sent to the transcription vendor before any redaction.",
        },
        { status: 422 },
      );
    }

    const groqApiKey = typeof body.groqApiKey === "string" ? body.groqApiKey.trim() : "";
    const enableBillableAws = body.enableBillableAws === true;
    const wantsKeyOrBilling = Boolean(groqApiKey) || enableBillableAws;
    if (wantsKeyOrBilling) {
      requireAdmin(identity);
    }

    const flags = await getVendorConsentFlags();
    const groqReady = groqReadyForStt(flags) || Boolean(groqApiKey);
    const awsReady = enableBillableAws || flags.allowRealAws || (await instanceCanUseBedrock());

    if (choice === "groq" && !groqReady) {
      return Response.json(
        {
          error:
            "Add a Groq API key (Admin) from console.groq.com/keys, or ask an Admin to save one.",
        },
        { status: 422 },
      );
    }
    if (choice === "transcribe" && !awsReady) {
      return Response.json(
        {
          error:
            "Amazon Transcribe uses billable AWS (the same account as Bedrock). Enable it here (Admin) or in Settings → Providers.",
        },
        { status: 422 },
      );
    }

    try {
      const status = await patchInstanceConfig(
        {
          voiceSttChoice: choice,
          acknowledgeVoiceAudio: true,
          groqApiKey: groqApiKey || undefined,
          acknowledgeExternalRisk: groqApiKey ? true : undefined,
          allowRealAws: enableBillableAws ? true : undefined,
        },
        identity.userId,
      );
      return Response.json({
        ...status,
        transcribeAvailable: await instanceCanUseBedrock(),
        role: identity.role,
        canEdit: isAdminRole(identity.role),
      });
    } catch (patchErr) {
      if (patchErr instanceof ProviderConfigError) {
        return Response.json({ error: patchErr.message }, { status: patchErr.status });
      }
      throw patchErr;
    }
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
