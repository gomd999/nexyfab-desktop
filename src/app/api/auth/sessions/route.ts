/**
 * /api/auth/sessions — **어디서 로그인돼 있는지 보고, 끊는다** (260802 신설).
 *
 * ## 왜 없었나
 * 리프레시 토큰 테이블은 이미 있었지만 **사용자가 볼 방법이 없었다.**
 * 계정이 털렸는지 확인할 수단도, 남의 기기를 끊을 수단도 없었다.
 *
 * ## ⚠ 「세션」은 리프레시 토큰이다 — 그 사실을 숨기지 않는다
 * 액세스 토큰은 stateless(15분)라 목록에 없고 즉시 폐기할 수도 없다.
 * 그래서 「끊었다」는 **최대 15분 뒤부터 확실**하다. 응답에 그대로 적는다.
 *
 * ## ⚠ 기기 정보는 **자기신고**다
 * `user_agent` 는 브라우저가 보내는 문자열이라 위조할 수 있다.
 * 「이 기기가 확실히 무엇이다」가 아니라 **「그 세션이 그렇게 밝혔다」**로 표시해야 한다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getTrustedClientIp } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** 현재 요청의 리프레시 토큰 해시 — 「이 기기」를 표시하는 데 쓴다. */
function currentHash(req: NextRequest): string | null {
  const raw = req.cookies.get('nf_refresh_token')?.value;
  return raw ? createHash('sha256').update(raw).digest('hex') : null;
}

/** GET — 활성 세션 목록. */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const rows = await db.queryAll<{
    id: string; token_hash: string; created_at: number; expires_at: number;
    user_agent: string | null; ip: string | null; last_used_at: number | null;
  }>(
    `SELECT id, token_hash, created_at, expires_at, user_agent, ip, last_used_at
       FROM nf_refresh_tokens
      WHERE user_id = ? AND revoked = FALSE AND expires_at > ?
      ORDER BY created_at DESC`,
    user.userId, Date.now(),
  );
  const cur = currentHash(req);
  return NextResponse.json({
    sessions: rows.map((r) => ({
      id: r.id,
      current: !!cur && r.token_hash === cur,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      lastUsedAt: r.last_used_at,
      // ⚠ 자기신고 값이다 — 화면에서도 「기기(자기신고)」로 표시해야 한다.
      userAgent: r.user_agent ?? null,
      ip: r.ip ?? null,
    })),
    note: '세션은 리프레시 토큰 기준입니다. 이미 발급된 액세스 토큰은 최대 15분간 유효합니다.',
    deviceInfoIsSelfReported: true,
  });
}

/**
 * DELETE — 세션 폐기.
 *  · `?id=…`  그 세션만
 *  · `?all=1` **현재 세션을 제외한 전부** (자기 자신을 튕겨 내면 성공을 확인할 수 없다)
 */
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const id = req.nextUrl.searchParams.get('id');
  const all = req.nextUrl.searchParams.get('all');
  const ip = getTrustedClientIp(req.headers);

  if (all === '1') {
    const cur = currentHash(req);
    if (cur) {
      await db.execute(
        'UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE AND token_hash <> ?',
        user.userId, cur,
      );
    } else {
      // 현재 세션을 식별할 수 없다 — 전부 끊는다(안전한 쪽).
      await db.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE', user.userId);
    }
    logAudit({ userId: user.userId, action: 'auth.sessions_revoke_all', resourceId: user.userId, ip });
    return NextResponse.json({
      ok: true, scope: cur ? 'others' : 'all',
      accessTokenResidualSec: 15 * 60,
      note: cur ? '현재 기기를 제외한 모든 세션을 해제했습니다.' : '현재 세션을 식별할 수 없어 모든 세션을 해제했습니다.',
    });
  }

  if (!id) return NextResponse.json({ error: 'id 또는 all=1 이 필요합니다.' }, { status: 400 });

  const row = await db.queryOne<{ id: string; user_id: string; revoked: number | boolean }>(
    'SELECT id, user_id, revoked FROM nf_refresh_tokens WHERE id = ?', id,
  );
  // ⚠ 남의 세션 id 를 넣어도 **존재 여부를 알려 주지 않는다** — 404 로 통일한다.
  if (!row || row.user_id !== user.userId) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (row.revoked === 1 || row.revoked === true) {
    // 「방금 끊었다」와 「이미 끊겨 있었다」는 다르다.
    return NextResponse.json({ ok: true, alreadyRevoked: true, id });
  }

  await db.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE id = ?', id);
  logAudit({ userId: user.userId, action: 'auth.session_revoke', resourceId: id, ip });
  return NextResponse.json({ ok: true, id, accessTokenResidualSec: 15 * 60 });
}
