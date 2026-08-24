# Platform handoff: commercial payment authority 2501

- Created: `2026-08-24T16:28:08Z`
- Branch: `scope/platform`
- Head: `d8b98f4fa30fb7b2674609ba579f00cd1798bdd8`
- Integration target: `integration/nexyfab`
- Shared migration commit: `50dca38b`
- Platform source commits: `b87a1ac3`, `d8b98f4f`
- State: `LOCAL_PAYMENT_AUTHORITY_CURRENT / STAGING_2501_PENDING / RELEASE_HOLD`

## Summary

Commercial preflight exposed that `nf_orders.payment_status` and
`toss_order_id` existed only as request-time lazy DDL, despite both columns
being required before a commercial process may become ready. An isolated
staging SQL trial then exposed the same problem for `updated_at`, which payment
recovery and state transitions already query. The failed trial was wrapped in a
single transaction and rolled back.

Integration commit `50dca38b` supplies immutable PostgreSQL migration
`2026082501`. This Platform unit registers that source in the ordered runner and
requires its exact checksum and latest-version identity across deploy
preflight, live readiness, production migration receipts, isolated restore
receipts, rollback checks, release health, and the commercialization gate.
Live readiness derives the checksum environment keys from the shared registry,
removing the duplicate list that caused the earlier 2208/2403 drift.

## Changed paths

- `scripts/commercialization-readiness-gate.mjs`
- `scripts/commercialization-readiness-gate.test.mjs`
- `scripts/deploy-railway-verified.mjs`
- `scripts/deploy-railway-verified.test.mjs`
- `scripts/preflight-check.ts`
- `scripts/run-postgres-migration-with-receipt.mjs`
- `scripts/run-postgres-migration-with-receipt.test.mjs`
- `scripts/run-postgres-migrations.mjs`
- `scripts/run-postgres-migrations.test.mjs`
- `scripts/verify-rollback-target.mjs`
- `scripts/verify-rollback-target.test.mjs`
- `src/app/api/health/ready/route.ts`
- `src/app/api/health/ready/route.test.ts`
- `src/app/api/health/release/route.test.ts`
- `src/lib/commercial-readiness.ts`
- `src/lib/commercial-readiness.test.ts`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260824T162808Z-commercial-payment-authority-2501.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npm run workspace:check -- platform`
- Node migration, receipt, deploy, restore, rollback, deployment structure,
  and commercialization contracts: `75/75` PASS.
- Vitest commercial readiness, live/release health, and Precision migration
  compatibility: `34/34` PASS.
- Commit-hook related route and runtime suites: `57/57` PASS, including actual
  OCCT STEP writes.
- Actual isolated PostgreSQL execution of the 2501 SQL: PASS with all three
  required columns and both indexes created.
- Platform ownership and classification: no shared, foreign, or unclassified
  path violations.

## Remaining work and risks

- Create a fresh empty `_restore_drill` staging target and rerun the production
  read-only backup/restore/data/FK/migration campaign through `2026082501`.
- Apply `2026082501` to the staging source database only after that isolated
  campaign passes, then validate the columns, indexes, checksum, and preflight.
- Configure real SMTP, Sentry, and one webhook-verified payment provider; these
  external credentials cannot be generated from source.
- Provision distinct Ed25519 identities and isolated worker/verifier transport
  secrets, configure private object storage, and deploy the exact integrated
  build before collecting authenticated multi-instance and restart evidence.
- Independent CAD interoperability, external expert review, manufacturing
  pilots, and production release authority remain outside this source unit.
