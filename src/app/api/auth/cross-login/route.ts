/**
 * POST /api/auth/cross-login
 *
 * 다른 서비스(NexyFlow, NexyWise)에서 호출하는 통합 로그인 API.
 * 이메일+비밀번호로 인증 → 서비스 태그 추가 → JWT 발급.
 *
 * Headers:
 *   x-service-secret: 서비스 간 공유 시크릿 (CROSS_SERVICE_SECRET 환경변수)
 *
 * Body:
 *   { email, password, service, totpCode? }
 *
 * Response:
 *   { user, accessToken, refreshToken, services }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { recordLoginAndCheck } from '@/lib/login-security';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';
import type { UserRow } from '@/lib/db-types';
import * as OTPAuth from 'otpauth';

export const dynamic = 'force-dynamic';

const VALID_SERVICES = ['nexyfab', 'nexyflow', 'nexywise', 'nexysys'];

function verifyServiceSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-service-secret');
  const expected = process.env.CROSS_SERVICE_SECRET;
  if (!expected) {
    console.error('[cross-login] CROSS_SERVICE_SECRET not set');
    return false;
  }
  return secret === expected;
}

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
  service: z.string().min(1).max(50),
  totpCode: z.string().optional(),
});

export async function POST(req: NextRequest) {
  if (!verifyServiceSecret(req)) {
    return NextResponse.json({ error: 'Invalid service secret' }, { status: 403 });
  }

  const parsed = loginSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { email, password, service, totpCode } = parsed.data;
  if (!VALID_SERVICES.includes(service)) {
    return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
  }

  const db = getDbAdapter();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown';

  const dbUser = await db.queryOne<UserRow>('SELECT * FROM nf_users WHERE email = ?', email);
  if (!dbUser) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  // 잠금 확인
  if (dbUser.locked_until && Date.now() < dbUser.locked_until) {
    return NextResponse.json({ error: 'Account locked' }, { status: 423 });
  }

  // 비밀번호 없으면 (OAuth 전용) 거부
  if (!dbUser.password_hash) {
    return NextResponse.json({
      error: 'OAuth account — use OAuth login',
      oauthProvider: dbUser.oauth_provider,
    }, { status: 401 });
  }

  const passwordMatch = await bcrypt.compare(password, dbUser.password_hash);
  if (!passwordMatch) {
    recordLoginAndCheck(
      { userId: dbUser.id, ip, country: null, userAgent: req.headers.get('user-agent'), method: 'cross-login', success: false },
      req.headers,
    ).catch(() => {});

    const newAttempts = (dbUser.failed_login_attempts ?? 0) + 1;
    const shouldLock = newAttempts >= 5;
    await db.execute(
      'UPDATE nf_users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
      newAttempts, shouldLock ? Date.now() + 15 * 60 * 1000 : null, dbUser.id,
    );

    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  // 2FA 확인
  if (toBool(dbUser.totp_enabled)) {
    if (!totpCode) {
      return NextResponse.json({ requires2FA: true }, { status: 200 });
    }
    if (!dbUser.totp_secret) {
      return NextResponse.json({ error: '2FA config error' }, { status: 500 });
    }
    const totp = new OTPAuth.TOTP({
      issuer: 'Nexysys',
      label: dbUser.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(dbUser.totp_secret),
    });
    if (totp.validate({ token: totpCode, window: 1 }) === null) {
      return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 });
    }
  }

  // 로그인 성공 — 서비스 태그 추가
  const loginNow = Date.now();
  const currentServices: string[] = JSON.parse(dbUser.services || '[]');
  if (!currentServices.includes(service)) currentServices.push(service);

  const planCol = `${service}_plan`;
  await db.execute(
    `UPDATE nf_users SET failed_login_attempts = 0, locked_until = NULL,
      last_login_at = ?, login_count = COALESCE(login_count, 0) + 1, last_login_ip = ?,
      services = ?, ${planCol} = COALESCE(${planCol}, 'free'), updated_at = ? WHERE id = ?`,
    loginNow, ip, JSON.stringify(currentServices), loginNow, dbUser.id,
  );

  // 보안 검사
  const { blocked } = await recordLoginAndCheck(
    { userId: dbUser.id, ip, country: null, userAgent: req.headers.get('user-agent'), method: 'cross-login', success: true },
    req.headers,
  );
  if (blocked) {
    return NextResponse.json({ error: 'Account locked due to suspicious activity' }, { status: 423 });
  }

  // JWT 발급 (요청한 서비스로 발급)
  const accessToken = await signJWT(
    { sub: dbUser.id, email: dbUser.email, plan: dbUser.plan, emailVerified: toBool(dbUser.email_verified), service },
    15 * 60,
  );

  // Refresh token 발급
  const rawRefresh = randomBytes(40).toString('hex');
  const refreshHash = createHash('sha256').update(rawRefresh).digest('hex');
  const now = Date.now();

  await db.execute(
    "UPDATE nf_refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0",
    dbUser.id,
  );
  await db.execute(
    `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    `rt-${crypto.randomUUID()}`, dbUser.id, refreshHash, now + 30 * 24 * 3600_000, now,
  );

  return NextResponse.json({
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      plan: dbUser.plan,
      emailVerified: toBool(dbUser.email_verified),
      avatarUrl: dbUser.avatar_url,
    },
    accessToken,
    refreshToken: rawRefresh,
    services: currentServices,
  });
}
