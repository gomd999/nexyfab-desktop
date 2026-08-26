import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rowsToCsv, sheetsToXlsxBuffer } from '@/lib/tabular-export';
import { resolveRequestOrgContext } from '@/lib/org-context';
import { buildLocalizedTabularExport } from '../../export/i18n';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'pro')) return NextResponse.json({ error: 'Pro plan required for ERP export.' }, { status: 403 });
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return NextResponse.json({ error: 'Select a valid workspace', code: context.code }, { status: 409 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') ?? 'contracts'; // contracts | rfqs | quotes
  const format = (sp.get('format') ?? 'excel') as 'csv' | 'excel' | 'json';
  const from = sp.get('from') ? parseInt(sp.get('from')!, 10) : Date.now() - 90 * 86_400_000;
  const to   = sp.get('to')   ? parseInt(sp.get('to')!,   10) : Date.now();

  const db = getDbAdapter();
  const user = await db.queryOne<{ language: string | null }>('SELECT language FROM nf_users WHERE id = ?', authUser.userId);
  await db.execute('ALTER TABLE nf_rfqs ADD COLUMN org_id TEXT').catch(() => {});
  await db.execute('ALTER TABLE nf_orders ADD COLUMN org_id TEXT').catch(() => {});
  const rfqScope = context.orgId ? 'r.org_id = ?' : 'r.user_id = ? AND r.org_id IS NULL';
  const orderScope = context.orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL';
  const scopeArg = context.orgId ?? authUser.userId;
  let rows: Record<string, unknown>[] = [];

  if (type === 'rfqs') {
    rows = await db.queryAll<Record<string, unknown>>(
      `SELECT id, shape_name AS part_name, material_id AS material,
              quantity, quote_amount AS quoted_price_krw, status, note,
              created_at, updated_at
       FROM nf_rfqs r WHERE ${rfqScope} AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 2000`,
      scopeArg, from, to,
    );
  } else if (type === 'quotes') {
    rows = await db.queryAll<Record<string, unknown>>(
      `SELECT q.id, q.inquiry_id AS rfq_id, q.factory_name AS manufacturer_name,
              q.estimated_amount AS total_price_krw, q.valid_until, q.status, q.created_at
       FROM nf_quotes q
       JOIN nf_rfqs r ON r.id = q.inquiry_id
       WHERE ${rfqScope} AND q.created_at BETWEEN ? AND ?
       ORDER BY q.created_at DESC LIMIT 2000`,
      scopeArg, from, to,
    );
  } else {
    // contracts (nf_orders)
    rows = await db.queryAll<Record<string, unknown>>(
      `SELECT id, rfq_id, part_name, manufacturer_name, quantity,
              total_price_krw, status, created_at, estimated_delivery_at
       FROM nf_orders WHERE ${orderScope} AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 2000`,
      scopeArg, from, to,
    );
  }

  // Format timestamps as ISO strings
  const jsonRows = rows.map(r => ({
    ...r,
    created_at: r.created_at ? new Date(r.created_at as number).toISOString() : null,
    updated_at: r.updated_at ? new Date(r.updated_at as number).toISOString() : null,
    estimated_delivery_at: r.estimated_delivery_at ? new Date(r.estimated_delivery_at as number).toISOString() : null,
  }));

  if (format === 'json') {
    return NextResponse.json({ type, count: jsonRows.length, data: jsonRows });
  }

  const exportKind = type === 'rfqs' ? 'rfqs' : type === 'quotes' ? 'erp-quotes' : 'orders';
  const localized = buildLocalizedTabularExport(exportKind, rows, user?.language);

  const filename = `nexyfab_${type}_${new Date().toISOString().slice(0, 10)}`;

  if (format === 'csv') {
    const csv = rowsToCsv(localized.rows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }

  const excelBuf = await sheetsToXlsxBuffer([{ name: localized.sheetName, rows: localized.rows }]);
  return new NextResponse(Buffer.from(excelBuf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
    },
  });
}
