import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireBomOwner(bomId: string, userId: string) {
  const db = getDbAdapter();
  return await db.queryOne('SELECT id FROM nf_bom WHERE id = ? AND user_id = ?', bomId, userId);
}

// GET — tree of BOM items
export async function GET(req: NextRequest, { params }: { params: Promise<{ bomId: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { bomId } = await params;
  if (!await requireBomOwner(bomId, authUser.userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const db = getDbAdapter();
  const items = await db.queryAll<{
    id: string; parent_id: string | null; part_number: string | null; name: string;
    material_id: string | null; process: string | null; quantity: number; unit: string;
    unit_cost: number | null; level: number; sort_order: number;
  }>(
    'SELECT id, parent_id, part_number, name, material_id, process, quantity, unit, unit_cost, level, sort_order FROM nf_bom_items WHERE bom_id = ? ORDER BY level ASC, sort_order ASC',
    bomId,
  );

  // Compute total cost
  const totalCost = items.reduce((sum, i) => sum + (i.unit_cost ?? 0) * i.quantity, 0);

  return NextResponse.json({ items, totalCost });
}

// POST — add item
export async function POST(req: NextRequest, { params }: { params: Promise<{ bomId: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { bomId } = await params;
  if (!await requireBomOwner(bomId, authUser.userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const schema = z.object({
    name: z.string().min(1).max(200),
    parentId: z.string().optional(),
    partNumber: z.string().max(100).optional(),
    materialId: z.string().max(50).optional(),
    process: z.string().max(50).optional(),
    quantity: z.number().int().min(1).max(100_000).default(1),
    unit: z.string().max(20).default('ea'),
    unitCost: z.number().int().min(0).optional(),
    notes: z.string().max(500).optional(),
    level: z.number().int().min(0).max(10).default(0),
    sortOrder: z.number().int().min(0).default(0),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const d = parsed.data;
  const db = getDbAdapter();
  const id = `bi-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_bom_items (id, bom_id, parent_id, part_number, name, material_id, process, quantity, unit, unit_cost, notes, level, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, bomId, d.parentId ?? null, d.partNumber ?? null, d.name,
    d.materialId ?? null, d.process ?? null, d.quantity, d.unit,
    d.unitCost ?? null, d.notes ?? null, d.level, d.sortOrder, now,
  );

  // Update BOM updated_at
  await db.execute('UPDATE nf_bom SET updated_at = ? WHERE id = ?', now, bomId);

  return NextResponse.json({ item: { id, ...d } }, { status: 201 });
}

// DELETE — remove item
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ bomId: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { bomId } = await params;
  if (!await requireBomOwner(bomId, authUser.userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { itemId } = await req.json().catch(() => ({})) as { itemId?: string };
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });

  const db = getDbAdapter();
  // Also delete children
  await db.execute('DELETE FROM nf_bom_items WHERE (id = ? OR parent_id = ?) AND bom_id = ?', itemId, itemId, bomId);
  await db.execute('UPDATE nf_bom SET updated_at = ? WHERE id = ?', Date.now(), bomId);

  return NextResponse.json({ ok: true });
}
