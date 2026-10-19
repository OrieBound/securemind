/**
 * Provenance tags for stored / cited context.
 * Conversation history is continuity, not documentary evidence.
 */

export type ContextProvenance =
  | "user_statement"
  | "assistant_response"
  | "workspace_document"
  | "current_attachment"
  | "conversation_history"
  | "general_model_knowledge"
  | "external_tool";

/** Categories eligible to appear in the Sources panel / citation package. */
export const CITEABLE_FRAGMENT_CATEGORIES = new Set(["document"]);

export function isCiteableFragment(category: string, documentId?: string | null): boolean {
  return CITEABLE_FRAGMENT_CATEGORIES.has(category) && Boolean(documentId);
}
