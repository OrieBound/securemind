## ADR 0003: Local AWS scaffolding via Docker Compose + Floci

**Status**: Accepted · **Date**: 2026-08-01

---

### Context

SecureMind’s portfolio path includes Cognito, optional Bedrock, and later KMS/S3.
Needing a real AWS account for every contributor blocks local iteration. LocalStack
Community now requires auth tokens; Floci is an MIT-licensed emulator on port 4566.

### Decision

Ship `docker-compose.yml` with:

1. **`pgvector/pgvector:pg16`** — local Postgres matching production’s vector needs
2. **`floci/floci:latest`** — local AWS wire-compatible endpoint at `localhost:4566`

The Next.js app continues to run on the host (`npm run dev`). Contributors opt in
by pointing `.env.local` at Compose URLs (see `.env.example`).

### Consequences

- Neon remains a supported hosted option; Compose is not required.
- Floci’s Bedrock Runtime is stubbed — real Bedrock still needs AWS credentials.
  `ConverseStream` is not supported on Floci; use Ollama/Groq for local streaming.
- Floci DynamoDB supports item APIs (Put/Query). It does **not** emulate `SearchVectors`
  (GA 2026-08-05). Local DynamoDB retrieval uses in-process cosine over stored items
  (ADR 0007). S3 Vectors in Floci is not the hosted data plane.
- Cognito JWT verification is implemented in `getIdentity()`; local pool provisioning
  is via `npm run floci:cognito` (Admin/Member groups included).
- `AUTH_MODE=local` remains the default so existing single-user installs keep working.
- Operator guide: `docs/deploy/floci-local.md` (feature matrix + internal test checklist).
- App Runner and Aurora Serverless are **not** emulated; host Next.js + Compose Postgres
  are the local stand-ins.
