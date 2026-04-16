import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// ─── GET /api/nexyfab/manufacturers — public listing ─────────────────────────

interface FactoryRow {
  id: string;
  name: string;
  name_ko: string | null;
  region: string;
  processes: string;
  min_lead_time: number;
  max_lead_time: number;
  rating: number;
  review_count: number;
  price_level: string;
  certifications: string;
  description: string | null;
  description_ko: string | null;
  website: string | null;
  status: string;
  partner_email: string | null;
  match_field: string | null;
}

const PRICE_MAP: Record<string, 'budget' | 'standard' | 'premium'> = {
  low: 'budget', medium: 'standard', high: 'premium',
  budget: 'budget', standard: 'standard', premium: 'premium',
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const processFilter  = searchParams.get('process');
  const regionFilter   = searchParams.get('region');
  const priceLevelParam = searchParams.get('priceLevel');  // budget|standard|premium or low|medium|high
  const searchText     = searchParams.get('search');
  const maxLeadTimeParam = searchParams.get('maxLeadTime');
  const maxLeadTime    = maxLeadTimeParam ? parseInt(maxLeadTimeParam, 10) : null;

  const db = getDbAdapter();

  // Auto-seed if table is empty
  const countRow = await db.queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM nf_factories').catch(() => null);
  if (countRow && countRow.cnt === 0) {
    const { MANUFACTURERS } = await import('./manufacturers-data');
    const now = Date.now();
    for (const m of MANUFACTURERS) {
      await db.execute(
        `INSERT OR IGNORE INTO nf_factories
          (id, name, name_ko, region, processes, min_lead_time, max_lead_time,
           rating, review_count, price_level, certifications, description,
           description_ko, contact_email, contact_phone, website, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.id, m.name, m.nameKo ?? m.name, m.region,
        JSON.stringify(m.processes), m.minLeadTime, m.maxLeadTime,
        m.rating, m.reviewCount, m.priceLevel,
        JSON.stringify(m.certifications),
        m.description ?? null, m.descriptionKo ?? null,
        null, null, null, 'active', now, now,
      ).catch(() => {});
    }
  }

  let sql = "SELECT * FROM nf_factories WHERE status = 'active'";
  const args: (string | number)[] = [];

  if (regionFilter) {
    sql += ' AND region = ?';
    args.push(regionFilter);
  }
  if (maxLeadTime !== null && !isNaN(maxLeadTime)) {
    sql += ' AND min_lead_time <= ?';
    args.push(maxLeadTime);
  }

  sql += ' ORDER BY rating DESC, review_count DESC';

  let rows = await db.queryAll<FactoryRow>(sql, ...args).catch(() => [] as FactoryRow[]);

  // JS-side filters (JSON array fields + text search)
  if (processFilter) {
    rows = rows.filter(r => {
      try { return (JSON.parse(r.processes) as string[]).includes(processFilter); }
      catch { return false; }
    });
  }

  if (priceLevelParam) {
    // Normalize: accept both 'budget' and 'low' style values
    const normalized = PRICE_MAP[priceLevelParam] ?? priceLevelParam;
    rows = rows.filter(r => (PRICE_MAP[r.price_level] ?? r.price_level) === normalized);
  }

  if (searchText) {
    const q = searchText.toLowerCase();
    rows = rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.name_ko ?? '').includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      (r.description_ko ?? '').includes(q) ||
      (r.match_field ?? '').toLowerCase().includes(q),
    );
  }

  const manufacturers = rows.map(r => ({
    id: r.id,
    name: r.name,
    nameKo: r.name_ko ?? r.name,
    region: r.region,
    processes: (() => { try { return JSON.parse(r.processes) as string[]; } catch { return []; } })(),
    minLeadTime: r.min_lead_time,
    maxLeadTime: r.max_lead_time,
    rating: r.rating,
    reviewCount: r.review_count,
    priceLevel: PRICE_MAP[r.price_level] ?? 'standard',
    certifications: (() => { try { return JSON.parse(r.certifications) as string[]; } catch { return []; } })(),
    description: r.description ?? '',
    descriptionKo: r.description_ko ?? r.description ?? '',
    website: r.website,
    hasPartnerProfile: !!r.partner_email,
  }));

  const res = NextResponse.json({ manufacturers, total: manufacturers.length });
  res.headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  return res;
}
