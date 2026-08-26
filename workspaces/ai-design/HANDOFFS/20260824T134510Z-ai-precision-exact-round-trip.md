# AI Design handoff: AI-to-Precision exact round trip

- Created: `2026-08-24T13:45:10Z`
- Branch: `scope/ai-design`
- Head: `920e660d448f3da9cac47f1446c980137f9b1caa`
- Integration target: `integration/nexyfab`
- Status: `RUNTIME_CONNECTED_LOCAL / COMMERCIAL_RELEASE_HOLD`
- Supersedes as current execution status, without rewriting:
  `20260824T170157+0900-ai-design-v9-v10-integration-addendum.md`

## Summary

The previously deferred V10 Precision path is connected locally. The server
validates project, session, candidate, runtime and complex revisions, binds the
server-owned current canonical CAD head and stable features, persists one
idempotent exact job, executes the real current-head Node OCCT bundle, stores a
private immutable artifact manifest, and reflects only a verified signed
Precision receipt into the AI aggregate and read model.

The browser and AI Design cannot author PASS or manufacturing authority.

## Changed paths

- `src/lib/ai/aiDesignPrecisionBridgeJobStore.ts`
- `src/lib/ai/aiDesignPrecisionBridgeJobStore.test.ts`
- `src/lib/ai/aiDesignPrecisionExactWorker.ts`
- `src/lib/ai/aiDesignPrecisionExactWorker.test.ts`
- `src/lib/ai/aiDesignPrecisionHandoffCoordinator.ts`
- `src/lib/ai/aiDesignPrecisionHandoffCoordinator.test.ts`
- `src/lib/ai/aiDesignPrecisionVerification.ts`
- `src/lib/ai/aiDesignPrecisionVerification.test.ts`
- `src/lib/ai/aiDesignComplexWorkspaceService.ts`
- `src/lib/ai/aiDesignComplexWorkspaceStore.ts`
- `src/lib/ai/aiDesignWorkspaceRuntimeStore.ts`
- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/HANDOFFS/20260824T134510Z-ai-precision-exact-round-trip.md`

## Execution and recovery boundary

- Replaying the same handoff, runtime command, complex command, or enqueue
  returns the existing identity; changed content under that identity conflicts.
- The worker revalidates AI and Precision authority immediately before dispatch.
- STEP, HLR SVG, dimensions, BOM, verification JSON, and the canonical manifest
  use content-addressed private immutable storage.
- An expired sent lease becomes `VERIFIED_UNKNOWN`, not `PENDING`; CAD is not
  automatically rerun.
- Reconciliation requires an existing signed immutable receipt and the exact
  aggregate reference.
- Signature, validity window, revision, stable-head, object hash, manifest, and
  scope mismatch remain fail-closed.

## Verification

- [x] `npm run typecheck`
- [x] `npm run test:accuracy:common`
- [x] `npm run workspace:check -- ai-design`
- [x] Production Next.js build: 301 pages and bundle budget PASS.
- [x] Bridge/coordinator/worker/route/PostgreSQL authority regression PASS.
- [x] Actual current-head Node OCCT bundle and STEP execution PASS.
- [x] Workspace integration status and audit PASS with all scopes synchronized
  and zero ownership collisions before documentation updates.

## Remaining work and risks

- Staging PostgreSQL migration `2026082403`, restore, real private object
  storage, Redis, and Railway worker/cron evidence are not yet recorded.
- Authenticated browser request-to-read-model E2E, multi-instance, tenant,
  stale-head, tamper, restart, alarm, and rollback evidence remain open.
- Key rotation, external STEP review, deterministic domain campaigns, rights and
  legal approval, independent experts, fabrication, and field pilots remain
  required.
- `manufacturingReleaseReady` and commercial release remain `false`/`HOLD`.
