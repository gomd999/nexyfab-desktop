/**
 * GET  /api/admin/factories  — 제조사 목록 (관리자)
 * POST /api/admin/factories  — 제조사 등록 (관리자)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export interface FactoryRow {
  id: string;
  name: string;
  name_ko: string | null;
  region: string;
  processes: string;        // JSON array string
  min_lead_time: number;
  max_lead_time: number;
  rating: number;
  review_count: number;
  price_level: string;
  certifications: string;   // JSON array string
  description: string | null;
  description_ko: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

function parseFactory(row: FactoryRow) {
  return {
    ...row,
    processes: JSON.parse(row.processes || '[]') as string[],
    certifications: JSON.parse(row.certifications || '[]') as string[],
  };
}

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status') || 'all';
  const region = searchParams.get('region');
  const q = searchParams.get('q');

  let sql = 'SELECT * FROM nf_factories WHERE 1=1';
  const args: (string | number)[] = [];

  if (status !== 'all') {
    sql += ' AND status = ?';
    args.push(status);
  }
  if (region) {
    sql += ' AND region = ?';
    args.push(region);
  }
  if (q) {
    sql += ' AND (name LIKE ? OR name_ko LIKE ? OR contact_email LIKE ?)';
    const like = `%${q}%`;
    args.push(like, like, like);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = await db.queryAll<FactoryRow>(sql, ...args);
  const factories = rows.map(parseFactory);

  return NextResponse.json({ factories, total: factories.length });
}

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    name: string;
    name_ko?: string;
    region?: string;
    processes?: string[];
    min_lead_time?: number;
    max_lead_time?: number;
    rating?: number;
    price_level?: string;
    certifications?: string[];
    description?: string;
    description_ko?: string;
    contact_email?: string;
    contact_phone?: string;
    website?: string;
    status?: string;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '제조사명은 필수입니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  const id = `fac-${randomUUID().slice(0, 8)}`;

  await db.execute(
    `INSERT INTO nf_factories
      (id, name, name_ko, region, processes, min_lead_time, max_lead_time,
       rating, review_count, price_level, certifications, description,
       description_ko, contact_email, contact_phone, website, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    body.name.trim(),
    body.name_ko?.trim() || null,
    body.region || 'KR',
    JSON.stringify(body.processes || []),
    body.min_lead_time ?? 7,
    body.max_lead_time ?? 30,
    body.rating ?? 4.0,
    0,
    body.price_level || 'medium',
    JSON.stringify(body.certifications || []),
    body.description?.trim() || null,
    body.description_ko?.trim() || null,
    body.contact_email?.trim() || null,
    body.contact_phone?.trim() || null,
    body.website?.trim() || null,
    body.status || 'active',
    now,
    now,
  );

  const row = await db.queryOne<FactoryRow>('SELECT * FROM nf_factories WHERE id = ?', id);
  return NextResponse.json({ factory: row ? parseFactory(row) : null }, { status: 201 });
}
