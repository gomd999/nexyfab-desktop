import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { onMilestoneCreated, onMilestoneCompleted } from '@/lib/nexyflow-triggers';

export const dynamic = 'force-dynamic';

interface MilestoneRow {
  id: string; contract_id: string; title: string; description: string | null;
  status: string; photo_url: string | null; completed_by: string | null;
  sort_order: number; due_date: string | null; completed_at: number | null; created_at: number;
}

// GET /api/contracts/[id]/milestones
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const db = getDbAdapter();
  const milestones = await db.queryAll<MilestoneRow>(
    'SELECT * FROM nf_contract_milestones WHERE contract_id = ? ORDER BY sort_order ASC, created_at ASC',
    contractId,
  );

  return NextResponse.json({ milestones: milestones.map(m => ({
    id: m.id,
    contractId: m.contract_id,
    title: m.title,
    description: m.description,
    status: m.status,
    photoUrl: m.photo_url,
    completedBy: m.completed_by,
    sortOrder: m.sort_order,
    dueDate: m.due_date,
    completedAt: m.completed_at ? new Date(m.completed_at).toISOString() : null,
    createdAt: new Date(m.created_at).toISOString(),
  })) });
}

// POST — add milestone (admin or partner)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const schema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    dueDate: z.string().optional(),
    sortOrder: z.number().int().min(0).default(0),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const db = getDbAdapter();
  const id = `ms-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_contract_milestones (id, contract_id, title, description, status, sort_order, due_date, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    id, contractId, parsed.data.title, parsed.data.description ?? null,
    parsed.data.sortOrder, parsed.data.dueDate ?? null, now,
  );

  // NexyFlow 연동: 캘린더 이벤트 생성 (fire-and-forget)
  onMilestoneCreated({
    userId: authUser.userId,
    contractId,
    milestoneId: id,
    title: parsed.data.title,
    dueDate: parsed.data.dueDate,
    description: parsed.data.description,
  }).catch(() => {});

  return NextResponse.json({ milestone: { id, contractId, title: parsed.data.title, status: 'pending' } }, { status: 201 });
}

// PATCH — update milestone status / photo
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const schema = z.object({
    milestoneId: z.string().min(1),
    status: z.enum(['pending', 'in_progress', 'completed', 'rejected']).optional(),
    photoUrl: z.string().url().max(500).optional(),
    description: z.string().max(1000).optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'milestoneId required' }, { status: 400 });

  const { milestoneId, status, photoUrl, description } = parsed.data;
  const db = getDbAdapter();
  const now = Date.now();

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (status) { fields.push('status = ?'); vals.push(status); }
  if (photoUrl) { fields.push('photo_url = ?'); vals.push(photoUrl); }
  if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
  if (status === 'completed') {
    fields.push('completed_at = ?', 'completed_by = ?');
    vals.push(now, authUser.email);
  }

  if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  vals.push(milestoneId, contractId);
  const result = await db.execute(
    `UPDATE nf_contract_milestones SET ${fields.join(', ')} WHERE id = ? AND contract_id = ?`,
    ...vals,
  );

  if (result.changes === 0) return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });

  const updated = await db.queryOne<MilestoneRow>('SELECT * FROM nf_contract_milestones WHERE id = ?', milestoneId);

  // NexyFlow 연동: 완료 시 캘린더 이벤트 업데이트 (fire-and-forget)
  if (status === 'completed') {
    onMilestoneCompleted({
      userId: authUser.userId,
      milestoneId,
      title: updated?.title ?? milestoneId,
    }).catch(() => {});
  }
  return NextResponse.json({ milestone: updated });
}
