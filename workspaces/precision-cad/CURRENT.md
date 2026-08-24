# Precision CAD current session

## 2026-08-24 AI exact bridge execution closure

- Status: `EXACT_BRIDGE_RUNTIME_CONNECTED_LOCAL / RELEASE_HOLD`.
- Integrated implementation base: `920e660d` on both `scope/precision-cad` and
  `integration/nexyfab` before this documentation handoff.
- The stable-reference prerequisite now continues through a durable bridge
  worker that rechecks the current canonical head, executes the actual Node OCCT
  current-head artifact bundle, stores STEP/HLR/dimensions/BOM/verification and
  the canonical manifest immutably, and issues a revision-bound signed receipt.
- Dispatch uncertainty does not cause automatic CAD replay. Expired sent work is
  quarantined as `VERIFIED_UNKNOWN` and can close only from an already persisted
  signed receipt and matching AI aggregate reference.
- Verification: actual OCCT STEP bundle regression, bridge tamper/crash/reconcile
  tests, TypeScript, production build, workspace audit, and all three scope
  checks passed at the integrated source baseline.
- Immutable handoff:
  `HANDOFFS/20260824T134514Z-ai-precision-exact-round-trip.md`.
- Remaining: live staging database/object store/Redis/Railway execution,
  authenticated browser round trip, third-party STEP review, topology campaign,
  experts, manufacturing pilots, and release authority. Exact bundle PASS still
  does not imply authoritative CAD commit or manufacturing approval.

## 2026-08-24 commercial-readiness continuation

- Source implementation commit: `5670cb85` (`[P0] feat(cad): bind AI stable refs to canonical head`).
- Added `nexyfab.precision-cad.mechanical-stable-reference-binding.v1` as the
  fail-closed bridge prerequisite for the AI Design V1 handoff. Precision now
  discovers the matching document from server-owned canonical heads and binds
  the exact revision ID, content SHA-256, rights receipt, FeatureTree, part, and
  every requested stable feature ID. The browser/AI does not supply a document,
  sequence, exact receipt, runtime identity, or PASS state.
- Ambiguous document matches, stale/corrupt heads, unknown feature references,
  malformed/extended contracts, and migration absence remain machine-coded
  `HOLD` outcomes.
- Verification: `workspace:check -- precision-cad` PASS (TypeScript and platform
  architecture); focused stable-binding tests `2/2` PASS; canonical revision and
  current-head bundle regression `13/13` PASS including a real OCCT STEP write.
- Remaining bridge work is integration-owned: durable dispatch/outbox, exact
  bundle execution after rebind, Precision signing, immutable receipt storage,
  AI aggregate CAS update, and read-model refresh. Those integration-owned
  items are now implemented locally at `920e660d`; this historical source entry
  still records the earlier `NOT_RUN` boundary and commercial release remains
  `HOLD`.

- Status: `SOURCE_FREEZE_READY / INTERNAL_30_OF_30_BOUNDED / RELEASE_HOLD`
- Source branch: `scope/precision-cad`
- Integration target: `integration/nexyfab`
- Baseline: `baseline/pre-scope-20260823`
- Current integration base: `bd200378` on `integration/nexyfab`; the preserved GP-02 through GP-11 work reapplied without conflicts after the AI V3-V10 merge and awaits its implementation commit.
- Delivered boundary: the clean-room mechanical candidate set is implemented as 30/30 bounded exact handlers. The closing slices are the topology-preserving bounded blind-hole delete/cap repair, the versioned three-point orthogonal rectangular sweep path, and the two-member unfused weldment compound with a hash-bound millimetre cut list. These contracts do not claim general delete-face, sweep, weldment, manufacturing, or commercial completeness.
- Source verification: fixed Node.js 22.23.2/npm 10.9.8 `workspace:check -- precision-cad` passed with zero ownership/classification violations, TypeScript PASS, and architecture PASS. The focused native/registry/sketch/sheet-metal/weldment suite passed 93 tests with one conditional external-corpus skip. The earlier production build result remains pre-integration and must be rerun at the final integrated HEAD.
- Scope preflight: the platform-owned legacy PHP changes are now committed on integration. A generated `mechanical-core-internal-verification.json` containing only sandbox `EPERM` failures was excluded from the source freeze and retained in recovery checkpoints; it is not success evidence.
- Immediate action: freeze and commit only the intended Precision-owned tree, generate a canonical UTC handoff pointing to that implementation commit, validate it, then merge the clean Scope branch once with `--no-ff`.
- Integration acceptance: retain literal v1/v2 schema routing, server-loaded current-head and rights bindings, stable machine tokens, fail-closed unsupported forms, and `authoritativeCommit: false`/`commercialReleaseReady: false`. AI Design may emit only versioned intent and provenance references; it may not manufacture Precision receipts, revisions, artifacts, runtime identity, XCAF results, or release state.
- CI sequencing: run focused Precision tests after the Scope merge, then workspace audit, architecture, type, build, security and database gates. Run the full GitHub CI/E2E only after all planned integration edits are complete. The previously cancelled E2E is not completion evidence.
- Deferred Precision action: begin GP-12 authority-owned CAS commit, stable topology edit/replay survival, and expanded XCAF provenance only after this GP-10 integration intake is frozen and verified; do not mix those new semantics into the GP-10 merge.
- Release: `HOLD` (`authoritativeCommit: false`, `commercialReleaseReady: false`). Integration is development `GO`, but immediate PR merge, staging promotion, production deployment, and Git history rewrite remain `NO-GO` until their independent gates pass.
