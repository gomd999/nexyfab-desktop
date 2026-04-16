export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { RETENTION_DAYS } from '@/lib/file-retention';

/**
 * POST /api/jobs/file-cleanup
 * 단계적 파일 정리 cron job
 *
 * Auth: CRON_SECRET header OR admin session
 * Schedule: 매일 1회 (e.g. "0 3 * * *" — 새벽 3시)
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  const isAdmin = await verifyAdmin(req);
  const isCron = expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const storage = getStorage();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let deleted = 0;
  let failed = 0;

  // ── 1. Quick-quote files (ref_type IS NULL or ref_type='rfq' with no actual RFQ) ──
  // Files with no ref_type and no ref_id → orphaned quick-quote uploads
  const orphanCutoff = now - RETENTION_DAYS.quickQuote * dayMs;
  const orphanFiles = await db.queryAll<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM nf_files
     WHERE ref_type IS NULL AND ref_id IS NULL AND created_at < ?`,
    orphanCutoff,
  );

  // ── 2. RFQ-linked files where RFQ has no contract ──
  const rfqCutoff = now - RETENTION_DAYS.rfqOnly * dayMs;
  const rfqOnlyFiles = await db.queryAll<{ id: string; storage_key: string }>(
    `SELECT f.id, f.storage_key FROM nf_files f
     WHERE f.ref_type = 'rfq' AND f.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM nf_contracts c WHERE c.quote_id IN (
           SELECT q.id FROM nf_quotes q WHERE q.inquiry_id = f.ref_id
         )
       )`,
    rfqCutoff,
  );

  // ── 3. Contract-completed files ──
  const contractCutoff = now - RETENTION_DAYS.contractCompleted * dayMs;
  const completedFiles = await db.queryAll<{ id: string; storage_key: string }>(
    `SELECT f.id, f.storage_key FROM nf_files f
     INNER JOIN nf_contracts c ON f.ref_id = c.id
     WHERE f.ref_type = 'contract'
       AND c.status IN ('delivered', 'completed', 'cancelled')
       AND f.created_at < ?`,
    contractCutoff,
  );

  // ── Delete all collected files ──
  const toDelete = [...orphanFiles, ...rfqOnlyFiles, ...completedFiles];

  for (const file of toDelete) {
    try {
      await storage.delete(file.storage_key);
      await db.execute(`DELETE FROM nf_files WHERE id = ?`, file.id);
      deleted++;
    } catch (err) {
      console.error(`[file-cleanup] Failed to delete ${file.id}:`, err);
      failed++;
    }
  }

  console.log(`[file-cleanup] Processed: ${toDelete.length} candidates, ${deleted} deleted, ${failed} failed`);

  return NextResponse.json({
    ok: true,
    summary: {
      orphan: orphanFiles.length,
      rfqOnly: rfqOnlyFiles.length,
      contractCompleted: completedFiles.length,
      deleted,
      failed,
    },
    processedAt: new Date().toISOString(),
  });
}
