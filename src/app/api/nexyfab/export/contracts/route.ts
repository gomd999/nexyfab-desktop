import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { rowsToCsv, sheetsToXlsxBuffer } from '@/lib/tabular-export';
import { buildContractExport, type ContractExportRecord, type RfqExportRecord } from './i18n';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx'; // 'xlsx' | 'csv'
  const db = getDbAdapter();

  const userRow = await db.queryOne<{ email: string; language: string | null }>(
    'SELECT email, language FROM nf_users WHERE id = ?',
    authUser.userId,
  );
  const userEmail = userRow?.email ?? '';

  const contracts = await db.queryAll<ContractExportRecord>(
    'SELECT id, project_name, customer_email, factory_name, contract_amount, commission_rate, final_charge, status, created_at FROM nf_contracts WHERE customer_email = ? ORDER BY created_at DESC',
    userEmail,
  );

  const rfqs = await db.queryAll<RfqExportRecord>(
    'SELECT id, shape_name, material_id, quantity, status, quote_amount, created_at FROM nf_rfqs WHERE user_id = ? ORDER BY created_at DESC',
    authUser.userId,
  );

  const { contractRows, rfqRows, sheetNames } = buildContractExport(contracts, rfqs, userRow?.language);

  if (format === 'csv') {
    const csv = rowsToCsv(contractRows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contracts-${Date.now()}.csv"`,
      },
    });
  }

  const buf = await sheetsToXlsxBuffer([
    { name: sheetNames[0], rows: contractRows },
    { name: sheetNames[1], rows: rfqRows },
  ]);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nexyfab-contracts-${Date.now()}.xlsx"`,
    },
  });
}
