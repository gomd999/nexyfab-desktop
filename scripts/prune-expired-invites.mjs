#!/usr/bin/env node
/**
 * DB에서 만료된 nf_project_invites 행을 삭제합니다.
 * 사용: NEXYFAB_DB_PATH=/path/to.db node scripts/prune-expired-invites.mjs
 *   또는: node scripts/prune-expired-invites.mjs /path/to.db
 */
import Database from 'better-sqlite3';

const path = process.env.NEXYFAB_DB_PATH || process.argv[2];
if (!path) {
  console.error('Set NEXYFAB_DB_PATH or pass DB file path as first argument.');
  process.exit(1);
}

const db = new Database(path);
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nf_project_invites (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      email_norm  TEXT NOT NULL,
      role        TEXT NOT NULL,
      token       TEXT NOT NULL UNIQUE,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      UNIQUE(project_id, email_norm)
    );
  `);
} catch (e) {
  console.error(e);
  process.exit(1);
}

const r = db.prepare('DELETE FROM nf_project_invites WHERE expires_at < ?').run(Date.now());
console.log(`prune-expired-invites: deleted ${r.changes} row(s)`);
db.close();
