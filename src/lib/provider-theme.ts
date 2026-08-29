/**
 * Canonical colors for inference providers / vendors — use everywhere
 * (Settings modules, ProviderBadge, Insights tier rows, credential chips).
 *
 * Runtime chat providers today: groq | bedrock | ollama.
 * Stored-only vendor keys (google, openai, …) get stable colors for when chat is wired.
 */

export type RuntimeProviderId =
  | "groq"
  | "bedrock"
  | "ollama"
  | "openai"
  | "anthropic"
  | "google";

export type VendorThemeId =
  | RuntimeProviderId
  | "google"
  | "openai"
  | "anthropic"
  | "azure"
  | "unknown";

export type ProviderTheme = {
  label: string;
  /** Badge / chip (text + bg + border) */
  badge: string;
  /** Icon / emphasis text */
  icon: string;
  /** Open accordion / card border */
  borderOpen: string;
  /** Open accordion / card wash */
  bgOpen: string;
  /** Soft surface for nested rows */
  surface: string;
};

/**
 * Groq → violet/purple · Bedrock → sky/light blue · Ollama → emerald/green
 * Future direct vendors get distinct hues so they never collide with those three.
 */
export const PROVIDER_THEME: Record<VendorThemeId, ProviderTheme> = {
  groq: {
    label: "Groq",
    badge: "text-violet-300/90 bg-violet-500/15 border-violet-400/30",
    icon: "text-violet-300/90",
    borderOpen: "border-violet-500/50",
    bgOpen: "bg-violet-500/[0.05]",
    surface: "border-violet-500/35 bg-violet-500/15",
  },
  bedrock: {
    label: "Bedrock",
    badge: "text-sky-300/90 bg-sky-500/15 border-sky-400/30",
    icon: "text-sky-300/90",
    borderOpen: "border-sky-500/50",
    bgOpen: "bg-sky-500/[0.05]",
    surface: "border-sky-500/35 bg-sky-500/15",
  },
  ollama: {
    label: "Ollama",
    badge: "text-emerald-300/90 bg-emerald-500/15 border-emerald-400/30",
    icon: "text-emerald-300/90",
    borderOpen: "border-emerald-500/50",
    bgOpen: "bg-emerald-500/[0.05]",
    surface: "border-emerald-500/35 bg-emerald-500/15",
  },
  google: {
    label: "Google",
    badge: "text-blue-300/90 bg-blue-500/15 border-blue-400/30",
    icon: "text-blue-300/90",
    borderOpen: "border-blue-500/50",
    bgOpen: "bg-blue-500/[0.05]",
    surface: "border-blue-500/35 bg-blue-500/15",
  },
  openai: {
    label: "OpenAI",
    badge: "text-teal-300/90 bg-teal-500/15 border-teal-400/30",
    icon: "text-teal-300/90",
    borderOpen: "border-teal-500/50",
    bgOpen: "bg-teal-500/[0.05]",
    surface: "border-teal-500/35 bg-teal-500/15",
  },
  anthropic: {
    label: "Anthropic",
    badge: "text-orange-300/90 bg-orange-500/15 border-orange-400/30",
    icon: "text-orange-300/90",
    borderOpen: "border-orange-500/50",
    bgOpen: "bg-orange-500/[0.05]",
    surface: "border-orange-500/35 bg-orange-500/15",
  },
  azure: {
    label: "Azure",
    badge: "text-cyan-300/90 bg-cyan-500/15 border-cyan-400/30",
    icon: "text-cyan-300/90",
    borderOpen: "border-cyan-500/50",
    bgOpen: "bg-cyan-500/[0.05]",
    surface: "border-cyan-500/35 bg-cyan-500/15",
  },
  unknown: {
    label: "Unknown",
    badge: "text-foreground/50 bg-foreground/[0.06] border-foreground/15",
    icon: "text-foreground/45",
    borderOpen: "border-foreground/25",
    bgOpen: "bg-foreground/[0.03]",
    surface: "border-foreground/15 bg-foreground/[0.06]",
  },
};

/** Settings “Available models” catalog — not a provider; distinct from Local/Ollama green. */
export const CATALOG_THEME = {
  label: "Catalog",
  badge: "text-fuchsia-300/90 bg-fuchsia-500/15 border-fuchsia-400/30",
  icon: "text-fuchsia-300/90",
  borderOpen: "border-fuchsia-500/50",
  bgOpen: "bg-fuchsia-500/[0.05]",
  surface: "border-fuchsia-500/35 bg-fuchsia-500/15",
} as const;

export function themeForVendor(kind: string | null | undefined): ProviderTheme {
  if (kind && kind in PROVIDER_THEME) {
    return PROVIDER_THEME[kind as VendorThemeId];
  }
  return PROVIDER_THEME.unknown;
}

export function themeForRuntime(provider: RuntimeProviderId | string): ProviderTheme {
  if (provider in PROVIDER_THEME) {
    return PROVIDER_THEME[provider as VendorThemeId];
  }
  return PROVIDER_THEME.unknown;
}
