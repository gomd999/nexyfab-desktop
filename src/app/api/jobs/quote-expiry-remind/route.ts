/**
 * POST /api/jobs/quote-expiry-remind
 *
 * Scans nf_quotes for quotes expiring within 24 h that have not yet been
 * acted on (status = 'pending' or 'responded'), then enqueues reminder
 * emails to the customer (RFQ owner) and the partner.
 *
 * Call from Railway CRON (daily):
 *   POST /api/jobs/quote-expiry-remind
 *   Header: x-cron-secret: <CRON_SECRET>
 *
 * Also callable by admin for manual trigger (admin session cookie).
 *
 * Idempotent: a nf_quote_remind_log table records sent reminders so
 * re-running within the same day won't double-send.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { verifyAdmin } from '@/lib/admin-auth';
import { enqueueJob } from '@/lib/job-queue';
import { escapeHtml } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

// ── Email HTML ────────────────────────────────────────────────────────────────

function quoteExpiryHtml(opts: {
  recipientName: string;
  quoteId: string;
  rfqShapeName: string;
  quoteAmount: number;
  validUntil: string;
  hoursLeft: number;
  rfqId: string;
  recipientType: 'customer' | 'partner';
}) {
  const { recipientName, quoteId, rfqShapeName, quoteAmount, validUntil, hoursLeft, rfqId, recipientType } = opts;
  const isPartner = recipientType === 'partner';
  const title = isPartner
    ? `견적 유효기간 만료 임박 — ${escapeHtml(rfqShapeName)}`
    : `견적을 검토해 주세요 — ${escapeHtml(rfqShapeName)}`;
  const bodyText = isPartner
    ? `귀하가 제출하신 견적(<strong>${escapeHtml(quoteId)}</strong>)이 <strong>${hoursLeft}시간 후</strong> 만료됩니다.<br>고객이 아직 결정하지 않았습니다.`
    : `제조사로부터 받은 견적(<strong>${escapeHtml(quoteId)}</strong>)이 <strong>${hoursLeft}시간 후</strong> 만료됩니다.<br>지금 바로 검토하고 수락하거나 새 견적을 요청하세요.`;

  const ctaHref = isPartner
    ? `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/partner/dashboard`
    : `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/ko/nexyfab/rfq#${encodeURIComponent(rfqId)}`;
  const ctaLabel = isPartner ? '파트너 대시보드 →' : '견적 확인하기 →';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:system-ui,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table width="560" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <!-- header -->
        <tr><td style="background:#1a56db;padding:20px 28px">
          <span style="color:#fff;font-size:20px;font-weight:800">NexyFab</span>
          <span style="color:#93c5fd;font-size:13px;margin-left:8px">견적 알림</span>
        </td></tr>
        <!-- body -->
        <tr><td style="padding:28px">
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280">안녕하세요, ${escapeHtml(recipientName)}님</p>
          <h2 style="margin:0 0 16px;font-size:18px;color:#111827">${escapeHtml(title)}</h2>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7">${bodyText}</p>
          <!-- quote summary -->
          <table width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:20px;font-size:13px">
            <tr>
              <td style="padding:4px 8px;color:#6b7280">견적 ID</td>
              <td style="padding:4px 8px;font-weight:600;color:#111827">${escapeHtml(quoteId)}</td>
            </tr>
            <tr>
              <td style="padding:4px 8px;color:#6b7280">부품명</td>
              <td style="padding:4px 8px;font-weight:600;color:#111827">${escapeHtml(rfqShapeName)}</td>
            </tr>
            <tr>
              <td style="padding:4px 8px;color:#6b7280">견적 금액</td>
              <td style="padding:4px 8px;font-weight:700;color:#1a56db">${quoteAmount.toLocaleString('ko-KR')}원</td>
            </tr>
            <tr>
              <td style="padding:4px 8px;color:#6b7280">만료 일시</td>
              <td style="padding:4px 8px;font-weight:600;color:#dc2626">${escapeHtml(validUntil)}</td>
            </tr>
          </table>
          <!-- CTA -->
          <a href="${ctaHref}" style="display:inline-block;padding:12px 24px;background:#1a56db;color:#fff;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none">
            ${ctaLabel}
          </a>
        </td></tr>
        <!-- footer -->
        <tr><td style="padding:14px 28px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af">
          이 메일은 NexyFab 자동 알림 시스템에서 발송되었습니다. 문의: support@nexyfab.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function runRemind(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
    ?? req.headers.get('authorization')?.replace('Bearer ', '');
  const expected   = process.env.CRON_SECRET;
  const isAdmin    = await verifyAdmin(req);
  const isCron     = !!expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;

  // Quotes expiring within next 24 h, still actionable
  type QuoteRow = {
    id: string; inquiry_id: string; factory_name: string; partner_email: string | null;
    estimated_amount: number; valid_until: string; status: string;
  };
  const expiringQuotes = await db.queryAll<QuoteRow>(
    `SELECT id, inquiry_id, factory_name, partner_email, estimated_amount, valid_until, status
     FROM nf_quotes
     WHERE status IN ('pending', 'responded')
       AND valid_until IS NOT NULL
       AND valid_until > datetime(?, 'unixepoch', 'milliseconds')
       AND valid_until < datetime(?, 'unixepoch', 'milliseconds')`,
    now, in24h,
  ).catch((): QuoteRow[] => []);

  let enqueued = 0;
  let skipped = 0;

  for (const q of expiringQuotes) {
    // Fetch RFQ for customer info
    const rfq = await db.queryOne<{ id: string; shape_name: string; user_id: string }>(
      'SELECT id, shape_name, user_id FROM nf_rfqs WHERE id = ?',
      q.inquiry_id,
    ).catch(() => null);
    if (!rfq) continue;

    const user = await db.queryOne<{ email: string; name: string | null }>(
      'SELECT email, name FROM nf_users WHERE id = ?',
      rfq.user_id,
    ).catch(() => null);

    const validUntilDate = new Date(q.valid_until).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    const hoursLeft = Math.max(1, Math.round((new Date(q.valid_until).getTime() - now) / 3_600_000));

    // ── Customer reminder ──────────────────────────────────────────────────
    if (user?.email) {
      const logId = `remind-cust-${q.id}`;
      const alreadySent = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_quote_remind_log WHERE id = ?', logId,
      ).catch(() => null);

      if (!alreadySent) {
        await enqueueJob('send_email', {
          to: user.email,
          subject: `[NexyFab] 견적 마감 ${hoursLeft}시간 전 — ${rfq.shape_name}`,
          html: quoteExpiryHtml({
            recipientName: user.name || user.email,
            quoteId: q.id,
            rfqShapeName: rfq.shape_name,
            quoteAmount: q.estimated_amount,
            validUntil: validUntilDate,
            hoursLeft,
            rfqId: rfq.id,
            recipientType: 'customer',
          }),
        });
        await db.execute(
          'INSERT INTO nf_quote_remind_log (id, quote_id, recipient, sent_at) VALUES (?,?,?,?)',
          logId, q.id, user.email, now,
        ).catch(() => {});
        enqueued++;
      } else {
        skipped++;
      }
    }

    // ── Partner reminder ───────────────────────────────────────────────────
    if (q.partner_email) {
      const logId = `remind-partner-${q.id}`;
      const alreadySent = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_quote_remind_log WHERE id = ?', logId,
      ).catch(() => null);

      if (!alreadySent) {
        await enqueueJob('send_email', {
          to: q.partner_email,
          subject: `[NexyFab] 제출 견적 만료 임박 — ${rfq.shape_name}`,
          html: quoteExpiryHtml({
            recipientName: q.factory_name || q.partner_email,
            quoteId: q.id,
            rfqShapeName: rfq.shape_name,
            quoteAmount: q.estimated_amount,
            validUntil: validUntilDate,
            hoursLeft,
            rfqId: rfq.id,
            recipientType: 'partner',
          }),
        });
        await db.execute(
          'INSERT INTO nf_quote_remind_log (id, quote_id, recipient, sent_at) VALUES (?,?,?,?)',
          logId, q.id, q.partner_email, now,
        ).catch(() => {});
        enqueued++;
      } else {
        skipped++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: expiringQuotes.length,
    enqueued,
    skipped,
    runAt: new Date(now).toISOString(),
  });
}

// Called by Railway cron (POST with x-cron-secret) or admin manual trigger
export async function POST(req: NextRequest) { return runRemind(req); }
// Called by Vercel cron (GET with Authorization: Bearer <secret>)
export async function GET(req: NextRequest) { return runRemind(req); }
