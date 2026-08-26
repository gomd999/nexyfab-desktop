# Precision CAD GP-10 bounded mechanical 30-of-30 handoff

- Created: `2026-08-24T07:57:06Z`
- Recorded at: `2026-08-24T07:57:06Z`
- Branch: `scope/precision-cad`
- Head: `04d39ea9227b382ec40508b6d6f601a0115fe103`
- Integration target: `integration/nexyfab`
- Owner: `scope/precision-cad`
- Source state: `DIRTY_IMPLEMENTATION_COMMIT_PENDING`
- Implementation state: `INTERNAL_30_OF_30_BOUNDED_EXACT`
- Commercial release state: `HOLD`

The `Head` value is the currently checked-out base commit only. It does not
contain the uncommitted GP-10 delivery and is not an integration merge unit.

## Summary

GP-10 closes the enumerated 30 mechanical candidates with one independently
written, versioned, bounded exact handler per identifier while keeping broad or
unsupported semantics fail-closed. The closing slices implement bounded native
blind-hole delete/cap repair, orthogonal rectangular sweep-path construction,
and a two-member unfused weldment with a generated cut list. Integration and
commercial authority remain intentionally withheld.

## Delivered in the closing slices

- Bounded blind-hole delete/cap repair validates the incoming holed B-rep,
  removes the cylindrical wall, floor, and perforated top, reuses the real outer
  wire for the cap, solidifies the retained faces, and verifies native topology
  and STEP round-trip.
- Versioned `cad.mechanical.sweep-path` accepts only a rectangular profile on a
  three-point, two-segment orthogonal path with the declared start-normal frame
  and right-corner transition. General `tree:sweep_path` remains unsupported.
- Versioned `cad.mechanical.weldment` creates exactly two touching rectangular
  members as an unfused compound, verifies two solids through STEP round-trip,
  and binds a deterministic millimetre cut-list artifact to the request,
  revision, runtime identity, registry hash, and geometry hashes.
- Weld bead geometry, process authorization, material authority, release
  authority, and XCAF occurrence verification remain explicit machine-readable
  negatives rather than inferred passes.
- `GP_10_MECHANICAL_EXACT_CLOSED_LOOP_ADR.md` and `INTEGRATION_ACTIONS.md`
  record that 30/30 means bounded internal candidate coverage only.

## Changed paths

- `src/lib/cad/featureRegistry.ts`
- `src/lib/cad/featureRegistry.test.ts`
- `src/lib/cad/featureRegistryDecision.ts`
- `src/lib/cad/featureRegistryDecision.test.ts`
- `src/lib/occt/bridge.ts`
- `src/lib/occt/nodeOcctBridge.ts`
- `src/lib/occt/nodeOcctBridge.test.ts`
- `src/lib/occt/nodeOcctCommercialRuntime.ts`
- `src/lib/occt/nodeOcctCommercialRuntime.test.ts`
- `src/lib/occt/nativeMechanicalExactFeatureLoop.ts`
- `src/lib/occt/nativeMechanicalExactFeatureLoop.test.ts`
- `src/lib/occt/boundedWeldment.ts`
- `src/lib/occt/boundedWeldment.test.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/GP_10_MECHANICAL_EXACT_CLOSED_LOOP_ADR.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/HANDOFFS/20260824T075706Z-gp10-mechanical-bounded-30-of-30.md`

## Verification

- [x] `npm run typecheck`
- [ ] `npm run platform:architecture:check` (must be rerun after the Scope
  ownership violations are resolved)
- [x] `npm run build` (292 static pages and bundle budget passed)
- [x] Focused native OCCT, runtime, registry, sketch, sheet-metal, and weldment
  suite: 8 files passed, 93 tests passed, 1 conditional external-corpus test
  skipped.
- [x] `git diff --check` (line-ending conversion warnings only)
- [ ] `npm run workspace:check -- precision-cad`: invoked and blocked at Scope
  preflight by the
  already-present platform-owned changes to `adminlink/index.php`,
  `docs/evidence/cad-independent/mechanical-core-internal-verification.json`,
  `public/search.php`, and `public/send-mail.php`. No shared or unclassified new
  path violation was reported. These files were not reverted or modified as
  part of the closing slices.

The build warned that `REDIS_URL` is not configured, so production
multi-instance rate limiting remains an environment deployment action.

## Remaining work and risks

- The source worktree is dirty and the recorded base `Head` does not contain the
  implementation. Integration must wait for a reviewed Precision-owned commit
  and a new immutable source-freeze receipt.
- Four platform-owned paths block the required Scope check and must not be
  concealed inside the Precision commit.
- The current integration E2E was cancelled and cannot be treated as final
  evidence; full CI/E2E must run after the final integration edit.
- Durable CAS authority, topology edit survival, expanded XCAF provenance,
  GD&T/PMI, independent exchange review, manufacturing evidence, localization,
  operational readiness, and real pilots remain incomplete.
- Production release and Git history rewrite remain `HOLD`.

## Exact meaning and release boundary

The 30/30 result does not establish arbitrary feature semantics, full sketch or
surface authoring, stable topology naming across edits, multi-body XCAF
completeness, GD&T/PMI, independent exchange conformance, manufacturing
correctness, standards approval, localization review, operational readiness, or
commercial fitness. Receipts remain `authoritativeCommit: false` and
`commercialReleaseReady: false`.

## Next Precision-owned execution order

1. Add authority-owned durable compare-and-swap commit and immutable artifact
   lookup so a verified current-head result cannot be replaced by caller state.
2. Add a rights-cleared topology-survival corpus for edit/regenerate,
   save/reopen, undo, replay, ambiguity, and explicit relink outcomes.
3. Extend XCAF identity binding with immutable worker image and dynamic-library
   provenance, stale invalidation, save/reopen, undo, idempotent replay, and a
   separately versioned GD&T/PMI boundary.
4. Bind the same committed revision to STEP, XCAF, HLR drawing, dimensions, BOM,
   and cut-list artifacts, rejecting any stale or mixed-revision set.
5. Keep AI Design integration as a versioned intent/provenance producer only;
   implementation changes outside Precision remain documentation-only requests.
6. Collect current independent authority, exchange, reviewer, deterministic
   campaign, fabrication, localization, operational, and field-pilot evidence
   before changing any commercial release state.

## Clean-room boundary

Only general geometry and engineering concepts plus independently authored
contracts, identifiers, fixtures, algorithms, and acceptance criteria are used.
No manual or encyclopedia prose, table, diagram, example sequence, source,
screenshot, parameter taxonomy, or expressive layout is copied. Any input with
unclear commercial or derivative-use rights remains excluded and fail-closed.

## Integration intake addendum

This additive section prepares the immutable GP-10 snapshot above for the
2026-08-24 integration resumption. It does not rewrite the delivered claims or
convert any `HOLD` into `PASS`.

- Integration target: `integration/nexyfab`.
- Current source base HEAD: `04d39ea9227b382ec40508b6d6f601a0115fe103`.
  The GP-10 tree still contains uncommitted Scope work, so this hash is not an
  implementation handoff commit and must not be merged as if it contained the
  delivery.
- Integration context: preserve the work recorded by
  `docs/operations/integration-ci-pause-handoff-20260824.md`. Its cancelled E2E
  run is not final evidence, PR #79 is not immediately mergeable under the
  release rules, and full CI/E2E belongs after the last planned integration
  change.
- Scope intake is blocked until the existing platform-owned changes to
  `adminlink/index.php`,
  `docs/evidence/cad-independent/mechanical-core-internal-verification.json`,
  `public/search.php`, and `public/send-mail.php` are assigned outside the
  Precision commit or resolved by the integration owner.

### Required source freeze

1. Preserve the current dirty tree and inspect ownership; do not copy a selected
   subset into integration or discard unrelated user changes.
2. Commit the complete intended Precision-owned change set on
   `scope/precision-cad` and record the full implementation commit, rather than
   the source-base hash above, in a new immutable integration receipt.
3. Require `npm run workspace:check -- precision-cad` and
   `npm run workspace:handoff:check -- precision-cad` to pass at that commit.
4. Record the exact commit, changed-path manifest, schema identifiers, registry
   hash, runtime identity policy, focused test receipt, and known external
   blockers before integration begins.

### Required integration sequence

1. From the clean integration checkout, run
   `npm run workspace:integration-status` and verify the frozen Scope commit and
   handoff.
2. Merge `scope/precision-cad` exactly once with `git merge --no-ff`; do not
   relabel copied files or mix unfinished GP-12 semantics into the GP-10 merge.
3. Preserve v1 and v2 current-head routes and literal feature negotiation. An
   unknown schema, silent fallback, stale revision, tenant mismatch, tampered
   receipt/artifact, caller-supplied runtime/XCAF value, or unsupported broad
   feature must remain `HOLD`.
4. Run the focused native OCCT/registry/sketch/sheet-metal/weldment tests,
   TypeScript, production build, `npm run workspace:audit`, and
   `npm run platform:architecture:check` at the merged HEAD.
5. After every planned integration-owned contract, CI, database, security, and
   AI adapter change is present, run the full CI/E2E once at the final commit.
   Then run the integration/main-only large-assembly, OCCT burn-in, and full
   milestone checks required by the release process.

### Integration acceptance boundary

- AI Design is an untrusted versioned intent/provenance producer only.
- The caller supplies path identity and authenticated context only; Precision
  loads current revision, rights, registry, runtime, exact artifacts, and XCAF
  inputs on the server.
- `EXACT_BUNDLE_PASS`, `EXACT_BUNDLE_V2_PASS`, geometry `PASS`, solver `PASS`,
  or XCAF occurrence binding cannot create commit or commercial authority.
- Redis-backed production rate limiting, worker secrets/private networking,
  tenant authorization, CAS/idempotency, stale propagation, audit retention,
  independent exchange evidence, external review, and pilots remain separate
  gates.
- Production deployment and history rewrite remain prohibited while the
  integration pause document's `NO-GO` conditions are unresolved.
