import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/nexyfab-email';
import { rateLimit } from '@/lib/rate-limit';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const RESET_TOKEN_TTL = 15 * 60 * 1000; // 15분
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!rateLimit(`forgot-pw:${ip}`, 3, 60_000).allowed) {
    return NextResponse.json({ ok: true }); // 열거 공격 방지: 항상 200 반환
  }

  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ email: z.string().email() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true }); // 이메일 존재 여부 노출 방지
  }

  const { email } = parsed.data;
  const db = getDbAdapter();

  const user = await db.queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM nf_users WHERE email = ?',
    email,
  );

  if (!user) {
    return NextResponse.json({ ok: true }); // 사용자 없어도 동일 응답
  }

  // 기존 미사용 토큰 무효화
  await db.execute(
    'UPDATE nf_password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
    user.id,
  );

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    `prt-${crypto.randomUUID()}`, user.id, tokenHash, now + RESET_TOKEN_TTL, now,
  );

  const resetUrl = `${SITE_URL}/auth/reset-password?token=${rawToken}`;

  sendEmail(
    email,
    '[NexyFab] 비밀번호 재설정',
    `<div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;background:#0d1117;color:#e6edf3;border-radius:12px">
      <h2 style="color:#388bfd;margin-bottom:16px">비밀번호 재설정</h2>
      <p>안녕하세요, ${user.name}님.</p>
      <p>아래 버튼을 클릭하면 비밀번호를 재설정할 수 있습니다. 링크는 15분 후 만료됩니다.</p>
      <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#388bfd;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">비밀번호 재설정</a>
      <p style="font-size:12px;color:#6e7681">이 요청을 하지 않으셨다면 무시해 주세요.</p>
    </div>`,
  ).catch(err => console.error('[forgot-password] email failed:', err));

  return NextResponse.json({ ok: true });
}
