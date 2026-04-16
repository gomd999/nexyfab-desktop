/**
 * GET /api/admin/search?q=...&limit=10
 * Searches across users, RFQs, factories, contracts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const db = getDbAdapter();
  const like = `%${q}%`;
  const limit = 8;

  const [users, rfqs, factories, contracts] = await Promise.all([
    db.queryAll<{ id: string; email: string; name: string | null; plan: string | null }>(
      `SELECT id, email, name, plan FROM nf_users WHERE email LIKE ? OR name LIKE ? LIMIT ?`,
      like, like, limit,
    ).catch(() => []),

    db.queryAll<{ id: string; shape_name: string | null; material_id: string | null; status: string; user_email: string | null }>(
      `SELECT r.id, r.shape_name, r.material_id, r.status, u.email as user_email
       FROM nf_rfqs r LEFT JOIN nf_users u ON u.id = r.user_id
       WHERE r.id LIKE ? OR r.shape_name LIKE ? OR u.email LIKE ?
       ORDER BY r.created_at DESC LIMIT ?`,
      like, like, like, limit,
    ).catch(() => []),

    db.queryAll<{ id: string; name: string; name_ko: string | null; region: string; status: string }>(
      `SELECT id, name, name_ko, region, status FROM nf_factories WHERE name LIKE ? OR name_ko LIKE ? OR contact_email LIKE ? LIMIT ?`,
      like, like, like, limit,
    ).catch(() => []),

    db.queryAll<{ id: string; project_name: string | null; status: string; customer_email: string | null; factory_name: string | null }>(
      `SELECT id, project_name, status, customer_email, factory_name FROM nf_contracts WHERE id LIKE ? OR project_name LIKE ? OR customer_email LIKE ? OR factory_name LIKE ? ORDER BY created_at DESC LIMIT ?`,
      like, like, like, like, limit,
    ).catch(() => []),
  ]);

  return NextResponse.json({
    results: {
      users: users.map(u => ({ type: 'user', id: u.id, title: u.email, subtitle: u.name ?? '', meta: u.plan ?? 'free', href: `/admin/users` })),
      rfqs: rfqs.map(r => ({ type: 'rfq', id: r.id, title: r.shape_name ?? r.id, subtitle: r.user_email ?? '', meta: r.status, href: `/admin/rfq` })),
      factories: factories.map(f => ({ type: 'factory', id: f.id, title: f.name_ko ?? f.name, subtitle: f.region, meta: f.status, href: `/admin/factories` })),
      contracts: contracts.map(c => ({ type: 'contract', id: c.id, title: c.project_name ?? c.id, subtitle: c.customer_email ?? '', meta: c.status, href: `/admin/contracts` })),
    },
    query: q,
  });
}
