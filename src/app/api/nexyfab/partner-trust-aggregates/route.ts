import { NextRequest, NextResponse } from 'next/server';
import { getPartnerTrustAggregateRows } from '@/lib/partner-trust-aggregates';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nexyfab/partner-trust-aggregates?email=...&windowDays=90
 *
 * Phase 7-5 차원별 집계(읽기 전용). 바이어 프리뷰·관리자·파트너 대시보드에서 공통 사용.
 * 단일 신용점수를 반환하지 않습니다.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim();
  if (!email) {
    return NextResponse.json({ error: 'email query parameter is required' }, { status: 400 });
  }

  const windowDaysRaw = parseInt(req.nextUrl.searchParams.get('windowDays') ?? '90', 10);
  const windowDays = Number.isFinite(windowDaysRaw)
    ? Math.max(7, Math.min(365, windowDaysRaw))
    : 90;

  const dimensions = await getPartnerTrustAggregateRows(email, windowDays);

  return NextResponse.json({
    version: 1,
    partnerEmail: normPartnerEmail(email),
    windowDays,
    policyNote: 'Dimensions are reported separately; there is no single credit score (Phase 7-5).',
    dimensions,
  });
}
