## ADR 0004: Amplify UI + API Gateway + Lambda

**Status**: Accepted · **Date**: 2026-08-03 · **Updated**: 2026-08-24 · **Supersedes**: App Runner as the default hosting target in `AGENTS.md`

Hosted **data plane** is DynamoDB + native vectors ([ADR 0007](0007-hosted-dynamodb-vectors.md)). This ADR is about **hosting** (Amplify UI + streaming API), not the store. IaC is Terraform ([ADR 0008](0008-terraform-github-oidc.md)).

---

### Context

SecureMind needs a permanently hosted AWS path that stays cheap at low traffic, can scale later, and preserves streamed chat. App Runner (always-warm) is simple but carries an idle memory floor. Amplify Hosting does not stream Next.js API routes. API Gateway REST APIs now support Lambda response streaming.

### Decision

**Production shape**

1. **Amplify Hosting** (or OpenNext if Amplify rejects Next 16) — UI only  
2. **API Gateway REST** + **Lambda** — application APIs, with **response streaming** for chat  
3. **DynamoDB + native vectors** — hosted AWS data plane (ADR 0007). Terraform provisions the fragments table (nested CFN for the vector index until the AWS provider supports it). Local / on-prem remains Postgres + pgvector (ADR 0002). Neon/Aurora are optional opt-ins, not the default.  
4. **Cognito** — invite-only (`infra/terraform/modules/auth_cognito`; no public self-signup)  
5. **Parameter Store** — originally Secrets Manager; moved 2026-10-18 because a standard SecureString parameter has no monthly charge and a secret costs $0.40. The instance encryption key and setup code are one parameter (`/securemind/<env>/app-secrets`), and the optional deploy-time Groq key is another. Admin-pasted vendor keys (Groq, Google, OpenAI, Anthropic) are written to `/securemind/<env>/vendor-keys`. The table name is a plain setting. InstanceConfig does not store those values.  
6. **Local/dev** — `npm run dev` keeps same-origin `/api/*`; remote API is opt-in via `NEXT_PUBLIC_API_BASE_URL`

**Local vs cloud providers**

| Concern | Local | AWS |
|---------|-------|-----|
| Chat | Groq / Ollama / optional Bedrock | Groq and/or Bedrock (no Ollama) |
| Embeddings | Ollama `nomic-embed-text` (768-d) | Bedrock Titan Embed v2 (configure dims; migrate vector column if ≠ 768) |

### Consequences

- Chat core lives in `src/lib/chat/` and is shared by Next routes and Lambda handlers.  
- Document ingest must complete inside the invocation or fan out (no fire-and-forget on Lambda).  
- Cross-origin calls use Bearer tokens; cookies remain for same-origin localhost.  
- Until remaining Next `/api/*` move to the gateway, Amplify still traces Prisma, document parsers, and AWS SDK into the **220 MB** WEB_COMPUTE cap ([hosted sandbox roadblocks](../deploy/hosted-sandbox-roadblocks.md)). Chat/warm are already on API Gateway.  
- Floci still validates Cognito/S3/secrets locally; streaming API Gateway + Amplify + Bedrock stream require a thin real-AWS PoC.

### Revisit when

- Amplify Hosting fully supports the app’s Next version and streaming, or OpenNext becomes the default UI host.  
- Embedding dimension strategy is locked (stay 768 vs migrate to 1024).
