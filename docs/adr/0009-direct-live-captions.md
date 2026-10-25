# 0009. Direct live captions: browser to Amazon Transcribe

Status: accepted (not yet applied to a real AWS account)

## Context

On the hosted install the voice button used Amazon Transcribe, but words appeared only after Done.
The browser streamed audio to `/api/transcribe/live`, and Amplify's server received that upload in one
piece, so partial results had nothing to be sent back until the upload ended. API Gateway and Lambda do
not stream request bodies either, so moving the route would not help.

Re-transcribing the growing recording every two seconds (what the Groq preview does) would bill the
same audio many times over. Transcribe already returns partial words on a single stream, billed once.

## Decision

The browser opens its own WebSocket to `transcribestreaming.<region>.amazonaws.com:8443`.

- `POST /api/transcribe/live-session` returns an address signed with AWS Signature Version 4.
- The credentials come from `sts:AssumeRole` into `securemind-transcribe-stream-<env>`, a role whose only
  permission is `transcribe:StartStreamTranscriptionWebSocket`, with an inline session policy of the same
  scope and the shortest session STS allows (15 minutes). The compute role's own credentials never leave
  the server, and the secret key is never in the address.
- The address is good for five minutes and only to open the connection. It is never logged or stored.
- The route applies the same checks as the older path (identity, cloud edition, Admin's Transcribe choice,
  audio acknowledgement) plus a per-user rate limit.
- The page's Content-Security-Policy allows that one `wss` origin, and only when the feature is configured.
- If the setting is missing or live captions fail, the old route and the whole-recording pass still work.

## Consequences

- Audio no longer passes through our server on this path. It still leaves for AWS before any text scan,
  exactly as before, and the voice notice already says so.
- Voice counts toward the per-user monthly cost cap: the route refuses to sign an address once the user is
  over it, and each session is recorded as one estimated minute when it is signed (the server never sees how
  long a browser-to-AWS session lasts). The browser ends a session after ten minutes.
- A modified browser could ignore that limit and keep one connection open longer. Sign-in is invite-only,
  the rate limit slows scripts, and the monthly budget alarm is the backstop. A server-side cap per
  connection is not possible because the connection is not ours.
- Anyone who can run script in the page could read the address during its five minutes, which is why the
  role is narrow. The CSP is defence in depth here, not a complete barrier (see `security-headers.ts`).
- Terraform adds one role and two small policies, and the deploy role's boundary gains one `sts:AssumeRole`
  statement. Nothing is created until the bootstrap and app stacks are applied.
