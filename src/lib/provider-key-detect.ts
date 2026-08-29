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
    description: "Groq Cloud API key — lists and runs Groq text models.",
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
    label: "Google / Gemini",
    description:
      "Google AI Studio Gemini API key — lists models and runs chat when selected in Available models.",
    needsAwsPair: false,
    wired: true,
  },
  openai: {
    label: "OpenAI",
    description:
      "OpenAI Platform API key — lists GPT models and runs chat when selected in Available models.",
    needsAwsPair: false,
    wired: true,
  },
  anthropic: {
    label: "Anthropic",
    description:
      "Anthropic Console API key — lists Claude models and runs chat when selected. For Claude via AWS, use Bedrock.",
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
  // Anthropic
  else if (/^sk-ant-/i.test(value)) {
    kind = "anthropic";
  }
  // OpenAI-style (sk-... but not ant)
  else if (/^sk-[A-Za-z0-9_-]{20,}$/.test(value)) {
    kind = "openai";
  }
  // Azure often uses 32-byte hex
  else if (/^[0-9a-f]{32}$/i.test(value)) {
    kind = "azure";
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
