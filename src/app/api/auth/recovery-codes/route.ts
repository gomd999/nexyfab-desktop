/**
 * /api/auth/recovery-codes — 2FA 복구 코드 발급·잔량 조회 (260802).
 *
 * ## 왜 필요했나
 * TOTP 2FA 는 있는데 복구 수단이 없었다 — **휴대폰을 잃으면 계정에 영영 못 들어간다.**
 * 되돌릴 수 없는 잠김을 만드는 기능은 권장할 수 없다.
 *
 * ## ⚠ 발급에 비밀번호를 다시 받는다
 * 복구 코드는 **2FA 를 우회하는 수단**이다. 로그인된 세션만으로 재발급을 허용하면,
 * 잠깐 자리를 비운 브라우저에서 누군가 코드를 뽑아 갈 수 있다.
 * (재인증 = 이 순간 그 사람이 맞는지 확인)
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';
import { issueRecoveryCodes, remainingRecoveryCodes, RECOVERY_CODE_COUNT } from '@/lib/recovery-codes';

export const dynamic = 'force-dynamic';

/** GET — 남은 개수만. **코드 자체는 절대 다시 돌려주지 않는다.** */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDbAdapter();
  const row = await db.queryOne<{ totp_enabled: number | boolean | null }>(
    'SELECT totp_enabled FROM nf_users WHERE id = ?', user.userId,
  );
  const remaining = await remainingRecoveryCodes(user.userId);
  const twoFactorOn = row?.totp_enabled === 1 || row?.totp_enabled === true;
  return NextResponse.json({
    twoFactorEnabled: twoFactorOn,
    remaining,
    total: RECOVERY_CODE_COUNT,
    /**
     * ⚠ 2FA 를 켰는데 코드가 0개면 **잠길 수 있는 상태**다. 조용히 두지 않고 알린다.
     */
    ...(twoFactorOn && remaining === 0
      ? { warning: '2단계 인증이 켜져 있는데 복구 코드가 없습니다 — 기기를 잃으면 로그인할 수 없습니다. 지금 발급하세요.' }
      : {}),
  });
}

/** POST — 새 세트 발급(기존 폐기). 평문은 **이 응답에서만** 볼 수 있다. */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`recovery-issue:${user.userId}`, 5, 3_600_000).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as { password?: string };
  const password = String(body.password ?? '');
  if (!password) return NextResponse.json({ error: '비밀번호를 입력하세요.' }, { status: 400 });

  const db = getDbAdapter();
  const row = await db.queryOne<{ password_hash: string | null }>(
    'SELECT password_hash FROM nf_users WHERE id = ?', user.userId,
  );
  if (!row?.password_hash) {
    // SSO 전용 계정 — 비밀번호가 없다. 조용히 통과시키지 않는다.
    return NextResponse.json({ error: '비밀번호가 설정되지 않은 계정입니다. SSO 제공자에서 복구하세요.' }, { status: 400 });
  }
  if (!(await bcrypt.compare(password, row.password_hash))) {
    logAudit({ userId: user.userId, action: 'recovery_codes.reauth_failed', resourceId: user.userId, ip });
    return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 });
  }

  const codes = await issueRecoveryCodes(user.userId);
  logAudit({ userId: user.userId, action: 'recovery_codes.issue', resourceId: user.userId, metadata: { count: codes.length }, ip });

  return NextResponse.json({
    codes,
    count: codes.length,
    // 「다시 볼 수 없다」를 말하지 않으면 사용자는 저장하지 않는다.
    warning: '이 코드는 지금만 표시됩니다. 안전한 곳에 보관하세요. 각 코드는 한 번만 사용할 수 있습니다.',
    note: '새로 발급했으므로 이전 복구 코드는 모두 무효가 되었습니다.',
  }, { status: 201 });
}
