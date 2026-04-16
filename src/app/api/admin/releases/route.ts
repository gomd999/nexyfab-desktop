/**
 * GET  /api/admin/releases       — 릴리즈 목록
 * POST /api/admin/releases       — 새 릴리즈 등록 / 기존 버전 업데이트
 * PATCH /api/admin/releases      — is_latest 전환 (body: { id })
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

interface ReleaseRow {
  id: string;
  version: string;
  pub_date: string;
  notes: string;
  download_win_x64: string | null;
  download_mac_aarch64: string | null;
  download_mac_x64: string | null;
  download_linux_x64: string | null;
  sig_win_x64: string | null;
  sig_mac_aarch64: string | null;
  sig_mac_x64: string | null;
  sig_linux_x64: string | null;
  is_latest: number;
  created_at: number;
}

// GET — 릴리즈 목록 (최신순)
export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const rows = await db.queryAll<ReleaseRow>(
    `SELECT * FROM nf_releases ORDER BY created_at DESC`,
  );
  return NextResponse.json(rows);
}

// POST — 릴리즈 등록 또는 업데이트
export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as Partial<ReleaseRow> & { version: string };
  if (!body.version?.trim()) {
    return NextResponse.json({ error: 'version is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // 같은 버전이 이미 있으면 UPDATE
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM nf_releases WHERE version = ?`, body.version,
  );

  if (existing) {
    await db.execute(
      `UPDATE nf_releases SET
        pub_date             = COALESCE(?, pub_date),
        notes                = COALESCE(?, notes),
        download_win_x64     = ?,
        download_mac_aarch64 = ?,
        download_mac_x64     = ?,
        download_linux_x64   = ?,
        sig_win_x64          = ?,
        sig_mac_aarch64      = ?,
        sig_mac_x64          = ?,
        sig_linux_x64        = ?
       WHERE id = ?`,
      body.pub_date ?? null,
      body.notes ?? null,
      body.download_win_x64 ?? null,
      body.download_mac_aarch64 ?? null,
      body.download_mac_x64 ?? null,
      body.download_linux_x64 ?? null,
      body.sig_win_x64 ?? null,
      body.sig_mac_aarch64 ?? null,
      body.sig_mac_x64 ?? null,
      body.sig_linux_x64 ?? null,
      existing.id,
    );
    const updated = await db.queryOne<ReleaseRow>(`SELECT * FROM nf_releases WHERE id = ?`, existing.id);
    return NextResponse.json(updated);
  }

  // INSERT
  const id = randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_releases
       (id, version, pub_date, notes,
        download_win_x64, download_mac_aarch64, download_mac_x64, download_linux_x64,
        sig_win_x64, sig_mac_aarch64, sig_mac_x64, sig_linux_x64,
        is_latest, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    id,
    body.version,
    body.pub_date ?? new Date().toISOString(),
    body.notes ?? '',
    body.download_win_x64 ?? null,
    body.download_mac_aarch64 ?? null,
    body.download_mac_x64 ?? null,
    body.download_linux_x64 ?? null,
    body.sig_win_x64 ?? null,
    body.sig_mac_aarch64 ?? null,
    body.sig_mac_x64 ?? null,
    body.sig_linux_x64 ?? null,
    now,
  );

  const created = await db.queryOne<ReleaseRow>(`SELECT * FROM nf_releases WHERE id = ?`, id);
  return NextResponse.json(created, { status: 201 });
}

// PATCH — 특정 릴리즈를 latest로 설정
export async function PATCH(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const db = getDbAdapter();

  await db.transaction(async (tx) => {
    await tx.execute(`UPDATE nf_releases SET is_latest = 0`);
    await tx.execute(`UPDATE nf_releases SET is_latest = 1 WHERE id = ?`, id);
  });

  const updated = await db.queryOne<ReleaseRow>(`SELECT * FROM nf_releases WHERE id = ?`, id);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}
