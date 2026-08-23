import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { assertReleasedSceneEditAllowed } from '@/lib/nfProjectReleasedGuard';
import { assertIfMatchUpdatedAt } from '@/lib/nfProjectConcurrency';
import type { NexyfabProject } from '../projects-types';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { ensureProjectMembersTable as _ensureProjectMembersTable, resolveProjectAccess, type NfProjectAccess } from '@/lib/nfProjectAccess';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

type ProjectAccess = NfProjectAccess;
type ProjectPatchBody = Partial<NexyfabProject> & {
  restoreVersionId?: string;
  archived?: boolean;
  ifMatchUpdatedAt?: number | string;
};

// Keep parity with project creation: escaped 5M-code-unit sceneData plus envelope.
const MAX_PROJECT_PATCH_BODY_BYTES = 32 * 1024 * 1024;

function rowToProject(row: Record<string, unknown>, access?: Pick<ProjectAccess, 'role' | 'canEdit'>): NexyfabProject {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    thumbnail: (row.thumbnail as string) || undefined,
    shapeId: (row.shape_id as string) || undefined,
    materialId: (row.material_id as string) || undefined,
    sceneData: (row.scene_data as string) || undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    // pg intentionally returns BIGINT as strings. Normalize the public API so
    // clients can round-trip these millisecond revision tokens as numbers.
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archivedAt: row.archived_at == null ? undefined : Number(row.archived_at),
    role: access?.role ?? 'owner',
    canEdit: access?.canEdit ?? true,
  };
}

async function ensureVersionsTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_project_versions (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      version_num INTEGER NOT NULL,
      shape_id    TEXT,
      material_id TEXT,
      scene_data  TEXT,
      label       TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pv_project ON nf_project_versions(project_id, version_num DESC);
  `).catch(() => {});
}

// 스냅샷 저장 (최대 20개 유지) — version row `user_id`는 프로젝트 소유자로 통일 (에디터 저장 시에도)
async function saveSnapshot(projectId: string, ownerUserId: string, row: Record<string, unknown>) {
  try {
    await ensureVersionsTable();
    const db = getDbAdapter();

    const countRow = await db.queryOne<{ c: number }>(
      'SELECT COUNT(*) as c FROM nf_project_versions WHERE project_id = ?', projectId,
    );
    const count = countRow?.c ?? 0;

    // 최신 스냅샷과 내용이 같으면 저장 skip (sceneData 기준)
    const lastSnap = await db.queryOne<{ scene_data: string }>(
      'SELECT scene_data FROM nf_project_versions WHERE project_id = ? ORDER BY version_num DESC LIMIT 1', projectId,
    );
    if (lastSnap?.scene_data === (row.scene_data as string)) return;

    const nextVersion = count + 1;
    const snapId = `pv-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.execute(
      `INSERT INTO nf_project_versions (id, project_id, user_id, version_num, shape_id, material_id, scene_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      snapId, projectId, ownerUserId, nextVersion,
      row.shape_id ?? null, row.material_id ?? null, row.scene_data ?? null, Date.now(),
    );

    // 20개 초과 시 가장 오래된 것 삭제
    if (count >= 20) {
      await db.execute(
        `DELETE FROM nf_project_versions WHERE project_id = ? AND id = (
           SELECT id FROM nf_project_versions WHERE project_id = ? ORDER BY version_num ASC LIMIT 1
         )`, projectId, projectId,
      );
    }
  } catch { /* 스냅샷 실패는 silent */ }
}

// ─── GET /api/nexyfab/projects/[id] ──────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  // versions 쿼리 파라미터가 있으면 버전 목록 반환
  if (req.nextUrl.searchParams.has('versions')) {
    const access = await resolveProjectAccess(db, id, authUser);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await ensureVersionsTable();
    const rows = await db.queryAll<{
      id: string; version_num: number; shape_id: string | null;
      material_id: string | null; created_at: number;
    }>(
      `SELECT id, version_num, shape_id, material_id, created_at
       FROM nf_project_versions WHERE project_id = ?
       ORDER BY version_num DESC LIMIT 20`,
      id,
    );
    return NextResponse.json({ versions: rows });
  }

  const access = await resolveProjectAccess(db, id, authUser);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ project: rowToProject(access.row, access) });
}

// ─── PATCH /api/nexyfab/projects/[id] ────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  // Guard: an empty/garbled body (e.g. dropped on a 308 redirect) must not 500.
  let body: ProjectPatchBody | null;
  try {
    body = await readBoundedJson<ProjectPatchBody>(req, MAX_PROJECT_PATCH_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error) ?? { code: 'BAD_REQUEST' as const, status: 400 as const };
    if (bounded.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request too large', code: bounded.code }, { status: bounded.status });
    }
    body = null;
  }
  if (!body) return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });

  const db = getDbAdapter();
  const now = Date.now();

  const access = await resolveProjectAccess(db, id, authUser);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── 보관/복원 요청 — 소유자만 ─────────────────────────────────────────────
  if ('archived' in body) {
    if (access.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the project owner can archive or unarchive.', code: 'PROJECT_OWNER_ONLY' },
        { status: 403 },
      );
    }
    // Free plan: a user can have only 1 active (unarchived) project. Block
    // unarchive when at the limit so the user can't sneak around the Pro
    // gate by archiving project A and unarchiving project B back-to-back.
    if (body.archived === false) {
      const userRow = await db.queryOne<{ plan: string }>(
        'SELECT plan FROM nf_users WHERE id = ?', authUser.userId,
      ).catch(() => null);
      if (userRow?.plan === 'free' || !userRow?.plan) {
        const countRow = await db.queryOne<{ c: number }>(
          'SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ? AND archived_at IS NULL',
          authUser.userId,
        );
        if (Number(countRow?.c ?? 0) >= 1) {
          return NextResponse.json(
            {
              error: 'Free plan limit reached (1 active project). Upgrade to Pro to restore additional projects.',
              code: 'FREE_PROJECT_LIMIT',
            },
            { status: 403 },
          );
        }
      }
    }
    const result = await db.execute(
      'UPDATE nf_projects SET archived_at = ?, updated_at = ? WHERE id = ?',
      body.archived ? now : null, now, id,
    );
    if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const updated = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ?', id);
    if (!updated) return NextResponse.json({ error: 'Project not found after update' }, { status: 500 });
    const ip = getTrustedClientIpOrUndefined(req.headers);
    logAudit({ userId: authUser.userId, action: body.archived ? 'project.archive' : 'project.unarchive', resourceId: id, ip });
    return NextResponse.json({ project: rowToProject(updated, access) });
  }

  // ── 버전 복원 요청 — 편집 가능한 멤버(소유자·에디터) ─────────────────────
  if (body.restoreVersionId) {
    if (!access.canEdit) {
      return NextResponse.json(
        { error: 'Read-only access', code: 'PROJECT_READ_ONLY' },
        { status: 403 },
      );
    }
    await ensureVersionsTable();
    const snap = await db.queryOne<{ scene_data: string; shape_id: string; material_id: string }>(
      'SELECT scene_data, shape_id, material_id FROM nf_project_versions WHERE id = ? AND project_id = ?',
      body.restoreVersionId, id,
    );
    if (!snap) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

    // 복원 전 현재 상태를 스냅샷으로 저장
    const current = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ?', id);
    if (current) await saveSnapshot(id, access.ownerUserId, current);

    await db.execute(
      `UPDATE nf_projects SET scene_data = ?, shape_id = ?, material_id = ?, updated_at = ?
       WHERE id = ?`,
      snap.scene_data, snap.shape_id, snap.material_id, now, id,
    );
    const updated = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ?', id);
    if (!updated) return NextResponse.json({ error: 'Project not found after restore' }, { status: 500 });
    const ip = getTrustedClientIpOrUndefined(req.headers);
    logAudit({
      userId: authUser.userId,
      action: 'project.version_restore',
      resourceId: id,
      ip,
      metadata: { restoreVersionId: body.restoreVersionId },
    });
    return NextResponse.json({ project: rowToProject(updated, access), restored: true });
  }

  // ── 현재 상태 스냅샷 저장 후 업데이트 — 편집 권한 필요 ─────────────────
  if (!access.canEdit) {
    return NextResponse.json(
      { error: 'Read-only access', code: 'PROJECT_READ_ONLY' },
      { status: 403 },
    );
  }

  const current = access.row;

  let expectedUpdatedAt: number | undefined;
  if (body.ifMatchUpdatedAt !== undefined) {
    const m = assertIfMatchUpdatedAt(current.updated_at as number | string, body.ifMatchUpdatedAt);
    if (!m.ok) {
      const ip = getTrustedClientIpOrUndefined(req.headers);
      logAudit({
        userId: authUser.userId,
        action: 'project.update_conflict',
        resourceId: id,
        ip,
        metadata: { clientExpected: body.ifMatchUpdatedAt, serverActual: current.updated_at },
      });
      return NextResponse.json(
        {
          error: m.message,
          code: 'PROJECT_VERSION_CONFLICT',
          serverUpdatedAt: m.serverUpdatedAt,
          clientExpected: m.clientExpected,
        },
        { status: 409 },
      );
    }
    expectedUpdatedAt = Number(body.ifMatchUpdatedAt);
  }

  if (body.sceneData !== undefined) {
    const guard = assertReleasedSceneEditAllowed(
      current.scene_data as string | null | undefined,
      body.sceneData,
    );
    if (!guard.ok) {
      return NextResponse.json({ error: guard.message }, { status: 403 });
    }
  }

  // sceneData가 실제로 변경될 때만 스냅샷
  if (body.sceneData && body.sceneData !== current.scene_data) {
    void saveSnapshot(id, access.ownerUserId, current);
  }

  // A compare performed only in application code is racy: two writers can
  // both read the same revision and then overwrite each other. Include the
  // expected revision in the UPDATE predicate to make this a real CAS.
  const currentUpdatedAt = Number(current.updated_at);
  const nextUpdatedAt = Math.max(now, Number.isSafeInteger(currentUpdatedAt) ? currentUpdatedAt + 1 : now);
  const updateSql = `UPDATE nf_projects SET
       name       = COALESCE(?, name),
       shape_id   = COALESCE(?, shape_id),
       material_id= COALESCE(?, material_id),
       scene_data = COALESCE(?, scene_data),
       thumbnail  = COALESCE(?, thumbnail),
       tags       = COALESCE(?, tags),
       updated_at = ?
     WHERE id = ?${expectedUpdatedAt === undefined ? '' : ' AND updated_at = ?'}`;
  const updateArgs = [
    body.name ?? null,
    body.shapeId ?? null,
    body.materialId ?? null,
    body.sceneData ?? null,
    body.thumbnail ?? null,
    body.tags !== undefined ? JSON.stringify(body.tags) : null,
    nextUpdatedAt,
    id,
    ...(expectedUpdatedAt === undefined ? [] : [expectedUpdatedAt]),
  ];
  const result = await db.execute(
    updateSql,
    ...updateArgs,
  );

  if (result.changes === 0) {
    if (expectedUpdatedAt !== undefined) {
      const latest = await db.queryOne<{ updated_at: number | string }>(
        'SELECT updated_at FROM nf_projects WHERE id = ?',
        id,
      );
      if (latest) {
        const conflict = assertIfMatchUpdatedAt(latest.updated_at, expectedUpdatedAt);
        const serverUpdatedAt = conflict.ok ? Number(latest.updated_at) : conflict.serverUpdatedAt;
        const ip = getTrustedClientIpOrUndefined(req.headers);
        logAudit({
          userId: authUser.userId,
          action: 'project.update_conflict',
          resourceId: id,
          ip,
          metadata: { clientExpected: expectedUpdatedAt, serverActual: latest.updated_at, atomic: true },
        });
        return NextResponse.json(
          {
            error: conflict.ok
              ? 'Conflict: the project changed during this save. Reload the project, then save again.'
              : conflict.message,
            code: 'PROJECT_VERSION_CONFLICT',
            serverUpdatedAt,
            clientExpected: expectedUpdatedAt,
          },
          { status: 409 },
        );
      }
    }
    return NextResponse.json({ error: 'Not found or access denied' }, { status: 404 });
  }

  const updated = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_projects WHERE id = ?',
    id,
  );
  if (!updated) return NextResponse.json({ error: 'Project not found after update' }, { status: 500 });

  const ip = getTrustedClientIpOrUndefined(req.headers);
  const sceneChanged = !!(body.sceneData && body.sceneData !== current.scene_data);
  const nameChanged = !!(body.name && body.name !== current.name);
  if (sceneChanged || nameChanged || body.shapeId !== undefined || body.materialId !== undefined) {
    logAudit({
      userId: authUser.userId,
      action: 'project.update',
      resourceId: id,
      ip,
      metadata: { sceneChanged, nameChanged },
    });
  }

  return NextResponse.json({ project: rowToProject(updated, access) });
}

// ─── DELETE /api/nexyfab/projects/[id] ───────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, authUser);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can delete this project.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  await ensureVersionsTable();
  let deletedChanges = 0;
  await db.transaction(async transaction => {
    // These legacy auxiliary tables do not all carry FK cascades. Remove them
    // with the project so collaboration presence, snapshots, invites, and
    // comments cannot become orphaned personal data.
    await transaction.execute('DELETE FROM nf_collab_sessions WHERE project_id = ?', id);
    await transaction.execute('DELETE FROM nf_project_versions WHERE project_id = ?', id);
    await transaction.execute('DELETE FROM nf_comments WHERE project_id = ?', id);
    await transaction.execute('DELETE FROM nf_project_invites WHERE project_id = ?', id);
    await transaction.execute('DELETE FROM nf_project_members WHERE project_id = ?', id);
    const deleted = await transaction.execute('DELETE FROM nf_projects WHERE id = ?', id);
    deletedChanges = deleted.changes;
  });

  if (deletedChanges === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({ userId: authUser.userId, action: 'project.delete', resourceId: id, ip });

  return NextResponse.json({ ok: true });
}
