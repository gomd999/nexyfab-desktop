import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface InquiryRow {
  id: string; action: string; name: string; email: string;
  project_name: string; budget: string | null; message: string;
  phone: string | null; status: string; admin_note: string | null;
  rfq_id: string | null; shape_id: string | null; material_id: string | null;
  volume_cm3: number | null; created_at: string; updated_at: string | null;
}

function rowToInquiry(r: InquiryRow) {
  return {
    id: r.id, action: r.action, name: r.name, email: r.email,
    projectName: r.project_name, budget: r.budget, message: r.message,
    phone: r.phone, status: r.status, adminNote: r.admin_note,
    rfqId: r.rfq_id, shapeId: r.shape_id, materialId: r.material_id,
    volume_cm3: r.volume_cm3, date: r.created_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const patchSchema = z.object({
  status: z.enum(['pending', 'contacted', 'closed']).optional(),
  adminNote: z.string().max(2000).optional(),
});

// GET /api/inquiries/[id] — admin only
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const db = getDbAdapter();

  const row = await db.queryOne<InquiryRow>('SELECT * FROM nf_inquiries WHERE id = ?', id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Associated quotes from nf_quotes
  const quotes = await db.queryAll<{ id: string; status: string; estimated_amount: number; created_at: string }>(
    'SELECT id, status, estimated_amount, created_at FROM nf_quotes WHERE inquiry_id = ? ORDER BY created_at DESC',
    id,
  );

  return NextResponse.json({ inquiry: rowToInquiry(row), quotes });
}

// PATCH /api/inquiries/[id] — admin only
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값 오류' }, { status: 400 });
  }

  const db = getDbAdapter();
  const row = await db.queryOne<InquiryRow>('SELECT * FROM nf_inquiries WHERE id = ?', id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [new Date().toISOString()];

  if (parsed.data.status !== undefined) { sets.push('status = ?'); vals.push(parsed.data.status); }
  if (parsed.data.adminNote !== undefined) { sets.push('admin_note = ?'); vals.push(parsed.data.adminNote); }
  vals.push(id);

  await db.execute(`UPDATE nf_inquiries SET ${sets.join(', ')} WHERE id = ?`, ...vals);

  const updated = await db.queryOne<InquiryRow>('SELECT * FROM nf_inquiries WHERE id = ?', id);
  return NextResponse.json({ inquiry: rowToInquiry(updated!) });
}
