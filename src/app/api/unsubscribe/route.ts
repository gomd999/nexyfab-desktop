/**
 * GET  /api/unsubscribe?email=xxx&token=yyy  — 수신거부 링크 처리 (이메일에서 클릭)
 * POST /api/unsubscribe                      — 수신거부 확인 처리
 *
 * 토큰 = HMAC-SHA256(email, UNSUBSCRIBE_SECRET)
 * 이메일 footer의 수신거부 링크에 포함됩니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://nexyfab.com';

function getSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'nexyfab-unsub-secret';
}

function generateToken(email: string): string {
  return createHmac('sha256', getSecret()).update(email.toLowerCase()).digest('hex');
}

function verifyToken(email: string, token: string): boolean {
  const expected = generateToken(email);
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
  } catch {
    return false;
  }
}

async function ensureTable(db: ReturnType<typeof getDbAdapter>) {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_email_unsubscribe (
      email       TEXT PRIMARY KEY,
      unsubbed_at INTEGER NOT NULL
    )
  `);
}

// GET: 이메일 링크 클릭 → 수신거부 처리 후 확인 페이지로 리다이렉트
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? '';
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!email || !token || !verifyToken(email, token)) {
    return NextResponse.redirect(`${BASE_URL}/unsubscribe?error=invalid`);
  }

  const db = getDbAdapter();
  await ensureTable(db);
  await db.execute(
    `INSERT OR IGNORE INTO nf_email_unsubscribe (email, unsubbed_at) VALUES (?, ?)`,
    email.toLowerCase(),
    Date.now(),
  );
  // Also remove from drip log so future drip jobs won't fire
  await db.execute(
    `DELETE FROM nf_email_drip_log WHERE user_id IN (SELECT id FROM nf_users WHERE email = ?)`,
    email.toLowerCase(),
  ).catch(() => {});

  return NextResponse.redirect(`${BASE_URL}/unsubscribe?success=1&email=${encodeURIComponent(email)}`);
}

// POST: 확인 페이지에서 제출
export async function POST(req: NextRequest) {
  const body = await req.json() as { email?: string; token?: string };
  const { email = '', token = '' } = body;

  if (!email || !token || !verifyToken(email, token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureTable(db);
  await db.execute(
    `INSERT OR IGNORE INTO nf_email_unsubscribe (email, unsubbed_at) VALUES (?, ?)`,
    email.toLowerCase(),
    Date.now(),
  );
  await db.execute(
    `DELETE FROM nf_email_drip_log WHERE user_id IN (SELECT id FROM nf_users WHERE email = ?)`,
    email.toLowerCase(),
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}

// 헬퍼 함수는 @/lib/unsubscribe 에서 export됩니다 (route 파일 제약 회피)
