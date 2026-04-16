/**
 * POST /api/auth/cross-signup
 *
 * 다른 서비스(NexyFlow, NexyWise)에서 호출하는 통합 가입 API.
 * - 신규 유저: 계정 생성 + 서비스 태그
 * - 기존 유저: 비밀번호 검증 → 서비스 추가 (크로스 가입)
 * - OAuth 전용 계정: 비밀번호 설정 + 서비스 추가
 *
 * Headers:
 *   x-service-secret: CROSS_SERVICE_SECRET
 *
 * Body:
 *   { email, password, name?, service, language?, country?, timezone?, company? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const VALID_SERVICES = ['nexyfab', 'nexyflow', 'nexywise', 'nexysys'];

function verifyServiceSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-service-secret');
  const expected = process.env.CROSS_SERVICE_SECRET;
  if (!expected) return false;
  return secret === expected;
}

const signupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string()
    .min(10)
    .regex(/[A-Z]/, 'Uppercase letter required')
    .regex(/[0-9]/, 'Number required')
    .regex(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/, 'Special character required'),
  name: z.string().min(1).max(100).optional(),
  service: z.string().min(1).max(50),
  language: z.string().max(5).optional(),
  country: z.string().max(5).optional(),
  timezone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  if (!verifyServiceSecret(req)) {
    return NextResponse.json({ error: 'Invalid service secret' }, { status: 403 });
  }

  const parsed = signupSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const { email, password, name, service, language, country, timezone, company } = parsed.data;
  if (!VALID_SERVICES.includes(service)) {
    return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
  }

  const db = getDbAdapter();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const now = Date.now();
  const displayName = name || email.split('@')[0];
  const passwordHash = await bcrypt.hash(password, 12);

  // 기존 유저 확인
  const existing = await db.queryOne<{ id: string; services: string; password_hash: string | null; email: string; plan: string }>(
    'SELECT id, services, password_hash, email, plan FROM nf_users WHERE email = ?', email,
  );

  if (existing) {
    // 기존 계정 — 서비스 추가
    if (existing.password_hash) {
      const match = await bcrypt.compare(password, existing.password_hash);
      if (!match) {
        return NextResponse.json({
          error: 'Account exists. Use existing password to link.',
          code: 'PASSWORD_MISMATCH',
        }, { status: 409 });
      }
    } else {
      // OAuth 전용 → 비밀번호 설정
      await db.execute('UPDATE nf_users SET password_hash = ? WHERE id = ?', passwordHash, existing.id);
    }

    const services: string[] = JSON.parse(existing.services || '[]');
    if (!services.includes(service)) {
      services.push(service);
      const planCol = `${service}_plan`;
      await db.execute(
        `UPDATE nf_users SET services = ?, ${planCol} = COALESCE(${planCol}, 'free'), updated_at = ? WHERE id = ?`,
        JSON.stringify(services), now, existing.id,
      );
    }

    const accessToken = await signJWT(
      { sub: existing.id, email, plan: existing.plan, emailVerified: true, service },
      15 * 60,
    );

    return NextResponse.json({
      user: { id: existing.id, email, name: displayName, plan: existing.plan, emailVerified: true },
      accessToken,
      services,
      linked: true,
      message: `${service} 서비스가 연결되었습니다.`,
    });
  }

  // 신규 유저 생성
  const userId = `u-${crypto.randomUUID()}`;
  const planCol = `${service}_plan`;

  await db.execute(
    `INSERT INTO nf_users (id, email, name, password_hash, plan, email_verified, project_count, created_at,
      signup_source, language, country, timezone, company,
      last_login_at, login_count, signup_ip, last_login_ip,
      services, signup_service, ${planCol}, updated_at)
     VALUES (?, ?, ?, ?, 'free', 0, 0, ?,
      ?, ?, ?, ?, ?,
      ?, 1, ?, ?,
      ?, ?, 'free', ?)`,
    userId, email, displayName, passwordHash, now,
    service, language || 'en', country || null, timezone || null, company || null,
    now, ip, ip,
    JSON.stringify([service]), service, now,
  );

  // Refresh token 발급
  const rawRefresh = randomBytes(40).toString('hex');
  const refreshHash = createHash('sha256').update(rawRefresh).digest('hex');
  await db.execute(
    `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    `rt-${crypto.randomUUID()}`, userId, refreshHash, now + 30 * 24 * 3600_000, now,
  );

  const accessToken = await signJWT(
    { sub: userId, email, plan: 'free', emailVerified: false, service },
    15 * 60,
  );

  return NextResponse.json({
    user: { id: userId, email, name: displayName, plan: 'free', emailVerified: false },
    accessToken,
    refreshToken: rawRefresh,
    services: [service],
    linked: false,
  }, { status: 201 });
}
