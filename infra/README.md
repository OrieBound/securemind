# SecureMind IaC (Terraform)

Use an AWS account and CLI profile that you control. Keep the app out of an organization management account. Nothing is created until you run bootstrap, `npm run infra:up`, or your own GitHub Actions deploy.

This repo’s workflow on `main` applies the maintainer sandbox (GitHub environment `aws-sandbox`). A new install does not use that pipeline. Bootstrap your account, then apply from your laptop or from a workflow in your fork.

**Hosted data plane (ADR 0007):** DynamoDB + native vector search. **On-prem:** Docker Compose (Postgres + Ollama + Floci). Neon and Aurora are not in the default cloud stack.

CloudFormation YAML under [`cloudformation/`](cloudformation/) is archived. The DynamoDB vector index is still a nested CloudFormation template called from Terraform until the AWS provider ships `aws_dynamodb_vector_index`.

## Two editions

| | On-prem | Your AWS account |
|---|---|---|
| Command | `docker compose up --build` | Terraform + Amplify + Lambda |
| Database | Compose Postgres + pgvector | **DynamoDB only** (default) |
| Auth | Floci Cognito | Real Cognito invite-only |
| Models | Ollama from Compose; other providers only after you configure them | Bedrock if that account can invoke it; otherwise a saved vendor key; otherwise no model |
| UI build | Next in the app container | Amplify builds from GitHub; Actions calls `StartJob` |

Chat/workspaces/settings still use Prisma in application code. That leftover is **not** a second cloud database we provision. A DynamoDB-only deploy of those screens is a follow-up app change.

## Prerequisites

- An [AWS account](https://aws.amazon.com/) you administer. Keep the app out of an organization management account.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) version 2 and a named profile.
- [Terraform 1.14](https://developer.hashicorp.com/terraform/install) or newer. The state lock is an S3 lock file.
- [Node.js 20](https://nodejs.org/) or newer.
- [Git](https://git-scm.com/downloads), and a GitHub repository you can connect to Amplify.
- Permission to create IAM, S3, Lambda, API Gateway, Cognito, Amplify, DynamoDB, Secrets Manager, and CloudFormation.
- Optional, for a model with no vendor key: [Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access-modify.html) for Titan Text Embeddings v2 and a chat model.

Hosted resources can incur AWS charges. Tear the stack down with `npm run infra:down -- --yes`.

## Your account (once)

Sign in with a named profile so a bare `aws` command cannot land in the wrong account.

```bash
aws sso login --profile your-profile
```

1. **Bootstrap** creates the state bucket and the GitHub OIDC role in that account. Terraform locks state with an object in the same bucket.

```bash
cd infra/terraform/bootstrap
terraform init
terraform workspace select your-env || terraform workspace new your-env
terraform apply \
  -var="github_repository=YOUR_ORG/securemind" \
  -var="env_name=your-env" \
  -var="github_environment=aws-your-env"
```

Copy the `backend_hcl` output to `infra/terraform/backend.hcl` (gitignored).

2. **GitHub** (on your fork or your repo, not this maintainer pipeline)
   - Environment name matching `github_environment` above
   - Variables (not secrets): `AWS_ROLE_ARN` (bootstrap `gha_role_arn`), `TF_STATE_BUCKET`, `AWS_REGION`
   - No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`
3. **Amplify console:** connect the GitHub repo with the GitHub App. Terraform does not store a token. Auto-build stays off. Your workflow calls `StartJob` after apply.
4. **Bedrock console:** enable Titan embed v2 (1024-d) and the chat models you will use. IAM is not enough without model access.
5. **`.env.deploy`:** `AWS_PROFILE=your-profile` and `ENV_NAME=your-env`.
6. Laptop apply: `npm run infra:up`. After the first Amplify URL exists, `npm run infra:wire`.
7. **First admin:** the pool stays empty. Print the setup code once from the CLI. It is not shown on the Amplify page:

```bash
terraform -chdir=infra/terraform output -raw setup_claim_secret
```

Open the site, enter that code plus the email and password **you** choose. The setup code is not the Cognito password. If you lose the code and the pool is still empty, taint `module.amplify.random_password.setup_claim` and re-apply.

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
| `bootstrap/` | S3 state and lock file, GitHub OIDC role |
| `modules/bedrock_lab` | Bedrock IAM managed policy + optional dashboard |
| `modules/auth_cognito` | Invite-only user pool, app client, Owner/Admin/Member |
| `modules/data_dynamodb` | Fragments table + vector index (1024, immutable) |
| `modules/secrets` | fragments-table secret; vendor-keys; optional bootstrap Groq |
| `modules/api` | API Gateway + streaming `/chat` + `/warm` |
| `modules/amplify` | Amplify app (no GitHub token); first-run `SETUP_CLAIM_SECRET` |

## Secrets model

| Secret | Where | Who sets it |
|---|---|---|
| DynamoDB table name | Secrets Manager `securemind/<env>/fragments-table` | Terraform |
| Groq bootstrap | Secrets Manager (only if `GROQ_API_KEY` is set at deploy) | `.env.deploy` / you |
| Vendor keys (Groq, Google, …) | Secrets Manager `securemind/<env>/vendor-keys` | Admin UI |
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
terraform apply -var="github_repository=YOUR_ORG/securemind" -auto-approve
```
