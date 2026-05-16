// Win-back cron — sends a 30%-off resubscribe offer to users who
// cancelled 7+ days ago and opted in. Runs daily. Idempotent via
// winback_sent_at flag so each row gets at most one offer.

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/nexyfab-email';

const COUPON_CODE = 'WELCOME-BACK-30';
const DISCOUNT_PCT = 30;

const REASON_PITCH: Record<string, string> = {
  too_expensive: '🎁 30% 할인 코드로 다시 시작해보세요',
  missing_feature: '✨ 그동안 새로 추가된 기능을 확인해보세요',
  switched_competitor: '🚀 NexyFab 만의 강점 — 다시 비교해보세요',
  no_longer_needed: '🛠 다시 필요해질 때를 위해 30% 할인 보관해드립니다',
  too_complex: '📖 신규 튜토리얼 + AI 어시스턴트로 더 쉬워졌습니다',
  bugs_or_quality: '🔧 큰 안정성 개선이 있었습니다. 다시 시도해보세요',
  other: '💌 다시 만나뵙고 싶습니다',
};

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86_400_000;
  const eightDaysAgo = now - 8 * 86_400_000;

  // Pick rows cancelled 7-8 days ago (1-day window so re-runs don't double-send).
  const candidates = await db.queryAll<{ id: string; user_id: string; product: string; reason: string }>(
    `SELECT id, user_id, product, reason
       FROM nf_cancel_surveys
      WHERE winback_eligible = 1
        AND winback_sent_at IS NULL
        AND created_at >= ? AND created_at < ?`,
    eightDaysAgo, sevenDaysAgo,
  ).catch(() => []);

  const portalUrl = (process.env.NEXT_PUBLIC_NEXYFAB_URL ?? 'https://nexyfab.com') + '/kr/nexyfab/billing';
  let sent = 0;

  for (const row of candidates) {
    const user = await db.queryOne<{ email: string; name: string }>(
      'SELECT email, name FROM nf_users WHERE id = ?',
      row.user_id,
    );
    if (!user?.email) continue;

    const headline = REASON_PITCH[row.reason] ?? REASON_PITCH.other;
    const subject = `[NexyFab] ${user.name} 님, ${DISCOUNT_PCT}% 할인으로 다시 만나요`;
    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;">
          <span style="font-size:22px;font-weight:700;color:#60a5fa;">NexyFab</span>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <h1 style="color:#60a5fa;font-size:20px;margin:0 0 16px;">${headline}</h1>
          <p style="color:#e2e8f0;font-size:14px;line-height:1.6;margin:0 0 16px;">
            ${user.name} 님, 다시 함께하실 준비가 되셨다면 첫 3개월 ${DISCOUNT_PCT}% 할인 쿠폰을 드립니다.
          </p>
          <div style="background:#0f172a;border:1px dashed #334155;border-radius:8px;padding:16px;text-align:center;margin:0 0 24px;">
            <p style="color:#64748b;font-size:11px;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">쿠폰 코드</p>
            <span style="font-size:22px;font-weight:700;letter-spacing:4px;color:#60a5fa;font-family:monospace;">${COUPON_CODE}</span>
          </div>
          <a href="${portalUrl}?coupon=${COUPON_CODE}" style="display:inline-block;padding:12px 24px;background:#60a5fa;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">
            지금 사용하기 →
          </a>
          <p style="color:#475569;font-size:11px;margin:24px 0 0;">
            쿠폰은 30일간 유효합니다. © ${new Date().getFullYear()} Nexysys Lab Co., Ltd.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    try {
      await sendEmail(user.email, subject, html);
      await db.execute(
        'UPDATE nf_cancel_surveys SET winback_sent_at = ? WHERE id = ?',
        now, row.id,
      );
      sent++;
    } catch (err) {
      console.warn('[winback] send failed:', err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
