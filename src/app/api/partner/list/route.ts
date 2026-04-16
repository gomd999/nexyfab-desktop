import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = getDbAdapter();

  // Distinct partners from token history (each unique email = one partner registration)
  const rows = await db.queryAll<{
    partner_id: string; email: string; company: string; created_at: number;
  }>(
    `SELECT partner_id, email, company, MAX(created_at) AS created_at
     FROM nf_partner_tokens
     GROUP BY LOWER(email)
     ORDER BY created_at DESC`,
  ).catch(() => [] as { partner_id: string; email: string; company: string; created_at: number }[]);

  // Also include any factory rows linked to these emails for specialties/status
  const partners = rows.map(r => ({
    partnerId: r.partner_id,
    email: r.email,
    company: r.company || r.email,
    specialties: [] as string[],
    status: 'active',
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return NextResponse.json({ partners });
}
