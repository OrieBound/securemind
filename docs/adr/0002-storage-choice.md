## ADR 0002: Keep Postgres + pgvector as the primary store

**Status**: Superseded for **hosted AWS** by [ADR 0007](0007-hosted-dynamodb-vectors.md). **Still accepted** for local / on-prem (Docker Compose Postgres + pgvector) and as the optional Neon adapter. · **Date**: 2026-08-01 · **Updated**: 2026-08-24 · **Supersedes**: the Aurora Serverless v2 assumption in `AGENTS.md`

> **2026-08-24.** Hosted AWS no longer defaults to Neon. DynamoDB native vector search (`SearchVectors`) is the AWS edition store. This ADR remains the rationale for why local development stays on Postgres, and why Neon is an optional hosted Postgres path rather than the AWS default. Do not treat the original “DynamoDB rejected” row as current for cloud.

---

### Context

SecureMind stores four kinds of data:

| Kind | Model | Access pattern |
|---|---|---|
| Relational records | `Workspace`, `Session`, `Message`, `Document` | Point lookups and small ordered scans, always scoped by `userId` |
| Derived text | `SessionSummary`, `WorkspaceFact` | Read on session load; facts upserted by the background summarizer |
| Vectors | `MemoryFragment.embedding` — `vector(768)` | Top-k cosine similarity, filtered by `workspaceId` and `userId` |
| Chunked documents | `MemoryFragment` with `category = "document"` | Same as above |

Today all four live in one Neon Postgres database with the `pgvector` extension. Vector search runs through a raw SQL query in `src/lib/memory.ts`, because Prisma models the column as `Unsupported("vector(768)")`.

The project is moving toward an AWS-oriented architecture. That raises a fair question: should storage move to an AWS-native service, and if so which one? It also raises an unfair temptation — adding services because they look good in a portfolio rather than because they solve a problem.

### Decision

**Keep Postgres + pgvector with Neon as the default external database.** Do not migrate day-to-day storage off Neon as part of the hosting pivot.

**Optional Aurora (2026-08-03):** Aurora Serverless v2 remains a parked CloudFormation template (`infra/cloudformation/stacks/data-aurora`). It is not the default and is not created from Terraform.

### Options considered

| Option | Idle cost | Vector search | Verdict |
|---|---|---|---|
| **Neon Postgres + pgvector** (current) | $0 on free tier, scales to zero | Native, same transaction as relational data | **Chosen** |
| Aurora Serverless v2 + pgvector | ~$43/mo at the 0.5 ACU floor | Same as above | Optional deploy-time stack only — not default |
| DynamoDB for metadata + separate vector store | Near $0 idle | Needs a second system | Rejected — splits one consistent write into two, for no gain at this size |
| OpenSearch Serverless | ~$700/mo minimum (2 OCU) | Strong at scale | Rejected — cost is disproportionate by orders of magnitude |
| Bedrock Knowledge Bases | Depends on the backing store | Managed chunk-embed-retrieve | Rejected — would replace the ingest and retrieval logic that is the point of the project |

### Rationale

**Cost.** Idle cost dominates for a project that is mostly idle. Neon's free tier is $0; the cheapest always-on AWS equivalent is roughly $43/month for identical functionality. That is a poor trade for a portfolio project.

**One consistent write.** A document upload currently persists the `Document` row and its `MemoryFragment` chunks against a single database. Splitting metadata into DynamoDB and vectors elsewhere turns that into a distributed write with partial-failure states to reason about, in exchange for nothing at this data volume.

**Scale is not the constraint.** pgvector with an HNSW index handles millions of vectors comfortably. SecureMind has thousands. Choosing a store designed for a scale the project will not reach means paying its operational cost for no benefit.

**Local development.** Postgres runs in Docker with one command and no credentials. Every AWS-native option either requires a real account or an emulator whose fidelity would itself need verifying. Contributors being able to run the project without an AWS account is an explicit project goal.

**The AWS story does not depend on this.** Bedrock inference, Cognito authentication, KMS encryption, S3 document storage, IAM least privilege, CloudWatch observability, and OIDC-based CI/CD are all demonstrable with Postgres as the store. Replacing a working database is not what makes an architecture credible; the security and operational boundaries around it are.

**Deliberate hybrid is a defensible position.** Explaining why a component is not on AWS, with costs attached, demonstrates more engineering judgement than an all-AWS diagram assembled without regard to cost.

### Consequences

- Vector search stays raw SQL in `src/lib/memory.ts`. Prisma cannot type the `vector` column, so that query is hand-written and must be reviewed carefully — it is the one place where a missing `userId` filter would cross a tenant boundary.
- `scripts/add-vector-embedding.sql` remains a required manual setup step, because Prisma migrations cannot express the column type.
- Moving to Aurora later is a connection-string change plus the same extension, not a rewrite. This decision is cheap to reverse.
- The eventual `VectorStore` provider interface should be shaped so a swap does not touch calling code.

### Revisit when

- More than one real tenant exists, and per-tenant isolation needs stronger boundaries than a `userId` column.
- Vector count exceeds roughly one million, or p95 retrieval latency exceeds 200 ms.
- A compliance requirement mandates that data reside in a specific AWS account or region.
- Neon's free tier stops being sufficient — at which point Aurora Serverless v2 is the natural next step, since the schema and queries carry over unchanged.
