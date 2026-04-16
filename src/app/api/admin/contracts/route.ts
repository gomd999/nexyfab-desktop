/**
 * GET  /api/admin/contracts  — 계약 목록 조회
 * POST /api/admin/contracts  — 새 계약 생성 (견적 → 계약 전환)
 *                              계약 생성 시 고객 + 제조사 양측에 이메일 자동 발송
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';
import { contractSignedHtml } from '@/lib/nexyfab-email';

export const dynamic = 'force-dynamic';

// ─── GET: 계약 목록 ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const status = req.nextUrl.searchParams.get('status') ?? '';
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? '1'));
  const limit = 20;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (status) { where += ' AND c.status = ?'; params.push(status); }
  if (q) {
    where += ' AND (c.project_name LIKE ? OR c.customer_email LIKE ? OR c.factory_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_contracts c ${where}`,
    ...params,
  );
  const total = countRow?.cnt ?? 0;

  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT c.* FROM nf_contracts c ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );

  return NextResponse.json({ contracts: rows, total, page, limit });
}

// ─── POST: 계약 생성 ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    quoteId?: string;
    projectName?: string;
    customerEmail?: string;
    customerName?: string;
    partnerEmail?: string;
    factoryName?: string;
    contractAmount?: number;
    commissionRate?: number;
    deadline?: string;
    plan?: string;
    lang?: string;
  };

  const {
    quoteId,
    projectName,
    customerEmail,
    customerName,
    partnerEmail,
    factoryName,
    contractAmount,
    commissionRate = 0.1,
    deadline,
    plan,
    lang = 'ko',
  } = body;

  if (!projectName || !contractAmount) {
    return NextResponse.json({ error: 'projectName과 contractAmount가 필요합니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const id = `CT-${Date.now()}`;
  const now = new Date().toISOString();
  const grossCommission = Number(contractAmount) * commissionRate;
  const finalCharge = grossCommission; // 플랜 할인 등은 추후 적용

  try {
    await db.execute(
      `INSERT INTO nf_contracts
        (id, project_name, status, partner_email, factory_name, deadline,
         contract_amount, commission_rate, gross_commission, final_charge,
         customer_email, quote_id, plan, created_at)
       VALUES (?, ?, 'contracted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectName,
      partnerEmail ?? null,
      factoryName ?? null,
      deadline ?? null,
      Number(contractAmount),
      commissionRate,
      grossCommission,
      finalCharge,
      customerEmail ?? null,
      quoteId ?? null,
      plan ?? null,
      now,
    );
  } catch (err) {
    console.error('[admin/contracts POST] DB error:', err);
    return NextResponse.json({ error: '계약 저장에 실패했습니다.' }, { status: 500 });
  }

  // 견적 상태를 accepted로 변경
  if (quoteId) {
    await db.execute(
      `UPDATE nf_quotes SET status = 'accepted', updated_at = ? WHERE id = ?`,
      now, quoteId,
    ).catch(() => {});
  }

  const resolvedLang = lang.startsWith('ko') ? 'ko' : 'en';

  // 고객 이메일 발송
  if (customerEmail) {
    const subject = resolvedLang === 'ko'
      ? `[NexyFab] 계약이 체결됐습니다 — ${projectName}`
      : `[NexyFab] Contract Signed — ${projectName}`;
    await enqueueJob('send_email', {
      to: customerEmail,
      subject,
      html: contractSignedHtml({
        recipientName: customerName || customerEmail,
        recipientType: 'customer',
        lang: resolvedLang,
        contractId: id,
        projectName,
        factoryName: factoryName ?? '제조사',
        contractAmount: Number(contractAmount),
        deadline: deadline ?? undefined,
      }),
    }).catch(() => {});

    // 고객 인앱 알림
    try {
      const userRow = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_users WHERE email = ?', customerEmail,
      );
      if (userRow?.id) {
        const notifId = `notif-${crypto.randomUUID()}`;
        await db.execute(
          `INSERT INTO nf_notifications (id, user_id, type, title, body, link, read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          notifId,
          userRow.id,
          'contract.signed',
          resolvedLang === 'ko' ? `계약 체결: ${projectName}` : `Contract signed: ${projectName}`,
          resolvedLang === 'ko'
            ? `${factoryName ?? '제조사'}와의 계약이 성공적으로 체결됐습니다.`
            : `Your contract with ${factoryName ?? 'the manufacturer'} has been confirmed.`,
          `/${resolvedLang === 'ko' ? 'kr' : 'en'}/nexyfab/orders`,
          Date.now(),
        );
      }
    } catch (err) {
      console.error('[admin/contracts POST] 고객 인앱 알림 실패:', err);
    }
  }

  // 파트너/제조사 이메일 발송
  if (partnerEmail) {
    await enqueueJob('send_email', {
      to: partnerEmail,
      subject: `[NexyFab] 계약 체결 확인 — ${projectName}`,
      html: contractSignedHtml({
        recipientName: factoryName || partnerEmail,
        recipientType: 'factory',
        lang: 'ko',
        contractId: id,
        projectName,
        factoryName: factoryName ?? '제조사',
        contractAmount: Number(contractAmount),
        deadline: deadline ?? undefined,
      }),
    }).catch(() => {});
  }

  const contract = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_contracts WHERE id = ?', id);
  return NextResponse.json({ contract }, { status: 201 });
}
