/**
 * Deterministic turn-mode classifier for SecureMind Investigate.
 * Owns retrieval / citation / UI decisions. Complexity tier routing stays in route-message.ts.
 */

import { normalizeMessage, stripConversationalPrefixes } from "./normalize";
import type { DecideTurnInput, TurnDecision, TurnMode } from "./types";

const SOCIAL_ONLY_RE =
  /^(?:thanks(?:\s+that\s+helps)?|thank\s+you|thx|ok(?:ay)?|sounds?\s+good|got\s+it|cool|nice|sure|yep|yes|no|lol|haha|bye|nm|np|that\s+helps|that\s+makes\s+sense|let'?s\s+continue|how\s+are\s+you(?:\s+doing)?)\s*[!?.]*$/i;

const APP_HELP_RE =
  /\b(?:how\s+do\s+i|where\s+(?:can|do)\s+i|what\s+does|explain)\b.{0,40}\b(?:upload|knowledge|safe\s*terms?|sensitivity|analytics|security\s+view|usage\s+view|cost\s+view|redact|citation|grounding|partial\s+grounding|investigate|workspace)\b/i;

const WORKSPACE_DEIXIS_RE =
  /\b(?:our|my|this\s+workspace|the\s+workspace|uploaded|runbook|postmortem|post-mortem|knowledge|document(?:s|ed)?|procedure|playbook|sop|incident\s+report)\b/i;

const INVESTIGATION_RE =
  /\b(?:what\s+(?:caused|probably\s+caused)|why\s+did|root\s+cause|investigate|compare|what\s+should\s+we|which\s+(?:control|controls)|outage|failed|failure|authentication\s+fail|timeout|rollback|blast\s+radius)\b/i;

const GENERAL_KNOWLEDGE_RE =
  /^(?:what\s+is|what'?s|explain|define|how\s+does|difference\s+between|compare)\b/i;

const FOLLOW_UP_RE =
  /^(?:which\s+source|what\s+about|why\s+(?:does|is|did)|can\s+you\s+expand|expand\s+on|does\s+it\s+mention|and\s+the|the\s+second|more\s+detail|tell\s+me\s+more)\b/i;

const AMBIGUOUS_SHORT_RE =
  /^(?:what\s+about\s+security|is\s+this\s+correct|can\s+you\s+check(?:\s+that)?|what\s+happened|this\??|that\??)\s*[?!.]*$/i;

const JOKE_RE = /\b(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh)\b/i;

function base(
  mode: TurnMode,
  reasonCode: string,
  overrides: Partial<TurnDecision> = {},
): TurnDecision {
  const defaults: TurnDecision = {
    mode,
    shouldRetrieve: false,
    reasonCode,
    sourceScope: "none",
    requiresCitations: false,
    requiresWorkspaceEvidence: false,
    showSourcesUi: false,
    showGroundingBadge: false,
    responseStyle: "concise_fact",
    preferMicroTier: false,
  };
  return { ...defaults, ...overrides, mode, reasonCode };
}

/**
 * Classify the user turn before retrieval and prompt construction.
 */
export function decideTurn(input: DecideTurnInput): TurnDecision {
  const raw = normalizeMessage(input.message);
  const hasImages = Boolean(input.hasImages);
  const hasAttachments = Boolean(input.hasAttachments) || hasImages;
  const { remainder, strippedPrefix } = stripConversationalPrefixes(raw);
  const body = remainder || "";

  // ── Attachments ────────────────────────────────────────────────────────────
  if (hasAttachments) {
    const wantsCompare =
      /\b(?:compare|against|with\s+(?:our|the)\s+runbook|workspace|knowledge)\b/i.test(raw);
    if (!body || body.length < 4) {
      return base("attachment", "attachment-no-instruction", {
        sourceScope: "current_attachment",
        responseStyle: "clarify",
        preferMicroTier: true,
      });
    }
    if (wantsCompare) {
      return base("attachment", "attachment-plus-workspace", {
        shouldRetrieve: true,
        retrievalQuery: body || raw,
        sourceScope: "workspace",
        requiresCitations: true,
        requiresWorkspaceEvidence: true,
        showSourcesUi: true,
        showGroundingBadge: true,
        responseStyle: "investigation",
      });
    }
    return base("attachment", "attachment-current-only", {
      sourceScope: "current_attachment",
      responseStyle: "concise_fact",
    });
  }

  // ── Empty after strip / pure social ────────────────────────────────────────
  if (!body) {
    return base("social", strippedPrefix ? "prefix-only-social" : "empty-social", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  if (SOCIAL_ONLY_RE.test(body) || SOCIAL_ONLY_RE.test(raw)) {
    return base("social", "social-ack", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  // Greeting-shaped remainder that is still just politeness
  if (
    body.length <= 48 &&
    /^(?:there|sir|ma'?am|team|everyone|folks)\s*[!?.]*$/i.test(body)
  ) {
    return base("social", "greeting-filler", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  if (JOKE_RE.test(raw)) {
    return base("social", "joke-request", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  // ── App help ───────────────────────────────────────────────────────────────
  if (APP_HELP_RE.test(raw) || APP_HELP_RE.test(body)) {
    return base("app_help", "app-help", {
      responseStyle: "concise_fact",
      preferMicroTier: true,
    });
  }

  // ── Grounded follow-up ─────────────────────────────────────────────────────
  if (
    (FOLLOW_UP_RE.test(body) || FOLLOW_UP_RE.test(raw)) &&
    (input.priorTurnHadCitations || input.priorTurnWasGrounded)
  ) {
    return base("grounded_follow_up", "follow-up-prior-sources", {
      shouldRetrieve: true,
      retrievalQuery: body,
      sourceScope: "prior_sources",
      requiresCitations: true,
      requiresWorkspaceEvidence: true,
      showSourcesUi: true,
      showGroundingBadge: true,
      responseStyle: "concise_fact",
    });
  }

  // ── Ambiguous short deixis without prior grounding ─────────────────────────
  if (AMBIGUOUS_SHORT_RE.test(body) || AMBIGUOUS_SHORT_RE.test(raw)) {
    if (input.priorTurnHadCitations || input.priorTurnWasGrounded) {
      return base("grounded_follow_up", "ambiguous-with-prior-grounding", {
        shouldRetrieve: true,
        retrievalQuery: body,
        sourceScope: "prior_sources",
        requiresCitations: true,
        requiresWorkspaceEvidence: true,
        showSourcesUi: true,
        showGroundingBadge: true,
        responseStyle: "concise_fact",
      });
    }
    return base("ambiguous", "ambiguous-needs-clarify", {
      responseStyle: "clarify",
      preferMicroTier: true,
    });
  }

  const hasWorkspaceDeixis = WORKSPACE_DEIXIS_RE.test(body) || WORKSPACE_DEIXIS_RE.test(raw);
  const isInvestigation = INVESTIGATION_RE.test(body) || INVESTIGATION_RE.test(raw);

  // ── Workspace-grounded / investigation ─────────────────────────────────────
  if (hasWorkspaceDeixis || isInvestigation) {
    const mode: TurnMode = isInvestigation ? "investigation" : "workspace_grounded";
    return base(mode, isInvestigation ? "investigation-cues" : "workspace-deixis", {
      shouldRetrieve: true,
      retrievalQuery: body,
      sourceScope: "workspace",
      requiresCitations: true,
      requiresWorkspaceEvidence: true,
      showSourcesUi: true,
      showGroundingBadge: true,
      responseStyle: isInvestigation ? "investigation" : "concise_fact",
    });
  }

  // ── General knowledge (no workspace deixis) ────────────────────────────────
  if (GENERAL_KNOWLEDGE_RE.test(body) && !hasWorkspaceDeixis) {
    return base("general", "general-knowledge", {
      responseStyle: "concise_fact",
    });
  }

  // Short operational fragments ("KMS error?") — retrieve, do not suppress
  if (body.length <= 64 && /[a-z0-9]/i.test(body) && /[?]/.test(body)) {
    return base("investigation", "short-ops-query", {
      shouldRetrieve: true,
      retrievalQuery: body,
      sourceScope: "workspace",
      requiresCitations: true,
      requiresWorkspaceEvidence: false, // may answer generally if no hits
      showSourcesUi: true,
      showGroundingBadge: true,
      responseStyle: "investigation",
    });
  }

  // Default: treat as potential workspace-relevant ops question
  if (body.length >= 20) {
    return base("investigation", "default-ops", {
      shouldRetrieve: true,
      retrievalQuery: body,
      sourceScope: "workspace",
      requiresCitations: true,
      requiresWorkspaceEvidence: false,
      showSourcesUi: true,
      showGroundingBadge: true,
      responseStyle: "concise_fact",
    });
  }

  return base("ambiguous", "short-unclear", {
    responseStyle: "clarify",
    preferMicroTier: true,
  });
}

/** Mode-specific instructions appended to the system prompt (never includes reasonCode). */
export function modePromptInstructions(decision: TurnDecision): string {
  switch (decision.responseStyle) {
    case "social":
      return (
        `\n\nResponse mode — conversational greeting or acknowledgement:\n` +
        `- Reply like a calm colleague: one short, natural sentence (two max).\n` +
        `- Do NOT narrate or diagnose the user's message ` +
        `(avoid "It seems like you're just saying hello", "I see this is a greeting", etc.).\n` +
        `- Do NOT mention documents, Knowledge, sources, cloud operations framing, or security topics unless they asked.\n` +
        `- No headings, lists, citations, or investigation template.\n` +
        `- Good: "Hey — what would you like to dig into?" / "You're welcome." / "Sounds good."\n` +
        `- Bad: explaining that they greeted you, or pitching SecureMind features unprompted.`
      );
    case "clarify":
      return (
        `\n\nResponse mode — clarification:\n` +
        `- Ask one focused clarifying question.\n` +
        `- Do not speculate at length or retrieve-style narrate.`
      );
    case "investigation":
      return (
        `\n\nResponse mode — operational investigation:\n` +
        `- Lead with the current evidence state or likely conclusion.\n` +
        `- Separate documented facts from inference; label inferences.\n` +
        `- When helpful use short sections: Summary, Probable causes, Supporting evidence, Gaps, Next steps.\n` +
        `- Do not present inference as confirmed incident fact.\n` +
        `- Do not recommend autonomous remediation.`
      );
    default:
      if (decision.mode === "general") {
        return (
          `\n\nResponse mode — general knowledge:\n` +
          `- Answer from general cloud/security knowledge; do not imply the answer came from workspace documents.\n` +
          `- No workspace citations.\n` +
          `- You may briefly offer to compare the explanation with this workspace's Knowledge if relevant.`
        );
      }
      if (decision.mode === "app_help") {
        return (
          `\n\nResponse mode — product help:\n` +
          `- Explain SecureMind product behavior concisely and accurately.\n` +
          `- Do not search or cite operational workspace Knowledge unless the user asks about their content.`
        );
      }
      return (
        `\n\nResponse mode — concise factual:\n` +
        `- Lead with the answer; explain only as needed.\n` +
        `- Cite workspace evidence only when you use it.`
      );
  }
}
