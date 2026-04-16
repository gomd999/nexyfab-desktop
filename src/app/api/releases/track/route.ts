/**
 * POST /api/releases/track
 * 다운로드 카운터 증가 (fire-and-forget, 공개 API)
 * body: { platform: 'win_x64' | 'mac_aarch64' | 'mac_x64' | 'linux_x64', version?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const VALID_PLATFORMS = ['win_x64', 'mac_aarch64', 'mac_x64', 'linux_x64'] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

const COL: Record<Platform, string> = {
  win_x64:     'dl_win_x64',
  mac_aarch64: 'dl_mac_aarch64',
  mac_x64:     'dl_mac_x64',
  linux_x64:   'dl_linux_x64',
};

export async function POST(req: NextRequest) {
  try {
    const { platform, version } = await req.json() as { platform: string; version?: string };

    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      return NextResponse.json({ error: 'invalid platform' }, { status: 400 });
    }

    const col = COL[platform as Platform];
    const db = getDbAdapter();

    if (version) {
      // 특정 버전 카운트
      await db.execute(
        `UPDATE nf_releases SET ${col} = ${col} + 1 WHERE version = ?`,
        version,
      );
    } else {
      // 최신 버전 카운트
      await db.execute(
        `UPDATE nf_releases SET ${col} = ${col} + 1 WHERE is_latest = 1`,
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    // 카운터 실패는 조용히 무시 (UX 방해 금지)
    return NextResponse.json({ ok: true });
  }
}
