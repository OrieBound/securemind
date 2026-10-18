# SecureMind — Findings Register

Assessed commit `ce86dd3`, 2026-10-18. See [01-executive-summary-and-verdict.md](01-executive-summary-and-verdict.md) for scope and blind spots.

**Status key:** *Confirmed* = seen directly in code/config as written. *Config* = a risky configuration whose impact depends on how it is run. *Suspected* = reasoned from code, not demonstrated. *Unverified* = needs the live environment.
**Deployment key:** SH = self-hosted Docker, AWS = Amplify/Lambda/Cognito/DynamoDB, Both.
Line numbers refer to the assessed commit. No secret values are reproduced.

---

## Critical

### F-01 — Floci identity provider published to the network with known credentials
- **Severity:** Critical · **Model:** SH · **Status:** Confirmed (config); Floci's acceptance of the fixed credentials is Suspected
- **Where:** `docker-compose.yml:35-37` (`4566:4566`), app and init env `AWS_ACCESS_KEY_ID: test` (`:91`, `:122`)
- **Evidence:** the port is published on all host interfaces. The same stack runs real sign-in through Floci's Cognito emulation. AWS-emulator endpoints do not validate credentials, so `test/test` is conventional.
- **Attack:** anyone who can reach the host calls Cognito `AdminCreateUser` / `AdminSetUserPassword` / `AdminAddUserToGroup` against `host:4566`, creates an account in the `Owner` group, signs in at the real login page, and holds Super Admin without ever touching the app.
- **Impact:** total loss of confidentiality/integrity of the instance (all conversations, documents, vendor keys can be used or read).
- **Likelihood/exploitability:** high on any non-single-user network; trivial scripting.
- **Fix:** bind to loopback or remove the `ports:` entry (the app reaches `floci` by service name). Add `networks:` so only `app`/`init` join. Longer term, replace Floci as the production IdP (F-12).
- **Blocks release:** Yes. **Validate:** `nmap -p 4566 <host-LAN-IP>` is closed; `curl http://<LAN-IP>:4566` from another machine fails; sign-in still works.

### F-02 — PostgreSQL published with fixed credentials
- **Severity:** Critical · **Model:** SH · **Status:** Confirmed (config)
- **Where:** `docker-compose.yml:18-19`, `:21-22` (`POSTGRES_USER/PASSWORD: securemind`), repeated in `DATABASE_URL` for `init` and `app`
- **Attack:** `psql -h host -U securemind` with the password printed in the repo reads every conversation, document, fact and the encrypted vendor keys; can write rows (including `InstanceConfig`) or drop data.
- **Fix:** remove the port mapping; generate a random password at first boot (written to a volume or `.env`), never a constant; keep the DB on an internal-only network.
- **Blocks release:** Yes. **Validate:** port closed externally; password differs per install and is not in the repo.

### F-03 — Next.js 16.2.6 has critical and high advisories
- **Severity:** Critical (until upgraded) · **Model:** Both · **Status:** Confirmed that the version is in range of the advisory database; reachability Suspected per advisory
- **Where:** `package.json` pins `"next": "16.2.6"`; `npm audit --omit=dev` reports `next` as the only critical.
- **Evidence (from `npm audit`, advisory titles):** unauthenticated RCE on Windows-hosted servers and via Image Optimization with AVIF (`>=16.0.0 <16.3.3`); RCE in `next/og` (`<16.3.6`); Middleware/Proxy bypass with Turbopack (`<16.2.11`; this app's auth gate is `src/middleware.ts`); SSRF in Server Actions/rewrites and in Image Optimization; cache poisoning/cross-user substitution (`<16.3.8`); server-function endpoint disclosure; DoS.
- **Reachability notes:** no `next/image` or `next/og` imports exist in `src/`, but the `/_next/image` optimizer is enabled by default in standalone builds, so the image advisories should be assumed reachable until `images` is locked down or Next is upgraded. Docker is Linux, so the Windows-only RCE does not apply to the image but applies to anyone running `npm start` on Windows. Handlers re-check identity (so the middleware bypass alone does not open routes while `AUTH_ALLOW_LOCAL_FALLBACK=false`), but see F-05.
- **Fix:** upgrade to the fixed line (`npm audit` reports `16.4.2`, non-major), re-run tests, rebuild and republish the image, redeploy Amplify.
- **Blocks release:** Yes. **Validate:** `npm audit --omit=dev` shows no critical/`next` entries; image rebuilt.

---

## High

### F-04 — On-prem owner claim needs no secret
- **Severity:** High · **Model:** SH · **Status:** Confirmed
- **Where:** `src/lib/setup-claim.ts:48-50` (`claimRequiresSetupCode()` returns `isHostedRuntime()`, false for Docker); `docs/deploy/on-prem-docker.md` ("first visitor becomes Owner").
- **Attack:** the stack starts, port 3000 is reachable, an attacker signs up as Owner before the operator does (race), or after a `down -v`. The claim is also check-then-create (`cognitoDirectoryIsEmpty` then `claimFirstAdmin`), so two simultaneous claims can both pass.
- **Fix:** generate a setup code at first boot and print it in the `init` container log (as the hosted edition does), require it in `runFirstAdminClaim` for every edition; make the claim atomic (conditional write on `setupClaimUsedAt`).
- **Blocks release:** Yes (for any non-localhost use). **Validate:** claim without the code returns 403; concurrent claims yield one owner.

### F-05 — Authentication fails open by default
- **Severity:** High · **Model:** Both (mitigated in shipped IaC/compose) · **Status:** Confirmed
- **Where:** `src/lib/identity.ts:56-61` (unset ⇒ `true`), `:184-214` (missing/invalid token ⇒ `localOwnerIdentity()`, role `super_admin`); `src/middleware.ts:49-54,75`; `AUTH_MODE` itself defaults to `local` (`identity.ts:48-52`); `.env.example` documents `AUTH_ALLOW_LOCAL_FALLBACK="true"` next to a Cognito block.
- **Failure condition:** an operator sets `AUTH_MODE=cognito` but omits or mistypes `AUTH_ALLOW_LOCAL_FALLBACK=false`; or runs the production build with no `AUTH_MODE`. Every request, with no token or a forged one, becomes Super Admin. The same applies to the Lambda via the same `getIdentity`.
- **Shipped mitigation (verified):** Terraform `modules/api/main.tf:153`, `modules/amplify/main.tf:344`, CloudFormation default `"false"`, `docker-compose.yml` sets `"false"`, `infra/scripts/wire.mjs:190`.
- **Fix:** invert the default. In `NODE_ENV=production`, refuse to start (or return 503) unless auth is configured; allow the local identity only when an explicit `ALLOW_INSECURE_LOCAL_IDENTITY=true` is set *and* the server is bound to loopback. Remove the `"true"` example from `.env.example`.
- **Blocks release:** Yes (cheap to fix). **Validate:** unit test: production + cognito + no variable ⇒ 401; no-token request ⇒ 401.

### F-06 — Host `~/.aws` mounted into the app container
- **Severity:** High · **Model:** SH · **Status:** Confirmed
- **Where:** `docker-compose.yml:141-147` (read-only bind of `${HOST_AWS_DIR:-${USERPROFILE:-${HOME}}/.aws}` to `/home/nextjs/.aws`).
- **Impact:** any process in the container (including via a Next.js RCE, F-03) can read every profile, any long-lived `aws_access_key_id`, and cached SSO tokens for the user's *other* AWS accounts. This contradicts the documented principle that credentials do not live in the app.
- **Fix:** do not mount by default. Offer an opt-in `docker-compose.bedrock.yml` override that mounts only a purpose-made directory containing one profile, and document it as exposing those credentials to the app.
- **Blocks release:** Yes. **Validate:** default stack has no host bind mount (`docker inspect`).

### F-07 — Amplify compute role is over-privileged
- **Severity:** High · **Model:** AWS · **Status:** Confirmed (source); live role Unverified
- **Where:** `infra/terraform/modules/amplify/main.tf:115` attaches `AdministratorAccess-Amplify`; `:311,313` use the *same* role as `iam_service_role_arn` and `compute_role_arn` (the comment at `:312` says "distinct", the code is not); `:146-152` Cognito `AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup`; `:205-224` Bedrock `InvokeModel*` and `transcribe:StartStreamTranscription` on `*`; `:230-240` `ssm:PutParameter` on the vendor-key parameter. The Lambda role also has Bedrock invoke on `*` (`modules/api/main.tf:205-214`).
- **Attack:** any code execution in the Next.js server (F-03, a future bug, a malicious dependency) inherits permission to edit/delete the Amplify app and its environment, mint Super Admin users in the pool, overwrite stored vendor keys, and invoke any Bedrock model on the account (cost).
- **Fix:** two roles. The service (build) role keeps Amplify management; the compute role gets only what runtime needs, with `Resource` scoped to the pool ARN, the table, the three parameters, the bucket. Constrain Bedrock to named model ARNs. Drop `AdministratorAccess-Amplify` from the compute role.
- **Blocks release:** Yes (AWS). **Validate:** `aws iam list-attached-role-policies` on the compute role shows no AWS-managed admin policy; a runtime call to `amplify:UpdateApp` is denied.

### F-08 — Ollama exposed without authentication
- **Severity:** High · **Model:** SH · **Status:** Confirmed (config)
- **Where:** `docker-compose.yml:50-51`. Ollama has no auth; it also runs as root and stores models in `/root/.ollama`.
- **Impact:** free GPU/CPU use by strangers, model pull/delete, and prompt content visibility to anyone who can call it. Resource exhaustion starves the app.
- **Fix:** remove the port mapping (offer a dev-only override). **Blocks release:** Yes. **Validate:** closed externally.

### F-09 — No transport encryption for the on-prem stack
- **Severity:** High · **Model:** SH · **Status:** Confirmed
- **Where:** all compose hops are `http://`; no TLS terminator or reverse-proxy example in compose or `docs/deploy/on-prem-docker.md`; HSTS and `upgrade-insecure-requests` only when `SECUREMIND_EDITION=cloud` (`security-headers.ts:123`). The session cookie gets `Secure` whenever `NODE_ENV=production` (`auth-cookies.ts:12`), so over plain `http://<lan-ip>:3000` browsers drop it and sign-in fails; the workaround users reach for is exposing nothing or disabling protection.
- **Impact:** passwords, the access token, conversations and uploaded documents cross the LAN in clear text if the stack is used from another machine.
- **Fix:** ship an optional Caddy (automatic TLS) service or documented reverse-proxy recipe; make "localhost only, or put TLS in front" an explicit requirement; enable HSTS when `APP_PUBLIC_URL` is https.
- **Blocks release:** Yes (for non-localhost use). **Validate:** `https://` URL works end-to-end; cookie carries `Secure`.

### F-12 — Floci (third-party AWS emulator) is the production identity provider, unpinned
- **Severity:** High · **Model:** SH · **Status:** Confirmed (usage); emulator hardening Unverified
- **Where:** `docker-compose.yml:35` (`floci/floci:latest`); `docs/deploy/floci-local.md` calls it a local experiment; `AGENTS.md` says Floci is "for local experiments only" yet it is the Docker product's sign-in.
- **Concerns:** password storage, token signing-key persistence, brute-force lockout and refresh-token revocation are the emulator's, not Cognito's; TOTP is unsupported so MFA is hidden on-prem; an unpinned `latest` image from a small project is an unreviewed supply-chain input to the login path.
- **Fix:** pin by digest, run Floci's behaviour against a negative test suite (lockout, token tamper, group claim), or replace with a purpose-built local auth (Argon2id password hashes in your DB, signed sessions) that you control and test. Disclose the limitation clearly until replaced.
- **Blocks release:** Yes for SH production claims. **Validate:** documented/tested lockout and key rotation behaviour.

---

## Medium

### F-10 — Public API Gateway methods with a single shared throttle
- **Severity:** Medium · **Model:** AWS · **Status:** Confirmed
- **Where:** `modules/api/main.tf:316-335` (`authorization = "NONE"` on `POST /chat`, `OPTIONS`, `ANY /warm`); `:476-485` global 20 rps / burst 40 for all callers; no WAF; chat Lambda 1536 MB, 300 s timeout, no reserved concurrency (`:281-295`).
- **Attack:** an anonymous caller sends junk requests (each runs the Lambda, hydrates SSM, then fails JWT check). The shared throttle fills, and real users receive 429. Cost is bounded by the throttle, availability is not. `/warm` is unauthenticated by design.
- **Fix:** attach a Cognito User Pool authorizer (REST API supports it; the Lambda keeps its own check) so unauthenticated calls are rejected at the gateway, and add a WAF rate-based rule per IP (a few dollars a month). Set reserved concurrency on the chat function.
- **Blocks release:** No (it is a documented trade-off) but strongly recommended. **Validate:** unauthenticated `POST /chat` returns 401 from the gateway and no Lambda invocation is logged.

### F-11 — Other production dependency advisories, including parsers of untrusted files
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed (audit); reachability Suspected
- **Evidence:** `npm audit --omit=dev`: 23 vulnerable packages (1 critical `next`, 13 high, 9 moderate). Of note: `sharp` (libvips/libheif/librsvg CVEs), `nodemailer` (several, fixed ≥10.0.6 per advisory range), `@xmldom/xmldom` and `fast-uri` (pulled in by document and AWS tooling), `brace-expansion`, `postcss`. `exceljs`, `mammoth` and `pdf-parse` parse attacker-supplied files in-process and `npm audit` offers no non-breaking fix for `exceljs`/`mammoth`. Many highs are dev/Prisma-CLI transitives that do not ship in the runtime image.
- **Fix:** `npm audit fix` for the non-major set; replace or isolate the three parsers (run extraction in a size/time-limited worker; reject encrypted/oversized archives); track with Dependabot/`npm audit` in CI.
- **Blocks release:** No (after F-03). **Validate:** CI fails on high+ production advisories.

### F-13 — Sessions are not revoked on logout, suspension or deletion
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed
- **Where:** `src/app/api/auth/logout/route.ts` only clears the cookie (no `GlobalSignOut`/`RevokeToken`; grep finds none). `getIdentity` never consults the profile `status`; suspension/deletion only call Cognito disable and set a profile field (`admin/users/[username]/route.ts`), and a disabled user's still-valid access token keeps working until expiry (1 h) on every route. Refresh tokens last 30 days (`auth_cognito/main.tf:136-142`).
- **Impact:** a stolen cookie/token outlives logout; an offboarded user retains up to an hour of access.
- **Fix:** call `GlobalSignOut` on logout and on admin disable/delete; check profile status in `getIdentity` (cached for seconds) for suspended/deleted; consider 15-minute access tokens.
- **Blocks release:** No. **Validate:** token rejected within seconds of disable.

### F-14 — JWT validation is incomplete
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed
- **Where:** `identity.ts:141-150`: signature + issuer only. No check that `token_use === "access"`; `client_id` is compared only if `COGNITO_CLIENT_ID` is set *and* the token has a `client_id` claim, so an ID token (which has `aud`, not `client_id`) passes. `middleware.ts:60-62` checks even less. Issuer candidates also accept the `localhost`/`floci` host swap in any environment.
- **Fix:** require `token_use==="access"`, `client_id === COGNITO_CLIENT_ID` (fail closed when the env var is missing), and drop the Floci host-swap outside local development.
- **Blocks release:** No. **Validate:** unit tests with an ID token, a token from another client, and one with `token_use: "id"` all return 401.

### F-15 — No monitoring, alerting, audit trail infrastructure or backups in the AWS IaC
- **Severity:** Medium · **Model:** AWS · **Status:** Confirmed (source); live Unverified
- **Evidence:** repository search finds no CloudTrail, CloudWatch alarm, AWS Budget, WAF or GuardDuty resources in `infra/terraform`. API Gateway execution/access logging is not enabled on the stage (`:466-470`). DynamoDB `PointInTimeRecoveryEnabled: false` (`fragments.cfn.yaml`, SSE uses the default AWS-managed key). Cognito `deletion_protection` defaults to `INACTIVE`. Lambda log retention 14 days. `SECURITY.md` recommends a Budget by hand.
- **Impact:** an attacker or a mistake leaves little evidence; data loss from bad writes is unrecoverable; a deleted user pool deletes every user.
- **Fix:** enable PITR on the table, `ACTIVE` deletion protection in production, a CloudTrail trail (one management-event trail is inexpensive), API stage access logs, alarms on Lambda errors/throttles/4xx spikes and a Budget (all Terraform).
- **Blocks release:** PITR and deletion protection: P1. **Validate:** `describe-continuous-backups` shows ENABLED.

### F-16 — No application audit log for administrative actions
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed
- **Evidence:** admin operations (role change, password set, MFA reset, disable, provider key change, security-policy change) pass an `actor` for authorization decisions but are only written to `console` (`admin/users/[username]/route.ts` logs a generic line). No persisted, append-only record exists.
- **Fix:** an `AuditEvent` record (actor, target, action, time, outcome; never secrets) written for every admin mutation, viewable by Super Admin, exported with backups.
- **Blocks release:** No (P1).

### F-17 — Admins are peers who can take each other over and impersonate members
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed
- **Where:** `admin/users/[username]/route.ts`: any `admin` may set another admin's or any member's password, reset MFA, disable, or promote to admin; only the Super Admin is protected (`assertCanMutateOwner`). A password set by an admin (`adminSetDirectoryUserPassword`) gives full impersonation of that member, including their private conversations and documents.
- **Impact:** one compromised or malicious Admin controls every non-owner account. It is a design decision, but it is not disclosed as a privacy limitation and is not audited (F-16).
- **Fix:** require Super Admin for password-set/MFA-reset on Admin accounts; prefer "send reset link" over "set password"; document that Admins can impersonate members.
- **Blocks release:** No (document at minimum).

### F-18 — Redaction is client-side only and the Admin policy cannot be enforced for chat
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed (also acknowledged in `AGENTS.md`)
- **Impact:** a crafted request to `/api/chat` or the Lambda skips the browser entirely and sends raw text to the model vendor; "Instance security policy" is therefore advisory for chat. Documents are scrubbed server-side at ingest (good).
- **Fix:** run the same `pii.ts` detection server-side as a gate (block or redact) before provider calls, using the Admin policy. Until then, state plainly that chat redaction protects against accidental, not hostile, input.
- **Blocks release:** No, provided the claim is accurate. **Validate:** a request containing a synthetic SSN posted directly is blocked/redacted server-side.

### F-19 — Prompt-injection filtering is a regex denylist
- **Severity:** Medium (Low impact because no tools) · **Model:** Both · **Status:** Confirmed
- **Where:** `src/lib/prompt-guard.ts:14-26`. Trivially bypassed with paraphrase, other languages, Unicode, or splitting. The real controls are the fenced-evidence prompt, the absence of tool calls, and CSP blocking image beacons.
- **Residual risk:** misleading answers citing a poisoned document; leakage of retrieved text in the same user's session only (retrieval is `userId`-scoped).
- **Fix:** keep as defense-in-depth; do not describe as protection; add an adversarial regression corpus; keep the chat path tool-free or add per-tool authorization before ever adding tools.

### F-20 — Upload and storage limits are per-file only
- **Severity:** Medium · **Model:** Both · **Status:** Confirmed
- **Where:** `documents/route.ts` and `constants.ts`: 10 MB per file and 8 attachments per turn; no per-user or instance storage quota, no concurrency cap, whole file buffered in memory, docx/xlsx are zip containers (decompression-bomb risk), `DOCUMENT_INGEST_SYNC=true` runs extraction inline. No rate limiting inside the app.
- **Fix:** per-user quota and daily upload cap, container-size/ratio limits before parsing, extraction timeout, worker isolation (see F-11).

### F-21 — On-prem encryption key lives beside the data it protects; content is not encrypted at rest
- **Severity:** Medium · **Model:** SH · **Status:** Confirmed
- **Where:** `INSTANCE_KEY_FILE: /data/instance.key` on the same `securemind-data` volume as `uploads` and `avatars` (`docker-compose.yml:130-133`); messages, memory facts and document text are stored in plaintext in Postgres; originals in plaintext on disk; `npm run backup:onprem` writes plaintext dumps.
- **Impact:** theft of a volume, backup or VM snapshot yields everything; the vendor-key encryption only protects the database file in isolation. Not a defect if documented as "use host disk encryption".
- **Fix:** document full-disk encryption as a customer requirement; optionally accept `INSTANCE_ENCRYPTION_KEY` from a Docker secret; encrypt backups (age/gpg) in `backup-onprem.mjs`.

### F-22 — Image publishing pipeline: ungated, mutable, unsigned
- **Severity:** Medium · **Model:** SH · **Status:** Confirmed
- **Where:** `.github/workflows/publish-image.yml`: triggers on push to `main` with no dependency on the CI `test` job; only `latest` and `init` tags are pushed; no `cosign` signature, SBOM, provenance attestation or vulnerability scan; `docker-compose.pull.yml` uses `pull_policy: always`.
- **Impact:** an account compromise, a malicious merge, or a bad commit becomes every customer's next `docker compose up`. Customers cannot verify what they run.
- **Fix:** publish only after CI passes (or on tagged releases), push immutable version tags and digests, sign with cosign keyless OIDC, attach SBOM/provenance, run Trivy in CI, and document `cosign verify`. Enable 2FA/passkeys and branch protection on the publishing account.

### F-23 — Unpinned third-party build inputs and an end-of-life runtime
- **Severity:** Medium · **Model:** SH/CI · **Status:** Confirmed
- **Evidence:** GitHub Actions pinned by major tag (`actions/checkout@v4`, `docker/build-push-action@v6`, `aws-actions/configure-aws-credentials@v4`, `hashicorp/setup-terraform@v3`), not commit SHA; `node:20-bookworm-slim` (Node 20 reached end of life in April 2026) and CI `node-version: "20"`; `pgvector:pg16`, `floci:latest`, `ollama:latest` tags; no Dependabot configuration.
- **Fix:** move to Node 22 LTS; pin Actions by SHA and images by digest; add Dependabot for npm, Actions and Docker.

### F-31 — Cognito pool settings leave defence-in-depth off
- **Severity:** Medium · **Model:** AWS · **Status:** Confirmed (source)
- **Where:** `modules/auth_cognito/main.tf`: MFA `OPTIONAL` by default (no enforcement even for Admins), no advanced security / compromised-credential checks, `ALLOW_USER_PASSWORD_AUTH` enabled (the server proxies passwords), `deletion_protection` default `INACTIVE`, password policy without symbols (12-character minimum is acceptable).
- **Fix:** require MFA for Admin/Owner (app-level check, since Cognito `ON` is all-or-nothing); enable the Cognito threat-protection tier appropriate to cost; set production deletion protection; keep `USER_PASSWORD_AUTH` only because the server proxies, and document it.

---

## Low

### F-24 — `.dockerignore` gaps
Ignores `.env*`, `infra`, `docs`, `tests`, `backups`, `.data`, but not `cursor-history/`, `build-log.txt`, `sample-dev.*.log`, `.claude/`, `*.bak`. They stay out of the final runner stage (it copies only standalone output and `public`) but enter the builder context. Build only from CI.

### F-25 — Secrets in Terraform state
`random_password.setup_claim`, `random_id.instance_encryption` and the optional Groq key (`variable groq_api_key`) are stored in state and in SSM. The state bucket is versioned, encrypted (SSE-S3), public-blocked, but not KMS-encrypted and has no access logging or lifecycle on old versions. Mitigate with a bucket policy limiting access to the deploy role and a rotation procedure for the instance key (none is documented; `smenc:v1` has no key ID).

### F-26 — Containers lack baseline hardening
No `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true` with tmpfs, `mem_limit`/`pids_limit`/`cpus`, or dedicated networks. `ollama` runs as root. Only `db`, `ollama` and `app` have health checks; `floci` and `init` do not. The `app` runner image is non-root (UID 1001) and sets `HOME` correctly (positive).

### F-27 — Data layer defaults `userId` to `"local"`
`src/lib/memory.ts:75,114` default the owner to the literal `"local"`. Callers always pass the real id today, but a forgotten argument silently writes or reads the shared `local` partition instead of failing. Make `userId` required.

### F-28 — Public status endpoints disclose configuration
`/api/setup/status` (unauthenticated by design) returns `authMode`, `cognitoConfigured`, `directoryEmpty`, `claimAvailable`, `codeConfigured`. This tells an attacker precisely when an instance is claimable (F-04). Return only what the unauthenticated wizard needs.

### F-29 — CSP allows inline scripts; no HSTS on-prem
`script-src 'self' 'unsafe-inline'` (documented trade-off in `security-headers.ts`). A nonce-based policy needs middleware support. HSTS depends on `SECUREMIND_EDITION=cloud` (F-09).

### F-30 — Download filename header handling
`documents/[id]/original/route.ts:35` strips only double quotes from the stored filename in `Content-Disposition`. Control characters make Node throw (a 500 rather than injection), but use RFC 5987 `filename*` encoding and a sanitized name.

---

## Items tested and found sound (negative results)

- **Cross-user access:** reviewed every `[id]` route (`documents/*`, `workspaces/[id]`, `memory/facts/[id]`, `session`, `messages`, `bookmarks`, `me/avatar`, `settings/portal/logo`). All resolve ownership with `{ id, userId }` or through an owning workspace and return 404. `tests/authz.test.ts` covers this with a mocked DB; **no live cross-tenant test was run.**
- **Model-id injection:** `resolveAllowedModel()` is applied in the chat path (logged rejection at `run-chat-stream.ts:233`); tests in `tests/model-allowlist.test.ts`.
- **Privilege escalation to Super Admin:** blocked in `admin/users` POST/PATCH (`role: owner|super_admin` ⇒ 422) and `setDirectoryUserRole`.
- **AWS credential intake:** rejected at the route and again in storage (tests exist).
- **Open redirect:** none found; no redirect parameters consumed.
- **SQL injection:** raw SQL in `memory.ts` and `storage/postgres.ts` uses numbered parameters; the vector literal is built from numeric arrays.
- **Secret leakage in logs/responses:** vendor keys masked (`…last4`); auth failure logs truncate to 160 characters of the error message and never include tokens or codes.
- **CORS (Lambda):** reflects the request origin only when it is in `ALLOWED_ORIGIN`; the Terraform default is a single origin. `ALLOWED_ORIGIN="*"` would reflect any origin with credentials; the code supports it, so never set it.
- **GitHub OIDC trust:** subject pinned to numeric owner/repo IDs plus a named environment, deploy role cannot edit itself, boundary denies `iam:*`; this is well above typical practice. Residual: with no required reviewers, any push to `main` runs `terraform apply -auto-approve`, so protect `main` (documented in `SECURITY.md`).
