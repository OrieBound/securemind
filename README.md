# SecureMind

A privacy-first AI workspace. Sensitive values are detected and redacted **in the browser**, before any text reaches the server, a model provider, or the database. What the model sees is what you approved.

Built with Next.js 16 (App Router), TypeScript, Tailwind v4, Prisma 7, and Postgres + pgvector. Inference runs through Groq with a local Ollama fallback.

> **Status: personal project, single user.** Authentication is not implemented — every request resolves to a fixed local identity. Do not deploy this to a shared or public host. See [Limitations](#limitations).

---

## What it does

- **Client-side redaction.** Emails, SSNs, card numbers, phone numbers, IPs, addresses, and ID-shaped tokens are detected in `src/lib/pii.ts` before the message leaves the browser. Detected values are replaced with `[category redacted]` placeholders.
- **Pre-send review.** When anything is detected, a dialog shows what was found and exactly what will be transmitted. You send the redacted text or go back and edit. There is no path that sends the original.
- **Safe terms.** Declare values that are not sensitive — CIDR ranges, domains, prefixes, exact strings — so infrastructure notes are not shredded by the scrubber. Safe terms are matched *before* detection, so nothing is ever exposed after the fact. Social Security and card numbers can never be safe-listed.
- **Layered memory.** Recent turns (working memory), a rolling summary, extracted facts, and pgvector semantic retrieval over past messages and uploaded documents.
- **Workspaces.** Separate operational contexts (for example Production Payments vs Customer Portal), each with its own memory and documents.
- **Cost-aware routing.** Messages are scored for complexity and routed to a cheaper or stronger model accordingly. Estimated spend is shown in the UI.
- **Document ingest.** Upload text, Markdown, PDF, or DOCX. Text is extracted, scrubbed server-side, chunked, and embedded.

## Requirements

| | |
|---|---|
| Node.js | 20 or newer |
| PostgreSQL | 14+ with the `pgvector` extension |
| Ollama | optional, needed for embeddings and offline fallback |
| Groq API key | optional, but chat is much faster with one |

[Neon](https://neon.tech) has a free tier with pgvector available and works without configuration.

## Setup

```bash
git clone <your-fork-url> securemind
cd securemind
npm install

cp .env.example .env.local     # then fill in DATABASE_URL and DIRECT_URL
```

Create the schema and enable the vector column:

```bash
npx prisma migrate deploy
psql "$DIRECT_URL" -f scripts/add-vector-embedding.sql
```

For semantic memory and document search, pull the embedding model:

```bash
ollama pull nomic-embed-text
ollama pull mistral            # offline chat fallback
```

Then start it:

```bash
npm run dev
```

Open http://localhost:3000. A default workspace is created on first load.

### Local Docker (Postgres + Floci)

```bash
docker compose up -d
```

Then point `.env.local` at Compose Postgres:

```bash
DATABASE_URL="postgresql://securemind:securemind@localhost:5432/securemind"
DIRECT_URL="postgresql://securemind:securemind@localhost:5432/securemind"
```

Floci (local AWS emulator) listens on `http://localhost:4566`. See `.env.example` for optional `AWS_*` and Cognito variables. Bedrock Runtime on Floci is stubbed — use real AWS credentials if you set `MODEL_PROVIDER=bedrock`.

#### Floci Cognito login ($0)

```bash
docker compose up -d floci
npm run floci:cognito          # creates pool + client + demo user; prints env lines
# paste those lines into .env.local (Neon/Groq stay unchanged), restart npm run dev
```

Sign in with `demo@securemind.local` / `<demo-password>!` (or create an account in the UI). Same pool/client/issuer concepts map 1:1 to real AWS Cognito later — only the hostname changes.

### Without Ollama

The app runs, and documents upload and store correctly, but semantic retrieval is unavailable — embeddings need `nomic-embed-text`. Chat still works if `GROQ_API_KEY` is set.

### Without a Groq key

Chat falls back to Ollama. You need `ollama pull mistral` (or set `OLLAMA_FALLBACK_MODEL`).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3000 (frees the port, regenerates the Prisma client) |
| `npm run build` | Production build |
| `npm test` | Vitest suite — PII detection, identity, authorization |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint |
| `npm run route-eval` | Evaluate the model router against labelled fixtures |

## Architecture

```
Browser                          Server                        External
────────────────────────────────────────────────────────────────────────
composer
  └─ scrubPII()                  /api/chat
     └─ review dialog  ──────▶     ├─ getIdentity(req)
        (sanitized only)           ├─ selectWorkingMemory()
                                   ├─ retrieveSemanticMemory()  ──▶ pgvector
                                   └─ routeModel()              ──▶ Groq
                                                                └──▶ Ollama
                                 /api/messages   ──▶ Postgres
                                 /api/embed      ──▶ Ollama ──▶ pgvector
                                 /api/summarize  ──▶ Groq (cheapest model)
```

Key modules:

| Path | Responsibility |
|---|---|
| `src/lib/pii.ts` | Detection, sensitivity tiers, safe-term matching, secrets |
| `src/lib/prompt-guard.ts` | Injection neutralization + evidence fencing |
| `src/lib/evidence.ts` / `citation-audit.ts` | Citation packaging and post-answer audit |
| `src/lib/identity.ts` | Server-derived request identity — the only source of `userId` |
| `src/lib/db.ts` | Prisma singleton using the `PrismaPg` adapter |
| `src/lib/models/router.ts` | Complexity tiers and provider selection |
| `src/lib/models/provider.ts` | Unified stream entry (Groq / Ollama / Bedrock) |
| `src/lib/memory.ts` | Fragment storage and semantic retrieval |
| `src/lib/documents.ts` | Extraction, server-side scrubbing, chunking |
| `src/components/app/app-shell.tsx` | The main application UI |
| `docker-compose.yml` | Local Postgres+pgvector and Floci AWS emulator |

## Security model

Redaction is layered, and each layer assumes the one before it can be bypassed.

1. **Browser detection** — runs before any network call. The composer never transmits unredacted text.
2. **Pre-send review** — you see the exact string that will be sent. Cancelling leaves your draft untouched in the composer.
3. **Server-side ingest scrubbing** — uploaded documents are scrubbed again at `scrubDocumentText()` before persistence or embedding, because browser controls cannot be trusted alone.
4. **No restore path** — redacted values are not stored anywhere, so there is nothing to leak later. Detection records carry a category and sanitized context only. If detection was wrong, adjust sensitivity or add a safe term and retype.
5. **Server-derived identity** — routes obtain `userId` from `getIdentity(req)` and never from the request. Every workspace, session, document, and memory query is scoped by it.

`npm test` enforces the parts that can be tested statically: that no raw value appears in any field of a scrub result, and that each route scopes its query by the server-derived user.

## Limitations

Being explicit, because a security-oriented project should not overstate itself.

- **Auth is optional scaffolding.** Default `AUTH_MODE=local` still uses a fixed `"local"` user. Cognito / HS256 JWT verification exists in `getIdentity()`, but there is no login UI yet. Do not expose this to a network you do not control.
- **Regex detection.** Pattern matching catches well-formed values (including hard-blocked secrets). It will not catch a name or an unusual identifier format. It is a strong first layer, not a guarantee.
- **Prompt-injection defenses are heuristic.** Retrieved evidence is fenced and instruction-shaped phrases are neutralized; a determined adversary can still try to manipulate the model.
- **Citation audit is deterministic, not an LLM judge.** Invented indices and uncited claims are flagged; subtle unsupported assertions may slip through.
- **Bedrock is optional.** Groq remains primary. Bedrock activates when `MODEL_PROVIDER=bedrock` and AWS credentials are set; Floci’s Bedrock Runtime is stubbed.
- **Local storage.** Safe terms, sensitivity, and the detection log live in `localStorage`, not the database.

## Documentation

- [`docs/PRODUCT_THESIS.md`](docs/PRODUCT_THESIS.md) — product direction and phase gates
- [`docs/adr/0001-ingestion-pipeline.md`](docs/adr/0001-ingestion-pipeline.md) — ingestion and retrieval design
- [`docs/adr/0002-storage-choice.md`](docs/adr/0002-storage-choice.md) — why Postgres + pgvector
- [`AGENTS.md`](AGENTS.md) — conventions for AI coding agents working in this repo
