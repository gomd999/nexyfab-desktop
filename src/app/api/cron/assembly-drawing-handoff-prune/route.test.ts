import BetterSqlite from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { ensureAssemblyDrawingHandoffTable } from '@/lib/cad/assemblyDrawingHandoffStore';

const state = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/lib/db-adapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db-adapter')>();
  return { ...actual, getDbAdapter: () => state.getDb() };
});

import { POST } from './route';

const secret = 'c'.repeat(32);
let database: BetterSqlite.Database;
let db: DbAdapter;

function adapter(source: BetterSqlite.Database): DbAdapter {
  const value: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: source.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { source.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { return fn(value); },
    async close() { source.close(); },
  };
  return value;
}

function request(limit = '1', supplied = secret) {
  return new NextRequest(`https://local.test/api/cron/assembly-drawing-handoff-prune?limit=${limit}`, {
    method: 'POST', headers: { authorization: `Bearer ${supplied}` },
  });
}

function count() {
  return (database.prepare('SELECT COUNT(*) AS count FROM nf_assembly_drawing_handoffs').get() as { count: number }).count;
}

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', secret);
  vi.stubEnv('NEXYFAB_DB_PATH', 'C:\\durable-test\\local-sqlite-maintenance.db');
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  database = new BetterSqlite(':memory:');
  db = adapter(database);
  state.getDb.mockReturnValue(db);
  await ensureAssemblyDrawingHandoffTable(db);
  const insert = database.prepare(`
    INSERT INTO nf_assembly_drawing_handoffs
    (id, project_id, tenant_id, source_revision, source_content_sha256, payload_sha256,
     payload_json, byte_length, created_by, created_at, expires_at, immutability_state)
    VALUES (?, 'project-1', 'org-1', 4, ?, ?, '{}', 2, 'user-1', 1, ?, 'IMMUTABLE')
  `);
  insert.run('expired-1', 'a'.repeat(64), 'b'.repeat(64), 9_000);
  insert.run('expired-2', 'a'.repeat(64), 'c'.repeat(64), 9_500);
  insert.run('live-1', 'a'.repeat(64), 'd'.repeat(64), 11_000);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (database.open) await db.close();
});

describe('assembly drawing handoff expiry maintenance route', () => {
  it('fails closed when cron auth is missing, weak, or incorrect', async () => {
    vi.stubEnv('CRON_SECRET', 'short');
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv('CRON_SECRET', secret);
    expect((await POST(request('1', 'wrong-secret-with-the-same-length!'))).status).toBe(403);
    expect(count()).toBe(3);
  });

  it('requires durable handoff storage and a bounded batch limit', async () => {
    vi.stubEnv('NEXYFAB_DB_PATH', '');
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv('NEXYFAB_DB_PATH', 'C:\\durable-test\\local-sqlite-maintenance.db');
    expect((await POST(request('501'))).status).toBe(400);
    expect(count()).toBe(3);
  });

  it('removes only one bounded batch and reports whether another pass is needed', async () => {
    const first = await POST(request('1'));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      code: 'HANDOFF_EXPIRY_CLEANUP_COMPLETE', batchLimit: 1, removed: 1, remainingExpired: 1, hasMore: true,
    });
    expect(count()).toBe(2);
    const second = await POST(request('1'));
    await expect(second.json()).resolves.toMatchObject({ removed: 1, remainingExpired: 0, hasMore: false });
    expect(count()).toBe(1);
  });
});
