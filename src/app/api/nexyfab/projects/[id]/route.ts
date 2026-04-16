import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import type { NexyfabProject } from '../projects-types';

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

// 스냅샷 저장 (최대 20개 유지)
async function saveSnapshot(projectId: string, userId: string, row: Record<string, unknown>) {
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
      snapId, projectId, userId, nextVersion,
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
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  // versions 쿼리 파라미터가 있으면 버전 목록 반환
  if (req.nextUrl.searchParams.has('versions')) {
    await ensureVersionsTable();
    const rows = await db.queryAll<{
      id: string; version_num: number; shape_id: string | null;
      material_id: string | null; created_at: number;
    }>(
      `SELECT id, version_num, shape_id, material_id, created_at
       FROM nf_project_versions WHERE project_id = ? AND user_id = ?
       ORDER BY version_num DESC LIMIT 20`,
      id, authUser.userId,
    );
    return NextResponse.json({ versions: rows });
  }

  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_projects WHERE id = ? AND user_id = ?', id, authUser.userId,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ project: rowToProject(row) });
}

// ─── PATCH /api/nexyfab/projects/[id] ────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as Partial<NexyfabProject> & { restoreVersionId?: string };

  const db = getDbAdapter();
  const now = Date.now();

  // ── 버전 복원 요청 ──────────────────────────────────────────────────────
  if (body.restoreVersionId) {
    await ensureVersionsTable();
    const snap = await db.queryOne<{ scene_data: string; shape_id: string; material_id: string }>(
      'SELECT scene_data, shape_id, material_id FROM nf_project_versions WHERE id = ? AND project_id = ? AND user_id = ?',
      body.restoreVersionId, id, authUser.userId,
    );
    if (!snap) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

    // 복원 전 현재 상태를 스냅샷으로 저장
    const current = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ?', id);
    if (current) await saveSnapshot(id, authUser.userId, current);

    await db.execute(
      `UPDATE nf_projects SET scene_data = ?, shape_id = ?, material_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      snap.scene_data, snap.shape_id, snap.material_id, now, id, authUser.userId,
    );
    const updated = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ?', id);
    return NextResponse.json({ project: rowToProject(updated!), restored: true });
  }

  // ── 현재 상태 스냅샷 저장 후 업데이트 ────────────────────────────────
  const current = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ? AND user_id = ?', id, authUser.userId);
  if (!current) return NextResponse.json({ error: 'Not found or access denied' }, { status: 404 });
  // sceneData가 실제로 변경될 때만 스냅샷
  if (body.sceneData && body.sceneData !== current.scene_data) {
    void saveSnapshot(id, authUser.userId, current);
  }

  const result = await db.execute(
    `UPDATE nf_projects SET
       name       = COALESCE(?, name),
       shape_id   = COALESCE(?, shape_id),
       material_id= COALESCE(?, material_id),
       scene_data = COALESCE(?, scene_data),
       thumbnail  = COALESCE(?, thumbnail),
       tags       = COALESCE(?, tags),
       updated_at = ?
     WHERE id = ? AND user_id = ?`,
    body.name ?? null,
    body.shapeId ?? null,
    body.materialId ?? null,
    body.sceneData ?? null,
    body.thumbnail ?? null,
    body.tags !== undefined ? JSON.stringify(body.tags) : null,
    now,
    id,
    authUser.userId,
  );

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Not found or access denied' }, { status: 404 });
  }

  const updated = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_projects WHERE id = ?',
    id,
  );

  return NextResponse.json({ project: rowToProject(updated!) });
}

// ─── DELETE /api/nexyfab/projects/[id] ───────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const db = getDbAdapter();
  const result = await db.execute(
    'DELETE FROM nf_projects WHERE id = ? AND user_id = ?',
    id, authUser.userId,
  );

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
