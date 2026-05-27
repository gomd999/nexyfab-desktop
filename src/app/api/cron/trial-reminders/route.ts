// Trial reminder cron — sends 7-day / 3-day / 1-day advance notice mails
// to users in active trial, and auto-downgrades expired trials.
// Runs daily at 09:00 KST (configure in vercel.json / external scheduler).

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/nexyfab-email';

const STAGES: { days: number; key: string; subject: (n: string) => string }[] = [
  { days: 7, key: 'trial_remind_7d', subject: (n) => `[NexyFab] ${n} 님, 무료 체험이 7일 남았습니다` },
  { days: 3, key: 'trial_remind_3d', subject: (n) => `[NexyFab] ${n} 님, 체험 만료 3일 전 — 카드 등록 시 자동 연장` },
  { days: 1, key: 'trial_remind_1d', subject: (n) => `[NexyFab] ⚠ ${n} 님, 내일 체험이 만료됩니다` },
];

function reminderHtml(name: string, daysLeft: number, portalUrl: string): string {
  const accent = daysLeft === 1 ? '#ef4444' : daysLeft <= 3 ? '#f59e0b' : '#60a5fa';
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;border-bottom:3px solid ${accent};">
          <span style="font-size:22px;font-weight:700;color:#60a5fa;">NexyFab</span>
          <span style="font-size:22px;font-weight:300;color:#94a3b8;"> — 체험 기간 안내</span>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <h1 style="color:${accent};font-size:20px;margin:0 0 16px;">
            ${daysLeft === 1 ? '⚠ 내일 체험이 만료됩니다' : `체험이 ${daysLeft}일 남았습니다`}
          </h1>
          <p style="color:#e2e8f0;font-size:14px;line-height:1.6;margin:0 0 16px;">
            ${name} 님, NexyFab Pro 무료 체험이 곧 종료됩니다. 카드를 등록하시면 끊김 없이 계속 사용하실 수 있고, 등록하지 않으시면 자동으로 Free 플랜으로 전환됩니다.
          </p>
          <a href="${portalUrl}" style="display:inline-block;padding:12px 24px;background:${accent};color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">
            결제 수단 등록 →
          </a>
          <p style="color:#475569;font-size:11px;margin:24px 0 0;">
            © ${new Date().getFullYear()} Nexysys Lab Co., Ltd.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const oneDay = 86_400_000;
  const portalUrl = (process.env.NEXT_PUBLIC_NEXYFAB_URL ?? 'https://nexyfab.com') + '/kr/nexyfab/billing';

  let sent = 0;
  let downgraded = 0;

  // Ensure the dedup table exists so we don't double-send across runs.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_trial_reminders_sent (
      user_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, stage)
    )
  `);

  for (const stage of STAGES) {
    const windowStart = now + (stage.days - 0.5) * oneDay;
    const windowEnd   = now + (stage.days + 0.5) * oneDay;
    const subs = await db.queryAll<{ user_id: string; trial_end: number; aw_subscription_id: string }>(
      `SELECT user_id, trial_end, aw_subscription_id FROM nf_aw_subscriptions
        WHERE status = 'trialing' AND trial_end IS NOT NULL
          AND trial_end >= ? AND trial_end < ?`,
      windowStart, windowEnd,
    ).catch(() => []);

    for (const s of subs) {
      const already = await db.queryOne<{ user_id: string }>(
        'SELECT user_id FROM nf_trial_reminders_sent WHERE user_id = ? AND stage = ?',
        s.user_id, stage.key,
      );
      if (already) continue;
      const user = await db.queryOne<{ email: string; name: string }>(
        'SELECT email, name FROM nf_users WHERE id = ?',
        s.user_id,
      );
      if (!user?.email) continue;
      try {
        await sendEmail(user.email, stage.subject(user.name), reminderHtml(user.name, stage.days, portalUrl));
        await db.execute(
          'INSERT INTO nf_trial_reminders_sent (user_id, stage, sent_at) VALUES (?, ?, ?)',
          s.user_id, stage.key, now,
        );
        sent++;
      } catch (err) {
        console.warn('[trial-reminders] send failed:', err);
      }
    }
  }

  // Expired trials → auto-downgrade to free.
  const expired = await db.queryAll<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM nf_aw_subscriptions
      WHERE status = 'trialing' AND trial_end IS NOT NULL AND trial_end < ?`,
    now,
  ).catch(() => []);
  for (const e of expired) {
    await db.execute("UPDATE nf_aw_subscriptions SET status = 'expired' WHERE id = ?", e.id);
    await db.execute("UPDATE nf_users SET plan = 'free' WHERE id = ?", e.user_id);
    downgraded++;
  }

  return NextResponse.json({ ok: true, sent, downgraded });
}
