/**
 * Routing fixtures: messages with the tier a person would expect, run in CI
 * (route-message.test.ts) and by `npm run route-eval`.
 *
 * Add a fixture whenever a real message lands on the wrong tier. `evidence` simulates the
 * post-retrieval phase (documents found, or a file attached). `why` says what it protects.
 */

import {
  applyEvidenceFloors,
  routeMessageSync,
  type RouteHistoryMessage,
} from "./route-message";
import type { RouteScoreCard } from "./route-scorecard";

export type RouteFixture = {
  id: string;
  message: string;
  expect: string;
  history?: RouteHistoryMessage[];
  lastTier?: string;
  /** Present when the turn answers from documents (phase 2). */
  evidence?: { passages: number; documents: number; attachmentChars?: number };
  why?: string;
};

export const ROUTE_FIXTURES: RouteFixture[] = [
  // Micro: acknowledgements and greetings only
  { id: "ack-thanks", message: "thanks!", expect: "Micro" },
  { id: "ack-ok", message: "ok cool", expect: "Micro" },
  { id: "ack-lol", message: "lol", expect: "Micro" },
  { id: "ack-hi", message: "hey", expect: "Micro" },
  { id: "greet-filler", message: "Hello there sir!", expect: "Micro" },
  {
    id: "greet-real-question",
    message: "hey there how are you",
    expect: "Standard",
    why: "a greeting followed by a real question is conversation, not an acknowledgement",
  },
  {
    id: "greet-again",
    message: "Hello again",
    expect: "Standard",
    why: "a returning-conversation greeting stays on Standard",
  },

  // Light: a single fact or a simple how-to
  { id: "fact-who", message: "who invented the telephone?", expect: "Light" },
  { id: "fact-capital", message: "capital of France", expect: "Light" },
  { id: "fact-when", message: "when was the moon landing", expect: "Light" },
  { id: "fact-no-docs", message: "What is the capital of Canada?", expect: "Light" },
  { id: "howto-egg", message: "how do I boil an egg properly without cracking it", expect: "Light" },
  { id: "howto-rest", message: "what is a REST API — explain in simple terms please", expect: "Light" },
  { id: "chat-short", message: "that's wild honestly", expect: "Light" },

  // Standard: everyday conversation
  { id: "chat-day", message: "how's your day going?", expect: "Standard" },
  { id: "chat-day-is", message: "How is your day going?", expect: "Standard" },
  { id: "chat-feel", message: "I've been feeling kind of down lately, nothing specific", expect: "Standard" },
  { id: "chat-opinion", message: "what do you think about people who ghost their friends", expect: "Standard" },
  { id: "chat-fun", message: "tell me something random that made you smile recently", expect: "Standard" },
  {
    id: "prose-parentheses",
    message: "I think (maybe) we should meet tomorrow (or Friday) to talk about the budget for the trip",
    expect: "Standard",
    why: "ordinary parentheses are not code",
  },

  // Plus: planning, comparing, advice
  { id: "plan-job", message: "help me think through whether I should quit my job this year", expect: "Plus" },
  { id: "plan-learn", message: "what's the best approach for learning Spanish in six months", expect: "Plus" },
  { id: "plan-pros", message: "pros and cons of renting vs buying in this market", expect: "Plus" },
  { id: "plan-decide", message: "how should I decide between two job offers with very different cultures", expect: "Plus" },

  // Max: technical depth
  {
    id: "tech-debug",
    message: "why does this async function hang forever when I await fetch inside useEffect?",
    expect: "Max",
  },
  {
    id: "tech-code",
    message: "```js\nuseEffect(() => {\n  fetch('/api').then(r => setData(r));\n}, []);\n```\nwhat's wrong here?",
    expect: "Max",
  },
  { id: "tech-arch", message: "help me debug this race condition in my Prisma transaction code", expect: "Max" },
  {
    id: "max-design",
    message: "design a complete multi-tenant auth system with SSO, row-level security, and audit logs",
    expect: "Max",
  },

  // Carry-over: a short follow-up inherits the last tier, one level lower per turn
  {
    id: "carry-max-to-plus",
    message: "what about Redis?",
    expect: "Plus",
    lastTier: "Max",
    why: "follow-up to a Max reply carries Max minus one level",
  },
  {
    id: "carry-plus-to-standard",
    message: "and the budget angle?",
    expect: "Standard",
    lastTier: "Plus",
    why: "decays again: Plus carries Standard",
  },
  {
    id: "carry-none-below-plus",
    message: "what about Redis?",
    expect: "Light",
    lastTier: "Standard",
    why: "only Plus and Max carry",
  },
  {
    id: "carry-blocked-by-fact",
    message: "who invented the telephone?",
    expect: "Light",
    lastTier: "Max",
    why: "a fresh single-fact question does not inherit a technical thread",
  },
  {
    id: "carry-ignores-keywords",
    message: "what about Redis?",
    expect: "Light",
    history: [
      { role: "user", content: "my API keeps timing out under load, debug the async code" },
      { role: "assistant", content: "sounds like you need caching or a queue" },
    ],
    why: "technical words in earlier messages no longer force Max without a tier to carry",
  },

  // Attachments and documents (phase 2 floors)
  {
    id: "attach-no-instruction",
    message: "Please review the attached file(s).",
    expect: "Standard",
    evidence: { passages: 0, documents: 0, attachmentChars: 2400 },
    why: "the canned attachment ask was scored as code and sent to Max",
  },
  {
    id: "attach-summarize",
    message: "summarize this",
    expect: "Plus",
    evidence: { passages: 0, documents: 0, attachmentChars: 3000 },
    why: "summarizing a document is analysis, not a one-liner",
  },
  {
    id: "doc-lookup",
    message: "What is the notice period in the tenancy agreement?",
    expect: "Standard",
    evidence: { passages: 2, documents: 1 },
    why: "reads like a how-to (Light) but must be answered from the document",
  },
  {
    id: "doc-terse",
    message: "notice period?",
    expect: "Standard",
    evidence: { passages: 2, documents: 1 },
    why: "a terse document lookup",
  },
  {
    id: "doc-followup",
    message: "who signs it?",
    expect: "Standard",
    evidence: { passages: 1, documents: 1 },
  },
  {
    id: "doc-summarize-risks",
    message: "Summarize the tenancy agreement and list any risks for the tenant.",
    expect: "Plus",
    evidence: { passages: 3, documents: 1 },
  },
  {
    id: "doc-compare",
    message: "Compare the utility invoice and the tenancy agreement for billing differences.",
    expect: "Plus",
    evidence: { passages: 4, documents: 2 },
  },
  {
    id: "doc-three-documents",
    message: "What do these say about parking?",
    expect: "Plus",
    evidence: { passages: 3, documents: 3 },
    why: "drawing on three or more documents",
  },
  {
    id: "doc-not-lowered",
    message: "help me think through whether to renew the lease in the agreement",
    expect: "Plus",
    evidence: { passages: 2, documents: 1 },
    why: "a floor never lowers a tier",
  },
];

/** Run one fixture through both phases and return the final score card. */
export function runFixture(f: RouteFixture): RouteScoreCard {
  const sync = routeMessageSync({ message: f.message, history: f.history, lastTier: f.lastTier });
  if (!f.evidence) return sync.card;
  return applyEvidenceFloors(sync.card, {
    message: f.message,
    evidencePassages: f.evidence.passages,
    evidenceDocuments: f.evidence.documents,
    attachmentChars: f.evidence.attachmentChars ?? 0,
  });
}
