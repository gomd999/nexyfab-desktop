import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

// DELETE /api/auth/account — 계정 삭제 (GDPR 대응)
export async function DELETE(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`delete-account:${ip}`, 3, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = z.object({
    password: z.string().min(1),
    confirm: z.literal('DELETE MY ACCOUNT'),
  }).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please provide your password and type "DELETE MY ACCOUNT" to confirm' },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const user = await db.queryOne<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM nf_users WHERE id = ?',
    authUser.userId,
  );

  if (!user?.password_hash) {
    return NextResponse.json({ error: 'Cannot delete account' }, { status: 400 });
  }

  const passwordMatch = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!passwordMatch) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  // Cascade delete (FK ON DELETE CASCADE 가 설정되어 있지만 명시적으로도 처리)
  await db.execute('DELETE FROM nf_refresh_tokens WHERE user_id = ?', user.id);
  await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', user.id);
  await db.execute('DELETE FROM nf_password_reset_tokens WHERE user_id = ?', user.id);
  await db.execute('DELETE FROM nf_collab_sessions WHERE user_id = ?', user.id);
  // 프로젝트와 RFQ는 CASCADE로 처리
  await db.execute('DELETE FROM nf_users WHERE id = ?', user.id);

  const response = NextResponse.json({ ok: true, message: 'Account deleted' });
  // 쿠키 삭제
  response.cookies.set('nf_refresh_token', '', { maxAge: 0, path: '/api/auth' });
  return response;
}

// GET /api/auth/account — 내 계정 정보
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const user = await db.queryOne<{
    id: string; email: string; name: string; plan: string;
    email_verified: number | boolean; project_count: number; created_at: number;
  }>(
    'SELECT id, email, name, plan, email_verified, project_count, created_at FROM nf_users WHERE id = ?',
    authUser.userId,
  );

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    emailVerified: toBool(user.email_verified),
    projectCount: user.project_count,
    createdAt: user.created_at,
  });
}
