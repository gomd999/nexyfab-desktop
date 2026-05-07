import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const { newEmail, confirmEmail, password } = body as {
      newEmail?: string;
      confirmEmail?: string;
      password?: string;
    };

    if (!newEmail || !confirmEmail || !password) {
      return NextResponse.json({ error: '모든 필드를 입력해주세요.' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return NextResponse.json({ error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 });
    }

    if (newEmail !== confirmEmail) {
      return NextResponse.json({ error: '이메일 주소가 일치하지 않습니다.' }, { status: 400 });
    }

    if (newEmail.toLowerCase() === authUser.email.toLowerCase()) {
      return NextResponse.json({ error: '현재 이메일과 동일합니다.' }, { status: 400 });
    }

    const db = getDbAdapter();

    // Verify current password
    const dbUser = await db.queryOne<{ password_hash: string | null }>(
      'SELECT password_hash FROM nf_users WHERE id = ?',
      authUser.userId,
    );
    if (!dbUser?.password_hash) {
      return NextResponse.json({ error: '소셜 로그인 계정은 이메일을 변경할 수 없습니다.' }, { status: 400 });
    }
    const passwordOk = await bcrypt.compare(password, dbUser.password_hash);
    if (!passwordOk) {
      return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    // Check new email not already taken
    const existing = await db.queryOne<{ id: string }>(
      'SELECT id FROM nf_users WHERE email = ?',
      newEmail.toLowerCase(),
    );
    if (existing) {
      return NextResponse.json({ error: '이미 사용 중인 이메일입니다.' }, { status: 409 });
    }

    // Invalidate any previous pending tokens for this user
    await db.execute(
      'UPDATE nf_email_change_tokens SET used = 1 WHERE user_id = ? AND used = 0',
      authUser.userId,
    );

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h

    await db.execute(
      'INSERT INTO nf_email_change_tokens (id, user_id, new_email, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      tokenId,
      authUser.userId,
      newEmail.toLowerCase(),
      tokenHash,
      expiresAt,
      Date.now(),
    );

    // Send verification email
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nexyfab.com';
    const verifyUrl = `${base}/api/auth/verify-email-change?token=${rawToken}`;

    await sendEmail({
      to: newEmail,
      subject: '[NexyFab] 이메일 주소 변경 인증',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>이메일 주소 변경 인증</h2>
          <p>아래 버튼을 클릭하면 NexyFab 계정의 이메일 주소가 <strong>${newEmail}</strong>으로 변경됩니다.</p>
          <p>이 링크는 <strong>24시간</strong> 후 만료됩니다.</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">이메일 변경 확인</a>
          <p style="color:#888;font-size:12px">본인이 요청하지 않은 경우 이 메일을 무시하세요.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true, message: '인증 이메일을 발송했습니다.' });
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
