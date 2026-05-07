import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string; project_name: string; factory_name: string;
  estimated_amount: number; details: string; valid_until: string | null;
  partner_email: string | null; status: string; created_at: string;
}

// POST /api/nexyfab/rfq/compare
// Body: { quoteIds: string[] } — compare up to 5 quotes side by side
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schema = z.object({
    quoteIds: z.array(z.string().min(1)).min(2).max(5),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: '2~5개의 quoteId를 제공하세요.' }, { status: 400 });

  const db = getDbAdapter();
  const placeholders = parsed.data.quoteIds.map(() => '?').join(', ');
  const quotes = await db.queryAll<QuoteRow>(
    `SELECT q.* FROM nf_quotes q
     INNER JOIN nf_rfqs r ON q.inquiry_id = r.id
     WHERE q.id IN (${placeholders}) AND r.user_id = ?
     ORDER BY q.estimated_amount ASC`,
    ...parsed.data.quoteIds,
    authUser.userId,
  );

  if (quotes.length < 2) return NextResponse.json({ error: '비교할 견적을 찾을 수 없습니다.' }, { status: 404 });

  const amounts = quotes.map(q => q.estimated_amount).filter(a => a > 0);
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);
  const avgAmount = Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length);

  const comparison = quotes.map(q => {
    const vsMin = q.estimated_amount > 0
      ? Math.round(((q.estimated_amount - minAmount) / minAmount) * 100)
      : null;
    const vsAvg = q.estimated_amount > 0
      ? Math.round(((q.estimated_amount - avgAmount) / avgAmount) * 100)
      : null;
    const isExpired = q.valid_until ? new Date(q.valid_until) < new Date() : false;
    const daysUntilExpiry = q.valid_until
      ? Math.ceil((new Date(q.valid_until).getTime() - Date.now()) / 86_400_000)
      : null;

    return {
      id: q.id,
      projectName: q.project_name,
      factoryName: q.factory_name,
      estimatedAmount: q.estimated_amount,
      details: q.details,
      validUntil: q.valid_until,
      partnerEmail: q.partner_email,
      status: q.status,
      createdAt: q.created_at,
      analysis: {
        vsMin,       // % more expensive than cheapest
        vsAvg,       // % vs average
        isLowest: q.estimated_amount === minAmount,
        isExpired,
        daysUntilExpiry,
        recommendation: q.estimated_amount === minAmount && !isExpired ? 'best_price'
          : isExpired ? 'expired'
          : vsMin !== null && vsMin <= 10 ? 'competitive'
          : 'review',
      },
    };
  });

  return NextResponse.json({
    comparison,
    summary: {
      count: quotes.length,
      minAmount,
      maxAmount,
      avgAmount,
      spread: maxAmount - minAmount,
      spreadPct: minAmount > 0 ? Math.round(((maxAmount - minAmount) / minAmount) * 100) : 0,
      recommended: comparison.find(c => c.analysis.recommendation === 'best_price')?.id ?? null,
    },
  });
}
