/**
 * POST /api/nexyfab/partner/metrics-batch
 *
 * 여러 공급사 이메일을 한 번에 받아 다차원 지표를 반환.
 * supplier-matcher 결과 UI 에서 top-3 / top-8 공급사 지표를 동시에 렌더링할 때
 * N번 개별 호출 대신 이 배치 엔드포인트 사용.
 *
 * Body: { emails: string[], windowDays?: number }
 *       emails 최대 20건
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerMetrics } from '@/lib/partner-metrics';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const MAX_EMAILS = 20;

interface FactoryPublicRow {
  partner_email: string | null;
  contact_email: string | null;
  name: string;
  rating: number | null;
  certifications: string | null;
  created_at: number | null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { emails?: unknown; windowDays?: unknown };
  if (!Array.isArray(body.emails) || body.emails.length === 0) {
    return NextResponse.json({ error: 'emails array required' }, { status: 400 });
  }

  const emails = body.emails
    .filter((e): e is string => typeof e === 'string' && e.includes('@'))
    .slice(0, MAX_EMAILS);

  if (emails.length === 0) {
    return NextResponse.json({ error: 'no valid emails' }, { status: 400 });
  }

  const windowDaysRaw = Number(body.windowDays ?? 90);
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw >= 7 && windowDaysRaw <= 365
    ? windowDaysRaw : 90;

  // 공급사 기본 정보 배치 조회 — 단일 쿼리로 처리
  const db = getDbAdapter();
  const placeholders = emails.map(() => '?').join(', ');
  const factories = await db.queryAll<FactoryPublicRow>(
    `SELECT partner_email, contact_email, name, rating, certifications, created_at
       FROM nf_factories
       WHERE partner_email IN (${placeholders}) OR contact_email IN (${placeholders})`,
    ...emails, ...emails,
  ).catch((): FactoryPublicRow[] => []);

  const factoryByEmail = new Map<string, FactoryPublicRow>();
  for (const f of factories) {
    if (f.partner_email) factoryByEmail.set(f.partner_email, f);
    if (f.contact_email && !factoryByEmail.has(f.contact_email)) {
      factoryByEmail.set(f.contact_email, f);
    }
  }

  // 지표는 병렬 조회 — getPartnerMetrics 는 read-only 이므로 경합 없음
  const results = await Promise.all(emails.map(async (email) => {
    const factory = factoryByEmail.get(email);
    const metrics = await getPartnerMetrics(email, windowDays);

    let certs: string[] = [];
    try { certs = factory?.certifications ? JSON.parse(factory.certifications) : []; } catch { /* ignore */ }

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

    return {
      partnerEmail:  email,
      displayName:   factory?.name ?? null,
      metrics: {
        onTimeRate:         metrics.onTimeRate,
        onTimeCount:        metrics.onTimeCount,
        lateCount:          metrics.lateCount,
        avgLeadTimeDays:    metrics.avgLeadTimeDays,
        avgResponseMinutes: metrics.avgResponseMinutes,
        responseSamples:    metrics.responseSamples,
        qualityAvg:         metrics.qualityAvg,
        communicationAvg:   metrics.communicationAvg,
        deadlineRatingAvg:  metrics.deadlineRatingAvg,
        reviewCount:        metrics.reviewCount,
        reorderRate:        metrics.reorderRate,
        defectCount:        metrics.defectCount,
        defectResolvedCount:metrics.defectResolvedCount,
        defectResolutionRate: metrics.defectResolutionRate,
      },
      coldStart: {
        isColdStart,
        badges: coldStartBadges,
        certifications: certs,
        ageDays,
      },
    };
  }));

  return NextResponse.json({
    windowDays,
    partners: results,
  });
}
