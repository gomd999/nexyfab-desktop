# AI-to-Precision exact round-trip integration handoff

- Created: `2026-08-24T13:45:14Z`
- Branch: `scope/precision-cad`
- Head: `920e660d448f3da9cac47f1446c980137f9b1caa`
- Integration target: `integration/nexyfab`
- State: `EXACT_BRIDGE_RUNTIME_CONNECTED_LOCAL / RELEASE_HOLD`
- Predecessor:
  `20260824T121700Z-ai-precision-stable-reference-binding.md`

## Summary

The stable-reference handoff is no longer the end of the local integration
path. The server now persists one revision-bound exact job, revalidates the AI
and Precision authorities immediately before dispatch, invokes the existing
real current-canonical mechanical artifact builder, stores its outputs as
private immutable objects, signs a request/revision/manifest-bound receipt, and
records it into the AI aggregate and read model.

The exact artifact set contains STEP, HLR SVG drawing, dimension receipt, BOM
receipt, verification JSON, and a canonical manifest. Every object uses a
content-addressed key and is read back with SHA verification. Conflicting
overwrite is rejected.

## Changed paths

- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/GP_10_MECHANICAL_EXACT_CLOSED_LOOP_ADR.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/HANDOFFS/20260824T134514Z-ai-precision-exact-round-trip.md`

## Precision invariants preserved

- The browser and AI cannot supply the canonical document, current revision,
  exact receipt, runtime identity, artifact bytes, manifest, PASS, or release.
- The worker reloads and validates the current head and stable references before
  exact execution.
- The signed receipt is limited to the request validity window and binds every
  exact scope to the canonical manifest SHA-256.
- Known bounded CAD failure creates a signed FAIL receipt without an exact
  manifest digest.
- A post-dispatch exception with uncertain completion is not retried as a new
  CAD run. Lease recovery changes it to `VERIFIED_UNKNOWN`.
- `VERIFIED_UNKNOWN` may reconcile only when an already persisted immutable AI
  receipt and the complex aggregate's exact receipt reference both validate.
- PASS retains `manufacturingReleaseReady: false`; it is not a canonical edit
  commit, GD&T/PMI approval, material/process authority, or fabrication release.

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npm run workspace:check -- precision-cad`
- Actual current-canonical Node OCCT bundle and STEP write: PASS.
- Exact worker success, known HOLD, crash/lease uncertainty, and no-second-run
  reconciliation tests: 4/4 PASS.
- Durable bridge enqueue/claim/receipt/reconcile/tamper tests: 5/5 PASS.
- Request coordinator and handoff route tests: 6/6 PASS.
- Signed receipt boundary tests: 3/3 PASS.
- Focused integrated suite: 12 files, 38 tests PASS.
- Worker/storage-related commit gate: 46 files, 341 tests PASS.
- Production build: 301 pages and bundle budget PASS.
- Precision scope check: TypeScript and architecture PASS, no ownership issues.
- AI and Platform scope checks plus integration audit also PASS at the same
  implementation baseline.

## Remaining work and risks

- The implementation has not yet executed against live staging PostgreSQL,
  private object storage, Redis, or deployed Railway worker/cron infrastructure.
- There is no current third-party STEP interchange review, long-running OCCT
  burn-in, broad topology edit/save/reopen corpus, independent expert signature,
  shop-floor fabrication receipt, or field pilot bound to this revision.
- Exact execution is locally runtime-connected, while authoritative CAD commit,
  product qualification, manufacturing approval, and commercial release remain
  `HOLD`.
