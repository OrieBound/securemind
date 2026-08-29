## ADR 0007: DynamoDB native vectors for hosted AWS

**Status**: Accepted · **Date**: 2026-08-24 · **Supersedes**: the hosted-AWS conclusion in [ADR 0002](0002-storage-choice.md) (Neon as default). Does **not** replace Postgres + pgvector for local / on-prem.

---

### Context

SecureMind has two editions:

| Edition | Store |
|---|---|
| Local / on-prem | Postgres + pgvector (Docker Compose). Default for `npm run dev`. |
| Hosted AWS | DynamoDB + native vector search (`SearchVectors`, GA 2026-08-05). |
| Neon | Optional hosted Postgres adapter — not the AWS default. |
| Aurora Serverless v2 | Older expensive AWS-Postgres option — not the target. |

ADR 0002 rejected DynamoDB because vectors would have needed a second store. Native vector search removes that split: embeddings live on the same item as the Knowledge/memory chunk.

Floci emulates DynamoDB item APIs (Put/Query) but does **not** yet emulate `SearchVectors`. Local proof therefore uses the real AWS request shape plus an in-process cosine fallback over the same items.

### Decision

**Hosted AWS data plane = one DynamoDB table with a vector index.** Chat, citations, and `userId` rules stay in the trusted backend. Callers use `VectorSearchRepository` / `VectorFragmentRepository`; they do not talk to DynamoDB or Postgres directly.

**Local / on-prem stays Postgres.** `STORAGE_BACKEND` defaults to `postgres`. DynamoDB is opt-in for lab work (`STORAGE_BACKEND=dynamodb`) against Floci (CRUD + cosine fallback) or, later, real AWS (`SearchVectors`).

**Do not deploy this table to a real AWS account as part of Phase 4.** Phase 5 writes CloudFormation and may apply it to Floci. Real `infra:up` stays a later, explicit step.

### Table (locked)

Settings on a vector index are **immutable** after create. Lock embedding model and dimensions before the first production table.

| Setting | Value |
|---|---|
| Table | `securemind-fragments` (override: `DYNAMODB_FRAGMENTS_TABLE`) |
| Billing | `PAY_PER_REQUEST` (required for vector indexes) |
| Keys | HASH `workspaceId`, RANGE `fragmentId` |
| Vector index | `workspace-vectors` |
| Vector attribute | `embedding` (`L` of `N`) |
| Dimensions | From `EMBED_DIMENSIONS` — **768** (Ollama `nomic-embed-text`) or **1024** (Bedrock Titan v2). One table, one dim. |
| Distance | `COSINE` (score 0 = identical, 2 = opposite). App similarity = `1 - score`. |
| Vector partition (`HASH`) | `workspaceId` — every `SearchVectors` call must pass it. |
| Inline filters | `userId`, `category` (equality only) |
| Citeable retrieval | `category = document` (same rule as pgvector) |
| TopK | ≤ 100 |

**Isolation.** `SearchVectors` is not constrained by IAM condition keys such as `dynamodb:LeadingKeys`. Partitioning by `workspaceId` is a locality/cost choice, not a security boundary. The backend always sets `userId` from `getIdentity()` and includes it in `SearchConditionExpression` (and again when ranking the cosine fallback). Never take workspace or user ids from the model or the browser as authority.

**Missing vector-index partition key.** A PutItem without `workspaceId` succeeds on the base table but is silently omitted from the vector index. The adapter always writes `workspaceId`.

### Local engine

1. **In-memory cosine** — unit tests; no AWS, no Floci.
2. **Floci Query + cosine** — items stored in DynamoDB; ranking in-process because `SearchVectors` is missing.
3. **Real `SearchVectors`** — hosted path once the AWS SDK exports `SearchVectorsCommand` (not in 3.1116 yet). Dedicated search endpoints; the SDK must route them. Until then, even a real table would use Query + cosine in this adapter.

All three share the same item shape and ranking so swapping engines does not change citation fields.

### Consequences

- `src/lib/storage/dynamodb-vectors.ts` implements put + retrieve. It must not import `@/lib/db`.
- Default chat retrieval remains Postgres until `STORAGE_BACKEND=dynamodb`.
- Secrets Manager for hosted bootstrap holds table name/ARN (+ optional Groq), not a Neon URL.
- Knowledge originals stay off S3 unless explicitly revisited.
- Hosted table Terraform lives in `infra/terraform/modules/data_dynamodb`. Apply to a real account only when you intend to. Local table: `npm run floci:dynamodb`.

### Revisit when

- Floci (or another emulator) supports `SearchVectors` — drop the cosine fallback for local DynamoDB.
- A second embedding dim is required — that is a **new table**, not an alter of the existing index.
- Member-shared workspaces (tenancy option B) — partition/filter keys would need membership, not only `userId`.
