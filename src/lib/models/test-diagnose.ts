/**
 * Map a provider SDK error from Models → Test into operator-facing copy.
 *
 * Bedrock often uses AccessDeniedException for “this account cannot use this
 * model,” which is entitlement — not a missing Amplify IAM action. Classify
 * that first so we do not tell the operator to fix a role that already works.
 */

import { BEDROCK_NOT_ENTITLED_REMEDIATION } from "./catalog-shared";

export type ModelTestDiagnosis = {
  code: string;
  message: string;
  remediation: string | null;
};

export function diagnoseModelTestError(
  err: unknown,
  provider: string,
  modelId: string,
): ModelTestDiagnosis {
  const name = err instanceof Error ? err.name : "Error";
  const raw = err instanceof Error ? err.message : String(err);
  const blob = `${name} ${raw}`;

  if (/insufficient_quota|billing|quota.*limit:\s*0|subscription|payment.required/i.test(raw)) {
    return { code: "quota_or_billing", message: "This API account has no usable quota or billing access for the model.", remediation: "Check this model's API quota and billing in the provider console, then test again." };
  }
  if (/\(404\)|NOT_FOUND|model_not_found|deprecated|decommissioned|not found|not supported for.*generateContent/i.test(raw)) {
    return { code: "not_available", message: "The provider could not run this model id.", remediation: "Refresh the catalog. This model may be retired, unavailable to this key, or incompatible with streaming chat." };
  }
  if (/\(40[123]\)|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
    return { code: "access_denied", message: "The provider rejected access to this model.", remediation: "Check the API key's permissions and API plan, then test again." };
  }
  if (/\(429\)|RESOURCE_EXHAUSTED/i.test(raw)) {
    return { code: "throttled", message: "The provider's rate or quota limit was reached.", remediation: "Check API quota or retry later. A failed check does not permanently disable the model." };
  }

  if (/not available for this account|contact AWS Sales|additional access options/i.test(raw)) {
    return {
      code: "not_entitled",
      message: raw,
      remediation:
        provider === "bedrock"
          ? BEDROCK_NOT_ENTITLED_REMEDIATION
          : "This model is not available on this API key or plan.",
    };
  }

  if (
    /doesn't support the model|supported text or chat model|is not a valid model/i.test(raw)
  ) {
    return {
      code: "not_chat_model",
      message: raw,
      remediation:
        "This id is not a text chat model (speech, audio, or another modality). It should not be assigned for chat.",
    };
  }

  if (/AccessDenied|not authorized|UnrecognizedClient/i.test(blob)) {
    return {
      code: "access_denied",
      message: raw,
      remediation:
        provider === "bedrock"
          ? "This Test call runs as the Amplify UI role. Terraform attaches bedrock:InvokeModel and InvokeModelWithResponseStream to that existing role — you do not create a role by hand. Chat already uses the chat Lambda role."
          : "The API key was rejected for this model. Check the key's plan and permissions.",
    };
  }
  if (/ResourceNotFound|end of its life|does not exist/i.test(raw)) {
    return {
      code: "not_available",
      message: raw,
      remediation:
        "This model id is not available in the selected region — it may be retired, or it may only exist behind a cross-region inference profile.",
    };
  }
  if (/ValidationException|Invocation of model ID.*isn't supported/i.test(raw)) {
    const alreadyProfile = /^(us|eu|apac|global)\./i.test(modelId);
    return {
      code: alreadyProfile ? "not_invocable" : "needs_inference_profile",
      message: raw,
      remediation: alreadyProfile
        ? "Bedrock rejected this inference profile for chat. Use another id from the list that Tested OK."
        : "This model cannot be called on demand. Use the cross-region inference profile id (the one prefixed with us. or global.) instead.",
    };
  }
  if (/Throttl|TooManyRequests|rate limit/i.test(blob)) {
    return {
      code: "throttled",
      message: raw,
      remediation: "The provider throttled the request. Retry in a moment.",
    };
  }
  if (/timed out|timeout|abort/i.test(raw)) {
    return {
      code: "timeout",
      message: raw,
      remediation: "No response within 30s. The model may be cold or unreachable from this host.",
    };
  }
  return { code: "error", message: raw || `${name} while calling ${modelId}`, remediation: null };
}
