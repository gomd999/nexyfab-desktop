# Platform handoff: commercial Precision receipt determinism

- Created: `2026-08-25T05:18:32Z`
- Branch: `scope/platform`
- Head: `b4d2cf75aa0ef1757b3925ec23a967834feb8bee`
- Integration target: `integration/nexyfab`

## Summary

Extended the shared UTF-8 CRLF-to-LF binding contract to the commercial
Precision runtime v3 receipt. Migration SQL, runtime observation JSON, and all
five supporting evidence JSON documents now verify identically across Windows
worktrees without accepting semantic changes.

## Changed paths

- `scripts/build-commercial-precision-runtime-evidence.mjs`
- `scripts/build-commercial-precision-runtime-evidence.test.mjs`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260825T051832Z-commercial-precision-receipt-determinism.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] focused Precision/canonicalization/commercialization Node suite: 46/46.
- [x] complete valid runtime fixture still verifies production and staging
  decisions under a separately supplied test HMAC key.
- [x] full bound-text CRLF replay verifies the unchanged receipt.
- [x] no-observation local receipt re-derives without a checkout-specific
  mismatch and remains fail-closed without an HMAC authority.

## Remaining work and risks

- Authorized collectors must emit the declared canonicalization on migration
  and evidence bindings before signing the observation.
- A reviewed native adapter, separately held Ed25519/HMAC keys, positive
  same-release canary/recovery evidence, independent CAD review, and pilots are
  still absent.
- No staging or production deployment or configuration was changed.
