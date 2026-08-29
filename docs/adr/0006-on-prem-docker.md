## ADR 0006: On-prem distribution via Docker Compose

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

**GitHub ships:** source, `Dockerfile`, `docker-compose.yml` — not pre-built images (optional GHCR later).

**Developer workflow:** `docker compose up -d db floci ollama ollama-init` + `npm run dev` on the host for fast iteration; full compose before release.

Greenfield Compose databases use **`prisma db push`** in init (not `migrate deploy`) until the migration chain applies cleanly on empty volumes.

### Consequences

- `next.config.ts` sets `output: "standalone"` for the app image.
- Floci uses `FLOCI_HOSTNAME=floci` in Compose so in-container JWT issuer/JWKS match internal DNS.
- Optional Groq via gitignored `.env.onprem`.
- Cloud path unchanged; no container hosting on AWS for the product app.

### Revisit when

- Pre-built GHCR images and a `docker-compose.release.yml` that uses `image:` instead of `build:`.
- Migration chain fixed for greenfield `migrate deploy`.
- Owner/Operator/Member Cognito groups replace Admin/Member in Floci bootstrap.
