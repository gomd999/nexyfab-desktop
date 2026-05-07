/**
 * GET /api/partner/settlement-pdf?partnerEmail=xxx&month=2025-03
 *
 * 해당 파트너의 해당 월 완료 계약 내역을 HTML 정산 내역서로 반환합니다.
 * 브라우저에서 Ctrl+P(인쇄) → PDF로 저장하는 방식으로 사용합니다.
 *
 * 인증: Authorization: Bearer <session> 헤더 필요
 * (partnerEmail은 세션에서 검증하므로 타 파트너 데이터 조회 불가)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getPartnerAuth } from '@/lib/partner-auth';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// ─── 금액 포맷 ────────────────────────────────────────────────────────────

function won(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

// ─── HTML 내역서 생성 ─────────────────────────────────────────────────────

function buildHtml(params: {
  partnerEmail: string;
  company: string;
  month: string;
  contracts: any[];
  issuedAt: string;
}): string {
  const { partnerEmail, company, month, contracts, issuedAt } = params;

  const rows = contracts.map((c: any) => {
    const amount: number = c.contractAmount ?? 0;
    const rate: number = c.commissionRate ?? 0;
    const gross: number = c.grossCommission ?? Math.round(amount * rate / 100);
    const deduction: number = c.planDeduction ?? 0;
    const finalCharge: number = c.finalCharge ?? Math.max(0, gross - deduction);

    return `
      <tr>
        <td>${c.id}</td>
        <td>${c.projectName}</td>
        <td style="text-align:right">${won(amount)}</td>
        <td style="text-align:center">${rate}%</td>
        <td style="text-align:right">${won(gross)}</td>
        <td style="text-align:right">${won(deduction)}</td>
        <td style="text-align:right;font-weight:bold">${won(finalCharge)}</td>
      </tr>`;
  }).join('');

  // 합계 계산
  const totalAmount = contracts.reduce((s: number, c: any) => s + (c.contractAmount ?? 0), 0);
  const totalGross = contracts.reduce((s: number, c: any) => s + (c.grossCommission ?? 0), 0);
  const totalDeduction = contracts.reduce((s: number, c: any) => s + (c.planDeduction ?? 0), 0);
  const totalFinal = contracts.reduce((s: number, c: any) => s + (c.finalCharge ?? 0), 0);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NexyFab 파트너 정산 내역서 — ${month}</title>
  <style>
    /* ── 기본 ── */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif;
      font-size: 13px;
      color: #111827;
      background: #fff;
      padding: 48px 56px;
      max-width: 900px;
      margin: 0 auto;
    }

    /* ── 헤더 ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 2px solid #1a56db;
    }
    .logo {
      font-size: 22px;
      font-weight: 900;
      color: #1a56db;
      letter-spacing: -0.5px;
    }
    .logo-sub {
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
    }
    .doc-title {
      text-align: right;
    }
    .doc-title h1 {
      font-size: 18px;
      font-weight: 800;
      color: #111827;
    }
    .doc-title p {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
    }

    /* ── 파트너 정보 ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 28px;
      padding: 16px 20px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }
    .info-item label {
      font-size: 10px;
      font-weight: 700;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 3px;
    }
    .info-item span {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
    }

    /* ── 계약 테이블 ── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    thead th {
      background: #1a56db;
      color: #fff;
      padding: 10px 12px;
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      white-space: nowrap;
    }
    thead th:nth-child(n+3) { text-align: right; }
    thead th:nth-child(4) { text-align: center; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    tbody td {
      padding: 9px 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 12px;
      color: #374151;
    }
    tbody tr:last-child td { border-bottom: none; }

    /* ── 합계 행 ── */
    .total-row {
      background: #eff6ff !important;
    }
    .total-row td {
      font-weight: 800 !important;
      color: #1a56db !important;
      border-top: 2px solid #1a56db !important;
      padding: 11px 12px !important;
    }

    /* ── 빈 상태 ── */
    .empty {
      text-align: center;
      padding: 40px 0;
      color: #9ca3af;
      font-size: 13px;
    }

    /* ── 하단 ── */
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .footer-note {
      font-size: 10px;
      color: #9ca3af;
      line-height: 1.6;
    }
    .stamp-area {
      text-align: center;
      width: 90px;
    }
    .stamp-box {
      width: 80px;
      height: 80px;
      border: 2px solid #e5e7eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: #d1d5db;
      margin: 0 auto 4px;
    }
    .stamp-label {
      font-size: 10px;
      color: #9ca3af;
    }

    /* ── 인쇄 CSS ── */
    @media print {
      body { padding: 20px 24px; }
      @page { margin: 15mm 15mm; size: A4; }
      .no-print { display: none !important; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- 인쇄 버튼 (인쇄 시 숨겨짐) -->
  <div class="no-print" style="text-align:right;margin-bottom:16px">
    <button
      onclick="window.print()"
      style="padding:8px 20px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer"
    >
      🖨️ PDF로 인쇄 / 저장
    </button>
  </div>

  <!-- 헤더 -->
  <div class="header">
    <div>
      <div class="logo">NexyFab</div>
      <div class="logo-sub">제조 파트너 플랫폼</div>
    </div>
    <div class="doc-title">
      <h1>파트너 정산 내역서</h1>
      <p>발행일: ${issuedAt}</p>
    </div>
  </div>

  <!-- 파트너 / 기간 정보 -->
  <div class="info-grid">
    <div class="info-item">
      <label>파트너사</label>
      <span>${company || '—'}</span>
    </div>
    <div class="info-item">
      <label>이메일</label>
      <span>${partnerEmail}</span>
    </div>
    <div class="info-item">
      <label>대상 기간</label>
      <span>${month}</span>
    </div>
    <div class="info-item">
      <label>계약 건수</label>
      <span>${contracts.length}건</span>
    </div>
  </div>

  <!-- 계약 내역 테이블 -->
  ${contracts.length === 0
    ? `<div class="empty">해당 기간에 완료된 계약이 없습니다.</div>`
    : `<table>
    <thead>
      <tr>
        <th>계약 ID</th>
        <th>프로젝트명</th>
        <th>계약금액</th>
        <th>수수료율</th>
        <th>수수료</th>
        <th>플랜공제</th>
        <th>최종수수료</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <!-- 합계 행 -->
      <tr class="total-row">
        <td colspan="2" style="text-align:right">합계</td>
        <td style="text-align:right">${won(totalAmount)}</td>
        <td style="text-align:center">—</td>
        <td style="text-align:right">${won(totalGross)}</td>
        <td style="text-align:right">${won(totalDeduction)}</td>
        <td style="text-align:right">${won(totalFinal)}</td>
      </tr>
    </tbody>
  </table>`
  }

  <!-- 하단 -->
  <div class="footer">
    <div class="footer-note">
      본 내역서는 NexyFab 플랫폼에서 자동 생성되었습니다.<br />
      문의: support@nexyfab.com<br />
      NexyFab은 제조 파트너 매칭 서비스를 제공합니다.
    </div>
    <div class="stamp-area">
      <div class="stamp-box">직인</div>
      <div class="stamp-label">NexyFab</div>
    </div>
  </div>

</body>
</html>`;
}

// ─── GET 핸들러 ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const partnerEmailParam = searchParams.get('partnerEmail');
  const month = searchParams.get('month'); // 예: 2025-03

  // 인증 검사
  const sessionPartner = await getPartnerAuth(req);

  // 세션이 있으면 세션 이메일 사용 (타 파트너 조회 방지), 없으면 쿼리 파라미터 사용
  let partnerEmail: string;
  let company = '';

  if (sessionPartner) {
    partnerEmail = sessionPartner.email;
    company = sessionPartner.company;
    // 쿼리 파라미터가 있고 세션과 불일치하면 거부
    if (
      partnerEmailParam
      && normPartnerEmail(partnerEmailParam) !== normPartnerEmail(partnerEmail)
    ) {
      return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 });
    }
  } else if (partnerEmailParam) {
    // 세션 없이 이메일만 넘긴 경우 — 어드민 인증 필수
    if (!(await verifyAdmin(req))) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }
    partnerEmail = partnerEmailParam;
  } else {
    return NextResponse.json({ error: 'partnerEmail 또는 인증 세션이 필요합니다.' }, { status: 401 });
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month 파라미터는 YYYY-MM 형식이어야 합니다.' }, { status: 400 });
  }

  // nf_contracts DB에서 해당 파트너 + 해당 월 완료 계약 조회
  const db = getDbAdapter();
  const rawContracts = await db.queryAll<{
    id: string; project_name: string; contract_amount: number | null;
    commission_rate: number | null; gross_commission: number | null;
    plan_deduction: number | null; final_charge: number | null;
    completed_at: string | null; created_at: string;
  }>(
    `SELECT id, project_name, contract_amount, commission_rate, gross_commission,
            plan_deduction, final_charge, completed_at, created_at
     FROM nf_contracts
     WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?
       AND status = 'completed'
       AND strftime('%Y-%m', COALESCE(completed_at, created_at)) = ?`,
    normPartnerEmail(partnerEmail), month,
  );

  const filtered = rawContracts.map(c => ({
    id: c.id,
    projectName: c.project_name,
    contractAmount: c.contract_amount ?? 0,
    commissionRate: c.commission_rate != null ? Math.round(c.commission_rate * 100) : 0,
    grossCommission: c.gross_commission ?? 0,
    planDeduction: c.plan_deduction ?? 0,
    finalCharge: c.final_charge ?? 0,
  }));

  const issuedAt = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const html = buildHtml({ partnerEmail, company, month, contracts: filtered, issuedAt });

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 캐시 방지
      'Cache-Control': 'no-store',
    },
  });
}
