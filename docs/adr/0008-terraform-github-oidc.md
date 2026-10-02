## ADR 0008: Terraform + GitHub Actions OIDC for hosted AWS

**Status**: Accepted · **Date**: 2026-08-29 · **Supersedes**: CloudFormation / SAM as the hosted IaC source of truth (`infra/stacks`, now archived under `infra/cloudformation/`)

---

### Context

Hosted SecureMind is Amplify UI + API Gateway/Lambda + Cognito + DynamoDB (ADR 0004, ADR 0007). Templates lived in CloudFormation/SAM. The repo is GitHub. Operators need a sandbox apply path that does not store AWS access keys or a GitHub PAT in Terraform state.

### Decision

1. **Terraform** under `infra/terraform/` is the cloud IaC. On-prem Docker Compose is unchanged.
2. **GitHub Actions + AWS OIDC** is the pipeline. Not CodePipeline, not GitLab CI.
3. **Amplify** still **builds and hosts** the Next.js UI. Actions triggers `StartJob` after tests/apply, then **waits** for that job (`infra/scripts/amplify-wait-job.mjs`) so a failed UI build fails the GitHub check. Auto-build is off. The GitHub App is connected in the Amplify console.
4. **Default database is DynamoDB.** Nested CloudFormation is used only for the DynamoDB vector index until the AWS provider supports it. Neon/Aurora are not created by default.
5. **Bootstrap once** from a laptop: S3 state and lock file, OIDC deploy role scoped to this repository.

### Consequences

- `npm run infra:up` runs `terraform apply`, not `aws cloudformation deploy`.
- DynamoDB vector index settings remain immutable (ADR 0007); hosted embeddings stay 1024 / Titan v2.
- Prisma leftover rows are an application follow-up, not a second default database.

### Revisit when

- `aws_dynamodb_vector_index` ships in the AWS provider — drop the nested CloudFormation table template.
- Prisma workspaces/chat/settings move onto DynamoDB.
- Amplify rejects Next 16 `WEB_COMPUTE` — evaluate OpenNext (ADR 0004).
