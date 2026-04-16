import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { refreshToken?: string };
    const rawToken = body.refreshToken;
    if (!rawToken) {
      return NextResponse.json({ ok: true }); // 이미 로그아웃된 상태
    }

    const db = getDbAdapter();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await db.execute('UPDATE nf_refresh_tokens SET revoked = 1 WHERE token_hash = ?', tokenHash);

    const response = NextResponse.json({ ok: true });
    response.cookies.set('nf_refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/api/auth',
    });
    response.cookies.set('nf_access_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
