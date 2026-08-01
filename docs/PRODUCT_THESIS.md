# SecureMind — product thesis & project criteria

## Thesis

SecureMind is a **cloud-native adaptive intelligence workspace**. Its primary value is **transparent, governed memory and AI orchestration**, not outperforming frontier models on general knowledge.

**Elevator pitch (external):**

> SecureMind is a security-first adaptive personal intelligence system with **persistent contextual memory**, **behavioral personalization**, **AI orchestration**, and **inspectable cognition** — not another generic chat wrapper.

**One-line gate for scope:** Every feature should strengthen transparent memory, governed retrieval, security posture, or adaptive context. If it only adds raw chat novelty, defer it.

## What we are building (identity)

SecureMind should feel like:

- A calm **personal intelligence environment** with continuity
- A **trustworthy** assistant where memory is understandable and controllable
- An **experience layer** that makes cognition visible (what was recalled, why, and under what policy)

SecureMind must **not** default to:

- Generic admin dashboards or gimmicky persona/roleplay as the core product
- “Smarter than ChatGPT” positioning or AGI hype
- Dumping unlimited chat transcript into context on every turn

## Differentiation vs typical AI apps

| Theme | SecureMind stance |
|--------|-------------------|
| Memory | **Retrieval-driven** layered memory — not infinite prompt history |
| Trust | User-visible:**memories referenced**, confidence/policy hints (where applicable), approvals, deletion |
| Architecture | Memory artifacts + orchestration; **models stay interchangeable** |
| Security | First-class UX and pipeline: scan/redact/policy, audit hooks, KMS-ready posture over time |

## Architectural principles (constraints)

1. **Learning via artifacts** — conversations become structured summaries, embeddings, behavioral signals stored and retrieved selectively; avoid “re-teaching” the LLM via massive logs.
2. **Layered memory** — maintain clear conceptual layers:

   | Layer | Role |
   |--------|------|
   | Core identity profile | Small, stable: tone, style, prefs, traits |
   | Working memory | Recent turns / active topic window |
   | Semantic long-term | Vector-retrievable facts/preferences |
   | Episodic | Conversation / session summaries |
   | Raw archive | Encrypted retention (later / optional UX) |

3. **Security as product** — ingestion path includes classification/redaction/policy before durable memory writes; outbound generation can be guarded incrementally (see phase gates).
4. **Cost-aware routing** — cheap models or local inference for summarize/embed/extract; premium models reserved for heavier reasoning tasks.

### Target AWS portfolio narrative (north star)

Bedrock abstraction, KMS, S3 for artifacts, DynamoDB or Aurora + pgvector (or OpenSearch), Cognito, CloudWatch / CloudTrail. Optional deepening: Comprehend, Guardrails, Macie for demos of PII-aware governance—introduced **after** core cognition loop exists.

### Modes (behavior presets)

Companion (default), Architect, Challenger, Creative, Mentor, Focus. Reflect/Mirror is optional and non-core.

**Criterion:** modes differ via **prompting + retrieval policy + tone**, not via separate disjoint memory silos unless there is an explicit compliance reason later.

### UI intent (three panels)

1. **Left** — Conversations, modes, documents, memory, journal, settings.
2. **Center** — Main adaptive conversation: mode, streaming replies, placeholders for uploads/voice.
3. **Right (differentiator)** — Intelligence panel: active context, memories used, security/routing summary, snippets of behavioral profile — even when data is mocked in early phases.

**Stack criterion:** Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui — scaffold cleanly; resist boilerplate-heavy templates that dictate product identity before the cognition UX is polished.

---

## Non-goals (initial phases)

- Competing with frontier models on general intelligence benchmarks
- Production billing / multi-tenant enterprise from day one
- Native desktop packaging (evaluate Tauri/Electron after solid web MVP)
- Full memory graph visualization in V1

---

## Phase gates & progression

| Phase | Objective | Narrative payoff |
|--------|------------|-------------------|
| **A** | Cognitive shell: three-panel UX, mock inspectable cognition | Demonstrate transparency story without AWS |
| **B** | Real minimal loop: persist → summarize → structured memory stubs → naive or vector retrieval | Intelligence panel grounded in real retrieval |
| **C** | Security depth: improved PII/redaction/policy + audit traces surfaced to developers or UX | Explainable ingestion → retrieval path |
| **D** | AWS portfolio hardening: auth, KMS, managed vector store, observability | Interview-ready diagrams + live infra |

Defer features that belong to later phases unless they unblock Phase A demos.

---

## V1 acceptance criteria (Phase A “done”)

These checks define when the **initial UI milestone** is complete for portfolio demo purposes.

### Layout & IA

1. Persistent **three-column** shell: sidebar (nav), centered conversation column, dedicated **intelligence panel** on large screens (stack or drawer behavior acceptable on narrow viewports without breaking usability).
2. Left nav exposes at least stubs for:**Conversations**, **Modes**, **Memory**, **Journal**, **Documents**, **Settings** (labels may route to placeholders).
3. Center column shows:a message list/thread affordance,input area,and a visible **mode** indicator.

### Inspectable cognition (mocked acceptable)

4. Intelligence panel renders **explicit** placeholders or mock data for: **active context**, **memories used** (title + rationale snippet + confidence indicator), **security status**, **routing / model role summary**, **compact profile excerpt**.
5. User can toggle or expand sections without losing the conversational focus (readable typography, restrained palette).

### Memory lifecycle UX (local state acceptable)

6. At least one “memory” shown with **Approve** **Delete** controls wired to client-side state — demonstrates consent/deletion ergonomics early.
7. Simulated streaming or incremental assistant response (does not require a hosted model in Phase A).

### Engineering hygiene

8. Repo runs with **`npm run dev`** without manual secret setup; lint passes where configured.
9. README or docs link explains how this repo maps to phased roadmap (README may reference this file briefly).

Meeting **items 1–7** qualifies as Phase A demonstration-ready; **item 9** aligns documentation with the phased plan.

---

## Marketing language to avoid vs prefer

Avoid absolute claims (“unhackable”). Prefer:“security-first adaptive intelligence”, “transparent memory”, “governed retrieval”.

---

## Summary

SecureMind succeeds as a portfolio and learning vehicle by committing to **inspectable cognition + layered secure memory**. Phased delivery preserves momentum: ship the **experience of transparency** early, ground retrieval in reality next, harden governance and AWS presence after the core loop earns its complexity.

---

## Vision sync — decisions locked through product conversation

*Last updated: 2026-05-12. These decisions extend and refine the criteria above.*

### Audience & first user

- **Primary user:** owner/developer (you).
- **Secondary:** inner circle (close professional colleagues, selective employers or partners) — read-only/demo access; not public.
- **Accounts / auth:** deferred to Phase D. No multi-tenant pressure in early phases.

### Core job-to-be-done

A **personal assistant with better memory than any mainstream AI** — layered, continuous, personalized. The differentiator is NOT raw capability but **continuity that feels like a real relationship**: it knows what was discussed, infers your preferences implicitly, and adapts its register to however you want to interact without requiring settings forms.

### Relationship tone — defaults + steerable range

- **Default stance:** calm, capable collaborator ("calm coworker").
- **Steerable conversationally** — not via persona grids in settings. The user can steer tone naturally ("can you be more direct?" "be warmer today") and the system tracks those steering events as behavioral memory.
- **Full intimacy/emotional-support range is in scope** — the platform must handle empathetic conversation, not just cognition tasks. How far to go is up to the user, surfaced as preference learning rather than forced modes.

### Personas & characters — one adaptive shell

- **Single SecureMind shell** (Option A): no separate "character databases" or fragmented agents.
- Personas are **thin named overlays** — users name them (default: their own name or "You" for the self-reflection voice). They share the same memory layer and differ only in prompting register + retrieval weighting.
- The "Mirror / talk like me" concept: available as a conversational steering state, user-named, **not labeled as a product feature** in the main UI to avoid feeling gimmicky.

### Thread model

- **One perpetual thread** — Discord-style, infinite scroll, no "new chat" mental model.
- **Search** across the sanitized transcript by keyword (later semantic) — accessed via top bar or keyboard shortcut.
- **Bookmarks / pins** — user selects any message and can pin it with an optional label. Pins are listed in the left nav as jump targets into the single thread. Pin previews show **sanitized excerpt** (first ~200 chars); deeply redacted messages show a sparse excerpt plus a note ("Heavy redactions in this snippet").

### PII policy — hard rules, never negotiable

1. **Raw PII never enters any storage or model call.** Detection + scrubbing happens **before** persistence and **before** the text reaches any backend.
2. **Nothing is stored that allows reconstruction.** Redacted segments are replaced by neutral typed placeholders (`[email redacted]`, `[phone redacted]`); the original string is discarded at the edge — never in DOM, state, or database.
3. **Broader semantic context is allowed** (e.g. "struggling with finances," "recovering from knee surgery") once it is no longer a literal identifier — policy design, not a PII violation.
4. **Sensitivity slider** (settings, not in main composer): `Strict` / `Balanced` (default) / `Gentle`. Controls heuristic aggressiveness; **never** allows raw secrets through — it only adjusts how aggressive the pattern-matcher is on ambiguous cases.
5. **No "approve to expose" flow.** If something was caught, it is gone. Users adjust sensitivity instead of requesting to retrieve stored PII.

### PII UX — visible trust surface

- **In the thread:** redacted segments rendered as opaque inline blocks — visually solid, label-only (e.g. `[email]`). Not strike-through, not hidden-with-CSS; the value is absent from the DOM.
- **In the intelligence strip (security tab):** a live session log of scrub events — categories and counts per message turn. Reassures users without storing raw values.
- **Sensitivity slider** lives in Settings. Subtext: *"Adjusts heuristic sensitivity — blocked content is never saved."*

### Voice / speech-to-text

- **Mic always optional** in the composer (not a separate "voice mode").
- STT output is treated as typed composer text and goes through the **same scrub pipeline** before send/persist.
- Browser Web Speech API first (local, no audio sent elsewhere); cloud STT upgrade later with explicit disclosure.
- Reasonable accent handling is a best-effort goal; not a Phase A requirement.

### Copy & micro-interactions

- Composer send button: **"Send"** (not "Send stream" or "Message").
- Composer placeholder: **"Ask me anything"** or **"Message SecureMind"** — short and neutral.
- No explicit "Remember this" / "Forget this session" controls in the composer. If "forget" is added later, it lives in Settings, not the main thread UI.
