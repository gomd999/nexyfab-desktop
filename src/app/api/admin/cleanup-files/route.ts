/**
 * POST /api/admin/cleanup-files
 *
 * Deletes expired files from R2/storage based on retention policy:
 *   - No RFQ reference:             30 days
 *   - RFQ only (no contract):       90 days
 *   - Completed contract:           180 days
 *   - Active/in-progress contract:  kept indefinitely
 *
 * Invoke via Railway cron or external scheduler (e.g. crontab -e, cron.job.io).
 * Requires ADMIN_SECRET header or super_admin JWT.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

const RETENTION: Record<string, number> = {
  none:              30 * DAY_MS,   // no ref
  rfq:               90 * DAY_MS,   // linked to RFQ only
  contract_done:    180 * DAY_MS,   // completed contract
};

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const storage = getStorage();
  const now = Date.now();

  // Fetch all files with their ref info
  const files = await db.queryAll<{
    id: string;
    storage_key: string;
    ref_type: string | null;
    ref_id: string | null;
    created_at: number;
  }>('SELECT id, storage_key, ref_type, ref_id, created_at FROM nf_files');

  let deleted = 0;
  let errors = 0;

  for (const file of files) {
    let retentionMs: number | null = null;

    if (!file.ref_type || !file.ref_id) {
      retentionMs = RETENTION.none;
    } else if (file.ref_type === 'rfq') {
      retentionMs = RETENTION.rfq;
    } else if (file.ref_type === 'contract') {
      // Check contract status
      const contract = await db.queryOne<{ status: string }>(
        'SELECT status FROM nf_contracts WHERE id = ?',
        file.ref_id,
      ).catch(() => null);

      if (!contract) {
        // Orphaned — treat as no-ref
        retentionMs = RETENTION.none;
      } else if (contract.status === 'completed' || contract.status === 'closed') {
        retentionMs = RETENTION.contract_done;
      } else {
        // Active contract — keep forever
        continue;
      }
    }

    if (retentionMs === null) continue;
    if (now - file.created_at < retentionMs) continue;

    try {
      await storage.delete(file.storage_key);
      await db.execute('DELETE FROM nf_files WHERE id = ?', file.id);
      deleted++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({ deleted, errors, checked: files.length });
}
