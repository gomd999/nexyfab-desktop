# Staging authenticated E2E and isolated PostgreSQL restore drill

## Safety boundary

These procedures are mutating and must never target `nexyfab.com` or
`www.nexyfab.com`. The scripts enforce all of the following:

- the HTTP target is loopback or has `staging`, `stage`, `preview`, or `test`
  in its hostname;
- non-loopback HTTP targets require the exact staging confirmation phrase;
- test account emails contain the configured disposable tenant marker;
- the restore target database name contains `_restore_drill`;
- source and restore PostgreSQL identities are different;
- the restore database has zero public tables before restore;
- the restore environment and confirmation phrase explicitly say staging and
  isolated restore.

The scripts never create, overwrite, drop, or truncate a production database.
Create a new empty drill database through the staging database administration
path before running the restore. Do not reuse a previous drill target.

## Authenticated lifecycle E2E

Provision two disposable accounts in a staging-only tenant. Their email
addresses must contain the tenant marker (default: `e2e`). Do not use an
existing closed-beta account.

```powershell
$env:E2E_BASE_URL='https://nexyfab-staging.example.com'
$env:E2E_STAGING_MUTATION_CONFIRM='NEXYFAB_STAGING_MUTATIONS_ONLY'
$env:E2E_STAGING_TENANT_MARKER='e2e'
$env:E2E_STAGING_OWNER_EMAIL='e2e-owner@example.com'
$env:E2E_STAGING_OWNER_PASSWORD='<from secret manager>'
$env:E2E_STAGING_OUTSIDER_EMAIL='e2e-outsider@example.com'
$env:E2E_STAGING_OUTSIDER_PASSWORD='<from secret manager>'
$env:STAGING_E2E_RECEIPT='validation-reports/staging-authenticated-e2e.json'
npm run e2e:staging:lifecycle
```

The test covers:

- authenticated live-provider AI intake followed by deterministic design gates;
- project creation, a manual CAD revision, and stale duplicate rejection;
- two simultaneous collaboration sessions;
- asynchronous isolated OpenSCAD job execution and polling;
- storage-state reconnect and exact scene re-read;
- STEP export, expiring share creation/revocation, and review-packet cleanup;
- outsider denial for project, collaboration, CAD job, share revocation, and
  review deletion;
- an injected network drop followed by bounded retry;
- cleanup of every project/share/review/collaboration record created by the
  run.

The review record deliberately says `expert-review-required`; this E2E does
not impersonate or claim an independent expert approval.

### Worker crash/recovery

Normal job completion is always tested. Automated crash/recovery additionally
requires a staging-only operations hook that returns HTTP 202 after restarting
the CAD worker without deleting Redis job state:

```powershell
$env:E2E_STAGING_WORKER_RESTART_PATH='/api/staging-ops/restart-cad-worker'
$env:E2E_STAGING_WORKER_RESTART_TOKEN='<from secret manager>'
```

The path must be same-origin. Without both variables, the receipt records
`pending_external_hook`; it must not be interpreted as a passed crash test.
Railway/service credentials must not be stored in the repository.

## PostgreSQL backup and isolated restore

Prerequisites: `pg_dump`, `psql`, Node.js, access to a read-only source URL,
and a newly created empty staging drill database.

```powershell
$env:SOURCE_DATABASE_URL='<read-only source PostgreSQL URL>'
$env:RESTORE_DATABASE_URL='<empty database ending in _restore_drill_YYYYMMDD>'
$env:RESTORE_DRILL_ENVIRONMENT='staging'
$env:RESTORE_DRILL_CONFIRM='NEXYFAB_ISOLATED_RESTORE_ONLY'
$env:BACKUP_FILE='backups/staging-restore-drill.sql.gz'
$env:POSTGRES_MIGRATION_SQL='src/lib/db-postgres-migrations.sql'
$env:BACKUP_RESTORE_RECEIPT='validation-reports/backup-restore-drill.json'
npm run backup:restore-drill
```

The drill performs, in order:

1. validate all source/target safety guards;
2. run a plain, no-owner, no-privileges `pg_dump` and gzip it;
3. calculate the backup SHA-256 and source table fingerprints;
4. refuse a non-empty target, then restore with `ON_ERROR_STOP=1`;
5. compare every table's row count and order-independent content fingerprint;
6. inspect every public foreign key for validation state and orphan rows;
7. run the configured versioned migration on the isolated restore only;
8. verify that business-table fingerprints did not change;
9. write an immutable JSON receipt with measured wall-clock RPO age and RTO.

`rpoAgeAtDrillStartMs` is the age of the backup when the drill began.
`rtoRestoreMigrateValidateMs` measures restore through final validation. A
source write concurrent with the dump/snapshot interval makes the exact match
fail; rerun in a quiet window rather than weakening the comparison.

To validate a pre-existing backup instead of creating one, point `BACKUP_FILE`
at it and set `USE_EXISTING_BACKUP=1`. The receipt path and backup path are
opened without overwrite; choose new paths for every drill.

## Completion evidence

Do not mark these items complete until the generated receipts exist and report
`ok: true`:

- staging authenticated lifecycle;
- optional worker restart recovery (`workerRecovery: passed`);
- isolated restore exact source match;
- post-migration business preservation;
- zero foreign-key failures;
- measured RPO/RTO.

Actual independent expert approval remains a human sign-off and is outside
these automated receipts.
