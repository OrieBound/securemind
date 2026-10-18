# SecureMind IaC (Terraform)

**New to this?** Start at [docs/deploy/aws-from-zero.md](../docs/deploy/aws-from-zero.md) — a from-nothing walkthrough with every command, assuming you have not installed Terraform, created a GitHub Environment, or signed in to AWS before. The rest of this file is the condensed reference for someone who has already done it once.

Use an AWS account and CLI profile that you control. Keep the app out of an organization management account. Nothing is created until you run bootstrap, `npm run infra:up`, or your own GitHub Actions deploy.

The Terraform jobs in this repo’s workflow are off unless you set the repository variable `AWS_DEPLOY_ENABLED` to `true`. A new install can ignore them: bootstrap your account, then apply from your laptop or from a workflow in your fork.

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
6. Laptop apply: `npm run infra:up`. After the first Amplify URL exists, `npm run infra:wire`. **Standing rule, not a one-time step:** every later `terraform apply` — drift fixes, a module change, anything — must be followed immediately by another `npm run infra:wire`. `terraform apply` alone only knows `http://localhost:3000` for CORS/callback URLs and resets them back to that on its own; `infra:wire` is what extends them to the live Amplify domain. `infra:up` already runs them as that pair — a bare `terraform apply` run by hand does not.
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
| `modules/secrets` | `vendor-keys` parameter (Parameter Store, Advanced tier); optional bootstrap Groq parameter |
| `modules/api` | API Gateway + streaming `/chat` + `/warm` |
| `modules/amplify` | Amplify app (no GitHub token); the `app-secrets` Parameter Store parameter (instance encryption key and first-run setup code) |

## Secrets model

| Secret | Where | Who sets it |
|---|---|---|
| DynamoDB table name | Not a secret: a plain `DYNAMODB_FRAGMENTS_TABLE` setting on the Lambda and Amplify | Terraform |
| Groq bootstrap | Parameter Store `/securemind/<env>/groq-api-key` (only if `GROQ_API_KEY` is set at deploy) | `.env.deploy` / you |
| Vendor keys (Groq, Google, …) | Parameter Store `/securemind/<env>/vendor-keys` | Admin UI |
| AWS access keys | Never in UI, DB, or GitHub | SSO / OIDC role |

## GitHub Actions

- **PR:** tests, then `terraform plan` (OIDC) once vars are set
- **`main`:** tests → apply (your GitHub Environment) → `amplify start-job`

Amplify clones GitHub and runs [`amplify.yml`](../amplify.yml). Actions does not upload a UI zip.

Sandbox apply hits (OIDC, Amplify monorepo env, 220 MB compute cap, Actions vs Amplify, Windows-laptop apply quirks, Amplify console env-var wipe): [docs/deploy/hosted-sandbox-roadblocks.md](../docs/deploy/hosted-sandbox-roadblocks.md).

## IAM layers (what failed vs what is next)

These are **different** permissions. The same error name is never used for all of them.

| Layer | What it answers | Where it lives | Typical failure |
|---|---|---|---|
| **1. OIDC trust** | May this GitHub job *become* the deploy role at all? | Bootstrap role `securemind-gha-<env>` assume-role policy | `Not authorized to perform sts:AssumeRoleWithWebIdentity` **before** Terraform runs |
| **2. Deploy policy** | Once assumed, may Terraform create/update the stack? | Same role, inline policy `securemind-gha-deploy-<env>` | `AccessDenied` on `s3:…`, `iam:…`, `lambda:…` **during** plan/apply |
| **3. Runtime roles** | May Amplify build, or Lambda call Bedrock / DynamoDB? | `securemind-amplify-<env>`, `securemind-api-<env>` | App/build errors after a green apply |
| **4. Bedrock model access** | Is this account allowed to invoke Titan / chat models? | Bedrock console, not IAM JSON | Runtime `AccessDeniedException` from Bedrock |

Layer 1 is **not** “Terraform lacks an AWS service permission.” GitHub presents a `sub` claim; IAM must `StringLike` that exact string. New GitHub repos (after 2026-07-15) send:

`repo:Owner@OWNER_ID/name@REPO_ID:environment:<your-environment>`

A trust of `repo:Owner/name:*` does **not** match that. CloudTrail `AssumeRoleWithWebIdentity` → `userName` is the real `sub`.

Other GitHub/IAM mix-ups that look similar:

- Job missing `permissions: id-token: write` (no OIDC token).
- `AWS_ROLE_ARN` pointing at Amplify/Lambda (`sts:AssumeRole` for a service) instead of `securemind-gha-<env>`.
- Trust used `StringEquals` with a `*` (wildcard only works on `StringLike`).
- The Environment’s variables are not visible on the job (check `AWS_ENVIRONMENT`), so OIDC is skipped.

Change trust or the GHA deploy policy with **bootstrap apply**, not `infra:up`:

```bash
cd infra/terraform/bootstrap
terraform apply -var="github_repository=YOUR_ORG/securemind" -auto-approve
```

## Secrets on the hosted edition

Stored values live in Systems Manager Parameter Store as SecureString parameters, encrypted with the AWS-managed key. Standard parameters have no monthly charge (Secrets Manager costs $0.40 per secret); the `vendor-keys` parameter uses the Advanced tier for 8 KB of room and costs $0.05 a month. The instance encryption key and the first-run setup code are one parameter, `/securemind/<env>/app-secrets`. The Amplify compute role can read that one parameter and nothing else. The only variable on the Amplify app is `APP_SECRETS_PARAM`; the server loads it once at startup (`src/instrumentation.ts`). Nothing secret is written to `.env.production` or the build output.

- **Read the setup code:** `terraform -chdir=infra/terraform output -raw setup_claim_secret` (unchanged).
- **Moving an existing install:** `terraform apply` creates the parameters from the *same* random values, so the encryption key is not rotated. It also removes the old Secrets Manager secrets, which stay recoverable for 7 days. If you pasted vendor keys in the app, run `npm run infra:migrate-vendor-keys` straight after the apply to copy them across (it never prints a key), then `npm run infra:wire`, then deploy. Until the new build is live, the old code still reads the old secrets, so do the build promptly.
- **Rotation:** nothing rotates by itself. To rotate, change the value and apply, or write a small Lambda that calls `ssm:PutParameter`.
- **Rotating the encryption key:** change `random_id.instance_encryption` and apply. Anything encrypted with the old key becomes unreadable, so re-enter provider keys in Settings afterwards.
- **If startup cannot reach Parameter Store** it retries three times, then logs the error name and carries on. The app then fails closed: no stored keys can be read and nobody can claim the instance until the next restart.

## Custom domain

The hosted edition can serve the app and the chat API from your own domain while the registrar stays where it is. It is off until `domain_name` is set, and staged so a half-finished setup cannot break a running install. Stage 1 creates a Route53 zone and prints the nameservers to give your registrar. Stage 2 adds the Amplify app domain, the optional API domain and their certificates, and moves CORS and the sign-in URLs to the new address. Full runbook: [docs/deploy/custom-domain.md](../docs/deploy/custom-domain.md). Variables are in `domain.tfvars.example`.

## Two-step verification

The user pool allows authenticator-app codes as an optional second step (`mfa_configuration = "OPTIONAL"`, no SMS). Applying it changes nothing for existing users. Each person turns it on under My Profile. Details and lost-phone recovery: [docs/mfa.md](../docs/mfa.md).
