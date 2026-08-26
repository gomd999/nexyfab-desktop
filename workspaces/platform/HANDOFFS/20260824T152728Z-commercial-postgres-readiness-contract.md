# Commercial PostgreSQL readiness contract handoff

- Created: `2026-08-24T15:27:28Z`
- Branch: `scope/platform`
- Head: `91decae6170cac62ec971728bee013d979658d77`
- Integration target: `integration/nexyfab`
- State: `LOCAL_GATE_HARDENED / STAGING_DEPLOYMENT_STALE / RELEASE_HOLD`

## Summary

The deploy preflight previously stopped its commercial migration inspection at
`2026082208`, while live readiness already inspected through `2026082403`.
That drift could allow a deploy preflight to miss the Canonical CAD V2, AI
Design V10 authority, or AI-to-Precision exact bridge schema.

`src/lib/commercial-readiness.ts` now owns the ordered commercial PostgreSQL
migrations, authority tables, constraints, hardening triggers, and checksum
environment-key mapping. Both `scripts/preflight-check.ts` and
`src/app/api/health/ready/route.ts` consume that exact contract.

Commercial configuration now requires `POSTGRES_MIGRATION_VERSION=2026082403`
and checksum bindings for migrations through `2026082403`, including the
deployed canonical CAD checksum key. Missing bridge tables, binding checks, or
append-only triggers fail both preflight and live readiness closed.

## Changed paths

- `src/lib/commercial-readiness.ts`
- `src/lib/commercial-readiness.test.ts`
- `src/app/api/health/ready/route.ts`
- `scripts/preflight-check.ts`
- `scripts/deployment-structure.test.mjs`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npm run workspace:check -- platform`
- Commercial readiness and live readiness: `18/18` tests passed.
- Deployment structure: `12/12` tests passed.
- Focused ESLint: passed.
- Full platform source ESLint: passed.
- TypeScript: passed.
- `npm run workspace:check -- platform`: passed with no ownership,
  classification, shared-path, or foreign-path violations.

## Read-only staging observations

- Railway environment isolation audit: `30/30` checks passed without emitting
  secret values.
- Staging live, readiness, and anonymous-session endpoints returned HTTP 200.
- Staging readiness reported PostgreSQL and Redis healthy.
- The staging `nexyfab.com` deployment is
  `49971020-f1ab-4d5f-b13d-96b2420b5849`, created
  `2026-08-21T21:42:58.476Z`, with one replica.
- This deployment predates the source head and therefore cannot substantiate
  the new migrations, bridge runtime, restart recovery, or multi-instance
  behavior.

## Remaining work and risks

- No Railway variable, database, replica, deployment, or production state was
  mutated by this unit.
- Integrate this source unit and bind a release/build identity.
- Apply and reapply PostgreSQL migrations through `2026082403` in isolated
  staging, then capture a restore receipt.
- Deploy the exact integrated HEAD with the new checksum variables.
- Exercise private object storage, Redis coordination, worker restart and
  lease expiry, `VERIFIED_UNKNOWN` reconciliation, alarms, and rollback.
- Run authenticated two-account tenant-negative browser tests against that
  exact staging deployment.
- Production deployment, manufacturing authority, and commercial release
  remain `HOLD`.
