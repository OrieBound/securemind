/**
 * Heuristic detection of inference credential kind from pasted material.
 * Used for Admin Settings UX — not a security boundary.
 */

export type DetectedKeyKind =
  | "groq"
  | "bedrock"
  | "google"
  | "openai"
  | "anthropic"
  | "xai"
  | "azure"
  | "unknown";

export type KeyDetection = {
  kind: DetectedKeyKind;
  label: string;
  description: string;
  /** Retained for callers; AWS pairs are no longer accepted through the UI. */
  needsAwsPair: boolean;
  /** We can call chat with this kind today. */
  wired: boolean;
};

/** Credential kinds the UI refuses to store, regardless of role. */
export function isRejectedKeyKind(kind: DetectedKeyKind): boolean {
  return kind === "bedrock";
}

const KIND_META: Record<DetectedKeyKind, Omit<KeyDetection, "kind">> = {
  groq: {
    label: "Groq",
    description: "Groq chat models.",
    needsAwsPair: false,
    wired: true,
  },
  bedrock: {
    label: "AWS access key — not accepted",
    description:
      "SecureMind never stores AWS credentials. Configure them in the environment " +
      "(aws sso login, a shared profile, or an instance role) and set ALLOW_REAL_AWS=true.",
    needsAwsPair: false,
    wired: false,
  },
  google: {
    label: "Gemini",
    description:
      "Gemini chat models.",
    needsAwsPair: false,
    wired: true,
  },
  openai: {
    label: "OpenAI",
    description:
      "OpenAI chat models.",
    needsAwsPair: false,
    wired: true,
  },
  anthropic: {
    label: "Anthropic",
    description:
      "Claude chat models. Claude on Bedrock is separate.",
    needsAwsPair: false,
    wired: true,
  },
  xai: {
    label: "Grok",
    description:
      "Grok chat models.",
    needsAwsPair: false,
    wired: true,
  },
  azure: {
    label: "Azure OpenAI",
    description:
      "Azure OpenAI key shape detected. Stored for later — Azure chat adapter is not wired yet.",
    needsAwsPair: false,
    wired: false,
  },
  unknown: {
    label: "Unrecognized",
    description:
      "Could not identify the vendor from the key shape. You can still save it with a label for later.",
    needsAwsPair: false,
    wired: false,
  },
};

export function detectProviderKey(raw: string): KeyDetection {
  const value = raw.trim();
  let kind: DetectedKeyKind = "unknown";

  if (!value) {
    return { kind: "unknown", ...KIND_META.unknown };
  }

  // Groq: gsk_...
  if (/^gsk_/i.test(value)) {
    kind = "groq";
  }
  // AWS access key id
  else if (/^AKIA[0-9A-Z]{16}$/i.test(value) || /^ASIA[0-9A-Z]{16}$/i.test(value)) {
    kind = "bedrock";
  }
  // Google AI Studio — legacy AIza… keys and newer AQ. auth keys (2026+)
  else if (/^AIza[0-9A-Za-z_-]{20,}$/.test(value) || /^AQ\.[A-Za-z0-9._-]{20,}$/.test(value)) {
    kind = "google";
  }
  // xAI Grok — xai-… (not Groq's gsk_ keys)
  else if (/^xai-[A-Za-z0-9_-]{8,}$/i.test(value)) {
    kind = "xai";
  }
  // Anthropic
  else if (/^sk-ant-/i.test(value)) {
    kind = "anthropic";
  }
  // OpenAI-style (sk-... but not ant)
  else if (/^sk-[A-Za-z0-9_-]{20,}$/.test(value)) {
    kind = "openai";
  }
  // JSON service account hint
  else if (value.startsWith("{") && /"type"\s*:\s*"service_account"/i.test(value)) {
    kind = "google";
  }

  return { kind, ...KIND_META[kind] };
}

export function kindDisplayName(kind: DetectedKeyKind | string): string {
  if (kind in KIND_META) return KIND_META[kind as DetectedKeyKind].label;
  return kind;
}
