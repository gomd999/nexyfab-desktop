#!/usr/bin/env tsx
/**
 * Import legacy factories.db → nf_factories_directory (Postgres or SQLite).
 *
 * Usage:
 *   FACTORIES_DB_PATH=data/factories.db npx tsx scripts/import-factories-directory.ts
 *   (자동으로 DATABASE_URL 이 있으면 Postgres, 없으면 data/nexyfab.db 에 씀)
 *
 * - factories.db 가 없으면 즉시 에러
 * - nf_factories_directory 가 이미 채워져 있으면 --force 없이는 skip
 * - 배치 insert (1000개씩) 로 빠르게 처리. 진행률 로그 출력.
 * - 중단되더라도 PRIMARY KEY 충돌로 INSERT OR IGNORE / ON CONFLICT DO NOTHING
 *   덕분에 재실행 안전.
 */
import path from 'path';
import fs from 'fs';

const ROOT = path.join(__dirname, '..');
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = 'development';

// 부모 .env 로드 (NEXT 통합 env 정책)
function loadEnvFile(filePath: string, allowOverride: boolean, osKeys: Set<string>) {
  if (!fs.existsSync(filePath)) return;
  const parsed: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    parsed[key] = value;
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (osKeys.has(k)) continue;
    if (!allowOverride && process.env[k] !== undefined) continue;
    process.env[k] = v;
  }
}
const osKeys = new Set(Object.keys(process.env));
loadEnvFile(path.resolve(ROOT, '../..', '.env'), false, osKeys);
loadEnvFile(path.join(ROOT, '.env.local'), true, osKeys);

const FORCE = process.argv.includes('--force');
const FACTORIES_DB = process.env.FACTORIES_DB_PATH
  ?? path.join(ROOT, 'data', 'factories.db');

interface FactoryRow {
  id: number;
  country: string;
  name: string;
  product: string | null;
  industry: string | null;
  address: string | null;
  search_text: string | null;
}

function buildSearchText(r: Omit<FactoryRow, 'search_text'>): string {
  return [r.name, r.product, r.industry, r.address]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);
}

async function readLegacy(): Promise<FactoryRow[]> {
  if (!fs.existsSync(FACTORIES_DB)) {
    throw new Error(`factories.db not found at ${FACTORIES_DB}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(FACTORIES_DB, { readonly: true });
  try {
    const rows = db.prepare(
      'SELECT id, country, name, product, industry, address FROM factories'
    ).all() as Array<{
      id: number; country: string; name: string;
      product: string | null; industry: string | null; address: string | null;
    }>;
    return rows.map(r => ({
      ...r,
      search_text: buildSearchText(r),
    }));
  } finally {
    db.close();
  }
}

async function importToPostgres(rows: FactoryRow[]): Promise<void> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: countRows } = await pool.query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM nf_factories_directory'
    );
    const existing = parseInt(countRows[0]?.c ?? '0', 10);
    if (existing > 0 && !FORCE) {
      console.log(`[skip] nf_factories_directory already has ${existing} rows. Use --force to reimport.`);
      return;
    }
    if (FORCE && existing > 0) {
      console.log(`[force] truncating ${existing} existing rows...`);
      await pool.query('TRUNCATE nf_factories_directory');
    }

    const now = Date.now();
    const BATCH = 1000;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const params: unknown[] = [];
      const placeholders: string[] = [];
      batch.forEach((r, j) => {
        const o = j * 8;
        placeholders.push(
          `($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8})`
        );
        params.push(
          r.id, r.country, r.name, r.product, r.industry, r.address,
          r.search_text, now,
        );
      });
      await pool.query(
        `INSERT INTO nf_factories_directory
           (id, country, name, product, industry, address, search_text, created_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        params,
      );
      inserted += batch.length;
      if (inserted % 10_000 === 0 || inserted === rows.length) {
        console.log(`  ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`);
      }
    }
    console.log(`[done] inserted ${inserted.toLocaleString()} rows into Postgres nf_factories_directory`);
  } finally {
    await pool.end();
  }
}

async function importToSqlite(rows: FactoryRow[]): Promise<void> {
  const { getDb } = await import('../src/lib/db');
  const db = getDb();
  const existing = (db.prepare(
    'SELECT COUNT(*) AS c FROM nf_factories_directory'
  ).get() as { c: number }).c;
  if (existing > 0 && !FORCE) {
    console.log(`[skip] nf_factories_directory already has ${existing} rows. Use --force to reimport.`);
    return;
  }
  if (FORCE && existing > 0) {
    console.log(`[force] deleting ${existing} existing rows...`);
    db.exec('DELETE FROM nf_factories_directory');
  }

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO nf_factories_directory
       (id, country, name, product, industry, address, search_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((chunk: FactoryRow[]) => {
    for (const r of chunk) {
      stmt.run(r.id, r.country, r.name, r.product, r.industry, r.address, r.search_text, now);
    }
  });

  const BATCH = 2000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    insertMany(batch);
    inserted += batch.length;
    if (inserted % 20_000 === 0 || inserted === rows.length) {
      console.log(`  ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }
  console.log(`[done] inserted ${inserted.toLocaleString()} rows into SQLite nf_factories_directory`);
}

async function main() {
  console.log(`Reading legacy DB: ${FACTORIES_DB}`);
  const rows = await readLegacy();
  console.log(`  loaded ${rows.length.toLocaleString()} rows`);
  const koCount = rows.filter(r => r.country === 'KO').length;
  const cnCount = rows.filter(r => r.country === 'CN').length;
  console.log(`  KO: ${koCount.toLocaleString()}, CN: ${cnCount.toLocaleString()}`);

  if (process.env.DATABASE_URL) {
    console.log('Target: Postgres');
    await importToPostgres(rows);
  } else {
    console.log('Target: SQLite (data/nexyfab.db)');
    await importToSqlite(rows);
  }
}

main().catch(err => {
  console.error('[import-factories-directory] failed:', err);
  process.exit(1);
});
