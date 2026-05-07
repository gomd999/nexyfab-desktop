import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { rateLimit } from '@/lib/rate-limit';
import { checkOrigin } from '@/lib/csrf';
import { createAdminSession } from '@/lib/admin-auth';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // CSRF check
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit: 5 attempts per minute per IP
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`admin-auth:${ip}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const { password } = await req.json() as { password?: string };

  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPasswordPlain = process.env.ADMIN_PASSWORD;

  if (!adminPasswordHash && !adminPasswordPlain) {
    console.error('[admin/auth] ADMIN_PASSWORD_HASH 또는 ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
  }

  if (!password) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  let valid = false;
  if (adminPasswordHash) {
    valid = await bcrypt.compare(password, adminPasswordHash);
  } else if (adminPasswordPlain) {
    // 프로덕션에서는 평문 비밀번호 허용 안 함 — ADMIN_PASSWORD_HASH 설정 필요
    if (process.env.NODE_ENV === 'production') {
      console.error('[admin/auth] Production requires ADMIN_PASSWORD_HASH (bcrypt). Plain ADMIN_PASSWORD rejected.');
      return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
    }
    valid = password === adminPasswordPlain;
  }

  if (!valid) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const adminToken = createAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set('nf_admin_token', adminToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 60,
    path: '/api/admin',
  });
  return response;
}
