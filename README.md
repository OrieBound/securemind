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

Sign in: create the first Owner in the app (your email + password). There is no demo account.

See **[docs/deploy/on-prem-docker.md](docs/deploy/on-prem-docker.md)** for tear-down, Groq BYOK, and developer vs shipping workflows.

### Optional: Floci + host dev (contributors)

Full internal rundown (what Floci mirrors vs App Runner / Aurora / Bedrock):  
**[docs/deploy/floci-local.md](docs/deploy/floci-local.md)**

```bash
docker compose up -d          # Postgres + Floci
npm run floci:cognito         # writes scripts/.floci-cognito.env — merge into .env.local
```

For a disposable local instance, point `DATABASE_URL` / `DIRECT_URL` at Compose Postgres (see the doc), not your daily Neon.

The Floci pool starts empty. Open the app and choose your Owner email and password. Public sign-up stays off after that; invite additional users from Admin.

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

- Not multi-tenant production auth. Floci Cognito is local. Hosted Cognito Sign in works against a real pool; as of 2026-08-29 that pool was empty and first-run claim is **not** on the live Amplify build yet.
- Regex detection misses free-form names and unusual formats.
- Image extract needs a vision provider (Bedrock on hosted; optional Groq BYOK). OCR quality varies by screenshot.
- Citation audit is heuristic (markers / claim units), not an LLM judge.
- Safe terms, sensitivity, and the detection log still live in `localStorage`.
- Do not claim Bedrock/KMS/Macie as live product features unless you have configured them.

## Discoveries and roadblocks (dated)

**Last stamped: 2026-08-30.** First AWS sandbox apply (account `your-aws-profile` / `123456789012`). Full symptom → cause → fix notes: [`docs/deploy/hosted-sandbox-roadblocks.md`](docs/deploy/hosted-sandbox-roadblocks.md).

**Not live until GitHub Actions finishes.** First-run Owner claim was pushed to `main` on 2026-08-29 so CI can `terraform apply` (environment `aws-sandbox`) and `amplify start-job`. Until that workflow is green, the live Amplify URL is still the job-12 Sign in build against an **empty** Cognito pool. After a green apply: `terraform output -raw setup_claim_secret` (Actions logs will not print it; use the CLI or the Terraform state output). Local try: empty Floci pool (`docker compose down -v` if old demo users exist) → `npm run dev`.

| When | What we hit | What we learned |
|------|-------------|-----------------|
| 2026-08 (sandbox apply) | CLI landed in the org/management account | Always `--profile your-aws-profile`. Never put the app in management. |
| 2026-08 | Uncertainty about destroy vs laptop state | App stack state is remote S3; bootstrap state is still local. |
| 2026-08 | CI missing `@/lib/aws-credentials` | `.gitignore` `aws-credentials*` swallowed the source file. |
| 2026-08 | Prisma generate failed in CI / Amplify | Dummy `DATABASE_URL` is generate-only. Hosted data is DynamoDB — do not provision Neon for Amplify. |
| 2026-08 | Plan green, apply died on OIDC | GitHub `sub` (immutable repo IDs after 2026-07-15) must `StringLike` in **bootstrap** trust, not `infra:up`. |
| 2026-08 | Amplify died ~30s after clone | `AMPLIFY_MONOREPO_APP_ROOT=.` on a single-root Next app. |
| 2026-08 | Build output > 220 MB | Amplify WEB_COMPUTE cap. Chat is on API Gateway; remaining Next `/api/*` still traces Prisma into the UI bundle. |
| 2026-08-29 | Jobs “SUCCEED” but site HTTP 500 empty HTML | Turbopack NFT traced the whole repo (`process.cwd()`); prune then dropped `@swc/helpers` which Next needs at runtime. CloudWatch was 0 bytes until SSR log IAM. Job 12: HTTP 200 Sign in. |
| 2026-08-29 | `admin@example.test` / `<demo-password>!` failed on Amplify | Those users exist only on **local Floci**. Hosted pool is invite-only and was **empty**. Public Sign up UI was a lie. |
| 2026-08-29 | First-run Owner claim designed | Hosted: CLI setup code ≠ password. On-prem: choose email+password, no code. No product demo users. **Shipped to `main` for Actions apply; not live until that job succeeds.** |
| 2026-08-30 | Documents / Cost / Insights: “Restart the dev server after schema changes” on Amplify | Live UI still ran Prisma against Postgres. Hosted has **no** Postgres. App records (workspaces, Knowledge, Insights, memory, profile) belong on DynamoDB. Laptop code now maps them; **not live until deploy**. Retry does nothing until that build ships. |
| 2026-08-30 | Wizard offered Neon and Aurora on cloud | Those were preference-only and never a data plane. Cloud is **DynamoDB only** (everything on one store). Local stays Postgres + pgvector. Neon/Aurora parked as a possible later **all-SQL** path — not mixed with Dynamo. |
| 2026-08-30 | Image Knowledge seemed to need Groq | Groq is optional BYOK. Hosted image extract uses Bedrock (Nova Lite). Original files are not stored on the hosted install — only extracted, scanned text. |
| 2026-08-30 | “Cloud is Dynamo” applied to keys and (wrongly) to passwords | Dynamo = app data only. Vendor API keys → Secrets Manager. Login passwords stay in Cognito (hashed), not SM or Dynamo. AWS access stays on the IAM role. |
| 2026-08-30 | Terraform apply failed on Amplify vendor-keys IAM `count` | New Secrets Manager ARN is unknown at plan. Always attach the policy. |

Production is a **second stack** in `your-aws-profile`, not a retarget of sandbox.

## Docs

- [`docs/securemind-education-guide.md`](docs/securemind-education-guide.md) — full project walkthrough and dependency guide
- [`docs/README.md`](docs/README.md) — docs index
- [`docs/adr/0002-storage-choice.md`](docs/adr/0002-storage-choice.md) — local Postgres + pgvector; hosted AWS superseded by ADR 0007 (DynamoDB)
- [`docs/adr/0003-local-aws-scaffolding.md`](docs/adr/0003-local-aws-scaffolding.md) — Floci + Compose
- [`docs/adr/0004-amplify-lambda-hosting.md`](docs/adr/0004-amplify-lambda-hosting.md) — Amplify UI + API Gateway + Lambda
- [`docs/deploy/hosted-sandbox-roadblocks.md`](docs/deploy/hosted-sandbox-roadblocks.md) — dated sandbox timeline: OIDC, Amplify 220 MB, HTTP 500, empty Cognito pool, hosted Dynamo mapping, secrets vs data (2026-08-30)
- [`AGENTS.md`](AGENTS.md) — rules for agents working in this repo
