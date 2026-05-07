/**
 * GET /api/nexyfab/partner/:email/metrics
 *
 * 공개(고객용) 다차원 파트너 지표. 공급사 계정 인증 불필요.
 * /partner/profile 의 metrics 엔드포인트는 본인 지표 조회용이라 partner-auth 가
 * 필요하지만, 이 엔드포인트는 매칭 결과·검색 리스트·공급사 카드에서 호출.
 *
 * Design note (2026-04-23):
 *   단일 신용점수로 collapse 하지 않고 차원별로 반환. 클라이언트가 납기율/
 *   품질/응답속도/소통 각각 별도 뱃지로 노출.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerMetrics } from '@/lib/partner-metrics';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface FactoryPublicRow {
  name: string;
  rating: number | null;
  review_count: number | null;
  certifications: string | null;
  created_at: number | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> },
) {
  const { email } = await params;
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  const partnerEmail = decodeURIComponent(email);

  const windowDays = Number(req.nextUrl.searchParams.get('windowDays') ?? 90);
  const safeWindow = Number.isFinite(windowDays) && windowDays >= 7 && windowDays <= 365
    ? windowDays : 90;

  const db = getDbAdapter();

  // 공급사 기본 정보 (이름·평점·경력·인증) — 콜드 스타트 뱃지에 사용
  const factory = await db.queryOne<FactoryPublicRow>(
    `SELECT name, rating, review_count, certifications, created_at
       FROM nf_factories
       WHERE partner_email = ? OR contact_email = ? LIMIT 1`,
    partnerEmail, partnerEmail,
  ).catch(() => null);

  const metrics = await getPartnerMetrics(partnerEmail, safeWindow);

  let certs: string[] = [];
  try { certs = factory?.certifications ? JSON.parse(factory.certifications) : []; } catch { /* ignore */ }

  // 콜드 스타트 시그널 — 리뷰 0 건이면 인증·경력 기반 "신규" 뱃지 제공
  const ageDays = factory?.created_at
    ? Math.floor((Date.now() - Number(factory.created_at)) / 86_400_000)
    : 0;
  const isColdStart = metrics.reviewCount === 0 && metrics.onTimeCount === 0;

  const coldStartBadges: string[] = [];
  if (isColdStart) {
    if (certs.length > 0) coldStartBadges.push(`인증 ${certs.length}개 보유`);
    if (ageDays >= 365) coldStartBadges.push(`경력 ${Math.floor(ageDays / 365)}년+`);
    if (coldStartBadges.length === 0) coldStartBadges.push('신규 파트너');
  }

  return NextResponse.json({
    partnerEmail,
    displayName: factory?.name ?? null,
    windowDays: safeWindow,
    metrics: {
      // 납기
      onTimeRate:         metrics.onTimeRate,
      onTimeCount:        metrics.onTimeCount,
      lateCount:          metrics.lateCount,
      avgLeadTimeDays:    metrics.avgLeadTimeDays,
      // 응답 속도
      avgResponseMinutes: metrics.avgResponseMinutes,
      responseSamples:    metrics.responseSamples,
      // 품질·소통 (리뷰 기반)
      qualityAvg:         metrics.qualityAvg,
      communicationAvg:   metrics.communicationAvg,
      deadlineRatingAvg:  metrics.deadlineRatingAvg,
      reviewCount:        metrics.reviewCount,
      // 충성도
      reorderRate:        metrics.reorderRate,
      // 불량·RMA (단일 점수 collapse 금지, 차원별)
      defectCount:        metrics.defectCount,
      defectResolvedCount: metrics.defectResolvedCount,
      defectResolutionRate: metrics.defectResolutionRate,
    },
    coldStart: {
      isColdStart,
      badges: coldStartBadges,
      certifications: certs,
      ageDays,
    },
  });
}
