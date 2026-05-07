import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, welcomeHtml } from '@/lib/nexyfab-email';
import { getDbAdapter } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { rateLimit } from '@/lib/rate-limit';
import { checkOrigin } from '@/lib/csrf';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { SERVICE_NAME } from '@/lib/service-config';
import { accessTokenCookie, refreshTokenCookie } from '@/lib/cookie-config';
import { tryClaimDemoOnAuth } from '@/lib/demo-session';
import { parseUserStageColumn } from '@/lib/stage-engine';
import { getTrustedClientIp } from '@/lib/client-ip';

const AUTH_URL = process.env.NEXYSYS_AUTH_URL || '';
const ALLOWED_LANGS = new Set(['ko', 'en', 'ja', 'zh']);

export async function POST(req: NextRequest) {
  // CSRF origin check
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit: 5 requests/minute per IP
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`signup:${ip}`, 5, 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const body = await req.json() as { email?: string; password?: string; name?: string; language?: string; country?: string; timezone?: string; company?: string };

  if (!AUTH_URL) {
    const signupSchema = z.object({
      email: z.string().email('Invalid email format').max(255),
      password: z.string()
        .min(10, 'Password must be at least 10 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number')
        .regex(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/, 'Password must contain at least one special character'),
      name: z.string().min(1).max(100).optional(),
    });

    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { email, password, name } = parsed.data;

    const db = getDbAdapter();

    // Check duplicate email
    const existing = await db.queryOne('SELECT id FROM nf_users WHERE email = ?', email);
    if (existing) {
      return NextResponse.json({ error: '이미 사용 중인 이메일입니다' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const now = Date.now();
    const id = crypto.randomUUID();
    const displayName = name || email.split('@')[0];

    // Accept-Language 헤더에서 언어/국가 감지
    const acceptLang = req.headers.get('accept-language') ?? '';
    const browserLang = acceptLang.split(',')[0]?.split('-')[0] ?? '';
    const browserCountry = acceptLang.split(',')[0]?.split('-')[1]?.toUpperCase() ?? '';
    const userLang = body.language || (ALLOWED_LANGS.has(browserLang) ? browserLang : 'en');
    const userCountry = body.country || browserCountry || null;
    const userTimezone = body.timezone || null;
    const userCompany = body.company || null;

    // 이미 다른 서비스에서 가입한 이메일인지 확인 (크로스 가입)
    const existingUser = await db.queryOne<{
      id: string; services: string; password_hash: string | null; stage: string | null; plan: string;
    }>(
      'SELECT id, services, password_hash, stage, plan FROM nf_users WHERE email = ?', email,
    );

    if (existingUser) {
      // 이미 계정 존재 — nexyfab 서비스 태그 추가
      if (existingUser.password_hash) {
        // 비밀번호 있는 계정이면 비밀번호 검증 필요
        const match = await bcrypt.compare(password, existingUser.password_hash);
        if (!match) {
          return NextResponse.json({ error: '이미 사용 중인 이메일입니다. 기존 비밀번호로 로그인해 주세요.' }, { status: 409 });
        }
      } else {
        // OAuth 전용 계정 → 비밀번호 설정
        await db.execute('UPDATE nf_users SET password_hash = ? WHERE id = ?', passwordHash, existingUser.id);
      }
      // 서비스 태그 추가
      const services: string[] = JSON.parse(existingUser.services || '[]');
      if (!services.includes(SERVICE_NAME)) {
        services.push(SERVICE_NAME);
        await db.execute(
          `UPDATE nf_users SET services = ?, ${SERVICE_NAME}_plan = COALESCE(${SERVICE_NAME}_plan, 'free'), updated_at = ? WHERE id = ?`,
          JSON.stringify(services), now, existingUser.id,
        );
      }
      // 기존 계정으로 로그인 처리 — 토큰은 httpOnly 쿠키로만 전달
      const token = await signJWT({
        sub: existingUser.id,
        email,
        plan: existingUser.plan,
        emailVerified: true,
        service: SERVICE_NAME,
        nexyfabStage: parseUserStageColumn(existingUser.stage),
      });
      const linkedResponse = NextResponse.json({
        user: {
          id: existingUser.id,
          email,
          name: displayName,
          plan: existingUser.plan,
          projectCount: 0,
          emailVerified: true,
          nexyfabStage: parseUserStageColumn(existingUser.stage),
        },
        linked: true,
        message: 'NexyFab 서비스가 연결되었습니다.',
      }, { status: 200 });
      const lac = accessTokenCookie(token);
      linkedResponse.cookies.set(lac.name, lac.value, lac.options);
      // 데모 데이터 이관 — 쿠키가 있으면 기존 계정으로 합류시킨다.
      await tryClaimDemoOnAuth(req, linkedResponse, existingUser.id);
      return linkedResponse;
    }

    await db.execute(
      `INSERT INTO nf_users (id, email, name, password_hash, plan, email_verified, project_count, created_at,
        signup_source, language, country, timezone, company, last_login_at, login_count, signup_ip, last_login_ip,
        services, signup_service, ${SERVICE_NAME}_plan, updated_at,
        terms_agreed_at, privacy_agreed_at, age_confirmed)
       VALUES (?, ?, ?, ?, 'free', 0, 0, ?,
        'email', ?, ?, ?, ?, ?, 1, ?, ?,
        ?, ?, 'free', ?,
        ?, ?, 1)`,
      id, email, displayName, passwordHash, now,
      userLang, userCountry, userTimezone, userCompany, now, ip, ip,
      JSON.stringify([SERVICE_NAME]), SERVICE_NAME, now,
      now, now,
    );

    const token = await signJWT({
      sub: id,
      email,
      plan: 'free',
      emailVerified: false,
      service: SERVICE_NAME,
      nexyfabStage: 'A',
    });

    // Refresh token 발급
    const rawRefresh = randomBytes(40).toString('hex');
    const refreshHash = createHash('sha256').update(rawRefresh).digest('hex');
    const REFRESH_TTL = 30 * 24 * 3600_000; // 30일
    await db.execute(
      `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      `rt-${crypto.randomUUID()}`, id, refreshHash, now + REFRESH_TTL, now,
    );

    const user = {
      id,
      email,
      name: displayName,
      plan: 'free' as const,
      projectCount: 0,
      emailVerified: false,
      nexyfabStage: 'A' as const,
    };

    // Welcome email (fire-and-forget)
    sendEmail(
      email,
      '[NexyFab] 가입을 환영합니다! 🎉',
      welcomeHtml(displayName, 'ko'),
    ).catch(err => console.error('[signup] welcome email failed:', err));

    const response = NextResponse.json({ user }, { status: 201 });
    const src = refreshTokenCookie(rawRefresh);
    response.cookies.set(src.name, src.value, src.options);
    const sac = accessTokenCookie(token);
    response.cookies.set(sac.name, sac.value, sac.options);
    // 데모 모드에서 진입한 사용자: nf_dfm_check / nf_rfqs / nf_funnel_event
    // 의 임시 데이터를 갓 만든 user_id 로 일괄 이관 (단일 트랜잭션).
    await tryClaimDemoOnAuth(req, response, id);
    return response;
  }

  try {
    const upstream = await fetch(`${AUTH_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();

    if (upstream.status === 200 || upstream.status === 201) {
      const { email, name } = body as { email?: string; name?: string };
      if (email) {
        sendEmail(
          email,
          '[NexyFab] 가입을 환영합니다! 🎉',
          welcomeHtml(name || email.split('@')[0], 'ko'),
        ).catch(err => console.error('[signup] upstream welcome email failed:', err));
      }
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'Auth server unreachable' }, { status: 503 });
  }
}
