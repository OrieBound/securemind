/**
 * Shared types for the model abstraction layer.
 *
 * SecureMind routes different tasks to different models:
 *   chat       → capable conversational model  (Ollama llama3.2 / Bedrock Claude)
 *   summarize  → cheap/fast model              (Ollama llama3.2:3b / Bedrock Nova Micro)
 *   extract    → cheap/fast model              (same as summarize)
 *   embed      → dedicated embedding model     (Ollama nomic-embed-text / Bedrock Titan)
 *
 * This keeps inference costs low: only complex user-facing turns hit the
 * stronger model; background memory work stays cheap.
 */

export type ModelTask = "chat" | "summarize" | "extract" | "embed";

export type ModelProvider = "ollama" | "groq" | "bedrock" | "openai" | "anthropic" | "google" | "xai";

export type ModelConfig = {
  provider: ModelProvider;
  model: string;
  /** Override base URL (useful for pointing at a remote Ollama host). */
  baseUrl?: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: { url: string };
};

export type TextContent = {
  type: "text";
  text: string;
};

/** Reported by a provider when its reply ends. `truncated` means the model hit its output limit. */
export type StreamFinishCallback = (info: { truncated: boolean }) => void;

/** Output cap for one chat reply. Long enough for a real code file; the Continue button covers the rest. */
export const MAX_REPLY_TOKENS = 3072;

/** Reply limit when the person asked for a file: long enough for a real spreadsheet or document. */
export const FILE_REPLY_TOKENS = 8192;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | (TextContent | ImageContent)[];
};

export type StreamChunk = {
  delta: string;
  done: boolean;
};
