/**
 * GET /api/partner/dashboard
 * Returns aggregated stats for the authenticated partner:
 *  - assigned RFQs (pending quote)
 *  - active contracts + progress
 *  - performance stats (response time, win rate)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const db = getDbAdapter();

  // ── 1. Assigned RFQs (from nf_rfqs via nf_factories link) ─────────────────
  // Partner's factory id = look up nf_factories where partner_email matches
  const factory = await db.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM nf_factories WHERE partner_email = ? LIMIT 1`,
    partner.email,
  ).catch(() => null);

  const assignedRfqs = factory
    ? await db.queryAll<{
        id: string; shape_name: string; material_id: string; quantity: number;
        status: string; created_at: number; assigned_at: number | null;
        dfm_score: number | null; volume_cm3: number; note: string | null;
      }>(
        `SELECT id, shape_name, material_id, quantity, status, created_at,
                assigned_at, dfm_score, volume_cm3, note
         FROM nf_rfqs WHERE assigned_factory_id = ?
         ORDER BY created_at DESC LIMIT 50`,
        factory.id,
      ).catch(() => [] as any[])
    : [];

  // ── 2. Partner quotes from DB ─────────────────────────────────────────────
  const myQuotes = await db.queryAll<{
    id: string; inquiry_id: string | null; project_name: string; status: string;
    estimated_amount: number; responded_at: number | null; created_at: string;
  }>(
    `SELECT id, inquiry_id, project_name, status, estimated_amount, responded_at, created_at
     FROM nf_quotes WHERE partner_email = ? ORDER BY created_at DESC LIMIT 50`,
    partner.email,
  ).catch(() => [] as any[]);

  // Active contracts from nf_contracts
  const nfContracts = await db.queryAll<{
    id: string; project_name: string; status: string;
    contract_amount: number | null; deadline: string | null;
    progress_percent: number; created_at: string;
    customer_email: string | null;
  }>(
    `SELECT id, project_name, status, contract_amount, deadline,
            progress_percent, created_at, customer_email
     FROM nf_contracts WHERE partner_email = ?
     ORDER BY created_at DESC`,
    partner.email,
  ).catch(() => [] as any[]);

  // ── 3. Performance stats ──────────────────────────────────────────────────
  const totalAssigned = assignedRfqs.length;
  const quotedCount = myQuotes.filter(q => q.status === 'responded').length;
  const acceptedContracts = nfContracts.filter(c => c.status !== 'cancelled').length;
  const completedContracts = nfContracts.filter(c => c.status === 'completed').length;
  const activeContracts = nfContracts.filter(
    c => ['contracted', 'in_progress', 'quality_check'].includes(c.status),
  );

  // Average response time from quotes (created_at vs responded_at)
  const responseTimes = myQuotes
    .filter(q => q.responded_at && q.created_at)
    .map(q => q.responded_at! - new Date(q.created_at).getTime());
  const avgResponseHours = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length / 3_600_000)
    : null;

  const winRate = quotedCount > 0
    ? Math.round((acceptedContracts / quotedCount) * 100)
    : null;

  // ── 4. Pending RFQs waiting for quote response ────────────────────────────
  const respondedInquiryIds = new Set(myQuotes.map(q => q.inquiry_id).filter(Boolean));
  const pendingQuoteRfqs = assignedRfqs.filter(r =>
    r.status === 'assigned' && !respondedInquiryIds.has(r.id),
  );

  return NextResponse.json({
    partner: {
      email: partner.email,
      company: partner.company,
      factoryId: factory?.id ?? null,
      factoryName: factory?.name ?? partner.company,
    },
    stats: {
      totalAssigned,
      pendingQuotes: pendingQuoteRfqs.length,
      activeContracts: activeContracts.length,
      completedContracts,
      avgResponseHours,
      winRate,
    },
    pendingRfqs: pendingQuoteRfqs.slice(0, 20).map(r => ({
      id: r.id,
      shapeName: r.shape_name,
      materialId: r.material_id,
      quantity: r.quantity,
      volume_cm3: r.volume_cm3,
      dfmScore: r.dfm_score,
      note: r.note,
      assignedAt: r.assigned_at ? new Date(r.assigned_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    activeContracts: activeContracts.slice(0, 20),
    recentQuotes: myQuotes.slice(0, 10).map(q => ({
      id: q.id,
      projectName: q.project_name,
      status: q.status,
      estimatedAmount: q.estimated_amount,
      respondedAt: q.responded_at ? new Date(q.responded_at).toISOString() : null,
      createdAt: q.createdAt,
    })),
  });
}
