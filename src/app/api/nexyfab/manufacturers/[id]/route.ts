import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

const PRICE_MAP: Record<string, 'budget' | 'standard' | 'premium'> = {
  low: 'budget', medium: 'standard', high: 'premium',
  budget: 'budget', standard: 'standard', premium: 'premium',
};

// GET /api/nexyfab/manufacturers/[id] — public factory detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDbAdapter();

  const row = await db.queryOne<{
    id: string; name: string; name_ko: string | null; region: string;
    processes: string; min_lead_time: number; max_lead_time: number;
    rating: number; review_count: number; price_level: string;
    certifications: string; description: string | null; description_ko: string | null;
    contact_email: string | null; contact_phone: string | null; website: string | null;
    status: string; partner_email: string | null;
    tech_exp: string | null; match_field: string | null; capacity_amount: string | null;
  }>(
    `SELECT id, name, name_ko, region, processes, min_lead_time, max_lead_time,
            rating, review_count, price_level, certifications,
            description, description_ko, contact_email, contact_phone, website, status,
            partner_email, tech_exp, match_field, capacity_amount
     FROM nf_factories WHERE id = ? AND status = 'active'`,
    id,
  ).catch(() => null);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Fetch recent reviews — nf_reviews.partner_email may match factory partner_email or contact_email
  const reviewKeys = [...new Set(
    [normPartnerEmail(row.partner_email), normPartnerEmail(row.contact_email)].filter(k => k.length > 0),
  )];
  const reviews = reviewKeys.length === 0
    ? []
    : await db.queryAll<{
        id: string; rating: number; comment: string; reviewer_email: string; reviewed_at: string;
      }>(
        `SELECT id, rating, comment, reviewer_email, reviewed_at
         FROM nf_reviews
         WHERE partner_email IS NOT NULL
           AND LOWER(TRIM(partner_email)) IN (${reviewKeys.map(() => '?').join(', ')})
         ORDER BY reviewed_at DESC LIMIT 10`,
        ...reviewKeys,
      ).catch(() => []);

  const manufacturer = {
    id: row.id,
    name: row.name,
    nameKo: row.name_ko ?? row.name,
    region: row.region,
    processes: (() => { try { return JSON.parse(row.processes) as string[]; } catch { return []; } })(),
    minLeadTime: row.min_lead_time,
    maxLeadTime: row.max_lead_time,
    rating: row.rating,
    reviewCount: row.review_count,
    priceLevel: PRICE_MAP[row.price_level] ?? 'standard',
    certifications: (() => { try { return JSON.parse(row.certifications) as string[]; } catch { return []; } })(),
    description: row.description ?? '',
    descriptionKo: row.description_ko ?? row.description ?? '',
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    website: row.website,
    hasPartnerProfile: !!row.partner_email,
    techExp: row.tech_exp,
    matchField: row.match_field,
    capacityAmount: row.capacity_amount,
    reviews: reviews.map(r => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      reviewerEmail: r.reviewer_email.replace(/^(.{2}).*@/, '$1***@'),
      createdAt: r.reviewed_at,
    })),
  };

  const res = NextResponse.json({ manufacturer });
  res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return res;
}
