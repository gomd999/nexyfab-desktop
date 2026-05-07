/**
 * GET /api/nexyfab/quote-response/[quoteId]?t=<responseToken>
 *   — dispatch 이메일 링크에서 사용하는 공개 엔드포인트. 토큰 검증 후 최소한의 RFQ 정보 반환.
 *
 * POST /api/nexyfab/quote-response/[quoteId]?t=<responseToken>
 *   — 공급사가 견적 금액/납기/메모를 제출. status: pending → submitted.
 *
 * 로그인 없이 접근 가능하므로 token 기반 접근 제어. 토큰은 32 hex chars (128-bit).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { createNotification } from '@/app/lib/notify';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string;
  inquiry_id: string | null;
  project_name: string;
  factory_name: string;
  valid_until: string | null;
  status: string;
  response_token: string | null;
  partner_email: string | null;
  estimated_amount: number;
  estimated_days: number | null;
  note: string | null;
}

async function loadQuoteWithToken(quoteId: string, token: string) {
  const db = getDbAdapter();
  const q = await db.queryOne<QuoteRow>(
    `SELECT id, inquiry_id, project_name, factory_name, valid_until, status,
            response_token, partner_email, estimated_amount, estimated_days, note
     FROM nf_quotes WHERE id = ?`,
    quoteId,
  ).catch(() => null);
  if (!q) return { error: 'not_found' as const };
  if (!q.response_token || q.response_token !== token) return { error: 'invalid_token' as const };
  return { quote: q };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params;
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const r = await loadQuoteWithToken(quoteId, token);
  if ('error' in r) {
    const status = r.error === 'not_found' ? 404 : 403;
    return NextResponse.json({ error: r.error }, { status });
  }
  const q = r.quote;

  // 추가 RFQ 컨텍스트 (수량/소재) — 공급사가 견적 낼 때 필요
  let rfqCtx: { shapeName: string | null; quantity: number; materialId: string | null } | null = null;
  if (q.inquiry_id) {
    const db = getDbAdapter();
    rfqCtx = (await db.queryOne<{ shapeName: string | null; quantity: number; materialId: string | null }>(
      'SELECT shape_name as shapeName, quantity, material_id as materialId FROM nf_rfqs WHERE id = ?',
      q.inquiry_id,
    ).catch(() => null)) ?? null;
  }

  return NextResponse.json({
    quoteId: q.id,
    rfqId: q.inquiry_id,
    projectName: q.project_name,
    factoryName: q.factory_name,
    validUntil: q.valid_until,
    status: q.status,
    partnerEmail: q.partner_email,
    existing: q.status !== 'pending' ? {
      estimatedAmount: q.estimated_amount,
      estimatedDays: q.estimated_days,
      note: q.note,
    } : null,
    rfq: rfqCtx,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params;
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const r = await loadQuoteWithToken(quoteId, token);
  if ('error' in r) {
    const status = r.error === 'not_found' ? 404 : 403;
    return NextResponse.json({ error: r.error }, { status });
  }
  const q = r.quote;
  if (q.status !== 'pending') {
    return NextResponse.json({ error: 'already_submitted', status: q.status }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as {
    estimatedAmount?: number;
    estimatedDays?: number;
    note?: string;
  };
  const amount = Number(body.estimatedAmount);
  const days = Number(body.estimatedDays);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11) {
    return NextResponse.json({ error: '유효한 견적 금액을 입력해 주세요 (0 ~ 1000억원)' }, { status: 400 });
  }
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: '납기는 1 ~ 365일 범위' }, { status: 400 });
  }
  const note = (body.note ?? '').toString().slice(0, 2000);

  // 유효기간 지난 경우 거부
  if (q.valid_until) {
    const deadline = Date.parse(q.valid_until + 'T23:59:59Z');
    if (Number.isFinite(deadline) && Date.now() > deadline) {
      return NextResponse.json({ error: '응답 유효 기간이 만료되었습니다' }, { status: 410 });
    }
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const db = getDbAdapter();
  await db.execute(
    `UPDATE nf_quotes
       SET estimated_amount = ?, estimated_days = ?, note = ?,
           status = 'submitted', updated_at = ?
     WHERE id = ?`,
    amount, days, note, nowIso, quoteId,
  );

  // RFQ 상태 dispatched → quoted (응답이 1개라도 도착하면)
  if (q.inquiry_id) {
    await db.execute(
      `UPDATE nf_rfqs SET status = 'quoted', updated_at = ? WHERE id = ? AND status IN ('dispatched','draft')`,
      now, q.inquiry_id,
    );

    // RFQ 소유자에게 알림
    const owner = await db.queryOne<{ user_id: string; user_email: string | null; shape_name: string | null }>(
      'SELECT user_id, user_email, shape_name FROM nf_rfqs WHERE id = ?',
      q.inquiry_id,
    ).catch(() => null);
    if (owner?.user_id) {
      createNotification(
        owner.user_id,
        'quote_submitted',
        '견적 도착',
        `${q.factory_name} — ₩${amount.toLocaleString('ko-KR')} (${days}일 납기)`,
        { quoteId },
      );
    }
  }

  return NextResponse.json({ ok: true, status: 'submitted' });
}
