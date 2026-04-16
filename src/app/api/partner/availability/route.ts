import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getAuthUser } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

// Helper: ensure table exists (lazy migration since we can't touch db.ts)
async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`CREATE TABLE IF NOT EXISTS nf_partner_availability (
    id           TEXT PRIMARY KEY,
    partner_email TEXT NOT NULL,
    week_start   TEXT NOT NULL,
    available_hours INTEGER NOT NULL DEFAULT 40,
    notes        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE(partner_email, week_start)
  )`).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_avail_partner ON nf_partner_availability(partner_email)').catch(() => {});
}

// GET /api/partner/availability?email=xxx&weeks=4
// Requires authentication to prevent partner schedule enumeration
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req).catch(() => null);
  const partner = await getPartnerAuth(req).catch(() => null);
  if (!authUser && !partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureTable();
  const email = req.nextUrl.searchParams.get('email');
  const weeks = Math.min(12, Math.max(1, parseInt(req.nextUrl.searchParams.get('weeks') ?? '4', 10)));

  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const db = getDbAdapter();
  const rows = await db.queryAll<{
    week_start: string; available_hours: number; notes: string | null;
  }>(
    'SELECT week_start, available_hours, notes FROM nf_partner_availability WHERE partner_email = ? ORDER BY week_start ASC LIMIT ?',
    email, weeks,
  );

  return NextResponse.json({ email, availability: rows });
}

// POST — partner sets their weekly availability
// Requires partner JWT or session token in Authorization header
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const partnerEmail = partner.email;

  await ensureTable();

  const body = await req.json().catch(() => ({})) as { weekStart?: string; availableHours?: number; notes?: string };
  if (!body.weekStart || typeof body.availableHours !== 'number') {
    return NextResponse.json({ error: 'weekStart (YYYY-MM-DD) and availableHours required' }, { status: 400 });
  }

  // Validate weekStart is a Monday (ISO week)
  const date = new Date(body.weekStart);
  if (isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid weekStart date' }, { status: 400 });
  if (date.getUTCDay() !== 1) return NextResponse.json({ error: 'weekStart must be a Monday' }, { status: 400 });
  if (body.availableHours < 0 || body.availableHours > 80) {
    return NextResponse.json({ error: 'availableHours must be 0-80' }, { status: 400 });
  }

  const db = getDbAdapter();
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_partner_availability (id, partner_email, week_start, available_hours, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(partner_email, week_start) DO UPDATE SET available_hours = excluded.available_hours, notes = excluded.notes, updated_at = excluded.updated_at`,
    `avail-${crypto.randomUUID()}`, partnerEmail, body.weekStart, body.availableHours, body.notes ?? null, now, now,
  );

  return NextResponse.json({ ok: true, weekStart: body.weekStart, availableHours: body.availableHours });
}
