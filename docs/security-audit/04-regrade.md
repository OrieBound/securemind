# SecureMind — Re-assessment (regrade)

Date 2026-10-18, after commit `08c526c` plus a `nodemailer` upgrade. Same method and same blind spots as [01](01-executive-summary-and-verdict.md): source review, `npm audit`, the test suite, `docker compose config`, `terraform validate`. **Not done:** live AWS inspection, running the stack, probing ports, image scans, `terraform apply`.

## Verified this round

| Check | Result |
|---|---|
| `docker compose config`: published ports | Only `app` on `127.0.0.1:3000`. `db`, `floci`, `ollama` publish nothing. No host bind mount on `app`. |
| `npm audit --omit=dev` | 0 critical (was 1). 11 high, 9 moderate remain (was 13 / 9). `next`, `sharp` and `nodemailer` no longer listed. |
| `npm test` | 125 files, 1002 tests pass (was 991). |
| `tsc --noEmit` | Clean. |
| `terraform validate` | Valid (provider deprecation warnings only). |
| Fail-closed auth | New tests: production + cognito + no fallback variable returns 401 for missing and forged tokens; production + local mode returns 503 unless `ALLOW_INSECURE_LOCAL_IDENTITY=true`. |
| Docker setup code | `claimRequiresSetupCode()` is true for the Docker runtime (test). Generation in `scripts/docker/bootstrap.mjs` is syntax-checked but **not executed**. |

## Finding status

| ID | Was | Now | Note |
|---|---|---|---|
| F-01 Floci published | Critical | **Closed** (config) | Not reachable from the host network. |
| F-02 Postgres published | Critical | **Closed** (config); residual Low | Password is still the constant `securemind` inside the Compose network. |
| F-03 Next.js | Critical | **Closed** | 16.4.2. |
| F-04 Owner claim | High | **Mostly closed** | Code required and printed by `init`; claim still not atomic (Low now). |
| F-05 Fail-open auth | High | **Closed** | Production defaults fail closed. |
| F-06 `~/.aws` mount | High | **Closed** | Opt-in override only. |
| F-07 Amplify role | High | **Closed in source, unapplied** | Needs `terraform plan/apply` and a deploy check. The compute role may need further trimming once its real calls are observed. |
| F-08 Ollama published | High | **Closed** (config) | |
| F-09 No TLS | High | **Open, mitigated** | Loopback default limits exposure; no TLS recipe shipped. Documented as a requirement for any remote use. |
| F-10 Open gateway | Medium | **Closed in source, unapplied** | Cognito authorizer on `POST /chat`. Unverified that real sign-in tokens pass it (scope `aws.cognito.signin.user.admin`); test after apply. No reserved concurrency. WAF declined by the owner on cost; residual flood risk accepted (see 03, Owner decisions). |
| F-11 Other advisories | Medium | **Reduced** | 20 remain, mostly Prisma CLI and transitive packages. Parsers of untrusted files (`exceljs`, `mammoth`, `pdf-parse`) unchanged. |
| F-12 Floci as IdP, unpinned | High | **Open** | |
| F-13 No session revocation | Medium | **Open** | |
| F-14 JWT checks incomplete | Medium | **Open** | |
| F-15 No monitoring/PITR | Medium | **Open** | |
| F-16 No audit log | Medium | **Open** | |
| F-17 Admin peer takeover | Medium | **Open, now documented** | |
| F-18 Client-only redaction | Medium | **Open, now documented** | |
| F-19 to F-31 | Medium/Low | **Open** | Unchanged, except F-23's Node 20 and unpinned Actions, still open. |

Regressions found: none. Behaviour changes to know about: a production build with no `AUTH_MODE` now returns 503 on `/api/*`; existing Docker users must re-run `init` to receive a setup code before claiming an Owner (an already-claimed instance is unaffected); anyone using the old dev ports needs `docker-compose.dev.yml`.

## Grade

| Deployment | Before | After | Meaning |
|---|---|---|---|
| Self-hosted Docker, single user on localhost | Conditional | **CONDITIONAL GO** | Acceptable if the README says "single-user, localhost, add TLS and a firewall for anything else". |
| Self-hosted Docker, shared LAN or internet | NO-GO | **NO-GO** | Still no TLS, no tested lockout on the Floci IdP, no audit log, no revocation (F-09, F-12, F-13, F-16). |
| AWS, small invite-only team | Conditional | **CONDITIONAL GO** (closer) | Remaining conditions: apply and verify the Terraform changes, then PITR, deletion protection, CloudTrail and alarms (F-15), and a live-account check. |
| AWS, public or multi-organization | NO-GO | **NO-GO** | No organization boundary; Admins can impersonate members; no audit log. |

**Pass or not:** it does not fully pass. The critical and release-blocking findings are fixed in source, so it now passes for a **limited, single-user or small trusted-team release**. It does not pass the bar for general production use, because several High/Medium controls are open and the AWS changes have never run against a real account.

## Next steps, in order

1. `terraform plan` then apply in the sandbox; confirm sign-in and chat streaming through the authorizer, and that Amplify still works with the new compute role.
2. Run `docker compose up --build` from empty volumes; confirm the setup code appears in `docker compose logs init` and the claim works with and without it.
3. P1: F-13/F-14 (token revocation and strict validation), F-15 (PITR, deletion protection, CloudTrail, alarms), F-16 (audit log), TLS recipe (F-09), image signing and CI gating (F-22).

---

# Round 2 re-assessment (after P1 group 1 and AWS monitoring)

Date 2026-10-18, after commits `d8e1a8e` and `d725d59` plus the budget/WAF documentation update. Same method and blind spots as round 1: no live AWS, no running stack, no image scan, nothing applied.

## Verified this round

| Check | Result |
|---|---|
| `npm test` | 128 files, 1016 tests pass (round 1: 1002). |
| `tsc --noEmit` | Clean. |
| `npm audit --omit=dev` | 0 critical, 10 high, 9 moderate (round 1: 0 / 11 / 9). All remaining highs are transitive or Prisma CLI tooling; none is `next`, `sharp` or `nodemailer`. |
| `docker compose config` | Only `app`, on `127.0.0.1:3000`. |
| `terraform validate` (app stack and bootstrap, isolated copies) | Both valid. |

## Finding status changes since round 1

| ID | Round 1 | Round 2 | Note |
|---|---|---|---|
| F-10 Open gateway | Closed in source | **Risk accepted** | Authorizer in place; WAF declined on cost. Residual: an anonymous flood can exhaust the shared throttle. Detected by the 4xx-spike alarm and budget. |
| F-13 No revocation | Open | **Closed in source** | GlobalSignOut on logout, AdminUserGlobalSignOut on disable, suspended/deleted accounts refused. |
| F-14 JWT checks | Open | **Closed in source** | `token_use=access` and `client_id` enforced. Floci tokens not observed. |
| F-15 Monitoring/PITR | Open | **Closed in source, unapplied** | PITR, table deletion protection, CloudTrail, 5 alarms, budget ($5 default). Cognito deletion protection is a variable that must be set `ACTIVE`. Access logs off by default. |
| F-16 Audit log | Open | **Closed (API)** | No UI view yet. |
| F-31 Cognito defaults | Open | **Partial** | Deletion protection configurable; MFA still optional, no threat protection. |

Still open: F-09 (no TLS shipped), F-11 (19 dependency advisories; untrusted-file parsers), F-12 (Floci as the Docker identity provider), F-17 (Admin impersonation, documented), F-18 (client-side redaction, documented), F-19 to F-30 (Medium/Low hardening and supply chain).

## Grade, round 2

| Deployment and scope | Round 1 | Round 2 |
|---|---|---|
| Self-hosted Docker, single user on localhost | CONDITIONAL GO | **GO** for this scope. Every Critical and High finding that applies to a loopback-only single-user install is closed. Residual: plaintext data at rest on the host (F-21) and the Floci IdP (F-12), both documented. |
| Self-hosted Docker, shared LAN or internet | NO-GO | **NO-GO**. Unchanged blockers: no TLS (F-09), Floci as identity provider (F-12). |
| AWS, small invite-only team | CONDITIONAL GO | **CONDITIONAL GO**. The code and IaC now meet the bar. The remaining conditions are operational, not code: (1) re-apply bootstrap, then apply the app stack; (2) confirm sign-in and chat streaming through the authorizer and the new compute role; (3) set `cognito_deletion_protection = "ACTIVE"` and `alert_email`; (4) a read-only check of the live account. Once those pass, this becomes GO. |
| AWS, public or multi-organization | NO-GO | **NO-GO**. No organization boundary, Admin impersonation, regex-only injection filtering, no WAF. |

**Pass or not:** for the scope SecureMind is built for (one person on their own machine, or a small trusted team on their own AWS account), it now **passes on source evidence**, with the AWS pass depending on the four deployment checks above. It does **not** pass as a shared-network Docker product or a public multi-tenant service, and should not be described that way.

## Recommended next work

1. Apply and verify in the sandbox (bootstrap, app stack, sign-in, chat, an admin disable, the audit endpoint, an alarm firing).
2. F-09: a TLS reverse-proxy recipe for Docker.
3. F-22/F-23: gate image publishing on CI, sign images, pin Actions by SHA, move to Node 22.
4. F-20/F-11: upload quotas and isolating the document parsers.

---

# Round 3: prod deployment verified (2026-10-18)

What was done, on the owner's AWS account, environment `prod`:

1. Bootstrap re-applied by the owner (boundary `v2`; deploy role gained the monitoring rights).
2. App stack applied by the owner, **targeted** to `api`, `amplify`, `auth_cognito`, `data_dynamodb`, `monitoring` (23 added, 10 changed, 8 replaced). The static sites were deliberately excluded: the local `domain.auto.tfvars` marks them disabled while both are live, and a full apply would have switched them off. Reconcile that file before the next untargeted apply.
3. Amplify release job 15 built and deployed commit `db63a35`.

Verified live (read-only AWS calls and HTTP probes):

| Check | Result |
|---|---|
| `POST /chat` method | `COGNITO_USER_POOLS`, scope `aws.cognito.signin.user.admin` |
| Anonymous `POST /chat` to the gateway | 401 |
| Hosted `/api/workspaces` anonymous / forged token | 401 / 401 |
| Hosted `/api/admin/audit` anonymous | 401 |
| Owner sign-in and chat (owner test) | Streams normally; chat Lambda ran 2 invocations, 0 errors |
| DynamoDB PITR / deletion protection | ENABLED / true |
| Cognito deletion protection | ACTIVE |
| CloudTrail `securemind-prod` | Logging |
| Alarms | 5 created, none in ALARM |
| Amplify compute role | `securemind-amplify-compute-prod` (separate from the service role) |

Not done: no `alert_email`, so alarms notify nobody and no budget exists; `npm run infra:wire` was not re-run, so the Lambda `ALLOWED_ORIGIN` no longer includes `http://localhost:3000` (production unaffected); no IAM Access Analyzer or full account review.

## Grade, round 3

| Deployment and scope | Grade |
|---|---|
| AWS, small invite-only team | **GO**. The four conditions from round 2 are met (bootstrap applied, app stack applied, sign-in and chat verified, deletion protection ACTIVE) and the read-only live checks above passed. Residual risks: no alert email yet, WAF declined (accepted), open Medium/Low items in the register. |
| Self-hosted Docker, single user on localhost | **GO** (unchanged). |
| Self-hosted Docker, shared LAN or internet | **NO-GO** (unchanged: F-09, F-12). |
| AWS, public or multi-organization | **NO-GO** (unchanged). |

---

# Round 4: remaining hardening (2026-10-18)

Commits `e1f7c88` to `2187b66`. Verified: 132 files / 1035 tests pass, `tsc` clean, `next build` passes, `npm audit --omit=dev` 0 critical (10 high, 9 moderate, all transitive or tooling), all three compose variants valid, both Caddy configurations validate, and the hardened app image (Node 22, read-only, no capabilities, `no-new-privileges`) was built and started locally and served `/` with its security headers. The new publish workflow and the server-side changes have **not yet run** in GitHub or AWS (not pushed or deployed).

| ID | Before | Now |
|---|---|---|
| F-04 Owner claim race | Open (Low) | **Closed**: conditional reservation in Postgres and DynamoDB, released on failure |
| F-09 No TLS for Docker | Open | **Closed** (opt-in): `docker-compose.tls.yml` (Caddy, automatic or internal certificates), HSTS when served over HTTPS |
| F-12 Floci IdP, unpinned | Open | **Partly closed**: image pinned by digest; app-level sign-in rate limits now apply. Floci itself is still the identity provider and its internals are unverified |
| F-17 Admin peer takeover | Open | **Closed**: only the Super Admin can change another Admin (Admins can still impersonate Members, documented) |
| F-18 Client-only redaction | Open | **Closed for high-risk categories**: server replaces SSN, SIN, card numbers and secrets in every chat field; other categories remain browser-side |
| F-20 Upload/auth limits | Open | **Closed**: zip-bomb checks, per-user daily and storage quotas, extraction time limit, per-address and per-account auth rate limits (per process) |
| F-22 Image pipeline | Open | **Closed in source**: CI-gated, Trivy-scanned, immutable tags, SBOM + provenance, cosign-signed |
| F-23 Pinning / EOL Node | Open | **Closed**: Node 22, Actions by SHA, images by digest, Dependabot |
| F-24, F-26, F-27, F-28, F-30 | Open | **Closed** |
| F-11 Dependencies | Reduced | Unchanged: 19 transitive advisories; Dependabot now proposes updates |
| F-02 DB password | Partial | Unchanged: constant default inside the Compose network only (no published port) |
| F-19, F-21, F-25, F-29, F-31 | Open | Unchanged (P2/P3: regex injection filter, plaintext at rest on-prem, state-bucket KMS, CSP inline scripts, MFA optional) |

## Grade, round 4

| Deployment and scope | Grade |
|---|---|
| AWS, small invite-only team | **GO** (after this code is deployed: push, then an Amplify build and a Lambda update) |
| Self-hosted Docker, single user on localhost | **GO** |
| Self-hosted Docker, small trusted LAN | **CONDITIONAL GO** (was NO-GO): only with `docker-compose.tls.yml`, a host firewall allowing 80/443 only, and full-disk encryption. Residual: Floci as identity provider |
| Self-hosted Docker, public internet | **NO-GO**: Floci as identity provider is unverified for hostile exposure |
| AWS, public or multi-organization | **NO-GO**: no organization boundary; WAF declined |

## Round 4 deployment and supply-chain check (2026-10-18)

- Prod Lambdas updated (targeted `module.api` apply by the owner; code only) and Amplify job 16 deployed. Live: anonymous and forged requests 401; sign-in limiter returns 429 after 5 failed attempts for one address; public setup status no longer reveals whether the directory is empty.
- The first run of the new publish pipeline **blocked** a release: Trivy found fixable criticals in the `init` image (Debian `perl-base`, `proxy-addr` via the `shadcn` CLI, Go stdlib in the `esbuild` binary) and a fake GitHub token from the test corpus inside the app image. Fixed in `df57718` (patched base packages, `shadcn` moved to dev dependencies, `proxy-addr` override, dev dependencies pruned from `init`, sources and fixtures removed from the standalone output in the builder stage so they are in no layer). Both images then scanned clean locally and in CI.
- Publish run `39188794494` succeeded for both images, with sha tags. `cosign verify` of `ghcr.io/oriebound/securemind:latest` succeeded against the `publish-image.yml` workflow identity.
- **Open, owner decision:** the GHCR package `securemind` is **private**, so anonymous pulls fail (401) and the documented `docker-compose.pull.yml` path and `cosign verify` do not work for customers. Make the package public, or document building from source as the only path.

---

# Round 5: full re-verification (2026-10-19)

No code changed since round 4 (`428bd22` locally and on GitHub). Everything was re-run fresh.

**Automated:** 132 files / 1035 tests pass; `tsc` clean; `next build` passes; `npm audit --omit=dev` 0 critical (10 high, 9 moderate, all transitive or Prisma tooling); app and bootstrap Terraform validate; compose publishes only `127.0.0.1:3000` and mounts no AWS directory; tracked-tree secret scan finds only marked test fixtures; latest CI and signed publish on `428bd22` succeeded.

**Live, hosted (HTTP):** anonymous `/api/workspaces` and `/api/admin/audit` 401; forged token 401; anonymous `POST /chat` at the gateway 401; HSTS, CSP, `X-Frame-Options: DENY` and `nosniff` present.

**Live, AWS (read-only, owner's account):** `POST /chat` uses the Cognito authorizer; DynamoDB PITR enabled and deletion protection on; Cognito deletion protection ACTIVE; CloudTrail logging; Amplify runs on the separate compute role with no AWS-managed policies attached; 5 alarms, none firing; chat Lambda 16 invocations and 0 errors in 24 h on `nodejs22.x`; avatar and trail buckets block public access; both `/securemind/prod` parameters are SecureString.

**Gap found:** the alert topic has **0 subscriptions** and **no budget** exists, because `alert_email` was never set. The alarms work but notify nobody.

## Verdict, round 5

| Deployment and scope | Grade |
|---|---|
| AWS, small invite-only team | **GO**, with one operational action: set `ALERT_EMAIL` and re-apply `module.monitoring` so alarms and the $5 budget reach someone |
| Self-hosted Docker, single user on localhost | **GO** |
| Self-hosted Docker, small trusted LAN | **CONDITIONAL GO** (HTTPS front end, firewall allowing 80/443 only, disk encryption) |
| Self-hosted Docker, public internet | **NO-GO** (Floci as identity provider unverified for hostile exposure) |
| AWS, public or multi-organization | **NO-GO** (no organization boundary; WAF declined) |

Remaining lower-priority items: F-11 transitive advisories (Dependabot now proposes updates), F-12 Floci, F-19 regex injection filter, F-21 plaintext at rest on-prem, F-25 state-bucket KMS, F-29 inline-script CSP, F-31 MFA optional for Admins, F-02 default DB password inside the Compose network, and the static-site setting in the local `domain.auto.tfvars` that disagrees with the live sites.

**Update (2026-10-19):** gap closed. `alert_email` set for the owner's own install only (in the git-ignored `.env.deploy`, never in the repository); targeted `module.monitoring` apply by the owner added a confirmed email subscription on the alert topic and the `securemind-prod-monthly` $5 budget. `infra/scripts/lib.mjs` now passes `ALERT_EMAIL`, `MONTHLY_BUDGET_USD` and `COGNITO_DELETION_PROTECTION` from `.env.deploy`, so a later `npm run infra:up` no longer reverts deletion protection or drops the alerts. AWS, small invite-only team: **GO**, no open operational actions.

---

# Round 6: disposition of the remaining items (2026-10-22)

Before the repository was made public, every item still marked open was given a recorded outcome. A finding is either **fixed** or **accepted by the owner** with the reason and the event that should reopen it. Nothing was left as "open" without one of those. Accepted does not mean unimportant: each one is a known limit that the documentation states.

**Code changes in this round**

- **F-19:** a retrieved document that contained the fence markers (`BEGIN_RETRIEVED_EVIDENCE` / `END_RETRIEVED_EVIDENCE`) could close its own block and put text outside it. Those markers are now neutralized in untrusted text. New adversarial tests (`src/lib/prompt-guard.corpus.test.ts`) pin both halves: wording the filter catches, and wording it knowingly does not (paraphrase, other languages, spaced or zero-width letters). If a known limit is ever caught, the test says so and the entry moves.
- **F-11:** `uuid` raised to 11.1.1 and `vite` to 8.3.x through package overrides. Spreadsheet read and write were checked in the rebuilt image. Two advisories remain (below).

| ID | Outcome | Why, and what reopens it |
|---|---|---|
| F-02 Default database password | **Accepted** | The database has no published port and is reachable only on the Compose network. `POSTGRES_PASSWORD` can be set before the first start and the docs say to. Reopen if the Compose file ever publishes the database port. |
| F-11 Dependencies | **Mostly fixed; two accepted** | `sprintf-js` (reached through the Word reader's command-line help text, never on file contents) and `braces` (reached through the `shadcn` developer CLI, which does not run in the app) have no patched release. Reopen when Dependabot offers a fix. |
| F-12 Floci as identity provider | **Accepted, scope-limited** | Docker installs are for one computer or a trusted network, and the verdict marks public-internet exposure NO-GO. The image is pinned by digest and sign-in is rate-limited. Reopen before any claim of internet-facing Docker. |
| F-19 Prompt-injection filter | **Fixed as far as the design allows** | Marker gap closed and limits pinned by tests (above). It stays defense in depth: the controls that matter are the fenced prompt, a chat path with no tools, and retrieval scoped to the signed-in user. Reopen before any tool or action is added to chat. |
| F-21 Plaintext at rest on Docker | **Accepted, documented** | Full-disk encryption is a stated requirement for any shared or portable machine. The on-prem backup command writes plaintext dumps. Reopen if encrypted backups are wanted. |
| F-25 Terraform state contents | **Accepted** | The state bucket is versioned, encrypted with S3-managed keys and blocks public access. It is not KMS-encrypted and has no access logging, which would add a recurring cost for a one-person install. Written rotation steps for the instance key are not yet in the docs. Reopen if the install grows past a small team. |
| F-29 Inline scripts in the CSP | **Accepted** | A nonce-based policy needs middleware changes across the app. Mitigations: chat markdown is rendered without raw HTML, no third-party scripts, strict connect and frame sources, HSTS on the cloud edition and from the HTTPS front end. Reopen when nonces are practical for the framework version in use. |
| F-31 Cognito defence in depth | **Accepted** | Two-step verification is optional by design (Cognito's required mode is all-or-nothing) and the app recommends it to anyone who manages people or keys. Deletion protection is active on the live install. Compromised-credential checks are not enabled, because they cost extra. Reopen if the install gains more administrators. |

The verdict table in Round 5 is unchanged by this round.
