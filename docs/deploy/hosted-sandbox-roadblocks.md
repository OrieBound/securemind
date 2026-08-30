# Hosted sandbox: roadblocks we hit

**Last stamped: 2026-08-29.** First real AWS apply of SecureMind (account `your-aws-profile` / `123456789012`, August 2026). Sandbox stays the automatic `main` pipeline. Production is a **second stack** in `your-aws-profile`, not a retarget of this one.

Use this as an operator log and as interview notes: each item is **symptom → cause → what we did**. Dated chronology is in [Timeline](#timeline) below; README carries a short copy of the same stamp.

IaC and IAM layers: [infra/README.md](../../infra/README.md). Hosting decision: [ADR 0004](../adr/0004-amplify-lambda-hosting.md). Pipeline: [ADR 0008](../adr/0008-terraform-github-oidc.md).

---

## Timeline

Dates are when we **diagnosed or shipped the fix in-repo**, not when AWS first returned the error. Items 1–7 were the August 2026 apply campaign (jobs 1–7 failed). Items 8–10 are 2026-08-29.

| Date | # | Hurdle | Outcome |
|------|---|--------|---------|
| 2026-08 | 1 | Wrong AWS account (SSO default = management) | Locked target: `--profile your-aws-profile` |
| 2026-08 | 2 | App Terraform state vs laptop bootstrap state | App state remote S3; bootstrap still local |
| 2026-08 | 3 | `.gitignore` hid `src/lib/aws-credentials.ts` | Ignore only repo-root `/aws-credentials*` |
| 2026-08 | 4 | Prisma generate with no hosted Postgres | Dummy `DATABASE_URL` at build; DynamoDB at runtime |
| 2026-08 | 5 | OIDC `AssumeRoleWithWebIdentity` on apply | Bootstrap `StringLike` for immutable GitHub `sub` |
| 2026-08 | 6 | Amplify “Monorepo spec … without applications key” | Removed `AMPLIFY_MONOREPO_APP_ROOT=.` |
| 2026-08 | 7 | WEB_COMPUTE 220 MB cap (~258 MB traced) | Keep standalone; prune after build |
| 2026-08-29 | 8 | Green Amplify job, HTTP 500 empty HTML | NFT whole-repo + pruned `@swc/helpers`; job 12 = HTTP 200 Sign in |
| 2026-08-29 | 9 | Hosted login rejected Floci demo users | Pool was **empty**; demo emails are local-only |
| 2026-08-29 | 10 | First-run Owner claim | Pushed to `main` for Actions `terraform apply` + Amplify StartJob. **Not live until that workflow is green.** |

**As of 2026-08-29:** live UI `https://main.<app-id>.amplifyapp.com/` remains the job-12 Sign in build until the `main` Actions deploy job applies Terraform and Amplify SUCCEEDs.

---

## Two pipelines (read this first)

A green **GitHub Actions** run is not a live site unless the workflow **waits** for Amplify (`amplify-wait-job.mjs`). Older runs used `continue-on-error` on `StartJob`, so CI could be green while Deployments were red.

The `npm warn ERESOLVE` / vite / esbuild lines in Amplify logs are **install warnings**, not the failure. The 220 MB cap is `CustomerError: The size of the build output … exceeds`.

| Pipeline | What it does |
|---|---|
| GitHub Actions `CI` | Tests, `terraform apply`, `amplify start-job`, then **poll until Amplify SUCCEED/FAILED** |
| Amplify Hosting | Clones GitHub and builds Next.js. That is the UI. Auto-build is **off**; Actions (or the console) starts the job |

“Auto-build” in the Amplify console often means `commitId: HEAD` (StartJob / Redeploy), not “every git push rebuilt the UI.”

---

## Hits

### 1. Wrong AWS account

**Symptom:** CLI/Terraform landed in the org/management account.

**Cause:** Bare `aws` uses the SSO default (management). `.env.deploy` / `AWS_PROFILE` must be `your-aws-profile` (or later `your-aws-profile` / `your-aws-profile`).

**Fix:** Always `--profile your-aws-profile`. Never put the app in management.

### 2. Terraform state: S3 vs laptop

**Symptom:** Uncertainty whether destroy/apply used local state.

**Cause:** The **app stack** state is remote: bucket `securemind-tfstate-123456789012-us-east-1`, key `securemind/sandbox/terraform.tfstate`, lock table `securemind-tflock-sandbox`. **Bootstrap** (that bucket, lock, OIDC role) is still local state under `infra/terraform/bootstrap/`.

**Fix:** `infra:down` destroys the app stack via S3 state. It does not delete bootstrap. Laptop apply and Actions apply share the same app state file.

### 3. Gitignore swallowed `aws-credentials.ts`

**Symptom:** CI typecheck / bundle missing `@/lib/aws-credentials`.

**Cause:** `.gitignore` had `aws-credentials*`, which matched the source file at repo root of that path.

**Fix:** Ignore only `/aws-credentials*` at the repository root, not `src/lib/aws-credentials.ts`.

### 4. Prisma client not generated in CI / Amplify

**Symptom:** Typecheck failed (`PrismaClient` missing) or Amplify build failed on generate.

**Cause:** Hosted data is DynamoDB; there is **no** cloud Postgres. `prisma generate` still needs a URL at **build** time. Dummy `DATABASE_URL` / `DIRECT_URL` (`postgresql://ci:ci@127.0.0.1:5432/ci`) are generate-only. They are not a hosted database.

**Fix:** Set those dummies in GitHub Actions, `amplify.yml`, and the Amplify Terraform `build_spec`. Do not provision Neon/RDS for Amplify.

### 5. OIDC: `AssumeRoleWithWebIdentity` (plan vs apply)

**Symptom:** Terraform plan looked fine; apply died on **Configure AWS** with `Not authorized to perform sts:AssumeRoleWithWebIdentity`.

**Cause:** Two different problems, both trust-policy:

1. GitHub `sub` is not a single string. PR vs `environment:aws-sandbox` vs `ref:refs/heads/main` all differ. Exact `StringEquals` misses suffixes.
2. Repos created after 2026-07-15 (or opted in) send **immutable** subjects: `repo:Owner@OWNER_ID/name@REPO_ID:environment:aws-sandbox`. A trust of `repo:Owner/name:*` does **not** match. CloudTrail `userName` is the real `sub`.

This is **layer 1** (may this job *become* the role?), not missing `lambda:*` on the deploy policy.

**Fix:** Bootstrap trust `StringLike` for both `repo:ORG/REPO:*` and `repo:ORG@*/REPO@*:*`. Re-apply **bootstrap**, not `infra:up`. Same four GitHub Environment **variable names** (`AWS_ROLE_ARN`, `TF_STATE_BUCKET`, `TF_LOCK_TABLE`, `AWS_REGION`) — values from that account’s bootstrap. No access keys.

### 6. Amplify: “Monorepo spec provided without applications key”

**Symptom:** Amplify failed in ~30–50s, right after clone.

**Cause:** Terraform set `AMPLIFY_MONOREPO_APP_ROOT=.`. Amplify then requires `applications:` in the buildspec. This repo is **one** Next app at the root, not an Amplify monorepo.

**Fix:** Remove that env var. Do not Redeploy failed jobs 1–3; they used the old app config.

### 7. Amplify: build output exceeds 220 MB (230686720 bytes)

**Symptom:** Next listed every `/api/*` route, then `Build completed successfully`, then:

`The size of the build output (258428789) exceeds the max allowed size of 230686720 bytes.`

**Cause:** Not a missing database. Amplify **WEB_COMPUTE** caps the uncompressed SSR package at **220 MB**. Next file-tracing copies every library imported by **every** compiled server route. Chat/warm already go to API Gateway; **workspaces, documents, settings, memory** still run as same-origin Next `/api/*` on Amplify, so Prisma, `pg`, AWS SDK, exceljs/mammoth/pdf-parse, plus SWC/esbuild natives, all land in that bundle. We were ~26 MB over.

**Fix:** Keep Next `standalone` (Amplify compute needs it to boot). After `next build`, prune **inside** standalone plus `.next/cache` / source maps / build-only packages (`infra/scripts/amplify-prune-compute.mjs`). Skipping standalone got a “Deployed” job that served HTTP 500 empty HTML. Dummy `DATABASE_URL` stays generate-only.

We did **not** delete `/api/workspaces` or `/api/documents` from the Amplify app. Hosted UI still calls those same-origin. Chat/warm already go to API Gateway. Removing the rest without moving them to Lambda would break the site.

**Real shrink:** Finish ADR 0004 — Amplify serves UI only; remaining `/api/*` move to API Gateway + Lambda (and off Prisma on the hosted path). See below.

### 8. Amplify: HTTP 500 empty HTML after a green deploy

**Symptom:** `https://main.<app-id>.amplifyapp.com/` returns **500**, empty `<html><head></head><body></body></html>`, `X-Cache: Error from cloudfront`. Job 9 **SUCCEED**. CloudWatch `/aws/amplify/<app-id>` stays at **0 bytes**. Static paths (`/`, `/icon.png`) also 500.

**Cause:** Turbopack NFT traced the **whole repo** because `secret-at-rest.ts` used `process.cwd()` without a `turbopackIgnore` comment. Amplify’s compute `run.sh` then `ln -sf` every standalone root entry, including `src/`, `docs/`, and a nested `amplify-compute-bundle-output`. Those recursive symlinks fail on the read-only compute FS, so the Node server never starts. Missing CloudWatch permissions on the custom Amplify role hid the crash.

**Fix:** Prune standalone to an allowlist; **also delete leftover workspace files on Amplify/CodeBuild** (`src`, `docs`, …) because the packager copies the clone. Job 10 still 500’d after standalone-only prune. Job 11 then failed at boot with `Cannot find module '@swc/helpers/_/_interop_require_default'` — we had excluded/pruned all of `@swc`, including the **runtime** helpers Next needs. Keep `@swc/helpers`; only drop `@swc/core` natives. Add SSR log IAM so compute crashes are visible. Do not Redeploy an old job — StartJob a new commit.

### 9. Hosted Sign in: demo email / password failed (2026-08-29)

**Symptom:** `admin@example.test` / `<demo-password>!` (and the Floci member/demo aliases) do not work on the Amplify URL. Sign up is visible but Cognito rejects it.

**Cause:** Those users were seeded only by `scripts/floci-cognito-setup.mjs` against **local Floci**. The hosted pool (`us-east-1_zHbYTbq2F`) is invite-only (`allow_admin_create_user_only`) and `list-users` returned **none**. `ADMIN_EMAIL` / `maybeInviteAdmin` was never the product first-user path. `NEW_PASSWORD_REQUIRED` is still unimplemented — do not create users with a temporary password unless that challenge is handled.

**Fix:** Stop seeding product demo users. Empty directory → first visitor claims Owner. Hosted claim requires a high-entropy setup code from `terraform output -raw setup_claim_secret` (not shown on the public page, not the long-term password). On-prem / localhost: email + chosen password only. Public `/api/auth/signup` returns 403; later users are Admin-invited.

### 10. First-run claim is coded, not live (2026-08-29)

**Symptom:** After (9), there is still no way to create the first hosted user on the **running** Amplify job.

**Cause:** Claim APIs, AuthGate, wizard, Owner group, Amplify Cognito IAM, and `SETUP_CLAIM_SECRET` were written on 2026-08-29 and pushed to `main` so GitHub Actions (environment `aws-sandbox`) can apply Terraform and StartJob Amplify. They are **not** live until that workflow is green.

**Fix (operator):** watch the `Terraform apply · Amplify StartJob` job. After apply, print the setup code from Terraform output (not the public page). Until SUCCEED, treat live Sign in as “empty pool, previous UI.”

---

## What we did *not* hit (yet) but is next-door

- **IAM layer 2:** after OIDC works, `AccessDenied` on `s3:` / `iam:` during apply (deploy policy on `securemind-gha-<env>`).
- **Runtime roles:** Amplify service role vs Lambda execution role vs Bedrock **model access** in the console (IAM JSON is not enough).
- **GitHub `main` apply** still hardcodes Environment `aws-sandbox`. Prod is a **new** Environment `aws-prod` + manual job, not overwriting sandbox vars.

---

## Architect note: should all APIs use API Gateway?

**Yes for hosted AWS. That is already the decision in ADR 0004.** The hybrid (chat on Lambda, everything else on Amplify Next) is a **migration leftover**, not a second intended design.

| | Amplify Next `/api/*` (today for most routes) | API Gateway + Lambda (chat already; rest planned) |
|---|---|---|
| Streaming chat | Amplify does not stream Next API routes | REST + Lambda response streaming |
| Bundle size | Traces Prisma, parsers, AWS SDK into the 220 MB cap | UI bundle stays UI |
| Deploy | UI rebuild ships API code | UI and API ship independently |
| Auth | Same-origin cookies | Bearer + CORS (already used for chat) |
| Limits | Amplify SSR timeouts/payloads | Lambda timeout/payload; streaming for chat |
| Data plane | Prisma still expects Postgres; hosted store is DynamoDB | One API in front of DynamoDB |

Local `npm run dev` should keep same-origin `/api/*` (`NEXT_PUBLIC_API_BASE_URL` unset). Hosted sets that URL so the **browser** talks to the gateway. Completing the split is the hosted end state; trimming SWC/esbuild is only how we stay under the cap until then.
