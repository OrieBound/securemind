# SecureMind IaC (Terraform)

**UAT first** (account `your-aws-profile`). Fill `.env.deploy` → bootstrap in that account → `npm run infra:up`.  
Do **not** put the app in `your-aws-profile`. Nothing hits AWS until you run bootstrap / `infra:up` / GitHub Actions deploy.

**Hosted data plane (ADR 0007):** DynamoDB + native vector search. **On-prem:** `docker compose up --build` (Postgres + Ollama + Floci). Neon and Aurora are **not** in the default cloud stack.

CloudFormation YAML under [`cloudformation/`](cloudformation/) is archived. The DynamoDB vector index is still a nested CloudFormation template called from Terraform until the AWS provider ships `aws_dynamodb_vector_index`.

## Two editions

| | On-prem | Cloud / UAT |
|---|---|---|
| Command | `docker compose up --build` | Terraform + Amplify + Lambda |
| Database | Compose Postgres + pgvector | **DynamoDB only** (default) |
| Auth | Floci Cognito | Real Cognito invite-only |
| Models | Ollama + optional Groq; Bedrock via **your PC** SSO | Lambda IAM → Bedrock; else Admin BYOK |
| UI build | Next in the app container | Amplify builds from GitHub; Actions calls `StartJob` |

Chat/workspaces/settings still use Prisma in application code. That leftover is **not** a second cloud database we provision. A DynamoDB-only deploy of those screens is a follow-up app change.

## AWS accounts

| Profile | Account | Use |
|---|---|---|
| `your-aws-profile` | 123456789012 | Org / SSO only — not the app |
| `your-aws-profile` | 123456789012 | **Current hosted target** |
| `your-aws-profile` | 123456789012 | Scratch (bootstrap already exists here from an earlier step) |
| `your-aws-profile` | 123456789012 | Later |
| `your-aws-profile` | <account-id> | Later |

Always pass `--profile your-aws-profile` (or set `AWS_PROFILE`) so a bare `aws` command does not land in management.

## UAT: what you set up (once)

You will need the **UAT** AWS account (`your-aws-profile`) and the GitHub repo. The agent cannot finish Amplify console clicks.

1. **AWS SSO** into UAT: `aws sso login --profile your-aws-profile`
2. **Bootstrap** (creates state bucket, lock table, GitHub OIDC role **in UAT**):

```bash
cd infra/terraform/bootstrap
terraform init
terraform workspace select uat || terraform workspace new uat
terraform apply -var="github_repository=YOUR_ORG/securemind" -var="env_name=uat" -var="github_environment=aws-uat"
```

Copy the `backend_hcl` output to `infra/terraform/backend.hcl` (gitignored).

3. **GitHub**
   - Environment **`aws-uat`** (required reviewers recommended)
   - Variables (not secrets): `AWS_ROLE_ARN` (bootstrap `gha_role_arn`), `TF_STATE_BUCKET`, `TF_LOCK_TABLE`, `AWS_REGION`
   - **No** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
4. **Amplify console (UAT account):** connect this GitHub repo (GitHub App). Terraform does not store a PAT. Auto-build stays off; Actions runs `StartJob`.
5. **Bedrock console (UAT):** enable Titan embed v2 (1024-d) and the chat models you will use. IAM is not enough without model access.
6. **`.env.deploy`:** `AWS_PROFILE=your-aws-profile` and `ENV_NAME=uat`.
7. Laptop apply: `npm run infra:up`  
   Or push `main` after OIDC vars exist (Actions apply + StartJob). After the first Amplify URL: `npm run infra:wire`.

| Command | What it does |
|---|---|
| `npm run infra:package` | esbuild zip for chat/warm Lambdas |
| `npm run infra:validate` | package + `terraform fmt` + `terraform validate` (no apply) |
| `npm run infra:up` | package + `terraform apply` + wire |
| `npm run infra:wire` | Cognito callbacks, Lambda CORS, Amplify env, disable auto-build |
| `npm run infra:down -- --yes` | `terraform destroy` |

## Terraform modules

| Module | Creates |
|---|---|
| `bootstrap/` | S3 state, DynamoDB lock, GitHub OIDC role |
| `modules/bedrock_lab` | Bedrock IAM managed policy + optional dashboard |
| `modules/auth_cognito` | Invite-only user pool, app client, Admin/Member |
| `modules/data_dynamodb` | Fragments table + vector index (1024, immutable) |
| `modules/secrets` | fragments-table secret; optional Groq |
| `modules/api` | API Gateway + streaming `/chat` + `/warm` |
| `modules/amplify` | Amplify app (no GitHub token) |

## Secrets model

| Secret | Where | Who sets it |
|---|---|---|
| DynamoDB table name | Secrets Manager `securemind/<env>/fragments-table` | Terraform |
| Groq bootstrap | Secrets Manager (only if `GROQ_API_KEY` is set) | `.env.deploy` / you |
| Vendor keys day-to-day | `InstanceConfig` (still Prisma today) | Admin UI |
| AWS access keys | Never in UI, DB, or GitHub | SSO / OIDC role |

## GitHub Actions

- **PR:** tests, then `terraform plan` (OIDC) once vars are set
- **`main`:** tests → apply (Environment `aws-sandbox`) → `amplify start-job`

Amplify clones GitHub and runs [`amplify.yml`](../amplify.yml). Actions does not upload a UI zip.

Sandbox apply hits (OIDC, Amplify monorepo env, 220 MB compute cap, Actions vs Amplify): [docs/deploy/hosted-sandbox-roadblocks.md](../docs/deploy/hosted-sandbox-roadblocks.md).

## IAM layers (what failed vs what is next)

These are **different** permissions. The same error name is never used for all of them.

| Layer | What it answers | Where it lives | Typical failure |
|---|---|---|---|
| **1. OIDC trust** | May this GitHub job *become* the deploy role at all? | Bootstrap role `securemind-gha-<env>` assume-role policy | `Not authorized to perform sts:AssumeRoleWithWebIdentity` **before** Terraform runs |
| **2. Deploy policy** | Once assumed, may Terraform create/update the stack? | Same role, inline policy `securemind-gha-deploy-<env>` | `AccessDenied` on `s3:…`, `iam:…`, `lambda:…` **during** plan/apply |
| **3. Runtime roles** | May Amplify build, or Lambda call Bedrock / DynamoDB? | `securemind-amplify-<env>`, `securemind-api-<env>` | App/build errors after a green apply |
| **4. Bedrock model access** | Is this account allowed to invoke Titan / chat models? | Bedrock console, not IAM JSON | Runtime `AccessDeniedException` from Bedrock |

Layer 1 is **not** “Terraform lacks an AWS service permission.” GitHub presents a `sub` claim; IAM must `StringLike` that exact string. New GitHub repos (after 2026-07-15) send:

`repo:Owner@OWNER_ID/name@REPO_ID:environment:aws-sandbox`

A trust of `repo:Owner/name:*` does **not** match that. CloudTrail `AssumeRoleWithWebIdentity` → `userName` is the real `sub`.

Other GitHub/IAM mix-ups that look similar:

- Job missing `permissions: id-token: write` (no OIDC token).
- `AWS_ROLE_ARN` pointing at Amplify/Lambda (`sts:AssumeRole` for a service) instead of `securemind-gha-<env>`.
- Trust used `StringEquals` with a `*` (wildcard only works on `StringLike`).
- Environment `aws-sandbox` vars not visible on the job, so OIDC is skipped.

Change trust or the GHA deploy policy with **bootstrap apply**, not `infra:up`:

```bash
cd infra/terraform/bootstrap
terraform apply -var="github_repository=OrieBound/securemind" -auto-approve
```
