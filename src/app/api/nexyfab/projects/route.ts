import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { sanitizeText } from '@/lib/sanitize';
import { type NexyfabProject } from './projects-types';
import { recordUsage } from '@/lib/billing-engine';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(200),
  shapeId: z.string().max(100).optional(),
  materialId: z.string().max(100).optional(),
  sceneData: z.string().max(5_000_000).optional(), // 5MB max
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// ─── Row → NexyfabProject ─────────────────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): NexyfabProject {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    thumbnail: (row.thumbnail as string) || undefined,
    shapeId: (row.shape_id as string) || undefined,
    materialId: (row.material_id as string) || undefined,
    sceneData: (row.scene_data as string) || undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    archivedAt: (row.archived_at as number) || undefined,
    role: 'owner',
    canEdit: true,
  };
}

// ─── GET /api/nexyfab/projects ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;
  const showArchived = req.nextUrl.searchParams.get('archived') === 'true';

  const db = getDbAdapter();

  const archivedFilter = showArchived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
  const totalRow = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ? AND ${archivedFilter}`,
    authUser.userId,
  );
  const total = totalRow?.c ?? 0;

  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT * FROM nf_projects WHERE user_id = ? AND ${archivedFilter} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    authUser.userId, limit, offset,
  );

  return NextResponse.json({
    projects: rows.map(rowToProject),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}

// ─── POST /api/nexyfab/projects ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawBody = await req.json() as Record<string, unknown>;

  const parsed = createProjectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  // ── Server-side plan enforcement: project count limit ──
  const db = getDbAdapter();
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'pro')) {
    const countRow = await db.queryOne<{ c: number }>(
      'SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ? AND archived_at IS NULL',
      authUser.userId,
    );
    const count = countRow?.c ?? 0;
    const FREE_PROJECT_LIMIT = 1;
    if (count >= FREE_PROJECT_LIMIT) {
      return NextResponse.json(
        { error: 'Free plan limit reached (1 project). Upgrade to Pro for unlimited projects.' },
        { status: 403 },
      );
    }
  }

  const body = parsed.data;
  const safeName = sanitizeText(body.name);
  const now = Date.now();
  const id = `proj-${now}-${Math.random().toString(36).slice(2, 7)}`;
  await db.execute(
    `INSERT INTO nf_projects
       (id, user_id, name, shape_id, material_id, scene_data, thumbnail, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    authUser.userId,
    safeName,
    body.shapeId ?? null,
    body.materialId ?? null,
    body.sceneData ?? null,
    null,
    body.tags ? JSON.stringify(body.tags) : null,
    now,
    now,
  );

  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_projects WHERE id = ?',
    id,
  );

  if (!row) {
    return NextResponse.json({ error: '프로젝트 저장 후 조회에 실패했습니다.' }, { status: 500 });
  }
  const project = rowToProject(row);
  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({ userId: authUser.userId, action: 'project.create', resourceId: project.id, ip });
  recordUsage({ userId: authUser.userId, product: 'nexyfab', metric: 'project_create', metadata: JSON.stringify({ projectId: project.id }) }).catch(() => {});

  return NextResponse.json({ project }, { status: 201 });
}
