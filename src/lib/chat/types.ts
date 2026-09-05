/**
 * Shared chat turn types for Next.js /api/chat and the streaming Lambda.
 */

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type ChatRequestBody = {
  message: string;
  mode?: string;
  workspaceId?: string;
  images?: string[];
  attachmentDocumentIds?: string[];
  /** Same-turn scrubbed extracts so chat does not wait on a second document lookup. */
  attachmentExtracts?: Array<{ id: string; name: string; content: string }>;
  sessionId?: string;
  history?: HistoryMessage[];
  sessionSummary?: string;
  facts?: Record<string, string>;
  modelOverrides?: Record<string, string>;
  lastTier?: string | null;
  priorTurnHadCitations?: boolean;
  priorTurnWasGrounded?: boolean;
};
