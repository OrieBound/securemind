## ADR 0005: Admin-owned instance security policy

**Status**: Accepted · **Date**: 2026-08-03 · **Updated**: 2026-08-05

### Context

Sensitivity tiers and safe terms lived in browser `localStorage`, so Members could loosen detection on their device and Knowledge ingest ignored custom exemptions. Hosted Cognito needs Admin-owned policy.

### Decision

1. **Source of truth**: `InstanceConfig.piiSensitivity` + `safeTerms` (Admin `PUT /api/settings/security`).
2. **Ingest**: `scrubDocumentText` loads policy via `resolveIngestScrubOptions()` — never from the upload body.
3. **Propose / accept**: Anyone authenticated may `POST` a pending proposal; only Admin applies.
4. **Going forward only**: Changing sensitivity or safe terms updates the policy for **new** chat sends and **new** Knowledge ingest. Existing messages and documents are not re-scanned or rewritten. Already-redacted values cannot be restored (no raw retention). Defaults still merge with instance safe terms for detection.
5. **Hosted vs local**: Hosted uses Cognito Admin/Member; local `AUTH_MODE=local` remains Admin. Ollama stays local-only; Bedrock is optional via SSO. No KMS required; Parameter Store (SecureString) for bootstrap keys (originally Secrets Manager; moved 2026-10-18 to avoid the $0.40-a-secret charge). Bedrock content logging stays opt-in.

### Consequences

- UI hydrates from `/api/settings/security`; localStorage is a cache.
- Admin confirm dialog must state that history is not adjusted.
- Loosening a tier does not un-redact past text; tightening does not backfill older Knowledge.
