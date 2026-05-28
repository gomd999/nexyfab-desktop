# Wave 2 — Postgres Migration Runbook

**Status:** operations runbook
**Date:** 2026-05-28
**Audience:** anyone applying the wave-2 schema migration on Railway prod or a Railway staging branch
**Related:**
- `src/lib/db-migrations-wave-2.sql` — Postgres DDL
- `src/lib/db-migrations-wave-2-sqlite.sql` — dev SQLite equivalent
- `src/lib/document-permissions.ts` — runtime ACL resolver that depends on this schema
- `docs/wave-2-cloud-document-migration.md` — design doc (§2.1 has the canonical schema)

---

## 0. TL;DR

```bash
# Pull SQL onto the deploy host (or copy/paste in pgAdmin):
curl -L https://raw.githubusercontent.com/<org>/nexyfab/main/src/lib/db-migrations-wave-2.sql -o wave2.sql

# Apply against the Railway Postgres add-on:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f wave2.sql

# Verify (see §4):
psql "$DATABASE_URL" -c "SELECT version, name, applied_at FROM nf_schema_migrations WHERE version = 200;"
```

If the row above prints, you're done. Soft restart the Railway service so
the app rereads schema-dependent caches (no required schema-version bump in
app code yet — the new tables are additive).

---

## 1. Pre-flight Checklist

Before running the migration:

- [ ] **Confirm base schema is current.** This migration assumes
      `nf_users`, `nf_schema_migrations`, and `pgcrypto` are already in place
      (from `src/lib/db-postgres-migrations.sql`). On a fresh Railway service
      the base migration runs first at startup via `initPostgresSchema()` —
      check the deploy logs for `[db-adapter] PostgreSQL schema initialized`
      from at least one prior boot.
- [ ] **Take a logical backup.** Railway provides daily snapshots, but for
      production migrations grab a fresh dump first:
      `pg_dump "$DATABASE_URL" --schema-only --no-owner > /tmp/pre_wave2_schema.sql`
      (schema-only is enough — the migration is additive and cannot lose
      data, but the snapshot is cheap insurance.)
- [ ] **Identify the connection string.** In Railway dashboard:
      Service → Variables → `DATABASE_URL`. Or `railway connect <db-service>`
      for an interactive psql shell.
- [ ] **Pick a low-traffic window.** The migration itself is ~30 ms (all
      CREATEs are IF NOT EXISTS, no data backfill, no locking writes). But
      app reboots take ~10–20 s, so prefer a quiet hour.
- [ ] **Coordinate with on-call.** Drop a heads-up in
      `#nexyfab-platform-ops` 15 min before applying.

---

## 2. Apply Steps

### 2a. Railway pgAdmin (web UI)

Easiest for one-shot manual application:

1. Railway dashboard → Postgres service → Connect → Data tab → Query.
2. Paste the entire content of `src/lib/db-migrations-wave-2.sql`.
3. Click Run. Expect zero rows returned (DDL only) and a single row in
   `nf_schema_migrations` for `version = 200`.

### 2b. psql (CLI, preferred for production)

```bash
# From the repo root, with $DATABASE_URL exported in your shell:
psql "$DATABASE_URL" \
     -v ON_ERROR_STOP=1 \
     -f src/lib/db-migrations-wave-2.sql

# Expected output: a stream of "CREATE EXTENSION" / "CREATE FUNCTION" /
# "CREATE TABLE" / "CREATE INDEX" / "CREATE TRIGGER" / "INSERT 0 1" lines.
# No NOTICE or ERROR — if anything errors, ON_ERROR_STOP aborts cleanly.
```

`-v ON_ERROR_STOP=1` is **mandatory.** Without it psql will continue past a
failing CREATE and leave the schema half-applied; with it, the first error
exits non-zero and you can rollback cleanly.

### 2c. railway run (CI / GitHub Actions)

For automated application from a deploy pipeline:

```bash
railway run --service=nexyfab-api \
  bash -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/lib/db-migrations-wave-2.sql'
```

`railway run` injects every variable bound to the named service — including
`DATABASE_URL` — so no secret juggling on the runner. The `-v ON_ERROR_STOP=1`
guard returns a non-zero exit on any failure so the workflow fails loudly.

### 2d. Idempotency

The migration script is **fully idempotent**:

- All `CREATE TABLE` statements use `IF NOT EXISTS`.
- All `CREATE INDEX` statements use `IF NOT EXISTS`.
- The single `CREATE OR REPLACE FUNCTION` is safe to re-run.
- Triggers are `DROP IF EXISTS` + `CREATE`, so re-runs reset cleanly.
- The `INSERT INTO nf_schema_migrations` uses `ON CONFLICT DO NOTHING`.

You can re-run the file safely. Useful if you hit a transient pool error
mid-application and want to retry without manual cleanup.

---

## 3. Rollback SQL

If you need to revert the migration entirely (e.g., Phase 2 ship is reversed —
see design doc §9.2), apply this **in order**. The order matters: FK
constraints cascade, but explicit reverse drops are clearer for forensics.

```sql
-- ─── Wave 2 schema rollback ─────────────────────────────────────────────
BEGIN;

-- Drop audit log first (BIGSERIAL is cheap to recreate).
DROP TABLE IF EXISTS nf_document_audit_log CASCADE;

-- Versions reference documents; drop before documents.
DROP TABLE IF EXISTS nf_document_versions CASCADE;

-- Doc-level permissions also FK documents.
DROP TABLE IF EXISTS nf_document_permissions CASCADE;

-- Documents (the central table). CASCADE catches any leftover stragglers.
DROP TABLE IF EXISTS nf_documents CASCADE;

-- Workspace members FK workspaces.
DROP TABLE IF EXISTS nf_workspace_members CASCADE;

-- Workspaces themselves.
DROP TABLE IF EXISTS nf_workspaces CASCADE;

-- Shared trigger function — only drop if nothing else uses it. As of
-- 2026-05-28 it's only referenced by the 6 tables above, but check before
-- pulling the trigger.
DROP FUNCTION IF EXISTS nf_set_updated_at();

-- Migration tracking row.
DELETE FROM nf_schema_migrations WHERE version = 200;

COMMIT;
```

Notes:

- We do **not** drop `pgcrypto` even though the migration enabled it — it
  may be in use by other tables (UUIDs in unrelated migrations). Leave it.
- After rollback, blob keys recorded in `nf_documents.blob_r2_key` are
  orphaned in R2. A separate sweep can remove them, but it's not required —
  R2 lifecycle policies will GC after 90 days anyway, and keeping them
  enables a re-application of the migration if we change our minds.
- If users have already created cloud docs (Phase 2 ship has happened), a
  full rollback **destroys their data**. Run the `wave2-bulk-export.ts`
  script first (design doc §9.2) to drop each doc as a `.nfab` into R2,
  then email recipients a download link.

---

## 4. Post-Apply Verification

Run these in order. Each should return the expected count exactly — drift
means partial application.

### 4a. Migration row present

```sql
SELECT version, name,
       to_timestamp(applied_at / 1000) AS applied_at_ts
  FROM nf_schema_migrations
 WHERE version = 200;
```

Expected: exactly **1 row**, with `name = 'wave_2_cloud_documents'`.

### 4b. All 6 tables exist

```sql
SELECT tablename
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN (
     'nf_workspaces',
     'nf_workspace_members',
     'nf_documents',
     'nf_document_permissions',
     'nf_document_versions',
     'nf_document_audit_log'
   )
 ORDER BY tablename;
```

Expected: **6 rows**, alphabetical.

### 4c. Single-owner partial unique index present

```sql
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname = 'idx_nf_document_permissions_single_owner';
```

Expected: 1 row with `indexdef` containing `WHERE (role = 'owner'::text)`.
Without this index, the application's "exactly one owner per doc" invariant
is unenforced — fix immediately if missing.

### 4d. Trigger function reachable

```sql
SELECT proname, prosrc
  FROM pg_proc
 WHERE proname = 'nf_set_updated_at';
```

Expected: 1 row, with body `NEW.updated_at = NOW(); RETURN NEW;`.

### 4e. Smoke test — full lifecycle (DESTRUCTIVE, run on staging only)

This creates a workspace + doc + perm + version row and reads everything
back. It then deletes them, leaving the schema unchanged. Run in a
transaction so a failed step rolls everything back automatically.

```sql
BEGIN;

-- Pick a real user id from your dev seed:
-- SELECT id FROM nf_users LIMIT 1;
\set test_user '''<paste-user-id-here>'''

-- Workspace
INSERT INTO nf_workspaces (owner_id, name) VALUES (:test_user, 'rb-test-ws')
  RETURNING id \gset
\set test_ws_id ''':id'''

-- Doc
INSERT INTO nf_documents (owner_id, workspace_id, name, blob_r2_key)
  VALUES (:test_user, :test_ws_id::uuid, 'rb-test-doc', 'documents/rb/test')
  RETURNING id \gset
\set test_doc_id ''':id'''

-- Owner perm row (should succeed)
INSERT INTO nf_document_permissions (document_id, user_id, role, granted_by)
  VALUES (:test_doc_id::uuid, :test_user, 'owner', :test_user);

-- Second owner row should FAIL (single-owner invariant)
DO $$
BEGIN
  BEGIN
    INSERT INTO nf_document_permissions (document_id, user_id, role, granted_by)
      VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'fake', 'owner', 'fake');
    RAISE EXCEPTION 'expected unique violation on single-owner index';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: single-owner index rejected duplicate owner row';
  END;
END $$;

-- Version row
INSERT INTO nf_document_versions (document_id, blob_r2_key, created_by)
  VALUES (:test_doc_id::uuid, 'documents/rb/test/v1.ydoc', :test_user);

-- Audit row
INSERT INTO nf_document_audit_log (document_id, user_id, action, detail)
  VALUES (:test_doc_id::uuid, :test_user, 'create', '{"smoke":true}'::jsonb);

ROLLBACK;  -- discard all of the above; schema unchanged.
```

A `PASS:` notice from the `DO $$` block confirms the single-owner index is
working. `ROLLBACK` at the end leaves nothing behind.

### 4f. App-level smoke (after Railway restart)

After the migration applies and the app restarts:

```bash
# Health check still passes
curl -sf https://nexyfab.com/api/health | jq

# The app should NOT crash on the new tables — even though no endpoints
# use them yet, the schema init log should now be quiet (no DDL drift).
railway logs --service=nexyfab-api --tail=200 | grep -i "schema\|migration\|error"
```

Expected: zero error / drift messages. If the app logs `relation "nf_*"
does not exist` for any of the new tables, the migration didn't reach the
right database — check `DATABASE_URL` resolution.

---

## 5. Existing `.nfab` File Import (Reference Script)

For Phase 3+ work — bulk-converting design partners' on-disk `.nfab`
collections into cloud docs. **Not required at Phase 2 ship**, but the
schema this migration creates is the destination. Keep this here so future
operators don't have to dig.

The actual implementation lives at
`src/lib/cloudDoc/nfabToYjs.ts` (Phase 3 — not in tree yet). The shape
below is what the script will call.

```ts
/**
 * scripts/wave2-import-nfab-dir.ts (sketch — Phase 3 deliverable)
 *
 * Walk a directory of .nfab files, import each into the cloud schema. One
 * Postgres tx per file; failures are logged and the script continues with
 * the next file. Output is a JSON-lines report on stdout.
 *
 *   node scripts/wave2-import-nfab-dir.ts \
 *        --user-id u_abc123 \
 *        --workspace-id ws_xyz789 \
 *        --dir /mnt/customer/nfab-archive \
 *      > import-report.jsonl
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDbAdapter } from '@/lib/db-adapter';
import { parseProject, migrate } from '@/app/[lang]/shape-generator/io/nfabFormat';
// Phase 3: import { nfabToYjs } from '@/lib/cloudDoc/nfabToYjs';
// Phase 3: import { encodeStateAsUpdate } from 'yjs';
// Phase 3: import { putR2Object } from '@/lib/storage';

async function main(): Promise<void> {
  const userId      = mustArg('--user-id');
  const workspaceId = mustArg('--workspace-id');
  const dir         = mustArg('--dir');
  const db          = getDbAdapter();

  for (const file of readdirSync(dir).filter(f => f.endsWith('.nfab'))) {
    const fullPath = join(dir, file);
    try {
      const raw     = readFileSync(fullPath, 'utf-8');
      const project = migrate(parseProject(raw));   // → v2

      // Phase 3:
      //   const ydoc = nfabToYjs(project);
      //   const bytes = encodeStateAsUpdate(ydoc);
      //   const blobKey = `documents/${userId}/<newId>/current.ydoc`;
      //   await putR2Object(blobKey, bytes);

      await db.transaction(async (tx) => {
        const docId = crypto.randomUUID();
        await tx.execute(
          `INSERT INTO nf_documents
             (id, owner_id, workspace_id, name, blob_r2_key,
              feature_count, part_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          docId, userId, workspaceId, project.name,
          /* blobKey */ `documents/${userId}/${docId}/current.ydoc`,
          project.tree.nodes.length,
          project.assembly?.placedParts?.length ?? 0,
        );
        await tx.execute(
          `INSERT INTO nf_document_permissions
             (document_id, user_id, role, granted_by)
           VALUES (?, ?, 'owner', ?)`,
          docId, userId, userId,
        );
        await tx.execute(
          `INSERT INTO nf_document_audit_log
             (document_id, user_id, action, detail)
           VALUES (?, ?, 'import', ?)`,
          docId, userId, JSON.stringify({ filename: file }),
        );
      });

      process.stdout.write(JSON.stringify({ file, ok: true }) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({
        file, ok: false, error: (err as Error).message,
      }) + '\n');
    }
  }
}

function mustArg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing ${name}`);
  return process.argv[i + 1];
}

main().catch(err => { console.error(err); process.exit(1); });
```

Operator notes for the future import run:

- **Run on a Railway service**, not your laptop — `DATABASE_URL` and R2
  creds are scoped to the deploy environment. Use `railway run` to inject
  env vars.
- **Per-file tx, not global**: one bad `.nfab` shouldn't kill a 5,000-file
  batch. The report jsonl is the single source of truth for what succeeded.
- **Rate limit yourself**: design doc §4.6 caps imports at 100/24h/user.
  For ops scripts we bypass the API entirely (direct DB inserts), but R2
  PUT rate is still bounded by the platform — sleep 50 ms between files to
  stay under burst limits.
- **Verify after**: `SELECT COUNT(*) FROM nf_documents WHERE owner_id = ?`
  should match the report's `ok: true` count.

---

## 6. Operational FAQ

**Q: The migration script ran but I don't see the new tables.**
A: Almost certainly two different databases. Run
`SELECT current_database();` in the same session as the migration and
compare with what the app's `DATABASE_URL` points at. Railway services and
shared addons often have similarly-named DBs.

**Q: The trigger function `nf_set_updated_at` already exists with a
different body.**
A: It shouldn't — the migration uses `CREATE OR REPLACE FUNCTION`. If a
third party has dropped and re-created it, re-running this migration is
safe (the OR REPLACE overwrites). If you've intentionally customised it
elsewhere, alias your custom one and update the trigger calls.

**Q: Can I apply this to a Railway preview environment?**
A: Yes — Railway preview envs each have their own Postgres add-on. Just
ensure `DATABASE_URL` for the preview is set in the shell before running
psql. Preview envs are ephemeral, so rollback is trivial (delete the env).

**Q: How do I tell what version of the schema is live?**
A: `SELECT version, name FROM nf_schema_migrations ORDER BY version`.
After this migration applies, the highest version should be 200. Future
wave-2 migrations (e.g., per-version thumbnails in Phase 5) bump to 201+.

**Q: Do I need to update `db-postgres-migrations.sql`?**
A: No. That file holds the **base** schema and only changes when the base
schema changes. Wave-2 is additive and tracked separately in this file.
If a fresh DB is initialised, the base file runs first (via
`initPostgresSchema()`), then operators apply wave-2 manually as documented
here. Future automation could fold this in, but for now the explicit
two-step is intentional — wave-2 is in trial Phase 2.

---

## 7. Sign-off

After applying and verifying:

- [ ] §4a–§4d all pass on production Postgres.
- [ ] App health endpoint returns 200 and logs are clean of schema errors.
- [ ] Migration row visible in `nf_schema_migrations` (version 200).
- [ ] Drop a confirmation in `#nexyfab-platform-ops` with the timestamp
      and operator name.

If you hit any unexpected behaviour, follow the rollback in §3 and reach
out to the wave-2 architect channel before retrying.

---

*End of runbook.*
