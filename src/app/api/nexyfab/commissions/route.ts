import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface ContractRow {
  id: string;
  project_name: string;
  contract_amount: number;
  plan: string | null;
  commission_rate: number;
  gross_commission: number;
  plan_deduction: number;
  final_charge: number;
  commission_status: string | null;
  created_at: string;
}

// GET /api/nexyfab/commissions
// 인증된 사용자 본인의 수수료 내역 (nf_contracts 기반)
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();

  const userRow = await db.queryOne<{ email: string }>(
    'SELECT email FROM nf_users WHERE id = ?',
    authUser.userId,
  );
  if (!userRow) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const rows = await db.queryAll<ContractRow>(
    `SELECT id, project_name, contract_amount, plan, commission_rate,
            gross_commission, plan_deduction, final_charge,
            commission_status, created_at
     FROM nf_contracts
     WHERE customer_email = ?
       AND contract_amount IS NOT NULL
       AND commission_rate IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 100`,
    userRow.email,
  );

  const commissions = rows.map(r => {
    const raw = r.commission_status ?? 'pending';
    const status: 'paid' | 'invoiced' | 'pending' =
      raw === 'paid' ? 'paid' : raw === 'invoiced' ? 'invoiced' : 'pending';

    return {
      projectName:     r.project_name,
      contractAmount:  r.contract_amount,
      plan:            r.plan === 'premium' ? 'premium' : 'standard',
      commissionRate:  r.commission_rate,
      grossCommission: r.gross_commission ?? 0,
      planDeduction:   r.plan_deduction ?? 0,
      finalCharge:     r.final_charge ?? 0,
      status,
      date:            String(r.created_at ?? '').slice(0, 10),
    };
  });

  return NextResponse.json({ commissions });
}
