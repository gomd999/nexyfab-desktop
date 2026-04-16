import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import { createHash } from 'crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`reset-pw:${ip}`, 5, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = z.object({
    token: z.string().min(1),
    password: z.string().min(8).regex(/[0-9]/, 'Password must contain at least one number'),
  }).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const { token: rawToken, password } = parsed.data;
  const db = getDbAdapter();
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const row = await db.queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM nf_password_reset_tokens
     WHERE token_hash = ? AND used = 0 AND expires_at > ?`,
    tokenHash, Date.now(),
  );

  if (!row) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // 비밀번호 업데이트 + 토큰 삭제 + 잠금 해제 + refresh 무효화를 atomic하게 처리
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE nf_users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', passwordHash, row.user_id);
    await tx.execute('DELETE FROM nf_password_reset_tokens WHERE id = ?', row.id);
    await tx.execute('UPDATE nf_refresh_tokens SET revoked = 1 WHERE user_id = ?', row.user_id);
  });

  return NextResponse.json({ ok: true });
}
