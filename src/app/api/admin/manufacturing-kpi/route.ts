/**
 * GET /api/admin/manufacturing-kpi
 * 제조업 퍼널 KPI: RFQ → 배정 → 견적 → 계약 전환율
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const nowMs = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const [
    rfqTotals,
    rfqMtd,
    quoteTotals,
    quoteMtd,
    contractTotals,
    avgResponseMs,
    topFactories,
    monthlyFunnel,
  ] = await Promise.all([

    // RFQ 전체 상태별 집계
    db.queryAll<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) as cnt FROM nf_rfqs GROUP BY status`,
    ),

    // 이번 달 RFQ
    db.queryOne<{ cnt: number; assigned: number }>(
      `SELECT
         COUNT(*) as cnt,
         SUM(CASE WHEN assigned_factory_id IS NOT NULL THEN 1 ELSE 0 END) as assigned
       FROM nf_rfqs WHERE created_at >= ?`,
      monthStartMs,
    ),

    // 견적 전체 상태별 집계
    db.queryAll<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) as cnt FROM nf_quotes GROUP BY status`,
    ),

    // 이번 달 견적
    db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM nf_quotes
       WHERE created_at >= ?`,
      new Date(monthStart).toISOString(),
    ),

    // 계약 전체 상태별 집계 (nf_contracts)
    db.queryAll<{ status: string; cnt: number; total_amount: number }>(
      `SELECT status, COUNT(*) as cnt, COALESCE(SUM(contract_amount), 0) as total_amount
       FROM nf_contracts GROUP BY status`,
    ).catch(() => [] as { status: string; cnt: number; total_amount: number }[]),

    // RFQ → 견적 평균 응답 시간 (ms)
    db.queryOne<{ avg_ms: number }>(
      `SELECT AVG(q.created_at_ms - r.created_at) as avg_ms
       FROM nf_quotes q
       JOIN nf_rfqs r ON q.inquiry_id = r.id
       WHERE q.created_at IS NOT NULL`,
    ).catch(() => undefined),

    // 배정 많은 제조사 TOP 5
    db.queryAll<{ factory_id: string; factory_name: string; cnt: number; quoted: number }>(
      `SELECT
         r.assigned_factory_id AS factory_id,
         COALESCE(f.name, r.assigned_factory_id) AS factory_name,
         COUNT(*) AS cnt,
         SUM(CASE WHEN r.status IN ('quoted','accepted') THEN 1 ELSE 0 END) AS quoted
       FROM nf_rfqs r
       LEFT JOIN nf_factories f ON r.assigned_factory_id = f.id
       WHERE r.assigned_factory_id IS NOT NULL
       GROUP BY r.assigned_factory_id
       ORDER BY cnt DESC LIMIT 5`,
    ).catch(() => [] as { factory_id: string; factory_name: string; cnt: number; quoted: number }[]),

    // 월별 RFQ / 견적 / 계약 추이 (최근 6개월)
    db.queryAll<{ month: string; rfq_cnt: number }>(
      `SELECT
         strftime('%Y-%m', datetime(created_at / 1000, 'unixepoch')) AS month,
         COUNT(*) AS rfq_cnt
       FROM nf_rfqs
       WHERE created_at >= ?
       GROUP BY month ORDER BY month`,
      nowMs - 6 * 30 * 24 * 3600 * 1000,
    ).catch(() => [] as { month: string; rfq_cnt: number }[]),
  ]);

  // RFQ 상태 집계 → 오브젝트로 변환
  const rfqByStatus = Object.fromEntries(rfqTotals.map(r => [r.status, r.cnt]));
  const rfqTotal = rfqTotals.reduce((s, r) => s + r.cnt, 0);
  const rfqAssigned = (rfqByStatus.assigned ?? 0) +
    (rfqByStatus.quoted ?? 0) + (rfqByStatus.accepted ?? 0);

  // 견적 상태 집계
  const quoteByStatus = Object.fromEntries(quoteTotals.map(r => [r.status, r.cnt]));
  const quoteTotal = quoteTotals.reduce((s, r) => s + r.cnt, 0);

  // 계약 집계
  const contractByStatus = Object.fromEntries(contractTotals.map(r => [r.status, r.cnt]));
  const contractTotal = contractTotals.reduce((s, r) => s + r.cnt, 0);
  const contractRevenue = contractTotals.reduce((s, r) => s + r.total_amount, 0);

  // 전환율 계산
  const assignRate  = rfqTotal > 0 ? rfqAssigned / rfqTotal : 0;
  const quoteRate   = rfqAssigned > 0 ? quoteTotal / rfqAssigned : 0;
  const contractRate = quoteTotal > 0 ? contractTotal / quoteTotal : 0;

  const avgResponseHours = avgResponseMs?.avg_ms != null
    ? Math.round(avgResponseMs.avg_ms / 3_600_000)
    : null;

  return NextResponse.json({
    funnel: {
      rfqTotal,
      rfqAssigned,
      rfqMtd: rfqMtd?.cnt ?? 0,
      rfqMtdAssigned: rfqMtd?.assigned ?? 0,
      quoteTotal,
      quoteMtd: quoteMtd?.cnt ?? 0,
      quoteAccepted: quoteByStatus.accepted ?? 0,
      contractTotal,
      contractRevenue,
    },
    rates: {
      assignRate: parseFloat((assignRate * 100).toFixed(1)),
      quoteRate:  parseFloat((quoteRate * 100).toFixed(1)),
      contractRate: parseFloat((contractRate * 100).toFixed(1)),
    },
    avgResponseHours,
    rfqByStatus,
    quoteByStatus,
    contractByStatus,
    topFactories,
    monthlyFunnel,
  });
}
