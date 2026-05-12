/**
 * OP2 — Daily concierge ops digest.
 *
 * GET /api/cron/concierge-digest
 *   Auth: Bearer ${CRON_SECRET}.
 *
 * Posts a single morning summary so the operator knows what needs human
 * outreach today. Distinct from /cron/ops-digest (which covers funnel +
 * billing events) — this one focuses on the manual-touch deal pipeline:
 *
 *   - Untouched RFQs (created in last 24h, no concierge entry yet)
 *   - Stale RFQs (oldest concierge entry > 48h, status not advanced)
 *   - Status churn (entries that changed in last 24h)
 *   - Quotes received but not yet viewed by buyer (unlock signal)
 *   - Escrow transactions stuck in 'pending' or 'received' > 24h
 *
 * Skip-on-zero: if there's literally nothing to flag, no email is sent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 48 * 60 * 60 * 1000;

interface UntouchedRow { id: string; shape_name: string | null; created_at: number; user_id: string }
interface StaleRow { rfq_id: string; status: string; last_action_at: number; shape_name: string | null }
interface ChurnRow { status: string; c: number }
interface QuoteRow { id: string; inquiry_id: string; partner_email: string; created_at: string }
interface EscrowRow { id: string; order_id: string; status: string; created_at: number; gross_amount_krw: number }

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const since = now - DAY_MS;
  const staleCutoff = now - STALE_MS;
  const db = getDbAdapter();

  // 1. Untouched RFQs — created in last 24h, no concierge_status row.
  const untouched = await db.queryAll<UntouchedRow>(
    `SELECT r.id, r.shape_name, r.created_at, r.user_id
       FROM nf_rfqs r
       LEFT JOIN nf_concierge_status cs ON cs.rfq_id = r.id
      WHERE r.created_at >= ?
        AND r.status IN ('pending', 'analyzing')
        AND cs.id IS NULL
      ORDER BY r.created_at ASC
      LIMIT 20`,
    since,
  ).catch((): UntouchedRow[] => []);

  // 2. Stale RFQs — concierge entry > 48h old still in early statuses.
  const stale = await db.queryAll<StaleRow>(
    `SELECT cs.rfq_id, cs.status, cs.last_action_at, r.shape_name
       FROM nf_concierge_status cs
       JOIN nf_rfqs r ON r.id = cs.rfq_id
      WHERE cs.last_action_at < ?
        AND cs.status IN ('recommended', 'contacted')
        AND r.status NOT IN ('accepted', 'rejected')
      ORDER BY cs.last_action_at ASC
      LIMIT 20`,
    staleCutoff,
  ).catch((): StaleRow[] => []);

  // 3. Concierge status churn — group by status for last 24h.
  const churn = await db.queryAll<ChurnRow>(
    `SELECT status, COUNT(*) AS c
       FROM nf_concierge_status
      WHERE last_action_at >= ?
      GROUP BY status
      ORDER BY c DESC`,
    since,
  ).catch((): ChurnRow[] => []);

  // 4. Quotes received but RFQ not yet 'accepted' — buyer signal needed.
  const freshQuotes = await db.queryAll<QuoteRow>(
    `SELECT q.id, q.inquiry_id, q.partner_email, q.created_at
       FROM nf_quotes q
       JOIN nf_rfqs r ON r.id = q.inquiry_id
      WHERE q.status = 'responded'
        AND r.status NOT IN ('accepted', 'rejected')
        AND q.responded_at >= ?
      ORDER BY q.responded_at DESC
      LIMIT 20`,
    since,
  ).catch((): QuoteRow[] => []);

  // 5. Escrow transactions older than 24h still pending or received (need release).
  let stuckEscrow: EscrowRow[] = [];
  try {
    stuckEscrow = await db.queryAll<EscrowRow>(
      `SELECT id, order_id, status, created_at, gross_amount_krw
         FROM nf_escrow_transactions
        WHERE status IN ('pending', 'received')
          AND created_at < ?
        ORDER BY created_at ASC
        LIMIT 20`,
      staleCutoff,
    );
  } catch { /* table may not exist on first deploy */ }

  const totalActivity = untouched.length + stale.length + freshQuotes.length + stuckEscrow.length;
  if (totalActivity === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'no concierge activity' });
  }

  const severity = (stale.length + stuckEscrow.length) > 0 ? 'warning' : 'info';

  const bodyLines: string[] = [
    `Window: last 24h (${new Date(since).toISOString()} → ${new Date(now).toISOString()})`,
    '',
    '【 행동 필요 】',
    `• 미컨택 RFQ (24h내 신규):  ${untouched.length}`,
    `• 정체 RFQ (48h+ 진전 없음): ${stale.length}`,
    `• 고객에게 푸시 필요한 견적:  ${freshQuotes.length}`,
    `• 정산 대기 에스크로:        ${stuckEscrow.length}`,
  ];

  if (untouched.length > 0) {
    bodyLines.push('', '— 신규 RFQ (운영팀 컨택 시작) —');
    for (const r of untouched.slice(0, 10)) {
      const ageH = Math.round((now - r.created_at) / (60 * 60 * 1000));
      bodyLines.push(`  ${r.id.slice(0, 12)} · ${r.shape_name ?? '(이름 없음)'} · ${ageH}h ago`);
    }
    if (untouched.length > 10) bodyLines.push(`  …외 ${untouched.length - 10}건`);
  }

  if (stale.length > 0) {
    bodyLines.push('', '— 정체 RFQ (재컨택 또는 상태 갱신) —');
    for (const s of stale.slice(0, 10)) {
      const ageH = Math.round((now - s.last_action_at) / (60 * 60 * 1000));
      bodyLines.push(`  ${s.rfq_id.slice(0, 12)} · ${s.shape_name ?? '(이름 없음)'} · ${s.status} · ${ageH}h since update`);
    }
    if (stale.length > 10) bodyLines.push(`  …외 ${stale.length - 10}건`);
  }

  if (freshQuotes.length > 0) {
    bodyLines.push('', '— 고객 알림 필요한 신규 견적 —');
    for (const q of freshQuotes.slice(0, 10)) {
      bodyLines.push(`  ${q.id} · RFQ ${q.inquiry_id.slice(0, 12)} · ${q.partner_email}`);
    }
    if (freshQuotes.length > 10) bodyLines.push(`  …외 ${freshQuotes.length - 10}건`);
  }

  if (stuckEscrow.length > 0) {
    bodyLines.push('', '— 정산 대기 에스크로 —');
    for (const e of stuckEscrow.slice(0, 10)) {
      const ageH = Math.round((now - e.created_at) / (60 * 60 * 1000));
      bodyLines.push(`  ${e.id} · order ${e.order_id} · ${e.status} · ${e.gross_amount_krw.toLocaleString('ko-KR')}원 · ${ageH}h`);
    }
  }

  if (churn.length > 0) {
    bodyLines.push('', '— 24h 컨시어지 상태 변경 —');
    for (const c of churn) {
      bodyLines.push(`  ${c.status}: ${c.c}`);
    }
  }

  bodyLines.push('', `→ Admin: ${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nexyfab.com'}/admin/concierge`);

  await sendOpsAlert({
    severity,
    title: `NexyFab concierge digest — ${untouched.length} new · ${stale.length} stale · ${stuckEscrow.length} escrow`,
    bodyLines,
    source: 'cron:concierge-digest',
  }).catch(err => console.warn('[concierge-digest] alert send failed:', err));

  return NextResponse.json({
    ok: true,
    sent: true,
    severity,
    counts: {
      untouched: untouched.length,
      stale: stale.length,
      freshQuotes: freshQuotes.length,
      stuckEscrow: stuckEscrow.length,
    },
  });
}
