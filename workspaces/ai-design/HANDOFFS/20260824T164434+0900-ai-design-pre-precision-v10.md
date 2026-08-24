# AI Design Pre-Precision Integration Readiness V10

- Date: 2026-08-24
- Branch: `scope/ai-design`
- Status: `AI_SCOPE_V10_COMPLETE_UI_AND_PRECISION_CONSUMERS_DEFERRED`
- Changed scope: `worktrees/ai-design` AI Design-owned paths only
- Precision CAD code changed: no
- Integration-owned React/Three code changed: no

## Outcome

The AI-owned chat-first workspace is now ready to be consumed by a real UI without giving the browser exact-CAD or manufacturing authority. V10 closes the gap between V9 renderer models and UI event handling with a validated command adapter, separated client state, explicit preview lifecycle, unified controller, and deterministic integration fixtures.

This does not claim that the final React/Three user interface, real-device mobile behavior, durable production infrastructure, or Precision CAD round trip is complete. Those remain consumer work and evidence gates.

## Process completed

### 1. Inspection

- Rechecked V9 action-card, command V2, runtime/CAS, recovery, mobile, synchronized 2D/3D, accessibility, usability-evidence, and Precision authority contracts.
- Confirmed the V9 API returns `{ model, ux, unified }` but integration still needed a client-owned coordinator.
- Identified and corrected a draft implementation that mapped `PREVIEW_CHANGE` directly to persistent `ADJUST_GAUGE`. V10 now makes preview and apply distinct, bounded requests.

### 2. Parallel implementation and root adjustment

- Luna agent: renderer-neutral client state and recovery separation.
- Luna agent: chat action adapter.
- Luna agent: ten deterministic integration fixtures.
- Root integration: reviewed all outputs, replaced the unsafe preview mapping, parser-validated real V2 commands, added the preview lifecycle, and composed the results in one controller.

### 3. Verification and adjustment

- Exercised preview, explicit apply, reject, stale revision, newer complex revision, offline mutation blocking, model fallback, fixture-only Precision PASS, and Precision handoff boundaries.
- Bound both the authoritative `model` source and derived V9 `unified` workspace into one validated runtime/complex revision snapshot to prevent consumer-side projection mismatch.
- Required a matching request ID and newer server snapshot before concept apply is accepted as complete.

## Implementation inventory

### Chat effect adapter

Files:

- `src/lib/ai/aiDesignChatActionCommandAdapterV1.ts`
- `src/lib/ai/aiDesignChatActionCommandAdapterV1.test.ts`

Behavior:

- Converts rendered V9 effects into one of five explicit outputs: local instruction, parser-validated V2 server request, nonpersistent concept-preview request, explicit concept-apply request, or Precision CAD handoff.
- Runs every V2 request through `parseAiDesignWorkspaceClientCommandV2`; it does not rely on a TypeScript cast as runtime validation.
- Keeps preview requests nonpersistent and exact-free.
- Keeps concept apply separate from the old `BEGIN_PARAMETRIC_EDIT` command and binds it to a proposal ID.
- Requires both runtime and complex revisions for a Precision handoff.
- Never returns exact execution, verification PASS, or manufacturing-release authority.

### Client state

Files:

- `src/lib/ai/aiDesignUnifiedWorkspaceClientStateV1.ts`
- `src/lib/ai/aiDesignUnifiedWorkspaceClientStateV1.test.ts`

State separation:

- `server`: authoritative source plus V9 renderer projection, bound to the same project/session/runtime/complex revisions.
- `localView`: canvas mode, panel, linked selection, and public model fallback context.
- `previewDraft`: local uncommitted gauge draft only.
- `recovery`: connectivity, stale/conflict state, user-facing bounded message, and mutation blocking.

Newer server snapshots preserve local view context but discard an uncommitted client draft and report that recovery event. Foreign, stale, malformed, authority-escalating, or mismatched projections fail closed.

### Preview lifecycle

Files:

- `src/lib/ai/aiDesignPreviewLifecycleV1.ts`
- `src/lib/ai/aiDesignPreviewLifecycleV1.test.ts`

State flow:

`IDLE -> DRAFT -> PREVIEWING -> PREVIEW_READY -> APPLYING -> APPLIED`

Alternative terminal/recovery states are `REJECTED`, `STALE`, and `BLOCKED`.

Rules:

- A clean gauge value cannot request preview.
- Preview evidence is bound to a runtime revision and revision token.
- Preview evidence may contain bounded stable references and summary codes, but all verification fields must remain `NOT_RUN`.
- Apply requires an explicit user confirmation.
- A server revision change invalidates an active preview and preserves only its draft context for recovery.
- A successful apply still requires authoritative server refresh acknowledgement.

### Unified client controller

Files:

- `src/lib/ai/aiDesignUnifiedWorkspaceControllerV1.ts`
- `src/lib/ai/aiDesignUnifiedWorkspaceControllerV1.test.ts`

The controller coordinates:

- gauge draft begin/update;
- V9 chat effect dispatch;
- preview request/response correlation;
- explicit concept apply and matching server completion;
- server snapshot refresh and stale invalidation;
- online/offline/reconnecting mutation policy;
- bounded outputs for the owning API or Precision integration layer.

It executes neither server commands nor CAD operations. This makes the UI integration boundary testable without allowing the browser to author a trusted result.

### Deterministic integration fixtures

Files:

- `src/lib/ai/integrationFixtureV1.ts`
- `src/lib/ai/integrationFixtureV1.test.ts`

Fixture states:

1. `empty`
2. `needs-question`
3. `generating`
4. `three-candidate-review`
5. `gauge-preview`
6. `stale`
7. `offline-mobile`
8. `model-fallback`
9. `precision-pending`
10. `precision-pass-receipt`

All fixtures are renderer-neutral, bounded, synthetic, content-free, geometry-free, secret-free, and non-release. The PASS fixture is explicitly server-signed-fixture-only, browser-authored false, and non-release true.

## UI/UX consumer contract

The intended screen remains chat-first with synchronized 2D and 3D context:

- Chat is the primary explanation, decision, and recovery surface.
- 2D and 3D are simultaneous visual contexts on desktop and tabbed/full-screen contexts on mobile.
- A selection is stable across chat, 2D, and 3D; ambiguous mappings remain blocked as `NEEDS_INPUT`.
- Candidate comparison remains a first-class view, not a chat-only text dump.
- Gauge edits begin as a local draft, show a nonpersistent preview in both views, and expose Apply/Reject only when valid.
- Model selection, fallback explanation, validation status, and recovery state remain visible in the workspace rather than hidden in settings.
- Existing V9 mobile requirements remain: 44 px minimum targets, sticky preview/apply/cancel, modal bottom-sheet inspector, one-finger edit and two-finger camera policy.
- Existing V8/V9 accessibility and i18n descriptors remain consumer requirements, including keyboard parity, focus restoration, live status messaging, and localized copy keys.

## Exact integration sequence

### Integration-owned React/Three consumer

1. Fetch the existing complex-workspace API response `{ model, ux, unified }`.
2. Construct one `UnifiedWorkspaceServerSnapshotV1` from `model` and `unified`; reject mismatched revisions.
3. Create `AiDesignUnifiedWorkspaceControllerV1` and render `server.workspace` as the view-model.
4. Route local instructions to chat/input/comparison/evidence panels without persistence.
5. Send only `server-request` outputs to the existing AI Design command endpoint.
6. Route `concept-preview-request` through an integration-owned transport; return only `AiDesignPreviewEvidenceV1` with `NOT_RUN` verification.
7. Require a visible confirmation before sending `concept-apply-request`; accept completion only with the matching request ID and newer server snapshot.
8. Render the ten fixtures in desktop and mobile component tests before connecting a live backend.
9. Record keyboard, screen-reader, touch, rotation, reconnect, stale revision, and model-fallback browser evidence.

### Precision CAD consumer, deferred

1. Consume only `nexyfab.ai-design-precision-cad-handoff.v1`.
2. Verify project/session/candidate plus expected runtime and complex revisions.
3. Rebind stable 2D/3D/structure/feature/parameter references in the exact kernel.
4. Execute exact CAD only after Precision-owned authorization and idempotency checks.
5. Return a separately signed receipt; the browser cannot create or upgrade PASS.
6. Keep manufacturing release false until the independent release ledger and all required exact checks pass.

No Precision CAD implementation was copied or modified in this scope.

## Deferred evidence gates

These are intentionally not claimed by V10:

- actual chat/2D/3D React component wiring;
- real Three.js selection and overlay binding;
- real-device mobile and assistive-technology evidence;
- preview transport and production persistence;
- PostgreSQL/object storage/Redis/durable worker adapters;
- Precision CAD exact execution and signed round trip;
- external complex-product holdouts, pilots, and manufacturing release.

The deferred browser scenarios should be run after integration, as previously agreed, so evidence is collected against the combined UI rather than a temporary AI-scope shell.

## Verification

- V10 focused: `5 files / 19 tests` passed.
- V3-V10 AI Design/API regression: `59 files / 210 tests` passed.
- TypeScript typecheck passed after the final source+V9 snapshot binding adjustment.
- Focused ESLint passed for all new V10 implementation files.
- Common domain accuracy: `11 files / 62 tests` passed.
- Candidate-manifest Node suite: `7 / 7` passed.
- Production build: `298` static pages generated; bundle budget passed.
- Known build warning only: `REDIS_URL` absent, so the development build used in-memory rate limiting.
- `git diff --check` passed for tracked changes; focused lint/type/tests covered the new files.

`npm run workspace:check -- ai-design` was rerun outside the Windows spawn restriction. It confirmed the correct branch, zero shared violations, and zero unclassified new paths. Preflight remained blocked only by these pre-existing platform-owned deletions:

- `adminlink/index.php`
- `public/search.php`
- `public/send-mail.php`

This work did not modify, restore, or delete those files.

## Copyright and provenance boundary

- Only independently written concepts, state machines, declarative mappings, synthetic fixtures, and tests were added.
- No manual prose, screenshot, proprietary UI composition, proprietary geometry, B-rep, STEP/STL content, or third-party source implementation was copied.
- The earlier rights-safe knowledge and topology contracts remain fail-closed for unknown or restricted sources.
- The fixture-only PASS is synthetic test metadata, not evidence derived from another product or a production verification claim.

## Next milestone

The next milestone is `V11_INTEGRATED_UI_EVIDENCE`, owned by integration for the real React/Three consumer and later joined by Precision CAD for the exact round trip. AI Design should only be changed again when integration evidence exposes a producer-contract defect or when an explicit AI-owned preview transport/persistence decision is approved.
