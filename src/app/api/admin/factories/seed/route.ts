/**
 * POST /api/admin/factories/seed
 * nf_factories 테이블이 비어있을 때 manufacturers-data.ts의 초기 데이터를 씨딩합니다.
 * 이미 데이터가 있으면 아무것도 하지 않습니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { MANUFACTURERS } from '@/app/api/nexyfab/manufacturers/manufacturers-data';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const existing = await db.queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM nf_factories');
  if (existing && existing.cnt > 0) {
    return NextResponse.json({ ok: true, seeded: 0, message: '이미 데이터가 있습니다.' });
  }

  const now = Date.now();
  let seeded = 0;

  for (const m of MANUFACTURERS) {
    await db.execute(
      `INSERT OR IGNORE INTO nf_factories
        (id, name, name_ko, region, processes, min_lead_time, max_lead_time,
         rating, review_count, price_level, certifications, description,
         description_ko, contact_email, contact_phone, website, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      m.id,
      m.name,
      m.nameKo,
      m.region,
      JSON.stringify(m.processes),
      m.minLeadTime,
      m.maxLeadTime,
      m.rating,
      m.reviewCount,
      m.priceLevel,
      JSON.stringify(m.certifications),
      m.description,
      m.descriptionKo,
      null, // contact_email
      null, // contact_phone
      null, // website
      'active',
      now,
      now,
    );
    seeded++;
  }

  return NextResponse.json({ ok: true, seeded });
}
