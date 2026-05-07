import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// 가격 수준 → 점수 (낮을수록 선호)
const PRICE_SCORE: Record<string, number> = { low: 100, medium: 65, high: 35 };

// GET /api/nexyfab/manufacturers/scoring?process=cnc_milling&region=KR&leadTimeDays=14
export async function GET(req: NextRequest) {
  const processFilter = req.nextUrl.searchParams.get('process') ?? '';
  const regionFilter  = req.nextUrl.searchParams.get('region') ?? '';
  const maxLeadDays   = parseInt(req.nextUrl.searchParams.get('leadTimeDays') ?? '9999', 10);

  const db = getDbAdapter();

  type FactoryRow = {
    id: string; name: string; rating: number | null; review_count: number | null;
    processes: string | null; status: string; match_field: string | null;
  };

  const rows = await db.queryAll<FactoryRow>(
    `SELECT id, name, rating, review_count, processes, status, match_field
     FROM nf_factories
     WHERE status = 'active'`,
  ).catch((): FactoryRow[] => []);

  // Parse and filter
  const candidates = rows
    .map(row => {
      let processes: string[] = [];
      try { processes = JSON.parse(row.processes ?? '[]'); } catch {}
      return { ...row, parsedProcesses: processes };
    })
    .filter(row => {
      if (processFilter && !row.parsedProcesses.includes(processFilter)) return false;
      return true;
    });

  if (candidates.length === 0) {
    return NextResponse.json({
      manufacturers: [],
      total: 0,
      filters: { process: processFilter, region: regionFilter, maxLeadDays },
      scoringWeights: { rating: '40%', leadTime: '25%', reviews: '20%', price: '15%' },
    });
  }

  const MAX_REVIEW = Math.max(...candidates.map(m => m.review_count ?? 0), 1);

  const scored = candidates.map(m => {
    const rating      = m.rating ?? 0;
    const reviewCount = m.review_count ?? 0;

    const ratingScore  = (rating / 5) * 100;
    const leadTimeScore = 60; // default mid-score when lead time not stored in DB
    const reviewScore  = Math.min(100, (reviewCount / MAX_REVIEW) * 100);
    const priceScore   = PRICE_SCORE['medium'];  // default until price_level column exists

    const composite = Math.round(
      ratingScore   * 0.40 +
      leadTimeScore * 0.25 +
      reviewScore   * 0.20 +
      priceScore    * 0.15,
    );

    return {
      id:           m.id,
      name:         m.name,
      nameKo:       null,
      region:       regionFilter || 'KR',
      processes:    m.parsedProcesses,
      certifications: [] as string[],
      minLeadTime:  7,
      maxLeadTime:  21,
      priceLevel:   'medium',
      rating,
      reviewCount,
      score:        composite,
      breakdown: {
        rating:   Math.round(ratingScore),
        leadTime: Math.round(leadTimeScore),
        reviews:  Math.round(reviewScore),
        price:    Math.round(priceScore),
      },
    };
  });

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
