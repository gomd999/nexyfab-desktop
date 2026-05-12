/**
 * B7 — RFQ template library API.
 *
 * GET  /api/nexyfab/rfq-templates
 *   → { user: UserTemplate[], system: SystemTemplate[] }
 *
 * POST /api/nexyfab/rfq-templates
 *   body: { name, sourceRfqId? | fields: { materialId, quantity, note?, ... } }
 *   → 201 { template }
 *
 * DELETE /api/nexyfab/rfq-templates?id=<templateId>
 *   → 204
 *
 * User templates persist across sessions. System templates ship with
 * the app (rfqSystemTemplates.ts) and aren't editable per-user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { randomBytes } from 'crypto';
import { RFQ_SYSTEM_TEMPLATES } from '@/lib/nexyfab/rfqSystemTemplates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UserTemplateRow {
  id: string;
  user_id: string;
  name: string;
  fields_json: string;
  source_rfq_id: string | null;
  created_at: number;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_rfq_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      source_rfq_id TEXT,
      created_at INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_rfq_tpl_user ON nf_rfq_templates(user_id, created_at DESC)').catch(() => {});
  tableEnsured = true;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await ensureTable(db);
  const rows = await db.queryAll<UserTemplateRow>(
    'SELECT * FROM nf_rfq_templates WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    auth.userId,
  ).catch((): UserTemplateRow[] => []);

  return NextResponse.json({
    ok: true,
    user: rows.map(r => ({
      id: r.id,
      name: r.name,
      fields: JSON.parse(r.fields_json),
      sourceRfqId: r.source_rfq_id,
      createdAt: r.created_at,
    })),
    system: RFQ_SYSTEM_TEMPLATES,
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: unknown; sourceRfqId?: unknown; fields?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return NextResponse.json({ error: 'name is required (≤80 chars)' }, { status: 400 });

  const db = getDbAdapter();
  await ensureTable(db);

  let fields: Record<string, unknown> = {};
  let sourceRfqId: string | null = null;

  if (typeof body.sourceRfqId === 'string') {
    // Clone from an existing RFQ the user owns.
    const rfq = await db.queryOne<{
      user_id: string;
      shape_id: string | null;
      shape_name: string | null;
      material_id: string;
      quantity: number;
      volume_cm3: number;
      surface_area_cm2: number;
      bbox: string;
      note: string | null;
      deadline: string | null;
      preferred_factory_id: string | null;
    }>(
      'SELECT user_id, shape_id, shape_name, material_id, quantity, volume_cm3, surface_area_cm2, bbox, note, deadline, preferred_factory_id FROM nf_rfqs WHERE id = ?',
      body.sourceRfqId,
    ).catch(() => null);
    if (!rfq) return NextResponse.json({ error: 'source RFQ not found' }, { status: 404 });
    if (rfq.user_id !== auth.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    fields = {
      shapeId: rfq.shape_id,
      shapeName: rfq.shape_name,
      materialId: rfq.material_id,
      quantity: rfq.quantity,
      volume_cm3: rfq.volume_cm3,
      surface_area_cm2: rfq.surface_area_cm2,
      bbox: JSON.parse(rfq.bbox),
      note: rfq.note,
      deadline: rfq.deadline,
      preferredFactoryId: rfq.preferred_factory_id,
    };
    sourceRfqId = body.sourceRfqId;
  } else if (body.fields && typeof body.fields === 'object') {
    fields = body.fields as Record<string, unknown>;
  } else {
    return NextResponse.json({ error: 'either sourceRfqId or fields is required' }, { status: 400 });
  }

  const id = `tpl_${randomBytes(6).toString('hex')}`;
  const now = Date.now();
  await db.execute(
    'INSERT INTO nf_rfq_templates (id, user_id, name, fields_json, source_rfq_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, auth.userId, name, JSON.stringify(fields), sourceRfqId, now,
  );

  return NextResponse.json({
    ok: true,
    template: { id, name, fields, sourceRfqId, createdAt: now },
  }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const db = getDbAdapter();
  await ensureTable(db);
  // db.execute resolves to undefined on success — failure surfaces as
  // a thrown promise. Catch + map to 500 so the client sees a typed error.
  let failed = false;
  await db.execute(
    'DELETE FROM nf_rfq_templates WHERE id = ? AND user_id = ?',
    id, auth.userId,
  ).catch(() => { failed = true; });
  if (failed) return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
