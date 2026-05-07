/**
 * GET /api/partner/metrics
 * Returns multi-dimensional performance summary for the calling partner.
 * Per project decision (memory: feedback_metric_design): never collapse to a
 * single score — every dimension is returned separately so the partner knows
 * exactly which axis to improve.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getPartnerMetrics } from '@/lib/partner-metrics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const windowDays = Math.max(7, Math.min(365, parseInt(sp.get('windowDays') ?? '90', 10)));

  const summary = await getPartnerMetrics(partner.email, windowDays);
  return NextResponse.json({ ok: true, metrics: summary });
}
