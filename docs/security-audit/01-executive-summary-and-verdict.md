# SecureMind — Security Assessment: Executive Summary and Release Verdict

- **Assessed commit:** `ce86dd3` (branch `main`, clean tree), 2026-10-18
- **Method:** static review of source, Docker, Terraform/CloudFormation and CI; dependency audit; git-history secret scan; existing test suite. Reference frameworks: OWASP ASVS, OWASP Top 10 / API Top 10, Docker hardening practice, AWS Well-Architected Security Pillar.
- **Companion files:** [02-findings-register.md](02-findings-register.md), [03-remediation-plan.md](03-remediation-plan.md)
- **No application code or infrastructure was modified. No secret values appear in these files.**

## Final verdict (2026-10-19, after five rounds)

**PASS for its intended scope.** SecureMind is suitable for production use by **one person or one small, trusted team, on infrastructure they control**: Docker on their own computer, Docker on a trusted LAN behind the included HTTPS front end, or their own AWS account. Every Critical and High finding that applies to that scope is closed, and the AWS install was verified live (see [04-regrade.md](04-regrade.md), round 5). This is a judgment on demonstrated controls, not a guarantee: no software is "fully secure", and product copy should still describe it as risk reduction, not as secure or compliant.

**Out of scope, not a failure:**

- *Docker exposed directly to the public internet.* The Docker install is meant for a computer or a private network, and by default it listens only on the computer itself. If someone puts it on the internet anyway, the sign-in runs on Floci, an AWS emulator that was not built or tested for hostile traffic. Use the AWS install (real Cognito) for anything internet-facing.
- *Several separate organizations sharing one install.* Each install is one team. Users' data is kept apart from each other, but Admins can see usage across the install and can reset a Member's password (which lets them sign in as that Member). That is normal for one team; it is not a safe way to host unrelated companies on one install. Separate organizations should each run their own install.
- *AWS WAF.* Declined by the owner on cost (about $5 to $6 a month). The Cognito authorizer, request throttling, the 4xx alarm and the budget alert cover the main risk. Operators who want WAF can add it to their own account.

**Remaining lower-priority items** (none blocks the scope above): transitive dependency advisories (Dependabot proposes updates), regex-based prompt-injection filtering, plaintext data at rest on Docker unless the disk is encrypted, inline scripts allowed by the CSP, two-step verification optional for Admins.

## What this assessment could and could not verify

| Verified directly | Not verified (stated as such throughout) |
|---|---|
| Source code, compose file, Dockerfile, Terraform, CI workflows (read in full for the security-critical paths) | **The live AWS account.** The AWS connector was not authorized in this session, so every AWS conclusion is *from source configuration only*. Drift, actual IAM, CloudTrail state and deployed settings are unknown. |
| `npm test`: 124 files / 991 tests pass | **Dynamic testing.** No running stack was probed, so exploitability of the Docker exposure findings is derived from configuration, not demonstrated. Floci's behaviour (does it accept `test/test`, does it lock accounts out) is an assumption flagged on each finding. |
| `npm audit` (all and production-only) | Static analysers (Semgrep/CodeQL), container image scanners (Trivy/Grype) and Terraform scanners (tfsec/Checkov) were not available in this environment. Coverage is manual plus `npm audit`. |
| Git history (347 commits) scanned for key patterns: only documented test fixtures (`AKIAIOSFODNN7EXAMPLE`, a fake `ghp_` token in `docs/test-files`) matched | Pen-test style cross-tenant tests against a running DB. Isolation was assessed by reading every data-access path, plus the existing mocked `tests/authz.test.ts` (23 cases). |

## Overall posture

SecureMind's **application-layer design is better than most projects of its size**. Identity comes from one function, the user-owned tables are consistently scoped by `userId`, vector search filters on `userId` inline, vendor keys are encrypted at rest and never returned, AWS credentials are never accepted through the UI, the deploy role in `infra/terraform/bootstrap` is unusually well constrained (numeric repository IDs, one named environment, permission boundary, self-edit denied), and the sensitive-data tooling is honest about its limits.

The weaknesses are concentrated in two places: **(1) the self-hosted Docker stack is a development stack presented as the on-prem product**, and **(2) several defaults fail open** (authentication fallback, setup claim, no rate limits). There is also a **dependency problem that needs a same-day fix**: the pinned Next.js 16.2.6 is flagged with critical advisories.

## Strengths (verified)

1. Single identity source (`getIdentity`), with `AUTH_ALLOW_LOCAL_FALLBACK=false` set in all hosted IaC (`modules/api/main.tf:153`, `modules/amplify/main.tf:344`) and in `docker-compose.yml`.
2. Every non-public API route calls `getIdentity`; every admin route calls `requireAdmin`. A route-by-route scan found no unauthenticated data route. Public ones: login, MFA login step, forgot/confirm password, signup (hard 403), setup status, setup claim, logout.
3. Tenant scoping is consistent: Prisma `findFirst({id, userId})`, hosted store partitioned `app#<userId>`, raw pgvector SQL filters `mf."userId" = $1` (`src/lib/memory.ts:142`), DynamoDB vector index has `userId` as an inline filter and the adapter throws if `userId` is missing (`dynamodb-vectors.ts:77`).
4. Self-service sign-up is disabled; invite-only Cognito (`allow_admin_create_user_only = true`); no demo accounts.
5. No SSRF surface: every outbound `fetch` targets a fixed vendor host or an env-configured Ollama URL, never a user-supplied URL.
6. No XSS sink: the only `dangerouslySetInnerHTML` is a constant theme script; markdown is rendered without raw HTML; avatars are magic-byte checked and SVG is rejected; CSP restricts `img-src`/`connect-src`, which also blocks image-beacon exfiltration from model output.
7. Chat path has no tool/agent invocation (no `tool_use`/function-calling code), which keeps prompt-injection blast radius to "wrong or misleading answer", not "action taken".
8. Secrets handling: vendor keys encrypted with AES-256-GCM, masked in responses, hosted keys in SSM SecureString, AWS creds forced through the SDK chain, state bucket versioned/encrypted/public-blocked.
9. Developer independence (see below) is clean.
10. Security-header tests, authz tests, throttle tests and Terraform assertions exist in the suite.

## Most important weaknesses

| # | Finding | Severity |
|---|---|---|
| F-01 | Compose publishes the **Floci identity provider** (port 4566, credentials `test/test`) on all interfaces | **Critical** (Self-hosted) |
| F-02 | Compose publishes **Postgres** (port 5432) with the fixed login `securemind/securemind` | **Critical** (Self-hosted) |
| F-03 | Next.js **16.2.6** carries critical/high advisories (RCE variants, middleware bypass, SSRF, cache poisoning); fix available in a non-major bump | **Critical until upgraded** (both) |
| F-04 | On-prem first-run **owner claim has no secret**; whoever reaches port 3000 first owns the instance | **High** (Self-hosted) |
| F-05 | **Auth fails open**: unset `AUTH_ALLOW_LOCAL_FALLBACK` means any bad/missing token is treated as local Super Admin | **High** (both; mitigated in shipped IaC) |
| F-06 | Whole host `~/.aws` directory bind-mounted into the internet-facing app container | **High** (Self-hosted) |
| F-07 | **Amplify compute role** = `AdministratorAccess-Amplify` + Cognito admin + `bedrock:*Invoke*` on `*` | **High** (AWS) |
| F-08 | Ollama (11434) published unauthenticated | **High** (Self-hosted) |
| F-09 | No TLS anywhere in the on-prem stack, and no documented reverse proxy | **High** (Self-hosted) |
| F-10 | Open API Gateway (`authorization = NONE`), one shared global throttle, no WAF: an anonymous flood starves real users | **Medium** (AWS) |

Full list (31 findings) in the register.

## Developer independence (Question 2 and 8)

**Verified clean.** In the tracked tree and all 347 commits there are no real credentials, no private keys, no developer account IDs, no telemetry/analytics endpoints, and no call-home or remote-access path. The only author references are ordinary public ones: the GitHub repo URL, `ghcr.io/oriebound/securemind` image defaults in `docker-compose.pull.yml`, `NOTICE`, `SECURITY.md`, and a contact-page link.

Disclosed legitimate dependencies a customer should be told about:
- **`ghcr.io/oriebound/securemind:{latest,init}`** if they use the pull compose file. That is a *trust relationship with the author's registry and GitHub account*: whoever controls that account can change what customers run (see F-22). Building from source removes it.
- Third-party images: `pgvector/pgvector:pg16`, `floci/floci:latest`, `ollama/ollama:latest`, `node:20-bookworm-slim`.
- First-boot downloads: Ollama model weights from ollama.com; `npm ci` from the npm registry during build.
- Outbound to AI vendors only when an Admin configures them (Groq, OpenAI, Anthropic, Google, xAI, Bedrock). The catalog call to `api.groq.com/openai/v1/models` is the only fixed vendor URL contacted without a user-entered key being the trigger.

One local-hygiene note, not a customer risk: your working tree contains git-ignored files (`.env.deploy`, `.env.local`, `infra/terraform/bootstrap/terraform.tfstate`, `cursor-history/`, `build-log.txt`). They are correctly ignored by git and `.dockerignore` excludes `.env*` and `infra`, but `.dockerignore` does not list `cursor-history/`, `build-log.txt`, `.claude/` or `*.bak`. Only build from a clean CI checkout, never from this folder (F-24).

## Deployment security assessments

### 1. Docker / self-hosted — **NO-GO as the production default**
`docker-compose.yml` is a developer convenience stack: every backing service publishes a host port on `0.0.0.0` with default or no authentication (F-01, F-02, F-08), the identity provider is a third-party AWS emulator pinned to `:latest` (F-12), there is no TLS (F-09), no capability dropping, no resource limits, no read-only root, and the app container mounts the host's `~/.aws` (F-06). The app image itself is decent: multi-stage, non-root UID 1001, standalone output, health check. Safe today **only** on a single-user machine reached via `localhost`, with Docker's published ports firewalled from the LAN. It should not be offered as an internet-facing or shared-LAN production deployment until P0 items are closed.

### 2. AWS cloud — **CONDITIONAL GO (source-only evidence)**
The architecture is sound for a small invite-only team: Cognito invite-only with optional TOTP, Lambda verifies the JWT itself, DynamoDB partitioned per user, SSM SecureString for secrets, least-privilege-style deploy role with boundary. Conditions: fix F-03, F-07, F-10; turn on the monitoring and backup items in F-15; verify the live account (nothing here was verified live).

### 3. Authentication and credentials — **Needs Improvement**
Good: managed Cognito, TOTP, enumeration-safe forgot-password, closed sign-up, password policy 12+ chars, no custom password hashing. Weak: fail-open fallback (F-05), tokens not revoked on logout or suspension (F-13), `token_use`/`client_id` not strictly validated (F-14), no app-level throttling, peer Admins can take over each other (F-17), no audit log (F-16), MFA only optional.

### 4. User and workspace isolation — **Pass with caveats**
Application-enforced and consistently applied; no IDOR/BOLA found on any route reviewed. Caveats: isolation is entirely in application code (one IAM role, one table, no per-tenant IAM condition), `memory.ts` defaults `userId` to `"local"` (F-27), and Admins can impersonate members by setting their password (F-17). It is a single-organization model; it is **not** a multi-tenant organization boundary and must not be sold as one.

### 5. AI, RAG and sensitive data — **Needs Improvement**
Good: evidence fencing, citation audit, vector `userId` filter, memory only from user statements, no restore path, CSP blocks beacon exfil, no tools. Weak: redaction is **client-side only** and the Admin sensitivity policy cannot be enforced against a crafted request (F-18); injection filtering is a regex denylist (F-19); no per-user upload/storage quotas and untrusted-file parsers with known advisories (F-20, F-11); no output scanning.

### 6. GitHub distribution and developer independence — **Pass, with supply-chain gaps**
No developer credential or data path. Supply-chain controls are thin: image published on every push to `main` without waiting for CI, mutable tags only, no signing/SBOM/scan, actions pinned by tag, base images unpinned (F-22, F-23).

## Production readiness matrix

| Security domain | Self-hosted | AWS |
|---|---|---|
| Application security | Needs Improvement (F-03, F-19, F-20) | Needs Improvement (F-03, F-10) |
| Authentication | Needs Improvement (F-04, F-05, F-12) | Needs Improvement (F-05, F-13, F-14) |
| Authorization | Pass (route scan, 23 authz tests) | Pass |
| Tenant isolation | Pass with caveats (F-17, F-27); not an org boundary | Pass with caveats; not verified live |
| Secrets management | Needs Improvement (F-06, key beside data F-21) | Needs Improvement (F-07; state holds secrets F-25) |
| Encryption at rest | Fail (no volume/DB/app-level encryption of conversations or originals; documented only as host responsibility) | Needs Improvement (AWS-managed keys only; verified in source, not live) |
| Encryption in transit | Fail (all hops plain HTTP, no TLS) | Pass in source (HTTPS endpoints, HSTS); not verified live |
| Network security | Fail (F-01, F-02, F-08) | Needs Improvement (public API, no WAF; no VPC is acceptable for this stack) |
| Credential independence | Pass | Pass |
| Data privacy | Needs Improvement (F-18; plaintext at rest) | Needs Improvement (F-18; log retention/PITR unknown) |
| Container security | Fail (F-12, F-26: `:latest`, EOL Node 20, no hardening) | Not Applicable (Lambda/Amplify) |
| Supply-chain security | Needs Improvement (F-22, F-23) | Needs Improvement (F-22; Actions by tag) |
| AI / RAG security | Needs Improvement | Needs Improvement |
| Logging and monitoring | Fail (no audit log, no alerting) | Fail (no CloudTrail/alarms/WAF in IaC; not verified live) |
| Backup and recovery | Needs Improvement (`backup:onprem` script exists; untested; key in separate volume) | Needs Improvement (PITR off, F-15) |
| Production deployment | Fail | Needs Improvement |

## Final independent verdict

| Deployment | Decision |
|---|---|
| **Self-hosted (Docker)** | **NO-GO** for general distribution as a production deployment. **CONDITIONAL GO** for "single user, localhost only, firewalled" use if the README says exactly that and F-03 is fixed. |
| **AWS (Amplify + API Gateway + Lambda + Cognito + DynamoDB)** | **CONDITIONAL GO** for a small, invite-only, trusted-team release, subject to P0 and the AWS P1 items. **INSUFFICIENT EVIDENCE** about the live account. |

### Direct answers

1. **Safe to distribute for self-hosting?** Not as a production product. Fine as a clearly labelled local/single-user tool after P0 fixes to the compose file (bind to `127.0.0.1`, no DB credentials exposed) and upgrading Next.js.
2. **Can customers operate it without exposing data or credentials to you?** Yes. Verified: no credentials, telemetry, call-home or remote-access path. The only author-controlled trust point is the optional GHCR image (F-22).
3. **Docker deployment appropriately secured for production?** No. See F-01, F-02, F-04, F-06, F-08, F-09, F-12.
4. **AWS architecture secure enough for confidential customer information?** For a small trusted team, yes after F-03, F-07, F-10 and the monitoring/backup gaps. Not demonstrated for a hostile multi-organization environment, and not verified against the live account.
5. **Encryption and secret management correct?** Secret handling is largely correct (AES-256-GCM, SSM SecureString, masking, no AWS keys). Encryption of the *content* (messages, documents, memory) is provider-managed on AWS and absent at the application and volume level on-prem. Both are defensible if stated plainly; neither is customer-managed (no CMK).
6. **Users/workspaces/orgs see only authorized data?** Users and workspaces: yes, by code review and tests. Organizations: there is no organization concept; one install = one tenant. Admins can see more than members by design, and can impersonate by password reset.
7. **AI, RAG and memory isolated?** Yes at the query layer (userId on SQL and on the DynamoDB inline filter). Redaction and injection defenses are best-effort, not enforcement.
8. **Undisclosed external connections or developer access?** None found. Disclosed ones are listed above.
9. **Realistic risk if public on the internet?** Self-hosted: near-certain compromise by scanning (open Postgres/Floci/first-owner claim). AWS: credential stuffing against Cognito (managed lockout helps), anonymous request floods that starve legitimate users and run up Lambda/SSM cost, and exposure to any unpatched Next.js flaw until upgraded.
10. **Required before launch:** the P0 list in [03-remediation-plan.md](03-remediation-plan.md): upgrade Next.js; fix the compose exposure; make auth fail closed; add a secret to the on-prem owner claim; split the Amplify role; put a Cognito authorizer or WAF in front of the API.

## Blind spots and their effect on the verdict

- No live AWS inspection: the AWS verdict could move either way (a stricter live account would help; drift would hurt).
- No dynamic exploitation of the compose exposure: severity rests on the compose file being run as written, which the README instructs. If Floci rejects `test/test`, F-01 drops to High; the port exposure and Postgres exposure stand regardless.
- Static scanners and image scanners not run; a Trivy pass over `ghcr.io/oriebound/securemind:latest` and the base images will add OS-package CVEs not counted here.
- Next.js advisory reachability (which routes use the vulnerable features) was not exhaustively traced; the upgrade is cheap enough that tracing is unnecessary.
