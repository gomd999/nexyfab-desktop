import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { verifyAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/db-backup
 * Backs up the SQLite database file to Cloudflare R2.
 *
 * Auth: x-cron-secret header OR admin session
 *
 * Retention: keeps the most recent 7 backups (deletes oldest when count > 7).
 *
 * Returns: { ok: true, key, size }
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected   = process.env.CRON_SECRET;
  const isAdmin    = await verifyAdmin(req);
  const isCron     = !!expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Resolve DB file path ────────────────────────────────────────────────────
  const dbPath =
    process.env.NEXYFAB_DB_PATH ||
    (process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'nexyfab.db') : null) ||
    path.join(process.cwd(), 'nexyfab.db');

  if (!fs.existsSync(dbPath)) {
    // PostgreSQL backend — no SQLite file to back up
    return NextResponse.json({ ok: false, reason: 'SQLite DB file not found (PostgreSQL backend?)' });
  }

  const fileBuffer = fs.readFileSync(dbPath);
  const size       = fileBuffer.length;

  // ── Build S3 client (Cloudflare R2) ────────────────────────────────────────
  const endpoint        = process.env.S3_ENDPOINT;
  const bucket          = process.env.S3_BUCKET;
  const accessKeyId     = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region          = process.env.S3_REGION || 'auto';

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return NextResponse.json(
      { error: 'R2 env vars not configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)' },
      { status: 500 },
    );
  }

  const s3 = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });

  // ── Upload backup ───────────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  const key     = `backups/nexyfab-${dateStr}-${Date.now()}.db`;

  await s3.send(
    new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        fileBuffer,
      ContentType: 'application/octet-stream',
    }),
  );

  // ── Enforce 7-backup retention ──────────────────────────────────────────────
  try {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'backups/',
      }),
    );

    const objects = (listRes.Contents ?? [])
      .filter(o => o.Key && o.Key.endsWith('.db'))
      .sort((a, b) => {
        const ta = a.LastModified?.getTime() ?? 0;
        const tb = b.LastModified?.getTime() ?? 0;
        return ta - tb; // oldest first
      });

    const MAX_BACKUPS = 7;
    if (objects.length > MAX_BACKUPS) {
      const toDelete = objects.slice(0, objects.length - MAX_BACKUPS);
      for (const obj of toDelete) {
        if (obj.Key) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
        }
      }
    }
  } catch (retentionErr) {
    // Non-fatal — backup was already uploaded successfully
    console.error('[db-backup] Retention cleanup error:', retentionErr);
  }

  return NextResponse.json({ ok: true, key, size });
}
