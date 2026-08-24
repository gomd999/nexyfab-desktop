# Precision CAD handoff: commercial migration compatibility

- Created: `2026-08-24T15:49:24Z`
- Branch: `scope/precision-cad`
- Head: `06ef2d63f756decd8444d337fd6d5c467194465a`
- Integration target: `integration/nexyfab`
- Implementation commit: `06ef2d63`
- State: `CURRENT_MIGRATION_COMPATIBLE / RELEASE_HOLD`

## Summary

The Precision commercial generation boundary no longer rejects a database that
has advanced beyond migration `2026082208`. The advance, state, refine,
finalize, external-verification request, and internal verifier callback routes
now use the platform's shared ordered migration registry. A registered current
target such as `2026082403` is accepted, while a stale, missing, or unknown
version remains a fail-closed `COMMERCIAL_GENERATION_MIGRATION_REQUIRED` hold.

This source fix is required before staging can truthfully advertise the current
authority migration. It changes only compatibility evaluation; it does not
weaken table, checksum, trigger, authentication, rights, evidence, or receipt
requirements.

## Changed paths

- `src/app/api/cad/v1/generation/advance/route.ts`
- `src/app/api/cad/v1/generation/state/route.ts`
- `src/app/api/cad/v1/generation/refine/route.ts`
- `src/app/api/cad/v1/generation/finalize/route.ts`
- `src/app/api/cad/v1/generation/commercial-receipts/requests/route.ts`
- `src/app/api/internal/commercial-verifier/callback/route.ts`
- `src/app/api/cad/v1/generation/commercial-migration-guard.test.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260824T154924Z-commercial-migration-compatibility.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npm run workspace:check -- precision-cad`
- Focused commercial readiness and route regression: `8` files and `43/43`
  tests PASS.
- The focused suite includes actual OCCT STEP writes through generation advance
  and finalization paths.
- Regression coverage requires all six routes to call the shared ordered guard,
  accepts `2026082208` and `2026082403`, and rejects `2026082207` and an unknown
  future-looking value.
- `git diff --check`: PASS.

## Remaining work and risks

- Staging currently remains on a stale deployment and an unmigrated database;
  no source result in this handoff is staging execution evidence.
- A distinct isolated restore target and successful backup/restore receipt are
  still required before applying the versioned migration to staging.
- Commercial environment variables, secrets, checksum attestations, workers,
  and private object storage must be configured and deployed fail-closed.
- Authenticated browser, multi-instance Redis/outbox recovery, observability,
  rollback, and release-health exercises remain required.
- Independent native CAD interoperability, qualified expert review, and
  manufacturing pilot evidence remain external release-authority holds.
