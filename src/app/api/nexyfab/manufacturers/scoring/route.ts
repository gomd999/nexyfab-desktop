import { NextRequest, NextResponse } from 'next/server';
import { MANUFACTURERS } from '../manufacturers-data';

export const dynamic = 'force-dynamic';

// 가격 수준 → 점수 (낮을수록 선호)
const PRICE_SCORE: Record<string, number> = { low: 100, medium: 65, high: 35 };

// GET /api/nexyfab/manufacturers/scoring?process=cnc_milling&region=KR&leadTimeDays=14
// Returns ranked manufacturers with composite score based on internal DB
export async function GET(req: NextRequest) {
  const processFilter  = req.nextUrl.searchParams.get('process') ?? '';
  const regionFilter   = req.nextUrl.searchParams.get('region') ?? '';
  const maxLeadDays    = parseInt(req.nextUrl.searchParams.get('leadTimeDays') ?? '9999', 10);

  // ─── 1. 필터링 ────────────────────────────────────────────────────────────────
  const candidates = MANUFACTURERS.filter(m => {
    if (processFilter && !m.processes.includes(processFilter)) return false;
    if (regionFilter  && m.region !== regionFilter)            return false;
    if (m.minLeadTime > maxLeadDays)                           return false;
    return true;
  });

  // ─── 2. 스코어링 ──────────────────────────────────────────────────────────────
  // 가중치: rating 40% | 리드타임 25% | 리뷰 신뢰도 20% | 가격 15%
  const MAX_REVIEW_COUNT = Math.max(...MANUFACTURERS.map(m => m.reviewCount), 1);
  const MAX_LEAD_DAYS    = Math.max(...MANUFACTURERS.map(m => m.minLeadTime), 1);

  const scored = candidates.map(m => {
    const ratingScore    = (m.rating / 5) * 100;
    const leadTimeScore  = (1 - m.minLeadTime / (MAX_LEAD_DAYS + 1)) * 100;
    const reviewScore    = Math.min(100, (m.reviewCount / MAX_REVIEW_COUNT) * 100);
    const priceScore     = PRICE_SCORE[m.priceLevel] ?? 60;

    const composite = Math.round(
      ratingScore   * 0.40 +
      leadTimeScore * 0.25 +
      reviewScore   * 0.20 +
      priceScore    * 0.15,
    );

    return {
      id:           m.id,
      name:         m.name,
      nameKo:       m.nameKo,
      region:       m.region,
      processes:    m.processes,
      certifications: m.certifications,
      minLeadTime:  m.minLeadTime,
      maxLeadTime:  m.maxLeadTime,
      priceLevel:   m.priceLevel,
      rating:       m.rating,
      reviewCount:  m.reviewCount,
      score:        composite,
      breakdown: {
        rating:    Math.round(ratingScore),
        leadTime:  Math.round(leadTimeScore),
        reviews:   Math.round(reviewScore),
        price:     Math.round(priceScore),
      },
    };
  });

  // ─── 3. 정렬 & 반환 ───────────────────────────────────────────────────────────
  const ranked = scored.sort((a, b) => b.score - a.score).slice(0, 20);

  return NextResponse.json({
    manufacturers: ranked,
    total: ranked.length,
    filters: { process: processFilter, region: regionFilter, maxLeadDays },
    scoringWeights: { rating: '40%', leadTime: '25%', reviews: '20%', price: '15%' },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
