import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimitAsync } from '@/lib/rate-limit';
import { createHash } from 'crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_RESET_PASSWORD_BODY_BYTES = 16 * 1024;

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`reset-pw:${ip}`, 5, 60_000)).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown = {};
  try { body = await readBoundedJson(req, MAX_RESET_PASSWORD_BODY_BYTES); }
  catch (error) { if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }); }
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
  if (!(await rateLimitAsync(`reset-pw-token:${tokenHash}`, 5, 15 * 60_000)).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const row = await db.queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM nf_password_reset_tokens
     WHERE token_hash = ? AND used = FALSE AND expires_at > ?`,
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
    await tx.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ?', row.user_id);
  });

  return NextResponse.json({ ok: true });
}
