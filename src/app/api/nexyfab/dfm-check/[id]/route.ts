/**
 * GET /api/nexyfab/dfm-check/[id]
 *
 * DFM 검증 1건의 상세 결과를 소유자에게만 반환. RFQ 페이지에서
 * `?dfmCheckId=` 로 진입했을 때 Context Summary 카드를 그리기 위한 read-only 엔드포인트.
 *
 * 응답은 UI 가 즉시 쓰기 좋은 모양으로 평탄화한다 — 파싱 실패는
 * 빈 배열로 강제(컨텍스트 카드가 안 그려지는 게 카드가 깨지는 것보다 낫다).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface DfmCheckRow {
  id:           string;
  user_id:      string;
  file_id:      string | null;
  input_params: string | null;
  issues:       number;
  warnings:     number;
  items:        string | null;
  next_action:  string | null;
  created_at:   number;
}

function safeParseArray(s: string | null): unknown[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObject(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db  = getDbAdapter();
  const row = await db.queryOne<DfmCheckRow>(
    `SELECT id, user_id, file_id, input_params, issues, warnings, items, next_action, created_at
       FROM nf_dfm_check
      WHERE id = ?`,
    id,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.user_id !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const items  = safeParseArray(row.items);
  const params0 = safeParseObject(row.input_params);

  return NextResponse.json({
    id:          row.id,
    fileId:      row.file_id,
    issues:      Number(row.issues)   || 0,
    warnings:    Number(row.warnings) || 0,
    nextAction:  row.next_action ?? 'pending',
    createdAt:   Number(row.created_at),
    inputParams: params0,
    items,
  });
}
