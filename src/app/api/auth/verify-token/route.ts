/**
 * POST /api/auth/verify-token
 *
 * 다른 서비스에서 JWT 유효성 + 유저 정보 조회.
 * NexyFlow/NexyWise가 자체적으로 JWT를 검증할 수 없는 경우(JWT_SECRET 없을 때) 사용.
 * 일반적으로는 JWT_SECRET 공유로 각 서비스에서 직접 검증하고, 이 API는 유저 상세정보가 필요할 때 사용.
 *
 * Headers:
 *   x-service-secret: CROSS_SERVICE_SECRET
 *
 * Body:
 *   { token } — 검증할 JWT
 *
 * Response:
 *   { valid, user: { id, email, name, plan, services, avatarUrl, ... } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/jwt';
import { getDbAdapter, toBool } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

function verifyServiceSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-service-secret');
  const expected = process.env.CROSS_SERVICE_SECRET;
  if (!expected) return false;
  return secret === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyServiceSecret(req)) {
    return NextResponse.json({ error: 'Invalid service secret' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { token?: string };
  if (!body.token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 });
  }

  const payload = await verifyJWT(body.token);
  if (!payload) {
    return NextResponse.json({ valid: false, error: 'Invalid or expired token' }, { status: 401 });
  }

  // DB에서 최신 유저 정보 조회
  const db = getDbAdapter();
  const user = await db.queryOne<{
    id: string; email: string; name: string; plan: string; role: string;
    email_verified: number; avatar_url: string | null;
    services: string; signup_service: string | null;
    nexyfab_plan: string | null; nexyflow_plan: string | null;
    language: string | null; country: string | null;
    company: string | null; job_title: string | null;
  }>(
    `SELECT id, email, name, plan, role, email_verified, avatar_url,
            services, signup_service, nexyfab_plan, nexyflow_plan,
            language, country, company, job_title
     FROM nf_users WHERE id = ?`,
    payload.sub,
  );

  if (!user) {
    return NextResponse.json({ valid: false, error: 'User not found' }, { status: 404 });
  }

  const services: string[] = JSON.parse(user.services || '[]');

  return NextResponse.json({
    valid: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      role: user.role,
      emailVerified: toBool(user.email_verified),
      avatarUrl: user.avatar_url,
      services,
      signupService: user.signup_service,
      nexyfabPlan: user.nexyfab_plan,
      nexyflowPlan: user.nexyflow_plan,
      language: user.language,
      country: user.country,
      company: user.company,
      jobTitle: user.job_title,
    },
    tokenService: payload.service ?? null,
  });
}
