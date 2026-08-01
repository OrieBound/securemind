/**
 * Central turn decision — retrieval, citations, and response style.
 * reasonCode is telemetry only; never place it in assistant-visible text.
 */

export type TurnMode =
  | "social"
  | "general"
  | "workspace_grounded"
  | "investigation"
  | "attachment"
  | "grounded_follow_up"
  | "app_help"
  | "ambiguous";

export type SourceScope =
  | "none"
  | "workspace"
  | "current_attachment"
  | "prior_sources";

export type ResponseStyle = "social" | "concise_fact" | "investigation" | "clarify";

export type TurnDecision = {
  mode: TurnMode;
  shouldRetrieve: boolean;
  reasonCode: string;
  /** Message after conversational prefixes are stripped — used as retrieval query when set. */
  retrievalQuery?: string;
  sourceScope: SourceScope;
  requiresCitations: boolean;
  requiresWorkspaceEvidence: boolean;
  showSourcesUi: boolean;
  showGroundingBadge: boolean;
  responseStyle: ResponseStyle;
  /** Prefer Micro for social/acks when auto-routing. */
  preferMicroTier: boolean;
};

export type DecideTurnInput = {
  message: string;
  hasImages?: boolean;
  hasAttachments?: boolean;
  /** Prior assistant turn exposed workspace citations. */
  priorTurnHadCitations?: boolean;
  /** Prior assistant turn required or used workspace evidence. */
  priorTurnWasGrounded?: boolean;
};
