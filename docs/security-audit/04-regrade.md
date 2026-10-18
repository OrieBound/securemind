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
| F-10 Open gateway | Medium | **Closed in source, unapplied** | Cognito authorizer on `POST /chat`. Unverified that real sign-in tokens pass it (scope `aws.cognito.signin.user.admin`); test after apply. No WAF or reserved concurrency. |
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
