/**
 * Tauri 자동 업데이트 엔드포인트
 * GET /api/desktop-update/{target}/{arch}/{current_version}
 *
 * target: windows-x86_64 | linux-x86_64 | darwin-x86_64 | darwin-aarch64
 * arch:   x86_64 | aarch64
 * current_version: 0.1.0
 *
 * 응답:
 * - 204: 최신 버전 (업데이트 없음)
 * - 200: 업데이트 정보 JSON
 *
 * 서명 환경변수 (Railway에 설정):
 *   TAURI_SIG_WIN_X64    — NexyFab_x.x.x_x64_en-US.msi.sig 내용
 *   TAURI_SIG_MAC_AARCH64 — NexyFab_x.x.x_aarch64.dmg.sig 내용
 *   TAURI_SIG_MAC_X64    — NexyFab_x.x.x_x64.dmg.sig 내용
 *   TAURI_SIG_LINUX_X64  — nexyfab_x.x.x_amd64.AppImage.sig 내용
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

// 서명 환경변수 fallback (DB에 없을 때)
const SIG_ENV: Record<string, string> = {
  'windows-x86_64': process.env.TAURI_SIG_WIN_X64 ?? '',
  'darwin-aarch64':  process.env.TAURI_SIG_MAC_AARCH64 ?? '',
  'darwin-x86_64':   process.env.TAURI_SIG_MAC_X64 ?? '',
  'linux-x86_64':    process.env.TAURI_SIG_LINUX_X64 ?? '',
};

const DOWNLOAD_FIELD: Record<string, keyof ReleaseRow> = {
  'windows-x86_64': 'download_win_x64',
  'darwin-aarch64':  'download_mac_aarch64',
  'darwin-x86_64':   'download_mac_x64',
  'linux-x86_64':    'download_linux_x64',
};

const SIG_FIELD: Record<string, keyof ReleaseRow> = {
  'windows-x86_64': 'sig_win_x64',
  'darwin-aarch64':  'sig_mac_aarch64',
  'darwin-x86_64':   'sig_mac_x64',
  'linux-x86_64':    'sig_linux_x64',
};

interface ReleaseRow {
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
}

function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ target: string; arch: string; current_version: string }> },
) {
  const { target, current_version } = await params;

  if (!DOWNLOAD_FIELD[target]) {
    return new NextResponse(`Unsupported target: ${target}`, { status: 400 });
  }

  // DB에서 최신 릴리즈 조회
  let release: ReleaseRow | undefined;
  try {
    const db = getDbAdapter();
    release = await db.queryOne<ReleaseRow>(
      `SELECT version, pub_date, notes,
              download_win_x64, download_mac_aarch64, download_mac_x64, download_linux_x64,
              sig_win_x64, sig_mac_aarch64, sig_mac_x64, sig_linux_x64
         FROM nf_releases WHERE is_latest = 1 LIMIT 1`,
    );
  } catch { /* DB 미초기화 시 env fallback */ }

  // DB 미설정이면 환경변수로 fallback
  const FALLBACK_BASE = process.env.TAURI_RELEASE_BASE_URL ?? 'https://nexyfab.com/releases';
  const FALLBACK_VERSION = '0.1.0';
  const latestVersion = release?.version ?? FALLBACK_VERSION;

  // 현재 버전이 최신이면 204
  if (!semverGt(latestVersion, current_version)) {
    return new NextResponse(null, { status: 204 });
  }

  // 다운로드 URL
  const downloadUrl = release
    ? (release[DOWNLOAD_FIELD[target]] as string | null)
    : `${FALLBACK_BASE}/${latestVersion}/${target.includes('windows') ? `NexyFab_${latestVersion}_x64_en-US.msi` : target.includes('darwin') ? `NexyFab_${latestVersion}_${target.includes('aarch64') ? 'aarch64' : 'x64'}.dmg` : `nexyfab_${latestVersion}_amd64.AppImage`}`;

  // 서명 (DB 우선, 없으면 env)
  const signature = (release ? (release[SIG_FIELD[target]] as string | null) : null)
    ?? SIG_ENV[target]
    ?? '';

  if (!signature) {
    return new NextResponse(
      `Update signature not configured for ${target}.`,
      { status: 503 },
    );
  }

  if (!downloadUrl) {
    return new NextResponse(`No download URL for ${target}.`, { status: 503 });
  }

  return NextResponse.json({
    version: latestVersion,
    notes: release?.notes ?? `## NexyFab ${latestVersion}\n\n- 최신 릴리즈`,
    pub_date: release?.pub_date ?? new Date().toISOString(),
    platforms: {
      [target]: { signature, url: downloadUrl },
    },
  });
}
