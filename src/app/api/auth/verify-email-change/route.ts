import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// GET /api/auth/verify-email-change?token=<rawToken>
// Completes the email change after the user clicks the link in their inbox.
export async function GET(req: NextRequest) {
  const rawToken = req.nextUrl.searchParams.get('token');
  if (!rawToken) {
    return new NextResponse('token 파라미터가 필요합니다.', { status: 400 });
  }

  const db = getDbAdapter();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await db.queryOne<{
    id: string;
    user_id: string;
    new_email: string;
    expires_at: number;
    used: number;
  }>(
    'SELECT id, user_id, new_email, expires_at, used FROM nf_email_change_tokens WHERE token_hash = ?',
    tokenHash,
  );

  if (!record) {
    return redirectResult('error', '유효하지 않은 링크입니다.');
  }
  if (record.used) {
    return redirectResult('error', '이미 사용된 링크입니다.');
  }
  if (Date.now() > record.expires_at) {
    return redirectResult('error', '만료된 링크입니다. 다시 시도해주세요.');
  }

  // Check new email still not taken (race condition guard)
  const conflict = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_users WHERE email = ?',
    record.new_email,
  );
  if (conflict) {
    return redirectResult('error', '이미 사용 중인 이메일입니다.');
  }

  // Apply the change atomically
  await db.transaction(async (tx) => {
    await tx.execute(
      'UPDATE nf_users SET email = ? WHERE id = ?',
      record.new_email,
      record.user_id,
    );
    await tx.execute(
      'UPDATE nf_email_change_tokens SET used = 1 WHERE id = ?',
      record.id,
    );
  });

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nexyfab.com';
  return NextResponse.redirect(`${base}/account?emailChanged=1`);
}

function redirectResult(type: 'error', message: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nexyfab.com';
  const url = new URL(`${base}/account`);
  url.searchParams.set('emailChangeError', message);
  return NextResponse.redirect(url.toString());
}
