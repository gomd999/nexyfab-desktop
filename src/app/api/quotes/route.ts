import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { sendNotificationEmail } from '@/app/lib/mailer';
import { createNotification } from '@/app/lib/notify';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { verifyAdmin } from '@/lib/admin-auth';
import { enqueueJob } from '@/lib/job-queue';
import {
  quoteReceivedHtml,
  quoteReceivedEmailSubject,
  quoteReceivedInAppTitle,
  quoteReceivedInAppBody,
  nexyfabEmailLocaleFromLanguageTag,
  nexyfabAppLangPathFromEmailLocale,
} from '@/lib/nexyfab-email';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string;
  inquiry_id: string | null;
  project_name: string;
  factory_name: string;
  estimated_amount: number;
  details: string;
  valid_until: string | null;
  partner_email: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
}

function rowToQuote(row: QuoteRow) {
  return {
    id: row.id,
    inquiryId: row.inquiry_id,
    projectName: row.project_name,
    factoryName: row.factory_name,
    estimatedAmount: row.estimated_amount,
    details: row.details,
    validUntil: row.valid_until,
    partnerEmail: row.partner_email,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Expire pending quotes whose validUntil has passed
async function autoExpireQuotes(db: DbAdapter): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db.execute(
    `UPDATE nf_quotes
    SET status = 'expired', updated_at = ?
    WHERE status = 'pending' AND valid_until IS NOT NULL AND valid_until < ?`,
    new Date().toISOString(), today,
  );
}

// GET /api/quotes
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await autoExpireQuotes(db);

  const inquiryId = req.nextUrl.searchParams.get('inquiryId');
  const isAdmin = await verifyAdmin(req);

  // Admin은 전체 조회 가능, 일반 유저는 자신의 RFQ에 연결된 견적만 조회
  let rows: QuoteRow[];
  if (isAdmin) {
    rows = inquiryId
      ? await db.queryAll<QuoteRow>('SELECT * FROM nf_quotes WHERE inquiry_id = ? ORDER BY created_at DESC', inquiryId)
      : await db.queryAll<QuoteRow>('SELECT * FROM nf_quotes ORDER BY created_at DESC');
  } else {
    rows = inquiryId
      ? await db.queryAll<QuoteRow>(
          `SELECT q.* FROM nf_quotes q JOIN nf_rfqs r ON q.inquiry_id = r.id
           WHERE q.inquiry_id = ? AND r.user_id = ? ORDER BY q.created_at DESC`,
          inquiryId, authUser.userId,
        )
      : await db.queryAll<QuoteRow>(
          `SELECT q.* FROM nf_quotes q JOIN nf_rfqs r ON q.inquiry_id = r.id
           WHERE r.user_id = ? ORDER BY q.created_at DESC`,
          authUser.userId,
        );
  }

  return NextResponse.json({ quotes: rows.map(rowToQuote) });
}

// POST /api/quotes — 견적서 생성 (admin 전용)
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const body = await req.json() as {
    inquiryId?: string;
    projectName?: string;
    factoryName?: string;
    estimatedAmount?: number;
    details?: string;
    validUntil?: string;
    partnerEmail?: string;
  };

  const { inquiryId, projectName, factoryName, estimatedAmount, details, validUntil, partnerEmail } = body;

  if (!projectName || !estimatedAmount) {
    return NextResponse.json(
      { error: 'projectName과 estimatedAmount는 필수입니다.' },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const id = `QT-${Date.now()}`;
  const createdAt = new Date().toISOString();

  try {
    await db.execute(
      `INSERT INTO nf_quotes
        (id, inquiry_id, project_name, factory_name, estimated_amount, details, valid_until, partner_email, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      id,
      inquiryId ?? null,
      projectName,
      factoryName ?? '',
      Number(estimatedAmount),
      details ?? '',
      validUntil ?? null,
      partnerEmail ?? null,
      createdAt,
    );
  } catch (err) {
    console.error('[quotes POST] DB error:', err);
    return NextResponse.json({ error: '견적 저장에 실패했습니다.' }, { status: 500 });
  }

  const quote = {
    id,
    inquiryId: inquiryId ?? null,
    projectName,
    factoryName: factoryName ?? '',
    estimatedAmount: Number(estimatedAmount),
    details: details ?? '',
    validUntil: validUntil ?? null,
    partnerEmail: partnerEmail ?? null,
    status: 'pending',
    createdAt,
  };

  // 파트너에게 이메일 + 인앱 알림
  if (partnerEmail) {
    const { newQuoteEmail } = await import('@/app/lib/email-templates');
    const tpl = newQuoteEmail({ projectName, details: details || '', validUntil: validUntil ?? null });
    await sendNotificationEmail(partnerEmail, tpl.subject, tpl.html).catch(() => {});

    createNotification(
      `partner:${normPartnerEmail(partnerEmail)}`,
      'new_quote',
      '새 견적 요청',
      `"${projectName}" 프로젝트의 견적 요청이 배정되었습니다. 파트너 포털에서 확인해주세요.`,
      { quoteId: id },
    );
  }

  // 고객에게 견적 도착 알림 (inquiryId가 있을 때만)
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
        const factoryLabel = factoryName ?? (locale === 'ko' ? '제조사' : 'Manufacturer');
        await enqueueJob('send_email', {
          to: rfqUser.email,
          subject: quoteReceivedEmailSubject(locale, projectName),
          html: quoteReceivedHtml({
            userName: rfqUser.name || rfqUser.email,
            lang: rfqUser.language ?? undefined,
            rfqId: inquiryId,
            shapeName: projectName,
            factoryName: factoryLabel,
            estimatedAmount: Number(estimatedAmount),
            validUntil: validUntil ?? undefined,
          }),
        });

        const notifId = `notif-${crypto.randomUUID()}`;
        await db.execute(
          `INSERT INTO nf_notifications (id, user_id, type, title, body, link, read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          notifId,
          rfqUser.user_id,
          'rfq.quoted',
          quoteReceivedInAppTitle(locale, projectName),
          quoteReceivedInAppBody(locale, factoryLabel),
          `/${langPath}/nexyfab/rfq/${inquiryId}`,
          Date.now(),
        );
      }
    } catch (err) {
      console.error('[quotes POST] 고객 알림 실패:', err);
    }
  }

  return NextResponse.json({ quote }, { status: 201 });
}

// PATCH /api/quotes — 견적 상태 변경
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json() as { id?: string; status?: string };
  const { id, status } = body;

  const VALID_STATUSES = ['pending', 'accepted', 'rejected', 'expired'];
  if (!id || !status) {
    return NextResponse.json({ error: 'id와 status가 필요합니다.' }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status는 다음 중 하나여야 합니다: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const updatedAt = new Date().toISOString();
  let result: { changes: number };
  try {
    result = await db.execute(
      'UPDATE nf_quotes SET status = ?, updated_at = ? WHERE id = ?',
      status, updatedAt, id,
    );
  } catch (err) {
    console.error('[quotes PATCH] DB error:', err);
    return NextResponse.json({ error: '견적 업데이트에 실패했습니다.' }, { status: 500 });
  }

  if (result.changes === 0) {
    return NextResponse.json({ error: '견적을 찾을 수 없습니다.' }, { status: 404 });
  }

  const row = await db.queryOne<QuoteRow>('SELECT * FROM nf_quotes WHERE id = ?', id);
  const quote = rowToQuote(row!);

  // 견적 채택/거절 시 파트너에게 알림
  if (quote.partnerEmail) {
    if (status === 'accepted') {
      createNotification(
        `partner:${normPartnerEmail(quote.partnerEmail)}`,
        'quote_accepted',
        '견적이 채택되었습니다',
        `"${quote.projectName}" 프로젝트의 견적이 채택되었습니다. 계약이 생성됩니다.`,
        { quoteId: id },
      );
      // Notify admin (in-app + email) — operator should know the deal
      // moved to contract stage so they can monitor escrow + delivery.
      createNotification(
        'admin',
        'quote_accepted',
        '견적 수락 — 계약 생성',
        `"${quote.projectName}" 견적이 수락되었습니다. 파트너: ${quote.partnerEmail}, 금액: ${quote.estimatedAmount?.toLocaleString('ko-KR') ?? '-'}원`,
        { quoteId: id },
      );
      try {
        const { sendEmail } = await import('@/lib/email');
        const { esc } = await import('@/lib/html-escape');
        const adminEmail = process.env.NEXYFAB_ADMIN_EMAIL;
        if (adminEmail) {
          void sendEmail({
            to: adminEmail,
            subject: `[NexyFab Ops] 견적 수락 — ${quote.projectName}`,
            html: `<p>고객이 <b>${esc(quote.projectName)}</b> 견적을 수락했습니다.<br/>파트너: ${esc(quote.partnerEmail)}<br/>금액: ${esc(quote.estimatedAmount?.toLocaleString('ko-KR') ?? '-')}원</p><p>다음: 결제 → 에스크로 → 양산</p><p><a href="https://nexyfab.com/admin/concierge">→ Concierge 콘솔</a></p>`,
          });
        }
      } catch { /* non-blocking */ }
      // Extend Pro grace through the delivery window — partner needs the
      // tools to drive the build (DFM iteration, revisions, sim).
      try {
        const partnerUser = await db.queryOne<{ id: string }>(
          'SELECT id FROM nf_users WHERE LOWER(TRIM(email)) = ?',
          normPartnerEmail(quote.partnerEmail),
        );
        if (partnerUser) {
          const { extendPartnerProGrace } = await import('@/lib/partner-pro-grace');
          await extendPartnerProGrace(partnerUser.id, 'rfq_accepted', Date.now());
        }
      } catch { /* non-blocking */ }

      // Auto-create the contract row so the buyer doesn't have to make a
      // second click after acceptance. Without this, the deal stalls at
      // "accepted" with no contract → no payment → no escrow.
      try {
        const existingContract = await db.queryOne<{ id: string }>(
          `SELECT id FROM nf_contracts WHERE quote_id = ? LIMIT 1`,
          id,
        ).catch(() => null);
        if (!existingContract) {
          const { getCommissionRatePct, COMMISSION_PCT_FLOOR } = await import('@/lib/commission');
          const contractAmount = quote.estimatedAmount ?? 0;
          // Look up buyer to check first-contract discount + plan tier.
          const buyer = await db.queryOne<{ user_id: string; user_email: string | null }>(
            `SELECT user_id, user_email FROM nf_rfqs WHERE id = ?`,
            quote.inquiryId,
          ).catch(() => null);
          const buyerEmail = buyer?.user_email ?? null;
          const buyerPlan = await db.queryOne<{ plan: string }>(
            `SELECT plan FROM nf_users WHERE id = ?`,
            buyer?.user_id ?? '',
          ).catch(() => null);
          const plan = buyerPlan?.plan ?? 'standard';
          const isFirstContract = buyerEmail
            ? ((await db.queryOne<{ cnt: number }>(
                `SELECT COUNT(*) as cnt FROM nf_contracts WHERE customer_email = ? AND status != 'cancelled'`,
                buyerEmail,
              ).catch(() => null))?.cnt ?? 0) === 0
            : false;
          const baseRate = getCommissionRatePct(contractAmount, plan);
          const rate = Math.max(COMMISSION_PCT_FLOOR, baseRate - (isFirstContract ? 1 : 0));
          const gross = Math.round(contractAmount * rate / 100);
          const MIN_FEE: Record<string, number> = { standard: 500_000, premium: 1_000_000, pro: 500_000, team: 800_000, enterprise: 1_000_000 };
          const deduction = MIN_FEE[plan] ?? 500_000;
          const finalCharge = Math.max(0, gross - deduction);
          const ctrId = `CTR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const nowIso = new Date().toISOString();
          await db.execute(
            `INSERT INTO nf_contracts
              (id, project_name, status, partner_email, factory_name,
               contract_amount, commission_rate, base_commission_rate,
               gross_commission, plan_deduction, final_charge,
               is_first_contract, first_contract_discount,
               customer_email, quote_id, plan, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            ctrId, quote.projectName, 'contracted',
            normPartnerEmail(quote.partnerEmail), quote.factoryName ?? null,
            contractAmount, rate, baseRate,
            gross, deduction, finalCharge,
            isFirstContract ? 1 : 0, isFirstContract ? Math.round(contractAmount * 1 / 100) : 0,
            buyerEmail, id, plan, nowIso,
          );
        }
      } catch (err) {
        console.warn('[quotes PATCH] contract auto-create failed:', err);
        // Non-blocking: the quote still flips to accepted even if contract
        // creation hits a race or transient DB error. Operator can retry
        // via /admin/contracts.
      }
    } else if (status === 'rejected') {
      createNotification(
        `partner:${normPartnerEmail(quote.partnerEmail)}`,
        'quote_rejected',
        '견적이 선택되지 않았습니다',
        `"${quote.projectName}" 프로젝트의 견적이 선택되지 않았습니다.`,
        { quoteId: id },
      );
    }
  }

  return NextResponse.json({ quote });
}
