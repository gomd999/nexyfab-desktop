# Migration 2026082208 read-only verification

`scripts/verify-postgres-migration-2026082208.mjs` is a production-safe
inventory and validation-plan tool. It only issues parameterized `SELECT`
queries against `nf_schema_migrations`, `pg_constraint`, `pg_trigger`, and the
four migration-2208 data sets. It never runs `ALTER`, `VALIDATE`, `INSERT`,
`UPDATE`, `DELETE`, or the migration runner.

Run it with a database role that has catalog and table `SELECT` access:

```powershell
$env:DATABASE_URL = '<read-only database URL>'
node scripts/verify-postgres-migration-2026082208.mjs > migration-2026082208-readonly-verification.json
```

The JSON is deterministic and contains no connection string or row values.
`PASS` means the migration checksum matches this source, all four constraints
and eight hardening triggers exist and are enabled, all four read-only
violation counts are zero, and every constraint is already validated.

`HOLD` is expected while any constraint remains `NOT VALID`, has missing or
malformed objects, or has legacy violations. The output's `validationPlan`
contains the exact `VALIDATE CONSTRAINT` statement a database owner may review
and execute during an approved change window. The verifier only prints that
plan; it does not execute it. Any non-zero violation count must be remediated
or explicitly handled by the database owner before validation.

Do not substitute the migration runner for this check. A production PASS is
not claimed until the verifier has observed the catalog and data state after
the separately approved validation work.
