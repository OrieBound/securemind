/**
 * Deterministic turn-mode classifier for SecureMind Investigate.
 * Owns retrieval / citation / UI decisions. Complexity tier routing stays in route-message.ts.
 */

import { normalizeMessage, stripConversationalPrefixes } from "./normalize";
import type { DecideTurnInput, TurnDecision, TurnMode } from "./types";

const SOCIAL_ONLY_RE =
  /^(?:thanks(?:\s+that\s+helps)?|thank\s+you|thx|ok(?:ay)?|sounds?\s+good|got\s+it|cool|nice|sure|yep|yes|no|lol|haha|bye|nm|np|that\s+helps|that\s+makes\s+sense|let'?s\s+continue|how\s+are\s+you(?:\s+doing)?)\s*[!?.]*$/i;

const CASUAL_TALK_RE =
  /\b(?:just\s+want\s+to\s+talk|want\s+to\s+(?:chat|talk)(?:\s+to\s+you)?|be\s+my\s+friend|let'?s\s+(?:just\s+)?(?:chat|talk)|what\s+(?:are\s+you\s+thinking|do\s+you\s+feel)|i\s+had\s+a\s+long\s+day|tell\s+me\s+something\s+interesting)\b/i;

const CORRECTION_RE =
  /\b(?:you\s+said\s+that|not\s+me|i\s+didn'?t\s+say|that\s+was\s+(?:you|your)|shouldn'?t\s+have\s+(?:stored|cited|treated)|wrong(?:\s+memory)?)\b/i;

const PROVENANCE_ASK_RE =
  /\b(?:where\s+did\s+you\s+(?:learn|get)|where\s+did\s+that\s+come\s+from|how\s+do\s+you\s+know(?:\s+that)?|what'?s\s+your\s+source|where\s+did\s+you\s+hear)\b/i;

const TOPIC_PERMISSION_RE =
  /\b(?:not\s+relevant\s+to\s+(?:our|the)\s+conversation|just\s+want\s+to\s+talk\s+(?:to\s+you\s+)?about|without\s+connecting|don'?t\s+(?:need|want)\s+(?:cloud|ops|workspace))\b/i;

const APP_HELP_RE =
  /\b(?:how\s+do\s+i|where\s+(?:can|do)\s+i|what\s+does|explain)\b.{0,40}\b(?:upload|knowledge|safe\s*terms?|sensitivity|analytics|security\s+view|usage\s+view|cost\s+view|redact|citation|grounding|partial\s+grounding|investigate|workspace|security\s+dashboard)\b/i;

const WORKSPACE_DEIXIS_RE =
  /\b(?:our|my|this\s+workspace|the\s+workspace|uploaded|runbook|postmortem|post-mortem|knowledge|document(?:s|ed)?|procedure|playbook|sop|incident\s+report)\b/i;

const INVESTIGATION_RE =
  /\b(?:what\s+(?:caused|probably\s+caused)|why\s+did|root\s+cause|investigate|compare|what\s+should\s+we|which\s+(?:control|controls)|outage|failed|failure|authentication\s+fail|timeout|rollback|blast\s+radius)\b/i;

const GENERAL_KNOWLEDGE_RE =
  /^(?:what\s+is|what'?s|explain|define|how\s+does|how\s+do(?:es)?|difference\s+between|compare|tell\s+me\s+about|tell\s+me\s+something(?:\s+about)?)\b/i;

const FOLLOW_UP_RE =
  /^(?:which\s+source|what\s+about|why\s+(?:does|is|did)|can\s+you\s+expand|expand\s+on|does\s+it\s+mention|and\s+the|the\s+second|more\s+detail|tell\s+me\s+more)\b/i;

const AMBIGUOUS_SHORT_RE =
  /^(?:what\s+about\s+security|is\s+this\s+correct|can\s+you\s+check(?:\s+that)?|what\s+happened|this\??|that\??)\s*[?!.]*$/i;

const JOKE_RE = /\b(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh)\b/i;

/** Ops/security tokens that justify retrieval when the default path would otherwise stay general. */
const OPS_TOPIC_RE =
  /\b(?:iam|kms|vpc|cognito|s3|ec2|lambda|cloudwatch|guardduty|waf|tls|certificate|rotation|runbook|outage|deploy(?:ment)?|incident|firewall|security\s+group|\barn\b|aws|azure|gcp|oidc|oauth|mfa|encryption\s+at\s+rest)\b/i;

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

  if (CASUAL_TALK_RE.test(raw) || CASUAL_TALK_RE.test(body)) {
    return base("social", "casual-talk", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  if (CORRECTION_RE.test(raw) || CORRECTION_RE.test(body)) {
    return base("social", "user-correction", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  if (TOPIC_PERMISSION_RE.test(raw) || TOPIC_PERMISSION_RE.test(body)) {
    return base("social", "topic-permission", {
      responseStyle: "social",
      preferMicroTier: true,
    });
  }

  if (PROVENANCE_ASK_RE.test(raw) || PROVENANCE_ASK_RE.test(body)) {
    return base("general", "provenance-ask", {
      responseStyle: "concise_fact",
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
  if (
    body.length <= 64 &&
    /[?]\s*$/.test(body) &&
    OPS_TOPIC_RE.test(body)
  ) {
    return base("investigation", "short-ops-query", {
      shouldRetrieve: true,
      retrievalQuery: body,
      sourceScope: "workspace",
      requiresCitations: true,
      requiresWorkspaceEvidence: false,
      showSourcesUi: true,
      showGroundingBadge: true,
      responseStyle: "investigation",
    });
  }

  // Default: follow the user's topic. Retrieve only when the message looks ops-scoped.
  if (body.length >= 20) {
    if (OPS_TOPIC_RE.test(body) || OPS_TOPIC_RE.test(raw)) {
      return base("investigation", "default-ops-topic", {
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
    return base("general", "default-general", {
      responseStyle: "concise_fact",
    });
  }

  return base("ambiguous", "short-unclear", {
    responseStyle: "clarify",
    preferMicroTier: true,
  });
}

/** True when operational workspace framing should be added to the system prompt. */
export function needsOperationalPrompt(decision: TurnDecision): boolean {
  return (
    decision.shouldRetrieve ||
    decision.mode === "investigation" ||
    decision.mode === "workspace_grounded" ||
    decision.mode === "grounded_follow_up" ||
    (decision.mode === "attachment" && decision.sourceScope === "workspace")
  );
}

/** Mode-specific instructions appended to the system prompt (never includes reasonCode). */
export function modePromptInstructions(decision: TurnDecision): string {
  if (decision.reasonCode === "user-correction") {
    return (
      `\n\nResponse mode — correction acknowledgement:\n` +
      `- Acknowledge the correction in one or two short sentences.\n` +
      `- State the corrected understanding clearly.\n` +
      `- Do not defend the previous answer or append unsolicited extra facts.\n` +
      `- Do not treat your earlier reply as something the user said or as a source.\n` +
      `- Good: "You're right—I said it, not you. I shouldn't have treated my earlier answer as one of your memories."`
    );
  }

  if (decision.reasonCode === "provenance-ask") {
    return (
      `\n\nResponse mode — provenance honesty:\n` +
      `- If the prior answer used general knowledge, say so plainly.\n` +
      `- Do not invent a document, Memory, or "prior exchange" citation.\n` +
      `- Do not claim the user taught you the fact unless they actually stated it.\n` +
      `- Good: "That came from general model knowledge, not from your uploaded Knowledge or something you told me earlier."`
    );
  }

  if (decision.reasonCode === "topic-permission" || decision.reasonCode === "casual-talk") {
    return (
      `\n\nResponse mode — casual conversation:\n` +
      `- Follow the user's topic; do not redirect to cloud operations or the workspace.\n` +
      `- One or two natural sentences. No headings, Sources, or product pitch.\n` +
      `- If they want friendship/chat: warm and approachable without claiming to be a human friend or exclusive companion.\n` +
      `- Good: "Of course. What's on your mind?" / "That's completely fine—we can talk about that without connecting it to the workspace." / "I'm happy to chat with you in a relaxed way. What do you feel like talking about?"`
    );
  }

  switch (decision.responseStyle) {
    case "social":
      return (
        `\n\nResponse mode — conversational greeting or acknowledgement:\n` +
        `- Reply like a calm colleague: one short, natural sentence (two max).\n` +
        `- Do NOT narrate or diagnose the user's message.\n` +
        `- Do NOT mention documents, Knowledge, sources, cloud operations, or security topics unless they asked.\n` +
        `- Do not end with a forced "How can I help?" or workspace pitch.\n` +
        `- No headings, lists, or citations.\n` +
        `- Good: "Hey." / "You're welcome." / "Sounds good." / "Of course. What's on your mind?"`
      );
    case "clarify":
      return (
        `\n\nResponse mode — clarification:\n` +
        `- Ask one focused clarifying question.\n` +
        `- Do not speculate at length.`
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
          `- Answer the user's question directly from general model knowledge.\n` +
          `- Do not mention the workspace, cloud operations mission, or Knowledge unless asked.\n` +
          `- Do not imply the answer came from uploaded documents or user memory.\n` +
          `- Keep it to one to three short paragraphs unless they ask for more.\n` +
          `- Sometimes answer and stop — do not force a follow-up question.`
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
        `- Cite workspace evidence only when you use it.\n` +
        `- Match response length to the request; do not over-answer after a simple correction.`
      );
  }
}
