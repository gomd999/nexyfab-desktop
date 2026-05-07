/**
 * GET /api/partner/defects
 *
 * 공급사 본인 앞으로 제기된 불량·RMA 목록. partner_email 매칭 기준.
 * status 쿼리로 필터링, 기본 정렬 최신순. 미해결(under_review / approved /
 * disputed) 건을 우선 노출하기 위해 페이징은 클라이언트에서 섹션 분할.
 *
 * Design note (2026-04-23):
 *   리뷰와 달리 불량은 "사건" 차원이므로 partner-metrics 가 단일 점수로
 *   collapse 하지 않는다. 이 목록은 공급사가 직접 under_review / approved /
 *   rejected 로 전이하는 트리아지 화면에서 사용.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { ensureDefectsTable, rowToDefect, type DefectRow } from '@/lib/partner-defects';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await ensureDefectsTable(db);

  const status = req.nextUrl.searchParams.get('status') ?? '';
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)));

  const clause = status ? ' AND status = ?' : '';
  const pe = normPartnerEmail(partner.email);
  const args: unknown[] = status ? [pe, status] : [pe];

  const rows = await db.queryAll<DefectRow>(
    `SELECT * FROM nf_defects
       WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?${clause}
       ORDER BY
         CASE status
           WHEN 'reported'     THEN 0
           WHEN 'under_review' THEN 1
           WHEN 'disputed'     THEN 2
           WHEN 'approved'     THEN 3
           WHEN 'resolved'     THEN 4
           WHEN 'rejected'     THEN 5
           ELSE 6
         END,
         created_at DESC
       LIMIT ?`,
    ...args, limit,
  ).catch((): DefectRow[] => []);

  return NextResponse.json({
    defects: rows.map(rowToDefect),
  });
}
