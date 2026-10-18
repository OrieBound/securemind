# Running SecureMind in your own AWS account, from zero

This is the complete path from an empty laptop and an AWS account to a working, signed-in SecureMind install at an Amplify URL. It assumes you have done none of this before. Each phase says what it does, why it exists, and the exact commands.

This is **a second, independent copy** of SecureMind in an account you control. It is not a hosted service, and SecureMind does not run a shared copy that holds your keys. If you later run this in a second AWS account, you bootstrap again — you do not point an existing deployment at a different account.

Detection reduces risk; it does not guarantee every sensitive value is caught, and this is not a compliance program.

If a step here does not match what actually happens, that is a bug in this document — [open an issue](https://github.com/OrieBound/securemind/issues) with the step number and what you saw. [docs/deploy/hosted-sandbox-roadblocks.md](hosted-sandbox-roadblocks.md) is a running log of real failures from doing exactly this, with symptom → cause → fix.

## What you need before you start

Install these first. Each link is the official installer for that tool.

| Tool | Why | Check it worked |
|---|---|---|
| [Git](https://git-scm.com/downloads) | Clone the repository | `git --version` |
| [Node.js 20 or newer](https://nodejs.org/) | Runs the Terraform helper scripts and the app build | `node --version` |
| [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | Signs you in to AWS and runs commands against it | `aws --version` |
| [Terraform 1.14 or newer](https://developer.hashicorp.com/terraform/install) | Creates the AWS resources | `terraform -version` |

You also need:

- **An AWS account you administer.** Not an organization's shared management account — your own account, or a member account you control. [Create one here](https://aws.amazon.com/) if you don't have one yet.
- **A way to sign in to that account from the CLI.** AWS SSO (IAM Identity Center) is the normal path and is what this guide uses. A long-lived IAM access key also works, but is not recommended.
- **Permission in that account** to create IAM roles/policies, S3 buckets, Lambda functions, API Gateway, Cognito, Amplify apps, DynamoDB tables, and Systems Manager parameters. If this is your own account and you are the root/admin user, you already have this.
- **A GitHub account**, and your own copy of this repository (a fork, or a push to a new repo you own). The Terraform bootstrap step creates an IAM role that trusts *your* GitHub repository — it needs that repository to exist first.
- **Strongly recommended:** access to [Amazon Bedrock models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access-modify.html) in that account, so chat has a model without pasting a vendor API key. An AWS install has no local model, so it needs either Bedrock or a key. You can add a Groq/OpenAI/Gemini/Anthropic key in Settings after you're signed in instead, or as well.

Nothing in AWS is created by installing these tools. The first thing that creates anything is Phase 2.

## Phase 1 — Get the code and sign in to AWS

```bash
git clone https://github.com/<your-account>/securemind.git
cd securemind
npm install
```

Sign in to your AWS account from the CLI with a **named profile**, so a bare `aws` command can never land in the wrong account by accident:

```bash
aws sso login --profile my-securemind
```

If your account does not use AWS SSO, configure a named profile with `aws configure --profile my-securemind` instead.

Confirm you're in the right account before continuing:

```bash
aws sts get-caller-identity --profile my-securemind
```

Note the `Account` number in that output. Every command below runs against that account.

## Phase 2 — Bootstrap (creates a state bucket and a GitHub role, once)

This phase creates two things, both small and not billable in any meaningful way: an S3 bucket to hold Terraform's state file, and an IAM role that your GitHub repository is allowed to assume. Nothing app-shaped exists yet.

First read your repository's GitHub subject. It includes the numeric IDs of your account and repository, which is what ties the role to your repository alone:

```bash
gh api repos/<your-github-username>/securemind/actions/oidc/customization/sub --jq .sub_claim_prefix
```

It prints something like `repo:your-name@123456/securemind@7891011`. If it prints a plain `repo:your-name/securemind` with no `@` numbers, turn on immutable subjects for the repository first (the bootstrap refuses a subject without them).

```bash
cd infra/terraform/bootstrap
terraform init
terraform workspace new my-env   # pick a short name: prod, main, whatever you'll call this install
terraform apply \
  -var="github_subject_prefix=<the value printed above>" \
  -var="env_name=my-env" \
  -var="github_environment=aws-my-env"
```

### Who can use the role this creates

Only your repository, running in the one GitHub Environment you name, can assume it. The trust rule matches the exact subject `repo:<you>@<owner id>/<repo>@<repo id>:environment:<environment>`, with no wildcards. A copy of the code in someone else's repository, a fork, a branch that is not in that Environment, or a pull request cannot match, and neither can a different account that later takes your username, because the numeric IDs differ. Give the Environment **required reviewers** (Settings → Environments), so a person approves every run.

The role is also limited in what it can do. Writes are restricted to resources named `securemind-*` wherever AWS allows it, and it can only create or change IAM roles that carry the permission boundary this phase creates. It can never edit itself, the boundary or the identity provider. Treat it as only as trustworthy as your repository, and keep the repository private with branch protection on `main`.

Terraform will print a plan and ask you to type `yes`. Read it — the only resources should be an S3 bucket, an IAM OIDC provider, and one IAM role.

When it finishes, copy the `backend_hcl` output into a new file at `infra/terraform/backend.hcl` (this file is gitignored on purpose — it's specific to your account):

```bash
terraform output backend_hcl
```

Paste that output, as-is, into `infra/terraform/backend.hcl`.

## Phase 3 — GitHub repository variables (for automated plan/apply, optional but recommended)

This phase lets GitHub Actions in *your* fork assume the role from Phase 2, without ever holding an AWS access key as a GitHub secret. If you only ever intend to apply from your own laptop, you can skip this phase and go straight to Phase 4 — but then pull requests won't get an automatic `terraform plan`.

In your GitHub repository: **Settings → Environments → New environment**, name it exactly what you passed as `github_environment` above (e.g. `aws-my-env`), and turn on **Required reviewers**. Then add these as **Environment variables** (not secrets — none of these are secret):

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | The `gha_role_arn` output from Phase 2 (`terraform output gha_role_arn`) |
| `TF_STATE_BUCKET` | The `state_bucket` output from Phase 2 (`terraform output state_bucket`) |
| `AWS_REGION` | The region you deployed into, e.g. `us-east-1` |
| `PERMISSIONS_BOUNDARY_ARN` | The `permissions_boundary_arn` output from Phase 2 (`terraform output permissions_boundary_arn`) |

Do **not** add `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` anywhere in GitHub. The role from Phase 2 is how GitHub Actions authenticates — a pasted key is not needed and is not accepted anywhere in this project.

The Terraform plan and apply jobs in `.github/workflows/ci.yml` are off by default. To use them for your own account, set the repository variable `AWS_DEPLOY_ENABLED` to `true`, name your GitHub Environment in the repository variable `AWS_ENVIRONMENT` (it defaults to `aws`), and fill in that Environment's variables from the bootstrap output. Also set the Environment variable `ENV_NAME` to the env name you chose (it defaults to `sandbox`); the workflow uses it for the Terraform state path and the `env_name` input, so there is nothing to edit in `ci.yml`.

## Phase 4 — Apply

Copy the example deploy file and fill in your values:

```bash
cp infra/env.deploy.example .env.deploy
```

Edit `.env.deploy`:

```ini
AWS_PROFILE="my-securemind"
AWS_REGION="us-east-1"
ENV_NAME="my-env"
AMPLIFY_BRANCH="main"
AUTH_MODE="cognito"
AUTH_ALLOW_LOCAL_FALLBACK="false"
```

Leave `DATABASE_MODE`, `STORAGE_BACKEND`, `EMBED_DIMENSIONS`, and `EMBED_PROVIDER` as the example file has them — that is the default DynamoDB + Bedrock-embeddings data plane this project ships. Leave `GROQ_API_KEY` empty unless you specifically want a bootstrap Groq key baked in at deploy time; you can add any vendor key through the Settings UI later instead.

From the repository root:

```bash
npm run infra:up
```

This packages the two Lambda functions, runs `terraform init` against the backend file from Phase 2, runs `terraform apply`, and then wires the Cognito callback URLs and API CORS to whatever Amplify URL now exists. It will print a plan and ask you to confirm. This step creates the real resources — Cognito pool, DynamoDB table, API Gateway, two Lambdas, the Amplify app shell — and can incur AWS charges while it exists.

The Amplify **app** now exists, but it has no source connected and no branch yet — that's Phase 5, and it has to come after this step because Terraform cannot hold a GitHub token.

> **Standing rule, not just a one-time step:** every time you run `terraform apply` again after this point — including the drift-correction case in Phase 5 — immediately run `npm run infra:wire` right after it. `terraform apply` only knows about `http://localhost:3000` for CORS/callback URLs; `infra:wire` is what extends that to your actual Amplify domain. Running `apply` without a following `wire` silently narrows your live site back to localhost-only CORS and Cognito callbacks, which looks like "sign-in broke" with no error that points at the cause.

## Phase 5 — Console setup: connect Amplify to GitHub, enable Bedrock (optional)

**Amplify → Hosting → connect your GitHub repo.** Open the Amplify console, find the app Phase 4 created, and connect it to your GitHub repository through the GitHub App flow (not a personal access token). Then open GitHub → Settings → Applications → AWS Amplify (us-east-1) → Configure and check that your repository is on the list under Repository access. If the app is limited to selected repositories and yours is missing, every build fails early with a misleading "Unable to assume specified IAM Role" error. This lives under the app's **Hosting** menu — not **App settings → Backend Environments** (that's Amplify's own CLI-managed backend feature, unrelated to this project; this app's backend is 100% Terraform-managed).

Walking through the "Add branch" wizard, three choices matter:

- **"My app is a monorepo"** — leave **unchecked**. The repo root *is* the Next.js app.
- **"Enable full-stack deploys"** — leave **unchecked**. This ties the branch to an Amplify-managed backend environment, which doesn't exist and would conflict with the Terraform-managed stack.
- **Service role** — select the existing Terraform-created role, **`securemind-amplify-<env>`** (e.g. `securemind-amplify-my-env`). Do **not** let the wizard create a new role — a console-generated role won't have the Bedrock/DynamoDB/Cognito-admin/vendor-keys/avatars policies Terraform attached to the real one.

Save the branch. Then immediately turn auto-build off and re-sync the full environment, because the console save can silently reset things Terraform set:

```bash
aws amplify update-branch --app-id <amplify_app_id> --branch-name main --no-enable-auto-build --profile my-securemind --region us-east-1
npm run infra:wire
```

(`<amplify_app_id>` is `terraform -chdir=infra/terraform output -raw amplify_app_id`.) The `--no-enable-auto-build` call matters even if you didn't check an auto-build box — the wizard can set `enableAutoBuild: true` by default regardless. Builds should only start deliberately (GitHub Actions after a green apply, or the manual command in Phase 6).

The console wizard can also silently **replace** the app's entire environment variable set with just its own bookkeeping (`_LIVE_UPDATES`), wiping out everything Terraform set — including the setup code you'll need in Phase 6. `npm run infra:wire` above does not fully fix that on its own if it already happened; if Phase 6's status check comes back with `codeConfigured: false`, run `npm run infra:up` again (or just `terraform apply` in `infra/terraform`) followed immediately by `npm run infra:wire` one more time — Terraform owns that attribute and will self-heal it. See [roadblock #24](hosted-sandbox-roadblocks.md#24-amplify-console-silently-replaces-terraform-managed-app-env-vars-2026-10-04) if you want the full story.

**Bedrock → enable model access (strongly recommended).** An AWS install has no local model, so chat needs Bedrock or an API key. To have chat work the moment you sign in, without pasting any API key, open the [Bedrock console](https://console.aws.amazon.com/bedrock/) in the same region, go to **Model access**, and request access to **Titan Text Embeddings V2** and at least one chat model (Claude or Nova are reasonable defaults). This is a console toggle, not an IAM permission — having the right IAM policy is not enough on its own. If you skip this, SecureMind still runs, but chat has no model until you add a Groq, OpenAI, Gemini, or Anthropic key in Settings after your first sign-in.

## Phase 6 — First build and sign-in

Auto-build is off, and if you're applying from your own laptop rather than through GitHub Actions, nothing else will start the first build for you. Start it by hand:

```bash
aws amplify start-job --app-id <amplify_app_id> --branch-name main --job-type RELEASE --profile my-securemind --region us-east-1
```

Watch it in the Amplify console (or poll `aws amplify get-job --app-id <amplify_app_id> --branch-name main --job-id <job-id> --query job.summary.status`) until it says `SUCCEED` — usually a few minutes.

Confirm the site is actually ready before trying to sign in:

```bash
curl https://<amplify_default_domain>/api/setup/status
```

You're looking for `"cognitoConfigured":true` and `"codeConfigured":true`. If either is `false`, see the troubleshooting note at the end of Phase 5 — it means the drift bug hit and needs one more `terraform apply` + `infra:wire` pass before this will work.

The user pool starts empty. There is no demo account and no seeded password. Print the one-time setup code:

```bash
terraform -chdir=infra/terraform output -raw setup_claim_secret
```

This code is not a password and is not shown anywhere in the Amplify console — it only exists in Terraform's output and in Parameter Store. Open the Amplify URL (`terraform -chdir=infra/terraform output -raw amplify_default_domain`, prefixed with your branch), enter that setup code along with the email and password you want for the first account, and that account becomes the Owner.

Sign in. Send a chat message. If you enabled Bedrock model access in Phase 5, it should answer. If not, go to **Settings → Models**, add a vendor key for Groq, OpenAI, Gemini, or Anthropic, and it will answer with that instead.

## What this does not do

This does not create a public, multi-tenant SecureMind. It creates one Cognito pool, invite-only, in your account. You are the administrator. Nobody else's data is anywhere near this. AWS access keys are never typed into SecureMind and never stored in its database — Bedrock and every other AWS call uses the credential chain already present on the machine or role running it.

## Tearing it down

```bash
npm run infra:down -- --yes
```

This runs `terraform destroy` against the backend file from Phase 2. It does not remove the GitHub repository variables from Phase 3 or the bootstrap state bucket from Phase 2 — those are small, inert, and safe to leave, or you can delete the Amplify-console connection and the GitHub Environment by hand if you want a completely clean account.
