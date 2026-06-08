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
import { parseFxQuote, isFxQuoteValid } from '@/lib/money';

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

  // Carry the locked FX + currency from the source quote so the contract
  // total isn't silently re-expressed in a different currency later.
  // If the quote's FX window has expired we still record the original
  // snapshot — expiry only blocks re-pricing, not bookkeeping.
  let contractCurrency = 'KRW';
  let contractFxQuote: string | null = null;
  if (quoteId) {
    const srcQuote = await db.queryOne<{ currency: string | null; fx_quote: string | null }>(
      'SELECT currency, fx_quote FROM nf_quotes WHERE id = ?',
      quoteId,
    ).catch(() => null);
    if (srcQuote?.currency) contractCurrency = srcQuote.currency;
    if (srcQuote?.fx_quote) {
      const parsed = parseFxQuote(srcQuote.fx_quote);
      if (parsed && !isFxQuoteValid(parsed)) {
        console.warn(`[admin/contracts POST] quote ${quoteId} FX snapshot expired; preserving for audit only`);
      }
      contractFxQuote = srcQuote.fx_quote;
    }
  }

  try {
    await db.execute(
      `INSERT INTO nf_contracts
        (id, project_name, status, partner_email, factory_name, deadline,
         contract_amount, currency, fx_quote,
         commission_rate, gross_commission, final_charge,
         customer_email, quote_id, plan, created_at)
       VALUES (?, ?, 'contracted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectName,
      partnerEmail ?? null,
      factoryName ?? null,
      deadline ?? null,
      Number(contractAmount),
      contractCurrency,
      contractFxQuote,
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

  // 계약 체결 → 추적 가능한 주문 자동 생성.
  // 이전에는 계약만 만들고 nf_orders 행이 없어, "계약 체결" 알림이 가리키는
  // /nexyfab/orders 에 정작 주문이 없었다. 여기서 그 연결을 만든다.
  // (계약 저장이 성공한 뒤 best-effort — 주문 생성 실패가 계약을 깨지 않는다.)
  try {
    const nowMs = Date.now();
    const DAY = 86_400_000;
    // 멱등성: 같은 견적으로 이미 주문이 있으면 중복 생성하지 않는다.
    await db.execute('ALTER TABLE nf_orders ADD COLUMN quote_id TEXT').catch(() => {});
    const existingOrder = quoteId
      ? await db.queryOne<{ id: string }>('SELECT id FROM nf_orders WHERE quote_id = ?', quoteId).catch(() => null)
      : null;
    const custRow = customerEmail
      ? await db.queryOne<{ id: string }>('SELECT id FROM nf_users WHERE email = ?', customerEmail).catch(() => null)
      : null;

    if (!existingOrder && custRow?.id) {
      // 수량/부품명/RFQ는 원본 견적 → RFQ 에서 끌어온다(없으면 합리적 기본값).
      let rfqId: string | null = null;
      let quantity = 1;
      let partName = projectName;
      if (quoteId) {
        const q = await db.queryOne<{ inquiry_id: string | null }>(
          'SELECT inquiry_id FROM nf_quotes WHERE id = ?', quoteId,
        ).catch(() => null);
        if (q?.inquiry_id) {
          rfqId = q.inquiry_id;
          const rfq = await db.queryOne<{ quantity: number | null; shape_name: string | null }>(
            'SELECT quantity, shape_name FROM nf_rfqs WHERE id = ?', rfqId,
          ).catch(() => null);
          if (rfq?.quantity && rfq.quantity > 0) quantity = rfq.quantity;
          if (rfq?.shape_name) partName = rfq.shape_name;
        }
      }
      // 납기일이 있으면 그날까지, 없으면 14일.
      const deadlineMs = deadline ? Date.parse(deadline) : NaN;
      const leadDays = Number.isFinite(deadlineMs) && deadlineMs > nowMs
        ? Math.max(1, Math.ceil((deadlineMs - nowMs) / DAY))
        : 14;
      const steps = [
        { label: 'Order Placed',  labelKo: '주문 완료', completedAt: nowMs },
        { label: 'In Production', labelKo: '생산 중',   estimatedAt: nowMs + 2 * DAY },
        { label: 'QC',            labelKo: '품질 검사', estimatedAt: nowMs + Math.max(0, leadDays - 4) * DAY },
        { label: 'Shipped',       labelKo: '배송 시작', estimatedAt: nowMs + Math.max(0, leadDays - 2) * DAY },
        { label: 'Delivered',     labelKo: '배송 완료', estimatedAt: nowMs + leadDays * DAY },
      ];
      const orderId = `ORD-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      await db.execute(
        `INSERT INTO nf_orders
          (id, rfq_id, quote_id, user_id, part_name, manufacturer_name, quantity,
           total_price_krw, status, steps, created_at, estimated_delivery_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?, ?, ?)`,
        orderId,
        rfqId,
        quoteId ?? null,
        custRow.id,
        partName,
        factoryName ?? '제조사',
        quantity,
        Number(contractAmount),
        JSON.stringify(steps),
        nowMs,
        nowMs + leadDays * DAY,
      );
    }
  } catch (err) {
    console.error('[admin/contracts POST] 주문 자동 생성 실패(계약은 유지):', err);
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
