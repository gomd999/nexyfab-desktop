import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

/** {{변수}} → 실제 값으로 치환 */
function applyTemplate(template: string, contract: any): string {
  const vars: Record<string, string> = {
    projectName: contract.project_name || '',
    clientName: contract.customer_contact ? (() => {
      try { return JSON.parse(contract.customer_contact)?.name || ''; } catch { return ''; }
    })() : '',
    factoryName: contract.factory_name || contract.partner_email || '',
    contractAmount: contract.contract_amount
      ? Number(contract.contract_amount).toLocaleString('ko-KR') + '원'
      : '',
    contractDate: contract.contract_date || formatDate(contract.created_at),
    warrantyPeriod: contract.warranty_period || '3개월',
    deadline: contract.deadline || '',
    partnerEmail: contract.partner_email || '',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? `{{${key}}}`);
}

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료',
  in_progress: '진행 중',
  quality_check: '품질 검수',
  delivered: '납품 완료',
  completed: '완료',
  cancelled: '취소됨',
};

function won(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('ko-KR') + '원';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// GET /api/contracts/{id}/pdf
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  const contract = await db.queryOne<{
    id: string; project_name: string; status: string;
    partner_email: string | null; factory_name: string | null;
    deadline: string | null; contract_amount: number | null;
    commission_rate: number | null; gross_commission: number | null;
    plan_deduction: number | null; final_charge: number | null;
    customer_email: string | null; customer_contact: string | null;
    quote_id: string | null; plan: string | null;
    progress_notes: string | null; template_id: string | null;
    created_at: string;
  }>(
    `SELECT id, project_name, status, partner_email, factory_name, deadline,
            contract_amount, commission_rate, gross_commission, plan_deduction, final_charge,
            customer_email, customer_contact, quote_id, plan, progress_notes,
            created_at
     FROM nf_contracts WHERE id = ?`,
    id,
  );

  if (!contract) {
    return new NextResponse('계약을 찾을 수 없습니다.', { status: 404 });
  }

  // 본인 계약만 조회 가능 (admin 제외)
  const isOwner =
    (contract.customer_email != null
      && normPartnerEmail(contract.customer_email) === normPartnerEmail(authUser.email))
    || (contract.partner_email != null
      && normPartnerEmail(contract.partner_email) === normPartnerEmail(authUser.email));
  const isAdmin = await verifyAdmin(req);
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 고객 담당자 파싱
  let customerContact: { name?: string; email?: string; phone?: string } = {};
  try { customerContact = JSON.parse(contract.customer_contact || '{}'); } catch { /* empty */ }

  // 진행 이력 파싱
  let progressNotes: { date: string; updatedBy: string; note: string }[] = [];
  try { progressNotes = JSON.parse(contract.progress_notes || '[]'); } catch { /* empty */ }

  // 수수료율 표시 (DB: decimal → percent)
  const commissionRatePct = contract.commission_rate != null
    ? Math.round(contract.commission_rate * 100)
    : 0;

  // 템플릿 본문: nf_email_templates에서 조회
  let templateBody = '';
  const templates = await db.queryAll<{ id: string; category: string | null; content: string }>(
    'SELECT id, category, content FROM nf_email_templates ORDER BY created_at DESC',
  ).catch(() => [] as { id: string; category: string | null; content: string }[]);

  if (templates.length > 0) {
    // category = 'contract' 우선 매칭
    const contractTpl = templates.find(t => t.category === 'contract' || t.category === 'contracts');
    if (contractTpl) templateBody = applyTemplate(contractTpl.content, contract);
    else templateBody = applyTemplate(templates[0].content, contract);
  }

  const progressRows = progressNotes
    .map(pn => `
      <tr>
        <td>${formatDate(pn.date)}</td>
        <td>${pn.updatedBy || '—'}</td>
        <td>${pn.note || ''}</td>
      </tr>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>계약서 — ${contract.project_name}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
      font-size: 13px; color: #111; background: #fff;
      padding: 48px; max-width: 860px; margin: 0 auto;
    }
    .doc-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      border-bottom: 3px solid #111; padding-bottom: 20px; margin-bottom: 28px;
    }
    .doc-header .logo { font-size: 26px; font-weight: 900; letter-spacing: -1px; }
    .doc-header .logo span { color: #2563eb; }
    .doc-header .doc-title { font-size: 22px; font-weight: 800; text-align: right; letter-spacing: -0.5px; }
    .doc-header .doc-date { font-size: 11px; color: #666; text-align: right; margin-top: 4px; }
    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: #555;
      border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 14px;
    }
    .info-table { width: 100%; border-collapse: collapse; }
    .info-table tr td:first-child {
      width: 150px; font-size: 11px; font-weight: 600; color: #666;
      padding: 7px 0; vertical-align: top;
    }
    .info-table tr td:last-child { font-size: 13px; font-weight: 500; color: #111; padding: 7px 0; }
    .fee-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .fee-table tr td { padding: 8px 12px; font-size: 13px; }
    .fee-table tr:nth-child(odd) { background: #f9fafb; }
    .fee-table .label { color: #555; }
    .fee-table .value { text-align: right; font-weight: 600; }
    .fee-table .total-row td { border-top: 2px solid #111; font-weight: 800; font-size: 15px; padding-top: 10px; }
    .fee-table .total-row .value { color: #2563eb; }
    .progress-table { width: 100%; border-collapse: collapse; }
    .progress-table th {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: #666;
      padding: 6px 10px; background: #f3f4f6; text-align: left;
    }
    .progress-table td { padding: 8px 10px; font-size: 12px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .progress-table td:first-child { width: 110px; white-space: nowrap; }
    .progress-table td:nth-child(2) { width: 130px; }
    .signature-section { display: flex; gap: 24px; margin-top: 40px; }
    .signature-box { flex: 1; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px 16px; text-align: center; }
    .signature-box .sig-title { font-size: 11px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 40px; }
    .signature-box .sig-line { border-top: 1px solid #111; margin-top: 8px; }
    .signature-box .sig-label { font-size: 11px; color: #888; margin-top: 6px; }
    .footer { margin-top: 36px; border-top: 1px solid #e5e7eb; padding-top: 14px; font-size: 10px; color: #aaa; text-align: center; }
    .print-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin-bottom: 24px; padding: 8px 18px;
      background: #1f2937; color: #fff; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .print-btn:hover { background: #374151; }
    @media print {
      body { padding: 0; max-width: none; }
      @page { margin: 20mm 18mm; size: A4; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:20px;">
    <button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
  </div>

  <div class="doc-header">
    <div>
      <div class="logo">Nexy<span>Fab</span></div>
      <div style="font-size:11px;color:#888;margin-top:4px;">제조 중개 플랫폼</div>
    </div>
    <div>
      <div class="doc-title">제조 중개 계약서</div>
      <div class="doc-date">계약일: ${formatDate(contract.created_at)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">계약 정보</div>
    <table class="info-table">
      <tr><td>계약 ID</td><td style="font-family:monospace;font-size:12px;">${contract.id}</td></tr>
      <tr><td>계약 날짜</td><td>${formatDate(contract.created_at)}</td></tr>
      <tr><td>프로젝트명</td><td style="font-weight:700;">${contract.project_name}</td></tr>
      <tr><td>파트너사 (제조사)</td><td>${contract.factory_name || contract.partner_email || '—'}</td></tr>
      <tr><td>계약 상태</td><td>${STATUS_LABELS[contract.status] || contract.status}</td></tr>
      ${contract.deadline ? `<tr><td>납기일</td><td>${contract.deadline}</td></tr>` : ''}
      ${customerContact.name || customerContact.email
        ? `<tr><td>발주 담당자</td><td>${[customerContact.name, customerContact.email, customerContact.phone].filter(Boolean).join(' · ')}</td></tr>`
        : ''}
      ${contract.partner_email ? `<tr><td>파트너 이메일</td><td>${contract.partner_email}</td></tr>` : ''}
      <tr><td>플랜</td><td>${contract.plan === 'premium' ? 'Premium' : 'Standard'}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">금액 정보</div>
    <table class="fee-table">
      <tr><td class="label">계약금액</td><td class="value">${won(contract.contract_amount)}</td></tr>
      <tr><td class="label">수수료율</td><td class="value">${commissionRatePct}%</td></tr>
      <tr><td class="label">총 수수료</td><td class="value">${won(contract.gross_commission)}</td></tr>
      <tr>
        <td class="label">플랜 공제 (${contract.plan === 'premium' ? 'Premium' : 'Standard'})</td>
        <td class="value" style="color:#dc2626;">— ${won(contract.plan_deduction)}</td>
      </tr>
      <tr class="total-row">
        <td class="label">최종 수수료</td>
        <td class="value">${won(contract.final_charge)}</td>
      </tr>
    </table>
  </div>

  ${templateBody ? `
  <div class="section">
    <div class="section-title">계약 조항</div>
    <pre style="font-family:inherit;font-size:13px;white-space:pre-wrap;line-height:1.8;color:#222;">${templateBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>` : ''}

  ${progressRows ? `
  <div class="section">
    <div class="section-title">진행 이력</div>
    <table class="progress-table">
      <thead><tr><th>날짜</th><th>작성자</th><th>내용</th></tr></thead>
      <tbody>${progressRows}</tbody>
    </table>
  </div>` : ''}

  <div class="signature-section">
    <div class="signature-box">
      <div class="sig-title">발주사 (고객)</div>
      <div class="sig-line"></div>
      <div class="sig-label">${customerContact.name || '(서명)'}</div>
    </div>
    <div class="signature-box">
      <div class="sig-title">NexyFab (중개사)</div>
      <div class="sig-line"></div>
      <div class="sig-label">NexyFab 담당자</div>
    </div>
    <div class="signature-box">
      <div class="sig-title">파트너사 (제조사)</div>
      <div class="sig-line"></div>
      <div class="sig-label">${contract.factory_name || contract.partner_email || '(서명)'}</div>
    </div>
  </div>

  <div class="footer">
    본 계약서는 NexyFab 제조 중개 플랫폼을 통해 자동 생성되었습니다. &nbsp;|&nbsp; 계약 ID: ${contract.id} &nbsp;|&nbsp; 생성일시: ${new Date().toLocaleString('ko-KR')}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
