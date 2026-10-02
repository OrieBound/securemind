# Hosted sandbox: roadblocks we hit

**Last stamped: 2026-09-21.** Lab notes from the first hosted apply. The maintainer `main` pipeline stays on its own sandbox stack. Another account is a second bootstrap, not a retarget of that stack.

Use this as an operator log and as interview notes: each item is **symptom → cause → what we did**. Dated chronology is in [Timeline](#timeline) below; README carries a short copy of the same stamp.

IaC and IAM layers: [infra/README.md](../../infra/README.md). Hosting decision: [ADR 0004](../adr/0004-amplify-lambda-hosting.md). Pipeline: [ADR 0008](../adr/0008-terraform-github-oidc.md).

---

## Timeline

Dates are when we **diagnosed or shipped the fix in-repo**, not when AWS first returned the error. Items 1–7 were the August 2026 apply campaign (jobs 1–7 failed). Items 8–10 are 2026-08-29. Items 11–13 are 2026-08-30 (hosted Dynamo mapping). Item 14 is secrets vs Dynamo. Item 15 is Terraform `count` on a new Secrets Manager ARN. Items 16–18 are 2026-08-31 (Knowledge cookie vs chat Bearer, and retrieval never running). Item 19 is 2026-09-21 (Groq key saved, chat still on Ollama, Whisper still working). The 2026-09-21 fix is in the working tree and the local Docker image. It is **not** on the live Amplify site until that build is deployed.

| Date | # | Hurdle | Outcome |
|------|---|--------|---------|
| 2026-08 | 1 | Wrong AWS account (SSO default = management) | Use an explicit `--profile` for the deploy account. Never use the management account. |
| 2026-08 | 2 | App Terraform state vs laptop bootstrap state | App state remote S3; bootstrap still local |
| 2026-08 | 3 | `.gitignore` hid `src/lib/aws-credentials.ts` | Ignore only repo-root `/aws-credentials*` |
| 2026-08 | 4 | Prisma generate with no hosted Postgres | Dummy `DATABASE_URL` at build; DynamoDB at runtime |
| 2026-08 | 5 | OIDC `AssumeRoleWithWebIdentity` on apply | Bootstrap `StringLike` for immutable GitHub `sub` |
| 2026-08 | 6 | Amplify “Monorepo spec … without applications key” | Removed `AMPLIFY_MONOREPO_APP_ROOT=.` |
| 2026-08 | 7 | WEB_COMPUTE 220 MB cap (~258 MB traced) | Keep standalone; prune after build |
| 2026-08-29 | 8 | Green Amplify job, HTTP 500 empty HTML | NFT whole-repo + pruned `@swc/helpers`; job 12 = HTTP 200 Sign in |
| 2026-08-29 | 9 | Hosted login rejected Floci demo users | Pool was **empty**; demo emails are local-only |
| 2026-08-29 | 10 | First-run Owner claim | Pushed to `main` for Actions `terraform apply` + Amplify StartJob. **Not live until that workflow is green.** |
| 2026-08-30 | 11 | Documents / Cost / Insights 500 with “restart after schema changes” | Prisma on Amplify with no Postgres. Map hosted app data to DynamoDB (`app#userId`). |
| 2026-08-30 | 12 | Wizard listed Neon and Aurora on cloud | Preference-only, never provisioned. Cloud store = DynamoDB only. Park SQL as a future all-SQL path. |
| 2026-08-30 | 13 | Image Knowledge treated Groq as required | Groq is optional BYOK. Hosted vision extract = Bedrock. No original files on hosted. |
| 2026-08-30 | 14 | Vendor keys in Dynamo because “cloud is Dynamo” | App data ≠ secrets. Keys → Secrets Manager. Login passwords stay in Cognito (hashed), not SM or Dynamo. |
| 2026-08-30 | 15 | Terraform apply: `count` on Amplify vendor-keys IAM | New secret ARN is unknown at plan. Always attach the policy; do not `count` on the ARN. |
| 2026-08-31 | 16 | Knowledge “Authentication required” while chat still answered | Chat sends Bearer to API Gateway; Knowledge only sent the Amplify cookie. Cookie missing → 401. |
| 2026-08-31 | 17 | Uploaded lease, model said it has no RAG / cannot see files | Turn-policy regex skipped retrieval. The model never “calls” Knowledge. |
| 2026-08-31 | 18 | Security detections on an upload, still no citations | Detections prove extract + scrub, not embeddings. Empty embed → `EMBED_FAILED`. |
| 2026-09-21 | 19 | Groq tiers shown, chat waited on Ollama, Whisper still worked | Saved key ≠ a live model list. Instance primary was Ollama. Groq’s edge refused chat from this server. Check key is now a real probe. |

**As of 2026-08-31:** `b68400f` is on `main` (silent Knowledge search + Knowledge Bearer). Live UI is the previous Amplify job until this is pushed and that workflow is green.

**As of 2026-09-21:** Item 19 is local-only until the next Amplify deploy. Same code path on localhost and cloud. Refresh the Docker app after `docker compose up -d --build --no-deps app`.

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

**Cause:** Bare `aws` uses the SSO default, which may be the organization management account. `.env.deploy` / `AWS_PROFILE` must name the account that should own the app.

**Fix:** Always pass `--profile` for that account. Never put the app in the management account.

### 2. Terraform state: S3 vs laptop

**Symptom:** Uncertainty whether destroy/apply used local state.

**Cause:** The **app stack** state is remote: an S3 bucket named `securemind-tfstate-<account>-<region>`, key `securemind/<env>/terraform.tfstate`, locked by an S3 lock file next to that object. **Bootstrap** (that bucket and the OIDC role) is still local state under `infra/terraform/bootstrap/`.

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

**Fix:** Bootstrap trust `StringLike` for both `repo:ORG/REPO:*` and `repo:ORG@*/REPO@*:*`. Re-apply **bootstrap**, not `infra:up`. Same GitHub Environment **variable names** (`AWS_ROLE_ARN`, `TF_STATE_BUCKET`, `AWS_REGION`) — values from that account’s bootstrap. No access keys. `TF_LOCK_TABLE` is unused.

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

### 11. Prisma on Amplify: Documents and Insights 500 (2026-08-30)

**Symptom:** Knowledge list and Settings → Cost/Usage/Security showed *Failed to load … Restart the dev server after schema changes.* Retry did nothing.

**Cause:** That copy was a local Prisma catch. Amplify `SECUREMIND_EDITION=cloud` has no Postgres. Workspaces/chat already used Dynamo (`app#<userId>`). Documents, profile, Insights (`InferenceEvent` / `SecurityEvent`), memory facts, bookmarks, and cost-cap still called Prisma and threw *Hosted SecureMind does not use Postgres.* Chat/warm go to API Gateway; these routes still run as same-origin Amplify `/api/*`.

**Fix (in-repo):** Persist those records on the same Dynamo app partition. Insights stay sanitized metadata only (no prompts, no raw detected values). Original files are not stored on hosted — extracted, scanned text only. **Not on the live Amplify job until this is committed and rebuilt.** Local `npm run dev` stays Postgres.

### 12. Cloud store is DynamoDB only (2026-08-30)

**Symptom:** First-run wizard offered Neon and Aurora on hosted as if they were data planes.

**Cause:** Local Postgres was cheap (Compose / free-tier thinking). DynamoDB native vectors (ADR 0007) then became the hosted store. Neon/Aurora were left as wizard “preferences” that did not provision a database and did not switch Prisma on. A SQL choice mixed into a Dynamo install would have been a second hybrid.

**Fix:** Hosted setup always records DynamoDB. Local default remains Postgres + pgvector. Neon/Aurora are **not** product options now; they may return later as an all-SQL install (same Prisma schema as local), never mixed with Dynamo on the same instance.

### 13. Hosted image extract does not require Groq (2026-08-30)

**Symptom:** Image Knowledge failed or looked like it needed a Groq key. Users on hosted will not necessarily have Groq.

**Cause:** Vision extract used Groq only (`GROQ_API_KEY` / BYOK). Groq is optional. Hosted inference is Bedrock (IAM).

**Fix:** Hosted image extract uses Bedrock (Nova Lite) when billable AWS is on. Groq remains optional BYOK. Pixels still leave the host to the vision provider; extracted text is scanned before storage.

### 14. Dynamo is the data plane, not the secret store (2026-08-30)

**Symptom:** Hosted design said “everything is DynamoDB,” so Admin-pasted Groq (and other vendor) keys sat on InstanceConfig next to workspaces and settings. Easy to assume login passwords belonged there too.

**Cause:** Dynamo is the right store for **app records**. It is the wrong store for **secrets**. Encrypted-at-rest in the same item as config is still a secret beside data. Login passwords were never in Dynamo — Cognito stores a **hash**. Putting the real password in Secrets Manager would be worse than Cognito (recoverable secret vs hash). AWS access keys stay on the IAM role, never in the app.

**Fix:** Split by kind:

| Kind | Where |
|------|--------|
| Workspaces, Knowledge, memory, Insights, non-secret settings | DynamoDB |
| Admin-pasted vendor API keys (Groq, Google, OpenAI, Anthropic) | Secrets Manager `securemind/<env>/vendor-keys` |
| Sign-in email / password | Cognito (hashed) |
| AWS account access | IAM role — never stored |

Pushed on `main` (`dc18b17`). Live site still writes keys to Dynamo until Terraform creates that secret, IAM allows Get/Put, and Amplify rebuilds with `VENDOR_KEYS_SECRET_ARN`.

### 15. Amplify vendor-keys IAM `count` blocked apply (2026-08-30)

**Symptom:** GitHub Actions `terraform apply` planned the new `securemind/sandbox/vendor-keys` secret, then failed:

`Invalid count argument` on `module.amplify.aws_iam_role_policy.amplify_vendor_keys` (`var.vendor_keys_secret_arn != "" ? 1 : 0`).

**Cause:** That ARN comes from a resource created in the **same** apply, so it is `(known after apply)`. Terraform `count` must be known at plan time.

**Fix:** Always attach the Amplify Get/Put policy. The secret is always created; do not gate the policy on the ARN string.

### 16. Knowledge 401 while chat still works (2026-08-31)

**Symptom:** Chat (Bedrock) kept answering. Knowledge showed a red **Authentication required.** banner. The header still said **Local user** + SUPER. The model then claimed it had no document retrieval system.

**Cause:** Hosted auth is split (ADR 0004 leftover). Chat goes to API Gateway with a Bearer token in `sessionStorage` (`sm_access_token_client`). Knowledge still calls Amplify same-origin `/api/documents` and only sent the HttpOnly cookie. Amplify `AUTH_MODE=cognito` and `AUTH_ALLOW_LOCAL_FALLBACK=false`, so a missing cookie is 401. Chat can keep a valid Bearer after the cookie is gone. **Local user** is the UI fallback when the Cognito **access** token has no email claim — it does not mean `AUTH_MODE=local`.

**Fix:** `sessionApiFetch` in `src/lib/client/api-base.ts` attaches that Bearer on Knowledge list/upload/poll. Copy the cookie into sessionStorage via `ensureClientAccessToken()` before listing. This is a bandage until remaining `/api/*` move to the gateway. Refresh + sign in is the operator workaround on a build that does not have this yet.

### 17. Model denies uploaded Knowledge (RAG never ran) (2026-08-31)

**Symptom:** User uploaded `SecureMind_Synthetic_Residential_Tenancy_Agreement.docx` via Knowledge, then asked for base rent / parking / “retrieve it through rag.” Nova answered that it cannot view attachments and has **no document retrieval system**. Document-parsing badge was green.

**Cause:** The chat model does not choose RAG. `decideTurn()` is a regex classifier that ran **before** vector search. `"What is …"` matched general knowledge; bare `"document"` is excluded on purpose so “review this document” does not dump the library; `"tenancy document provided"` did not match workspace deixis. Result: `shouldRetrieve: false`, no Dynamo/Postgres search, empty Sources, and the model filled the gap by denying retrieval. Green parsing only means extract exists in the runtime status payload.

**Fix:** Keep explicit deixis (`tenancy`/`lease`/`document provided`/`in your memory`). For other non-social turns, **silent-search** Knowledge; hits at `EVIDENCE_MIN_SIMILARITY` (0.5) upgrade to workspace-grounded and show Sources; a miss stays general. Social, app-help, provenance, and corrections still skip search. Prompt: do not claim you cannot see uploads when no Sources were provided — you were not given excerpts. Code: `shouldSkipKnowledgeSearch` / `applySpeculativeKnowledgeHits` in `src/lib/turn-policy/decide-turn.ts`, wired in `run-chat-stream.ts`.

### 18. Security detections ≠ searchable chunks (2026-08-31)

**Symptom:** Insights → Security showed detections at ingest, but chat still had nothing to cite.

**Cause:** Ingest records scrub events when patterns fire. Embeddings are a later step (hosted: Bedrock Titan). If `embedded === 0`, the document can look “processed” without any vector the chat path can retrieve.

**Fix:** Hosted ingest sets `processingError: "EMBED_FAILED"` when no chunks were embedded. Check Knowledge chunk count before assuming RAG is broken. After (17), a miss at 0.5 similarity still stays general with no Sources — that is a miss, not a 401.

### 19. Groq models on the tier list, chat on Ollama, Whisper still working (2026-09-21)

**Symptom:** Settings → Models showed a saved Groq key (`gsk_…`) as **Unreachable**, with a chip that said **Check key** and a banner “Groq key saved, but no models loaded.” Complexity tiers in Insights still showed GROQ models (Llama 3.3 70B, GPT OSS 120B, and the other built-in defaults). Saying “Hello there” showed **Waiting on your machine**, provider Ollama, model `llama3.2:3b`. The voice chip said **Groq Whisper**, and transcription with that same key worked. The xAI Grok row stayed **Not configured** — this was the Groq key, not xAI.

**Cause:** Three separate facts lined up.

1. A saved Groq key plus vendor-risk consent was treated as “Groq will run.” Insights therefore displayed the built-in Groq tier defaults even when the live model list was empty. Those labels were preferences, not a health check.
2. This install’s instance primary is **Ollama**. With no runnable Groq assignment sent, chat resolves to the installed local model (`llama3.2:3b`). From inside the app container, Groq’s edge also answered the model list and chat completions with `403` and “Access denied. Please check your network settings.” (Cloudflare). The old local chat path then substituted Ollama after that failure, so a Groq attempt could still look like a local reply.
3. Voice calls Groq Whisper (`whisper-large-v3-turbo`), a different endpoint from the model list and from chat. A working transcription does not mean chat models loaded. **Check key** was a status label for “key saved, zero models,” not a button that probed Groq.

**Fix:** Same behavior on localhost and cloud.

- **Check key** reloads the Groq model list and shows the refusal or the model count. The zero-model chip now says **No models**.
- Complexity tiers show a Groq model only after that list actually returns it. Until then they show the local model chat will use.
- An assigned Groq model that listed successfully stays on Groq even when the instance primary is Ollama.
- A refused Groq chat call is shown to the user. It is not replaced with Ollama.

Allow `api.groq.com` from this server (VPN or firewall), then use Check key. When the list loads, the next message uses those Groq models. The app cannot clear a Groq edge refusal by itself. Tests: Groq connectivity, tier assignment, runtime decision, and `streamChat` (refusal does not call Ollama; a successful Groq stream stays on Groq).

---

## Roadmap (hosted)

What is decided vs still leftover:

| Now | Later |
|-----|--------|
| Local = Postgres + pgvector | — |
| Cloud = DynamoDB for **app data** only (workspaces, chat, Knowledge, memory, Insights) | Finish ADR 0004: remaining `/api/*` off Amplify onto API Gateway + Lambda |
| Vendor keys → Secrets Manager; passwords → Cognito; AWS access → IAM | Same |
| Chat/warm already on API Gateway (streaming) | Same |
| Neon / Aurora | Optional future **all-SQL** cloud path if we ever want it — not mixed with Dynamo |
| Original files off hosted | Revisit S3 only if we deliberately keep binaries |

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
| Auth | Same-origin cookies; Knowledge now also sends chat’s Bearer (`sessionApiFetch`) | Bearer + CORS (already used for chat) |
| Limits | Amplify SSR timeouts/payloads | Lambda timeout/payload; streaming for chat |
| Data plane | Hosted records now go to DynamoDB (`app#userId`); Prisma still exists for **local** Postgres | One API in front of DynamoDB |

Local `npm run dev` should keep same-origin `/api/*` (`NEXT_PUBLIC_API_BASE_URL` unset). Hosted sets that URL so the **browser** talks to the gateway. Completing the split is the hosted end state; trimming SWC/esbuild is only how we stay under the cap until then.
