/**
 * GET /api/auth/admin-otp/status — 이 세션이 상승돼 있나 (260802).
 *
 * 관리자 화면이 **코드 입력 창을 띄울지** 정하는 데 쓴다.
 * ⚠ 이 응답을 권한 판정으로 쓰지 않는다 — 판정은 서버가 각 API 에서 한다.
 *   클라이언트가 `elevated: true` 를 흉내 내도 API 는 여전히 막힌다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { readAccessToken, elevationRemainingMs, isAdminOtpRequired } from '@/lib/admin-elevation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const isAdmin = user.globalRole === 'super_admin';
  if (!isAdmin) return NextResponse.json({ ok: true, admin: false, required: false, elevated: false });

  const required = isAdminOtpRequired();
  if (!required) return NextResponse.json({ ok: true, admin: true, required: false, elevated: true });

  const left = await elevationRemainingMs(user.userId, readAccessToken(req));
  return NextResponse.json({
    ok: true, admin: true, required: true,
    elevated: left != null,
    ...(left != null ? { remainingMs: left } : {}),
    email: maskEmail(user.email),
  });
}

function maskEmail(email: string): string {
  const [id, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${id.slice(0, 1)}${'*'.repeat(Math.max(1, id.length - 1))}@${domain}`;
}
