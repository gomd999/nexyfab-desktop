# Precision CAD handoff: runtime evidence text binding

- Created: `2026-08-25T05:11:54Z`
- Branch: `scope/precision-cad`
- Head: `b4d2cf75aa0ef1757b3925ec23a967834feb8bee`
- Integration target: `integration/nexyfab`
- Commercial release state: `HOLD`

## Summary

Removed a cross-worktree derivation mismatch from the commercial Precision
runtime receipt. The migration SQL, runtime observation, and all five supporting
JSON documents now share the repository's `utf8-crlf-to-lf` binding contract.
The signed observation declares that policy, and the verifier rejects missing
or raw-byte claims.

The implementation and generated runtime receipt are Platform-owned paths and
are delivered by the companion Platform commit. This Precision handoff records
the collector contract and external qualification boundary without crossing
scope ownership.

## Changed paths

- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/HANDOFFS/20260825T051154Z-runtime-evidence-text-binding.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npm run workspace:check -- precision-cad`
- [x] Complete valid production fixture still derives and verifies
  `COMMERCIAL_GA_PASS` under a separately supplied test HMAC key.
- [x] Complete staging fixture remains limited to `PRIVATE_BETA_PASS`.
- [x] Converting migration, observation, and five evidence documents to CRLF
  after receipt generation preserves verification.
- [x] Semantic artifact tampering, forged Ed25519/HMAC claims, unsafe paths,
  release transplant, and missing assertions still fail closed.
- [x] Focused Precision, canonicalization, and commercialization suite: 46/46.

## Collector contract

Any authorized staging or production collector must calculate its migration
checksum and JSON manifest bindings after UTF-8 CRLF-to-LF canonicalization and
must set `canonicalization: utf8-crlf-to-lf` on each binding. The HMAC covers
those fields. A collector using raw checkout bytes is intentionally rejected.

## Remaining work and risks

- reviewed production-class native adapter and immutable image digest;
- separately held worker Ed25519 key and evidence HMAC authority;
- same-release positive staging canary and production recovery/rotation run;
- independent STEP/XCAF/GD&T review, expert approval, and manufacturing pilots.

No staging or production service, variable, database, bucket, or worker was
changed by this unit.
