/**
 * When a real chat call fails because the model itself is gone, take it off the active lists.
 *
 * A passed test is kept for a week, so a model the provider retires in the meantime stays in the menus
 * and every turn that picks it fails the same way. This reads the provider's error with the same
 * classifier the Test button uses. If it says the model id cannot run (retired, not found, not a chat
 * model, not available on this key), the model is recorded as failed. It then moves out of the chat
 * menus into the "not working" group until a later Test passes. Temporary problems (rate limits,
 * billing, timeouts, a provider outage) are left alone, so one bad minute does not unlist a good model.
 */

import { diagnoseModelTestError } from "./test-diagnose";
import { modelCredentialScope, patchModelAvailability } from "./model-availability-store";
import { invalidateModelCatalogCache } from "./catalog";
import type { ModelProvider } from "./types";

/** Diagnosis codes that mean "this model id cannot be used here", as opposed to "try again later". */
const PERMANENT_CODES = new Set(["not_available", "not_chat_model", "not_entitled"]);

export const RETIRED_MODEL_NOTE =
  "That model is no longer available, so it has been taken off your list. Choose another model in Settings → Models, or let the router pick one.";

export function isModelGoneError(err: unknown, provider: string, model: string): { gone: boolean; code: string } {
  const code = diagnoseModelTestError(err, provider, model).code;
  return { gone: PERMANENT_CODES.has(code), code };
}

/** Returns the note to show the user, or null when the failure was not a retired model. Never throws. */
export async function retireModelAfterChatFailure(opts: {
  err: unknown;
  provider: ModelProvider;
  model: string;
  userId: string;
}): Promise<string | null> {
  // A local model that is missing is fixed by pulling it, not by unlisting it.
  if (opts.provider === "ollama") return null;
  try {
    const { gone, code } = isModelGoneError(opts.err, opts.provider, opts.model);
    if (!gone) return null;
    const scope = await modelCredentialScope(opts.provider);
    await patchModelAvailability(
      { id: opts.model, provider: opts.provider },
      { verification: { ok: false, code, scope, checkedAt: new Date().toISOString() } },
      opts.userId,
    );
    invalidateModelCatalogCache();
    return RETIRED_MODEL_NOTE;
  } catch (e) {
    console.warn("[models] could not record a retired model:", e instanceof Error ? e.name : "error");
    return null;
  }
}
