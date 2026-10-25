/**
 * User-facing Groq connectivity errors — VPN/proxy/firewall blocks are common.
 */

const VPN_HINT =
  "Can't reach api.groq.com. A VPN or firewall may be blocking it. Allow that host, then use Check key.";

/** Groq's edge refused this server. Whisper is a different endpoint and can still succeed. */
const CHAT_BLOCKED_HINT =
  "Groq refused chat and the model list from this server (api.groq.com). The key can still be valid. Voice uses Groq Whisper, a different endpoint, and can still work. Allow that host, then use Check key.";

const BAD_KEY_HINT =
  "Groq rejected this API key. Re-paste the full key from console.groq.com (starts with gsk_). " +
  "A stored key is not the same as a working chat session.";

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function looksLikeNetworkBlock(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("econnreset") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("socket") ||
    lower.includes("certificate") ||
    lower.includes("tls") ||
    lower.includes("abort") ||
    /groq models list failed \((403|502|503|522|524)\)/i.test(msg)
  );
}

function looksLikeBadKey(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    /groq models list failed \(401\)/i.test(msg) ||
    /\b401\b/.test(msg) ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication_error")
  );
}

function looksLikeEdgeBlock(msg: string): boolean {
  return /access denied|check your network settings/i.test(msg);
}

function looksLikeModelGone(msg: string): boolean {
  return /decommissioned|model_not_found|unknown model|does not exist|not_found/i.test(msg);
}

export type GroqErrorKind = "network" | "auth" | "model" | "other";

export function classifyGroqError(err: unknown): GroqErrorKind {
  const msg = errorText(err);
  if (looksLikeBadKey(msg)) return "auth";
  if (looksLikeNetworkBlock(msg)) return "network";
  if (looksLikeModelGone(msg)) return "model";
  return "other";
}

/** Turn a Groq list/stream failure into an actionable message for Settings or chat. */
export function formatGroqConnectivityError(err: unknown): string {
  const msg = errorText(err);
  if (looksLikeEdgeBlock(msg)) return CHAT_BLOCKED_HINT;
  const kind = classifyGroqError(err);
  if (/rate_limit_exceeded|\b429\b/.test(msg)) {
    return "Groq is rate limiting this key (its plan caps tokens per minute for this model). Wait a moment and try again, or pick another model under Settings → Models.";
  }
  if (kind === "network") return VPN_HINT;
  if (kind === "auth") return BAD_KEY_HINT;
  if (kind === "model") {
    return (
      "Groq could not run this model id (it may be retired or not on this key's plan). " +
      "The Insights GROQ labels are preferred cloud defaults, not a live health check."
    );
  }
  return msg.trim() || VPN_HINT;
}

/** Chat-stream variant — same diagnosis, never "set GROQ_API_KEY" when a key is already stored. */
export function formatGroqChatError(err: unknown): string {
  return formatGroqConnectivityError(err);
}

export function groqVendorStatusLabel(opts: {
  riskAck: boolean;
  keySaved: boolean;
  modelCount: number;
  catalogErrors: string[];
}): string {
  if (!opts.riskAck) return "Consent needed";
  if (!opts.keySaved) return "Not configured";
  const groqErr = opts.catalogErrors.find(e =>
    /groq|api\.groq\.com|rejected this API key|VPN/i.test(e),
  );
  if (groqErr && /rejected this API key/i.test(groqErr)) return "Key rejected";
  if (opts.modelCount === 0) return groqErr ? "Unreachable" : "Key saved · 0 models";
  return `Key saved · ${opts.modelCount} models listed`;
}

export const GROQ_VPN_SETTINGS_NOTE =
  "Chat and the model list call api.groq.com from this server. Voice uses Groq Whisper, a different endpoint, so transcription can work when chat cannot. Use Check key to retry the model list.";
