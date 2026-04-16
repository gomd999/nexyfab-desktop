/**
 * db-adapter.ts — Unified database adapter for SQLite (better-sqlite3) and PostgreSQL (pg)
 *
 * Usage:
 *   import { getDbAdapter } from '@/lib/db-adapter';
 *   const db = getDbAdapter();
 *   const user = await db.queryOne<User>('SELECT * FROM nf_users WHERE email = ?', email);
 *   const rows = await db.queryAll<Project>('SELECT * FROM nf_projects WHERE user_id = ?', uid);
 *   await db.execute('INSERT INTO nf_users (id, email, name, created_at) VALUES (?, ?, ?, ?)', id, email, name, Date.now());
 *
 * Switching:
 *   - Set DATABASE_URL env var to use PostgreSQL (e.g. postgresql://user:pass@host:5432/nexyfab)
 *   - Otherwise falls back to SQLite via better-sqlite3
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface DbAdapter {
  /** Query a single row. Returns undefined if not found. */
  queryOne<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;

  /** Query all matching rows. Returns empty array if none. */
  queryAll<T = any>(sql: string, ...params: any[]): Promise<T[]>;

  /** Execute a statement (INSERT/UPDATE/DELETE). Returns affected row count. */
  execute(sql: string, ...params: any[]): Promise<{ changes: number }>;

  /** Execute raw SQL (e.g. multi-statement DDL). No parameterization. */
  executeRaw(sql: string): Promise<void>;

  /** Run multiple operations atomically. Rolls back on error. */
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;

  /** Gracefully close the connection / pool. */
  close(): Promise<void>;

  /** Which backend is active */
  readonly backend: 'sqlite' | 'postgres';
}

// Keep old synchronous types for backward compat (unused but harmless)
export type QueryResult<T = Record<string, unknown>> = T[];
export type SingleResult<T = Record<string, unknown>> = T | undefined;

// ---------------------------------------------------------------------------
// Placeholder conversion: ? -> $1, $2, ... (for PostgreSQL)
// Handles quoted strings properly.
// ---------------------------------------------------------------------------

function convertPlaceholders(sql: string): string {
  let idx = 0;
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Track quoted regions — skip placeholders inside strings
    if (ch === "'" && !inDoubleQuote) {
      if (next === "'") {
        result += "''";
        i++; // skip escaped quote
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += ch;
      continue;
    }

    if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// SQLite-specific SQL fixups for PostgreSQL compatibility
// ---------------------------------------------------------------------------

/**
 * Convert SQLite-specific syntax to PostgreSQL equivalents.
 *
 * Handled patterns:
 *   INSERT OR IGNORE INTO → INSERT INTO ... ON CONFLICT DO NOTHING
 *   strftime('%Y-%m-%d', datetime(col/1000, 'unixepoch')) → TO_CHAR(TO_TIMESTAMP(...), 'YYYY-MM-DD')
 *   strftime('%Y-%m',    datetime(col/1000, 'unixepoch')) → TO_CHAR(TO_TIMESTAMP(...), 'YYYY-MM')
 *   strftime('%s', date('now','start of month')) * 1000   → EXTRACT(EPOCH ...) * 1000
 *   strftime('%s', date('now', '-N months', 'start of month')) * 1000  → ditto with offset
 */
function sqliteToPostgres(sql: string): string {
  const hasIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);

  let s = convertPlaceholders(sql);

  // ── INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING ──────────────────
  if (hasIgnore) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    // Append ON CONFLICT DO NOTHING before optional trailing whitespace / semicolon
    s = s.replace(/\)(;?)(\s*)$/, ') ON CONFLICT DO NOTHING$1$2');
  }

  // ── strftime('%Y-%m-%d', datetime(X/1000, 'unixepoch')) ──────────────────
  s = s.replace(
    /strftime\s*\(\s*'%Y-%m-%d'\s*,\s*datetime\s*\(\s*([^,)]+?)\s*\/\s*1000\s*,\s*'unixepoch'\s*\)\s*\)/gi,
    (_m, col) => `TO_CHAR(TO_TIMESTAMP(${col.trim()}::numeric / 1000), 'YYYY-MM-DD')`,
  );

  // ── strftime('%Y-%m', datetime(X/1000, 'unixepoch')) ─────────────────────
  s = s.replace(
    /strftime\s*\(\s*'%Y-%m'\s*,\s*datetime\s*\(\s*([^,)]+?)\s*\/\s*1000\s*,\s*'unixepoch'\s*\)\s*\)/gi,
    (_m, col) => `TO_CHAR(TO_TIMESTAMP(${col.trim()}::numeric / 1000), 'YYYY-MM')`,
  );

  // ── strftime('%s', date('now', '-N months', 'start of month')) * 1000 ─────
  s = s.replace(
    /strftime\s*\(\s*'%s'\s*,\s*date\s*\(\s*'now'\s*,\s*'-\s*(\d+)\s*months?'\s*,\s*'start of month'\s*\)\s*\)\s*\*\s*1000/gi,
    (_m, n) => `EXTRACT(EPOCH FROM DATE_TRUNC('month', NOW() - INTERVAL '${n} months'))::bigint * 1000`,
  );

  // ── strftime('%s', date('now','start of month')) * 1000 ───────────────────
  s = s.replace(
    /strftime\s*\(\s*'%s'\s*,\s*date\s*\(\s*'now'\s*,\s*'start of month'\s*\)\s*\)\s*\*\s*1000/gi,
    `EXTRACT(EPOCH FROM DATE_TRUNC('month', NOW()))::bigint * 1000`,
  );

  return s;
}

// ---------------------------------------------------------------------------
// SQLite adapter (wraps synchronous better-sqlite3 in async interface)
// ---------------------------------------------------------------------------

function createSqliteAdapter(): DbAdapter {
  // Lazy import — only loaded when SQLite is actually used
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };

  const adapter: DbAdapter = {
    backend: 'sqlite' as const,

    async queryOne<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
      const db = getDb();
      return db.prepare(sql).get(...params) as T | undefined;
    },

    async queryAll<T = any>(sql: string, ...params: any[]): Promise<T[]> {
      const db = getDb();
      return db.prepare(sql).all(...params) as T[];
    },

    async execute(sql: string, ...params: any[]): Promise<{ changes: number }> {
      const db = getDb();
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes };
    },

    async executeRaw(sql: string): Promise<void> {
      const db = getDb();
      db.exec(sql);
    },

    async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
      // SQLite: BEGIN/COMMIT via raw exec (better-sqlite3 is synchronous so this is safe)
      const db = getDb();
      db.exec('BEGIN');
      try {
        const result = await fn(adapter);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async close(): Promise<void> {
      try {
        const db = getDb();
        db.close();
      } catch {
        // Already closed or not initialized
      }
    },
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// PostgreSQL adapter (uses pg Pool)
// ---------------------------------------------------------------------------

function createPostgresAdapter(connectionString: string): DbAdapter {
  // Lazy import — only loaded when PostgreSQL is actually used
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg');

  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes('sslmode=require') || connectionString.includes('ssl=true')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Log connection errors without crashing
  pool.on('error', (err: Error) => {
    console.error('[db-adapter] PostgreSQL pool error:', err.message);
  });

  const adapter: DbAdapter = {
    backend: 'postgres' as const,

    async queryOne<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
      const pgSql = sqliteToPostgres(sql);
      const result = await pool.query(pgSql, params);
      return result.rows[0] as T | undefined;
    },

    async queryAll<T = any>(sql: string, ...params: any[]): Promise<T[]> {
      const pgSql = sqliteToPostgres(sql);
      const result = await pool.query(pgSql, params);
      return result.rows as T[];
    },

    async execute(sql: string, ...params: any[]): Promise<{ changes: number }> {
      const pgSql = sqliteToPostgres(sql);
      const result = await pool.query(pgSql, params);
      return { changes: result.rowCount ?? 0 };
    },

    async executeRaw(sql: string): Promise<void> {
      await pool.query(sql);
    },

    async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Provide a scoped adapter that uses the same client for atomicity
        const txAdapter: DbAdapter = {
          backend: 'postgres',
          queryOne: async <R = any>(s: string, ...p: any[]) => {
            const r = await client.query(sqliteToPostgres(s), p);
            return r.rows[0] as R | undefined;
          },
          queryAll: async <R = any>(s: string, ...p: any[]) => {
            const r = await client.query(sqliteToPostgres(s), p);
            return r.rows as R[];
          },
          execute: async (s: string, ...p: any[]) => {
            const r = await client.query(sqliteToPostgres(s), p);
            return { changes: r.rowCount ?? 0 };
          },
          executeRaw: async (s: string) => { await client.query(s); },
          transaction: (innerFn) => txAdapter.transaction(innerFn), // nested = same client
          close: async () => {},
        };
        const result = await fn(txAdapter);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// Singleton & factory
// ---------------------------------------------------------------------------

let _adapter: DbAdapter | null = null;

/**
 * Returns the singleton database adapter.
 * - If DATABASE_URL is set, uses PostgreSQL.
 * - Otherwise falls back to SQLite (better-sqlite3).
 */
export function getDbAdapter(): DbAdapter {
  if (_adapter) return _adapter;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    console.log('[db-adapter] Using PostgreSQL');
    _adapter = createPostgresAdapter(databaseUrl);
  } else {
    console.log('[db-adapter] Using SQLite (better-sqlite3)');
    _adapter = createSqliteAdapter();
  }

  return _adapter;
}

/**
 * Initialize the PostgreSQL schema if needed.
 * Call this once at app startup when using PostgreSQL.
 * For SQLite, schema initialization happens inside db.ts getDb().
 */
export async function initPostgresSchema(): Promise<void> {
  const adapter = getDbAdapter();
  if (adapter.backend !== 'postgres') return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');

  // Try multiple paths for the migration SQL file
  const candidates = [
    path.join(__dirname, 'db-postgres-migrations.sql'),
    path.join(process.cwd(), 'src', 'lib', 'db-postgres-migrations.sql'),
  ];

  let sql: string | null = null;
  for (const p of candidates) {
    try {
      sql = fs.readFileSync(p, 'utf-8');
      break;
    } catch {
      continue;
    }
  }

  if (!sql) {
    throw new Error('[db-adapter] Could not find db-postgres-migrations.sql');
  }

  await adapter.executeRaw(sql);
  console.log('[db-adapter] PostgreSQL schema initialized');
}

/** Reset adapter (useful in tests). */
export function resetDbAdapter(): void {
  _adapter = null;
}

// ---------------------------------------------------------------------------
// Utility: boolean conversion helpers
// SQLite stores booleans as 0/1, PostgreSQL as true/false.
// ---------------------------------------------------------------------------

/** Convert a SQLite-style 0/1 or PostgreSQL boolean to JS boolean. */
export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return value === 1 || value === '1' || value === 't' || value === 'true';
}

/** Convert a JS boolean to the adapter's native format. */
export function fromBool(value: boolean): number | boolean {
  const adapter = _adapter;
  if (adapter && adapter.backend === 'postgres') return value;
  return value ? 1 : 0;
}
