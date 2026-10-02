# SecureMind — technical source brief

Status: engineering notes for a later professional document. Date: 2026-09-26.
This is not marketing copy and not a compliance claim. A later writer should keep the limits in the first section.

## How to use this

Treat this file as the source of truth for product behavior. Do not invent features, guarantees, or services that are not listed. If a sentence would say “PII-safe”, “fully secure”, “guaranteed redaction”, “compliance-ready”, “production multi-tenant”, or “KMS / Macie”, delete it. Detection is risk reduction. The operator remains responsible for what they send and for their own obligations.

Two editions exist. Do not describe one as the other.

| Edition | What runs | Data store |
|---|---|---|
| Local / on-prem | Docker Compose, or `npm run dev` | Postgres 16 + pgvector |
| Hosted AWS | Amplify (UI and most routes) + API Gateway + Lambda (chat stream, warm) | DynamoDB + native vector index |

Neon and Aurora are not current product options. They may return later as an all-SQL install. They are not mixed with DynamoDB.

## What the product is

SecureMind is a single-operator AI workspace. The useful layer is detection before send, workspace memory, Knowledge with citations, complexity-tier model choice, and a visible estimate of spend and detected-risk. It is not a companion chatbot and not a shared company tenant.

Default local auth is `AUTH_MODE=local`. Docker on-prem uses Floci as a local stand-in for Cognito (`AUTH_MODE=cognito` against `localhost:4566`). Hosted auth is an invite-only Cognito user pool (email username, groups Owner / Admin / Member). `userId` comes only from the server session (`getIdentity`). A record that belongs to someone else is returned as 404.

The product name in the chrome is SecureMind. The name shown as the assistant in a chat is the **workspace name**. The seeded workspace is “Mindy Locke”. That name is a label for a boundary, not a personality.

## Workspaces

A workspace is the boundary for chat history, Knowledge documents, extracted facts, and memory fragments. Nothing is retrieved across workspaces. The sidebar emoji and color are visual identity only (`Workspace.emoji`, default 🛡️). They are not a mood, a trait, or a model setting.

Each workspace can store:

- A short description and an operational `context` string. That context is added to the prompt only when the turn actually needs operational grounding. Social and general turns do not receive the workspace name or mission.
- An optional fixed model (`modelOverride`). Null means complexity-tier routing.
- Sessions (one continuous thread), messages, a rolling session summary, user-authored facts, documents, and saved items.

Why it is set up this way: one shared chat would mix runbooks, personal notes, and facts from unrelated work. Scoping retrieval and facts to the workspace the user has open is the isolation mechanism. It is not a second user account. One signed-in user can own many workspaces.

Switching workspace clears the outbound message queue and loads that workspace’s session.

## Chat

Chat is a streaming turn. The browser prepares the message. The server decides retrieval, prompt layers, model, and what may be cited.

Order of a send:

1. The composer stays usable while a reply is still generating. A follow-up can be typed and queued. The queue holds the already-reviewed sanitized payload, including a snapshot of attachments. Stop aborts the in-flight reply; the queue then drains. The queue clears on workspace switch.
2. Client-side detection runs on the draft (`scrubPII`) before the text leaves the browser. If anything matches, a review dialog opens. There is no path that sends the unredacted draft from the normal UI. A crafted request can skip the browser, so the client is not a security boundary.
3. The server classifies the turn (`decideTurn` in `src/lib/turn-policy/decide-turn.ts`). That decision controls retrieval and citations. It does not choose the model.
4. Complexity scoring (`route-message.ts`) chooses a tier. An optional Groq classifier breaks ties. A browser-supplied model id is a preference. `resolveAllowedModel()` keeps it only if it is on the server allowlist. Otherwise the router’s choice stands.
5. The reply streams. Chat on the hosted stack is POST `/chat` through API Gateway to the chat Lambda (response streaming). Other hosted routes run on Amplify compute. Locally, UI and API are the same Next.js process on port 3000.
6. The stored message is the sanitized text. Raw detected values are not written to the database, localStorage, logs, or the model call. There is no restore path, and none may be added.

Prompt layers:

- `buildConversationalBase()` applies on every turn: natural, concise, no forced operations pitch.
- Operational grounding and workspace context apply only when `needsOperationalPrompt(turn)` is true (retrieval, investigation, workspace-grounded, grounded follow-up, attachment).
- `reasonCode` is telemetry. It is never shown to the user as assistant text.

Turn kinds (deterministic, before retrieval):

- Social, app-help, provenance questions, and user corrections do not search Knowledge and do not show Sources. Grounding is not applicable.
- A general question may silent-search Knowledge. A hit at similarity 0.5 (`EVIDENCE_MIN_SIMILARITY`) upgrades the turn and shows Sources. A miss stays general with no Sources.
- Workspace-grounded and investigation turns retrieve, apply the same 0.5 floor, and show only sources the answer actually cited.
- Attachments are read in the turn. Comparing an attachment to workspace Knowledge is the case that also retrieves.
- Short unclear turns prefer the Micro tier and ask for clarification.
- Vision attachments route to `meta-llama/llama-4-scout-17b-16e-instruct` on Groq when that path is available.

Citations are documentary. Conversation history is continuity, not a Source. The assistant’s own earlier replies are not stored as memory facts. Long-term facts come only from user-authored statements (`/api/summarize`). Semantic retrieval for citations is the document category only.

Background summarize and extract use the cheapest model (`llama-3.1-8b-instant` when Groq is configured). Embeddings on-prem use `nomic-embed-text` via Ollama (768 dimensions). Hosted embeddings target Bedrock Titan v2 (1024 dimensions), locked when the DynamoDB vector index is created.

## Complexity tiers

Tier chooses **which model** runs the turn. It does not change the prompt personality. Five tiers, most capable to least:

| Tier | Default model (Groq list) | Role |
|---|---|---|
| Max | `llama-3.3-70b-versatile` | Hardest / deep technical |
| Plus | `qwen/qwen3-32b` | Planning and analysis |
| Standard | `openai/gpt-oss-120b` | Default |
| Light | `meta-llama/llama-4-scout-17b-16e-instruct` | Short factual / how-to |
| Micro | `llama-3.1-8b-instant` | Acknowledgements and one-line replies |

Legacy stored names map High → Max and Fast → Light. The operator can assign a different model to a tier in Settings. The assignment is kept only if that model is allowed to run (it has passed Enable, or it is an installed Ollama chat model). A fixed model on the workspace bypasses tier selection for that workspace.

Scoring is local first: trivial text → Micro; intent score → a tier; a short follow-up can stick to the previous deeper tier. A narrow ambiguous band may call the Groq classifier. If Groq is not configured, host `npm run dev` uses an installed Ollama chat model instead of failing or pulling weights. Docker’s first boot pulls `llama3.2:3b` and `nomic-embed-text` into the Ollama volume. The running app does not pull a model on a chat request.

## Models, APIs, and defaults

Providers the chat path can call:

- **Groq** — default cloud path for the five tiers when an Admin key is stored (or present in env locally). Also used for background tasks, optional vision extract, and optional Whisper.
- **Ollama** — local chat fallback and embeddings. Installed models can appear in chat without a cloud-style test.
- **Amazon Bedrock** — optional. Credentials are never pasted into Settings and never stored in the database. The AWS SDK chain is used: environment variables, a shared profile / SSO (`awsProfile` is only a pointer into `~/.aws`), container role, or instance role. `ALLOW_REAL_AWS=false` is a hard kill switch. The Admin toggle cannot override that. `canUseBedrock()` is the gate. Billable calls are off until that gate is open. A pasted AWS access key is rejected (422).
- **Vendor keys** (Google Gemini, OpenAI, Anthropic, and stored-only others) live in Admin instance config, encrypted at rest (`smenc:v1:`). The API returns a masked last-4 hint, never the secret. Azure chat is not wired. xAI is not a tested path.

A model listed from a key is not in the chat menu until it has answered once. Settings calls that check **Enable**. Success stores a verification (about 7 days) and the model moves into the chat list. Failure leaves it under “Not in chat yet” with the reason (quota, billing, or Bedrock account enablement). **Check access** runs that check across a vendor’s list. Models already in chat show **Test** for a later recheck. Bedrock models that still need to be turned on in the AWS console stay out; that console step is separate from Enable.

Hosted chat does not use a product-operated third-party key as a silent default. Bedrock (IAM) or an Admin key, otherwise the hosted app runs without a model.

## Transcription

Voice is off until the operator picks a backend and acknowledges that **audio leaves the machine before any text detection**. Detection runs on the resulting text at send time, the same as typed text.

Two backends:

- **Groq Whisper** — audio is posted to Groq. Local and hosted. While the mic is open, the growing recording is transcribed in chunks for a preview.
- **Amazon Transcribe** — streaming PCM on hosted Chromium when the Amplify role may call `transcribe:StartStreamTranscription`. Billed on the operator’s AWS account, same gate as Bedrock. The final pass on Done can differ slightly from the live preview.

The composer inserts the final transcript at the cursor. The user still reviews and sends. Nothing in the audio path restores or stores the raw waveform as a chat message.

## Emoji — three separate uses

Do not collapse these into one feature.

1. **Workspace mark.** Each workspace has an emoji (and a color) so the sidebar can tell workspaces apart. It is not sent to the model as a personality.
2. **Composer insert.** The smiley opens `emoji-picker-react` and inserts the chosen character into the draft. It is ordinary message text. It is not a reaction, a command, or a tier signal.
3. **Saved items.** A bookmark can show emoji that were extracted from the saved preview, so a saved line is recognizable in the list.

Profile avatars are a fourth, unrelated set: preset glyphs, or a cropped JPEG/PNG stored on local disk or in the private avatar bucket and served only through `/api/me/avatar`.

## Detection

Detection is a pattern scan, not a model and not a guarantee. Chat runs it in the browser before send. Knowledge ingest runs the same families on the server after text extraction and before the text is stored or embedded (`scrubDocumentText`). Images are extracted first (Groq vision when a key exists, otherwise a filename stub) and that text is scanned the same way.

Sensitivity selects which families run. Stored `extreme` maps to `high`. Default is balanced.

| Family | Runs from | Safe-term allowed |
|---|---|---|
| Email | Low | Yes |
| US SSN (3-2-4) | Low | No |
| Canadian SIN (checksum) | Low | No |
| Card number (Luhn) | Low | No |
| API keys and private keys | Low | No |
| Phone (NANP-shaped) | Balanced | Yes |
| IPv4 | Balanced | Yes |
| Street address | Balanced | Yes |
| Passport-like / national-ID shape | High | Yes |

Safe terms are exemptions declared before detection: CIDR, domain, prefix, or literal. They cannot exempt SSN, SIN, card number, or secret. The server never accepts a safe-term list from the browser on ingest. Instance policy is Admin-owned. Members may propose; only an Admin applies it. A tier change applies to new chat and new Knowledge only. Stored messages and documents are not re-scanned. Already-redacted values are not restored.

What is recorded for Insights is the category, the source (chat or document), the outcome, a count, and the sensitivity in force. The matched string is not recorded.

What is not implemented: a second server scrub of chat text that already left the browser, scanning the model’s output, Bedrock Guardrails, and historical re-scrub when policy changes.

## Knowledge and memory

Knowledge is documents the user adds (upload, or a chat attachment saved into the workspace). Text, PDF, and code are extracted; spreadsheets can be queried in a constrained way. Original files stay in a local store or, hosted, are not the Postgres blob. Chunks are embedded and retrieved only inside that workspace, above similarity 0.5.

Memory has two layers:

- Working context: recent messages and a session summary. This is continuity. It is not a citation.
- Long-term facts: only from what the user wrote. The user can correct, pin, or forget a fact. Assistant replies are not embedded as facts.

Prompt-injection text inside retrieved evidence is fenced. A citation audit checks that `[n]` markers in the answer point at sources that were actually packed.

## Insights

Three views, per account, filterable by workspace and time range. An Admin can look at another user. The views do not contain raw prompts or raw detected values.

**Security.** Counts of detection events by category, source, and outcome, with a coarse risk level derived from the category. This is “what the scanner flagged”, not a finding that data left the system, and not a compliance score.

**Usage.** Inference events: which model and tier ran, token counts, grounding status, success or failure. This is how the tier system shows up after the fact.

**Cost.** Each inference event stores an estimate: recorded input/output tokens × a curated list rate. Groq and Bedrock on-demand tables are in the repo. Ollama is $0. Unknown cloud models use a floor at the Max-tier Groq list rate so a missing price cannot hide spend. A +10% uplift is applied and the result is rounded up to $0.0001. Admins can override rates; overrides apply to new turns only. The figure is not an invoice. AWS Cost Explorer is not queried. A cost cap can warn at 50% and 80% and block at the cap; the cap uses the same estimate.

Savings shown in the product are the difference between the tier that ran and a baseline of always using the Max-priced model. That is an illustration of routing, not money refunded.

## Data and connections

Local path:

Browser → Next.js on :3000 → Postgres (workspaces, messages, documents, facts, analytics) and pgvector (embeddings). Sign-in in Docker goes to Floci. Chat and embeddings go to Ollama on :11434. Optional Bedrock uses the mounted AWS profile. Optional Groq and other vendors use the stored key. Uploads, avatars, and the instance encryption key are files under `/data`.

Hosted path:

Browser → Amplify (WEB_COMPUTE) for the UI, sign-in, workspaces, settings, and non-chat APIs. Chat stream and warm go to API Gateway REST stage `prod`, then two Lambdas (arm64; chat is the long streaming function). Amplify and the chat Lambda both use the DynamoDB fragments table (app records on Amplify; vector search on the chat path). Cognito is the user pool. Secrets Manager holds the table name, vendor keys, and an optional bootstrap Groq key. Profile photos are a private S3 bucket. CloudWatch holds Lambda logs (14 days) and a Bedrock metrics dashboard. Prompt and response content logging is not turned on by that dashboard.

CI on `main`: GitHub Actions runs tests, assumes an OIDC role, Terraform-applies the sandbox (when the role and state bucket are configured), and starts an Amplify release job. State is an S3 bucket. The lock is an object in that same bucket. Pull requests plan only.

There is no custom VPC. These are regional managed services.

## Explicitly absent

LLM-as-judge verification of claims. KMS and Macie as product features. A public avatar URL. Hard purge of user data. Per-workspace provider policy. Server-side re-scrub of chat. Output scanning. Aurora or Neon as the hosted database. A pasted AWS access key. A product-owned Groq key on the hosted install.

## Suggested shape for the professional document

Audience: a technical reader who will operate or review the system, not a sales page.

Write each section as four short parts: what it is for, how it works, what data moves, what it does not do. Keep deployment (on-prem vs AWS) in its own section so product behavior is not mixed with Terraform.

Recommended order:

1. Purpose and limits
2. Account, identity, and workspaces
3. Chat, turn policy, and citations
4. Complexity tiers and model admission (Enable)
5. Providers: Groq, Ollama, Bedrock, other vendor keys
6. Voice transcription
7. Emoji, stated as the three uses above
8. Detection: families, tiers, safe terms, what is stored
9. Knowledge and memory
10. Insights: security, usage, cost method
11. Data stores and the two deployment shapes
12. What is intentionally not built

Do not paste detection regexes into the public document. Name the check (Luhn, SIN checksum, known key prefixes) and the reason (false positives on IDs and log lines).
