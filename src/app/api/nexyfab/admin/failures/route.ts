/**
 * GET /api/nexyfab/admin/failures — **무엇이 자주 깨지는가** (260803).
 *
 * 두 소비처:
 *   ① **개발** — 코드 짜기 전에 이걸 불러와 다음에 고칠 것을 정한다.
 *      `node scripts/autoverify/failures.mjs` 가 이 라우트를 친다.
 *   ② **자체 수정** — 빈도 상위 지문이 `auto-fix.mjs` 규칙 후보가 된다(§11 자율 검증 루프).
 *
 * ⚠ 응답에 **원문은 없다.** 지문(PII 제거)·건수·마지막 발생만 나간다(`failureLog.ts` 참조).
 * ⚠ 관리자 전용 — 실패 분포는 제품 약점 지도라 공개하지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { aggregateFailures } from '@/lib/failureLog';
import { getAuthUser } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// provider-chain 라우트와 **같은 가드**를 쓴다 — 관리자 판정이 두 벌이면 또 갈린다.
async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const days = Math.min(90, Math.max(1, Number(sp.get('days') ?? 7) || 7));
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? 40) || 40));

  const rows = await aggregateFailures(days * 24 * 3600_000, limit);
  return NextResponse.json({
    ok: true,
    windowDays: days,
    /** ⚠ distinctInputs 로 정렬돼 있다 — 한 사람의 재시도 폭주가 우선순위를 왜곡하지 않게. */
    rows,
    note: '지문은 PII 제거됨(숫자·식별자 정규화). 원문은 저장하지 않는다.',
  });
}
