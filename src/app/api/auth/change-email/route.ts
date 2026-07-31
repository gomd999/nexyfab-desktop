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
      'UPDATE nf_email_change_tokens SET used = TRUE WHERE user_id = ? AND used = FALSE',
      authUser.userId,
    );

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h

    await db.execute(
      'INSERT INTO nf_email_change_tokens (id, user_id, new_email, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, FALSE, ?)',
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

    /**
     * ⚠ 260802: **이전 주소에도 알린다.**
     *
     * 계정 탈취의 전형적 수순이 **이메일부터 바꾸는 것**이다. 새 주소로만 인증 메일을
     * 보내면 원래 주인은 **바뀌는 줄도 모른다** — 알림을 받아야 되돌릴 기회가 생긴다.
     *
     * ⚠ 알림 실패가 요청을 되돌리지 않는다(토큰은 이미 발급됐다). 실패는 로그로 남긴다.
     * ⚠ 이 메일에는 **인증 링크를 넣지 않는다** — 이전 주소가 이미 탈취됐다면
     *   링크를 그쪽에 보내는 것은 공격자에게 열쇠를 하나 더 주는 셈이다.
     */
    try {
      const cur = await db.queryOne<{ email: string }>('SELECT email FROM nf_users WHERE id = ?', authUser.userId);
      if (cur?.email && cur.email.toLowerCase() !== newEmail.toLowerCase()) {
        sendEmail({
          to: cur.email,
          subject: '[NexyFab] 이메일 주소 변경이 요청되었습니다',
          html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>이메일 주소 변경 요청</h2>
          <p>계정의 이메일을 <strong>${newEmail}</strong> 로 변경하는 요청이 접수되었습니다.</p>
          <p style="color:#475569">${new Date().toISOString()}</p>
          <p><b>본인이 요청하지 않았다면 지금 바로 비밀번호를 변경하고 다른 기기의 로그인을 해제하세요.</b></p>
          <p style="color:#888;font-size:12px">이 메일에는 변경 링크가 없습니다 — 변경은 새 주소에서만 확인할 수 있습니다.</p>
        </div>
      `,
          text: `계정 이메일을 ${newEmail} 로 변경하는 요청이 접수되었습니다. 본인이 아니라면 즉시 비밀번호를 변경하세요.`,
        }).catch((e) => console.error('[change-email] 이전 주소 통지 실패:', e));
      }
    } catch (e) {
      console.error('[change-email] 이전 주소 조회 실패(요청은 유효):', e);
    }

    return NextResponse.json({ ok: true, message: '인증 이메일을 발송했습니다. 기존 주소로도 알림을 보냈습니다.' });
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
