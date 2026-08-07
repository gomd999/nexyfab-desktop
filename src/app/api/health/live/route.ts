/**
 * GET /api/health/live — 라이브니스 + **빌드 태그**.
 *
 * ⚠ 260802 — `railway up` 이 **exit 0 · 빌드 성공 · 헬스체크 성공**인데도 새 코드가
 *   반영되지 않는 일이 하루에 **네 번** 있었다. 그때마다 「이 기능이 라이브에 있나」를
 *   기능별 관측점으로 확인해야 했고(패키지를 풀어 특정 문자열을 찾는 식), 관측점이 없는
 *   변경(동시성 상한 등)은 **확인할 방법이 아예 없었다.**
 *
 * 빌드 태그를 여기 실으면 **1회 호출로** 어느 빌드가 도는지 확정된다.
 * ⚠ 값이 없으면 `unknown` 이다 — **비어 있는 것을 「최신」으로 읽지 않게** 명시한다.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const build =
    process.env.NEXYFAB_BUILD_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.NEXYFAB_BUILD_TAG ||
    process.env.NEXT_PUBLIC_RELEASE ||
    'unknown';
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    /** Dockerfile 의 `CACHEBUST` → `NEXYFAB_BUILD_TAG`. 미설정이면 'unknown'. */
    build,
  });
}
