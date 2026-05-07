/**
 * POST /api/nexyfab/rfq/[id]/dispatch
 *
 * RFQ 자동 발송 — 상위 매칭 제조사들에게 동시 견적 요청 이메일 발송 + nf_quotes 에
 * pending 행 생성. QuoteWizard → 제조사 매칭 → 이 엔드포인트 호출로 퍼널 자동화.
 *
 * Body:
 *   recipients: [{ email: string; factoryName: string; partnerEmail?: string }]
 *   subject?:   string   (supplied by rfq-writer, else auto-generated)
 *   body?:      string   (email body)
 *   validDays?: number   (default 14)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sendEmail } from '@/lib/nexyfab-email';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

interface Recipient {
  email: string;
  factoryName: string;
  partnerEmail?: string;
}

interface DispatchBody {
  recipients: Recipient[];
  subject?: string;
  body?: string;
  validDays?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: rfqId } = await params;
  const db = getDbAdapter();

  const rfq = await db.queryOne<{
    id: string; shape_name: string | null; material_id: string | null;
    quantity: number; volume_cm3: number | null; user_email: string | null;
  }>(
    `SELECT id, shape_name, material_id, quantity, volume_cm3, user_email
     FROM nf_rfqs WHERE id = ? AND user_id = ?`,
    rfqId, authUser.userId,
  );
  if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as DispatchBody;
  if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    return NextResponse.json({ error: 'recipients[] required' }, { status: 400 });
  }
  if (body.recipients.length > 10) {
    return NextResponse.json({ error: '최대 10개 제조사까지 발송 가능합니다' }, { status: 400 });
  }
  const validRecipients = body.recipients.filter(r => EMAIL_RE.test(r.email) && r.factoryName);
  if (validRecipients.length === 0) {
    return NextResponse.json({ error: '유효한 수신자가 없습니다' }, { status: 400 });
  }

  const partName = rfq.shape_name ?? rfqId;
  const subject = body.subject ?? `[NexyFab RFQ] ${partName} · qty ${rfq.quantity}`;
  const baseBody = body.body ?? [
    `${partName} 견적 요청드립니다.`,
    `수량: ${rfq.quantity}개`,
    rfq.material_id ? `소재: ${rfq.material_id}` : '',
    rfq.volume_cm3 ? `체적 약 ${Math.round(rfq.volume_cm3)} cm³` : '',
    '',
    '세부 사양 및 CAD 파일은 NexyFab 대시보드에서 확인 가능합니다.',
  ].filter(Boolean).join('\n');

  const validDays = Math.min(30, Math.max(3, body.validDays ?? 14));
  const validUntil = new Date(Date.now() + validDays * 86_400_000).toISOString().slice(0, 10);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const results: Array<{ email: string; factoryName: string; quoteId: string; ok: boolean; error?: string }> = [];

  // response_token 컬럼 lazy 추가 — 공급사 공개 응답 링크용 토큰
  await db.execute('ALTER TABLE nf_quotes ADD COLUMN response_token TEXT').catch(() => {});
  await db.execute('ALTER TABLE nf_quotes ADD COLUMN estimated_days INTEGER').catch(() => {});
  await db.execute('ALTER TABLE nf_quotes ADD COLUMN note TEXT').catch(() => {});
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nexyfab.com';

  for (const r of validRecipients) {
    const quoteId = `Q-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const responseToken = randomBytes(24).toString('hex');
    try {
      // nf_quotes pending 행 생성 (공급사가 응답하기 전 상태)
      await db.execute(
        `INSERT INTO nf_quotes
           (id, inquiry_id, project_name, factory_name, estimated_amount,
            details, valid_until, partner_email, status, created_at, updated_at, response_token)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, ?, ?)`,
        quoteId,
        rfqId,
        partName,
        r.factoryName,
        `자동 발송 RFQ — ${subject}`,
        validUntil,
        r.email,
        nowIso,
        nowIso,
        responseToken,
      );

      // 이메일 발송
      const respondUrl = `${baseUrl}/quote-respond/${quoteId}?t=${responseToken}`;
      const htmlBody = `<div style="font-family:system-ui;max-width:560px">
        <p style="white-space:pre-line">${baseBody.replace(/</g, '&lt;')}</p>
        <div style="margin:20px 0">
          <a href="${respondUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            견적 제출하기 →
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
        <p style="color:#6b7280;font-size:12px">
          응답 유효 기간: ${validUntil} 까지 · RFQ: ${rfqId} · Quote: ${quoteId}<br>
          로그인 없이 위 버튼으로 바로 견적 제출 가능합니다.
        </p>
      </div>`;

      await sendEmail(r.email, subject, htmlBody);
      results.push({ email: r.email, factoryName: r.factoryName, quoteId, ok: true });
    } catch (err) {
      results.push({
        email: r.email,
        factoryName: r.factoryName,
        quoteId,
        ok: false,
        error: err instanceof Error ? err.message : 'dispatch failed',
      });
    }
  }

  // RFQ 상태 업데이트 (dispatched → 공급사 응답 대기)
  const anySuccess = results.some(r => r.ok);
  if (anySuccess) {
    await db.execute(
      `UPDATE nf_rfqs SET status = 'dispatched', updated_at = ? WHERE id = ?`,
      now, rfqId,
    );
  }

  return NextResponse.json({
    ok: anySuccess,
    dispatched: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
}
