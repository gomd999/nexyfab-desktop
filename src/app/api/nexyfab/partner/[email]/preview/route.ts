/**
 * M2 — Partner profile preview.
 *
 * GET /api/nexyfab/partner/{email}/preview
 *   → { partner: { name, region, processes, certifications, ageDays,
 *                  metrics: { onTimeRate, qualityAvg, ... },
 *                  recentReviewSnippets } }
 *
 * Designed for the "before you send the RFQ, who is this manufacturer?"
 * card. Combines factory directory data + multi-dim metrics + a few
 * recent review excerpts so the buyer can decide in 5 seconds whether
 * to include this partner in the RFQ.
 *
 * Public endpoint (no auth) — partner profiles are listed in the public
 * factory directory anyway, this just adds metric context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getPartnerMetrics } from '@/lib/partner-metrics';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FactoryRow {
  id: string;
  name: string;
  region: string | null;
  industry: string | null;
  processes: string | null;       // JSON array
  certifications: string | null;  // JSON array
  partner_email: string | null;
  contact_email: string | null;
  rating: number | null;
  created_at: number | null;
  description: string | null;
}

interface ReviewSnippetRow {
  rating: number;
  cat_deadline: number;
  cat_quality: number;
  cat_communication: number;
  comment: string | null;
  reviewed_at: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const { email } = await params;
  const decoded = decodeURIComponent(email);
  const norm = normPartnerEmail(decoded);
  // Accept either an email or a factory id in the path. The factory
  // directory at /factories knows the id but not always the email; the
  // RFQ thread flow knows the email but not always the id. We resolve
  // by trying both.
  const looksLikeEmail = norm.includes('@');
  const looksLikeId = !looksLikeEmail && /^[a-zA-Z0-9_-]{4,80}$/.test(decoded);
  if (!looksLikeEmail && !looksLikeId) {
    return NextResponse.json({ error: 'invalid identifier (need email or factory id)' }, { status: 400 });
  }

  const db = getDbAdapter();
  const factory = await db.queryOne<FactoryRow>(
    `SELECT id, name, region, industry, processes, certifications, partner_email,
            contact_email, rating, created_at, description
       FROM nf_factories
      WHERE LOWER(TRIM(partner_email)) = ? OR LOWER(TRIM(contact_email)) = ? OR id = ?
      LIMIT 1`,
    norm, norm, decoded,
  ).catch(() => null);

  if (!factory) {
    return NextResponse.json({ error: 'partner not found' }, { status: 404 });
  }

  let processes: string[] = [];
  let certs: string[] = [];
  try { processes = factory.processes ? JSON.parse(factory.processes) : []; } catch { /* skip */ }
  try { certs = factory.certifications ? JSON.parse(factory.certifications) : []; } catch { /* skip */ }

  const ageDays = factory.created_at
    ? Math.floor((Date.now() - Number(factory.created_at)) / 86_400_000)
    : 0;

  const metrics = await getPartnerMetrics(norm, 90);

  // Pull up to 3 most-recent review snippets — gives the buyer a flavor
  // beyond raw scores.
  const reviewRows = await db.queryAll<ReviewSnippetRow>(
    `SELECT rating, cat_deadline, cat_quality, cat_communication, comment, reviewed_at
       FROM nf_reviews
      WHERE LOWER(TRIM(partner_email)) = ?
        AND comment IS NOT NULL AND LENGTH(comment) > 5
   ORDER BY reviewed_at DESC LIMIT 3`,
    norm,
  ).catch((): ReviewSnippetRow[] => []);

  // Cold-start logic: when no metrics exist, surface trust signals
  // (certifications, age) so a brand-new partner isn't dismissed.
  const isColdStart = metrics.reviewCount === 0 && metrics.onTimeCount === 0;
  const coldStartBadges: string[] = [];
  if (isColdStart) {
    if (certs.length > 0) coldStartBadges.push(`인증 ${certs.length}개`);
    if (ageDays >= 365) coldStartBadges.push(`경력 ${Math.floor(ageDays / 365)}년+`);
    if (coldStartBadges.length === 0) coldStartBadges.push('신규 파트너');
  }

  return NextResponse.json({
    ok: true,
    partner: {
      id: factory.id,
      name: factory.name,
      region: factory.region,
      industry: factory.industry,
      description: factory.description,
      processes,
      certifications: certs,
      partnerEmail: factory.partner_email ?? factory.contact_email,
      ageDays,
      isColdStart,
      coldStartBadges,
      metrics: {
        onTimeRate: metrics.onTimeRate,
        avgLeadTimeDays: metrics.avgLeadTimeDays,
        avgResponseMinutes: metrics.avgResponseMinutes,
        responseSamples: metrics.responseSamples,
        qualityAvg: metrics.qualityAvg,
        communicationAvg: metrics.communicationAvg,
        deadlineRatingAvg: metrics.deadlineRatingAvg,
        reviewCount: metrics.reviewCount,
        reorderRate: metrics.reorderRate,
        defectResolutionRate: metrics.defectResolutionRate,
      },
      recentReviews: reviewRows.map(r => ({
        rating: r.rating,
        deadline: r.cat_deadline,
        quality: r.cat_quality,
        communication: r.cat_communication,
        comment: r.comment,
        reviewedAt: r.reviewed_at,
      })),
    },
  });
}
