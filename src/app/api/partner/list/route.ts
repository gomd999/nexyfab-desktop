import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = getDbAdapter();

  // Distinct partners from token history
  const rows = await db.queryAll<{
    partner_id: string; email: string; company: string; created_at: number;
  }>(
    `SELECT partner_id, email, company, MAX(created_at) AS created_at
     FROM nf_partner_tokens
     GROUP BY LOWER(email)
     ORDER BY created_at DESC`,
  ).catch(() => [] as { partner_id: string; email: string; company: string; created_at: number }[]);

  if (rows.length === 0) return NextResponse.json({ partners: [] });

  // JOIN with nf_factories to get real processes and status
  const emails = rows.map(r => r.email.toLowerCase());
  const placeholders = emails.map(() => '?').join(',');
  const factories = await db.queryAll<{
    partner_email: string; processes: string; status: string;
  }>(
    `SELECT LOWER(partner_email) AS partner_email, processes, status
     FROM nf_factories
     WHERE LOWER(partner_email) IN (${placeholders})`,
    ...emails,
  ).catch(() => [] as { partner_email: string; processes: string; status: string }[]);

  const factoryMap: Record<string, { processes: string[]; status: string }> = {};
  for (const f of factories) {
    let procs: string[] = [];
    try { procs = JSON.parse(f.processes || '[]'); } catch { /* ignore */ }
    factoryMap[f.partner_email] = { processes: procs, status: f.status };
  }

  const partners = rows.map(r => {
    const fac = factoryMap[r.email.toLowerCase()];
    return {
      partnerId: r.partner_id,
      email: r.email,
      company: r.company || r.email,
      specialties: fac?.processes ?? [],
      status: fac?.status ?? 'pending',
      createdAt: new Date(r.created_at).toISOString(),
    };
  });

  return NextResponse.json({ partners });
}
