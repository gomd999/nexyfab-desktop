/**
 * POST /api/auth/change-password — **로그인한 채로 비밀번호를 바꾼다** (260802 신설).
 *
 * ## 왜 없었나 — 실측
 * 비밀번호를 바꾸려면 **로그아웃 → 비밀번호 찾기 → 메일 수신**을 거쳐야 했다.
 * 유출이 의심될 때 **즉시 바꿀 수단이 없다.** 그 순간 필요한 것은 링크가 아니라 버튼이다.
 *
 * ## 규약
 * 1. **현재 비밀번호를 확인한다** — 자리를 비운 브라우저에서 남이 바꾸지 못하게.
 * 2. **바꾸면 다른 세션을 전부 끊는다.** 유출 대응이 목적인데 기존 세션이 살아 있으면
 *    바꾸는 의미가 없다. ⚠ **지금 이 세션은 유지**한다 — 자기 자신을 튕겨 내면
 *    사용자는 성공했는지 모른다.
 * 3. 결과를 **이메일로 알린다.** 본인이 아니면 그때 알아야 한다.
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { refreshTokenCookie } from '@/lib/cookie-config';

export const dynamic = 'force-dynamic';

/** 최소 길이. 회원가입과 **같은 기준**이어야 한다 — 다르면 여기가 우회로가 된다. */
const MIN_LEN = 8;

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ip = getTrustedClientIp(req.headers);
  // 현재 비밀번호 추측을 막는다 — 로그인과 같은 성격의 시도다.
  if (!(await rateLimitAsync(`change-password:${user.userId}:${ip}`, 10, 3_600_000)).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string };
  const current = String(body.currentPassword ?? '');
  const next = String(body.newPassword ?? '');
  if (!current || !next) return NextResponse.json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력하세요.' }, { status: 400 });
  if (next.length < MIN_LEN) return NextResponse.json({ error: `새 비밀번호는 ${MIN_LEN}자 이상이어야 합니다.` }, { status: 400 });
  if (next === current) return NextResponse.json({ error: '현재 비밀번호와 다른 값을 입력하세요.' }, { status: 400 });

  const db = getDbAdapter();
  const row = await db.queryOne<{ password_hash: string | null; email: string; name: string | null }>(
    'SELECT password_hash, email, name FROM nf_users WHERE id = ?', user.userId,
  );
  if (!row?.password_hash) {
    // SSO 전용 계정 — 여기서 비밀번호를 만들어 주면 SSO 우회로가 생긴다.
    return NextResponse.json({ error: '비밀번호가 설정되지 않은 계정입니다(SSO). 제공자에서 변경하세요.' }, { status: 400 });
  }
  if (!(await bcrypt.compare(current, row.password_hash))) {
    logAudit({ userId: user.userId, action: 'auth.change_password_failed', resourceId: user.userId, ip });
    return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 401 });
  }

  const hash = await bcrypt.hash(next, 12);
  await db.execute('UPDATE nf_users SET password_hash = ? WHERE id = ?', hash, user.userId);

  /**
   * 다른 세션을 전부 끊는다.
   * ⚠ 전부 폐기한 **뒤에 이 세션의 리프레시를 새로 발급**한다 — 순서를 뒤집으면
   *   방금 만든 것까지 지워져 사용자가 15분 뒤 튕긴다.
   */
  await db.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE', user.userId);

  const rawRefresh = randomBytes(40).toString('hex');
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at, user_agent, ip, last_used_at)
     VALUES (?, ?, ?, ?, FALSE, ?, ?, ?, ?)`,
    `rt-${crypto.randomUUID()}`, user.userId,
    createHash('sha256').update(rawRefresh).digest('hex'),
    now + 30 * 24 * 3600 * 1000, now,
    (req.headers.get('user-agent') ?? '').slice(0, 300), ip, now,
  );

  logAudit({ userId: user.userId, action: 'auth.change_password', resourceId: user.userId, ip });

  // ⚠ 알림 실패가 비밀번호 변경을 되돌리지 않는다 — 이미 바뀌었다. 실패는 로그로만 남긴다.
  sendEmail({
    to: row.email,
    subject: '[NexyFab] 비밀번호가 변경되었습니다',
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">`
      + `<h2 style="margin:0 0 8px">비밀번호가 변경되었습니다</h2>`
      + `<p style="color:#475569">${new Date(now).toISOString()} · IP ${ip}</p>`
      + `<p><b>본인이 변경하지 않았다면 즉시 비밀번호를 재설정하고 고객센터에 알려 주세요.</b></p>`
      + `<p style="color:#64748b;font-size:13px">보안을 위해 다른 기기의 로그인은 모두 해제되었습니다.</p></div>`,
    text: `비밀번호가 변경되었습니다 (${new Date(now).toISOString()}, IP ${ip}). 본인이 아니라면 즉시 재설정하세요.`,
  }).catch((e) => console.error('[change-password] 알림 메일 실패:', e));

  const res = NextResponse.json({
    ok: true,
    otherSessionsRevoked: true,
    // 액세스 토큰은 stateless 라 즉시 못 끊는다 — 숨기지 않는다.
    accessTokenResidualSec: 15 * 60,
    note: '다른 기기의 로그인을 해제했습니다. 이미 발급된 액세스 토큰은 최대 15분간 유효합니다.',
  });
  const c = refreshTokenCookie(rawRefresh);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
