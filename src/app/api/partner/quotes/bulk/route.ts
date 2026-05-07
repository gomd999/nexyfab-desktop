/**
 * POST /api/partner/quotes/bulk
 * Batch operations on the partner's own quotes.
 *
 * Operations:
 *   { action: 'decline',         quoteIds: string[], note?: string }
 *   { action: 'extend_validity', quoteIds: string[], validUntil: 'YYYY-MM-DD' }
 *   { action: 'mark_read',       quoteIds: string[] }   // future: per-row read state
 *
 * Authorization: every quoteId must belong to the calling partner.
 * Rows that fail the ownership check are skipped (not 403'd) so a single
 * stale ID in the batch doesn't kill the whole operation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/app/lib/notify';

export const dynamic = 'force-dynamic';

type BulkAction = 'decline' | 'extend_validity' | 'mark_read';

interface BulkBody {
  action: BulkAction;
  quoteIds: string[];
  note?: string;
  validUntil?: string;
}

const MAX_BATCH = 100;

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as BulkBody | null;
  if (!body || !body.action || !Array.isArray(body.quoteIds) || body.quoteIds.length === 0) {
    return NextResponse.json({ error: 'action과 quoteIds[]가 필요합니다.' }, { status: 400 });
  }
  if (body.quoteIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_BATCH}건까지 처리할 수 있습니다.` }, { status: 400 });
  }
  if (body.action === 'extend_validity') {
    if (!body.validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(body.validUntil)) {
      return NextResponse.json({ error: 'validUntil은 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 });
    }
  }

  const db = getDbAdapter();

  // Filter to quotes this partner actually owns. Anything else is silently dropped.
  const placeholders = body.quoteIds.map(() => '?').join(',');
  const owned = await db.queryAll<{ id: string; project_name: string | null; status: string; inquiry_id: string | null }>(
    `SELECT id, project_name, status, inquiry_id
       FROM nf_quotes
      WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
        AND id IN (${placeholders})`,
    normPartnerEmail(partner.email), ...body.quoteIds,
  );

  if (owned.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, skipped: body.quoteIds.length });
  }

  let updated = 0;
  const now = Date.now();

  for (const q of owned) {
    try {
      if (body.action === 'decline') {
        if (q.status === 'rejected' || q.status === 'expired') continue;
        await db.execute(
          `UPDATE nf_quotes
              SET status = 'rejected',
                  partner_note = COALESCE(?, partner_note),
                  responded_at = ?,
                  responded_by = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
          body.note ?? null, now, partner.company || partner.email, q.id,
        );
        updated++;
      } else if (body.action === 'extend_validity') {
        await db.execute(
          `UPDATE nf_quotes SET valid_until = ?, updated_at = datetime('now') WHERE id = ?`,
          body.validUntil!, q.id,
        );
        updated++;
      } else if (body.action === 'mark_read') {
        // Read state is tracked at notification level, not quote level.
        // Mark all related partner notifications for this quote as read.
        await db.execute(
          `UPDATE nf_notifications
              SET read = 1
            WHERE user_id = ?
              AND link LIKE ?`,
          `partner:${normPartnerEmail(partner.email)}`, `%${q.id}%`,
        ).catch(() => {});
        updated++;
      }
    } catch (err) {
      console.error(`[partner/quotes/bulk] ${body.action} failed for ${q.id}:`, err);
    }
  }

  if (body.action === 'decline' && updated > 0) {
    // One admin notification for the whole batch — avoids notification spam.
    createNotification(
      'admin',
      'quote_bulk_declined',
      '파트너 일괄 견적 거절',
      `${partner.company || partner.email}이(가) ${updated}건의 견적을 거절했습니다.`,
    );
  }

  logAudit({
    userId: `partner:${normPartnerEmail(partner.email)}`,
    action: `quote.bulk.${body.action}`,
    metadata: { requested: body.quoteIds.length, updated, skipped: body.quoteIds.length - owned.length },
  });

  return NextResponse.json({
    ok: true,
    updated,
    skipped: body.quoteIds.length - updated,
  });
}
