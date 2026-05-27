// Dashboard page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface DashboardDict {
  pageTitle: string;
  pageSubtitleSuffix: string;
  loading: string;

  statTotalAssigned: string;
  statPendingQuotes: string;
  statActiveContracts: string;
  statCompletedContracts: string;
  statAvgResponse: string;
  statWinRate: string;
  statUnit: string;

  trustTitle: string;
  trustLoading: string;
  trustFooter: string;

  urgentTitle: (n: number) => string;
  urgentDeadlineLabel: string;
  urgentDplus: (n: number) => string;
  urgentDday: string;
  urgentDminus: (n: number) => string;

  tabPending: (n: number) => string;
  tabActive: (n: number) => string;
  tabQuotes: (n: number) => string;
  tabSettlements: string;

  emptyPending: string;
  emptyActive: string;
  emptyQuotes: string;
  emptySettlements: string;
  emptyData: string;

  qtyUnit: string;
  pendingNoteLabelAssigned: string;
  pendingBtnQuote: string;

  contractBtnPdf: string;
  contractBtnMilestones: string;
  contractBtnUpdate: string;
  contractDeadlinePrefix: string;

  quoteStatusResponded: string;
  quoteStatusAccepted: string;
  quoteStatusRejected: string;
  quoteRespondedSuffix: string;

  status_contracted: string;
  status_in_progress: string;
  status_quality_check: string;
  status_delivered: string;
  status_completed: string;
  status_cancelled: string;

  settlementMonthAll: string;
  settlementBtnPdf: string;
  settlementSumRevenue: string;
  settlementSumCommission: string;
  settlementSumNet: string;
  settlementContractPrefix: string;

  // QuoteModal
  qmTitle: string;
  qmAmountLabel: string;
  qmAmountPlaceholder: string;
  qmDaysLabel: string;
  qmDaysPlaceholder: string;
  qmValidLabel: string;
  qmNoteLabel: string;
  qmNotePlaceholder: string;
  qmBtnCancel: string;
  qmBtnSubmit: string;
  qmBtnSubmitting: string;
  qmErrAmount: string;
  qmErrSubmit: string;
  qmErrNetwork: string;

  // MilestoneModal
  msTitle: string;
  msDoneOfTotal: (done: number, total: number) => string;
  msLoading: string;
  msEmpty: string;
  msDueLabel: string;
  msCompletedLabel: string;
  msNewPlaceholder: string;
  msBtnAdd: string;
  msBtnAdding: string;
  msBtnClose: string;

  // ProgressModal
  pmTitle: string;
  pmProgressLabel: (n: number) => string;
  pmStatusLabel: string;
  pmNoteLabel: string;
  pmNotePlaceholder: string;
  pmBtnCancel: string;
  pmBtnSave: string;
  pmBtnSaving: string;
  pmErrUpdate: string;
  pmErrNetwork: string;
}

const STATUS_KO = {
  contracted: '계약 완료', in_progress: '진행 중', quality_check: '품질 검수',
  delivered: '납품 완료', completed: '완료', cancelled: '취소됨',
};
const STATUS_EN = {
  contracted: 'Contracted', in_progress: 'In progress', quality_check: 'Quality check',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_JA = {
  contracted: '契約完了', in_progress: '進行中', quality_check: '品質検査',
  delivered: '納品完了', completed: '完了', cancelled: 'キャンセル',
};
const STATUS_CN = {
  contracted: '已签约', in_progress: '进行中', quality_check: '质检中',
  delivered: '已交付', completed: '已完成', cancelled: '已取消',
};
const STATUS_ES = {
  contracted: 'Contratado', in_progress: 'En curso', quality_check: 'Control de calidad',
  delivered: 'Entregado', completed: 'Completado', cancelled: 'Cancelado',
};
const STATUS_AR = {
  contracted: 'تم التعاقد', in_progress: 'قيد التنفيذ', quality_check: 'فحص الجودة',
  delivered: 'تم التسليم', completed: 'مكتمل', cancelled: 'ملغى',
};

const KO: DashboardDict = {
  pageTitle: '대시보드',
  pageSubtitleSuffix: '파트너 현황',
  loading: '불러오는 중...',
  statTotalAssigned: '배정 RFQ',
  statPendingQuotes: '견적 대기',
  statActiveContracts: '진행 계약',
  statCompletedContracts: '완료 계약',
  statAvgResponse: '평균 응답',
  statWinRate: '수주율',
  statUnit: '건',
  trustTitle: '차원별 신뢰 지표 (Phase 7-5)',
  trustLoading: '불러오는 중...',
  trustFooter: '단일 신용점수로 요약하지 않습니다. 납기·품질·응답·소통·공정 적합도는 각각 독립적으로 개선할 수 있습니다.',
  urgentTitle: (n) => `납기 임박 (${n}건)`,
  urgentDeadlineLabel: '납기:',
  urgentDplus: (n) => `D+${n}`,
  urgentDday: 'D-Day',
  urgentDminus: (n) => `D-${n}`,
  tabPending: (n) => `견적 대기 (${n})`,
  tabActive: (n) => `진행 계약 (${n})`,
  tabQuotes: (n) => `최근 견적 (${n})`,
  tabSettlements: '정산 내역',
  emptyPending: '대기 중인 견적 요청이 없습니다.',
  emptyActive: '진행 중인 계약이 없습니다.',
  emptyQuotes: '제출된 견적이 없습니다.',
  emptySettlements: '정산 내역이 없습니다.',
  emptyData: '데이터를 불러오지 못했습니다.',
  qtyUnit: '개',
  pendingNoteLabelAssigned: '배정:',
  pendingBtnQuote: '견적 제출',
  contractBtnPdf: 'PDF',
  contractBtnMilestones: '마일스톤',
  contractBtnUpdate: '업데이트',
  contractDeadlinePrefix: '납기',
  quoteStatusResponded: '응답 완료',
  quoteStatusAccepted: '채택됨',
  quoteStatusRejected: '미채택',
  quoteRespondedSuffix: '응답',
  status_contracted: STATUS_KO.contracted,
  status_in_progress: STATUS_KO.in_progress,
  status_quality_check: STATUS_KO.quality_check,
  status_delivered: STATUS_KO.delivered,
  status_completed: STATUS_KO.completed,
  status_cancelled: STATUS_KO.cancelled,
  settlementMonthAll: '전체 기간',
  settlementBtnPdf: 'PDF 내역서',
  settlementSumRevenue: '총 계약금',
  settlementSumCommission: '플랫폼 수수료',
  settlementSumNet: '순 수입',
  settlementContractPrefix: '계약',
  qmTitle: '견적 제출',
  qmAmountLabel: '견적 금액 (원) *',
  qmAmountPlaceholder: '예: 250000',
  qmDaysLabel: '납기 (일)',
  qmDaysPlaceholder: '예: 7',
  qmValidLabel: '견적 유효기간 (일)',
  qmNoteLabel: '메모',
  qmNotePlaceholder: '추가 사항 (선택)',
  qmBtnCancel: '취소',
  qmBtnSubmit: '견적 제출',
  qmBtnSubmitting: '제출 중...',
  qmErrAmount: '견적 금액을 입력하세요.',
  qmErrSubmit: '제출 실패',
  qmErrNetwork: '네트워크 오류가 발생했습니다.',
  msTitle: '마일스톤 관리',
  msDoneOfTotal: (d, total) => `${d} / ${total} 완료`,
  msLoading: '불러오는 중...',
  msEmpty: '마일스톤이 없습니다.',
  msDueLabel: '기한:',
  msCompletedLabel: '완료:',
  msNewPlaceholder: '새 마일스톤 제목...',
  msBtnAdd: '추가',
  msBtnAdding: '...',
  msBtnClose: '닫기',
  pmTitle: '진행 상태 업데이트',
  pmProgressLabel: (n) => `진행률: ${n}%`,
  pmStatusLabel: '상태',
  pmNoteLabel: '업데이트 메모',
  pmNotePlaceholder: '진행 상황 메모 (선택)',
  pmBtnCancel: '취소',
  pmBtnSave: '저장',
  pmBtnSaving: '저장 중...',
  pmErrUpdate: '업데이트 실패',
  pmErrNetwork: '네트워크 오류가 발생했습니다.',
};

const EN: DashboardDict = {
  pageTitle: 'Dashboard',
  pageSubtitleSuffix: 'partner overview',
  loading: 'Loading…',
  statTotalAssigned: 'Assigned RFQs',
  statPendingQuotes: 'Pending quotes',
  statActiveContracts: 'Active contracts',
  statCompletedContracts: 'Completed',
  statAvgResponse: 'Avg response',
  statWinRate: 'Win rate',
  statUnit: '',
  trustTitle: 'Multi-dimensional trust (Phase 7-5)',
  trustLoading: 'Loading…',
  trustFooter: 'We do not summarise this into a single credit score. On-time delivery, quality, response speed, communication and process fit are each tracked independently so you can improve them one at a time.',
  urgentTitle: (n) => `Deadline approaching (${n})`,
  urgentDeadlineLabel: 'Due:',
  urgentDplus: (n) => `+${n}d late`,
  urgentDday: 'Today',
  urgentDminus: (n) => `${n}d left`,
  tabPending: (n) => `Pending quotes (${n})`,
  tabActive: (n) => `Active (${n})`,
  tabQuotes: (n) => `Recent quotes (${n})`,
  tabSettlements: 'Settlements',
  emptyPending: 'No pending quote requests.',
  emptyActive: 'No active contracts.',
  emptyQuotes: 'No quotes submitted yet.',
  emptySettlements: 'No settlement records.',
  emptyData: 'Could not load the data.',
  qtyUnit: ' pcs',
  pendingNoteLabelAssigned: 'Assigned:',
  pendingBtnQuote: 'Submit quote',
  contractBtnPdf: 'PDF',
  contractBtnMilestones: 'Milestones',
  contractBtnUpdate: 'Update',
  contractDeadlinePrefix: 'Due',
  quoteStatusResponded: 'Responded',
  quoteStatusAccepted: 'Accepted',
  quoteStatusRejected: 'Rejected',
  quoteRespondedSuffix: 'responded',
  status_contracted: STATUS_EN.contracted,
  status_in_progress: STATUS_EN.in_progress,
  status_quality_check: STATUS_EN.quality_check,
  status_delivered: STATUS_EN.delivered,
  status_completed: STATUS_EN.completed,
  status_cancelled: STATUS_EN.cancelled,
  settlementMonthAll: 'All time',
  settlementBtnPdf: 'PDF statement',
  settlementSumRevenue: 'Gross revenue',
  settlementSumCommission: 'Platform fee',
  settlementSumNet: 'Net revenue',
  settlementContractPrefix: 'Contract',
  qmTitle: 'Submit quote',
  qmAmountLabel: 'Quote amount (KRW) *',
  qmAmountPlaceholder: 'e.g. 250000',
  qmDaysLabel: 'Lead time (days)',
  qmDaysPlaceholder: 'e.g. 7',
  qmValidLabel: 'Quote valid for (days)',
  qmNoteLabel: 'Note',
  qmNotePlaceholder: 'Additional notes (optional)',
  qmBtnCancel: 'Cancel',
  qmBtnSubmit: 'Submit',
  qmBtnSubmitting: 'Submitting…',
  qmErrAmount: 'Enter a quote amount.',
  qmErrSubmit: 'Submission failed',
  qmErrNetwork: 'Network error.',
  msTitle: 'Milestones',
  msDoneOfTotal: (d, total) => `${d} / ${total} done`,
  msLoading: 'Loading…',
  msEmpty: 'No milestones.',
  msDueLabel: 'Due:',
  msCompletedLabel: 'Completed:',
  msNewPlaceholder: 'New milestone title…',
  msBtnAdd: 'Add',
  msBtnAdding: '…',
  msBtnClose: 'Close',
  pmTitle: 'Update progress',
  pmProgressLabel: (n) => `Progress: ${n}%`,
  pmStatusLabel: 'Status',
  pmNoteLabel: 'Update note',
  pmNotePlaceholder: 'Progress note (optional)',
  pmBtnCancel: 'Cancel',
  pmBtnSave: 'Save',
  pmBtnSaving: 'Saving…',
  pmErrUpdate: 'Update failed',
  pmErrNetwork: 'Network error.',
};

const JA: DashboardDict = {
  ...EN,
  pageTitle: 'ダッシュボード',
  pageSubtitleSuffix: 'パートナー状況',
  loading: '読み込み中…',
  statTotalAssigned: '割当 RFQ',
  statPendingQuotes: '見積待ち',
  statActiveContracts: '進行中契約',
  statCompletedContracts: '完了契約',
  statAvgResponse: '平均応答',
  statWinRate: '受注率',
  statUnit: '件',
  trustTitle: '次元別信頼指標 (Phase 7-5)',
  trustLoading: '読み込み中…',
  trustFooter: '単一の信用スコアにはまとめません。納期・品質・応答・コミュニケーション・工程適合度は個別に改善できます。',
  urgentTitle: (n) => `納期間近 (${n}件)`,
  urgentDeadlineLabel: '納期:',
  urgentDplus: (n) => `D+${n}`,
  urgentDday: 'D-Day',
  urgentDminus: (n) => `D-${n}`,
  tabPending: (n) => `見積待ち (${n})`,
  tabActive: (n) => `進行中 (${n})`,
  tabQuotes: (n) => `最近の見積 (${n})`,
  tabSettlements: '精算履歴',
  emptyPending: '待機中の見積依頼はありません。',
  emptyActive: '進行中の契約はありません。',
  emptyQuotes: '提出した見積はありません。',
  emptySettlements: '精算履歴がありません。',
  emptyData: 'データの取得に失敗しました。',
  qtyUnit: '個',
  pendingNoteLabelAssigned: '割当:',
  pendingBtnQuote: '見積提出',
  contractBtnPdf: 'PDF',
  contractBtnMilestones: 'マイルストーン',
  contractBtnUpdate: '更新',
  contractDeadlinePrefix: '納期',
  quoteStatusResponded: '回答済',
  quoteStatusAccepted: '採用',
  quoteStatusRejected: '不採用',
  quoteRespondedSuffix: '回答',
  status_contracted: STATUS_JA.contracted,
  status_in_progress: STATUS_JA.in_progress,
  status_quality_check: STATUS_JA.quality_check,
  status_delivered: STATUS_JA.delivered,
  status_completed: STATUS_JA.completed,
  status_cancelled: STATUS_JA.cancelled,
  settlementMonthAll: '全期間',
  settlementBtnPdf: 'PDF明細',
  settlementSumRevenue: '契約金額合計',
  settlementSumCommission: 'プラットフォーム手数料',
  settlementSumNet: '純収入',
  settlementContractPrefix: '契約',
  qmTitle: '見積提出',
  qmAmountLabel: '見積額 (KRW) *',
  qmDaysLabel: '納期 (日)',
  qmValidLabel: '見積有効期間 (日)',
  qmNoteLabel: 'メモ',
  qmNotePlaceholder: '追加事項 (任意)',
  qmBtnCancel: 'キャンセル',
  qmBtnSubmit: '見積提出',
  qmBtnSubmitting: '送信中…',
  qmErrAmount: '見積額を入力してください。',
  qmErrSubmit: '送信失敗',
  qmErrNetwork: 'ネットワークエラー。',
  msTitle: 'マイルストーン管理',
  msDoneOfTotal: (d, total) => `${d} / ${total} 完了`,
  msLoading: '読み込み中…',
  msEmpty: 'マイルストーンがありません。',
  msDueLabel: '期限:',
  msCompletedLabel: '完了:',
  msNewPlaceholder: '新規マイルストーン名…',
  msBtnAdd: '追加',
  msBtnClose: '閉じる',
  pmTitle: '進捗更新',
  pmProgressLabel: (n) => `進捗: ${n}%`,
  pmStatusLabel: 'ステータス',
  pmNoteLabel: '更新メモ',
  pmNotePlaceholder: '進捗メモ (任意)',
  pmBtnCancel: 'キャンセル',
  pmBtnSave: '保存',
  pmBtnSaving: '保存中…',
  pmErrUpdate: '更新失敗',
  pmErrNetwork: 'ネットワークエラー。',
};

const CN: DashboardDict = {
  ...EN,
  pageTitle: '仪表板',
  pageSubtitleSuffix: '合作伙伴概况',
  loading: '加载中…',
  statTotalAssigned: '已分配 RFQ',
  statPendingQuotes: '待报价',
  statActiveContracts: '进行中合同',
  statCompletedContracts: '已完成合同',
  statAvgResponse: '平均响应',
  statWinRate: '中标率',
  statUnit: '件',
  trustTitle: '多维信任指标 (Phase 7-5)',
  trustLoading: '加载中…',
  trustFooter: '不会汇总成单一信用分。交期/质量/响应/沟通/工艺契合度可分别独立改进。',
  urgentTitle: (n) => `临近交期 (${n}件)`,
  urgentDeadlineLabel: '交期:',
  urgentDplus: (n) => `逾期 +${n}天`,
  urgentDday: '当天',
  urgentDminus: (n) => `还有 ${n}天`,
  tabPending: (n) => `待报价 (${n})`,
  tabActive: (n) => `进行中 (${n})`,
  tabQuotes: (n) => `近期报价 (${n})`,
  tabSettlements: '结算明细',
  emptyPending: '没有待处理的报价请求。',
  emptyActive: '没有进行中的合同。',
  emptyQuotes: '尚未提交报价。',
  emptySettlements: '没有结算记录。',
  emptyData: '加载数据失败。',
  qtyUnit: '件',
  pendingNoteLabelAssigned: '分配:',
  pendingBtnQuote: '提交报价',
  contractBtnPdf: 'PDF',
  contractBtnMilestones: '里程碑',
  contractBtnUpdate: '更新',
  contractDeadlinePrefix: '交期',
  quoteStatusResponded: '已回应',
  quoteStatusAccepted: '已采用',
  quoteStatusRejected: '未采用',
  quoteRespondedSuffix: '回应',
  status_contracted: STATUS_CN.contracted,
  status_in_progress: STATUS_CN.in_progress,
  status_quality_check: STATUS_CN.quality_check,
  status_delivered: STATUS_CN.delivered,
  status_completed: STATUS_CN.completed,
  status_cancelled: STATUS_CN.cancelled,
  settlementMonthAll: '全部时间',
  settlementBtnPdf: 'PDF 明细',
  settlementSumRevenue: '合同总额',
  settlementSumCommission: '平台佣金',
  settlementSumNet: '净收入',
  settlementContractPrefix: '合同',
  qmTitle: '提交报价',
  qmAmountLabel: '报价金额 (KRW) *',
  qmDaysLabel: '交期 (天)',
  qmValidLabel: '报价有效期 (天)',
  qmNoteLabel: '备注',
  qmNotePlaceholder: '附加备注 (可选)',
  qmBtnCancel: '取消',
  qmBtnSubmit: '提交报价',
  qmBtnSubmitting: '提交中…',
  qmErrAmount: '请输入报价金额。',
  qmErrSubmit: '提交失败',
  qmErrNetwork: '网络错误。',
  msTitle: '里程碑管理',
  msDoneOfTotal: (d, total) => `${d} / ${total} 完成`,
  msLoading: '加载中…',
  msEmpty: '没有里程碑。',
  msDueLabel: '到期:',
  msCompletedLabel: '完成:',
  msNewPlaceholder: '新里程碑名称…',
  msBtnAdd: '添加',
  msBtnClose: '关闭',
  pmTitle: '更新进度',
  pmProgressLabel: (n) => `进度: ${n}%`,
  pmStatusLabel: '状态',
  pmNoteLabel: '更新备注',
  pmNotePlaceholder: '进度备注 (可选)',
  pmBtnCancel: '取消',
  pmBtnSave: '保存',
  pmBtnSaving: '保存中…',
  pmErrUpdate: '更新失败',
  pmErrNetwork: '网络错误。',
};

const ES: DashboardDict = {
  ...EN,
  pageTitle: 'Panel',
  pageSubtitleSuffix: 'resumen del socio',
  loading: 'Cargando…',
  statTotalAssigned: 'RFQ asignadas',
  statPendingQuotes: 'Cotizaciones pendientes',
  statActiveContracts: 'Contratos activos',
  statCompletedContracts: 'Completados',
  statAvgResponse: 'Respuesta media',
  statWinRate: 'Tasa de éxito',
  trustTitle: 'Confianza multidimensional (Fase 7-5)',
  trustLoading: 'Cargando…',
  trustFooter: 'No resumimos esto en una sola puntuación. Plazos, calidad, respuesta, comunicación y ajuste de proceso se siguen por separado para mejorarlos uno a uno.',
  urgentTitle: (n) => `Plazo cercano (${n})`,
  urgentDeadlineLabel: 'Entrega:',
  urgentDplus: (n) => `+${n}d retraso`,
  urgentDday: 'Hoy',
  urgentDminus: (n) => `${n}d restantes`,
  tabPending: (n) => `Pendientes (${n})`,
  tabActive: (n) => `Activos (${n})`,
  tabQuotes: (n) => `Cotizaciones (${n})`,
  tabSettlements: 'Liquidaciones',
  emptyPending: 'No hay solicitudes pendientes.',
  emptyActive: 'No hay contratos activos.',
  emptyQuotes: 'Aún no has enviado cotizaciones.',
  emptySettlements: 'No hay registros de liquidación.',
  emptyData: 'No se pudieron cargar los datos.',
  qtyUnit: ' uds',
  pendingNoteLabelAssigned: 'Asignado:',
  pendingBtnQuote: 'Cotizar',
  contractBtnPdf: 'PDF',
  contractBtnMilestones: 'Hitos',
  contractBtnUpdate: 'Actualizar',
  contractDeadlinePrefix: 'Entrega',
  quoteStatusResponded: 'Respondido',
  quoteStatusAccepted: 'Aceptado',
  quoteStatusRejected: 'Rechazado',
  quoteRespondedSuffix: 'respondido',
  status_contracted: STATUS_ES.contracted,
  status_in_progress: STATUS_ES.in_progress,
  status_quality_check: STATUS_ES.quality_check,
  status_delivered: STATUS_ES.delivered,
  status_completed: STATUS_ES.completed,
  status_cancelled: STATUS_ES.cancelled,
  settlementMonthAll: 'Todo el periodo',
  settlementBtnPdf: 'Estado PDF',
  settlementSumRevenue: 'Ingreso bruto',
  settlementSumCommission: 'Comisión plataforma',
  settlementSumNet: 'Ingreso neto',
  settlementContractPrefix: 'Contrato',
  qmTitle: 'Enviar cotización',
  qmAmountLabel: 'Importe (KRW) *',
  qmDaysLabel: 'Plazo (días)',
  qmValidLabel: 'Validez (días)',
  qmNoteLabel: 'Nota',
  qmNotePlaceholder: 'Notas adicionales (opcional)',
  qmBtnCancel: 'Cancelar',
  qmBtnSubmit: 'Enviar',
  qmBtnSubmitting: 'Enviando…',
  qmErrAmount: 'Introduce el importe.',
  qmErrSubmit: 'Error al enviar',
  qmErrNetwork: 'Error de red.',
  msTitle: 'Hitos',
  msDoneOfTotal: (d, total) => `${d} / ${total} hechos`,
  msLoading: 'Cargando…',
  msEmpty: 'Sin hitos.',
  msDueLabel: 'Vence:',
  msCompletedLabel: 'Hecho:',
  msNewPlaceholder: 'Nuevo hito…',
  msBtnAdd: 'Añadir',
  msBtnClose: 'Cerrar',
  pmTitle: 'Actualizar progreso',
  pmProgressLabel: (n) => `Progreso: ${n}%`,
  pmStatusLabel: 'Estado',
  pmNoteLabel: 'Nota de actualización',
  pmNotePlaceholder: 'Nota de progreso (opcional)',
  pmBtnCancel: 'Cancelar',
  pmBtnSave: 'Guardar',
  pmBtnSaving: 'Guardando…',
  pmErrUpdate: 'Error al actualizar',
  pmErrNetwork: 'Error de red.',
};

const AR: DashboardDict = {
  ...EN,
  pageTitle: 'لوحة التحكم',
  pageSubtitleSuffix: 'نظرة الشريك',
  loading: 'جارٍ التحميل…',
  statTotalAssigned: 'طلبات RFQ المخصصة',
  statPendingQuotes: 'عروض معلقة',
  statActiveContracts: 'عقود نشطة',
  statCompletedContracts: 'مكتملة',
  statAvgResponse: 'متوسط الاستجابة',
  statWinRate: 'معدل الفوز',
  trustTitle: 'مؤشرات الثقة المتعددة (Phase 7-5)',
  trustLoading: 'جارٍ التحميل…',
  trustFooter: 'لا نلخّصها في درجة ائتمان واحدة. التزام المواعيد والجودة وسرعة الاستجابة والتواصل وملاءمة العمليات تُتابع بشكل مستقل.',
  urgentTitle: (n) => `اقتراب الموعد النهائي (${n})`,
  urgentDeadlineLabel: 'الاستحقاق:',
  urgentDplus: (n) => `متأخر +${n} يومًا`,
  urgentDday: 'اليوم',
  urgentDminus: (n) => `بقي ${n} يومًا`,
  tabPending: (n) => `عروض معلقة (${n})`,
  tabActive: (n) => `نشطة (${n})`,
  tabQuotes: (n) => `أحدث العروض (${n})`,
  tabSettlements: 'التسويات',
  emptyPending: 'لا توجد طلبات معلقة.',
  emptyActive: 'لا توجد عقود نشطة.',
  emptyQuotes: 'لم تقدم عروضًا بعد.',
  emptySettlements: 'لا توجد سجلات تسوية.',
  emptyData: 'تعذّر تحميل البيانات.',
  qtyUnit: ' قطعة',
  pendingNoteLabelAssigned: 'مخصص:',
  pendingBtnQuote: 'تقديم العرض',
  contractBtnPdf: 'PDF',
  contractBtnMilestones: 'المراحل',
  contractBtnUpdate: 'تحديث',
  contractDeadlinePrefix: 'الموعد',
  quoteStatusResponded: 'تم الرد',
  quoteStatusAccepted: 'مقبول',
  quoteStatusRejected: 'مرفوض',
  quoteRespondedSuffix: 'الرد',
  status_contracted: STATUS_AR.contracted,
  status_in_progress: STATUS_AR.in_progress,
  status_quality_check: STATUS_AR.quality_check,
  status_delivered: STATUS_AR.delivered,
  status_completed: STATUS_AR.completed,
  status_cancelled: STATUS_AR.cancelled,
  settlementMonthAll: 'كل الفترات',
  settlementBtnPdf: 'كشف PDF',
  settlementSumRevenue: 'الإيراد الإجمالي',
  settlementSumCommission: 'عمولة المنصة',
  settlementSumNet: 'صافي الإيراد',
  settlementContractPrefix: 'العقد',
  qmTitle: 'تقديم عرض',
  qmAmountLabel: 'المبلغ (KRW) *',
  qmDaysLabel: 'المدة (أيام)',
  qmValidLabel: 'صلاحية العرض (أيام)',
  qmNoteLabel: 'ملاحظة',
  qmNotePlaceholder: 'ملاحظات إضافية (اختياري)',
  qmBtnCancel: 'إلغاء',
  qmBtnSubmit: 'إرسال',
  qmBtnSubmitting: 'جارٍ الإرسال…',
  qmErrAmount: 'أدخل قيمة العرض.',
  qmErrSubmit: 'فشل الإرسال',
  qmErrNetwork: 'خطأ في الشبكة.',
  msTitle: 'المراحل',
  msDoneOfTotal: (d, total) => `${d} / ${total} مكتمل`,
  msLoading: 'جارٍ التحميل…',
  msEmpty: 'لا توجد مراحل.',
  msDueLabel: 'يستحق:',
  msCompletedLabel: 'مكتمل:',
  msNewPlaceholder: 'عنوان مرحلة جديدة…',
  msBtnAdd: 'إضافة',
  msBtnClose: 'إغلاق',
  pmTitle: 'تحديث التقدم',
  pmProgressLabel: (n) => `التقدم: ${n}%`,
  pmStatusLabel: 'الحالة',
  pmNoteLabel: 'ملاحظة التحديث',
  pmNotePlaceholder: 'ملاحظة التقدم (اختياري)',
  pmBtnCancel: 'إلغاء',
  pmBtnSave: 'حفظ',
  pmBtnSaving: 'جارٍ الحفظ…',
  pmErrUpdate: 'فشل التحديث',
  pmErrNetwork: 'خطأ في الشبكة.',
};

export function dashboardDict(lang: PartnerLang): DashboardDict {
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
