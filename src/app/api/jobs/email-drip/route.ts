/**
 * POST/GET /api/jobs/email-drip
 *
 * 온보딩 드립 이메일 발송 잡
 *   - D+1 (24h 이상): 핵심 기능 소개 이메일
 *   - D+7 (7일 이상, free 플랜만): Pro 업그레이드 제안
 *
 * Railway cron에서 하루 1회 호출:
 *   POST /api/jobs/email-drip with header x-cron-secret: $CRON_SECRET
 *
 * 중복 발송 방지: nf_email_drip_log 테이블로 추적
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { enqueueJob } from '@/lib/job-queue';
import { dripD1Html, dripD7Html, dripD1EmailSubject, dripD7EmailSubject, nexyfabEmailLocaleFromLanguageTag } from '@/lib/nexyfab-email';
import { buildUnsubscribeUrl } from '@/lib/unsubscribe';

export const dynamic = 'force-dynamic';

const D1_MS = 24 * 60 * 60 * 1000;        // 24 hours
const D7_MS = 7 * 24 * 60 * 60 * 1000;    // 7 days

async function ensureTable(db: ReturnType<typeof getDbAdapter>) {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_email_drip_log (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      drip_type  TEXT NOT NULL,
      sent_at    INTEGER NOT NULL
    )
  `);
  await db.executeRaw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_log_user_type
    ON nf_email_drip_log (user_id, drip_type)
  `);
}

interface DripUser {
  id: string;
  email: string;
  name: string | null;
  language: string | null;
  plan: string;
  created_at: number;
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected   = process.env.CRON_SECRET;
  const isAdmin    = await verifyAdmin(req);
  const isCron     = !!expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  await ensureTable(db);

  const now = Date.now();
  const d1Cutoff = now - D1_MS;
  const d7Cutoff = now - D7_MS;

  // Users eligible for D+1 who haven't received it yet
  const d1Users = await db.queryAll<DripUser>(
    `SELECT u.id, u.email, u.name, u.language, u.plan, u.created_at
     FROM nf_users u
     WHERE u.created_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM nf_email_drip_log d
         WHERE d.user_id = u.id AND d.drip_type = 'd1'
       )
     LIMIT 50`,
    d1Cutoff,
  );

  // Users eligible for D+7 who are still on free plan and haven't received it
  const d7Users = await db.queryAll<DripUser>(
    `SELECT u.id, u.email, u.name, u.language, u.plan, u.created_at
     FROM nf_users u
     WHERE u.created_at <= ?
       AND (u.plan IS NULL OR u.plan = 'free')
       AND NOT EXISTS (
         SELECT 1 FROM nf_email_drip_log d
         WHERE d.user_id = u.id AND d.drip_type = 'd7'
       )
     LIMIT 50`,
    d7Cutoff,
  );

  let d1Sent = 0;
  let d7Sent = 0;

  for (const user of d1Users) {
    const locale = nexyfabEmailLocaleFromLanguageTag(user.language);
    const name = user.name || user.email.split('@')[0];
    const subject = dripD1EmailSubject(locale);

    try {
      await enqueueJob('send_email', {
        to: user.email,
        subject,
        html: dripD1Html(name, locale, buildUnsubscribeUrl(user.email)),
      });
      await db.execute(
        `INSERT OR IGNORE INTO nf_email_drip_log (id, user_id, drip_type, sent_at) VALUES (?, ?, 'd1', ?)`,
        `drip-d1-${user.id}`,
        user.id,
        now,
      );
      d1Sent++;
    } catch { /* non-fatal */ }
  }

  for (const user of d7Users) {
    const locale = nexyfabEmailLocaleFromLanguageTag(user.language);
    const name = user.name || user.email.split('@')[0];
    const subject = dripD7EmailSubject(locale);

    try {
      await enqueueJob('send_email', {
        to: user.email,
        subject,
        html: dripD7Html(name, locale, buildUnsubscribeUrl(user.email)),
      });
      await db.execute(
        `INSERT OR IGNORE INTO nf_email_drip_log (id, user_id, drip_type, sent_at) VALUES (?, ?, 'd7', ?)`,
        `drip-d7-${user.id}`,
        user.id,
        now,
      );
      d7Sent++;
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    ok: true,
    processedAt: new Date(now).toISOString(),
    d1Sent,
    d7Sent,
  });
}

// Vercel Cron GET support
export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected   = process.env.CRON_SECRET;
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return POST(req);
}
