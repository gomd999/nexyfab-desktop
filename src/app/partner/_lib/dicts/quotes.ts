// Quotes page dictionary — only the page-level chrome (header / tabs /
// status pills / empty states / bulk-action toolbar / common buttons).
// The dynamic side-panels (RfqResponderPanel, OrderPriorityPanel,
// CapacityMatchPanel, QuoteAccuracyPanel, AI history / stats / prefs /
// orders panels) are KR-only for now and will be migrated together as
// the "quotes panels" batch.

import type { PartnerLang } from '../partnerLang';

export interface QuotesDict {
  pageTitle: string;
  pageSubtitle: string;
  loading: string;
  fetchError: string;

  tabAll: string;
  tabPending: string;
  tabAccepted: string;
  tabRejected: string;
  tabExpired: string;

  status_pending: string;
  status_responded: string;
  status_accepted: string;
  status_rejected: string;
  status_expired: string;

  invitationsBanner: (n: number) => string;
  invitationsBannerCta: string;

  emptyAll: string;
  emptyPending: string;
  emptyAccepted: string;
  emptyRejected: string;
  emptyExpired: string;

  bulkSelected: (n: number) => string;
  bulkBtnDecline: string;
  bulkBtnExtend: string;
  bulkBtnClear: string;
  bulkConfirmDecline: (n: number) => string;
  bulkSuccess: (updated: number, skipped: number) => string;
  bulkDemoSuccess: (n: number) => string;
  bulkErrFailed: string;

  btnRespond: string;
  btnEdit: string;
  btnPdf: string;
  btnShare: string;
  btnAiAssist: string;

  validUntilPrefix: string;
  respondedAtPrefix: string;

  pageHeader: string;
  pageSubheader: string;
  aiMenuToggle: string;
  aiBtnPriority: string;
  aiBtnCapacity: string;
  aiBtnAccuracy: string;
  aiBtnHistory: string;
  aiBtnOrders: string;
  aiBtnStats: string;
  aiBtnPrefs: string;
  invitationsBannerTitle: (n: number) => string;
  invitationsBannerBody: string;
  fetchErrorTitle: string;
  retryBtn: string;
  emptyAssigned: string;
  emptyAssignedHint: string;
  validUntil: (date: string) => string;
  selectAria: string;
  btnSubmitQuote: string;
  btnEditQuote: string;
  btnQuotePdf: string;
  modelSectionTitle: string;
  submittedQuoteTitle: string;
  submittedAmount: string;
  submittedDays: string;
  submittedDaysUnit: (n: number) => string;
  submittedAt: (date: string) => string;
  modalEdit: string;
  modalNew: string;
  modalAiDraft: string;
  modalAutoCalc: string;
  modalAutoCalcLoading: string;
  modalUrgentBtn: string;
  modalAutoResultTitle: string;
  modalUrgentBadge: string;
  modalLabelTotal: string;
  modalLabelUnit: string;
  modalLabelMaterial: string;
  modalLabelMachine: string;
  modalLabelSetup: string;
  modalLabelVolumeDiscount: string;
  modalLabelLeadTime: string;
  modalLabelLeadTimeRange: (min: number, max: number) => string;
  modalFieldAmount: string;
  modalFieldAmountPh: string;
  modalFieldDays: string;
  modalFieldDaysPh: string;
  modalFieldNote: string;
  modalFieldNotePh: string;
  modalSubmitting: string;
  modalSubmit: string;
  modalSubmitEdit: string;
  modalCancel: string;
  toastAiDraftApplied: string;
  toastSubmitOk: string;
  toastEditOk: string;
  toastSubmitFail: string;
  toastDemoSubmit: string;
  toastAutoQuoteFailed: string;
  toastAutoQuoteDemoWarning: string;
  bulkToolbarLabel: string;
  bulkValidLabel: string;
  bulkExtendBtn: string;
  bulkExtending: string;
  bulkDeclineBtn: string;
  bulkDeclining: string;
  bulkClearSelection: string;
}

const KO: QuotesDict = {
  pageTitle: '견적 관리',
  pageSubtitle: '제출한 견적을 확인하고 응답을 관리합니다.',
  loading: '불러오는 중...',
  fetchError: '견적을 불러오지 못했습니다.',

  tabAll: '전체',
  tabPending: '검토중',
  tabAccepted: '수락됨',
  tabRejected: '거절됨',
  tabExpired: '만료',

  status_pending: '응답 대기',
  status_responded: '응답 완료',
  status_accepted: '수락됨',
  status_rejected: '거절됨',
  status_expired: '만료됨',

  invitationsBanner: (n) => `📬 응답 대기 중인 새 견적 요청 ${n}건`,
  invitationsBannerCta: '확인하러 가기 →',

  emptyAll: '제출한 견적이 없습니다.',
  emptyPending: '검토 중인 견적이 없습니다.',
  emptyAccepted: '수락된 견적이 없습니다.',
  emptyRejected: '거절된 견적이 없습니다.',
  emptyExpired: '만료된 견적이 없습니다.',

  bulkSelected: (n) => `${n}건 선택됨`,
  bulkBtnDecline: '일괄 거절',
  bulkBtnExtend: '유효기간 연장',
  bulkBtnClear: '선택 해제',
  bulkConfirmDecline: (n) => `${n}건의 견적을 거절 처리합니다. 계속할까요?`,
  bulkSuccess: (u, s) => `${u}건 처리 완료${s ? ` (${s}건 건너뜀)` : ''}`,
  bulkDemoSuccess: (n) => `[데모] ${n}건 처리 완료`,
  bulkErrFailed: '일괄 처리에 실패했습니다.',

  btnRespond: '응답하기',
  btnEdit: '수정',
  btnPdf: 'PDF',
  btnShare: '공유',
  btnAiAssist: 'AI 보조',

  validUntilPrefix: '유효기간:',
  respondedAtPrefix: '응답일:',

  pageHeader: '견적 요청',
  pageSubheader: '어드민이 지정한 견적 요청 목록',
  aiMenuToggle: '⚙ AI 도구',
  aiBtnPriority: '🏆 AI 우선순위',
  aiBtnCapacity: '🔗 캐파 매칭',
  aiBtnAccuracy: '📊 견적 정확도',
  aiBtnHistory: '📜 AI 이력',
  aiBtnOrders: '📦 주문 관리',
  aiBtnStats: '📈 실적 통계',
  aiBtnPrefs: '⚙️ AI 설정',
  invitationsBannerTitle: (n) => `들어온 견적 요청 ${n}건`,
  invitationsBannerBody: 'NexyFab 운영팀이 귀사를 추천한 RFQ입니다 — 견적을 작성해 주세요',
  fetchErrorTitle: '견적 목록을 불러오지 못했습니다.',
  retryBtn: '다시 시도',
  emptyAssigned: '배정된 견적 요청이 없습니다',
  emptyAssignedHint: '어드민이 견적을 배정하면 여기에 표시됩니다.',
  validUntil: (date) => `유효: ${date}`,
  selectAria: '견적 선택',
  btnSubmitQuote: '견적 제출',
  btnEditQuote: '수정',
  btnQuotePdf: '견적서 PDF',
  modelSectionTitle: '3D 모델',
  submittedQuoteTitle: '제출한 견적',
  submittedAmount: '견적 금액',
  submittedDays: '납기일',
  submittedDaysUnit: (n) => `${n}일`,
  submittedAt: (date) => `제출: ${date}`,
  modalEdit: '견적 수정',
  modalNew: '견적 제출',
  modalAiDraft: '🤖 AI 회신 초안 (자동 작성)',
  modalAutoCalc: '📋 단가표 자동 견적',
  modalAutoCalcLoading: '계산 중…',
  modalUrgentBtn: '⚡ 긴급 단가',
  modalAutoResultTitle: '단가표 기준 자동 견적',
  modalUrgentBadge: '긴급 ×',
  modalLabelTotal: '총액',
  modalLabelUnit: '단가 (개당)',
  modalLabelMaterial: '재료',
  modalLabelMachine: '가공',
  modalLabelSetup: '셋업',
  modalLabelVolumeDiscount: '수량 할인',
  modalLabelLeadTime: '리드타임',
  modalLabelLeadTimeRange: (min, max) => `${min}~${max}일`,
  modalFieldAmount: '견적 금액 (원) *',
  modalFieldAmountPh: '예: 45000000',
  modalFieldDays: '납기일 (일수)',
  modalFieldDaysPh: '예: 14',
  modalFieldNote: '메모',
  modalFieldNotePh: '견적 관련 추가 사항...',
  modalSubmitting: '처리 중...',
  modalSubmit: '제출하기',
  modalSubmitEdit: '수정하기',
  modalCancel: '취소',
  toastAiDraftApplied: 'AI 초안이 적용되었습니다. 검토 후 제출해주세요.',
  toastSubmitOk: '견적이 제출되었습니다.',
  toastEditOk: '견적이 수정되었습니다.',
  toastSubmitFail: '견적 제출에 실패했습니다.',
  toastDemoSubmit: '[데모] 견적이 제출되었습니다.',
  toastAutoQuoteFailed: '자동 견적 생성에 실패했습니다. 단가표를 먼저 등록해 주세요.',
  toastAutoQuoteDemoWarning: '데모 모드: 단가표 미사용, 예시 값입니다.',
  bulkToolbarLabel: '견적 일괄 작업',
  bulkValidLabel: '유효기간',
  bulkExtendBtn: '일괄 연장',
  bulkExtending: '적용 중…',
  bulkDeclineBtn: '일괄 거절',
  bulkDeclining: '거절 중…',
  bulkClearSelection: '선택 해제',
};

const EN: QuotesDict = {
  pageTitle: 'Quotes',
  pageSubtitle: 'Review submitted quotes and manage responses.',
  loading: 'Loading…',
  fetchError: 'Could not load quotes.',

  tabAll: 'All',
  tabPending: 'In review',
  tabAccepted: 'Accepted',
  tabRejected: 'Rejected',
  tabExpired: 'Expired',

  status_pending: 'Awaiting response',
  status_responded: 'Responded',
  status_accepted: 'Accepted',
  status_rejected: 'Rejected',
  status_expired: 'Expired',

  invitationsBanner: (n) => `📬 ${n} new RFQ${n === 1 ? '' : 's'} awaiting your response`,
  invitationsBannerCta: 'Open invitations →',

  emptyAll: 'No quotes submitted yet.',
  emptyPending: 'No quotes currently in review.',
  emptyAccepted: 'No accepted quotes yet.',
  emptyRejected: 'No rejected quotes.',
  emptyExpired: 'No expired quotes.',

  bulkSelected: (n) => `${n} selected`,
  bulkBtnDecline: 'Decline selected',
  bulkBtnExtend: 'Extend validity',
  bulkBtnClear: 'Clear selection',
  bulkConfirmDecline: (n) => `Decline ${n} quote${n === 1 ? '' : 's'}? Continue?`,
  bulkSuccess: (u, s) => `${u} processed${s ? ` (${s} skipped)` : ''}`,
  bulkDemoSuccess: (n) => `[demo] ${n} processed`,
  bulkErrFailed: 'Bulk operation failed.',

  btnRespond: 'Respond',
  btnEdit: 'Edit',
  btnPdf: 'PDF',
  btnShare: 'Share',
  btnAiAssist: 'AI assist',

  validUntilPrefix: 'Valid until:',
  respondedAtPrefix: 'Responded:',

  pageHeader: 'RFQs',
  pageSubheader: 'Quote requests assigned by admin',
  aiMenuToggle: '⚙ AI tools',
  aiBtnPriority: '🏆 AI priority',
  aiBtnCapacity: '🔗 Capacity match',
  aiBtnAccuracy: '📊 Quote accuracy',
  aiBtnHistory: '📜 AI history',
  aiBtnOrders: '📦 Orders',
  aiBtnStats: '📈 Performance',
  aiBtnPrefs: '⚙️ AI settings',
  invitationsBannerTitle: (n) => `${n} incoming RFQ${n === 1 ? '' : 's'}`,
  invitationsBannerBody: 'NexyFab ops shortlisted your factory — write the quote.',
  fetchErrorTitle: 'Could not load the quote list.',
  retryBtn: 'Retry',
  emptyAssigned: 'No assigned RFQs',
  emptyAssignedHint: 'Assigned RFQs from admin will show up here.',
  validUntil: (date) => `Valid: ${date}`,
  selectAria: 'Select quote',
  btnSubmitQuote: 'Submit quote',
  btnEditQuote: 'Edit',
  btnQuotePdf: 'Quote PDF',
  modelSectionTitle: '3D model',
  submittedQuoteTitle: 'Submitted quote',
  submittedAmount: 'Amount',
  submittedDays: 'Lead time',
  submittedDaysUnit: (n) => `${n}d`,
  submittedAt: (date) => `Submitted: ${date}`,
  modalEdit: 'Edit quote',
  modalNew: 'Submit quote',
  modalAiDraft: '🤖 AI draft response',
  modalAutoCalc: '📋 Auto quote from price book',
  modalAutoCalcLoading: 'Calculating…',
  modalUrgentBtn: '⚡ Urgent rate',
  modalAutoResultTitle: 'Price-book based auto-quote',
  modalUrgentBadge: 'Urgent ×',
  modalLabelTotal: 'Total',
  modalLabelUnit: 'Unit price',
  modalLabelMaterial: 'Material',
  modalLabelMachine: 'Machining',
  modalLabelSetup: 'Setup',
  modalLabelVolumeDiscount: 'Volume discount',
  modalLabelLeadTime: 'Lead time',
  modalLabelLeadTimeRange: (min, max) => `${min}-${max}d`,
  modalFieldAmount: 'Quote amount (KRW) *',
  modalFieldAmountPh: 'e.g. 45000000',
  modalFieldDays: 'Lead time (days)',
  modalFieldDaysPh: 'e.g. 14',
  modalFieldNote: 'Note',
  modalFieldNotePh: 'Additional notes…',
  modalSubmitting: 'Processing…',
  modalSubmit: 'Submit',
  modalSubmitEdit: 'Save',
  modalCancel: 'Cancel',
  toastAiDraftApplied: 'AI draft applied. Review and submit.',
  toastSubmitOk: 'Quote submitted.',
  toastEditOk: 'Quote updated.',
  toastSubmitFail: 'Failed to submit the quote.',
  toastDemoSubmit: '[demo] Quote submitted.',
  toastAutoQuoteFailed: 'Auto-quote failed. Please set up the price book first.',
  toastAutoQuoteDemoWarning: 'Demo mode: no price book used, example values.',
  bulkToolbarLabel: 'Bulk quote actions',
  bulkValidLabel: 'Valid until',
  bulkExtendBtn: 'Extend',
  bulkExtending: 'Applying…',
  bulkDeclineBtn: 'Decline',
  bulkDeclining: 'Declining…',
  bulkClearSelection: 'Clear selection',
};

const JA: QuotesDict = {
  ...EN,
  pageTitle: '見積管理',
  pageSubtitle: '提出済みの見積もりを確認し対応します。',
  loading: '読み込み中…',
  fetchError: '見積もりを読み込めませんでした。',
  tabAll: 'すべて',
  tabPending: '審査中',
  tabAccepted: '採用',
  tabRejected: '不採用',
  tabExpired: '期限切れ',
  status_pending: '応答待ち',
  status_responded: '応答完了',
  status_accepted: '採用',
  status_rejected: '不採用',
  status_expired: '期限切れ',
  invitationsBanner: (n) => `📬 応答待ちの新規 RFQ ${n}件`,
  invitationsBannerCta: '確認する →',
  emptyAll: '提出した見積もりはありません。',
  emptyPending: '審査中の見積もりはありません。',
  emptyAccepted: '採用された見積もりはありません。',
  emptyRejected: '不採用の見積もりはありません。',
  emptyExpired: '期限切れの見積もりはありません。',
  bulkSelected: (n) => `${n}件 選択`,
  bulkBtnDecline: '一括拒否',
  bulkBtnExtend: '有効期間延長',
  bulkBtnClear: '選択解除',
  bulkConfirmDecline: (n) => `${n}件の見積もりを拒否します。続行しますか？`,
  bulkSuccess: (u, s) => `${u}件処理完了${s ? ` (${s}件スキップ)` : ''}`,
  bulkDemoSuccess: (n) => `[デモ] ${n}件処理完了`,
  bulkErrFailed: '一括処理に失敗しました。',
  btnRespond: '応答',
  btnEdit: '編集',
  btnShare: '共有',
  btnAiAssist: 'AI 支援',
  validUntilPrefix: '有効期限:',
  respondedAtPrefix: '応答日:',
};

const CN: QuotesDict = {
  ...EN,
  pageTitle: '报价管理',
  pageSubtitle: '查看已提交的报价并管理响应。',
  loading: '加载中…',
  fetchError: '加载报价失败。',
  tabAll: '全部',
  tabPending: '审核中',
  tabAccepted: '已采纳',
  tabRejected: '已拒绝',
  tabExpired: '已过期',
  status_pending: '等待响应',
  status_responded: '已响应',
  status_accepted: '已采纳',
  status_rejected: '已拒绝',
  status_expired: '已过期',
  invitationsBanner: (n) => `📬 等待响应的新 RFQ ${n}条`,
  invitationsBannerCta: '前往查看 →',
  emptyAll: '尚未提交任何报价。',
  emptyPending: '没有审核中的报价。',
  emptyAccepted: '没有被采纳的报价。',
  emptyRejected: '没有被拒绝的报价。',
  emptyExpired: '没有过期的报价。',
  bulkSelected: (n) => `已选 ${n} 条`,
  bulkBtnDecline: '批量拒绝',
  bulkBtnExtend: '延长有效期',
  bulkBtnClear: '清除选择',
  bulkConfirmDecline: (n) => `将拒绝 ${n} 条报价。继续？`,
  bulkSuccess: (u, s) => `已处理 ${u} 条${s ? ` (跳过 ${s})` : ''}`,
  bulkDemoSuccess: (n) => `[演示] 已处理 ${n} 条`,
  bulkErrFailed: '批量操作失败。',
  btnRespond: '响应',
  btnEdit: '编辑',
  btnShare: '分享',
  btnAiAssist: 'AI 辅助',
  validUntilPrefix: '有效期至:',
  respondedAtPrefix: '响应:',
};

const ES: QuotesDict = {
  ...EN,
  pageTitle: 'Cotizaciones',
  pageSubtitle: 'Revisa las cotizaciones enviadas y gestiona respuestas.',
  loading: 'Cargando…',
  fetchError: 'No se pudieron cargar las cotizaciones.',
  tabAll: 'Todas',
  tabPending: 'En revisión',
  tabAccepted: 'Aceptadas',
  tabRejected: 'Rechazadas',
  tabExpired: 'Expiradas',
  status_pending: 'Esperando respuesta',
  status_responded: 'Respondida',
  status_accepted: 'Aceptada',
  status_rejected: 'Rechazada',
  status_expired: 'Expirada',
  invitationsBanner: (n) => `📬 ${n} RFQ nuev${n === 1 ? 'a' : 'as'} esperando respuesta`,
  invitationsBannerCta: 'Ver invitaciones →',
  emptyAll: 'Aún no has enviado cotizaciones.',
  emptyPending: 'No hay cotizaciones en revisión.',
  emptyAccepted: 'Aún no hay cotizaciones aceptadas.',
  emptyRejected: 'No hay cotizaciones rechazadas.',
  emptyExpired: 'No hay cotizaciones expiradas.',
  bulkSelected: (n) => `${n} seleccionada${n === 1 ? '' : 's'}`,
  bulkBtnDecline: 'Rechazar seleccionadas',
  bulkBtnExtend: 'Ampliar validez',
  bulkBtnClear: 'Quitar selección',
  bulkConfirmDecline: (n) => `¿Rechazar ${n} cotizaci${n === 1 ? 'ón' : 'ones'}? ¿Continuar?`,
  bulkSuccess: (u, s) => `${u} procesad${u === 1 ? 'a' : 'as'}${s ? ` (${s} omitida${s === 1 ? '' : 's'})` : ''}`,
  bulkDemoSuccess: (n) => `[demo] ${n} procesad${n === 1 ? 'a' : 'as'}`,
  bulkErrFailed: 'Error en la operación por lotes.',
  btnRespond: 'Responder',
  btnEdit: 'Editar',
  btnShare: 'Compartir',
  btnAiAssist: 'Ayuda IA',
  validUntilPrefix: 'Válida hasta:',
  respondedAtPrefix: 'Respuesta:',
};

const AR: QuotesDict = {
  ...EN,
  pageTitle: 'إدارة العروض',
  pageSubtitle: 'راجع العروض المُقدَّمة وأدر الردود.',
  loading: 'جارٍ التحميل…',
  fetchError: 'تعذّر تحميل العروض.',
  tabAll: 'الكل',
  tabPending: 'قيد المراجعة',
  tabAccepted: 'مقبولة',
  tabRejected: 'مرفوضة',
  tabExpired: 'منتهية',
  status_pending: 'بانتظار الرد',
  status_responded: 'تم الرد',
  status_accepted: 'مقبول',
  status_rejected: 'مرفوض',
  status_expired: 'منتهي',
  invitationsBanner: (n) => `📬 ${n} طلبات RFQ جديدة بانتظار ردك`,
  invitationsBannerCta: 'فتح الدعوات ←',
  emptyAll: 'لم تقدم عروضًا بعد.',
  emptyPending: 'لا توجد عروض قيد المراجعة.',
  emptyAccepted: 'لا توجد عروض مقبولة بعد.',
  emptyRejected: 'لا توجد عروض مرفوضة.',
  emptyExpired: 'لا توجد عروض منتهية.',
  bulkSelected: (n) => `${n} محدد`,
  bulkBtnDecline: 'رفض المحدد',
  bulkBtnExtend: 'تمديد الصلاحية',
  bulkBtnClear: 'إلغاء التحديد',
  bulkConfirmDecline: (n) => `رفض ${n} عرض؟ المتابعة؟`,
  bulkSuccess: (u, s) => `تمت معالجة ${u}${s ? ` (تم تخطي ${s})` : ''}`,
  bulkDemoSuccess: (n) => `[تجريبي] تمت معالجة ${n}`,
  bulkErrFailed: 'فشلت العملية الجماعية.',
  btnRespond: 'الرد',
  btnEdit: 'تحرير',
  btnShare: 'مشاركة',
  btnAiAssist: 'مساعدة الذكاء الاصطناعي',
  validUntilPrefix: 'صالح حتى:',
  respondedAtPrefix: 'الرد:',
};

export function quotesDict(lang: PartnerLang): QuotesDict {
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
