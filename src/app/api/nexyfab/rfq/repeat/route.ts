import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { type RFQEntry, rowToRfq } from '../rfq-types';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

// POST /api/nexyfab/rfq/repeat
// Body: { rfqId: string }
// Clones an existing RFQ owned by the user, resets status to 'pending'
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { rfqId?: string; quantity?: number };
  if (!body.rfqId) return NextResponse.json({ error: 'rfqId is required' }, { status: 400 });

  const db = getDbAdapter();
  const original = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_rfqs WHERE id = ? AND user_id = ?',
    body.rfqId,
    authUser.userId,
  );

  if (!original) return NextResponse.json({ error: '견적을 찾을 수 없습니다.' }, { status: 404 });

  const newId = `rfq-${crypto.randomUUID()}`;
  const now = Date.now();
  const newQuantity = body.quantity ?? (original.quantity as number);

  await db.execute(
    `INSERT INTO nf_rfqs
       (id, user_id, user_email, shape_id, shape_name, material_id, quantity,
        volume_cm3, surface_area_cm2, bbox, dfm_results, cost_estimates, note,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    newId,
    authUser.userId,
    original.user_email ?? null,
    original.shape_id,
    original.shape_name,
    original.material_id,
    newQuantity,
    original.volume_cm3 ?? 0,
    original.surface_area_cm2 ?? 0,
    original.bbox ?? JSON.stringify({ w: 0, h: 0, d: 0 }),
    original.dfm_results ?? null,
    original.cost_estimates ?? null,
    original.note ?? null,
    now,
    now,
  );

  const newRow = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_rfqs WHERE id = ?', newId);
  const rfq = rowToRfq(newRow!);

  return NextResponse.json({ rfq, message: '재주문이 접수되었습니다.' }, { status: 201 });
}
