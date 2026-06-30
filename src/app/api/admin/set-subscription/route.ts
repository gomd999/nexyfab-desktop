// Admin: set/extend/clear the subscription window on NexyFab accounts (nf_users).
// Login is blocked 3 days past subscription_ends_at; null clears it (no expiry).
// Auth: x-admin-secret header (verifyAdmin → ADMIN_SECRET).

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    emails?: string[];
    subscriptionEndsAt?: string | number | null; // ISO string, ms epoch, or null to clear
  } | null;
  if (!body?.emails?.length) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  let ms: number | null = null;
  if (body.subscriptionEndsAt != null) {
    ms = typeof body.subscriptionEndsAt === 'number'
      ? body.subscriptionEndsAt
      : Date.parse(body.subscriptionEndsAt);
    if (!Number.isFinite(ms)) return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }

  const db = getDbAdapter();
  const results: Array<{ email: string; status: string }> = [];
  for (const raw of body.emails) {
    const email = String(raw).trim().toLowerCase();
    const r = await db.execute('UPDATE nf_users SET subscription_ends_at = ? WHERE email = ?', ms, email);
    results.push({ email, status: r.changes > 0 ? 'updated' : 'not_found' });
  }
  return NextResponse.json({ results, subscriptionEndsAt: ms });
}
