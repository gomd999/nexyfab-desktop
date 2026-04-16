/**
 * GET /api/cron/rfq-expire
 * RFQ expiry reminder & auto-expire cron job.
 * Secured via Authorization: Bearer ${CRON_SECRET}
 *
 * - 7-day-old pending RFQs → send reminder email
 * - 14-day-old pending RFQs → mark expired + create notification
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/nexyfab-email';
import { createNotification } from '@/app/lib/notify';

export const dynamic = 'force-dynamic';

interface RfqRow {
  id: string;
  user_id: string;
  user_email: string | null;
  shape_name: string | null;
  created_at: number;
}

function reminderHtml(rfqId: string, shapeName: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  const rfqUrl = `${baseUrl}/ko/nexyfab/rfq/${rfqId}`;
  const safeShape = (shapeName || '부품').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c),
  );

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#161b22;">
  <div style="background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px;border-radius:12px;border:1px solid #30363d;">
    <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#388bfd;letter-spacing:-0.5px;">NexyFab</h1>
    <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#f0883e;">견적 요청 리마인더</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;line-height:1.6;">
      안녕하세요! <strong style="color:#e6edf3;">${safeShape}</strong>에 대한 견적 요청이
      <strong style="color:#e6edf3;">7일</strong> 이상 대기 중입니다.<br>
      아직 처리되지 않았으니, 아래 버튼을 눌러 현황을 확인해 주세요.
    </p>
    <p style="color:#6e7681;font-size:13px;margin:0 0 4px;">RFQ 번호: <span style="color:#e6edf3;font-family:monospace;">${rfqId.slice(0, 8).toUpperCase()}</span></p>
    <p style="color:#6e7681;font-size:13px;margin:0 0 24px;">상태: <span style="color:#f0883e;">견적 대기 중</span></p>
    <a href="${rfqUrl}"
       style="display:inline-block;padding:12px 24px;background:#388bfd;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      견적 요청 확인하기
    </a>
    <hr style="border:none;border-top:1px solid #21262d;margin:32px 0 16px;">
    <p style="color:#6e7681;font-size:11px;margin:0;line-height:1.6;">
      NexyFab &middot; <a href="${baseUrl}" style="color:#6e7681;">nexyfab.com</a>
      &middot; <a href="${baseUrl}/unsubscribe" style="color:#6e7681;">수신 거부 / Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  // ── Auth check ───────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const fourteenDaysAgo = now - 14 * 24 * 3600 * 1000;

  let reminded = 0;
  let expired = 0;

  // ── Step 1: Send reminder for RFQs pending 7+ days ───────────────────────────
  let reminderRows: RfqRow[] = [];
  try {
    reminderRows = await db.queryAll<RfqRow>(
      `SELECT id, user_id, user_email, shape_name, created_at
       FROM nf_rfqs
       WHERE status = 'pending'
         AND created_at < ?
         AND created_at >= ?`,
      sevenDaysAgo,
      fourteenDaysAgo,
    );
  } catch (err) {
    console.error('[rfq-expire] Failed to query reminder rows:', err);
  }

  for (const row of reminderRows) {
    try {
      if (!row.user_email) continue;
      const subject = '견적 요청 리마인더';
      const html = reminderHtml(row.id, row.shape_name || '부품');
      await sendEmail(row.user_email, subject, html);
      reminded++;
    } catch (err) {
      console.error(`[rfq-expire] Reminder failed for RFQ ${row.id}:`, err);
    }
  }

  // ── Step 2: Expire RFQs pending 14+ days ─────────────────────────────────────
  let expireRows: RfqRow[] = [];
  try {
    expireRows = await db.queryAll<RfqRow>(
      `SELECT id, user_id, user_email, shape_name, created_at
       FROM nf_rfqs
       WHERE status = 'pending'
         AND created_at < ?`,
      fourteenDaysAgo,
    );
  } catch (err) {
    console.error('[rfq-expire] Failed to query expire rows:', err);
  }

  for (const row of expireRows) {
    try {
      await db.execute(
        `UPDATE nf_rfqs SET status = 'expired', updated_at = ? WHERE id = ?`,
        now,
        row.id,
      );

      const recipientKey = row.user_email
        ? `customer:${row.user_email}`
        : `user:${row.user_id}`;

      createNotification(
        recipientKey,
        'rfq_expired',
        '견적 요청이 만료되었습니다',
        `${row.shape_name || '부품'} 견적 요청(${row.id.slice(0, 8).toUpperCase()})이 14일이 지나 자동 만료 처리되었습니다.`,
        { quoteId: row.id },
      );

      expired++;
    } catch (err) {
      console.error(`[rfq-expire] Expire failed for RFQ ${row.id}:`, err);
    }
  }

  return NextResponse.json({
    reminded,
    expired,
    timestamp: new Date().toISOString(),
  });
}
