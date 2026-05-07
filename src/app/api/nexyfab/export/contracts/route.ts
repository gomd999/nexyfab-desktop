import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { rowsToCsv, sheetsToXlsxBuffer } from '@/lib/tabular-export';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx'; // 'xlsx' | 'csv'
  const db = getDbAdapter();

  const userRow = await db.queryOne<{ email: string }>(
    'SELECT email FROM nf_users WHERE id = ?',
    authUser.userId,
  );
  const userEmail = userRow?.email ?? '';

  const contracts = await db.queryAll<{
    id: string; project_name: string; customer_email: string | null;
    factory_name: string | null; contract_amount: number | null;
    commission_rate: number | null; final_charge: number | null;
    status: string; created_at: string;
  }>(
    'SELECT id, project_name, customer_email, factory_name, contract_amount, commission_rate, final_charge, status, created_at FROM nf_contracts WHERE customer_email = ? ORDER BY created_at DESC',
    userEmail,
  );

  const rfqs = await db.queryAll<{
    id: string; shape_name: string; material_id: string; quantity: number;
    status: string; quote_amount: number | null; created_at: number;
  }>(
    'SELECT id, shape_name, material_id, quantity, status, quote_amount, created_at FROM nf_rfqs WHERE user_id = ? ORDER BY created_at DESC',
    authUser.userId,
  );

  const contractRows = contracts.map(c => ({
    'ID': c.id,
    '프로젝트명': c.project_name,
    '고객 이메일': c.customer_email ?? '',
    '파트너명': c.factory_name ?? '',
    '계약 금액 (KRW)': c.contract_amount ?? '',
    '수수료율 (%)': c.commission_rate != null ? Math.round(c.commission_rate * 100) : '',
    '실 청구액 (KRW)': c.final_charge ?? '',
    '상태': c.status,
    '계약일': c.created_at.slice(0, 10),
  }));

  const rfqRows = rfqs.map(r => ({
    'RFQ ID': r.id,
    '형상명': r.shape_name ?? '',
    '재료': r.material_id ?? '',
    '수량': r.quantity,
    '상태': r.status,
    '견적 금액 (KRW)': r.quote_amount ?? '',
    '생성일': new Date(r.created_at).toLocaleDateString('ko-KR'),
  }));

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
    { name: '계약 목록', rows: contractRows },
    { name: 'RFQ 목록', rows: rfqRows },
  ]);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nexyfab-contracts-${Date.now()}.xlsx"`,
    },
  });
}
