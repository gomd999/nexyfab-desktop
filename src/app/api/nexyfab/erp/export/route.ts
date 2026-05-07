import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rowsToCsv, sheetsToXlsxBuffer } from '@/lib/tabular-export';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'pro')) return NextResponse.json({ error: 'Pro plan required for ERP export.' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') ?? 'contracts'; // contracts | rfqs | quotes
  const format = (sp.get('format') ?? 'excel') as 'csv' | 'excel' | 'json';
  const from = sp.get('from') ? parseInt(sp.get('from')!, 10) : Date.now() - 90 * 86_400_000;
  const to   = sp.get('to')   ? parseInt(sp.get('to')!,   10) : Date.now();

  const db = getDbAdapter();
  let rows: Record<string, unknown>[] = [];

  if (type === 'rfqs') {
    rows = await db.queryAll<Record<string, unknown>>(
      `SELECT id, shape_name AS part_name, material_id AS material,
              quantity, quote_amount AS quoted_price_krw, status, note,
              created_at, updated_at
       FROM nf_rfqs WHERE user_id = ? AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 2000`,
      authUser.userId, from, to,
    );
  } else if (type === 'quotes') {
    rows = await db.queryAll<Record<string, unknown>>(
      `SELECT q.id, q.rfq_id, q.manufacturer_name, q.unit_price_krw,
              q.total_price_krw, q.lead_time_days, q.status, q.created_at
       FROM nf_quotes q
       JOIN nf_rfqs r ON r.id = q.rfq_id
       WHERE r.user_id = ? AND q.created_at BETWEEN ? AND ?
       ORDER BY q.created_at DESC LIMIT 2000`,
      authUser.userId, from, to,
    );
  } else {
    // contracts (nf_orders)
    rows = await db.queryAll<Record<string, unknown>>(
      `SELECT id, rfq_id, part_name, manufacturer_name, quantity,
              total_price_krw, status, created_at, estimated_delivery_at
       FROM nf_orders WHERE user_id = ? AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 2000`,
      authUser.userId, from, to,
    );
  }

  // Format timestamps as ISO strings
  const formatted = rows.map(r => ({
    ...r,
    created_at: r.created_at ? new Date(r.created_at as number).toISOString() : null,
    updated_at: r.updated_at ? new Date(r.updated_at as number).toISOString() : null,
    estimated_delivery_at: r.estimated_delivery_at ? new Date(r.estimated_delivery_at as number).toISOString() : null,
  }));

  if (format === 'json') {
    return NextResponse.json({ type, count: formatted.length, data: formatted });
  }

  const filename = `nexyfab_${type}_${new Date().toISOString().slice(0, 10)}`;

  if (format === 'csv') {
    const csv = rowsToCsv(formatted);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }

  const excelBuf = await sheetsToXlsxBuffer([{ name: type, rows: formatted }]);
  return new NextResponse(Buffer.from(excelBuf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
    },
  });
}
