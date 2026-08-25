# Cross-store restore drill v3 handoff

Generated: `2026-08-25T21:43:38+09:00`

Status: `LOCAL_CROSS_STORE_RESTORE_PASS / RELEASE_BOUND_RESTORE_HOLD /
PRIVATE_BETA_FALSE / GA_FALSE`

## Closure

Platform commit `2c79c2da95e0ea32c25f6a3c83e058d50cc7f265` adds an
actual object-storage backup and restore verifier to the existing isolated
PostgreSQL restore drill. Commit
`f649678730b18f4a22e3a8ec641ee33a067299be` limits the receipt's backup file
field to the filename and prevents a local temporary path from entering
evidence. Shared registry commits `b22de945` and `e6c4e171` assign the new tool,
test, and receipt to Platform.

`scripts/verify-backup-restore.mjs` now:

1. creates or reuses a PostgreSQL backup and restores it only to an explicitly
   isolated database;
2. compares every public table's row count and content fingerprint, detects
   foreign-key orphans, runs the current migration, validates unvalidated
   check/foreign-key constraints, and compares business rows again;
3. derives exact immutable-input, committed-output, and artifact-snapshot
   object bindings from the source database;
4. reads every bounded source object, writes it without overwrite to an empty
   backup prefix, reads it back, restores it without overwrite to a second
   empty prefix, and reads it back again;
5. requires identical ordered key-hash/byte/content-hash manifests across all
   three roles and exact agreement with every database binding; and
6. re-snapshots both source stores and fails if either source changed during
   the drill.

Role endpoints must use HTTPS except for loopback fixtures. Bucket/prefix
identities are distinct and explicitly named for source, backup, and restore.
Raw keys and credentials are excluded from the cross-store receipt.

## Bound local evidence

- Durability receipt:
  `docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`
- Durability schema/result: `nexyfab.commercial-precision-local-durability.v3`,
  29/29 `PASS`
- Durability SHA-256:
  `91e37f5d83193c432bbf983d47888494f913b0aa870ac3959107002ffddcadf3`
- Restore receipt:
  `docs/evidence/cad-independent/commercial-precision-cross-store-restore-20260825.json`
- Restore schema/SHA-256: `nexyfab.backup-isolated-restore-drill.v3`,
  `e3181adce4ddf2e4a3a79b812652ea2a7ab946a18782a3bbdcf8ac324696c292`
- Exact source HEAD for both:
  `f649678730b18f4a22e3a8ec641ee33a067299be`
- PostgreSQL: 164 tables, 1,717 columns, 104 rows; exact restored content;
  migration `2026082502`; four constraints validated; 83 final foreign keys,
  zero orphan rows
- Object storage: 8 source, 8 backup, and 8 restored objects; 8,580 bytes;
  identical manifests; bindings `immutable_input=2`, `committed_output=3`,
  `artifact_snapshot=3`
- Measured local objectives: RPO age 0 ms, end-to-end restore/migrate/object
  validation RTO 12,712 ms, object restore validation 992 ms

The command was:

```text
npm run commercial:precision:local-durability -- --write
```

All disposable PostgreSQL, Redis, object-storage containers, volumes, and the
network were removed after the run.

## Release gate

`restoreReceiptEligible` now requires schema v3, exact release binding,
`target=production`, a `release-bound` claim, an unchanged source database,
validated/orphan-free foreign keys, the exact current migration, valid timing,
and the full object/database-binding contract. It rejects local fixtures,
legacy receipts, manifest drift, missing artifact snapshots, and receipt hash
tampering.

The checked-in receipt deliberately says `target=local-fixture`,
`releaseBoundObservation=false`, `privateBetaEligible=false`, and
`commercialGaEligible=false`. It cannot promote a release.

## Verification

- restore/object/gate Node contracts: 46/46 PASS
- actual no-write cross-store campaign: PASS
- actual source-bound evidence campaign: PASS
- Platform ownership: no shared, foreign, or unclassified violations
- full source ESLint: PASS
- TypeScript: PASS

## Remaining external evidence

1. Restore a real encrypted protected backup into isolated staging and retain
   provider/KMS, operator, reviewer, retention-destruction, and exact-release
   identifiers in the protected evidence system.
2. Run authenticated application smoke, rollback, alert, and recovery checks
   against that exact isolated deployment.
3. Capture release-bound worker/recovery and credential-rotation evidence.
4. Complete independent CAD/expert review and CNC, sheet-metal, and additive
   manufacturing pilots before reevaluating commercial release.

No staging or production service was deployed, restarted, reconfigured, or
written by this closure.
