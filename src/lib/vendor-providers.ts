/**
 * Supported third-party vendor APIs (pasted keys + external-risk consent).
 * Single source for Settings UI copy and server-side catalog bucketing.
 */

import type { DetectedKeyKind } from "@/lib/provider-key-detect";

/** Vendors with chat + model catalog wired in SecureMind. */
export type WiredVendorKind = "groq" | "google" | "openai" | "anthropic";

export type VendorApiSpec = {
  kind: WiredVendorKind;
  label: string;
  productName: string;
  /** Where operators create an API key. */
  keyCreateUrl: string;
  keyCreateLabel: string;
  keyHint: string;
  blurb: string;
  /** Shown in Settings when no key is stored yet. */
  docsNote?: string;
};

export const WIRED_VENDOR_APIS: VendorApiSpec[] = [
  {
    kind: "groq",
    label: "Groq",
    productName: "Groq Cloud",
    keyCreateUrl: "https://console.groq.com/keys",
    keyCreateLabel: "Groq Console → API keys",
    keyHint: "Starts with gsk_",
    blurb: "Fast cloud inference — default for complexity-tier routing.",
  },
  {
    kind: "google",
    label: "Google",
    productName: "Google AI Studio (Gemini)",
    keyCreateUrl: "https://aistudio.google.com/apikey",
    keyCreateLabel: "Google AI Studio → API keys",
    keyHint: "AIza… or AQ.… (new auth keys)",
    blurb: "Gemini models via generativelanguage.googleapis.com.",
    docsNote:
      "Some VPNs block Google APIs. If the key looks valid but no models load, try disconnecting the VPN.",
  },
  {
    kind: "openai",
    label: "OpenAI",
    productName: "OpenAI Platform",
    keyCreateUrl: "https://platform.openai.com/api-keys",
    keyCreateLabel: "OpenAI Platform → API keys",
    keyHint: "Starts with sk- (not sk-ant-)",
    blurb: "GPT-family chat models via api.openai.com.",
  },
  {
    kind: "anthropic",
    label: "Anthropic",
    productName: "Anthropic Console",
    keyCreateUrl: "https://console.anthropic.com/settings/keys",
    keyCreateLabel: "Anthropic Console → API keys",
    keyHint: "Starts with sk-ant-",
    blurb: "Claude models via api.anthropic.com. (Claude on Bedrock uses the Bedrock module instead.)",
  },
];

/** Stored-only today — detection + inventory, no chat adapter yet. */
export const STORE_ONLY_VENDOR_APIS = [
  {
    kind: "azure" as const,
    label: "Azure OpenAI",
    productName: "Azure OpenAI",
    keyCreateUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
    keyCreateLabel: "Azure Portal → Azure OpenAI",
    keyHint: "32-character hex key + endpoint in Azure",
    blurb: "Keys can be saved for later — Azure chat is not wired yet. Use OpenAI direct or Bedrock for Claude.",
  },
];

export type VendorCatalogKind = WiredVendorKind | "none";

export function isWiredVendorKind(kind: string): kind is WiredVendorKind {
  return kind === "groq" || kind === "google" || kind === "openai" || kind === "anthropic";
}

export function catalogKindForDetectedKind(kind: DetectedKeyKind): VendorCatalogKind | "bedrock" | "ollama" {
  if (kind === "groq") return "groq";
  if (kind === "google") return "google";
  if (kind === "openai") return "openai";
  if (kind === "anthropic") return "anthropic";
  return "none";
}

export function vendorApiSpec(kind: string): VendorApiSpec | null {
  return WIRED_VENDOR_APIS.find(v => v.kind === kind) ?? null;
}
