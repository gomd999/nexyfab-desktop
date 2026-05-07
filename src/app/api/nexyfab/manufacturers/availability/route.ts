/**
 * GET   /api/nexyfab/manufacturers/availability — Read factory availability schedule
 * PATCH /api/nexyfab/manufacturers/availability — Save factory availability schedule
 *
 * Table: nf_factory_availability (factory_id TEXT PRIMARY KEY, schedule TEXT, updated_at INTEGER)
 * schedule is a JSON object: Record<'mon'|'tue'|...|'sun', { enabled: boolean; from: string; to: string }>
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { findFactoryForPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

const VALID_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const TIME_RE = /^\d{2}:\d{2}$/;

interface DaySchedule {
  enabled: boolean;
  from: string;
  to: string;
}

async function getFactoryId(email: string): Promise<string | null> {
  const row = await findFactoryForPartnerEmail(email, { activeOnly: true });
  return row?.id ?? null;
}

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_factory_availability (
      factory_id TEXT PRIMARY KEY,
      schedule   TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    )
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const factoryId = await getFactoryId(authUser.email);
  if (!factoryId) return NextResponse.json({ error: 'No active factory found' }, { status: 404 });

  await ensureTable();
  const db = getDbAdapter();
  const row = await db.queryOne<{ schedule: string }>(
    'SELECT schedule FROM nf_factory_availability WHERE factory_id = ?',
    factoryId,
  ).catch(() => null);

  const schedule = row?.schedule ? JSON.parse(row.schedule) : {};
  return NextResponse.json({ availability: { schedule } });
}

export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { schedule?: Record<string, DaySchedule> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.schedule || typeof body.schedule !== 'object') {
    return NextResponse.json({ error: 'schedule is required' }, { status: 400 });
  }

  // Validate schedule shape
  for (const [day, val] of Object.entries(body.schedule)) {
    if (!VALID_DAYS.has(day)) {
      return NextResponse.json({ error: `Invalid day: ${day}` }, { status: 400 });
    }
    if (typeof val.enabled !== 'boolean') {
      return NextResponse.json({ error: `${day}.enabled must be boolean` }, { status: 400 });
    }
    if (!TIME_RE.test(val.from) || !TIME_RE.test(val.to)) {
      return NextResponse.json({ error: `${day} times must be HH:MM format` }, { status: 400 });
    }
  }

  const factoryId = await getFactoryId(authUser.email);
  if (!factoryId) return NextResponse.json({ error: 'No active factory found' }, { status: 404 });

  await ensureTable();
  const db = getDbAdapter();
  const now = Date.now();
  const scheduleJson = JSON.stringify(body.schedule);

  await db.execute(
    `INSERT INTO nf_factory_availability (factory_id, schedule, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(factory_id) DO UPDATE SET schedule = excluded.schedule, updated_at = excluded.updated_at`,
    factoryId, scheduleJson, now,
  );

  return NextResponse.json({ ok: true, availability: { schedule: body.schedule } });
}
