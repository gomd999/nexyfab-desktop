/**
 * GET /api/releases/latest
 * 공개 API — 최신 릴리즈 정보를 반환합니다.
 * DB에 릴리즈가 없으면 환경변수 fallback을 사용합니다.
 */
import { NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const FALLBACK_BASE = process.env.TAURI_RELEASE_BASE_URL ?? 'https://nexyfab.com/releases';
const FALLBACK_VERSION = '0.1.0';

export interface LatestRelease {
  id: string;
  version: string;
  pub_date: string;
  notes: string;
  download_win_x64: string | null;
  download_mac_aarch64: string | null;
  download_mac_x64: string | null;
  download_linux_x64: string | null;
}

export async function GET() {
  try {
    const db = getDbAdapter();
    const row = await db.queryOne<LatestRelease>(
      `SELECT id, version, pub_date, notes,
              download_win_x64, download_mac_aarch64, download_mac_x64, download_linux_x64
         FROM nf_releases
        WHERE is_latest = 1
        LIMIT 1`,
    );

    if (row) {
      return NextResponse.json(row, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      });
    }
  } catch {
    // DB 미초기화 상태에서도 fallback 응답
  }

  // Fallback: DB에 릴리즈 없으면 환경변수/기본값 사용
  const v = FALLBACK_VERSION;
  const fallback: LatestRelease = {
    id: 'fallback',
    version: v,
    pub_date: '2026-04-15T00:00:00Z',
    notes: `## NexyFab ${v}\n\n- 초기 데스크톱 릴리즈\n- 네이티브 파일 저장/열기\n- 오프라인 3D 모델링`,
    download_win_x64: `${FALLBACK_BASE}/${v}/NexyFab_${v}_x64_ko-KR.msi`,
    download_mac_aarch64: `${FALLBACK_BASE}/${v}/NexyFab_${v}_aarch64.dmg`,
    download_mac_x64: `${FALLBACK_BASE}/${v}/NexyFab_${v}_x64.dmg`,
    download_linux_x64: `${FALLBACK_BASE}/${v}/nexyfab_${v}_amd64.AppImage`,
  };

  return NextResponse.json(fallback, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
