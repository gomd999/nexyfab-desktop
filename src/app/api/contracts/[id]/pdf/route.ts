import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { formatNumber, bcp47 } from '@/lib/i18n/format';
import { loc } from '@/lib/i18n/loc';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';

export const dynamic = 'force-dynamic';

/** Contract row fields used by `applyTemplate` (subset of nf_contracts SELECT) */
interface ContractPdfTemplateRow {
  project_name: string;
  customer_contact: string | null;
  factory_name: string | null;
  partner_email: string | null;
  contract_amount: number | null;
  created_at: string;
  deadline: string | null;
  contract_date?: string | null;
  warranty_period?: string | null;
}

/** {{변수}} → 실제 값으로 치환 */
function applyTemplate(template: string, contract: ContractPdfTemplateRow, lang: string): string {
  const vars: Record<string, string> = {
    projectName: contract.project_name || '',
    clientName: contract.customer_contact ? (() => {
      try { return JSON.parse(contract.customer_contact)?.name || ''; } catch { return ''; }
    })() : '',
    factoryName: contract.factory_name || contract.partner_email || '',
    contractAmount: contract.contract_amount
      ? `${formatNumber(Number(contract.contract_amount), lang) ?? contract.contract_amount} KRW`
      : '',
    contractDate: contract.contract_date || formatDate(contract.created_at, lang),
    warrantyPeriod: contract.warranty_period || loc(lang, { ko: '3개월', en: '3 months', ja: '3か月', zh: '3个月', es: '3 meses', ar: '3 أشهر' }),
    deadline: contract.deadline || '',
    partnerEmail: contract.partner_email || '',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? `{{${key}}}`);
}

const STATUS_LABELS: Record<string, { ko: string; en: string; ja: string; zh: string; es: string; ar: string }> = {
  contracted: { ko: '계약 완료', en: 'Contracted', ja: '契約完了', zh: '已签约', es: 'Contratado', ar: 'تم التعاقد' },
  in_progress: { ko: '진행 중', en: 'In progress', ja: '進行中', zh: '进行中', es: 'En curso', ar: 'قيد التنفيذ' },
  quality_check: { ko: '품질 검수', en: 'Quality check', ja: '品質検査', zh: '质量检查', es: 'Control de calidad', ar: 'فحص الجودة' },
  delivered: { ko: '납품 완료', en: 'Delivered', ja: '納品完了', zh: '已交付', es: 'Entregado', ar: 'تم التسليم' },
  completed: { ko: '완료', en: 'Completed', ja: '完了', zh: '已完成', es: 'Completado', ar: 'مكتمل' },
  cancelled: { ko: '취소됨', en: 'Cancelled', ja: 'キャンセル', zh: '已取消', es: 'Cancelado', ar: 'ملغى' },
};

function won(n: number | null | undefined, lang: string): string {
  if (n == null) return '—';
  return `${formatNumber(Number(n), lang) ?? n} KRW`;
}

function formatDate(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(bcp47(lang), { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
}

// GET /api/contracts/{id}/pdf
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const serverLocale = resolveServerLocale(req, req.nextUrl.searchParams.get('lang'));
  const lang = serverLocale.route;

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
    return new NextResponse(loc(lang, {
      ko: '계약을 찾을 수 없습니다.', en: 'Contract not found.', ja: '契約が見つかりません。',
      zh: '找不到合同。', es: 'No se encontró el contrato.', ar: 'تعذر العثور على العقد.',
    }), { status: 404 });
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
    if (contractTpl) templateBody = applyTemplate(contractTpl.content, contract, lang);
    else templateBody = applyTemplate(templates[0].content, contract, lang);
  }

  const progressRows = progressNotes
    .map(pn => `
      <tr>
        <td>${formatDate(pn.date, lang)}</td>
        <td>${pn.updatedBy || '—'}</td>
        <td>${pn.note || ''}</td>
      </tr>`)
    .join('');

  const C = <T extends { ko: string; en: string; ja: string; zh: string; es: string; ar: string }>(m: T) => loc(lang, m);
  const c = {
    print: C({ ko: '🖨️ 인쇄 / PDF 저장', en: '🖨️ Print / Save PDF', ja: '🖨️ 印刷 / PDF保存', zh: '🖨️ 打印 / 保存 PDF', es: '🖨️ Imprimir / Guardar PDF', ar: '🖨️ طباعة / حفظ PDF' }),
    platform: C({ ko: '제조 중개 플랫폼', en: 'Manufacturing marketplace', ja: '製造仲介プラットフォーム', zh: '制造撮合平台', es: 'Plataforma de fabricación', ar: 'منصة التصنيع والوساطة' }),
    title: C({ ko: '제조 중개 계약서', en: 'Manufacturing Agreement', ja: '製造仲介契約書', zh: '制造撮合合同', es: 'Acuerdo de fabricación', ar: 'اتفاقية التصنيع' }),
    contractDate: C({ ko: '계약일', en: 'Contract date', ja: '契約日', zh: '合同日期', es: 'Fecha del contrato', ar: 'تاريخ العقد' }),
    info: C({ ko: '계약 정보', en: 'Contract information', ja: '契約情報', zh: '合同信息', es: 'Información del contrato', ar: 'معلومات العقد' }),
    id: C({ ko: '계약 ID', en: 'Contract ID', ja: '契約ID', zh: '合同 ID', es: 'ID del contrato', ar: 'معرّف العقد' }),
    date: C({ ko: '계약 날짜', en: 'Contract date', ja: '契約日', zh: '合同日期', es: 'Fecha del contrato', ar: 'تاريخ العقد' }),
    project: C({ ko: '프로젝트명', en: 'Project name', ja: 'プロジェクト名', zh: '项目名称', es: 'Nombre del proyecto', ar: 'اسم المشروع' }),
    partner: C({ ko: '파트너사 (제조사)', en: 'Partner (manufacturer)', ja: 'パートナー（メーカー）', zh: '合作方（制造商）', es: 'Socio (fabricante)', ar: 'الشريك (المصنّع)' }),
    status: C({ ko: '계약 상태', en: 'Contract status', ja: '契約ステータス', zh: '合同状态', es: 'Estado del contrato', ar: 'حالة العقد' }),
    deadline: C({ ko: '납기일', en: 'Deadline', ja: '納期', zh: '交付期限', es: 'Fecha límite', ar: 'الموعد النهائي' }),
    contact: C({ ko: '발주 담당자', en: 'Customer contact', ja: '発注担当者', zh: '客户联系人', es: 'Contacto del cliente', ar: 'جهة اتصال العميل' }),
    partnerEmail: C({ ko: '파트너 이메일', en: 'Partner email', ja: 'パートナーのメール', zh: '合作方邮箱', es: 'Correo del socio', ar: 'بريد الشريك' }),
    plan: C({ ko: '플랜', en: 'Plan', ja: 'プラン', zh: '方案', es: 'Plan', ar: 'الخطة' }),
    amountInfo: C({ ko: '금액 정보', en: 'Amount information', ja: '金額情報', zh: '金额信息', es: 'Información de importes', ar: 'معلومات المبالغ' }),
    contractAmount: C({ ko: '계약금액', en: 'Contract amount', ja: '契約金額', zh: '合同金额', es: 'Importe del contrato', ar: 'قيمة العقد' }),
    commissionRate: C({ ko: '수수료율', en: 'Commission rate', ja: '手数料率', zh: '佣金率', es: 'Tasa de comisión', ar: 'نسبة العمولة' }),
    grossCommission: C({ ko: '총 수수료', en: 'Gross commission', ja: '総手数料', zh: '总佣金', es: 'Comisión bruta', ar: 'إجمالي العمولة' }),
    planDeduction: C({ ko: '플랜 공제', en: 'Plan deduction', ja: 'プラン控除', zh: '方案扣除', es: 'Deducción del plan', ar: 'خصم الخطة' }),
    finalCharge: C({ ko: '최종 수수료', en: 'Final charge', ja: '最終手数料', zh: '最终费用', es: 'Cargo final', ar: 'الرسم النهائي' }),
    clauses: C({ ko: '계약 조항', en: 'Contract clauses', ja: '契約条項', zh: '合同条款', es: 'Cláusulas del contrato', ar: 'بنود العقد' }),
    history: C({ ko: '진행 이력', en: 'Progress history', ja: '進行履歴', zh: '进度记录', es: 'Historial de progreso', ar: 'سجل التقدم' }),
    progressDate: C({ ko: '날짜', en: 'Date', ja: '日付', zh: '日期', es: 'Fecha', ar: 'التاريخ' }),
    author: C({ ko: '작성자', en: 'Author', ja: '作成者', zh: '作者', es: 'Autor', ar: 'الكاتب' }),
    content: C({ ko: '내용', en: 'Content', ja: '内容', zh: '内容', es: 'Contenido', ar: 'المحتوى' }),
    buyer: C({ ko: '발주사 (고객)', en: 'Buyer (customer)', ja: '発注者（顧客）', zh: '买方（客户）', es: 'Comprador (cliente)', ar: 'المشتري (العميل)' }),
    intermediary: C({ ko: 'NexyFab (중개사)', en: 'NexyFab (intermediary)', ja: 'NexyFab（仲介）', zh: 'NexyFab（撮合方）', es: 'NexyFab (intermediario)', ar: 'NexyFab (وسيط)' }),
    manager: C({ ko: 'NexyFab 담당자', en: 'NexyFab representative', ja: 'NexyFab担当者', zh: 'NexyFab 负责人', es: 'Representante de NexyFab', ar: 'ممثل NexyFab' }),
    signature: C({ ko: '(서명)', en: '(Signature)', ja: '（署名）', zh: '（签名）', es: '(Firma)', ar: '(التوقيع)' }),
    generated: C({ ko: '본 계약서는 NexyFab 제조 중개 플랫폼을 통해 자동 생성되었습니다.', en: 'This agreement was generated automatically through the NexyFab manufacturing marketplace.', ja: '本契約書はNexyFab製造仲介プラットフォームで自動生成されました。', zh: '本合同由 NexyFab 制造撮合平台自动生成。', es: 'Este acuerdo se generó automáticamente mediante la plataforma de fabricación NexyFab.', ar: 'تم إنشاء هذه الاتفاقية تلقائيًا عبر منصة تصنيع NexyFab.' }),
  };
  const statusLabel = STATUS_LABELS[contract.status] ? loc(lang, STATUS_LABELS[contract.status]!) : contract.status;
  const planLabel = contract.plan === 'premium' ? 'Premium' : 'Standard';

  const html = `<!DOCTYPE html>
<html lang="${serverLocale.iso}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${c.title} — ${contract.project_name}</title>
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
    <button class="print-btn" onclick="window.print()">${c.print}</button>
  </div>

  <div class="doc-header">
    <div>
      <div class="logo">Nexy<span>Fab</span></div>
      <div style="font-size:11px;color:#888;margin-top:4px;">${c.platform}</div>
    </div>
    <div>
      <div class="doc-title">${c.title}</div>
      <div class="doc-date">${c.contractDate}: ${formatDate(contract.created_at, lang)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">${c.info}</div>
    <table class="info-table">
      <tr><td>${c.id}</td><td style="font-family:monospace;font-size:12px;">${contract.id}</td></tr>
      <tr><td>${c.date}</td><td>${formatDate(contract.created_at, lang)}</td></tr>
      <tr><td>${c.project}</td><td style="font-weight:700;">${contract.project_name}</td></tr>
      <tr><td>${c.partner}</td><td>${contract.factory_name || contract.partner_email || '—'}</td></tr>
      <tr><td>${c.status}</td><td>${statusLabel}</td></tr>
      ${contract.deadline ? `<tr><td>${c.deadline}</td><td>${contract.deadline}</td></tr>` : ''}
      ${customerContact.name || customerContact.email
        ? `<tr><td>${c.contact}</td><td>${[customerContact.name, customerContact.email, customerContact.phone].filter(Boolean).join(' · ')}</td></tr>`
        : ''}
      ${contract.partner_email ? `<tr><td>${c.partnerEmail}</td><td>${contract.partner_email}</td></tr>` : ''}
      <tr><td>${c.plan}</td><td>${planLabel}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">${c.amountInfo}</div>
    <table class="fee-table">
      <tr><td class="label">${c.contractAmount}</td><td class="value">${won(contract.contract_amount, lang)}</td></tr>
      <tr><td class="label">${c.commissionRate}</td><td class="value">${commissionRatePct}%</td></tr>
      <tr><td class="label">${c.grossCommission}</td><td class="value">${won(contract.gross_commission, lang)}</td></tr>
      <tr>
        <td class="label">${c.planDeduction} (${planLabel})</td>
        <td class="value" style="color:#dc2626;">— ${won(contract.plan_deduction, lang)}</td>
      </tr>
      <tr class="total-row">
        <td class="label">${c.finalCharge}</td>
        <td class="value">${won(contract.final_charge, lang)}</td>
      </tr>
    </table>
  </div>

  ${templateBody ? `
  <div class="section">
    <div class="section-title">${c.clauses}</div>
    <pre style="font-family:inherit;font-size:13px;white-space:pre-wrap;line-height:1.8;color:#222;">${templateBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>` : ''}

  ${progressRows ? `
  <div class="section">
    <div class="section-title">${c.history}</div>
    <table class="progress-table">
      <thead><tr><th>${c.progressDate}</th><th>${c.author}</th><th>${c.content}</th></tr></thead>
      <tbody>${progressRows}</tbody>
    </table>
  </div>` : ''}

  <div class="signature-section">
    <div class="signature-box">
      <div class="sig-title">${c.buyer}</div>
      <div class="sig-line"></div>
      <div class="sig-label">${customerContact.name || c.signature}</div>
    </div>
    <div class="signature-box">
      <div class="sig-title">${c.intermediary}</div>
      <div class="sig-line"></div>
      <div class="sig-label">${c.manager}</div>
    </div>
    <div class="signature-box">
      <div class="sig-title">${c.partner}</div>
      <div class="sig-line"></div>
      <div class="sig-label">${contract.factory_name || contract.partner_email || c.signature}</div>
    </div>
  </div>

  <div class="footer">
    ${c.generated} &nbsp;|&nbsp; ${c.id}: ${contract.id} &nbsp;|&nbsp; ${c.date}: ${new Intl.DateTimeFormat(bcp47(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
