import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// GET — list QC items for a contract
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const db = getDbAdapter();

  // Ensure table exists (lazy migration)
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS nf_qc_items (
      id            TEXT PRIMARY KEY,
      contract_id   TEXT NOT NULL,
      title         TEXT NOT NULL,
      criteria      TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      inspector_note TEXT,
      photo_url     TEXT,
      checked_by    TEXT,
      checked_at    INTEGER,
      created_at    INTEGER NOT NULL
    )`);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_qc_contract ON nf_qc_items(contract_id)');
  } catch { /* already exists */ }

  const items = await db.queryAll<{
    id: string; title: string; criteria: string | null; status: string;
    inspector_note: string | null; photo_url: string | null; checked_by: string | null; checked_at: number | null; created_at: number;
  }>(
    'SELECT id, title, criteria, status, inspector_note, photo_url, checked_by, checked_at, created_at FROM nf_qc_items WHERE contract_id = ? ORDER BY created_at ASC',
    contractId,
  );

  const summary = {
    total: items.length,
    passed: items.filter(i => i.status === 'passed').length,
    failed: items.filter(i => i.status === 'failed').length,
    pending: items.filter(i => i.status === 'pending').length,
  };

  return NextResponse.json({ items, summary });
}

// POST — add QC item
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const schema = z.object({
    title: z.string().min(1).max(200),
    criteria: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const db = getDbAdapter();
  const id = `qc-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    'INSERT INTO nf_qc_items (id, contract_id, title, criteria, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, contractId, parsed.data.title, parsed.data.criteria ?? null, 'pending', now,
  );

  return NextResponse.json({ item: { id, contractId, title: parsed.data.title, status: 'pending' } }, { status: 201 });
}

// PATCH — update QC item result
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const schema = z.object({
    itemId: z.string().min(1),
    status: z.enum(['pending', 'passed', 'failed']),
    inspectorNote: z.string().max(1000).optional(),
    photoUrl: z.string().url().max(500).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'itemId and status required' }, { status: 400 });

  const db = getDbAdapter();
  const now = Date.now();
  const result = await db.execute(
    `UPDATE nf_qc_items SET status = ?, inspector_note = ?, photo_url = COALESCE(?, photo_url), checked_by = ?, checked_at = ? WHERE id = ? AND contract_id = ?`,
    parsed.data.status,
    parsed.data.inspectorNote ?? null,
    parsed.data.photoUrl ?? null,
    authUser.email,
    now,
    parsed.data.itemId,
    contractId,
  );

  if (result.changes === 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
