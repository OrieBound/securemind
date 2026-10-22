/**
 * Supported third-party vendor APIs (pasted keys + external-risk consent).
 * Single source for Settings UI copy and server-side catalog bucketing.
 */

import type { DetectedKeyKind } from "@/lib/provider-key-detect";

/** Vendors with chat + model catalog wired in SecureMind. */
export type WiredVendorKind = "groq" | "google" | "openai" | "anthropic" | "xai";

export type VendorApiSpec = {
  kind: WiredVendorKind;
  label: string;
  productName: string;
  /** Where operators create an API key. */
  keyCreateUrl: string;
  keyCreateLabel: string;
  keyHint: string;
  blurb: string;
  /** Short mark beside the product name, e.g. xAI next to Grok. */
  mark?: string;
  /** Shown in Settings when no key is stored yet. */
  docsNote?: string;
};

export const WIRED_VENDOR_APIS: VendorApiSpec[] = [
  {
    kind: "groq",
    label: "Groq",
    productName: "Groq",
    keyCreateUrl: "https://console.groq.com/keys",
    keyCreateLabel: "Groq Console → API keys",
    keyHint: "Starts with gsk_",
    blurb: "Fast cloud inference — default for complexity-tier routing.",
  },
  {
    kind: "google",
    label: "Gemini",
    productName: "Gemini",
    keyCreateUrl: "https://aistudio.google.com/apikey",
    keyCreateLabel: "Google AI Studio → API keys",
    keyHint: "AIza… or AQ.… (new auth keys)",
    blurb: "Gemini chat models.",
    docsNote:
      "Some VPNs block Google APIs. If the key looks valid but no models load, try disconnecting the VPN.",
  },
  {
    kind: "openai",
    label: "OpenAI",
    productName: "OpenAI",
    keyCreateUrl: "https://platform.openai.com/api-keys",
    keyCreateLabel: "OpenAI → API keys",
    keyHint: "Starts with sk- (not sk-ant-)",
    blurb: "GPT-family chat models.",
  },
  {
    kind: "anthropic",
    label: "Anthropic",
    productName: "Anthropic",
    keyCreateUrl: "https://console.anthropic.com/settings/keys",
    keyCreateLabel: "Anthropic → API keys",
    keyHint: "Starts with sk-ant-",
    blurb: "Claude chat models. Claude on Bedrock uses the Bedrock module instead.",
  },
  {
    kind: "xai",
    label: "Grok",
    productName: "Grok",
    mark: "xAI",
    keyCreateUrl: "https://console.x.ai/",
    keyCreateLabel: "xAI Console → API keys",
    keyHint: "Starts with xai-",
    blurb: "Grok chat models via api.x.ai.",
  },
];

export type VendorCatalogKind = WiredVendorKind | "none";

export function isWiredVendorKind(kind: string): kind is WiredVendorKind {
  return kind === "groq" || kind === "google" || kind === "openai" || kind === "anthropic" || kind === "xai";
}

export function catalogKindForDetectedKind(kind: DetectedKeyKind): VendorCatalogKind | "bedrock" | "ollama" {
  if (kind === "groq") return "groq";
  if (kind === "google") return "google";
  if (kind === "openai") return "openai";
  if (kind === "anthropic") return "anthropic";
  if (kind === "xai") return "xai";
  return "none";
}

export function vendorApiSpec(kind: string): VendorApiSpec | null {
  return WIRED_VENDOR_APIS.find(v => v.kind === kind) ?? null;
}
