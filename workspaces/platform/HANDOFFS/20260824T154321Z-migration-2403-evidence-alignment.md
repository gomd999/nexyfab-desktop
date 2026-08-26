# Migration 2403 recovery and release evidence handoff

- Created: `2026-08-24T15:43:21Z`
- Branch: `scope/platform`
- Head: `b4c47109d034c9da00c1c83247a34f05801e1a33`
- Integration target: `integration/nexyfab`
- State: `LOCAL_EVIDENCE_CONTRACT_CURRENT / STAGING_MIGRATION_PENDING / RELEASE_HOLD`

## Summary

The versioned migration runner already included migrations through
`2026082403`, but several recovery and release evidence consumers still
treated `2026082208` as the latest version. An isolated restore could therefore
apply the current schema while emitting an obsolete target, and release or
rollback gates could accept evidence that omitted Canonical CAD V2, AI Design
V10 authority, and the AI-to-Precision bridge.

The production migration receipt, isolated restore receipt, commercialization
gate, rollback verifier, and release health evidence now bind the complete
commercial set through `2026082403`. Restore target identity is derived from
the migration runner result. The shared commercial readiness module also
exports a known-version compatibility check for feature routes whose minimum
schema remains `2026082208`.

## Changed paths

- `scripts/commercialization-readiness-gate.mjs`
- `scripts/commercialization-readiness-gate.test.mjs`
- `scripts/deployment-structure.test.mjs`
- `scripts/run-postgres-migration-with-receipt.mjs`
- `scripts/run-postgres-migration-with-receipt.test.mjs`
- `scripts/verify-backup-restore.mjs`
- `scripts/verify-rollback-target.mjs`
- `scripts/verify-rollback-target.test.mjs`
- `src/app/api/health/release/route.test.ts`
- `src/lib/commercial-readiness.ts`
- `src/lib/commercial-readiness.test.ts`
- `src/lib/releaseHealthEvidence.ts`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npm run workspace:check -- platform`
- Deployment, migration, restore, commercialization, and rollback Node
  contracts: `64/64` passed.
- Commercial readiness, live readiness, and release health Vitest contracts:
  `27/27` passed.
- Focused ESLint and `git diff --check`: passed.
- Platform ownership and classification violations: zero.

## Remaining work and risks

- The staging PostgreSQL database still lacks the commercial migrations; no
  database write was performed by this source unit.
- Precision generation routes still compare the configured version to exactly
  `2026082208`; update them to use the known-version compatibility helper
  before setting staging to `2026082403`.
- Create an isolated restore target, run the restore/migrate/validate drill,
  and retain only the redacted signed receipt outside customer-data paths.
- Apply/reapply migrations to the staging source database only after the
  restore drill succeeds.
- Production deployment, manufacturing authority, and commercial release
  remain `HOLD`.
