/**
 * POST /api/admin/factories/import-from-r2
 * One-time bulk import: downloads imports/factories-import.db from R2,
 * ATTACHes + INSERT OR IGNORE INTO nf_factories_directory.
 * Idempotent (safe to re-run; existing ids are skipped).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const R2_KEY = 'imports/factories-import.db';
const TMP_PATH = '/tmp/factories-import.db';

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const required = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_BUCKET'];
  for (const k of required) {
    if (!process.env[k]) return NextResponse.json({ error: `missing env: ${k}` }, { status: 500 });
  }

  const t0 = Date.now();
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });

  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: R2_KEY }));
  const body = obj.Body as NodeJS.ReadableStream;
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(TMP_PATH);
    body.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', () => resolve());
    body.pipe(ws);
  });
  const tmpSize = fs.statSync(TMP_PATH).size;

  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS nf_factories_directory (
      id INTEGER PRIMARY KEY,
      country TEXT NOT NULL,
      name TEXT NOT NULL,
      product TEXT,
      industry TEXT,
      address TEXT,
      search_text TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fdir_country ON nf_factories_directory(country);
    CREATE INDEX IF NOT EXISTS idx_fdir_industry ON nf_factories_directory(industry);
    CREATE INDEX IF NOT EXISTS idx_fdir_country_id ON nf_factories_directory(country, id);
  `);

  const before = (db.prepare('SELECT COUNT(*) AS c FROM nf_factories_directory').get() as { c: number }).c;

  db.exec(`ATTACH DATABASE '${TMP_PATH}' AS src`);
  const info = db.prepare(`
    INSERT OR IGNORE INTO nf_factories_directory (id, country, name, product, industry, address, search_text, created_at)
    SELECT id, country, name, product, industry, address, search_text, created_at FROM src.nf_factories_directory
  `).run();
  db.exec('DETACH DATABASE src');

  const after = (db.prepare('SELECT COUNT(*) AS c FROM nf_factories_directory').get() as { c: number }).c;
  const byCountry = db.prepare('SELECT country, COUNT(*) AS c FROM nf_factories_directory GROUP BY country ORDER BY c DESC').all() as Array<{ country: string; c: number }>;

  fs.unlinkSync(TMP_PATH);
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: R2_KEY }));

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - t0,
    downloadedBytes: tmpSize,
    before,
    after,
    inserted: info.changes,
    byCountry,
  });
}
