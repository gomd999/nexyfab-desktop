import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface SettlementRow {
  id: string; contract_id: string; project_name: string; factory_name: string;
  contract_amount: number; commission_rate: number; gross_commission: number;
  plan_deduction: number; final_charge: number; is_first_contract: number;
  first_contract_discount: number; status: string; invoice_number: string | null;
  invoiced_at: string | null; paid_at: string | null; notes: string; created_at: string;
}

function rowToSettlement(r: SettlementRow) {
  return {
    id: r.id, contractId: r.contract_id, projectName: r.project_name,
    factoryName: r.factory_name, contractAmount: r.contract_amount,
    commissionRate: r.commission_rate, grossCommission: r.gross_commission,
    planDeduction: r.plan_deduction, finalCharge: r.final_charge,
    isFirstContract: r.is_first_contract === 1,
    firstContractDiscount: r.first_contract_discount,
    status: r.status, invoiceNumber: r.invoice_number,
    invoicedAt: r.invoiced_at, paidAt: r.paid_at,
    notes: r.notes, createdAt: r.created_at,
  };
}

async function generateInvoiceNumber(db: ReturnType<typeof getDbAdapter>): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const row = await db.queryOne<{ max_seq: number }>(
    `SELECT MAX(CAST(REPLACE(invoice_number, ?, '') AS INTEGER)) as max_seq
     FROM nf_settlements WHERE invoice_number LIKE ?`,
    prefix, `${prefix}%`,
  );
  const nextSeq = (row?.max_seq ?? 0) + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

// PATCH /api/settlements/[id] — status 업데이트, notes 수정 (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const { status, notes } = body;

  const db = getDbAdapter();
  const current = await db.queryOne<SettlementRow>('SELECT * FROM nf_settlements WHERE id = ?', id);
  if (!current) return NextResponse.json({ error: '정산 항목을 찾을 수 없습니다.' }, { status: 404 });

  // notes만 업데이트
  if (status === undefined && notes !== undefined) {
    await db.execute('UPDATE nf_settlements SET notes = ? WHERE id = ?', notes, id);
    const updated = await db.queryOne<SettlementRow>('SELECT * FROM nf_settlements WHERE id = ?', id);
    return NextResponse.json({ settlement: rowToSettlement(updated!) });
  }

  if (!status) {
    return NextResponse.json({ error: 'status 또는 notes 중 하나는 필수입니다.' }, { status: 400 });
  }

  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['invoiced'],
    invoiced: ['paid'],
    paid: [],
  };
  if (!VALID_TRANSITIONS[current.status]?.includes(status)) {
    return NextResponse.json(
      { error: `${current.status} → ${status} 상태 전환은 허용되지 않습니다.` },
      { status: 400 },
    );
  }

  const setClauses: string[] = ['status = ?'];
  const setVals: unknown[] = [status];

  if (status === 'invoiced') {
    const invNum = await generateInvoiceNumber(db);
    setClauses.push('invoice_number = ?', 'invoiced_at = ?');
    setVals.push(invNum, new Date().toISOString());
  }
  if (status === 'paid') {
    setClauses.push('paid_at = ?');
    setVals.push(new Date().toISOString());
  }
  if (notes !== undefined) {
    setClauses.push('notes = ?');
    setVals.push(notes);
  }

  await db.execute(
    `UPDATE nf_settlements SET ${setClauses.join(', ')} WHERE id = ?`,
    ...setVals, id,
  );

  const updated = await db.queryOne<SettlementRow>('SELECT * FROM nf_settlements WHERE id = ?', id);
  return NextResponse.json({ settlement: rowToSettlement(updated!) });
}
