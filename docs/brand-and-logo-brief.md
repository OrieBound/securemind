# SecureMind — product summary and logo brief

Use this document as a stand-alone briefing for design, branding, or another AI. It is not a security or compliance claim.

## What it is

SecureMind is a **privacy-aware AI workspace** for models, Knowledge, memory, cost, and sensitive-data risk.

It is **not** a companion chatbot skin. The product value is the **detection + memory + evidence** layer: catch risky values before they leave the browser, keep workspace memory, retrieve Knowledge with citations, and route models by complexity.

Sanitization is **risk reduction**, never a guarantee of complete PII removal, security, or regulatory compliance. The user still reviews content and owns their obligations.

It is a **single-user personal project** with optional invite-only admin users. Default local auth is `AUTH_MODE=local`. Cognito (Floci locally, hosted pool in the cloud) is for directory/sign-in experiments and hosted installs — not a production multi-tenant SaaS claim.

**Positioning line (canonical):**  
A privacy-aware AI workspace for managing models, knowledge, memory, cost, and sensitive-data risk.

**Chrome tagline:** Privacy-aware workspace

## Problems it addresses

- Secrets, account numbers, and other sensitive strings accidentally pasted into chat or uploaded into Knowledge
- Answers that sound grounded but are not tied to retrieved documents
- No durable workspace memory of what the *user* has stated
- Opaque model spend and no per-user caps
- No simple admin path to add people, set a password they can actually use, or turn off sign-in

## What it does not claim

- Not “PII-safe,” “fully secure,” “guaranteed redaction,” or “compliance-ready”
- No restore path for redacted values (raw detected values are never stored)
- No LLM-as-judge claim verification, KMS/Macie, or hosted production multi-tenant auth as product features

## Product surfaces (what a user sees)

| Surface | Role |
|---|---|
| **Workspaces** | Named rooms. The assistant speaks as the workspace (Companion-style). Product chrome stays “SecureMind.” Default seed workspace: **Mindy Locke**. |
| **Chat** | Streaming conversation. Client-side detection + pre-send review before anything leaves the browser. Complexity-tier routing (Max → Micro), not “topic modes.” |
| **Knowledge** | Document library (text, PDF, code, images). Server-side scrub at ingest. Retrieval + citations when the turn policy says so. |
| **Memory** | Long-term facts from **user-authored** statements only — never from assistant replies. Conversation history is continuity, not a Sources entry. |
| **Bookmarks** | Lines bookmarked from chat. |
| **Insights** | Security, Usage, and Cost (sanitized telemetry). |
| **Settings** | Profile, appearance, sensitivity / safe terms (Admin-owned instance policy). |
| **Admin console** | Directory, roles, monthly cost caps, add user, set password, delete (disables sign-in; data retained until a future purge). |

## How a typical turn works

1. User composes in Chat. Detection runs **in the browser**. Hits open a review dialog; unredacted text is not the send path.
2. Turn policy decides whether to search Knowledge, show Sources, or stay social/general.
3. If retrieval happens, only fragments above similarity threshold can become citations. Prompt-injection fencing wraps evidence.
4. Model is chosen by **complexity tier**, not conversation topic. A client-supplied model id is a preference, validated against an allowlist.
5. Cost and detection events feed Insights. Admin can cap monthly spend per user.

## Stack (short)

- Frontend: Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui
- API: Next.js routes, Node runtime (never Edge)
- Local data: Postgres + pgvector
- Hosted data: DynamoDB + native vector search (not the default for `npm run dev`)
- Inference: Groq (when configured), Ollama local fallback, optional Bedrock
- Auth: local, or Cognito (Floci on localhost vs a real pool on Amplify)

Local and hosted are **different environments** (different databases, different Cognito pools). Users created on localhost do not exist on Amplify.

## Visual language already in the UI

- Dark theme is the **default**; light theme exists
- Brand indigo `#5B3FE0` → violet (`from-indigo-500 to-violet-600` on the current header tile)
- Deep charcoal background, muted grey chrome, purple selection
- Workspace rows already use a **shield**; Memory already uses a **brain**
- Current header mark: 40×40 rounded square, white **“SM”** on that gradient — placeholder only

## Logo constraints (for a designer or image model)

**Job:** replace the “SM” tile. App icon / favicon, not a wordmark.

- Size: must read at **32–40px** (sidebar) and as a favicon
- Shape: rounded square preferred (matches the current tile); circle is an alternate
- Combine **protect** (shield) with **mind / network** (geometric nodes — not a cartoon brain, not anatomy)
- No letters, no “SM”, no padlock cliché, no “HIPAA / compliant / fully secure” badge
- Dark: gradient tile + optional soft violet glow on near-black
- Light: same geometry, slightly deeper purple, no glow
- Palette: indigo `#5B3FE0` / `#6366F1` → violet `#7C3AED`; glyph white

**Recommended mark:** rounded square, white shield, three connected nodes inside.  
**Alternate:** circular disc, head profile with a shield as the “mind.” Better large; muddier as a favicon.

## Files generated in chat (not in git unless copied)

Cursor chat dumps live outside the repo. Product chrome images belong in git under `public/brand/` and are served as `/brand/...`. The current mark is `public/brand/securemind-logo.png` (sidebar + favicon). `src/app/icon.png` is the same file so Next.js can emit the tab icon.
