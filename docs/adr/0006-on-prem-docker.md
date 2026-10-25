## ADR 0006: On-prem distribution via Docker Compose

> **Note.** The cloud edition now uses DynamoDB (ADR 0007), not Neon or Aurora. Host development needs `-f docker-compose.dev.yml` so the app can reach the database (`npm run docker:up`).

**Status**: Accepted · **Date**: 2026-08-08

---

### Context

SecureMind needs an install path where the **only host dependency is Docker** — suitable for lending out during testing, air-gapped-ish lab use, and operators who do not want Node, Ollama, or AWS CLI on the host.

Cloud hosting remains the serverless AWS stack (Amplify + Lambda + Cognito + Neon/Aurora) in `infra/`. Both paths share one codebase.

### Decision

Ship an **on-prem profile** as Docker Compose in the repo root:

| Service | Role |
|---------|------|
| `db` | Postgres 16 + pgvector (replaces Neon for on-prem) |
| `floci` | Local Cognito / AWS-shaped APIs |
| `ollama` | Chat fallback + embeddings (`nomic-embed-text`) |
| `ollama-init` | One-shot allowlisted pulls (`nomic-embed-text`, `llama3.2:3b`) into the Ollama volume |
| `init` | One-shot bootstrap: schema, Cognito; skips model pulls already done by `ollama-init` |
| `app` | Next.js production image (`output: standalone`) |

**User command:** `docker compose up --build` → http://localhost:3000

**GitHub ships:** source, `Dockerfile`, and Compose. Customers build the app image from source (`docker compose up --build`). The author's CI also builds a signed, scanned image in a **private** GHCR package for the author's own use; it is not an install path, and no pull compose file is shipped.

**Developer workflow:** `docker compose up -d db floci ollama ollama-init` + `npm run dev` on the host for fast iteration; full compose before release.

Greenfield Compose databases use **`prisma db push`** in init (not `migrate deploy`) until the migration chain applies cleanly on empty volumes.

### Consequences

- `next.config.ts` sets `output: "standalone"` for the app image.
- Floci uses `FLOCI_HOSTNAME=floci` in Compose so in-container JWT issuer/JWKS match internal DNS.
- Optional Groq via gitignored `.env.onprem`.
- Cloud path unchanged; no container hosting on AWS for the product app.

### Revisit when

- A one-file Compose release that does not merge over the build file.
- Migration chain fixed for greenfield `migrate deploy`.
- Owner/Operator/Member Cognito groups replace Admin/Member in Floci bootstrap.
