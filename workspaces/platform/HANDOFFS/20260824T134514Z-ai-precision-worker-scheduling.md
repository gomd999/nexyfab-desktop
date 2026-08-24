# AI Precision exact worker platform handoff

- Created: `2026-08-24T13:45:14Z`
- Branch: `scope/platform`
- Head: `920e660d448f3da9cac47f1446c980137f9b1caa`
- Integration target: `integration/nexyfab`
- State: `LOCAL_RUNTIME_WIRED / STAGING_EVIDENCE_HOLD`

## Summary

- PostgreSQL migration `2026082403` adds the transactional bridge outbox and
  append-only receipt ledger with lease, status, identity, artifact, and
  aggregate-reference guards.
- SQLite schema version `91` preserves local/test parity.
- Migration and verified-deploy scripts require the new migration checksum.
- Commercial readiness requires the schema, private object-storage
  configuration, Redis, worker signing secret, and cron secret.
- The exact worker route requires a timing-safe bearer `CRON_SECRET`, commercial
  mode, private object bucket, and a signing secret of at least 32 characters.
- Railway schedules `/api/cron/ai-precision-exact-worker` once per minute and
  the route is registered under platform ownership.
- Local and S3-compatible storage use immutable writes: identical replay is
  accepted and a differing overwrite is rejected.

## Changed paths

- `railway.toml`
- `src/app/api/cron/ai-precision-exact-worker/route.ts`
- `src/app/api/cron/ai-precision-exact-worker/route.test.ts`
- `src/lib/storage.ts`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260824T134514Z-ai-precision-worker-scheduling.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npm run workspace:check -- platform`
- Migration/deploy contract suite: 10 tests PASS.
- Readiness tests and PostgreSQL authority tests: PASS.
- Cron authentication/configuration tests: 3/3 PASS.
- Production build: 301 pages and bundle budget PASS.
- Platform architecture: PASS with 11 services, 5 data stores, 69 API route
  groups, 27 cron groups, 6 domains, and 4 contract packages.
- Platform scope check: full source ESLint and TypeScript PASS, no ownership or
  classification issues.
- Integration status and audit: all scopes synchronized, collision 0,
  descriptor issue 0 before documentation updates.

## Remaining work and risks

No live staging mutation or deployment was performed. Before promotion, record:

- PostgreSQL migration apply/reapply and restore receipts;
- private object bucket access, immutable retry, retention, and hash-readback;
- Redis-backed multi-instance rate-limit and worker-coordination behavior;
- Railway cron authentication, restart, lease expiry, alerting, and
  `VERIFIED_UNKNOWN` reconciliation;
- cross-tenant denial, key rotation, secret/dependency scan, observability,
  rollback, and authenticated browser round-trip evidence.

Production deployment, manufacturing authority, and commercial release remain
`HOLD`.
