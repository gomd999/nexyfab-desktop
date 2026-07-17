// 요청 정합(intent-match) 텔레메트리 조회 — KW_MAP/판정부 보강용 실데이터.
// Auth: x-admin-secret header (verifyAdmin → ADMIN_SECRET).
// GET ?limit=50&mismatched=1  → 불일치 발생 건만(최신순).
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { listIntentLogs } from '@/lib/intentTelemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const mismatchedOnly = url.searchParams.get('mismatched') === '1';
  const rows = await listIntentLogs(limit, mismatchedOnly);
  return NextResponse.json({
    ok: true,
    count: rows.length,
    rows: rows.map((r) => ({
      ...r,
      results: safeParse(r.results),
      assumptions: safeParse(r.assumptions),
      repair: safeParse(r.repair),
    })),
  });
}
