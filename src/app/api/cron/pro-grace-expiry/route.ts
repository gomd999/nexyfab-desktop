/**
 * GET /api/cron/pro-grace-expiry
 *
 * Daily sweep — emails partners whose Pro grace window expires in 7 days
 * or 1 day. Two-touch reminder is enough: 7d gives them time to push
 * another deal through, 1d is the last chance before they lose tooling.
 *
 * Sent-tracking: we don't write a separate "reminder sent" log; instead
 * we key off proximity to the cutoff (within ±12h of the 7d/1d boundary)
 * so a single daily run hits each partner once per band.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/email';
import { esc } from '@/lib/html-escape';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HALF_DAY_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CandidateRow {
  id: string;
  email: string;
  name: string;
  pro_grace_until: number;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const t7Min = now + 7 * DAY_MS - HALF_DAY_MS;
  const t7Max = now + 7 * DAY_MS + HALF_DAY_MS;
  const t1Min = now + 1 * DAY_MS - HALF_DAY_MS;
  const t1Max = now + 1 * DAY_MS + HALF_DAY_MS;

  const db = getDbAdapter();

  const candidates = await db.queryAll<CandidateRow>(
    `SELECT id, email, name, pro_grace_until
       FROM nf_users
      WHERE plan = 'free'
        AND pro_grace_until IS NOT NULL
        AND ((pro_grace_until BETWEEN ? AND ?) OR (pro_grace_until BETWEEN ? AND ?))`,
    t7Min, t7Max, t1Min, t1Max,
  ).catch((): CandidateRow[] => []);

  const sent: Array<{ email: string; band: '7d' | '1d' }> = [];

  for (const u of candidates) {
    const remainingMs = u.pro_grace_until - now;
    const band: '7d' | '1d' = remainingMs <= 1.5 * DAY_MS ? '1d' : '7d';
    const expiryDate = new Date(u.pro_grace_until).toLocaleDateString('ko-KR');

    const subject = band === '1d'
      ? `[NexyFab] Pro 도구 사용 기간이 내일 만료됩니다`
      : `[NexyFab] Pro 도구 사용 기간이 7일 후 만료됩니다`;

    const ctaTitle = band === '1d'
      ? '거래를 계속하시려면 새 견적을 제출하거나 Pro 플랜으로 전환해 주세요'
      : '추가 견적 제출 시 자동으로 연장됩니다';

    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
        <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">
          ${band === '1d' ? '⏰ Pro 도구 사용 기간 만료 임박 (D-1)' : '🔔 Pro 도구 사용 기간 안내 (D-7)'}
        </div>
        <p style="line-height: 1.6;">
          ${esc(u.name)} 님의 NexyFab Pro 도구 사용 기간이
          <b>${esc(expiryDate)}</b>까지 유지됩니다.
        </p>
        <p style="line-height: 1.6;">${ctaTitle}.</p>
        <ul style="line-height: 1.8; color: #374151;">
          <li>새 견적 제출 → +30일 자동 연장</li>
          <li>견적이 수락되면 → 추가 +60일</li>
          <li>거래 정산 완료 → +30일 (분쟁/AS 기간)</li>
        </ul>
        <div style="margin-top: 24px;">
          <a href="https://nexyfab.com/partner/invitations"
             style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; border-radius: 8px; text-decoration: none; font-weight: 700;">
            들어온 견적 요청 확인 →
          </a>
        </div>
        <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;" />
        <p style="font-size: 12px; color: #6b7280;">
          이 안내는 NexyFab 컨시어지 매칭에 참여 중인 파트너에게 발송됩니다.
          유료 Pro 플랜으로 전환을 원하시면
          <a href="https://nexyfab.com/ko/nexyfab/pricing">요금제 페이지</a>를 확인해 주세요.
        </p>
      </div>
    `;

    const result = await sendEmail({ to: u.email, subject, html }).catch(() => ({ ok: false }));
    if (result.ok) sent.push({ email: u.email, band });
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    sent: sent.length,
    breakdown: {
      d7: sent.filter(s => s.band === '7d').length,
      d1: sent.filter(s => s.band === '1d').length,
    },
  });
}
