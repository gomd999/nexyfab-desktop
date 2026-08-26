import { formatDate } from '@/lib/i18n/format';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export type TabularExportKind = 'quotes' | 'audit' | 'rfqs' | 'orders' | 'erp-quotes';

const KEYS: Record<TabularExportKind, readonly string[]> = {
  quotes: ['id', 'project_name', 'factory_name', 'estimated_amount', 'details', 'valid_until', 'partner_email', 'status', 'created_at', 'updated_at'],
  audit: ['id', 'user_id', 'action', 'resource_id', 'metadata', 'ip', 'created_at'],
  rfqs: ['id', 'part_name', 'material', 'quantity', 'quoted_price_krw', 'status', 'note', 'created_at', 'updated_at'],
  orders: ['id', 'rfq_id', 'part_name', 'manufacturer_name', 'quantity', 'total_price_krw', 'status', 'created_at', 'estimated_delivery_at'],
  'erp-quotes': ['id', 'rfq_id', 'manufacturer_name', 'total_price_krw', 'valid_until', 'status', 'created_at'],
};

const LABELS: Record<IsoLang, Record<string, string>> = {
  ko: { id: 'ID', project_name: '프로젝트명', factory_name: '파트너명', estimated_amount: '견적 금액 (KRW)', details: '상세 내용', valid_until: '유효 기간', partner_email: '파트너 이메일', status: '상태', created_at: '생성일', updated_at: '수정일', user_id: '사용자 ID', action: '액션', resource_id: '리소스 ID', metadata: '메타데이터', ip: 'IP', part_name: '부품명', material: '재료', quantity: '수량', quoted_price_krw: '견적 금액 (KRW)', note: '메모', rfq_id: 'RFQ ID', manufacturer_name: '제조사명', total_price_krw: '총액 (KRW)', estimated_delivery_at: '예상 납기일' },
  en: { id: 'ID', project_name: 'Project', factory_name: 'Partner', estimated_amount: 'Quote amount (KRW)', details: 'Details', valid_until: 'Valid until', partner_email: 'Partner email', status: 'Status', created_at: 'Created at', updated_at: 'Updated at', user_id: 'User ID', action: 'Action', resource_id: 'Resource ID', metadata: 'Metadata', ip: 'IP', part_name: 'Part', material: 'Material', quantity: 'Quantity', quoted_price_krw: 'Quoted price (KRW)', note: 'Note', rfq_id: 'RFQ ID', manufacturer_name: 'Manufacturer', total_price_krw: 'Total price (KRW)', estimated_delivery_at: 'Estimated delivery' },
  ja: { id: 'ID', project_name: 'プロジェクト名', factory_name: 'パートナー名', estimated_amount: '見積金額 (KRW)', details: '詳細', valid_until: '有効期限', partner_email: 'パートナーメール', status: 'ステータス', created_at: '作成日時', updated_at: '更新日時', user_id: 'ユーザーID', action: '操作', resource_id: 'リソースID', metadata: 'メタデータ', ip: 'IP', part_name: '部品名', material: '材料', quantity: '数量', quoted_price_krw: '見積金額 (KRW)', note: 'メモ', rfq_id: 'RFQ ID', manufacturer_name: 'メーカー名', total_price_krw: '合計金額 (KRW)', estimated_delivery_at: '納期予定' },
  zh: { id: 'ID', project_name: '项目名称', factory_name: '合作伙伴', estimated_amount: '报价金额 (KRW)', details: '详细信息', valid_until: '有效期至', partner_email: '合作伙伴邮箱', status: '状态', created_at: '创建时间', updated_at: '更新时间', user_id: '用户ID', action: '操作', resource_id: '资源ID', metadata: '元数据', ip: 'IP', part_name: '零件名称', material: '材料', quantity: '数量', quoted_price_krw: '报价金额 (KRW)', note: '备注', rfq_id: 'RFQ ID', manufacturer_name: '制造商', total_price_krw: '总金额 (KRW)', estimated_delivery_at: '预计交付日期' },
  es: { id: 'ID', project_name: 'Proyecto', factory_name: 'Socio', estimated_amount: 'Importe cotizado (KRW)', details: 'Detalles', valid_until: 'Válida hasta', partner_email: 'Correo del socio', status: 'Estado', created_at: 'Fecha de creación', updated_at: 'Fecha de actualización', user_id: 'ID de usuario', action: 'Acción', resource_id: 'ID de recurso', metadata: 'Metadatos', ip: 'IP', part_name: 'Pieza', material: 'Material', quantity: 'Cantidad', quoted_price_krw: 'Precio cotizado (KRW)', note: 'Nota', rfq_id: 'ID de RFQ', manufacturer_name: 'Fabricante', total_price_krw: 'Precio total (KRW)', estimated_delivery_at: 'Entrega estimada' },
  ar: { id: 'المعرّف', project_name: 'المشروع', factory_name: 'الشريك', estimated_amount: 'مبلغ العرض (KRW)', details: 'التفاصيل', valid_until: 'صالح حتى', partner_email: 'بريد الشريك', status: 'الحالة', created_at: 'تاريخ الإنشاء', updated_at: 'تاريخ التحديث', user_id: 'معرّف المستخدم', action: 'الإجراء', resource_id: 'معرّف المورد', metadata: 'البيانات الوصفية', ip: 'IP', part_name: 'القطعة', material: 'المادة', quantity: 'الكمية', quoted_price_krw: 'السعر المعروض (KRW)', note: 'ملاحظة', rfq_id: 'معرّف طلب التسعير', manufacturer_name: 'الشركة المصنّعة', total_price_krw: 'السعر الإجمالي (KRW)', estimated_delivery_at: 'التسليم المتوقع' },
};

const SHEETS: Record<IsoLang, Record<TabularExportKind, string>> = {
  ko: { quotes: '견적 목록', audit: '감사 로그', rfqs: 'RFQ 목록', orders: '주문 목록', 'erp-quotes': '견적 목록' },
  en: { quotes: 'Quotes', audit: 'Audit log', rfqs: 'RFQs', orders: 'Orders', 'erp-quotes': 'Quotes' },
  ja: { quotes: '見積一覧', audit: '監査ログ', rfqs: 'RFQ一覧', orders: '注文一覧', 'erp-quotes': '見積一覧' },
  zh: { quotes: '报价列表', audit: '审计日志', rfqs: 'RFQ列表', orders: '订单列表', 'erp-quotes': '报价列表' },
  es: { quotes: 'Cotizaciones', audit: 'Registro auditoría', rfqs: 'RFQ', orders: 'Pedidos', 'erp-quotes': 'Cotizaciones' },
  ar: { quotes: 'عروض الأسعار', audit: 'سجل التدقيق', rfqs: 'طلبات التسعير', orders: 'الطلبات', 'erp-quotes': 'عروض الأسعار' },
};

const STATUS: Record<string, Record<IsoLang, string>> = {
  pending: { ko: '대기', en: 'Pending', ja: '保留中', zh: '待处理', es: 'Pendiente', ar: 'قيد الانتظار' },
  draft: { ko: '초안', en: 'Draft', ja: '下書き', zh: '草稿', es: 'Borrador', ar: 'مسودة' },
  responded: { ko: '응답됨', en: 'Responded', ja: '回答済み', zh: '已回复', es: 'Respondida', ar: 'تم الرد' },
  accepted: { ko: '수락됨', en: 'Accepted', ja: '承認済み', zh: '已接受', es: 'Aceptada', ar: 'مقبول' },
  active: { ko: '진행 중', en: 'Active', ja: '進行中', zh: '进行中', es: 'Activo', ar: 'نشط' },
  completed: { ko: '완료', en: 'Completed', ja: '完了', zh: '已完成', es: 'Completado', ar: 'مكتمل' },
  rejected: { ko: '거절됨', en: 'Rejected', ja: '却下', zh: '已拒绝', es: 'Rechazada', ar: 'مرفوض' },
  cancelled: { ko: '취소됨', en: 'Cancelled', ja: 'キャンセル', zh: '已取消', es: 'Cancelado', ar: 'ملغى' },
};

const DATE_KEYS = new Set(['valid_until', 'created_at', 'updated_at', 'estimated_delivery_at']);

export function buildLocalizedTabularExport(
  kind: TabularExportKind,
  rows: Array<Record<string, unknown>>,
  language: string | null | undefined,
) {
  const locale = toIsoLang(language);
  const columns = KEYS[kind];
  const dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  const localizedRows = rows.map(source => Object.fromEntries(columns.map(key => {
    let value = source[key] ?? '';
    if (key === 'status' && typeof value === 'string') value = STATUS[value.trim().toLowerCase()]?.[locale] ?? value;
    if (DATE_KEYS.has(key) && value !== '') value = formatDate(value as string | number | Date, locale, dateOptions) ?? value;
    return [LABELS[locale][key] ?? key, value];
  })));
  return { locale, sheetName: SHEETS[locale][kind], rows: localizedRows };
}
