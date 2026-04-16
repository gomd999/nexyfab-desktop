import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';

const schema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
  userId: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '올바른 6자리 코드를 입력하세요.' }, { status: 400 });
  }
  const { code, userId } = parsed.data;

  // Rate limit: IP × userId 조합으로 브루트포스 차단 (5회/15분)
  if (!rateLimit(`verify-email:${ip}:${userId}`, 5, 15 * 60_000).allowed) {
    return NextResponse.json({ error: '시도 횟수 초과. 15분 후 다시 시도하세요.' }, { status: 429 });
  }

  const db = getDbAdapter();
  const entry = await db.queryOne<{ code: string; user_id: string; email: string; expires_at: number }>(
    'SELECT * FROM nf_verification_codes WHERE user_id = ?',
    userId,
  );

  if (!entry) {
    return NextResponse.json({ error: '인증 코드를 찾을 수 없습니다. 재발송해 주세요.' }, { status: 404 });
  }

  if (Date.now() > entry.expires_at) {
    await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', userId);
    return NextResponse.json({ error: '인증 코드가 만료되었습니다. 재발송해 주세요.' }, { status: 410 });
  }

  if (!timingSafeEqual(Buffer.from(entry.code), Buffer.from(code))) {
    return NextResponse.json({ error: '인증 코드가 올바르지 않습니다.' }, { status: 400 });
  }

  await db.execute('UPDATE nf_users SET email_verified = 1 WHERE id = ?', userId);
  await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', userId);

  try {
    await db.execute('DELETE FROM nf_verification_codes WHERE expires_at < ?', Date.now());
  } catch { /* 정리 실패는 무시 */ }

  return NextResponse.json({ verified: true });
}
