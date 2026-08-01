# SecureMind

Security-focused cloud-operations knowledge assistant: sanitize sensitive text before it leaves the browser, keep workspace memory, and answer from retrieved evidence with citations.

**Stack:** Next.js 16 · TypeScript · Prisma 7 · Neon Postgres (pgvector) · Groq (primary) · Ollama (embeddings + fallback)

> **Personal project.** Default identity is a single local user. Optional Floci Cognito login is for local auth experiments only. Do not expose this on a public host.

---

## What works today

- **Client-side redaction** with pre-send review (no path that sends the raw detected value)
- **Safe terms** (CIDR / domain / prefix / literal); SSN, card numbers, and secrets cannot be allowlisted
- **Workspaces** with Investigate, Knowledge, Memory, Saved
- **Knowledge ingest** for text, PDF, code, and images (images use Groq vision when configured; extracted text is scrubbed)
- **Chat attachments** land in the same Knowledge library as Knowledge-tab uploads
- **Citations + citation audit** against retrieved fragments
- **Prompt-injection fencing** on retrieved evidence
- **Complexity-tier model routing** (Groq / Ollama; optional Bedrock)
- **CI** on GitHub Actions (`npm ci`, Prisma generate, typecheck, tests)

## Requirements

| | |
|---|---|
| Node.js | 20+ |
| Postgres + pgvector | Neon free tier is the default; Compose Postgres is optional |
| Groq API key | Recommended for chat and image text extraction |
| Ollama | Needed for embeddings (`nomic-embed-text`) and offline chat fallback |

## Setup

```bash
git clone <your-fork-url> securemind
cd securemind
npm install
cp .env.example .env.local   # set DATABASE_URL, DIRECT_URL, GROQ_API_KEY
npx prisma migrate deploy
psql "$DIRECT_URL" -f scripts/add-vector-embedding.sql
ollama pull nomic-embed-text
npm run dev
```

Open http://localhost:3000.

### Optional: Floci (local AWS emulator, $0)

```bash
docker compose up -d floci
npm run floci:cognito    # writes scripts/.floci-cognito.env — merge into .env.local
```

Keep Neon as the database unless you deliberately point at Compose Postgres. Floci is for Cognito/API rehearsal, not a requirement for daily use.

Demo Cognito user (after setup): `demo@securemind.local` / `<demo-password>!`

### Without Ollama

The app runs; document text still stores. Semantic retrieval and document embeddings need `nomic-embed-text`.

### Without Groq

Chat falls back to Ollama. Image Knowledge extract falls back to a filename stub (not searchable body text).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (port 3000) |
| `npm run build` | Production build |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run docker:up` / `docker:down` | Compose Postgres + Floci |
| `npm run floci:cognito` | Provision local Cognito pool/client |

## Architecture (short)

```
Browser                     Server                         External
composer → scrubPII → review
                      /api/chat → identity → memory retrieve → Groq/Ollama
                      /api/documents → extract → scrub → chunk → embed (Ollama)
```

Evidence for answers comes from workspace Knowledge + memory fragments. Retrieved blocks are fenced as untrusted data.

## Security model

1. Browser scrub before any network call  
2. Pre-send review of the exact sanitized payload  
3. Server scrub again on document ingest  
4. No restore path for redacted values  
5. `userId` only from `getIdentity(req)` — never from the client body  

## Limitations

- Not multi-tenant production auth. Floci Cognito is local; real AWS Cognito is not wired as a hosted login product yet.
- Regex detection misses free-form names and unusual formats.
- Image extract depends on Groq vision; OCR quality varies by screenshot.
- Citation audit is heuristic (markers / claim units), not an LLM judge.
- Safe terms, sensitivity, and the detection log still live in `localStorage`.
- Do not claim Bedrock/KMS/Macie as live product features unless you have configured them.

## Docs

- [`docs/PRODUCT_THESIS.md`](docs/PRODUCT_THESIS.md) — original product notes (some phase labels are dated)
- [`docs/adr/0002-storage-choice.md`](docs/adr/0002-storage-choice.md) — why Neon/Postgres + pgvector
- [`docs/adr/0003-local-aws-scaffolding.md`](docs/adr/0003-local-aws-scaffolding.md) — Floci + Compose
- [`AGENTS.md`](AGENTS.md) — rules for agents working in this repo
