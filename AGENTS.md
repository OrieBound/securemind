# SecureMind — Agent Rules

> Read this fully before writing any code. These rules are non-negotiable.

## What this project is
SecureMind is a privacy-first AI workspace with persistent memory and client-side sensitive-data redaction. The core value is the **redaction + memory + routing layer**, not the chat UI.

It is currently a **single-user personal project**. Authentication is not implemented. Do not describe it as production-ready, multi-tenant, or compliant.

## Tech stack (exact versions matter)
- **Frontend**: Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API routes (runtime: nodejs — never edge)
- **ORM**: Prisma 7 — uses `@prisma/adapter-pg` + `pg` Pool. No `datasourceUrl` in constructor.
- **Database**: Neon (serverless Postgres, pgvector). See `docs/adr/0002-storage-choice.md` — there is no planned migration to Aurora.
- **AI inference**: Groq (primary, cloud), Ollama (local fallback), optional Bedrock via `MODEL_PROVIDER=bedrock` + `src/lib/models/bedrock.ts`. Do not claim Bedrock is the default or production path unless credentials and a real model id are configured.
- **Testing**: Vitest. `npm test` must pass before any commit.

## Architecture rules

### Model routing
- All model routing lives in `src/lib/models/router.ts`. Never hardcode model names anywhere else.
- Routing is by **complexity tier**, not by conversation topic. The seven tiers are:
  **Max, High, Plus, Standard, Light, Fast, Micro** (most → least capable). `DEFAULT_TIER` is `Standard`.
- Tier selection is deterministic first (`src/lib/models/route-message.ts` scores the message), with an LLM tiebreak in `classifyMode()` in `groq.ts`. The tier list in that function's `VALID` array must stay in sync with `COMPLEXITY_TIERS` in `router.ts`.
- Tier controls **which model** handles a request. Workspace context (`Workspace.context`) shapes the system prompt. These are independent — do not conflate them.
- Vision requests auto-route to `meta-llama/llama-4-scout-17b-16e-instruct` via Groq.
- Groq is primary for all tiers. Ollama is fallback only, used when Groq is unavailable or no key is set.
- Background tasks (summarize, extract) always use the cheapest model (`llama-3.1-8b-instant`). Embeddings use `nomic-embed-text` via Ollama.

### Database
- All DB access goes through `src/lib/db.ts` (Prisma singleton with PrismaPg adapter).
- Never instantiate `PrismaClient` directly outside of `src/lib/db.ts` and `prisma/seed.ts`.
- Migrations: `npx prisma migrate dev --name <description>`. Always confirm before running `migrate reset`.
- Schema lives in `prisma/schema.prisma`. Config in `prisma.config.ts` (uses `DIRECT_URL` for migrations).
- The `vector(768)` column cannot be expressed in Prisma. It is created by `scripts/add-vector-embedding.sql` and queried with raw SQL in `src/lib/memory.ts`. **Any raw SQL touching `MemoryFragment` must filter by `userId`** — it is the one place a tenant boundary can be crossed silently.

### Sensitive data
- Chat messages: detection runs **client-side** in `src/lib/pii.ts` before any message leaves the browser.
- When anything is detected, the user sees a **pre-send review dialog**. There is no code path that transmits the unredacted text.
- Document uploads: the same patterns run **server-side at ingest** via `scrubDocumentText()` in `src/lib/documents.ts` — after text extraction, before DB persist or embedding.
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
      documents/route.ts          ← list/upload documents
      documents/[id]/route.ts     ← get/delete single document
      embed/route.ts              ← embed text into a MemoryFragment
      summarize/route.ts          ← background memory summarization
  lib/
    db.ts                     ← Prisma singleton (PrismaPg adapter)
    identity.ts               ← getIdentity(req) — the only source of userId
    pii.ts                    ← detection, sensitivity tiers, safe terms, secrets
    pii.test.ts               ← detection + no-leak test suite
    evidence.ts               ← citation packaging + insufficient-evidence prompts
    citation-audit.ts         ← post-answer [n] coverage / invalid-index checks
    prompt-guard.ts           ← injection neutralization + evidence fencing
    memory.ts                 ← fragment storage + semantic retrieval
    documents.ts              ← extraction, server-side scrub, chunking
    tokens.ts                 ← token estimation + working memory selection
    identity.ts               ← getIdentity — local / jwt-hs256 / Cognito JWKS
    models/
      types.ts                ← shared types (ChatMessage, ModelConfig, etc.)
      router.ts               ← complexity-tier model routing
      route-message.ts        ← deterministic complexity scoring
      provider.ts             ← unified streamChat (Groq / Ollama / Bedrock)
      ollama.ts               ← Ollama streaming provider
      groq.ts                 ← Groq streaming provider + tier classifier
      bedrock.ts              ← optional Bedrock ConverseStream adapter
  components/
    app/
      app-shell.tsx           ← main UI: sidebar, chat, intel panel, composer
      workspace-editor.tsx    ← name, description, operational context
      settings-hub.tsx        ← settings, sensitivity, safe terms
tests/
  authz.test.ts               ← cross-tenant authorization tests
prisma/
  schema.prisma               ← DB schema (Workspace, Session, Message, etc.)
  seed.ts                     ← seed script
scripts/
  add-vector-embedding.sql    ← creates the pgvector column (manual step)
docs/adr/                     ← architecture decision records
```

## What NOT to do
- Never add a way to restore, reveal, or transmit a redacted value.
- Never persist a raw detected value to the DB, `localStorage`, or a log.
- Never read `userId` from a request. Always use `getIdentity(req)`.
- Never use `findUnique` on a user-owned record without a subsequent ownership check.
- Never accept a client-supplied safe-terms or allowlist payload server-side.
- Never run `prisma migrate reset` without explicit user confirmation.
- Never use `export const runtime = "edge"` on any API route.
- Never commit `.env.local`, `.env`, or any file containing API keys.
- Never use `datasourceUrl` in the `PrismaClient` constructor — use the PrismaPg adapter instead.
- Never claim Cognito login UI, KMS, or Macie integration exists. Auth verification scaffolding and optional Bedrock streaming exist; full AWS productization does not.
- Never describe conversation "modes" as driving model choice — complexity tiers do.
- Never reintroduce companion personalities, trait sliders, or a restore path for redacted values.

## Current status
- **Working**: chat with streaming, complexity-tier routing, client-side redaction with pre-send review, sensitivity tiers, safe terms, hard-blocked secret detection, prompt-injection fencing/neutralization for retrieved evidence, layered memory (working + summary + facts + pgvector), document ingest with server-side scrubbing, numbered citations + post-answer citation audit, insufficient-evidence prompting, multi-workspace UI, optional Bedrock adapter, Cognito/JWT identity scaffolding (default still local), Docker Compose (Postgres+pgvector + Floci), GitHub Actions CI.
- **Not implemented**: login UI / session cookies, LLM-as-judge claim verification, KMS/Macie, production Cognito user pool provisioning.
