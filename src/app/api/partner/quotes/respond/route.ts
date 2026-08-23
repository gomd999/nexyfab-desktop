import { NextRequest, NextResponse } from 'next/server';
import { createNotification } from '@/app/lib/notify';
import { checkOrigin } from '@/lib/csrf';
import { getPartnerAuth } from '@/lib/partner-auth';
import { enqueueJob } from '@/lib/job-queue';
import {
  quoteReceivedHtml,
  quoteReceivedEmailSubject,
  quoteReceivedInAppTitle,
  quoteReceivedInAppBody,
  nexyfabEmailLocaleFromLanguageTag,
  nexyfabAppLangPathFromEmailLocale,
} from '@/lib/nexyfab-email';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { logAudit } from '@/lib/audit';
import { recordMetric } from '@/lib/partner-metrics';
import { loc } from '@/lib/i18n/loc';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_QUOTE_RESPONSE_BODY_BYTES = 32 * 1024;

export const dynamic = 'force-dynamic';

// POST /api/partner/quotes/respond
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  let body: { quoteId?: string; estimatedAmount?: number; estimatedDays?: number; note?: string };
  try { body = await readBoundedJson(req, MAX_QUOTE_RESPONSE_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    throw error;
  }
  const { quoteId, estimatedAmount, estimatedDays, note } = body;
  if (!quoteId || !estimatedAmount) {
    return NextResponse.json({ error: 'quoteId와 estimatedAmount가 필요합니다.' }, { status: 400 });
  }
  const amount = Number(estimatedAmount);
  const days = estimatedDays ? Number(estimatedDays) : null;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: '유효한 금액을 입력해주세요.' }, { status: 400 });
  }
  if (days !== null && (!Number.isFinite(days) || days <= 0)) {
    return NextResponse.json({ error: '유효한 예상 일수를 입력해주세요.' }, { status: 400 });
  }

  const db = getDbAdapter();

  const quote = await db.queryOne<{
    id: string; inquiry_id: string | null; project_name: string;
    partner_email: string | null; status: string; created_at: number;
  }>('SELECT id, inquiry_id, project_name, partner_email, status, created_at FROM nf_quotes WHERE id = ?', quoteId);

  if (!quote) {
    return NextResponse.json({ error: '견적을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (normPartnerEmail(quote.partner_email) !== normPartnerEmail(partner.email)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const now = Date.now();
  await db.execute(
    `UPDATE nf_quotes
     SET status = 'responded',
         estimated_amount = ?,
         estimated_days = ?,
         partner_note = ?,
         responded_at = ?,
         responded_by = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    amount, days, note || null, now, partner.company || partner.email, quoteId,
  );

  // admin에게 알림
  createNotification(
    'admin',
    'quote_responded',
    '파트너 견적 응답',
    `${partner.company || partner.email}이(가) "${quote.project_name}" 견적에 응답했습니다. (${amount.toLocaleString('ko-KR')}원)`,
    { quoteId },
  );

  logAudit({
    userId: `partner:${normPartnerEmail(partner.email)}`,
    action: 'quote.respond',
    resourceId: quoteId,
    metadata: { amount, days, company: partner.company },
  });

  // 견적 응답 속도 메트릭 — RFQ 시작 시점부터 회신까지의 분 단위
  if (quote.created_at) {
    const responseMinutes = Math.max(0, (now - quote.created_at) / 60_000);
    recordMetric({
      partnerEmail: partner.email,
      kind: 'quote_responded',
      quoteId,
      responseMinutes: Math.round(responseMinutes),
    }).catch(() => {});
  }

  // 고객에게 견적 도착 알림 (inquiry_id로 RFQ 고객 조회)
  const inquiryId = quote.inquiry_id;
  if (inquiryId) {
    try {
      const rfqUser = await db.queryOne<{ user_id: string; email: string; name: string | null; language: string | null }>(
        `SELECT r.user_id, u.email, u.name, u.language
         FROM nf_rfqs r JOIN nf_users u ON r.user_id = u.id
         WHERE r.id = ?`,
        inquiryId,
      );
      if (rfqUser?.email) {
        const locale = nexyfabEmailLocaleFromLanguageTag(rfqUser.language);
        const langPath = nexyfabAppLangPathFromEmailLocale(locale);
        const factoryLabel = partner.company || partner.email || loc(locale, {
          ko: '제조사', en: 'Manufacturer', ja: 'メーカー', zh: '制造商', es: 'Fabricante', ar: 'المصنّع',
        });
        await enqueueJob('send_email', {
          to: rfqUser.email,
          subject: quoteReceivedEmailSubject(locale, quote.project_name),
          html: quoteReceivedHtml({
            userName: rfqUser.name || rfqUser.email,
            lang: rfqUser.language ?? undefined,
            rfqId: inquiryId,
            shapeName: quote.project_name,
            factoryName: factoryLabel,
            estimatedAmount: amount,
            validUntil: undefined,
          }),
        });
        const notifId = `notif-${crypto.randomUUID()}`;
        await db.execute(
          `INSERT INTO nf_notifications (id, user_id, type, title, body, link, read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          notifId,
          rfqUser.user_id,
          'rfq.quoted',
          quoteReceivedInAppTitle(locale, quote.project_name),
          quoteReceivedInAppBody(locale, factoryLabel),
          `/${langPath}/nexyfab/rfq/${inquiryId}`,
          now,
        );
      }
    } catch (err) {
      console.error('[partner/quotes/respond] 고객 알림 실패:', err);
    }
  }

  const updated = await db.queryOne('SELECT * FROM nf_quotes WHERE id = ?', quoteId);
  return NextResponse.json({ quote: updated });
}
