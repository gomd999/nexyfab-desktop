/**
 * /api/admin/api-keys — **관리자가 사용자 대신 API 키를 발급·조회·파기한다** (260802).
 *
 * ## 왜 필요했나 — 실측
 * 사용자 자체 발급(`/api/user/api-keys`)은 있는데 **관리자 경로가 없었다.**
 * 그래서 「Pro 계약은 했는데 키 발급을 못 하는」 고객을 운영자가 도울 방법이 없었다.
 *
 * ## ⚠ 이건 강한 권한이다 — 그래서 세 가지를 지킨다
 *
 * ### 1. step-up 인증을 이미 통과해야 한다
 * `/api/admin/*` 는 미들웨어가 상승(이메일 OTP)을 요구한다(428). 여기서 다시 만들지 않는다 —
 * 검사를 두 벌 두면 한 벌만 고쳐지는 날이 온다.
 *
 * ### 2. **누가 발급했는지 남긴다**
 * `nf_api_keys.issued_by` 에 관리자 id 를 적는다. 안 남기면 사용자는 **자기가 만들지 않은
 * 키를 자기 것으로 본다** — 사고가 나도 출처를 못 찾는다. 목록에도 그대로 노출한다.
 *
 * ### 3. 평문 키는 **한 번만**, 그리고 그 사실을 말한다
 * 발급 응답에만 싣고 저장하지 않는다(해시·접두만). 관리자가 사용자에게 전달해야 한다.
 * ⚠ 이 값이 관리자 화면에 뜬다는 것은 **관리자가 그 사용자로 행세할 수 있다**는 뜻이다.
 *   그래서 감사 로그에 대상 사용자와 발급자를 함께 남긴다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { generateApiKey } from '@/lib/api-key';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** GET ?userId=… — 그 사용자의 키 목록. **평문은 절대 돌려주지 않는다.** */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const db = getDbAdapter();
  const keys = await db.queryAll<{
    id: string; name: string; key_prefix: string; scopes: string; status: string;
    last_used_at: number | null; expires_at: number | null; created_at: number; issued_by: string | null;
  }>(
    `SELECT id, name, key_prefix, scopes, status, last_used_at, expires_at, created_at, issued_by
       FROM nf_api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    userId,
  );
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id, name: k.name, keyPrefix: k.key_prefix,
      scopes: JSON.parse(k.scopes || '[]'),
      status: k.status,
      lastUsedAt: k.last_used_at, expiresAt: k.expires_at, createdAt: k.created_at,
      // 대리 발급 여부를 **숨기지 않는다** — 사용자도 관리자도 출처를 알아야 한다.
      issuedBy: k.issued_by,
      issuedByAdmin: !!k.issued_by,
    })),
  });
}

/** POST — 대상 사용자 앞으로 키를 발급한다. */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const admin = guard.user;

  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`admin-api-key-issue:${admin.userId}`, 20, 3_600_000)).allowed) {
    return NextResponse.json({ error: '발급 요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const schema = z.object({
    userId: z.string().min(1),
    name: z.string().min(1).max(100),
    scopes: z.array(z.string()).max(20).default([]),
    ipWhitelist: z.array(z.string()).max(20).default([]),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const db = getDbAdapter();
  const target = await db.queryOne<{ id: string; email: string; plan: string }>(
    'SELECT id, email, plan FROM nf_users WHERE id = ?', parsed.data.userId,
  );
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  /**
   * ⚠ 플랜 게이트를 **여기서도 본다.** 관리자 경로라고 free 계정에 키를 주면,
   *   그 사용자는 결제 없이 API 를 쓰게 되고 그 사실이 어디에도 안 남는다.
   *   운영상 필요하면 **플랜을 먼저 올리는 것**이 옳다(그건 기록이 남는다).
   */
  if (target.plan === 'free') {
    return NextResponse.json({
      error: 'free 플랜 사용자에게는 키를 발급할 수 없습니다 — 플랜을 먼저 변경하세요.',
      hint: 'PATCH /api/admin/users { userId, plan: "pro", planExpiresAt }',
    }, { status: 400 });
  }

  const { raw: rawKey, hash: keyHash, prefix: keyPrefix } = generateApiKey();
  const id = `ak-${crypto.randomUUID()}`;
  const now = Date.now();
  const expiresAt = parsed.data.expiresInDays ? now + parsed.data.expiresInDays * 86_400_000 : null;

  await db.execute(
    `INSERT INTO nf_api_keys (id, user_id, name, key_hash, key_prefix, scopes, ip_whitelist, status, expires_at, created_at, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    id, target.id, parsed.data.name, keyHash, keyPrefix,
    JSON.stringify(parsed.data.scopes), JSON.stringify(parsed.data.ipWhitelist),
    expiresAt, now, admin.userId,
  );

  // 감사 — **대상과 발급자를 함께** 남긴다. 평문 키·해시는 절대 로깅하지 않는다.
  logAudit({
    userId: admin.userId, action: 'api_key.admin_create', resourceId: id,
    metadata: { targetUserId: target.id, targetEmail: target.email, keyPrefix, name: parsed.data.name },
    ip,
  });

  return NextResponse.json({
    key: rawKey, id, userId: target.id, keyPrefix,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    warning: '평문 키는 지금만 표시됩니다. 사용자에게 안전한 경로로 전달하고, 이 화면을 닫으면 다시 볼 수 없습니다.',
    note: '이 키는 관리자 대리 발급으로 기록됩니다(issued_by).',
  }, { status: 201 });
}

/** DELETE ?id=… — 키 파기. */
export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const admin = guard.user;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDbAdapter();
  const row = await db.queryOne<{ id: string; user_id: string; key_prefix: string; status: string }>(
    'SELECT id, user_id, key_prefix, status FROM nf_api_keys WHERE id = ?', id,
  );
  if (!row) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  // ⚠ 이미 파기된 키에 200 을 주지 않는다 — 「방금 막았다」와 「이미 막혀 있었다」는 다르다.
  if (row.status === 'revoked') {
    return NextResponse.json({ ok: true, alreadyRevoked: true, id, keyPrefix: row.key_prefix });
  }

  await db.execute("UPDATE nf_api_keys SET status = 'revoked' WHERE id = ?", id);
  logAudit({
    userId: admin.userId, action: 'api_key.admin_revoke', resourceId: id,
    metadata: { targetUserId: row.user_id, keyPrefix: row.key_prefix },
    ip: getTrustedClientIp(req.headers),
  });
  return NextResponse.json({ ok: true, id, keyPrefix: row.key_prefix });
}
