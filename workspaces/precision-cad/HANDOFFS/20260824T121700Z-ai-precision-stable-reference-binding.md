# AI-to-Precision stable-reference binding handoff

- Created: `2026-08-24T12:17:00Z`
- Branch: `scope/precision-cad`
- Head: `5670cb85e4927dd155201b1a8a0074671cccac2e`
- Integration target: `integration/nexyfab`
- Contract: `nexyfab.precision-cad.mechanical-stable-reference-binding.v1`
- State: `STABLE_REFERENCE_BINDING_IMPLEMENTED / EXACT_ROUND_TRIP_PENDING / RELEASE_HOLD`

## Summary

The implementation commit adds the fail-closed prerequisite for the unchanged
AI Design V1 handoff. Precision discovers a matching document from server-owned
canonical heads, reloads it, and binds the revision, rights receipt, part,
FeatureTree, and every requested stable feature ID. Ambiguous, stale, corrupt,
unmigrated, or unknown inputs remain `HOLD`. The result explicitly records
`exactExecution: NOT_RUN`, `release: HOLD`, and
`manufacturingReleaseReady: false`.

## Changed paths

- `src/lib/cad/mechanicalStableReferenceBinding.ts`
- `src/lib/cad/mechanicalStableReferenceBinding.test.ts`

## Verification

- [x] `npm run typecheck`: PASS.
- [x] `npm run platform:architecture:check`: PASS; 11 services, 5 data stores,
  69 API route groups, 26 cron groups, 6 domains, and 4 contract packages.
- [x] `npm run workspace:check -- precision-cad`: PASS with zero shared,
  foreign, or unclassified path violations.
- [x] Focused stable-reference tests: 2/2 PASS.
- [x] Canonical revision plus current mechanical bundle focused regression:
  13/13 PASS, including the native OCCT STEP writer used by the bundle test.
- [x] `git diff --check`: no patch errors before the implementation commit.

Negative coverage includes ambiguous current-head candidates, a changed or
corrupt head during rebind, an unknown feature reference, missing migration,
digest tamper, extra contract keys, and noncanonical feature order.

## Remaining work and risks

- Integration must keep `nexyfab.ai-design-precision-cad-handoff.v1` unchanged,
  load the immutable AI candidate and checkpoint hash on the server, and persist
  this binding in an integration-owned durable job/outbox transaction.
- A Precision worker must build the exact current-head bundle, recheck the
  binding after execution, sign the verification receipt, persist it immutably,
  CAS-update the AI aggregate, and refresh the V10 read model.
- Idempotent retry, worker crash recovery, stale-head rejection, tenant
  isolation, signature tamper rejection, and zero browser-authored PASS still
  need cross-scope integration evidence.
- The route, dispatch schema, worker callback, signing-key deployment, and full
  end-to-end round trip are not part of this source commit and must not be
  inferred from the stable-reference tests.
- Exact commit authority, manufacturing approval, commercial release, external
  exchange review, independent experts, and physical pilots remain `HOLD`.
