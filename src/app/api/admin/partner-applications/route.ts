/**
 * GET /api/admin/partner-applications — List partner applications
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export interface PartnerApplicationRow {
  id: string;
  company_name: string;
  biz_number: string;
  ceo_name: string;
  founded_year: number | null;
  employee_count: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_title: string | null;
  processes: string;
  certifications: string;
  monthly_capacity: string | null;
  industries: string;
  bio: string | null;
  homepage: string | null;
  status: string;
  created_at: number;
}

function parseRow(row: PartnerApplicationRow) {
  return {
    ...row,
    processes: JSON.parse(row.processes || '[]') as string[],
    certifications: JSON.parse(row.certifications || '[]') as string[],
    industries: JSON.parse(row.industries || '[]') as string[],
  };
}

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status') || 'all';

  let sql = 'SELECT * FROM partner_applications WHERE 1=1';
  const args: (string | number)[] = [];

  if (status !== 'all') {
    sql += ' AND status = ?';
    args.push(status);
  }
  sql += ' ORDER BY created_at DESC';

  const rows = await db.queryAll<PartnerApplicationRow>(sql, ...args).catch(() => []);
  return NextResponse.json({ applications: rows.map(parseRow), total: rows.length });
}
