import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimitAsync } from '@/lib/rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getTrustedClientIp } from '@/lib/client-ip';
import { clearAuthCookies } from '@/lib/cookie-config';
import { deleteNexyfabAccountData } from '@/lib/deleteAccountData';

export const dynamic = 'force-dynamic';

// DELETE /api/auth/account — 계정 삭제 (GDPR 대응)
export async function DELETE(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`delete-account:${authUser.userId}:${ip}`, 3, 60_000)).allowed) {
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

  // Apply the same transactional erasure policy as /api/auth/delete-account.
  await db.transaction(async transaction => {
    await deleteNexyfabAccountData(transaction, user.id);
  });

  const response = NextResponse.json({ ok: true, message: 'Account deleted' });
  // 쿠키 삭제
  clearAuthCookies(response);
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
