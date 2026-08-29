# SecureMind Education Guide

This guide explains SecureMind as it exists in this repository today. It is written as a learning document, not as marketing copy.

SecureMind is a single-user, privacy-aware AI workspace. Its core value is not a generic chatbot. The real product is the combination of:

- client-side sensitive-data detection and replacement before chat sends
- workspace-scoped memory and knowledge
- retrieval with citations and evidence controls
- model routing by complexity tier
- visibility into usage, cost, and detected-data risk

Sanitization is **risk reduction**. It does not guarantee complete PII removal, security, or regulatory compliance. Users remain responsible for reviewing content and meeting their obligations.

If you remember one thing, remember this:

> SecureMind is a detection + memory + evidence system with a chat interface on top.

## 1. What the Project Is Trying to Do

The project solves a specific problem:

- let a user talk to an assistant about operational and security work
- keep each workspace's knowledge isolated
- prevent obvious sensitive values from being sent in raw form
- answer from uploaded knowledge when the question needs evidence
- keep a useful memory of user-authored facts without treating the assistant as a source

It is intentionally not described as:

- production multi-tenant SaaS
- enterprise-compliant hosted security product
- a personality-driven companion app

The repo rules in [AGENTS.md](../AGENTS.md) are strict because the project is built around trust boundaries.

## 2. The Big Picture

At the highest level, the application works like this:

1. The browser loads the main shell.
2. The user works inside a workspace.
3. Before a chat message is sent, the browser scrubs sensitive values.
4. The server classifies the turn to decide whether retrieval and citations are needed.
5. If the turn needs workspace evidence, the server retrieves document chunks from pgvector.
6. The router picks a model tier and provider.
7. The provider streams the answer back over SSE.
8. The client persists the sanitized user and assistant messages.
9. Background summarization compresses user-authored memory into summaries and workspace facts.
10. Analytics record sanitized metadata about routing, grounding, cost, and security events.

The short architectural path is:

```text
Browser
  AppShell -> composer -> scrubPII -> review -> /api/chat

Server
  identity -> turn policy -> retrieval -> prompt build -> model provider -> SSE stream

Storage
  Postgres rows + pgvector fragments + telemetry tables
```

## 3. Startup and Entry Points

The main app route is [src/app/page.tsx](../src/app/page.tsx). It does almost nothing itself:

- wraps the UI in `AuthGate`
- renders `AppShell`

`AuthGate` ensures the app can run in local mode or authenticated mode. `AppShell` is the real frontend hub in [src/components/app/app-shell.tsx](../src/components/app/app-shell.tsx).

`AppShell` owns most of the visible product behavior:

- workspace sidebar
- chat thread
- composer
- document uploads
- memory panel
- settings
- analytics navigation
- model and provider UI

This file is large because it is effectively the application shell for the whole product.

## 4. Identity and Auth Model

Identity is intentionally centralized in [src/lib/identity.ts](../src/lib/identity.ts).

That file is one of the most important in the project because it enforces this rule:

> `userId` comes from the server-side identity resolver, never from the request body.

It supports three modes:

- `local`: fixed single-user identity
- `cognito`: verify JWTs against Cognito JWKS
- `jwt-hs256`: local/demo JWT mode

Important design choices:

- local mode is the default personal-project path
- Cognito is optional and mainly for experiments
- routes must call `getIdentity(req)` before touching user-owned data
- cross-tenant protection depends heavily on this discipline

JWT verification uses `jose`, and Cognito verification accepts both `localhost` and `floci` issuer variants for local development.

## 5. Workspaces: the Main Unit of Isolation

The main product boundary is the workspace, not a chat "mode."

Workspaces are created and listed in [src/app/api/workspaces/route.ts](../src/app/api/workspaces/route.ts). The default seeded workspace is `Mindy Locke`.

A workspace owns:

- sessions
- messages
- documents
- memory fragments
- workspace facts
- analytics associations

This matters because SecureMind is supposed to keep operational context scoped. A runbook in one workspace should not silently inform answers in another.

The schema for that starts in [prisma/schema.prisma](../prisma/schema.prisma) with the `Workspace` model and its related tables.

## 6. Session Loading and Chat Thread Setup

When the user opens a workspace, the client loads `/api/session`.

The route in [src/app/api/session/route.ts](../src/app/api/session/route.ts):

- verifies the workspace belongs to the current user
- finds the latest session with actual message activity
- creates a session if this workspace has never been used
- loads recent messages
- loads the rolling session summary
- loads workspace facts

The default workspace gets a seeded assistant hello on first open. Extra workspaces do not.

This is a good example of the product's philosophy:

- the app tries to feel ready to use immediately
- but still keeps memory and ownership checks explicit

## 7. Chat Send Flow: Start to Finish

This is the most important runtime path in the app.

### 7.1 Browser-side redaction

Before a message leaves the browser, the composer uses `scrubPII` from [src/lib/pii.ts](../src/lib/pii.ts).

That module:

- detects structured sensitive values
- replaces them with placeholders like `[email redacted]`
- returns rich segments for UI display
- records category counts
- supports sensitivity tiers
- supports safe terms

Critical policy:

- raw detected values are not stored
- raw detected values are not logged
- raw detected values are not sent to the server
- there is no restore path

These are product rules for values the scanner already matched. They are not a claim that every sensitive value will be found.

### 7.2 Turn classification

After the sanitized message reaches the server, `/api/chat` in [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) calls `prepareChatTurn()` from [src/lib/chat/run-chat-stream.ts](../src/lib/chat/run-chat-stream.ts).

`prepareChatTurn()` first calls `decideTurn()` from [src/lib/turn-policy/decide-turn.ts](../src/lib/turn-policy/decide-turn.ts).

That classifier decides things like:

- is this social chat?
- is this product-help?
- is this general knowledge?
- is this attachment review?
- is this workspace-grounded?
- is this an investigation turn?

This is a major architectural choice:

- retrieval behavior is driven by turn policy
- model choice is driven by complexity routing
- those are separate systems

That separation keeps the app from mixing "what model should answer this?" with "should we retrieve workspace evidence for this?"

### 7.3 Retrieval

If the turn needs workspace evidence, `prepareChatTurn()` calls `retrieveSemanticMemory()` from [src/lib/memory.ts](../src/lib/memory.ts).

That function:

- embeds the query text
- runs a raw pgvector similarity search
- filters to `category = 'document'`
- filters by both `workspaceId` and `userId`
- returns only chunks above the evidence threshold

A very important point:

- document chunks are citeable evidence
- assistant replies are not evidence
- conversation history is continuity, not a documentary source

The retrieval layer is purposely conservative about what can become a citation.

### 7.4 Prompt construction

Still inside `prepareChatTurn()`, the server builds the system prompt with:

- `buildSystemPrompt()` from [src/lib/models/router.ts](../src/lib/models/router.ts)
- turn-mode instructions from `modePromptInstructions()`
- optional workspace context
- optional session summary
- optional user-authored workspace facts
- optional current attachment blocks
- optional retrieved evidence blocks

This layered prompt design matters:

- conversational base is always present
- operational grounding is only added when the turn needs it
- social/general turns do not get forced workspace framing

### 7.5 Model routing

SecureMind routes by complexity tier in [src/lib/models/router.ts](../src/lib/models/router.ts).

The available chat tiers are:

- Max
- High
- Plus
- Standard
- Light
- Fast
- Micro

The router decides which model handles the request. It does not decide the answer style. The answer style comes from prompt policy and turn policy.

Today:

- Groq is the primary cloud path
- Ollama is local fallback
- Bedrock is optional

### 7.6 Provider execution and streaming

`streamChat()` in [src/lib/models/provider.ts](../src/lib/models/provider.ts) is the unified provider runner.

It hides provider-specific logic for:

- Groq
- Ollama
- Bedrock
- OpenAI
- Anthropic
- Google

The main user-facing chat path is still centered on Groq, Ollama, and optional Bedrock, but the settings system is broader than that.

Streaming happens through SSE. The route returns a streaming response and the server emits:

- route info
- token deltas
- usage
- citations
- citation audit info
- insufficient-evidence markers
- done/error frames

### 7.7 Persistence and telemetry

The client persists sanitized messages through `/api/messages` in [src/app/api/messages/route.ts](../src/app/api/messages/route.ts).

That route:

- verifies session ownership
- stores the message
- updates session activity time

It deliberately does not embed assistant replies into long-term memory fragments.

Inference telemetry is recorded from `run-chat-stream.ts` into `InferenceEvent`. This captures sanitized metadata such as:

- provider
- model
- tier
- token usage
- latency
- retrieval counts
- grounding status
- citation counts

This telemetry powers the analytics views.

## 8. Memory: What the App Remembers and Why

SecureMind has multiple memory layers.

### 8.1 Session history

Plain chat messages live in `Message`.

Purpose:

- conversation continuity
- recent thread display

Not for:

- citations
- durable verified evidence

### 8.2 Session summary

The rolling summary is maintained through `/api/summarize` in [src/app/api/summarize/route.ts](../src/app/api/summarize/route.ts).

This route uses a cheap model to compress recent conversation into:

- a short summary
- a controlled facts object

The prompt strictly says:

- only durable user-authored facts
- never assistant-authored facts
- never retrieved document content as user memory

### 8.3 Workspace facts

Facts are stored in `WorkspaceFact`.

Examples:

- user goals
- technical level
- preferences clearly stated by the user

These are intentionally scoped per workspace. Even user-authored memory is not treated as global by default.

### 8.4 Semantic/document fragments

`MemoryFragment` stores vectorized chunks.

In the current architecture, citeable semantic retrieval is focused on document fragments, not assistant messages.

That keeps the evidence layer honest.

## 9. Knowledge Ingest Flow

Document upload is the second major product path after chat.

The route is [src/app/api/documents/route.ts](../src/app/api/documents/route.ts). The processing logic lives in [src/lib/documents.ts](../src/lib/documents.ts).

The ingest pipeline is:

1. receive uploaded file
2. resolve MIME type
3. extract text
4. scrub extracted text
5. persist sanitized `Document`
6. chunk text
7. embed chunks
8. persist `MemoryFragment` rows
9. mark document `ready`

### 9.1 Text extraction

Different file types use different extraction paths:

- images: Groq vision extract in [src/lib/image-extract.ts](../src/lib/image-extract.ts)
- PDF: `pdf-parse`
- DOCX: `mammoth`
- text/code/json/markdown: UTF-8 decode

### 9.2 Scrubbing

After extraction, `scrubDocumentText()` runs the same PII rules server-side.

This matters because:

- chat redaction is client-side
- document ingest is server-side
- both must sanitize before durable storage

The ingest scrub policy comes from the admin-owned instance policy, not from the browser request.

### 9.3 Chunking and embeddings

Chunking is character-based with overlap to preserve context for retrieval.

Embeddings use:

- Ollama `nomic-embed-text` by default
- optional Bedrock Titan embedding path

The chunks are stored as `MemoryFragment` rows, and the vector value is written with raw SQL because Prisma cannot natively type `vector(768)`.

## 10. Security Policy and Safe Terms

Security policy is managed in [src/lib/security-policy.ts](../src/lib/security-policy.ts) and exposed through [src/app/api/settings/security/route.ts](../src/app/api/settings/security/route.ts).

The active instance policy includes:

- `piiSensitivity`
- `safeTerms`
- optional pending proposal

Important product rules:

- only Admin/Operator applies the active policy
- members can propose
- policy changes apply going forward only
- old messages/documents are not re-scanned
- already-redacted values cannot be restored

Safe terms exist to reduce false positives before detection. They do not exist to un-redact stored content.

Some categories can never be exempted, including:

- SSN
- card number
- secret

That is enforced in `validateSafeTerm()`.

## 11. Provider and Credential Model

Provider configuration is managed through [src/lib/instance-config.ts](../src/lib/instance-config.ts) and `/api/settings/providers`.

The project draws a hard line between:

- vendor API keys, which may be stored in `InstanceConfig`
- AWS credentials, which may not be stored in the UI or database

AWS credentials must come from the AWS SDK provider chain:

- environment variables
- shared profile / SSO
- container role
- instance role

This is one of the repo's strongest security and architecture positions.

Why it matters:

- long-lived AWS secrets in the database would be a bad design
- saved vendor keys are easier to scope and mask
- Bedrock is treated differently from Groq/OpenAI-style vendors

## 12. Database Design

The schema in [prisma/schema.prisma](../prisma/schema.prisma) is the data backbone of the app.

Core tables:

- `Workspace`
- `Session`
- `Message`
- `SessionSummary`
- `WorkspaceFact`
- `Document`
- `MemoryFragment`
- `SecurityEvent`
- `InstanceConfig`
- `UserProfile`
- `InferenceEvent`

### Why Postgres + pgvector

The database choice is explained in [docs/adr/0002-storage-choice.md](./adr/0002-storage-choice.md).

The short version:

- one store for relational data and vectors
- cheap idle cost
- simple local development
- no need to split metadata and vectors into separate systems

### Why raw SQL still exists

The `embedding` column is `Unsupported("vector(768)")` in Prisma.

That is why [src/lib/memory.ts](../src/lib/memory.ts) does raw SQL for:

- vector updates
- similarity search

This is a deliberate exception, not accidental inconsistency.

## 13. Analytics and Insights

SecureMind includes three analytics areas:

- Security
- Usage
- Cost

The query layer is in [src/lib/analytics/queries.ts](../src/lib/analytics/queries.ts).

Analytics are based on sanitized metadata, not raw prompts or secret values.

### Security analytics

Tracks things like:

- what categories were detected
- whether something was redacted, blocked, or safe-listed
- where detections came from

### Usage analytics

Tracks things like:

- request counts
- model/tier distribution
- latency
- grounding/citation rates

### Cost analytics

Tracks things like:

- estimated model spend
- cost by model
- estimated savings from routing

The chart UI uses `recharts`.

## 14. Frontend Structure

The frontend is a Next.js App Router app, but most of the visible product lives in reusable client components under `src/components/app/`.

Important frontend pieces:

- `app-shell.tsx`: top-level application shell
- `composer-input.tsx`: chat composer
- `settings-hub.tsx`: app settings container
- `workspace-editor.tsx`: workspace metadata editing
- `model-catalog.tsx`: model inventory and picker UI
- `memory-dashboard.tsx`: summaries, facts, and memory stats
- `admin-console.tsx`: admin user management
- `appearance-settings.tsx`: theme controls

The UI layer is intentionally rich because the product is not just a chat window. It exposes retrieval, memory, providers, security controls, and analytics as first-class parts of the experience.

## 15. Dependency Guide: Why Each Major Package Exists

This section translates `package.json` into architecture.

### Core framework

- `next`
  Why: full-stack React framework with App Router and API routes.
  Used in: `src/app/*`, route handlers, layout, page structure.

- `react`, `react-dom`
  Why: UI runtime.
  Used in: all client components, stateful app shell, analytics views, settings.

- `typescript`
  Why: type safety across frontend, backend, routes, and schema-facing code.

### Styling and UI utilities

- `tailwindcss`, `@tailwindcss/postcss`
  Why: utility styling and build pipeline.
  Used in: global styles and component class strings.

- `clsx`, `tailwind-merge`
  Why: compose and deduplicate Tailwind class strings.
  Used in: [src/lib/utils.ts](../src/lib/utils.ts) and many UI components.

- `class-variance-authority`
  Why: typed variant APIs for reusable UI primitives.
  Used in: `src/components/ui/button.tsx`, `badge.tsx`, `tabs.tsx`.

- `lucide-react`
  Why: icon set for the product UI.
  Used widely across `src/components/app/*` and analytics components.

- `shadcn`
  Why: local scaffolding/source pattern for UI primitives.
  Used indirectly through the generated `src/components/ui/*` files and `components.json`.

- `tw-animate-css`
  Why: animation helpers used with the Tailwind styling system.

- `@base-ui/react`
  Why: installed for primitive UI support, though current direct imports in `src/` are minimal or absent.
  Practical note: it may be supporting local UI evolution more than today's import graph.

### Database and persistence

- `prisma`, `@prisma/client`
  Why: schema, migrations, typed database client.
  Used in: `prisma/schema.prisma`, route handlers, server libraries.

- `@prisma/adapter-pg`
  Why: Prisma 7 Postgres adapter required by the current DB setup.
  Used in: [src/lib/db.ts](../src/lib/db.ts).

- `pg`
  Why: underlying Postgres pool and a few direct script-level database operations.
  Used in: [src/lib/db.ts](../src/lib/db.ts), `scripts/backup-db.mjs`.

### AI providers and embeddings

- `groq-sdk`
  Why: primary cloud inference path, vision extraction path, and audio transcription route.
  Used in: [src/lib/models/groq.ts](../src/lib/models/groq.ts), [src/lib/image-extract.ts](../src/lib/image-extract.ts), [src/app/api/transcribe/route.ts](../src/app/api/transcribe/route.ts).

- `@aws-sdk/client-bedrock`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-providers`, `@aws-sdk/client-sts`
  Why: optional Bedrock chat/embedding path and AWS credential resolution.
  Used across the Bedrock and AWS credential modules.

- `@aws-sdk/client-cognito-identity-provider`
  Why: optional Cognito auth flows and admin operations.
  Used in: `src/lib/cognito.ts`, `src/lib/cognito-admin.ts`.

- `@aws-sdk/client-secrets-manager`
  Why: bootstrap secret loading for deployment-oriented AWS paths.
  Used in: `src/lib/aws-secrets.ts`.

### Document and content processing

- `pdf-parse`
  Why: extract text from PDF uploads.
  Used in: [src/lib/documents.ts](../src/lib/documents.ts).

- `mammoth`
  Why: extract raw text from DOCX uploads.
  Used in: [src/lib/documents.ts](../src/lib/documents.ts).

- `react-markdown`, `remark-gfm`
  Why: render assistant markdown and GitHub-flavored markdown in the chat UI.
  Used in: [src/components/app/app-shell.tsx](../src/components/app/app-shell.tsx).

### Auth, mail, and tokens

- `jose`
  Why: JWT verification and JWKS support.
  Used in: [src/lib/identity.ts](../src/lib/identity.ts), `src/middleware.ts`, login/auth flows.

- `nodemailer`
  Why: mail delivery support for auth/admin flows.
  Used in: [src/lib/mail.ts](../src/lib/mail.ts).

### Charts and interactive UI

- `recharts`
  Why: charts for analytics dashboards.
  Used in: `src/components/analytics/security-view.tsx`, `usage-view.tsx`, `cost-view.tsx`.

- `emoji-picker-react`
  Why: emoji selection in workspace and composer UI.
  Used in: [src/components/app/app-shell.tsx](../src/components/app/app-shell.tsx), `workspace-editor.tsx`.

### Testing and quality

- `vitest`, `happy-dom`, `@testing-library/react`, `@testing-library/dom`
  Why: unit and component testing.
  Used in: `tests/*`, `src/**/*.test.ts`, `src/**/*.test.tsx`.

- `eslint`, `eslint-config-next`
  Why: linting and Next-specific code quality checks.

## 16. Scripts and Developer Workflow

Important scripts from `package.json`:

- `npm run dev`
  Starts the local dev stack through `scripts/dev.ps1`.

- `npm test`
  Runs Vitest. This is the required baseline before commit.

- `npm run typecheck`
  Runs TypeScript without emit.

- `npm run docker:up`
  Starts local infra services like db/floci/ollama for contributor workflows.

- `npm run docker:onprem`
  Starts the full Dockerized on-prem path.

- `npm run floci:cognito`
  Sets up local Cognito for auth experiments.

There are also infrastructure and validation scripts for the optional AWS-oriented deployment path.

## 17. Testing Philosophy

The repo emphasizes tests around trust boundaries, not just UI snapshots.

Examples:

- `src/lib/pii.test.ts`: redaction behavior and false positives
- `tests/authz.test.ts`: cross-tenant authorization behavior
- `tests/profile-auth.test.ts`: profile/auth restrictions
- `tests/providers-admin.test.ts`: provider settings/admin logic
- `src/lib/turn-policy/*.test.ts`: retrieval/citation decision behavior

This is a good sign. The project is trying to test the rules that matter most:

- who can access what
- what gets stored
- what gets retrieved
- what gets redacted

## 18. The Most Important Design Decisions in the Project

If you are explaining SecureMind to someone else, these are the most important ideas to communicate:

1. Sensitive chat text is scrubbed before it leaves the browser.
2. Uploaded knowledge is scrubbed server-side before it is stored or embedded.
3. Workspace retrieval is decided by turn policy, not by random heuristics scattered across routes.
4. Model choice is decided by complexity tiers, not by topic.
5. Citations come from document evidence, not from assistant messages or vague "memory."
6. User identity is resolved server-side and every user-owned query must be scoped by `userId`.
7. AWS credentials are never accepted through the UI or stored in the database.
8. Neon/Postgres + pgvector stays the default because it is cheap, coherent, and sufficient for the actual scale of the project.

## 19. Good Reading Order for the Codebase

If you want to re-learn the project later, use this order:

1. [AGENTS.md](../AGENTS.md)
2. [README.md](../README.md)
3. [prisma/schema.prisma](../prisma/schema.prisma)
4. [src/lib/identity.ts](../src/lib/identity.ts)
5. [src/lib/pii.ts](../src/lib/pii.ts)
6. [src/lib/turn-policy/decide-turn.ts](../src/lib/turn-policy/decide-turn.ts)
7. [src/lib/chat/run-chat-stream.ts](../src/lib/chat/run-chat-stream.ts)
8. [src/lib/memory.ts](../src/lib/memory.ts)
9. [src/lib/documents.ts](../src/lib/documents.ts)
10. [src/lib/models/router.ts](../src/lib/models/router.ts)
11. [src/lib/models/provider.ts](../src/lib/models/provider.ts)
12. [src/lib/security-policy.ts](../src/lib/security-policy.ts)
13. [src/lib/instance-config.ts](../src/lib/instance-config.ts)
14. [src/lib/analytics/queries.ts](../src/lib/analytics/queries.ts)
15. [src/components/app/app-shell.tsx](../src/components/app/app-shell.tsx)

That order mirrors the real architecture from policy and data boundaries into runtime behavior and then UI.

## 20. Questions to Test Your Understanding

These are good self-check questions as the project evolves:

1. What is the difference between turn policy and model routing?
2. Why are assistant replies not valid documentary evidence?
3. Why does `MemoryFragment` use raw SQL even though the app uses Prisma?
4. Why are AWS credentials forbidden in the UI and DB, while Groq keys may be stored in `InstanceConfig`?
5. What happens differently for a social turn vs a workspace-grounded investigation turn?
6. Why does document ingest scrub text before embedding?
7. What are the actual product boundaries: workspace, session, or chat mode?
8. What parts of the app are local-first, and what parts depend on external providers?

## 21. Final Mental Model

The best mental model for SecureMind is:

- a Next.js full-stack app
- with Postgres as the central store
- with pgvector for knowledge retrieval
- with strict identity and scoping rules
- with client-side and server-side detection layers that reduce — but do not eliminate — sensitive-data exposure
- with model routing that tries to control cost without weakening the evidence model

The UI is large, but the real architecture lives in a few key contracts:

- sanitize before durable use
- scope everything by identity and workspace
- separate retrieval policy from model policy
- only cite real document evidence
- never create a restore path for redacted values

If you keep those contracts in mind, most of the codebase will make sense quickly.
