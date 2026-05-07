import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { verifyAdmin } from '@/lib/admin-auth';
import { rowsToCsv, sheetsToXlsxBuffer } from '@/lib/tabular-export';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get('from'); // ISO date string or timestamp
  const to = req.nextUrl.searchParams.get('to');
  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx';

  const db = getDbAdapter();

  const fromTs = from ? new Date(from).getTime() : Date.now() - 30 * 24 * 3600_000; // default 30 days
  const toTs = to ? new Date(to).getTime() : Date.now();

  const rows = await db.queryAll<{
    id: string; user_id: string; action: string; resource_id: string | null;
    metadata: string | null; ip: string | null; created_at: number;
  }>(
    'SELECT id, user_id, action, resource_id, metadata, ip, created_at FROM nf_audit_log WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 10000',
    fromTs, toTs,
  );

  const data = rows.map(r => ({
    'ID': r.id,
    '사용자 ID': r.user_id,
    '액션': r.action,
    '리소스 ID': r.resource_id ?? '',
    '메타데이터': r.metadata ?? '',
    'IP': r.ip ?? '',
    '시각': new Date(r.created_at).toLocaleString('ko-KR'),
  }));

  if (format === 'csv') {
    const csv = rowsToCsv(data);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${Date.now()}.csv"`,
      },
    });
  }

  const buf = await sheetsToXlsxBuffer([{ name: '감사 로그', rows: data }]);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nexyfab-audit-${Date.now()}.xlsx"`,
    },
  });
}
