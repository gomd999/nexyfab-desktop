import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { logError } from '@/app/lib/errorLog';
import { checkOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { getDbAdapter } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { grantRole } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

// POST /api/partner/auth — 로그인 (email + token)
export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`partner-auth:${ip}`, 5, 60_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  let email: string, token: string;
  try {
    ({ email, token } = await req.json() as { email: string; token: string });
  } catch (err) {
    logError('파트너 인증 요청 파싱 실패', err instanceof Error ? err : undefined, { url: '/api/partner/auth' });
    return NextResponse.json({ error: '요청 데이터가 올바르지 않습니다.' }, { status: 400 });
  }
  if (!email || !token) {
    return NextResponse.json({ error: 'email과 token이 필요합니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const tokenHash = createHash('sha256').update(String(token)).digest('hex');

  // Find valid, unused token in DB
  const tokenRow = await db.queryOne<{
    id: string; partner_id: string; email: string; company: string; expires_at: number; used: number;
  }>(
    `SELECT id, partner_id, email, company, expires_at, used
     FROM nf_partner_tokens
     WHERE token_hash = ? AND LOWER(email) = LOWER(?) AND used = 0 AND expires_at > ?`,
    tokenHash, email, Date.now(),
  ).catch(() => null);

  if (!tokenRow) {
    return NextResponse.json({ error: '유효하지 않거나 만료된 코드입니다.' }, { status: 401 });
  }

  // Mark token as used
  await db.execute('UPDATE nf_partner_tokens SET used = 1 WHERE id = ?', tokenRow.id).catch(() => {});

  const company = tokenRow.company;

  // Upsert nf_users
  let userId: string;
  const existingUser = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_users WHERE LOWER(email) = LOWER(?)', email,
  ).catch(() => null);

  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO nf_users (id, email, name, password_hash, plan, email_verified, project_count, created_at, role)
       VALUES (?, ?, ?, NULL, 'free', 1, 0, ?, 'user')`,
      userId, email.toLowerCase(), company || email.split('@')[0], Date.now(),
    ).catch(() => {});
  }

  // Grant nexyfab:partner role (idempotent)
  await grantRole(userId, 'nexyfab', 'partner').catch(() => {});

  // Issue JWT
  const { SERVICE_NAME } = await import('@/lib/service-config');
  const jwt = await signJWT({ sub: userId, email, plan: 'free', service: SERVICE_NAME }, 7 * 24 * 3600);

  // Legacy opaque session token (partner dashboard still uses this for /api/partner/auth?session=xxx)
  const sessionToken = randomBytes(32).toString('hex');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const sessionId = `PS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await db.execute(
    `INSERT INTO nf_partner_sessions (id, session_hash, partner_id, user_id, email, company, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId, sessionHash, tokenRow.partner_id, userId, email.toLowerCase(), company, expiresAt, Date.now(),
  ).catch(() => {});

  const response = NextResponse.json({
    sessionToken,
    token: jwt,
    partner: { partnerId: tokenRow.partner_id, userId, email: tokenRow.email, company },
  });

  response.cookies.set('nf_access_token', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600,
  });

  return response;
}

// GET /api/partner/auth?session=xxx — session validity check
export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get('session');
  if (!session) {
    return NextResponse.json({ valid: false });
  }

  const db = getDbAdapter();
  const sessionHash = createHash('sha256').update(session).digest('hex');

  const row = await db.queryOne<{
    partner_id: string; user_id: string | null; email: string; company: string; expires_at: number;
  }>(
    'SELECT partner_id, user_id, email, company, expires_at FROM nf_partner_sessions WHERE session_hash = ?',
    sessionHash,
  ).catch(() => null);

  if (!row || row.expires_at <= Date.now()) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({
    valid: true,
    partner: {
      partnerId: row.partner_id,
      userId: row.user_id,
      email: row.email,
      company: row.company,
    },
  });
}
