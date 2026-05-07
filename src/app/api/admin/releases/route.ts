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

/**
 * Default file-name convention used by Tauri v2 bundler.
 * If the CI / caller omits download URLs, we derive them from S3_PUBLIC_URL + version.
 * (S3_PUBLIC_URL is the project-wide R2 public URL convention used by src/lib/storage.ts.)
 */
function deriveDefaultUrls(version: string): Partial<ReleaseRow> {
  const base = (
    process.env.S3_PUBLIC_URL
    ?? process.env.R2_PUBLIC_URL
    ?? process.env.TAURI_RELEASE_BASE_URL
    ?? ''
  ).replace(/\/$/, '');
  if (!base) return {};
  const dir = `${base}/releases/${version}`;
  return {
    download_win_x64:     `${dir}/NexyFab_${version}_x64_ko-KR.msi`,
    download_mac_aarch64: `${dir}/NexyFab_${version}_aarch64.dmg`,
    download_mac_x64:     `${dir}/NexyFab_${version}_x64.dmg`,
    download_linux_x64:   `${dir}/nexyfab_${version}_amd64.AppImage`,
  };
}

// POST — 릴리즈 등록 또는 업데이트
export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as Omit<Partial<ReleaseRow>, 'is_latest'> & {
    version: string;
    is_latest?: boolean | number;
  };
  if (!body.version?.trim()) {
    return NextResponse.json({ error: 'version is required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const defaults = deriveDefaultUrls(body.version);
  const markLatest = body.is_latest === true || body.is_latest === 1;

  const winUrl = body.download_win_x64 ?? defaults.download_win_x64 ?? null;
  const macArmUrl = body.download_mac_aarch64 ?? defaults.download_mac_aarch64 ?? null;
  const macIntelUrl = body.download_mac_x64 ?? defaults.download_mac_x64 ?? null;
  const linuxUrl = body.download_linux_x64 ?? defaults.download_linux_x64 ?? null;

  // 같은 버전이 이미 있으면 UPDATE
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM nf_releases WHERE version = ?`, body.version,
  );

  const targetId = await db.transaction(async (tx) => {
    if (existing) {
      await tx.execute(
        `UPDATE nf_releases SET
          pub_date             = COALESCE(?, pub_date),
          notes                = COALESCE(?, notes),
          download_win_x64     = ?,
          download_mac_aarch64 = ?,
          download_mac_x64     = ?,
          download_linux_x64   = ?,
          sig_win_x64          = COALESCE(?, sig_win_x64),
          sig_mac_aarch64      = COALESCE(?, sig_mac_aarch64),
          sig_mac_x64          = COALESCE(?, sig_mac_x64),
          sig_linux_x64        = COALESCE(?, sig_linux_x64)
         WHERE id = ?`,
        body.pub_date ?? null,
        body.notes ?? null,
        winUrl, macArmUrl, macIntelUrl, linuxUrl,
        body.sig_win_x64 ?? null,
        body.sig_mac_aarch64 ?? null,
        body.sig_mac_x64 ?? null,
        body.sig_linux_x64 ?? null,
        existing.id,
      );
      if (markLatest) {
        await tx.execute(`UPDATE nf_releases SET is_latest = 0 WHERE id != ?`, existing.id);
        await tx.execute(`UPDATE nf_releases SET is_latest = 1 WHERE id = ?`, existing.id);
      }
      return existing.id;
    }

    const id = randomUUID();
    const now = Date.now();
    if (markLatest) {
      await tx.execute(`UPDATE nf_releases SET is_latest = 0`);
    }
    await tx.execute(
      `INSERT INTO nf_releases
         (id, version, pub_date, notes,
          download_win_x64, download_mac_aarch64, download_mac_x64, download_linux_x64,
          sig_win_x64, sig_mac_aarch64, sig_mac_x64, sig_linux_x64,
          is_latest, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      body.version,
      body.pub_date ?? new Date().toISOString(),
      body.notes ?? '',
      winUrl, macArmUrl, macIntelUrl, linuxUrl,
      body.sig_win_x64 ?? null,
      body.sig_mac_aarch64 ?? null,
      body.sig_mac_x64 ?? null,
      body.sig_linux_x64 ?? null,
      markLatest ? 1 : 0,
      now,
    );
    return id;
  });

  const row = await db.queryOne<ReleaseRow>(`SELECT * FROM nf_releases WHERE id = ?`, targetId);
  return NextResponse.json(row, { status: existing ? 200 : 201 });
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
