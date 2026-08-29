# SecureMind — Agent Rules

> Read this fully before writing any code. These rules are non-negotiable.

## What this project is
SecureMind is a **privacy-aware AI workspace** for models, Knowledge, memory, cost, and sensitive-data risk: client-side detection and replacement before chat sends, workspace memory, Knowledge retrieval with citations, and complexity-tier model routing. The core value is the **detection + memory + evidence layer**, not a companion chatbot UI.

Present sanitization as **risk reduction**, never as a guarantee of complete PII removal, security, or regulatory compliance. Avoid copy such as “PII-safe”, “fully secure”, “guaranteed redaction”, or “compliance-ready”. Users remain responsible for reviewing content and meeting their obligations.

It is a **single-user personal project**. Default auth is `AUTH_MODE=local`. Optional Floci Cognito is for local experiments only. Do not describe it as production-ready, multi-tenant, or compliant.

## Tech stack (exact versions matter)
- **Frontend**: Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API routes (runtime: nodejs — never edge)
- **ORM**: Prisma 7 — uses `@prisma/adapter-pg` + `pg` Pool. No `datasourceUrl` in constructor.
- **Database**: Local / on-prem default is Postgres + pgvector (Docker Compose). Hosted AWS default is DynamoDB + native vector search (`SearchVectors`, ADR 0007). Neon is an optional opt-in, not provisioned by default. Aurora is parked. Terraform lives in `infra/terraform/` (ADR 0008). Do not run `infra:up` until you intend to create sandbox/billable resources. See `docs/adr/0002-storage-choice.md` and `docs/adr/0007-hosted-dynamodb-vectors.md`.
- **AI inference**: Groq (primary, cloud), Ollama (local fallback), optional Bedrock via `src/lib/models/bedrock.ts`. Do not claim Bedrock is the default or production path unless credentials and a real model id are configured.
- **Hosting target**: Amplify Hosting for the UI; API Gateway REST + Lambda for APIs (response streaming for chat). Cognito invite-only (`infra/terraform/modules/auth_cognito`). Hosted data plane is DynamoDB (ADR 0007); Secrets Manager bootstrap holds table name/ARN + optional Groq. Admin Settings vendor keys stay in `InstanceConfig` — not SM. Local `npm run dev` keeps Postgres + same-origin `/api/*`; set `NEXT_PUBLIC_API_BASE_URL` only when pointing at a deployed API. Do not stream chat through Amplify Next routes. See `infra/README.md` and ADR 0008.
- **Testing**: Vitest. `npm test` must pass before any commit.

## Architecture rules

### Turn policy (Chat)
- Retrieval, citation UI, and response style are decided by `src/lib/turn-policy/decide-turn.ts` — not by scattered greeting regexes in the chat route.
- Follow the user's topic. The workspace scopes Knowledge access; it is not a conversational boundary.
- Social / general / app-help / provenance / correction turns must not retrieve workspace Knowledge or show Sources. Grounding is `not_applicable`.
- Workspace-grounded and investigation turns retrieve, apply `EVIDENCE_MIN_SIMILARITY` (0.5), and show only sources actually cited.
- The **workspace name** is the assistant speaker identity in chat (Companion-style). Product chrome stays SecureMind; default seed workspace is **Mindy Locke**.
- `reasonCode` is telemetry only — never put it in assistant-visible text.

### Prompt layers
- `buildConversationalBase()` applies every turn (natural, concise, no forced ops pitch).
- Operational grounding + workspace context apply only when `needsOperationalPrompt(turn)` is true.
- Do not inject workspace name/mission into social or general turns.

### Memory provenance
- Long-term workspace facts come only from user-authored statements (`/api/summarize`), never from assistant replies.
- Do not embed assistant messages as `MemoryFragment`. Semantic retrieval for citations is **document** category only.
- Conversation history is continuity, not a Sources entry. Never cite "prior exchange" or general model knowledge as documentary evidence.
- Provenance tags live in `src/lib/provenance.ts`.

### Provider credentials
- **Vendor API keys** (Groq, and stored-only Google/OpenAI/Anthropic/Azure) live in `InstanceConfig`, written only by an Admin through `/api/settings/providers`. Values are encrypted at rest (`smenc:v1:`) with `INSTANCE_ENCRYPTION_KEY` or `.data/instance.key`. Responses return a masked `…last4` hint — never the secret.
- **AWS credential material is never accepted through the UI and never stored in the database.** `src/lib/aws-credentials.ts` resolves it from the AWS SDK provider chain: env vars → shared profile / SSO → container role → instance role. A pasted AWS key is rejected with 422 at the route and again in `patchInstanceConfig`.
- Everything that is *not* a secret is app-managed in `InstanceConfig`: `awsProfile` (a pointer into `~/.aws`), `bedrockRegion`, and `allowRealAws`. `listAwsProfiles()` reads only section headers from the shared config — never credential values. Operators should not have to edit `.env.local` to use Bedrock.
- Billable AWS calls are off by default. The admin toggle governs; `ALLOW_REAL_AWS=false` in the environment is a hard kill switch that overrides it (`resolveAllowRealAws()`). `canUseBedrock()` is the single gate.
- `aws-credentials.ts` must not import from `@/lib/db` or `instance-config.ts` — callers pass settings in. Use `getInstanceAwsStatus()` / `instanceCanUseBedrock()` for the DB-backed variants.
- **Never read `process.env.AWS_ENDPOINT_URL` lazily.** Import `LOCAL_AWS_ENDPOINT` / `LOCAL_AWS_CREDENTIALS` from `src/lib/aws-endpoint.ts`, which snapshots them at module load. A client that reads the live variable during a `withRealAwsEndpoints()` window — `cognito.ts` memoizes its client on first use — permanently pins itself to real AWS and every login then fails with "user pool client does not exist".
- **Any AWS SDK client outside Cognito must be built inside `withRealAwsEndpoints()`.** A global `AWS_ENDPOINT_URL` (Floci sets one) is picked up implicitly by *every* SDK client: it breaks SSO credential resolution with an XML parse error and would silently route Bedrock traffic to `localhost:4566`. The helper hides that variable — and placeholder `test` keys — for the duration of the call, then restores them. Cognito reads its endpoint explicitly and is unaffected.
- Floci placeholder credentials (`test`) are hidden rather than treated as fatal, so a real profile still resolves on a Floci-configured host. `looksLikeFloci` means "placeholders present and nothing else resolved". Only `AWS_ENDPOINT_URL_BEDROCK` may redirect the Bedrock client.

### Model routing
- All model routing lives in `src/lib/models/router.ts`. Never hardcode model names anywhere else.
- A model id from the browser is a **preference, not an instruction**. `resolveAllowedModel()` in `src/lib/models/allowlist.ts` validates it against the router's own models plus the live text catalog; anything else is ignored and the router's choice stands. Never infer a provider from substrings in a client-supplied model id.
- Routing is by **complexity tier**, not by conversation topic. The five tiers are:
  **Max, Plus, Standard, Light, Micro** (most → least capable). `DEFAULT_TIER` is `Standard`. Legacy stored events map High → Max and Fast → Light.
- Tier selection is deterministic first (`src/lib/models/route-message.ts` scores the message), with an LLM tiebreak in `classifyMode()` in `groq.ts`. The tier list in that function's `VALID` array must stay in sync with `COMPLEXITY_TIERS` in `router.ts`.
- Tier controls **which model** handles a request. Workspace context shapes operational prompts only when the turn needs them — independent of tier.
- Vision requests auto-route to `meta-llama/llama-4-scout-17b-16e-instruct` via Groq.
- The Bedrock model list is **queried live** (`ListFoundationModels` + `ListInferenceProfiles` in `catalog.ts`), filtered to streaming-capable TEXT models with an `ACTIVE` lifecycle. Do not reintroduce a hardcoded catalog: Bedrock retires model versions, and a stale list offers models that fail at invoke time. `BEDROCK_TEXT_MODELS` is a minimal fallback for when the IAM list call is denied.
- Groq remains the complexity-tier default **when the operator has configured it** (env key locally, or Admin BYOK). Host `npm run dev` uses an already-installed Ollama chat model instead of failing or silently pulling weights. On-prem Docker (`docker compose up --build`) pulls allowlisted defaults (`nomic-embed-text`, `llama3.2:3b`) into the Compose Ollama volume on first boot — the running app still never pulls on a chat request. Hosted installs do not use a product-operated third-party LLM as a silent default — Bedrock (IAM) or Admin BYOK, otherwise the app runs without a model.
- Background tasks (summarize, extract) always use the cheapest model (`llama-3.1-8b-instant`). Embeddings use `nomic-embed-text` via Ollama.

### Database
- All DB access goes through `src/lib/db.ts` (Prisma singleton with PrismaPg adapter).
- Never instantiate `PrismaClient` directly outside of `src/lib/db.ts` and `prisma/seed.ts`.
- Migrations: `npx prisma migrate dev --name <description>`. Always confirm before running `migrate reset`.
- Schema lives in `prisma/schema.prisma`. Config in `prisma.config.ts` (uses `DIRECT_URL` for migrations).
- The `vector(768)` column cannot be expressed in Prisma. It is created by `scripts/add-vector-embedding.sql` and queried with raw SQL in `src/lib/memory.ts`. **Any raw SQL touching `MemoryFragment` must filter by `userId`** — it is the one place a tenant boundary can be crossed silently.

### Sensitive data
- Chat messages: detection runs **client-side** in `src/lib/pii.ts` before any message leaves the browser. The raw value never reaches the server, so the client is the only place that can catch it — but it is not the security boundary, because a crafted request can skip the browser entirely.
- **Instance security policy** (sensitivity + safe terms) is Admin-owned in `InstanceConfig` via `/api/settings/security` (ADR 0005). Knowledge ingest uses that policy server-side — never a client-supplied allowlist on the upload body. Members may propose; only Admin applies. Tier changes apply **going forward only** (new chat + new Knowledge ingest); stored messages/documents are never re-scanned. No restore of already-redacted values.
- A server-side re-scrub of already-sanitized chat text (defense-in-depth) is not implemented — do not describe it as shipped. Historical Knowledge re-scrub on policy change is intentionally not a product path.
- When anything is detected, the user sees a **pre-send review dialog**. There is no code path that transmits the unredacted text.
- Document uploads: the same patterns run **server-side at ingest** via `scrubDocumentText()` in `src/lib/documents.ts` — after text extraction, before DB persist or embedding. Images go through `src/lib/image-extract.ts` (Groq vision when available, filename stub otherwise); extracted text is scrubbed the same way.
- **There is no restore path, and none may be added.** Raw detected values are never written to the DB, `localStorage`, React state that outlives composition, logs, or model calls. A redaction record carries a category and sanitized context only.
- False positives are handled *before* detection, never after:
  - **Sensitivity tiers** (`low` / `balanced` / `high` / `extreme`) select which pattern families run.
  - **Safe terms** are user-declared exemptions (`cidr`, `domain`, `prefix`, `literal`) matched before detection.
- Categories in `NON_EXEMPTIBLE_CATEGORIES` (SSN, card number) can never be safe-listed. `validateSafeTerm()` enforces this — do not bypass it.
- Server-side ingest applies `DEFAULT_SAFE_TERMS` only. **Never accept a safe-terms list from the client** — the server must not take suppression instructions from the browser.

### Security
- `userId` comes from `getIdentity(req)` in `src/lib/identity.ts` and **nowhere else**. Never read a user or tenant identifier from a request body, query string, or client-settable header.
- Every query for a `Workspace`, `Session`, `Message`, `Document`, or `MemoryFragment` must be scoped by `userId`. Use `findFirst({ where: { id, userId } })` — never `findUnique({ where: { id } })` on a user-owned record.
- `WorkspaceFact` is owned through its workspace. Establish ownership via `Workspace` before reading facts.
- Return **404**, not 403, when a record exists but belongs to another user.
- API keys must never appear in code or commits. They live in `.env.local` only.
- `.env.local` is in `.gitignore`. `.env.example` is the one env file that is committed, and it contains no values.
- All API routes must use `export const runtime = "nodejs"` (never edge — Ollama needs localhost).

### Cost efficiency
- Most user-facing chat routes to mid or high tiers; trivial messages route to Micro.
- Never add AWS services unless explicitly requested — default to Groq + Neon.

## Testing
- `npm test` runs Vitest. New PII patterns require test cases in `src/lib/pii.test.ts`, including a false-positive case.
- Any new route that reads or writes user-owned data requires a cross-tenant test in `tests/authz.test.ts`.
- `tests/authz.test.ts` mocks `@/lib/db`, so authorization tests run without a database.

## File map
```
src/
  app/
    api/
      chat/route.ts           ← main chat endpoint, SSE streaming
      workspaces/route.ts         ← list/create workspaces
      workspaces/[id]/route.ts    ← get/patch/delete single workspace
      session/route.ts            ← load or create session for a workspace
      messages/route.ts           ← persist individual messages
      memory/route.ts             ← facts, summaries, memory stats
      memory/facts/[id]/route.ts  ← correct / pin / forget / delete a fact
      bookmarks/route.ts          ← server-persisted saved items
      documents/route.ts          ← list/upload documents
      documents/[id]/route.ts     ← get/delete single document
      documents/[id]/reprocess/route.ts ← retry extract + embed from stored original
      documents/[id]/original/route.ts  ← download stored original (owner only)
      documents/[id]/analyze/route.ts   ← constrained spreadsheet query
      summarize/route.ts          ← background memory summarization
      models/catalog/route.ts     ← live model catalog across providers
      models/test/route.ts        ← admin-only per-model reachability check
      models/ollama/pull/route.ts ← admin-initiated allowlisted Ollama pull (never automatic)
      runtime/status/route.ts     ← first-run dependency status (no catalog stampede)
      me/profile/route.ts         ← self GET/PATCH UserProfile (+ workspace brief list)
      me/security/route.ts        ← self security metadata (auth mode, password availability)
      auth/change-password/route.ts ← Cognito ChangePassword (clears session cookie)
      auth/forgot-password/route.ts ← Cognito ForgotPassword (enumeration-safe)
      auth/confirm-forgot-password/route.ts ← Cognito ConfirmForgotPassword
  lib/
    db.ts                     ← Prisma singleton (PrismaPg adapter)
    identity.ts               ← getIdentity(req) — the only source of userId
    roles.ts                  ← requireAdmin
    user-profile.ts           ← UserProfile upsert/patch; soft status; handle validation
    avatar-presets.ts         ← curated avatar ids only (no upload/S3)
    aws-credentials.ts        ← AWS SDK credential chain + ALLOW_REAL_AWS gate
    instance-config.ts        ← Admin provider settings (never AWS creds; vendor keys encrypted at rest)
    secret-at-rest.ts         ← AES-256-GCM for UI-entered vendor keys
    document-storage.ts       ← local original-file store (not Postgres)
    spreadsheet/              ← xlsx/csv extract, sheet provenance, constrained query
    storage/                  ← Knowledge / Memory / Vector contracts; Postgres + DynamoDB vector adapters
    provider-key-detect.ts    ← vendor detection for pasted keys; rejects AWS
    pii.ts                    ← detection, sensitivity tiers, safe terms, secrets
    pii.test.ts               ← detection + no-leak test suite
    evidence.ts               ← citation packaging + insufficient-evidence prompts
    citation-audit.ts         ← post-answer [n] coverage / invalid-index checks
    prompt-guard.ts           ← injection neutralization + evidence fencing
    memory.ts                 ← fragment storage + semantic retrieval
    documents.ts              ← extraction, server-side scrub, chunking
    image-extract.ts          ← Groq vision → searchable text for image Knowledge
    tokens.ts                 ← token estimation + working memory selection
    models/
      types.ts                ← shared types (ChatMessage, ModelConfig, etc.)
      router.ts               ← complexity-tier model routing
      allowlist.ts            ← server-side allowlist for client model preferences
      catalog.ts              ← text model catalog per configured credential
      route-message.ts        ← deterministic complexity scoring
      resolve-chat-runtime.ts ← first-run / no-LLM gate (no silent pull, no product Groq)
      local-recommendations.ts ← Ollama tag suggestions from installed models + hardware
      runtime-status.ts       ← detection/parsing/provider status payload
      provider.ts             ← unified streamChat (Groq / Ollama / Bedrock)
      ollama.ts               ← Ollama streaming provider
      groq.ts                 ← Groq streaming provider + tier classifier
      bedrock.ts              ← optional Bedrock ConverseStream adapter
  components/
    app/
      app-shell.tsx           ← main UI: sidebar, chat, intel panel, composer
      model-catalog.tsx       ← shared model list, provider badges, test runner
      inference-settings.tsx  ← credentials, Bedrock config, model picker
      workspace-editor.tsx    ← name, description, operational context
      settings-hub.tsx        ← settings, sensitivity, safe terms, appearance, My Profile
      profile-settings.tsx    ← My Profile panel (presets, prefs, Cognito password)
      admin-console.tsx       ← Admin directory; soft-delete / suspend / password reset
      appearance-settings.tsx ← dark/light theme selector
      theme-provider.tsx      ← client theme context (pairs with src/lib/theme.ts)
tests/
  authz.test.ts               ← cross-tenant authorization tests
  profile-auth.test.ts        ← profile PATCH bans, forgot-password, presets/handles
prisma/
  schema.prisma               ← DB schema (Workspace, Session, Message, UserProfile, etc.)
  seed.ts                     ← seed script
scripts/
  add-vector-embedding.sql    ← creates the pgvector column (manual step)
docs/adr/                     ← architecture decision records
```

## What NOT to do
- Never add an AWS access key or secret field to the UI, the API, or the database.
- Never let a client-supplied model id reach a provider without `resolveAllowedModel()`.
- Never add a route that calls an external provider without `getIdentity(req)` first.
- Never add a way to restore, reveal, or transmit a redacted value.
- Never persist a raw detected value to the DB, `localStorage`, or a log.
- Never read `userId` from a request. Always use `getIdentity(req)`.
- Never use `findUnique` on a user-owned record without a subsequent ownership check.
- Never accept a client-supplied safe-terms or allowlist payload server-side.
- Never run `prisma migrate reset` without explicit user confirmation.
- Never use `export const runtime = "edge"` on any API route.
- Never commit `.env.local`, `.env`, or any file containing API keys.
- Never use `datasourceUrl` in the `PrismaClient` constructor — use the PrismaPg adapter instead.
- Never claim KMS, Macie, or hosted production Cognito as product features. Floci Cognito login UI and optional Bedrock streaming exist for local/lab use only.
- Never describe conversation "modes" as driving model choice — complexity tiers do.
- Never reintroduce companion personalities, trait sliders, or a restore path for redacted values.

## Current status
- **Working**: Chat with streaming, complexity-tier routing, client-side redaction with pre-send review, sensitivity tiers, safe terms, hard-blocked secret detection, prompt-injection fencing for retrieved evidence, layered memory, Knowledge ingest (text/PDF/code + image vision extract when Groq is set), chat attachments into Knowledge, citations + citation audit, insufficient-evidence prompting, multi-workspace UI, Insights rail (Security/Usage/Cost), optional Bedrock adapter, Floci Cognito login (cookie session), My Profile (preset avatars, prefs, Cognito change/forgot password), Admin soft-delete/suspend/password-reset, Docker Compose on-prem stack (Postgres + Floci + Ollama; first boot pulls `nomic-embed-text` + `llama3.2:3b`), GitHub Actions CI, DynamoDB vector adapter PoC (in-memory / Floci cosine fallback; `STORAGE_BACKEND=dynamodb` opt-in), first-run runtime status (host inspect-before-pull; Docker init pulls defaults; hosted no silent third-party LLM), synthetic document regression corpus under `documents/`.
- **Not implemented / not claimed**: LLM-as-judge claim verification, KMS/Macie, real AWS Cognito as a hosted product path, production multi-tenant auth, hard user data purge, custom avatar upload/S3, server-side re-scrub of chat text, model output scanning, per-workspace external-provider policy, Bedrock Guardrails. Hosted DynamoDB Terraform exists but is **not applied to a real AWS account** until you run bootstrap + `infra:up` / Actions against sandbox. Chat/workspaces/settings still use Prisma in code. Default without Cognito env remains `AUTH_MODE=local`. `npm run dev` stays on Postgres unless `STORAGE_BACKEND=dynamodb`.
