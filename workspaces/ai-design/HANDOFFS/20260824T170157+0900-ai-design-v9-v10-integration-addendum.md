# AI Design V9-V10 integration execution addendum

- Created: `2026-08-24 17:01:57 +09:00`
- Producer branch: `scope/ai-design`
- Target branch: `integration/nexyfab`
- Status: `READY_TO_START_INTEGRATION`
- Amends without modifying: `20260824T153232+0900-ai-design-chat-first-v9.md`
- Required companion: `20260824T164434+0900-ai-design-pre-precision-v10.md`

## Why this addendum exists

The V9 handoff is an immutable record of the chat-first workspace contract and the evidence available when V9 was completed. Integration is now starting after V10 added the missing action adapter, separated client state, nonpersistent preview lifecycle, unified controller, and deterministic UI fixtures.

Integration must therefore use:

1. V9 for chat-first information architecture, synchronized 2D/3D semantics, action cards, mobile behavior, recovery presentation, and the AI/Precision authority split.
2. V10 for event dispatch, server/local/preview state separation, explicit apply confirmation, stale/offline handling, request correlation, and integration fixtures.

The original V9 file is intentionally unchanged to preserve handoff history.

## Entry conditions

Before UI wiring begins, integration should verify:

- the target worktree is `integration/nexyfab`;
- the AI Design changes are integrated as one reviewable unit rather than copied file-by-file;
- the actual API still returns `{ model, ux, unified }` with matching project, session, runtime revision, and complex revision;
- exact CAD and manufacturing release remain outside browser and AI Design authority;
- the platform-owned legacy PHP state is resolved explicitly.

## Platform security preflight

Do not restore the following files from release backups merely to make scope checks green:

- `adminlink/index.php`
- `public/search.php`
- `public/send-mail.php`

Evidence found before this addendum:

- `public/send-mail.php` contained a historical embedded reCAPTCHA secret and is already deleted on integration by P0 security commit `980989c1`.
- `adminlink/index.php` contains a hard-coded legacy administrator password and should not be reintroduced without an explicit security decision.
- `public/search.php` is legacy PHP under `public/`; the current Next proxy blocks `/search.php` with 404 because Next.js does not execute PHP and could otherwise disclose source.
- Git objects and multiple release candidates retain recoverable copies, so this is not an unrecoverable data-loss event.
- All three persistent scope worktrees currently show the same deletions, which is consistent with an incomplete cross-branch hardening cleanup rather than an AI Design implementation dependency.

Recommended platform action:

1. Treat the three paths as a platform security cleanup, not an AI Design change.
2. Keep `public/send-mail.php` deleted and confirm external rotation of the historical credential.
3. Decide whether to permanently delete `adminlink/index.php` and `public/search.php`; the recommended outcome is removal after obsolete callers and documentation are updated.
4. Replace the `/adminlink/index.php` link in the current Next administrator page with the supported authenticated Next flow.
5. Update the security policy, route-security tests, secret scan, release baseline, and rollback evidence.
6. Commit the decision on the platform/integration path and propagate the commit to scope branches. Do not solve it by copying backups into dirty worktrees.

This preflight is required to make workspace checks structurally clean, but the missing PHP files do not block the current Next production build; the AI Design branch generated all 298 static pages successfully.

## Integration order

### Phase 1: integrate the AI producer

1. Integrate the AI Design V3-V10 changes into `integration/nexyfab` with history and ownership review.
2. Preserve the private, authenticated, no-store complex-workspace read API.
3. Preserve server-authoritative Command V2/V3 parsing, CAS revisions, immutable conceptual artifacts, and signed evidence boundaries.
4. Run typecheck, AI Design/API regression, common accuracy, candidate-manifest checks, workspace audit, and production build before UI mutation.

Exit condition: the integration branch exposes the same V9 model and V10 contracts with no Precision or manufacturing authority escalation.

### Phase 2: bind the real chat-first workspace

Primary integration-owned consumer candidates remain:

- `src/app/[lang]/ChatHero.tsx`
- `src/app/[lang]/ChatCadViewer.tsx`
- `src/app/[lang]/nexyfab/ai/page.tsx`
- `src/app/[lang]/nexyfab/design/**`
- `src/app/[lang]/shape-generator/**`

Required behavior:

1. Keep chat as the orchestration spine and the location for explanations, clarification, recommended actions, and recovery.
2. Present real 2D and 3D together on desktop; use chat-first plus full-screen 2D/3D tabs and a modal bottom sheet on mobile.
3. Render `unified.cards` as the only action source. Do not infer unrendered commands in components.
4. Construct `UnifiedWorkspaceServerSnapshotV1` from the API `model` and `unified` values and reject revision/projection mismatches.
5. Drive local interaction through `AiDesignUnifiedWorkspaceControllerV1`.
6. Keep linked selection stable across chat, 2D, 3D, comparison, and model fallback.
7. Show `NEEDS_INPUT` for missing or ambiguous 2D/3D mappings; never guess and commit an association.
8. Keep model choice, fallback/change explanation, validation state, and Precision state visible in the workspace.

Exit condition: all ten V10 fixtures render deterministically in desktop and mobile component tests without a live exact-CAD dependency.

### Phase 3: connect action transport

Route controller outputs by kind:

- `local-instruction`: open or update local chat/input/comparison/evidence/recovery UI only.
- `server-request`: send only the parser-validated V2 command to the existing AI Design action endpoint.
- `concept-preview-request`: call a bounded preview transport that cannot persist authoritative state or claim exact verification.
- `concept-apply-request`: require a visible user confirmation, proposal ID match, request ID match, and newer authoritative server snapshot.
- `precision-cad-handoff`: enqueue only after checking project/session/candidate plus runtime and complex revisions; it is a request, not an execution or PASS result.

The integration layer must decide and implement the preview transport/persistence boundary. Preview evidence must remain `NOT_RUN` for geometry, topology, and manufacturing.

Exit condition: preview, reject, explicit apply, stale CAS, offline recovery, and request correlation pass integration tests without browser-authored authority.

### Phase 4: optimize UX and mobile from evidence

Use the existing V8/V9 requirements as acceptance criteria:

- one recommended primary action;
- 44 px minimum touch targets;
- keyboard parity and deterministic focus restoration;
- screen-reader live announcements for generation, preview, apply, stale, and recovery state;
- 200% zoom/reflow and safe-area behavior;
- reduced-motion support;
- one-finger edit and two-finger camera arbitration;
- mobile background/interruption recovery;
- model fallback that preserves selection and revision context;
- privacy-safe telemetry containing no prompt, drawing, geometry, personal data, or raw project identity.

Exit condition: the five V9 user scenarios and ten V10 fixture states have recorded browser/mobile/accessibility evidence. Headless evidence alone is insufficient.

### Phase 5: connect Precision CAD later

1. Pass only `nexyfab.ai-design-precision-cad-handoff.v1` across the boundary.
2. Require stable reference rebinding and runtime+complex revision agreement.
3. Let Precision CAD own exact kernel execution, idempotency, rollback, and signed verification receipts.
4. Refresh the AI read model only from accepted server receipts.
5. Keep exact commits outside AI-view undo/redo.
6. Keep manufacturing release false until all independent release gates pass.

Exit condition: request -> exact execution -> signed receipt -> read-model refresh passes without the browser or AI Design authoring PASS.

## Test matrix after integration

Run at minimum:

1. `text-to-synchronized-2d-3d`
2. `drawing-to-3d-ambiguity-resolution`
3. `existing-3d-text-edit-updates-2d`
4. `mobile-interruption-recovery`
5. `model-fallback-preserves-selection`
6. all ten `IntegrationFixtureV1` states
7. preview -> reject
8. preview -> explicit apply -> matching newer snapshot
9. preview -> competing server revision -> stale recovery
10. offline draft block -> reconnect -> server refresh
11. Precision handoff revision mismatch rejection
12. signed Precision receipt refresh with manufacturing release still false

Also rerun:

- TypeScript and focused lint
- AI Design/API regression
- common domain accuracy and candidate manifests
- route-security and secret scan
- integration workspace audit
- production build and bundle budget

## Stop conditions

Stop and correct the integration if any of these occur:

- a component invents an action not present in `unified.cards`;
- preview mutates the authoritative runtime before explicit apply;
- the browser can author or upgrade verification PASS;
- runtime or complex revision mismatches are ignored;
- 2D/3D ambiguous selection is guessed;
- model fallback loses selection or revision context;
- mobile recovery silently discards a draft without a message;
- raw prompt, drawing, geometry, credentials, or personal data enters telemetry;
- legacy PHP is restored only to hide workspace ownership violations;
- manufacturing release becomes true from AI or fixture evidence.

## Current verified producer baseline

- V3-V10 AI Design/API regression: `59 files / 210 tests` passed.
- V10 focused suite: `5 files / 19 tests` passed.
- TypeScript and focused ESLint passed.
- Common accuracy: `11 files / 62 tests` passed.
- Candidate manifests: `7 / 7` passed.
- Production build: `298` static pages; bundle budget passed.
- Copyright boundary: independent concepts/contracts and synthetic fixtures only; no copied manual prose, screenshots, proprietary geometry, or third-party implementation.

Commercial rollout remains `HOLD` until the real UI evidence, durable infrastructure, Precision round trip, external holdouts, and pilot gates are all complete.
