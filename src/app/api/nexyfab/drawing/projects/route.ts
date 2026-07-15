/**
 * /api/nexyfab/drawing/projects — 설계 프로젝트 서버 저장 (계정 연동).
 * GET: 내 프로젝트 목록 · POST { name, domain, snapshot }: 저장(같은 이름 upsert)
 * · DELETE ?id=: 삭제. 인증 = getAuthUser(nf_access_token) — 비로그인 401(로컬
 * localStorage 저장은 클라이언트에 그대로 존재 — 서버 저장은 로그인 부가 기능).
 * 스키마: nf_design_projects (경량 JSON 스냅샷 — CREATE TABLE IF NOT EXISTS 멱등,
 * SQLite/Postgres 겸용 문법).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SNAPSHOT = 64 * 1024; // 64KB — 스냅샷은 파라미터 JSON(대형 형상 아님)
const MAX_PROJECTS = 100;

let schemaReady = false;
async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const db = getDbAdapter();
  await db.executeRaw(`CREATE TABLE IF NOT EXISTS nf_design_projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.executeRaw(`CREATE INDEX IF NOT EXISTS idx_nf_design_projects_owner ON nf_design_projects (owner_id, updated_at DESC)`);
  schemaReady = true;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: '로그인 필요 — 서버 저장은 계정 기능(브라우저 저장은 계속 사용 가능)' }, { status: 401 });
  await ensureSchema();
  const db = getDbAdapter();
  const rows = await db.queryAll(
    'SELECT id, name, domain, updated_at FROM nf_design_projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100',
    user.userId,
  );
  return NextResponse.json({ ok: true, projects: rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`design-projects:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: 401 });

  let body: { id?: string; name?: string; domain?: string; snapshot?: unknown; loadId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  await ensureSchema();
  const db = getDbAdapter();

  // 불러오기 모드 (스냅샷 본문 반환)
  if (body.loadId) {
    const row = await db.queryOne<{ snapshot: string }>(
      'SELECT snapshot FROM nf_design_projects WHERE id = ? AND owner_id = ?', body.loadId, user.userId,
    );
    if (!row) return NextResponse.json({ ok: false, error: '프로젝트 없음' }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot: JSON.parse(row.snapshot) });
  }

  const name = (body.name ?? '').trim().slice(0, 80);
  const domain = (body.domain ?? '').trim().slice(0, 30);
  if (!name || !domain || body.snapshot === undefined) {
    return NextResponse.json({ ok: false, error: 'name·domain·snapshot 필요' }, { status: 400 });
  }
  const snap = JSON.stringify(body.snapshot);
  if (snap.length > MAX_SNAPSHOT) return NextResponse.json({ ok: false, error: `스냅샷 ${Math.round(snap.length / 1024)}KB > 64KB — 파라미터만 저장하세요` }, { status: 413 });

  const cnt = await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM nf_design_projects WHERE owner_id = ?', user.userId);
  const now = new Date().toISOString();
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_design_projects WHERE owner_id = ? AND name = ? AND domain = ?', user.userId, name, domain,
  );
  if (existing) {
    await db.execute('UPDATE nf_design_projects SET snapshot = ?, updated_at = ? WHERE id = ?', snap, now, existing.id);
    return NextResponse.json({ ok: true, id: existing.id, updated: true });
  }
  if ((cnt?.n ?? 0) >= MAX_PROJECTS) return NextResponse.json({ ok: false, error: `프로젝트 ${MAX_PROJECTS}개 한도 — 정리 후 저장` }, { status: 409 });
  const id = `dp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute(
    'INSERT INTO nf_design_projects (id, owner_id, name, domain, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, user.userId, name, domain, snap, now, now,
  );
  return NextResponse.json({ ok: true, id, created: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id 필요' }, { status: 400 });
  await ensureSchema();
  const db = getDbAdapter();
  const r = await db.execute('DELETE FROM nf_design_projects WHERE id = ? AND owner_id = ?', id, user.userId);
  return NextResponse.json({ ok: true, deleted: r.changes });
}
