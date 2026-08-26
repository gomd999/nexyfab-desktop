import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { verifyAdmin } from '@/lib/admin-auth';
import { rowsToCsv, sheetsToXlsxBuffer } from '@/lib/tabular-export';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';
import { buildLocalizedTabularExport } from '../i18n';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get('from'); // ISO date string or timestamp
  const to = req.nextUrl.searchParams.get('to');
  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx';
  const locale = resolveServerLocale(req, req.nextUrl.searchParams.get('lang'));

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

  const data = rows.map(row => ({ ...row }));
  const localized = buildLocalizedTabularExport('audit', data, locale.iso);

  if (format === 'csv') {
    const csv = rowsToCsv(localized.rows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${Date.now()}.csv"`,
      },
    });
  }

  const buf = await sheetsToXlsxBuffer([{ name: localized.sheetName, rows: localized.rows }]);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nexyfab-audit-${Date.now()}.xlsx"`,
    },
  });
}
