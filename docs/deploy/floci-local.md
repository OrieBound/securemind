# Local staging with Floci (internal test guide)

Use this to practice SecureMind **on your machine** with as much AWS-shaped wiring as Floci can provide — **without** App Runner, Aurora Serverless, or real Bedrock streaming bills.

> Floci is the emulator (port `4566`). It is **not** a full replacement for production AWS.

---

## What runs where

```text
Browser  →  Next.js on host (npm run dev)     ← replaces App Runner
              │
              ├→ Compose Postgres + pgvector  ← replaces Aurora (schema/API only)
              ├→ Ollama (chat + embeddings)   ← real inference / vectors
              ├→ Groq (optional)              ← real cloud chat/vision
              └→ Floci :4566
                    ├ Cognito (login / JWT)   ← good fidelity
                    ├ Secrets Manager / KMS   ← good enough for later Admin secrets
                    ├ S3                      ← later quarantine rehearsals
                    └ Bedrock Runtime stub    ← dummy only; streaming = 501
```

---

## Feature matrix (SecureMind vs Floci)

| Feature / dependency | In Floci? | How you test it locally | Production later |
|----------------------|-----------|-------------------------|------------------|
| **Next.js app + SSE chat** | No (not needed) | `npm run dev` on host | Amplify UI + API GW streaming Lambda (ADR 0004) |
| **API routes / Prisma** | No | Host + Postgres | Lambda + Neon |
| **Postgres + pgvector** | Prefer Compose, not Floci RDS | `docker compose up -d db` | Neon (cheap) or Aurora (optional) |
| **Aurora Serverless** | **No** | Cannot mirror ACU/cost | Real AWS only |
| **App Runner** | **No** | Not required | Optional fallback only |
| **API Gateway + Lambda** | Partial / unproven for response streaming | Shared `src/lib/chat` + `infra/` SAM; prove streaming on real AWS | Production API |
| **Cognito login / JWT / cookies** | **Yes** | `npm run floci:cognito` + `AUTH_MODE=cognito` | Real Cognito |
| **Cognito Admin / Member groups** | **Yes** (provisioned by setup script) | Sign in as admin@ / member@; Settings → Inference & API shows role + Admin-only key edits | Cognito groups |
| **Invite-only (no public signup)** | Partial | Use Admin APIs / disable signup in UI when testing cloud mode | Pool setting + disable route |
| **Secrets Manager** | **Yes** | Optional AWS CLI against `:4566` | Real Secrets Manager |
| **KMS** | **Yes** | Optional encrypt/decrypt rehearsal | Real KMS |
| **S3** | **Yes** | Optional; quarantine not wired in app yet | Real S3 |
| **Bedrock Converse (non-stream)** | Stub only | Dummy reply; no real model | Real Bedrock |
| **Bedrock ConverseStream** | **501 / unsupported** | Save **real AWS IAM keys** in Settings (Admin); app calls real Bedrock (not Floci) | Real Bedrock stream |
| **Ollama chat + embed** | N/A (local) | Required for Knowledge vectors | Hosted embed / Bedrock embed |
| **Groq** | N/A | Optional `.env` or Admin Settings key + model catalog | Optional BYOK / server key |
| **CloudWatch / Budgets / $** | Emulated APIs ≠ your bill | Ignore for cost practice | Real AWS |
| **Redaction / Knowledge / Insights** | App code | Full product paths on host | Same code |

**Bottom line:** Replicate **auth + secrets-shaped AWS APIs + full app behavior** locally. Do **not** claim Floci proved App Runner, Aurora Serverless, or Bedrock streaming.

---

## One-time prerequisites

1. Docker Desktop running  
2. AWS CLI v2 on PATH (`aws --version`)  
3. Node.js + `npm install` in the repo  
4. Ollama with `nomic-embed-text` (and a chat model) for Knowledge + local chat  

---

## Bring the stack up

### 1. Postgres + Floci

```bash
docker compose up -d
```

- Postgres: `localhost:5432` (user/pass/db `securemind`)  
- Floci: `http://localhost:4566`

### 2. Point the app at Compose Postgres (isolated from your Neon)

In `.env.local` (do **not** reuse your day-to-day Neon URL if you want a disposable instance):

```env
DATABASE_URL="postgresql://securemind:securemind@localhost:5432/securemind"
DIRECT_URL="postgresql://securemind:securemind@localhost:5432/securemind"
```

```bash
npx prisma migrate deploy
# if vector column not present yet:
# psql "$DIRECT_URL" -f scripts/add-vector-embedding.sql
```

Compose already runs `scripts/docker-init-pgvector.sql` on first boot; still run the app’s vector SQL if your migrate history expects it.

### 3. Provision Floci Cognito

```bash
npm run floci:cognito
```

Merge the printed block (also written to `scripts/.floci-cognito.env`) into `.env.local`.

Demo users (after setup script):

| Email | Password | Groups |
|-------|----------|--------|
| `admin@example.test` | `<demo-password>!` | `Admin` |
| `member@securemind.local` | `<demo-password>!` | `Member` |
| `demo@securemind.local` | `<demo-password>!` | `Admin` (legacy alias) |

### 4. Inference

```env
# Leave MODEL_PROVIDER unset for Groq/Ollama routing
# GROQ_API_KEY=...          # optional fallback; Admin can also save keys in Settings
# Ollama must be running for embeddings
```

**Settings → Inference & API** (Admin only for writes):

- Save a Groq API key (or other vendor keys, stored for later) — server-side `InstanceConfig`
- Browse every model from every configured credential in one list, each tagged with where it runs
- **Test** any model to prove it actually answers before relying on it
- Click a model to fix it for chat; the same list backs the Insights rail's complexity-tier picker

**Bedrock is configured entirely in the app** — no `.env.local` edits. Sign in once with the AWS
CLI, then choose the profile, region, and billable-call switch in the Bedrock card:

```bash
aws sso login --profile my-profile
```

SecureMind never accepts an AWS access key through the UI and never stores one. Floci `test`
credentials are detected and refused for Bedrock — selecting a real profile bypasses them, so
Cognito can keep using Floci `:4566` while Bedrock talks to real AWS.

### 5. Run the app

```bash
npm run dev
```

Open http://localhost:3000 — sign in with a Floci Cognito user when `AUTH_MODE=cognito`.

---

## Internal test checklist

Use a **Compose DB** so teardown is `docker compose down -v` with no impact on Neon.

- [ ] Unauthenticated API returns 401 when `AUTH_ALLOW_LOCAL_FALLBACK=false`  
- [ ] Login as `admin@example.test` — top-right shows **admin**; can edit Inference & API keys  
- [ ] Login as `member@securemind.local` — top-right shows **member**; Inference keys are view-only  
- [ ] Admin saves Groq key → Models list populates; click a text model → chat uses it  
- [ ] (Optional) Admin saves real Bedrock IAM keys → Bedrock text catalog + chat via AWS  
- [ ] Casual chat streams via Groq, Ollama, or Bedrock  

- [ ] Pre-send review shows when values are detected; the reviewed text is what is sent  
- [ ] Upload a small TXT/PDF → Knowledge status ready (Ollama embed)  
- [ ] Grounded question returns document citations  
- [ ] Security / Usage Insights load (sanitized events)  
- [ ] `docker compose down -v` wipes local DB; Neon untouched  

**Not validated here:** App Runner deploy, Aurora ACU behavior, Bedrock token streaming, real AWS bill.

---

## Optional Floci Secrets Manager smoke

```bash
aws --endpoint-url=http://localhost:4566 secretsmanager create-secret \
  --name securemind/local/demo \
  --secret-string "{\"note\":\"floci-ok\"}" \
  --region us-east-1
```

(Use `AWS_ACCESS_KEY_ID=test` and `AWS_SECRET_ACCESS_KEY=test`.) The app does not read this secret yet; this rehearses the AWS API shape for a future Admin settings milestone.

---

## Tear down (disposable)

```bash
docker compose down -v    # removes local Postgres + Floci volumes
# Restore .env.local DATABASE_* to Neon when you return to daily work
```

Floci Cognito pool state lives in the Floci volume; `-v` clears it. Re-run `npm run floci:cognito` next time.

---

## Related

- ADR: [docs/adr/0003-local-aws-scaffolding.md](../adr/0003-local-aws-scaffolding.md)  
- Compose: [docker-compose.yml](../../docker-compose.yml)  
- Cognito setup: [scripts/floci-cognito-setup.mjs](../../scripts/floci-cognito-setup.mjs)  
