# SecureMind — Remediation Plan

Assessed commit `ce86dd3`, 2026-10-18. Finding IDs refer to [02-findings-register.md](02-findings-register.md). Effort: S = under half a day, M = 1–2 days, L = several days.

## P0 — Mandatory before release

| # | Action | Findings | Effort |
|---|---|---|---|
| 1 | Upgrade Next.js to the fixed line (`npm audit` reports 16.4.2, non-major). Run `npm test`, rebuild and republish the image, redeploy Amplify. Also run `npm audit fix` for the other non-breaking production advisories. | F-03, F-11 | S |
| 2 | Compose: remove the `ports:` for `db`, `floci`, `ollama` (keep only `app`, bound `127.0.0.1:3000:3000` by default, with a documented override). Put the backing services on an internal-only network. Move the developer workflow's published ports into `docker-compose.dev.yml`. | F-01, F-02, F-08 | S |
| 3 | Generate the Postgres password at first boot (random, stored in a volume or `.env`); never ship `securemind/securemind`. | F-02 | S |
| 4 | Remove the default `~/.aws` bind mount. Provide an opt-in override file for Bedrock-on-Docker that mounts a single dedicated profile directory. | F-06 | S |
| 5 | Require a setup code for the on-prem owner claim (printed once by `init`), and make the claim atomic. | F-04 | M |
| 6 | Make authentication fail closed: in production builds refuse to run unauthenticated unless `ALLOW_INSECURE_LOCAL_IDENTITY=true` and bound to loopback; default `AUTH_ALLOW_LOCAL_FALLBACK` to `false`; delete the `"true"` example from `.env.example`; add a unit test. | F-05 | S |
| 7 | Split the Amplify role: build/service role keeps Amplify admin; compute role gets only scoped DynamoDB, SSM, S3, Cognito (pool ARN), and named Bedrock models. Remove `AdministratorAccess-Amplify` from compute. Scope Lambda Bedrock access to specific model/profile ARNs. | F-07 | M |
| 8 | Put a Cognito authorizer (and ideally a WAF rate rule) in front of `/chat`; keep the Lambda's own token check. Set reserved concurrency on the chat Lambda. | F-10 | M |
| 9 | Documentation: state that the Docker stack is single-user/localhost unless TLS and a firewall are added; state that Admins can impersonate members; state that chat redaction does not defend against a crafted request. Do not use "production-ready" for the Docker stack. | F-09, F-17, F-18 | S |

**Exit criteria for P0:** an external port scan of a default `docker compose up` host shows nothing except 3000 (or nothing, if loopback-only); `npm audit --omit=dev` shows no critical; a cold start with `AUTH_MODE=cognito` and no fallback variable returns 401 to anonymous requests; the Amplify compute role has no AWS-managed admin policy.

## P1 — Strongly recommended before general availability

| # | Action | Findings | Effort |
|---|---|---|---|
| 10 | TLS for on-prem: optional Caddy service with automatic certificates, or a documented reverse-proxy recipe; enable HSTS when the public URL is https. | F-09, F-29 | M |
| 11 | Replace or fence Floci as the production IdP: pin by digest and add lockout/token-tamper tests, or implement local auth you control (Argon2id, signed sessions). | F-12 | L |
| 12 | Session lifecycle: `GlobalSignOut` on logout and on admin disable/delete; check profile status in `getIdentity`; require `token_use=access` and strict `client_id`; remove the Floci issuer host swap outside local dev. | F-13, F-14 | M |
| 13 | Persisted audit log of admin and security-sensitive actions, with a Super Admin view. | F-16 | M |
| 14 | AWS monitoring and recovery in Terraform: DynamoDB PITR, Cognito `deletion_protection = ACTIVE` for production, CloudTrail, API stage access logs, alarms (Lambda errors/throttles, 4xx/5xx), AWS Budget. | F-15, F-31 | M |
| 15 | Image supply chain: publish only after CI passes or on release tags; immutable version tags; cosign keyless signing; SBOM and provenance; Trivy scan in CI; document `cosign verify`. | F-22 | M |
| 16 | Pin and update: Node 22 LTS in Dockerfile and CI; Actions pinned by SHA; images pinned by digest; Dependabot for npm, Actions and Docker. | F-23 | S |
| 17 | Upload hardening: per-user/instance quotas, archive-size and ratio limits, extraction timeout in a worker, rate limiting on upload and auth routes. | F-11, F-20 | M |
| 18 | Admin separation: Super Admin required for password-set/MFA-reset on Admin accounts; prefer reset-link over set-password. | F-17 | S |
| 19 | Server-side detection gate on chat (same `pii.ts`, Admin policy). If deferred, keep the P0 documentation in item 9. | F-18 | L |
| 20 | Container baseline: `cap_drop: [ALL]`, `no-new-privileges`, read-only root with tmpfs, memory/CPU/PID limits, health checks for every service, non-root where the image allows. | F-26 | M |
| 21 | Run the live-account checks that this assessment could not: IAM Access Analyzer, `terraform plan` for drift, confirm the bucket and parameter settings, review CloudTrail. | all AWS | S |

## P2 — Post-release hardening

| # | Action | Findings |
|---|---|---|
| 22 | Encrypt `backup:onprem` output; document full-disk encryption as a customer requirement; support secrets via Docker secrets. | F-21 |
| 23 | Make `userId` a required parameter in `memory.ts`; add a lint rule against string-literal user ids. | F-27 |
| 24 | Trim `/api/setup/status` to the minimum for the wizard. | F-28 |
| 25 | Nonce-based CSP to drop `'unsafe-inline'`. | F-29 |
| 26 | Fix `Content-Disposition` encoding (`filename*`). | F-30 |
| 27 | Tighten `.dockerignore`; build releases only in CI. | F-24 |
| 28 | State-bucket hygiene: KMS key, access logging, restrictive bucket policy; document instance-key rotation. | F-25 |
| 29 | Adversarial prompt-injection corpus in CI; keep the chat path tool-free or authorize each tool per user before adding any. | F-19 |
| 30 | Cognito threat protection and admin-enforced MFA. | F-31 |
| 31 | Live cross-tenant integration test against Postgres and DynamoDB with two synthetic users (every `[id]` route, vector search, export). | isolation |

## P3 — Future enterprise enhancements

- Organization/tenant model with per-tenant IAM conditions (`dynamodb:LeadingKeys`) or per-tenant tables.
- Customer-managed KMS keys and optional application-level envelope encryption of conversations and documents.
- SSO/OIDC federation and SCIM; enforced MFA with hardware keys.
- Immutable audit export (S3 Object Lock), SIEM integration.
- Malware scanning of uploads; DLP on model output.
- Formal third-party penetration test and a vulnerability disclosure policy with response times.
- Multi-region backup and a tested disaster-recovery runbook.

## Validation checklist (run after P0)

```bash
npm ci && npm test && npm audit --omit=dev            # no critical, tests green
docker compose up -d --build
docker compose ps --format json | jq '.[] | {Name, Publishers}'   # only app:3000 (loopback)
nmap -Pn -p 3000,4566,5432,11434 <host-LAN-IP>          # run from another machine
curl -i http://<host>:3000/api/workspaces                # expect 401, not 200
```

For AWS (after P0 item 7 and 8): attach the policy simulator to the compute role for `amplify:UpdateApp`, `cognito-idp:DeleteUserPool`, `bedrock:InvokeModel` on an unlisted model (all denied); `curl -i -X POST $API/chat` with no token returns 401 from the gateway with no Lambda invocation recorded.

---

## P0 implementation status (2026-10-18)

| # | Status | Notes |
|---|---|---|
| 1 | Done | Next.js 16.4.2; critical advisory cleared; `npm audit fix` failed with an npm internal error, so 20 high/moderate advisories remain (F-11). |
| 2 | Done | `db`, `floci`, `ollama` unpublished; app on `127.0.0.1:3000` (`SECUREMIND_BIND_ADDR`). Dev ports in `docker-compose.dev.yml` (loopback). |
| 3 | Partial | `POSTGRES_PASSWORD` is now configurable, default still `securemind`. The DB is no longer reachable from outside the Compose network. A random per-install password needs a migration path for existing volumes and was not done. |
| 4 | Done | `~/.aws` mount removed; opt-in `docker-compose.bedrock.yml`. |
| 5 | Partial | `init` generates and prints a one-time setup code; the claim requires it in the Docker runtime. The claim is still not atomic. |
| 6 | Done | Production defaults fail closed; `ALLOW_INSECURE_LOCAL_IDENTITY` opt-in; tests added. |
| 7 | Done in source, not applied | Separate `securemind-amplify-compute-<env>` role; Bedrock invoke scoped to model/profile ARNs. Needs `terraform plan/apply` and an Amplify deploy check. |
| 8 | Done in source, not applied | Cognito authorizer on `POST /chat` (scope `aws.cognito.signin.user.admin`). Verify a real sign-in streams successfully after apply. Reserved Lambda concurrency and WAF not added (new accounts have low concurrency quotas). |
| 9 | Done | `SECURITY.md` and on-prem doc updated. |

## P1 implementation status (first group, 2026-10-18)

| # | Status | Notes |
|---|---|---|
| 12 (F-13, F-14) | Done | `assertAccessTokenClaims` requires `token_use=access` and the configured `client_id` (real Cognito fails closed if the client id is unset); applied in `getIdentity` and `middleware`. Logout calls Cognito `GlobalSignOut`; admin disable calls `AdminUserGlobalSignOut`; `getIdentity` refuses `suspended`/`deleted` profiles (30 s cache; a failed lookup does not block). The Amplify compute role and the permission boundary gained the Cognito admin actions the console already used (`AdminDisableUser`, `AdminEnableUser`, `AdminRemoveUserFromGroup`, `AdminResetUserPassword`, `AdminSetUserMFAPreference`, `AdminUserGlobalSignOut`). **The bootstrap stack must be re-applied for the boundary change.** Floci token claims were not observed; the Floci path is only held to "if `token_use` is present it must be `access`". |
| 13 (F-16) | Done (API) | Append-only `AuditEvent` (Postgres, new migration) / `app#_audit` partition (DynamoDB). Recorded: user create, role change, password set, password-reset request, MFA reset, enable/disable/status, cost cap, provider settings, security policy. `GET /api/admin/audit` (Admin only). No UI view yet; Admin password changes by the user themselves and sign-ins are not logged. |
| 18 (F-17) | Not started | |

## P1 implementation status (AWS monitoring and recovery, 2026-10-18)

| Item | Status | Notes |
|---|---|---|
| DynamoDB PITR + deletion protection | Done in source | `fragments.cfn.yaml`. Applies as an in-place stack update. |
| Cognito deletion protection | Done in source | Root variable `cognito_deletion_protection` (default `INACTIVE` for sandboxes). **Set `ACTIVE` for a real install.** |
| CloudTrail | Done in source | `modules/monitoring`: multi-region management trail, private TLS-only versioned bucket, 1-year expiry, log validation. `enable_cloudtrail = false` if an organization trail exists. |
| Alarms | Done in source | Chat Lambda errors/throttles, API 5xx, API 4xx spike, DynamoDB throttles, to an SNS topic. |
| Budget | Done in source | Needs `alert_email`; `monthly_budget_usd` default 20. |
| API stage access logs | Done in source, **off by default** | `enable_api_access_logs`. Needs the account-level API Gateway CloudWatch role, which this stack does not create. |
| Deploy role permissions | Done in source | `bootstrap/main.tf` gained scoped CloudTrail, SNS, Budgets, alarm and trail-bucket rights. **Re-apply the bootstrap stack before the next CI deploy**, or `enable_monitoring = false`. |

Not applied and not run against AWS. `terraform validate` passes on an isolated copy. Alarm thresholds are starting points. Email subscriptions need a confirmation click.
