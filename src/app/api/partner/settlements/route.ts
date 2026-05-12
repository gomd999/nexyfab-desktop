/**
 * GET /api/partner/settlements
 * Returns completed contract settlement summary for the authenticated partner.
 *
 * Query params:
 *  - month (optional): YYYY-MM filter
 *
 * Response:
 *  {
 *    settlements: SettlementItem[],
 *    summary: { totalRevenue, totalCommission, netRevenue, count }
 *  }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { COMMISSION_PCT_DEFAULT } from '@/lib/commission';

export const dynamic = 'force-dynamic';

// Fallback only for legacy contracts missing commission_rate; the actual
// rate per contract is read from nf_contracts.commission_rate so it
// matches what was contractually agreed.
const FALLBACK_COMMISSION_RATE = COMMISSION_PCT_DEFAULT / 100;

export interface SettlementItem {
  contractId: string;
  projectName: string;
  customerEmail: string | null;
  contractAmount: number;
  commissionAmount: number;
  netAmount: number;
  completedAt: string;
  month: string; // YYYY-MM
}

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const monthFilter = searchParams.get('month'); // e.g. "2025-03"

  const db = getDbAdapter();

  // Build WHERE clause
  const conditions: string[] = [
    `status = 'completed'`,
    `partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
  ];
  const vals: unknown[] = [normPartnerEmail(partner.email)];

  if (monthFilter) {
    conditions.push(`strftime('%Y-%m', COALESCE(completed_at, updated_at)) = ?`);
    vals.push(monthFilter);
  }

  type ContractRow = {
    id: string; project_name: string; customer_email: string | null;
    contract_amount: number | null; commission_rate: number | null;
    gross_commission: number | null;
    completed_at: string | null; updated_at: string | null;
  };

  const rows = await db.queryAll<ContractRow>(
    `SELECT id, project_name, customer_email, contract_amount,
            commission_rate, gross_commission,
            completed_at, updated_at
     FROM nf_contracts
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(completed_at, updated_at) DESC
     LIMIT 200`,
    ...vals,
  ).catch((): ContractRow[] => []);

  const settlements: SettlementItem[] = rows.map(r => {
    const amount = r.contract_amount ?? 0;
    // Prefer the per-contract gross_commission stored at contract time;
    // fall back to commission_rate × amount; final fallback to default.
    const commission = r.gross_commission != null
      ? r.gross_commission
      : r.commission_rate != null
        ? Math.round(amount * r.commission_rate / 100)
        : Math.round(amount * FALLBACK_COMMISSION_RATE);
    const net = amount - commission;
    const completedAt = r.completed_at ?? r.updated_at ?? new Date().toISOString();
    return {
      contractId: r.id,
      projectName: r.project_name,
      customerEmail: r.customer_email,
      contractAmount: amount,
      commissionAmount: commission,
      netAmount: net,
      completedAt,
      month: completedAt.slice(0, 7),
    };
  });

  const summary = {
    totalRevenue: settlements.reduce((s, i) => s + i.contractAmount, 0),
    totalCommission: settlements.reduce((s, i) => s + i.commissionAmount, 0),
    netRevenue: settlements.reduce((s, i) => s + i.netAmount, 0),
    count: settlements.length,
  };

  return NextResponse.json({ settlements, summary });
}
