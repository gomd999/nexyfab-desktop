export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { createOrg, grantRole, getUserOrgs } from '@/lib/rbac';

/**
 * GET  /api/nexyfab/orgs — 내 조직 목록
 * POST /api/nexyfab/orgs — 조직 생성 (개인→기업 전환)
 */

// ─── GET: 내 조직 목록 ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orgs = await getUserOrgs(authUser.userId);

  return NextResponse.json({ orgs });
}

// ─── POST: 조직 생성 + 기존 구독 이관 ──────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 이미 조직에 소속되어 있으면 거부
  if (authUser.orgIds.length > 0) {
    return NextResponse.json({ error: '이미 조직에 소속되어 있습니다.' }, { status: 409 });
  }

  const body = await req.json() as {
    name: string;
    businessNumber?: string;
    country?: string;
  };

  if (!body.name || body.name.trim().length < 2) {
    return NextResponse.json({ error: '조직명은 2자 이상이어야 합니다.' }, { status: 400 });
  }

  const db = getDbAdapter();

  // 1. 조직 생성 (현재 유저의 plan 상속)
  const orgId = await createOrg({
    name: body.name.trim(),
    businessNumber: body.businessNumber?.trim(),
    plan: authUser.plan,
    country: body.country ?? 'KR',
    ownerId: authUser.userId,
  });

  // 2. org_admin role 부여
  await grantRole(authUser.userId, 'nexyfab', 'org_admin', orgId);

  // 3. 기존 개인 구독 → org로 이관
  await db.execute(
    "UPDATE nf_aw_subscriptions SET org_id = ? WHERE user_id = ? AND org_id IS NULL AND status = 'active'",
    orgId, authUser.userId,
  );

  // 4. 기존 인보이스도 org로 이관
  await db.execute(
    'UPDATE nf_aw_invoices SET org_id = ? WHERE user_id = ? AND org_id IS NULL',
    orgId, authUser.userId,
  );

  // 5. org plan 동기화
  await db.execute('UPDATE nf_orgs SET plan = ? WHERE id = ?', authUser.plan, orgId);

  return NextResponse.json({
    ok: true,
    org: { id: orgId, name: body.name.trim() },
    message: '조직이 생성되었습니다. 기존 구독이 조직으로 이관되었습니다.',
  }, { status: 201 });
}
