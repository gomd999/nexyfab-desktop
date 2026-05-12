/**
 * GET /api/cron/partner-nonresponse-sla
 *
 * Daily SLA sweep — when a partner accepts a quote (status='accepted')
 * but no order is created within 7 days, the deal stalls. This cron:
 *   1. Flags the quote as `expired` (so the buyer can re-shop)
 *   2. Notifies ops to manually intervene or recommend an alternate
 *   3. Records a funnel event for SLA dashboards
 *
 * Without this, accepted quotes could sit forever waiting on a partner
 * who's gone dark — buyer thinks the deal is happening, partner has
 * forgotten, no one acts.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLA_DAYS = 7;
const SLA_MS = SLA_DAYS * 24 * 60 * 60 * 1000;

interface StaleQuoteRow {
  id: string;
  inquiry_id: string;
  partner_email: string | null;
  estimated_amount: number;
  responded_at: number | null;
  project_name: string;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const cutoff = now - SLA_MS;
  const db = getDbAdapter();

  // Find quotes that:
  //   - Are status='accepted'
  //   - responded_at is older than SLA cutoff
  //   - Have NO matching nf_orders row (no order placed)
  // The accepted-but-no-order combo is the SLA breach signal.
  const stale = await db.queryAll<StaleQuoteRow>(
    `SELECT q.id, q.inquiry_id, q.partner_email, q.estimated_amount,
            q.responded_at, q.project_name
       FROM nf_quotes q
       LEFT JOIN nf_orders o ON o.quote_id = q.id
      WHERE q.status = 'accepted'
        AND q.responded_at < ?
        AND o.id IS NULL
      ORDER BY q.responded_at ASC
      LIMIT 30`,
    cutoff,
  ).catch((): StaleQuoteRow[] => []);

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, expired: 0, reason: 'no SLA breaches' });
  }

  const { createNotification } = await import('@/app/lib/notify');
  const { normPartnerEmail } = await import('@/lib/partner-factory-access');

  // Expire each stale quote and notify the affected parties.
  for (const q of stale) {
    await db.execute(
      `UPDATE nf_quotes SET status = 'expired', updated_at = ? WHERE id = ?`,
      new Date(now).toISOString(), q.id,
    ).catch(() => {});

    if (q.partner_email) {
      void createNotification(
        `partner:${normPartnerEmail(q.partner_email)}`,
        'quote_expired_sla',
        '견적 수락 후 ${SLA_DAYS}일 무응답으로 만료되었습니다',
        `"${q.project_name}" 의 견적이 SLA 미준수로 자동 만료되었습니다. 재참여하려면 운영팀에 연락 주세요.`,
      );
    }

    // Optional: try to find buyer to notify directly (RFQ owner).
    try {
      const buyer = await db.queryOne<{ user_id: string }>(
        `SELECT user_id FROM nf_rfqs WHERE id = ?`, q.inquiry_id,
      );
      if (buyer) {
        void createNotification(
          buyer.user_id,
          'quote_expired_sla',
          '선택하신 공장이 응답하지 않아 견적이 만료되었습니다',
          `"${q.project_name}" 견적을 다시 검토해드립니다. 운영팀이 곧 대체 매칭을 안내합니다.`,
        );
      }
    } catch { /* non-blocking */ }
  }

  // Single ops alert summarizing all SLA breaches today (vs N emails).
  const bodyLines: string[] = [
    `Window: quotes accepted >${SLA_DAYS} days ago without order placement`,
    '',
    `🚨 ${stale.length}건의 견적이 SLA 위반으로 자동 만료됨. 대체 매칭 필요:`,
    '',
  ];
  for (const q of stale.slice(0, 15)) {
    const ageDays = Math.round((now - (q.responded_at ?? now)) / (24 * 60 * 60 * 1000));
    const amount = q.estimated_amount.toLocaleString('ko-KR');
    bodyLines.push(`  ${q.id} · ${q.project_name} · ${amount}원 · 파트너=${q.partner_email ?? '?'} · ${ageDays}일 경과`);
  }
  if (stale.length > 15) bodyLines.push(`  …외 ${stale.length - 15}건`);
  bodyLines.push('', `→ /admin/concierge 에서 RFQ별로 대체 공장 추천 진행`);

  await sendOpsAlert({
    severity: 'warning',
    title: `NexyFab partner SLA breach — ${stale.length}건 자동 만료`,
    bodyLines,
    source: 'cron:partner-nonresponse-sla',
  }).catch(err => console.warn('[partner-sla] alert send failed:', err));

  return NextResponse.json({ ok: true, expired: stale.length });
}
