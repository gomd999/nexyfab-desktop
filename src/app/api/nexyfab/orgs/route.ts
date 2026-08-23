export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { createOrg, grantRole, getUserOrgs } from '@/lib/rbac';
import { ACTIVE_ORG_COOKIE, activeOrgCookieOptions } from '@/lib/org-context';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const ORG_CREATE_JSON_BYTES = 64 * 1024;

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

  let body: {
    name?: string;
    businessNumber?: string;
    country?: string;
  } = {};
  try {
    body = await readBoundedJson(req, ORG_CREATE_JSON_BYTES);
  } catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
    }
  }

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

  // 첫 조직만 기존 개인 결제를 이관한다. 이후 조직은 독립된 결제
  // 컨텍스트로 시작하여 서로 다른 고객사의 내역이 섞이지 않는다.
  const migratedPersonalBilling = authUser.orgIds.length === 0;
  if (migratedPersonalBilling) {
    await db.execute(
      "UPDATE nf_aw_subscriptions SET org_id = ? WHERE user_id = ? AND org_id IS NULL AND status = 'active'",
      orgId, authUser.userId,
    );
    await db.execute(
      'UPDATE nf_aw_invoices SET org_id = ? WHERE user_id = ? AND org_id IS NULL',
      orgId, authUser.userId,
    );
  }

  // 5. org plan 동기화
  await db.execute('UPDATE nf_orgs SET plan = ? WHERE id = ?', authUser.plan, orgId);

  const response = NextResponse.json({
    ok: true,
    org: { id: orgId, name: body.name.trim() },
    migratedPersonalBilling,
    message: migratedPersonalBilling
      ? '조직이 생성되고 기존 개인 결제가 이관되었습니다.'
      : '조직이 독립 결제 컨텍스트로 생성되었습니다.',
  }, { status: 201 });
  response.cookies.set(ACTIVE_ORG_COOKIE, orgId, activeOrgCookieOptions());
  return response;
}
