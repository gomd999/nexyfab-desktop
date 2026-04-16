import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx';
  const db = getDbAdapter();

  const quotes = await db.queryAll<{
    id: string; project_name: string; factory_name: string; estimated_amount: number;
    details: string; valid_until: string | null; partner_email: string | null;
    status: string; created_at: string; updated_at: string | null;
  }>(
    `SELECT q.* FROM nf_quotes q
     INNER JOIN nf_rfqs r ON q.inquiry_id = r.id
     WHERE r.user_id = ?
     ORDER BY q.created_at DESC`,
    authUser.userId,
  );

  const rows = quotes.map(q => ({
    'ID': q.id,
    '프로젝트명': q.project_name,
    '파트너명': q.factory_name,
    '견적 금액 (KRW)': q.estimated_amount,
    '상세 내용': q.details,
    '유효 기간': q.valid_until ?? '',
    '파트너 이메일': q.partner_email ?? '',
    '상태': q.status,
    '생성일': q.created_at,
    '수정일': q.updated_at ?? '',
  }));

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="quotes-${Date.now()}.csv"`,
      },
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '견적 목록');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nexyfab-quotes-${Date.now()}.xlsx"`,
    },
  });
}
