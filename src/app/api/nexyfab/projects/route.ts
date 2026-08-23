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
import { resolveRequestOrgContext } from '@/lib/org-context';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

// sceneData accepts up to 5,000,000 UTF-16 code units. 32 MiB also admits
// their worst-case six-byte JSON escapes plus thumbnail and envelope framing.
const MAX_PROJECT_BODY_BYTES = 32 * 1024 * 1024;

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(200),
  shapeId: z.string().max(100).optional(),
  materialId: z.string().max(100).optional(),
  sceneData: z.string().max(5_000_000).optional(), // 5MB max
  // Thumbnail is a data URL (~PNG base64) captured client-side from the
  // viewport. Cap at 512 KB so a single project save doesn't blow the row.
  thumbnail: z.string().max(512_000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// ─── Row → NexyfabProject ─────────────────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): NexyfabProject {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    orgId: (row.org_id as string) || undefined,
    name: row.name as string,
    thumbnail: (row.thumbnail as string) || undefined,
    shapeId: (row.shape_id as string) || undefined,
    materialId: (row.material_id as string) || undefined,
    sceneData: (row.scene_data as string) || undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    // PostgreSQL BIGINT values arrive as decimal strings; the public project
    // contract uses numeric millisecond revision tokens.
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archivedAt: row.archived_at == null ? undefined : Number(row.archived_at),
    role: 'owner',
    canEdit: true,
  };
}

// ─── GET /api/nexyfab/projects ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return NextResponse.json({ error: 'Select a valid workspace', code: context.code }, { status: 409 });

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;
  const showArchived = req.nextUrl.searchParams.get('archived') === 'true';
  const showShared = req.nextUrl.searchParams.get('shared') === 'true';

  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_projects ADD COLUMN org_id TEXT').catch(() => {});
  const workspaceClause = context.orgId ? 'p.org_id = ?' : 'p.org_id IS NULL';
  const workspaceArgs = context.orgId ? [context.orgId] : [];

  // "Shared with me" — projects where the user is a member (not the owner).
  // Joins the existing nf_project_members ACL. (2026-06-09 P2)
  if (showShared) {
    try {
      const sharedRows = await db.queryAll<Record<string, unknown>>(
        `SELECT p.*, m.role AS member_role FROM nf_projects p
           INNER JOIN nf_project_members m ON m.project_id = p.id
          WHERE m.user_id = ? AND ${workspaceClause} AND p.archived_at IS NULL
          ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
        authUser.userId, ...workspaceArgs, limit, offset,
      );
      const sharedTotal = (await db.queryOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM nf_project_members m
           INNER JOIN nf_projects p ON p.id = m.project_id
          WHERE m.user_id = ? AND ${workspaceClause} AND p.archived_at IS NULL`,
        authUser.userId, ...workspaceArgs,
      ))?.c ?? 0;
      return NextResponse.json({
        projects: sharedRows.map(r => {
          const role = String(r.member_role ?? 'viewer');
          return { ...rowToProject(r), role: role as 'editor' | 'viewer', canEdit: role === 'editor' };
        }),
        pagination: {
          page, limit, total: sharedTotal,
          totalPages: Math.ceil(sharedTotal / limit),
          hasNext: page * limit < sharedTotal, hasPrev: page > 1,
        },
      });
    } catch {
      // Members table absent (no shares ever) — return an empty shared list.
      return NextResponse.json({
        projects: [],
        pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      });
    }
  }

  const archivedFilter = showArchived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
  const ownedWorkspaceClause = context.orgId ? 'org_id = ?' : 'org_id IS NULL';
  const ownedWorkspaceArgs = context.orgId ? [context.orgId] : [];
  const totalRow = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ? AND ${ownedWorkspaceClause} AND ${archivedFilter}`,
    authUser.userId, ...ownedWorkspaceArgs,
  );
  const total = totalRow?.c ?? 0;

  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT * FROM nf_projects WHERE user_id = ? AND ${ownedWorkspaceClause} AND ${archivedFilter} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    authUser.userId, ...ownedWorkspaceArgs, limit, offset,
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
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return NextResponse.json({ error: 'Select a valid workspace', code: context.code }, { status: 409 });

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await readBoundedJson<Record<string, unknown>>(req, MAX_PROJECT_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error) ?? { code: 'BAD_REQUEST' as const, status: 400 as const };
    return NextResponse.json(
      {
        error: bounded.code === 'PAYLOAD_TOO_LARGE' ? 'Request too large' : 'Invalid JSON',
        ...(bounded.code === 'PAYLOAD_TOO_LARGE' ? { code: bounded.code } : {}),
      },
      { status: bounded.status },
    );
  }

  const parsed = createProjectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  // ── Server-side plan enforcement: project count limit ──
  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_projects ADD COLUMN org_id TEXT').catch(() => {});
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'pro')) {
    const countRow = await db.queryOne<{ c: number }>(
      context.orgId
        ? 'SELECT COUNT(*) as c FROM nf_projects WHERE org_id = ? AND archived_at IS NULL'
        : 'SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ? AND org_id IS NULL AND archived_at IS NULL',
      context.orgId ?? authUser.userId,
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
       (id, user_id, org_id, name, shape_id, material_id, scene_data, thumbnail, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    authUser.userId,
    context.orgId,
    safeName,
    body.shapeId ?? null,
    body.materialId ?? null,
    body.sceneData ?? null,
    body.thumbnail ?? null,
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
  recordUsage({ userId: authUser.userId, orgId: context.orgId, product: 'nexyfab', metric: 'project_create', metadata: JSON.stringify({ projectId: project.id }) }).catch(() => {});

  // Onboarding funnel: 첫 프로젝트 저장은 깔때기 핵심 단계.
  // first_save 이벤트는 이 user 의 첫 project_create 일 때만 발사 — 두 번째
  // 프로젝트는 paywall에서 막히거나 Pro 결제 후라 funnel 의미가 다르다.
  void (async () => {
    try {
      const c = await db.queryOne<{ c: number }>(
        context.orgId
          ? 'SELECT COUNT(*) as c FROM nf_projects WHERE org_id = ?'
          : 'SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ? AND org_id IS NULL',
        context.orgId ?? authUser.userId,
      );
      if (Number(c?.c ?? 0) === 1) {
        const { logFunnelEvent } = await import('@/lib/funnel-logger');
        await logFunnelEvent(authUser.userId, {
          eventType: 'first_save',
          contextType: 'project',
          contextId: project.id,
        });
      }
    } catch { /* swallow */ }
  })();

  return NextResponse.json({ project }, { status: 201 });
}
