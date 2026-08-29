# SecureMind

A privacy-aware AI workspace for managing models, knowledge, memory, cost, and sensitive-data risk.

SecureMind helps you detect and reduce sensitive-data exposure before chat and Knowledge ingest, keep workspace memory, and answer from retrieved evidence with citations. It does **not** guarantee complete PII removal, security, or regulatory compliance. You remain responsible for reviewing content, configuring controls, and meeting any obligations that apply to you.

**Stack:** Next.js 16 · TypeScript · Prisma 7 · Neon Postgres (pgvector) · Groq (primary) · Ollama (embeddings + fallback)

> **Personal project.** Default identity is a single local user. Optional Floci Cognito login is for local auth experiments only. Do not expose this on a public host.

---

## What works today

- **Client-side detection** with pre-send review (detected values are replaced; the scan can miss values)
- **Safe terms** (CIDR / domain / prefix / literal); SSN, card numbers, and secrets cannot be allowlisted
- **Workspaces** with Chat, Knowledge, Memory, Saved
- **Knowledge ingest** for text, PDF, code, and images (images use Groq vision when configured; extracted text is scrubbed)
- **Chat attachments** land in the same Knowledge library as Knowledge-tab uploads
- **Citations + citation audit** against retrieved fragments
- **Prompt-injection fencing** on retrieved evidence
- **Complexity-tier model routing** (Groq / Ollama; optional Bedrock)
- **Security / Usage / Cost analytics** at `/analytics/*` (persisted sanitized telemetry; Insights rail for routing, spend, and detection)
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

### On-prem (Docker only — recommended for download-and-run)

Full stack: Postgres + Floci + Ollama + app. **No Node on the host.**

```bash
docker compose up --build
```

Sign in: `admin@example.test` / `<demo-password>!`

See **[docs/deploy/on-prem-docker.md](docs/deploy/on-prem-docker.md)** for tear-down, Groq BYOK, and developer vs shipping workflows.

### Optional: Floci + host dev (contributors)

Full internal rundown (what Floci mirrors vs App Runner / Aurora / Bedrock):  
**[docs/deploy/floci-local.md](docs/deploy/floci-local.md)**

```bash
docker compose up -d          # Postgres + Floci
npm run floci:cognito         # writes scripts/.floci-cognito.env — merge into .env.local
```

For a disposable local instance, point `DATABASE_URL` / `DIRECT_URL` at Compose Postgres (see the doc), not your daily Neon.

Demo Cognito users (after setup), password `<demo-password>!`:

- `admin@example.test` (group Admin)
- `member@securemind.local` (group Member)
- `demo@securemind.local` (legacy Admin)

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
| `npm run docker:up` / `docker:down` | Compose infra (db + floci + ollama + default model pull) for host `npm run dev` |
| `npm run docker:onprem` / `docker:onprem:down` | Full on-prem stack (`docker compose up --build` / `down -v`) |
| `npm run floci:cognito` | Provision local Cognito pool/client |
| `npm run infra:up` / `infra:wire` / `infra:down` | Sandbox Terraform apply / URL wiring / destroy — see [infra/README.md](infra/README.md) |

## Architecture (short)

```
Browser                     Server                         External
composer → scrubPII → review
                      /api/chat → identity → memory retrieve → Groq/Ollama
                      /api/documents → extract → scrub → chunk → embed (Ollama)
```

Evidence for answers comes from workspace Knowledge + memory fragments. Retrieved blocks are fenced as untrusted data.

## Security model

These are **risk-reduction** controls, not a security or compliance guarantee. Detection is pattern-based and can miss values.

1. Browser scan before any network call; detected values are replaced  
2. Pre-send review of the text that would be sent  
3. Server scan again on document ingest  
4. No restore path for already-replaced values  
5. `userId` only from `getIdentity(req)` — never from the client body  

## Limitations

- Not multi-tenant production auth. Floci Cognito is local; real AWS Cognito is not wired as a hosted login product yet.
- Regex detection misses free-form names and unusual formats.
- Image extract depends on Groq vision; OCR quality varies by screenshot.
- Citation audit is heuristic (markers / claim units), not an LLM judge.
- Safe terms, sensitivity, and the detection log still live in `localStorage`.
- Do not claim Bedrock/KMS/Macie as live product features unless you have configured them.

## Docs

- [`docs/securemind-education-guide.md`](docs/securemind-education-guide.md) — full project walkthrough and dependency guide
- [`docs/README.md`](docs/README.md) — docs index
- [`docs/adr/0002-storage-choice.md`](docs/adr/0002-storage-choice.md) — why Neon/Postgres + pgvector
- [`docs/adr/0003-local-aws-scaffolding.md`](docs/adr/0003-local-aws-scaffolding.md) — Floci + Compose
- [`docs/adr/0004-amplify-lambda-hosting.md`](docs/adr/0004-amplify-lambda-hosting.md) — Amplify UI + API Gateway + Lambda
- [`docs/deploy/hosted-sandbox-roadblocks.md`](docs/deploy/hosted-sandbox-roadblocks.md) — sandbox AWS apply: OIDC, Amplify monorepo, 220 MB cap, two pipelines
- [`AGENTS.md`](AGENTS.md) — rules for agents working in this repo
