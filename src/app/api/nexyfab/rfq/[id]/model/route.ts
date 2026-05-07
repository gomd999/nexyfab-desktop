import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { getRfqAccessForUser } from '@/lib/rfq-partner-access';

export const dynamic = 'force-dynamic';

// GET /api/nexyfab/rfq/[id]/model
// Returns 3D model share token + DFM data for an RFQ.
// Accessible to: the RFQ owner, or anyone with a valid quote for this RFQ (partner).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: rfqId } = await params;

  const db = getDbAdapter();

  // Check access: owner OR has a quote for this RFQ
  const rfq = await db.queryOne<{
    id: string; user_id: string; shape_id: string | null; shape_name: string | null;
    material_id: string | null; volume_cm3: number | null; surface_area_cm2: number | null;
    bbox: string | null; dfm_results: string | null; shape_share_token: string | null;
    dfm_score: number | null; dfm_process: string | null;
  }>(
    `SELECT id, user_id, shape_id, shape_name, material_id, volume_cm3, surface_area_cm2,
            bbox, dfm_results, shape_share_token, dfm_score, dfm_process
     FROM nf_rfqs WHERE id = ?`,
    rfqId,
  );

  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await getRfqAccessForUser(rfqId, authUser);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const bbox = rfq.bbox ? JSON.parse(rfq.bbox) as Record<string, number> : null;
  const dfmResults = rfq.dfm_results ? JSON.parse(rfq.dfm_results) as unknown[] : null;

  return NextResponse.json({
    rfqId,
    shapeId: rfq.shape_id,
    shapeName: rfq.shape_name,
    materialId: rfq.material_id,
    volumeCm3: rfq.volume_cm3,
    surfaceAreaCm2: rfq.surface_area_cm2,
    bbox,
    shareToken: rfq.shape_share_token,
    viewUrl: rfq.shape_share_token ? `/view/${rfq.shape_share_token}` : null,
    dfmScore: rfq.dfm_score,
    dfmProcess: rfq.dfm_process,
    dfmResults,
    has3DModel: !!rfq.shape_share_token || !!rfq.shape_id,
  });
}

// PATCH /api/nexyfab/rfq/[id]/model
// Links a shape generator share token + DFM score to an RFQ.
// Called from the shape generator after exporting/sharing a design.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: rfqId } = await params;

  const schema = z.object({
    shareToken: z.string().min(8).max(100).optional(),
    dfmScore: z.number().int().min(0).max(100).optional(),
    dfmProcess: z.string().max(50).optional(),
    dfmResults: z.array(z.unknown()).max(20).optional(),
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const db = getDbAdapter();

  // Verify ownership
  const rfq = await db.queryOne<{ user_id: string }>(
    'SELECT user_id FROM nf_rfqs WHERE id = ?', rfqId,
  );
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rfq.user_id !== authUser.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (parsed.data.shareToken !== undefined) { fields.push('shape_share_token = ?'); vals.push(parsed.data.shareToken); }
  if (parsed.data.dfmScore !== undefined) { fields.push('dfm_score = ?'); vals.push(parsed.data.dfmScore); }
  if (parsed.data.dfmProcess !== undefined) { fields.push('dfm_process = ?'); vals.push(parsed.data.dfmProcess); }
  if (parsed.data.dfmResults !== undefined) { fields.push('dfm_results = ?'); vals.push(JSON.stringify(parsed.data.dfmResults)); }

  if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  fields.push('updated_at = ?');
  vals.push(Date.now(), rfqId, authUser.userId);

  await db.execute(
    `UPDATE nf_rfqs SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    ...vals,
  );

  return NextResponse.json({ ok: true, rfqId, shareToken: parsed.data.shareToken });
}
