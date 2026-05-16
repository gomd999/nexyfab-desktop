// Settlements page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface SettlementsDict {
  pageTitle: string;
  pageSubtitle: string;
  loading: string;
  emptyCompleted: string;
  sumCompletedCount: string;
  sumCompletedUnit: string;
  sumContractedAmount: string;
  sumActualAmount: string;
  sectionInProgress: string;
  sectionCompleted: string;
  cardContractAmount: string;
  cardActualAmount: string;
  cardPending: string;
  btnReceipt: string;
  btnReceiptLoading: string;
  errPdf: string;
  errGeneric: string;
  statusContracted: string;
  statusInProgress: string;
  statusQuality: string;
  statusDelivered: string;
  statusCompleted: string;
  statusCancelled: string;
}

const KO: SettlementsDict = {
  pageTitle: '정산 내역',
  pageSubtitle: '완료된 계약 내역을 확인합니다.',
  loading: '불러오는 중...',
  emptyCompleted: '완료된 계약이 없습니다.',
  sumCompletedCount: '완료 계약',
  sumCompletedUnit: '건',
  sumContractedAmount: '총 계약액',
  sumActualAmount: '총 실 정산액',
  sectionInProgress: '진행 중',
  sectionCompleted: '완료',
  cardContractAmount: '계약액',
  cardActualAmount: '실 정산액',
  cardPending: '미확정',
  btnReceipt: '📄 계약 내역서',
  btnReceiptLoading: '생성 중...',
  errPdf: 'PDF 생성에 실패했습니다.',
  errGeneric: '오류가 발생했습니다.',
  statusContracted: '계약 완료',
  statusInProgress: '제조 중',
  statusQuality: '품질 검수',
  statusDelivered: '납품 완료',
  statusCompleted: '완료',
  statusCancelled: '취소됨',
};

const EN: SettlementsDict = {
  pageTitle: 'Settlements',
  pageSubtitle: 'Review completed contracts and payouts.',
  loading: 'Loading…',
  emptyCompleted: 'No completed contracts yet.',
  sumCompletedCount: 'Completed contracts',
  sumCompletedUnit: '',
  sumContractedAmount: 'Total contracted',
  sumActualAmount: 'Total paid out',
  sectionInProgress: 'In progress',
  sectionCompleted: 'Completed',
  cardContractAmount: 'Contracted',
  cardActualAmount: 'Paid',
  cardPending: 'Pending',
  btnReceipt: '📄 Statement',
  btnReceiptLoading: 'Generating…',
  errPdf: 'Failed to generate PDF.',
  errGeneric: 'Something went wrong.',
  statusContracted: 'Contracted',
  statusInProgress: 'In production',
  statusQuality: 'Quality check',
  statusDelivered: 'Delivered',
  statusCompleted: 'Completed',
  statusCancelled: 'Cancelled',
};

const JA: SettlementsDict = {
  pageTitle: '精算履歴',
  pageSubtitle: '完了した契約の内訳を確認します。',
  loading: '読み込み中…',
  emptyCompleted: '完了した契約はまだありません。',
  sumCompletedCount: '完了契約',
  sumCompletedUnit: '件',
  sumContractedAmount: '契約総額',
  sumActualAmount: '実精算総額',
  sectionInProgress: '進行中',
  sectionCompleted: '完了',
  cardContractAmount: '契約額',
  cardActualAmount: '実精算額',
  cardPending: '未確定',
  btnReceipt: '📄 契約明細書',
  btnReceiptLoading: '生成中…',
  errPdf: 'PDFの生成に失敗しました。',
  errGeneric: 'エラーが発生しました。',
  statusContracted: '契約完了',
  statusInProgress: '製造中',
  statusQuality: '品質検査',
  statusDelivered: '納品完了',
  statusCompleted: '完了',
  statusCancelled: 'キャンセル',
};

const CN: SettlementsDict = {
  pageTitle: '结算明细',
  pageSubtitle: '查看已完成的合同明细。',
  loading: '加载中…',
  emptyCompleted: '没有已完成的合同。',
  sumCompletedCount: '已完成合同',
  sumCompletedUnit: '件',
  sumContractedAmount: '合同总额',
  sumActualAmount: '实际结算总额',
  sectionInProgress: '进行中',
  sectionCompleted: '已完成',
  cardContractAmount: '合同金额',
  cardActualAmount: '实际结算',
  cardPending: '待确认',
  btnReceipt: '📄 合同明细',
  btnReceiptLoading: '生成中…',
  errPdf: '生成 PDF 失败。',
  errGeneric: '发生错误。',
  statusContracted: '已签约',
  statusInProgress: '生产中',
  statusQuality: '质检中',
  statusDelivered: '已交付',
  statusCompleted: '已完成',
  statusCancelled: '已取消',
};

const ES: SettlementsDict = {
  pageTitle: 'Liquidaciones',
  pageSubtitle: 'Revisa los contratos completados y los pagos.',
  loading: 'Cargando…',
  emptyCompleted: 'Aún no hay contratos completados.',
  sumCompletedCount: 'Contratos completados',
  sumCompletedUnit: '',
  sumContractedAmount: 'Total contratado',
  sumActualAmount: 'Total pagado',
  sectionInProgress: 'En curso',
  sectionCompleted: 'Completado',
  cardContractAmount: 'Contratado',
  cardActualAmount: 'Pagado',
  cardPending: 'Pendiente',
  btnReceipt: '📄 Comprobante',
  btnReceiptLoading: 'Generando…',
  errPdf: 'Error al generar el PDF.',
  errGeneric: 'Algo salió mal.',
  statusContracted: 'Contratado',
  statusInProgress: 'En producción',
  statusQuality: 'Control de calidad',
  statusDelivered: 'Entregado',
  statusCompleted: 'Completado',
  statusCancelled: 'Cancelado',
};

const AR: SettlementsDict = {
  pageTitle: 'التسويات',
  pageSubtitle: 'مراجعة العقود المنجزة والمدفوعات.',
  loading: 'جارٍ التحميل…',
  emptyCompleted: 'لا توجد عقود منجزة بعد.',
  sumCompletedCount: 'العقود المنجزة',
  sumCompletedUnit: '',
  sumContractedAmount: 'إجمالي العقود',
  sumActualAmount: 'إجمالي المدفوع',
  sectionInProgress: 'قيد التنفيذ',
  sectionCompleted: 'مكتمل',
  cardContractAmount: 'القيمة التعاقدية',
  cardActualAmount: 'المبلغ المدفوع',
  cardPending: 'قيد التحديد',
  btnReceipt: '📄 كشف العقد',
  btnReceiptLoading: 'جارٍ الإنشاء…',
  errPdf: 'فشل إنشاء ملف PDF.',
  errGeneric: 'حدث خطأ ما.',
  statusContracted: 'تم التعاقد',
  statusInProgress: 'قيد التصنيع',
  statusQuality: 'فحص الجودة',
  statusDelivered: 'تم التسليم',
  statusCompleted: 'مكتمل',
  statusCancelled: 'ملغى',
};

export function settlementsDict(lang: PartnerLang): SettlementsDict {
  switch (lang) {
    case 'ko': return KO;
    case 'en': return EN;
    case 'ja': return JA;
    case 'cn': return CN;
    case 'es': return ES;
    case 'ar': return AR;
    default:   return EN;
  }
}
