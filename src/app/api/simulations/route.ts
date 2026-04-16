import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { getDbAdapter } from '@/lib/db-adapter';

function generateShareCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export const dynamic = 'force-dynamic';

// POST /api/simulations — 시뮬레이션 저장
export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  try {
    const body = await req.json();
    const { name, inputs, results } = body;

    if (!name || !inputs || !results) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
    }

    const db = getDbAdapter();

    // 중복 없는 shareCode 생성
    let shareCode = generateShareCode();
    let collision = await db.queryOne<{ id: string }>(
      'SELECT id FROM nf_simulations WHERE share_code = ?', shareCode,
    ).catch(() => null);
    while (collision) {
      shareCode = generateShareCode();
      collision = await db.queryOne<{ id: string }>(
        'SELECT id FROM nf_simulations WHERE share_code = ?', shareCode,
      ).catch(() => null);
    }

    const id = 'SIM-' + Date.now().toString(36).toUpperCase();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30일

    await db.execute(
      `INSERT INTO nf_simulations (id, share_code, name, inputs, results, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, shareCode, name, JSON.stringify(inputs), JSON.stringify(results), createdAt, expiresAt,
    );

    // 만료된 항목 정리 (비동기, 실패 무시)
    db.execute(
      `DELETE FROM nf_simulations WHERE expires_at < ?`,
      new Date().toISOString(),
    ).catch(() => {});

    const origin = req.headers.get('origin') || '';
    const shareUrl = `${origin}/simulator?share=${shareCode}`;

    return NextResponse.json({ id, shareCode, shareUrl }, { status: 201 });
  } catch (err) {
    console.error('[simulations POST]', err);
    return NextResponse.json({ error: '서버 오류' }, { status: 500 });
  }
}

// GET /api/simulations?code=xxx — 공유 코드로 시뮬레이션 조회
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'code 파라미터 필요' }, { status: 400 });
  }

  const db = getDbAdapter();
  const row = await db.queryOne<{
    id: string; name: string; inputs: string; results: string; created_at: string; expires_at: string;
  }>(
    `SELECT id, name, inputs, results, created_at, expires_at
     FROM nf_simulations
     WHERE share_code = ? AND expires_at > ?`,
    code, new Date().toISOString(),
  ).catch(() => null);

  if (!row) {
    return NextResponse.json({ error: '시뮬레이션을 찾을 수 없거나 만료되었습니다.' }, { status: 404 });
  }

  let inputs: Record<string, unknown> = {};
  let results: Record<string, unknown> = {};
  try { inputs = JSON.parse(row.inputs) as Record<string, unknown>; } catch { }
  try { results = JSON.parse(row.results) as Record<string, unknown>; } catch { }

  return NextResponse.json({
    id: row.id,
    name: row.name,
    inputs,
    results,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}
