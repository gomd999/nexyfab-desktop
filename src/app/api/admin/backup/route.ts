/**
 * POST /api/admin/backup
 * Uploads a snapshot of the SQLite database to R2 storage.
 * No-op when PostgreSQL is in use (managed DB handles its own backups).
 *
 * Invoke via Railway cron or external scheduler.
 * Requires ADMIN_SECRET header or super_admin JWT.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();

  if (db.backend === 'postgres') {
    return NextResponse.json({
      skipped: true,
      message: 'PostgreSQL is in use — backups are managed by the database provider.',
    });
  }

  // Locate the SQLite file via DATA_DIR env (matches Railway volume path)
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
  const dbPath = path.join(dataDir, 'nexyfab.db');

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: `Database file not found: ${dbPath}` }, { status: 500 });
  }

  const fileBuffer = fs.readFileSync(dbPath);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-04-22T10-30-00
  const storageKey = `backups/nexyfab-${stamp}.db`;

  const storage = getStorage();

  if (!storage.uploadRaw) {
    return NextResponse.json({ error: 'Storage backend does not support uploadRaw' }, { status: 500 });
  }

  await storage.uploadRaw(fileBuffer, storageKey, 'application/octet-stream');

  // Note: configure a 30-day lifecycle rule on your R2/S3 bucket for the backups/ prefix
  // to automatically prune old backups.

  return NextResponse.json({ ok: true, key: storageKey, sizeBytes: fileBuffer.length });
}
