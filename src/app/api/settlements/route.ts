import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface SettlementRow {
  id: string;
  contract_id: string;
  project_name: string;
  factory_name: string;
  contract_amount: number;
  commission_rate: number;
  gross_commission: number;
  plan_deduction: number;
  final_charge: number;
  is_first_contract: number;
  first_contract_discount: number;
  status: string;
  invoice_number: string | null;
  invoiced_at: string | null;
  paid_at: string | null;
  notes: string;
  created_at: string;
}

function rowToSettlement(r: SettlementRow) {
  return {
    id: r.id,
    contractId: r.contract_id,
    projectName: r.project_name,
    factoryName: r.factory_name,
    contractAmount: r.contract_amount,
    commissionRate: r.commission_rate,
    grossCommission: r.gross_commission,
    planDeduction: r.plan_deduction,
    finalCharge: r.final_charge,
    isFirstContract: r.is_first_contract === 1,
    firstContractDiscount: r.first_contract_discount,
    status: r.status,
    invoiceNumber: r.invoice_number,
    invoicedAt: r.invoiced_at,
    paidAt: r.paid_at,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

// GET /api/settlements — 정산 목록 전체 반환 (admin only)
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50', 10));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const vals: unknown[] = [];
  if (status) { conditions.push('status = ?'); vals.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_settlements ${where}`, ...vals,
  );
  const total = countRow?.cnt ?? 0;
  const rows = await db.queryAll<SettlementRow>(
    `SELECT * FROM nf_settlements ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...vals, limit, offset,
  );

  return NextResponse.json({
    settlements: rows.map(rowToSettlement),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// POST /api/settlements — 정산 기록 생성 (admin only)
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json();
  const {
    contractId, projectName, factoryName, contractAmount,
    commissionRate, grossCommission, planDeduction, finalCharge,
    isFirstContract, firstContractDiscount, notes,
  } = body;

  if (!contractId || !projectName || contractAmount == null) {
    return NextResponse.json(
      { error: 'contractId, projectName, contractAmount는 필수입니다.' },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const existing = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_settlements WHERE contract_id = ?', contractId,
  );
  if (existing) {
    return NextResponse.json(
      { error: '해당 계약의 정산 항목이 이미 존재합니다.' },
      { status: 409 },
    );
  }

  const id = `STL-${Date.now()}`;
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO nf_settlements
      (id, contract_id, project_name, factory_name, contract_amount, commission_rate,
       gross_commission, plan_deduction, final_charge, is_first_contract,
       first_contract_discount, status, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    id, contractId, projectName, factoryName || '', contractAmount ?? 0,
    commissionRate ?? 0, grossCommission ?? 0, planDeduction ?? 0,
    finalCharge ?? 0, isFirstContract ? 1 : 0, firstContractDiscount ?? 0,
    notes || '', now,
  );

  const row = await db.queryOne<SettlementRow>('SELECT * FROM nf_settlements WHERE id = ?', id);
  return NextResponse.json({ settlement: rowToSettlement(row!) }, { status: 201 });
}
