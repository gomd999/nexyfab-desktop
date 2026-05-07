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

  // 데모 데이터 격리 — nf_rfqs 는 user_id='demo-user' sentinel 로 판별.
  // nf_quotes/nf_contracts 는 현재 demo flow 에서 생성되지 않지만,
  // 미래 대비해 inquiry_id → nf_rfqs.user_id 로 역추적하는 NOT EXISTS 절 추가.
  // Design: "데모 모드 아키텍처 (project_nexyfab_demo_mode)" 참조.
  const DEMO_USER = 'demo-user';

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
      `SELECT status, COUNT(*) as cnt FROM nf_rfqs WHERE user_id <> ? GROUP BY status`,
      DEMO_USER,
    ),

    // 이번 달 RFQ
    db.queryOne<{ cnt: number; assigned: number }>(
      `SELECT
         COUNT(*) as cnt,
         SUM(CASE WHEN assigned_factory_id IS NOT NULL THEN 1 ELSE 0 END) as assigned
       FROM nf_rfqs WHERE created_at >= ? AND user_id <> ?`,
      monthStartMs, DEMO_USER,
    ),

    // 견적 전체 상태별 집계
    db.queryAll<{ status: string; cnt: number }>(
      `SELECT q.status AS status, COUNT(*) as cnt FROM nf_quotes q
         WHERE NOT EXISTS (
           SELECT 1 FROM nf_rfqs r WHERE r.id = q.inquiry_id AND r.user_id = ?
         )
         GROUP BY q.status`,
      DEMO_USER,
    ),

    // 이번 달 견적
    db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM nf_quotes q
       WHERE q.created_at >= ?
         AND NOT EXISTS (
           SELECT 1 FROM nf_rfqs r WHERE r.id = q.inquiry_id AND r.user_id = ?
         )`,
      new Date(monthStart).toISOString(), DEMO_USER,
    ),

    // 계약 전체 상태별 집계 — quote_id → nf_quotes → nf_rfqs 로 역추적
    db.queryAll<{ status: string; cnt: number; total_amount: number }>(
      `SELECT c.status AS status, COUNT(*) as cnt,
              COALESCE(SUM(c.contract_amount), 0) as total_amount
         FROM nf_contracts c
         WHERE NOT EXISTS (
           SELECT 1 FROM nf_quotes q JOIN nf_rfqs r ON r.id = q.inquiry_id
             WHERE q.id = c.quote_id AND r.user_id = ?
         )
         GROUP BY c.status`,
      DEMO_USER,
    ).catch(() => [] as { status: string; cnt: number; total_amount: number }[]),

    // RFQ → 견적 평균 응답 시간 (ms)
    db.queryOne<{ avg_ms: number }>(
      `SELECT AVG(q.created_at_ms - r.created_at) as avg_ms
       FROM nf_quotes q
       JOIN nf_rfqs r ON q.inquiry_id = r.id
       WHERE q.created_at IS NOT NULL AND r.user_id <> ?`,
      DEMO_USER,
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
       WHERE r.assigned_factory_id IS NOT NULL AND r.user_id <> ?
       GROUP BY r.assigned_factory_id
       ORDER BY cnt DESC LIMIT 5`,
      DEMO_USER,
    ).catch(() => [] as { factory_id: string; factory_name: string; cnt: number; quoted: number }[]),

    // 월별 RFQ / 견적 / 계약 추이 (최근 6개월)
    db.queryAll<{ month: string; rfq_cnt: number }>(
      `SELECT
         strftime('%Y-%m', datetime(created_at / 1000, 'unixepoch')) AS month,
         COUNT(*) AS rfq_cnt
       FROM nf_rfqs
       WHERE created_at >= ? AND user_id <> ?
       GROUP BY month ORDER BY month`,
      nowMs - 6 * 30 * 24 * 3600 * 1000, DEMO_USER,
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
