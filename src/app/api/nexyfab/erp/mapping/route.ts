import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_erp_sync_log (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      direction    TEXT NOT NULL,
      format       TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'ok',
      error        TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_erp_sync_user ON nf_erp_sync_log(user_id, created_at);
    CREATE TABLE IF NOT EXISTS nf_erp_field_mappings (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL UNIQUE,
      mappings   TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `).catch(() => {});
}

// GET — retrieve saved mapping
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureTable();
  const db = getDbAdapter();
  const row = await db.queryOne<{ mappings: string; updated_at: number }>(
    'SELECT mappings, updated_at FROM nf_erp_field_mappings WHERE user_id = ?',
    authUser.userId,
  );

  // Also return recent sync log
  const recentSyncs = await db.queryAll<{
    id: string; direction: string; format: string; record_count: number; status: string; created_at: number;
  }>(
    'SELECT id, direction, format, record_count, status, created_at FROM nf_erp_sync_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    authUser.userId,
  ).catch(() => []);

  return NextResponse.json({
    mappings: row ? JSON.parse(row.mappings) : {},
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    recentSyncs: recentSyncs.map(s => ({
      ...s, createdAt: new Date(s.created_at).toISOString(),
    })),
    defaultColumns: {
      part_name: ['part_name', '부품명', 'item'],
      quantity:  ['quantity', 'qty', '수량'],
      material:  ['material', '재질'],
      note:      ['note', '비고'],
      due_date:  ['due_date', '납기'],
    },
  });
}

// POST — save custom mapping
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const schema = z.object({
    mappings: z.record(z.string(), z.string()).refine(
      m => Object.keys(m).length <= 20,
      { message: 'Max 20 field mappings' },
    ),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  await ensureTable();
  const db = getDbAdapter();
  const now = Date.now();
  const id = `erpmap-${authUser.userId}`;

  await db.execute(
    `INSERT INTO nf_erp_field_mappings (id, user_id, mappings, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET mappings = excluded.mappings, updated_at = excluded.updated_at`,
    id, authUser.userId, JSON.stringify(parsed.data.mappings), now,
  );

  return NextResponse.json({ ok: true, updatedAt: new Date(now).toISOString() });
}
