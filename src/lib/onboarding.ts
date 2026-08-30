/**
 * First-run chat onboarding. Seeded hello + no-model replies — not an LLM persona.
 */

import { runtimeEdition, type RuntimeEdition } from "@/lib/runtime-env";

export const GETTING_STARTED_PATH = "/getting-started";
export const PROVIDERS_DEEP_LINK = "/?settings=providers&highlight=bedrock";
export const HIGHLIGHT_BEDROCK_KEY = "sm_highlight_bedrock";

export const LEGACY_DEFAULT_HELLO_MARKERS = [
  "your first workspace",
  "Feel free to change my name anytime in **Workspace** settings",
] as const;

export function isLegacyDefaultHello(content: string): boolean {
  return LEGACY_DEFAULT_HELLO_MARKERS.every(m => content.includes(m));
}

export function defaultWorkspaceHello(
  name: string,
  edition: RuntimeEdition = runtimeEdition(),
): string {
  if (edition === "cloud") {
    return (
      `Hi — I'm **${name}**, your first workspace here.\n\n` +
      `Welcome to SecureMind. Chat needs a model first. On this hosted install, start with **Amazon Bedrock** ` +
      `(your AWS account, pay-per-use). You can add a vendor key such as Groq on the same screen if you prefer.\n\n` +
      `**Do this next:**\n` +
      `1. Open the **[Getting started](${GETTING_STARTED_PATH})** guide (pictures of each click).\n` +
      `2. Or jump straight to **[Settings → Providers](${PROVIDERS_DEEP_LINK})** and check the Bedrock billing acknowledgement.\n\n` +
      `Detection still runs in this browser without a model. When chat is connected, ask me how Knowledge, workspaces, or settings work.`
    );
  }
  return (
    `Hi — I'm **${name}**, your first workspace here.\n\n` +
    `Welcome to SecureMind. Chat needs a model first. On this machine, start with **Ollama** (local), ` +
    `or connect Amazon Bedrock / a vendor key in Settings.\n\n` +
    `**Do this next:**\n` +
    `1. Open the **[Getting started](${GETTING_STARTED_PATH})** guide.\n` +
    `2. Or open **[Settings → Providers](${PROVIDERS_DEEP_LINK})**.\n\n` +
    `When a model is connected, ask me how Knowledge, workspaces, or settings work.`
  );
}

export function noModelAssistantReply(edition: RuntimeEdition): string {
  if (edition === "cloud") {
    return (
      `Chat is not connected yet — your message is fine. This hosted install has no model until an Admin enables one.\n\n` +
      `**Amazon Bedrock (recommended here)**\n` +
      `1. Open **[Settings → Providers](${PROVIDERS_DEEP_LINK})**.\n` +
      `2. Under **Amazon Bedrock**, check **I understand that enabling Bedrock permits SecureMind to make billable model requests in my AWS account.**\n` +
      `3. In the AWS console, allow Bedrock **model access** for this account and region (Amazon Nova, for example). That is not an IAM role — Terraform already created the roles. The app cannot turn model access on for you.\n\n` +
      `Pictures of each step: **[Getting started](${GETTING_STARTED_PATH})**.\n\n` +
      `**Or** add a vendor API key (Groq, OpenAI, Anthropic, Google) on the same Providers page. Do not paste AWS access keys — those are never stored in the app.`
    );
  }
  return (
    `Chat is not connected yet — your message is fine.\n\n` +
    `On this machine, start with **Ollama** (local models), or enable **Amazon Bedrock** / a vendor key.\n\n` +
    `**[Settings → Providers](${PROVIDERS_DEEP_LINK})** · **[Getting started](${GETTING_STARTED_PATH})**`
  );
}

export function chatUnreachableMessage(edition: RuntimeEdition): string {
  if (edition === "local") {
    return "Could not reach the chat API. Confirm the app is running, then try again.";
  }
  return (
    "Could not reach the chat service. If no model is connected yet, open Getting started " +
    "or Settings → Providers and enable the Bedrock billing acknowledgement. " +
    "If a model is already enabled, wait a few seconds and try again."
  );
}

export function markBedrockHighlight(): void {
  try {
    sessionStorage.setItem(HIGHLIGHT_BEDROCK_KEY, "1");
  } catch {
    /* private browsing */
  }
}

export function consumeBedrockHighlight(): boolean {
  try {
    if (sessionStorage.getItem(HIGHLIGHT_BEDROCK_KEY) === "1") {
      sessionStorage.removeItem(HIGHLIGHT_BEDROCK_KEY);
      return true;
    }
  } catch {
    /* private browsing */
  }
  return false;
}
