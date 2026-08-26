import { formatDate } from '@/lib/i18n/format';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export type ContractExportRecord = {
  id: string; project_name: string; customer_email: string | null;
  factory_name: string | null; contract_amount: number | null;
  commission_rate: number | null; final_charge: number | null;
  status: string; created_at: string;
};

export type RfqExportRecord = {
  id: string; shape_name: string; material_id: string; quantity: number;
  status: string; quote_amount: number | null; created_at: number;
};

type Copy = {
  sheets: [string, string];
  contract: [string, string, string, string, string, string, string, string, string];
  rfq: [string, string, string, string, string, string, string];
};

const COPY: Record<IsoLang, Copy> = {
  ko: { sheets: ['계약 목록', 'RFQ 목록'], contract: ['ID', '프로젝트명', '고객 이메일', '파트너명', '계약 금액 (KRW)', '수수료율 (%)', '실 청구액 (KRW)', '상태', '계약일'], rfq: ['RFQ ID', '형상명', '재료', '수량', '상태', '견적 금액 (KRW)', '생성일'] },
  en: { sheets: ['Contracts', 'RFQs'], contract: ['ID', 'Project', 'Customer email', 'Partner', 'Contract amount (KRW)', 'Commission rate (%)', 'Final charge (KRW)', 'Status', 'Contract date'], rfq: ['RFQ ID', 'Shape', 'Material', 'Quantity', 'Status', 'Quote amount (KRW)', 'Created date'] },
  ja: { sheets: ['契約一覧', 'RFQ一覧'], contract: ['ID', 'プロジェクト名', '顧客メール', 'パートナー名', '契約金額 (KRW)', '手数料率 (%)', '最終請求額 (KRW)', 'ステータス', '契約日'], rfq: ['RFQ ID', '形状名', '材料', '数量', 'ステータス', '見積金額 (KRW)', '作成日'] },
  zh: { sheets: ['合同列表', 'RFQ列表'], contract: ['ID', '项目名称', '客户邮箱', '合作伙伴', '合同金额 (KRW)', '佣金率 (%)', '最终应付额 (KRW)', '状态', '合同日期'], rfq: ['RFQ ID', '形状名称', '材料', '数量', '状态', '报价金额 (KRW)', '创建日期'] },
  es: { sheets: ['Contratos', 'RFQ'], contract: ['ID', 'Proyecto', 'Correo del cliente', 'Socio', 'Importe del contrato (KRW)', 'Comisión (%)', 'Cargo final (KRW)', 'Estado', 'Fecha del contrato'], rfq: ['ID de RFQ', 'Forma', 'Material', 'Cantidad', 'Estado', 'Importe cotizado (KRW)', 'Fecha de creación'] },
  ar: { sheets: ['العقود', 'طلبات التسعير'], contract: ['المعرّف', 'المشروع', 'بريد العميل', 'الشريك', 'قيمة العقد (KRW)', 'نسبة العمولة (%)', 'الرسوم النهائية (KRW)', 'الحالة', 'تاريخ العقد'], rfq: ['معرّف طلب التسعير', 'الشكل', 'المادة', 'الكمية', 'الحالة', 'مبلغ العرض (KRW)', 'تاريخ الإنشاء'] },
};

const STATUS: Record<string, Record<IsoLang, string>> = {
  pending: { ko: '대기', en: 'Pending', ja: '保留中', zh: '待处理', es: 'Pendiente', ar: 'قيد الانتظار' },
  draft: { ko: '초안', en: 'Draft', ja: '下書き', zh: '草稿', es: 'Borrador', ar: 'مسودة' },
  responded: { ko: '응답됨', en: 'Responded', ja: '回答済み', zh: '已回复', es: 'Respondida', ar: 'تم الرد' },
  quoted: { ko: '견적됨', en: 'Quoted', ja: '見積済み', zh: '已报价', es: 'Cotizada', ar: 'تم التسعير' },
  active: { ko: '진행 중', en: 'Active', ja: '進行中', zh: '进行中', es: 'Activo', ar: 'نشط' },
  in_progress: { ko: '진행 중', en: 'In progress', ja: '進行中', zh: '进行中', es: 'En curso', ar: 'قيد التنفيذ' },
  accepted: { ko: '수락됨', en: 'Accepted', ja: '承認済み', zh: '已接受', es: 'Aceptada', ar: 'مقبول' },
  completed: { ko: '완료', en: 'Completed', ja: '完了', zh: '已完成', es: 'Completado', ar: 'مكتمل' },
  rejected: { ko: '거절됨', en: 'Rejected', ja: '却下', zh: '已拒绝', es: 'Rechazada', ar: 'مرفوض' },
  cancelled: { ko: '취소됨', en: 'Cancelled', ja: 'キャンセル', zh: '已取消', es: 'Cancelado', ar: 'ملغى' },
};

function localizedStatus(status: string, locale: IsoLang): string {
  return STATUS[status.trim().toLowerCase()]?.[locale] ?? status;
}

function row(headers: readonly string[], values: readonly unknown[]): Record<string, unknown> {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
}

export function buildContractExport(
  contracts: ContractExportRecord[],
  rfqs: RfqExportRecord[],
  language: string | null | undefined,
) {
  const locale = toIsoLang(language);
  const copy = COPY[locale];
  const dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };

  return {
    locale,
    sheetNames: copy.sheets,
    contractRows: contracts.map(contract => row(copy.contract, [
      contract.id,
      contract.project_name,
      contract.customer_email,
      contract.factory_name,
      contract.contract_amount,
      contract.commission_rate != null ? Math.round(contract.commission_rate * 100) : '',
      contract.final_charge,
      localizedStatus(contract.status, locale),
      formatDate(contract.created_at, locale, dateOptions) ?? contract.created_at,
    ])),
    rfqRows: rfqs.map(rfq => row(copy.rfq, [
      rfq.id,
      rfq.shape_name,
      rfq.material_id,
      rfq.quantity,
      localizedStatus(rfq.status, locale),
      rfq.quote_amount,
      formatDate(rfq.created_at, locale, dateOptions) ?? '',
    ])),
  };
}
