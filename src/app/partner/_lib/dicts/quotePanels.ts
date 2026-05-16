// Shared dictionary for the 8 quote-page sub-panels. Single module keeps
// the per-panel keys close together for review; each panel imports the
// same `quotePanelsDict(lang)` and namespaces its own keys.

import type { PartnerLang } from '../partnerLang';

export interface QuotePanelsDict {
  // PartnerNotificationBell
  notifTooltip: string;
  notifTitle: string;
  notifMarkAllRead: string;
  notifEmpty: string;
  notifRelJustNow: string;
  notifRelMinutes: (n: number) => string;
  notifRelHours: (n: number) => string;
  notifRelDays: (n: number) => string;

  // OrderPriorityPanel
  opTitle: string;
  opSubtitle: string;
  opLoading: string;
  opEmpty: string;
  opSeverityHigh: string;
  opSeverityMid: string;
  opSeverityLow: string;
  opQuoteFirst: string;
  opSummary: string;
  opHeader: string;
  opSubtitleCount: (n: number) => string;
  opFieldHourlyRate: string;
  opFieldMargin: string;
  opFieldBacklog: string;
  opFieldCapacity: string;
  opErrorPro: string;
  opErrorGeneric: string;
  opTopPick: string;
  opTagPriority: string;
  opTagGoodFit: string;
  opTagConsider: string;
  opTagPass: string;
  opMarginEst: string;
  opMarginShort: (pct: number) => string;
  opReasons: string;
  opRisks: string;
  opSubmitThis: string;
  opRunBtn: string;
  opAnalyzing: string;
  opRetry: string;
  opClose: string;

  // PartnerAIHistoryPanel
  aihTitle: string;
  aihSubtitle: string;
  aihLoading: string;
  aihEmpty: string;
  aihAdoptedSuffix: string;
  aihColTime: string;
  aihColModel: string;
  aihColInput: string;
  aihColOutput: string;
  aihColStatus: string;
  aihFilterAll: string;
  aihFilterRfqResponder: string;
  aihFilterOrderPriority: string;
  aihFilterCapacityMatch: string;
  aihFilterQuoteAccuracy: string;
  aihLoadFail: string;
  aihConfirmDelete: string;
  aihDeleteFail: string;
  aihDeleteBtn: string;
  aihRelSeconds: (n: number) => string;

  // PartnerOrdersPanel
  poTitle: string;
  poSubtitle: string;
  poLoading: string;
  poEmpty: string;
  poStatus_pending: string;
  poStatus_in_progress: string;
  poStatus_shipped: string;
  poStatus_delivered: string;
  poDueLabel: string;
  poQtyUnit: string;
  poHeader: string;
  poCount: (n: number) => string;
  poFilterAll: string;
  poStatus_placed: string;
  poStatus_production: string;
  poStatus_qc: string;
  poErrorLoad: string;
  poErrorGeneric: string;
  poUpdateSuccess: (name: string, status: string) => string;
  poUpdateFail: string;
  poBadgePaid: string;
  poEmptyFiltered: string;
  poOrderQty: (n: string) => string;
  poOrderedOn: (date: string) => string;
  poDueOn: (date: string) => string;
  poBtnProcessing: string;
  poBtnDeliveredDone: string;
  poBtnPdf: string;
  poBtnTaxInvoice: string;
  poNext_placed: string;
  poNext_production: string;
  poNext_qc: string;
  poNext_shipped: string;

  // PartnerStatsPanel
  psTitle: string;
  psSubtitle: string;
  psLoading: string;
  psMetricTotalQuotes: string;
  psMetricWinRate: string;
  psMetricAvgResponse: string;
  psMetricAvgAmount: string;
  psWindowLabel: (days: number) => string;
  psHeader: string;
  psFallbackCompany: string;
  psPeriodAll: string;
  psMetricTotalRfq: string;
  psMetricAccept: string;
  psMetricResponse: string;
  psMetricAvgAccept: string;
  psSubAcceptBase: string;
  psSubCountSuffix: string;
  psSubAcceptRatio: (n: number, total: number) => string;
  psDistributionTitle: string;
  psLegendAccepted: string;
  psLegendInProgress: string;
  psLegendRejected: string;
  psLegendPending: string;
  psLegendCount: (n: number) => string;
  psCumulativeTitle: string;
  psProcessTitle: string;
  psProcessUncategorised: string;
  psMonthlyTitle: string;
  psEmpty: string;
  psClose: string;
  psUnitDash: string;

  // PartnerAIPrefsPanel
  apTitle: string;
  apSubtitle: string;
  apStrategyLabel: string;
  apStrategyCompetitive: string;
  apStrategyBalanced: string;
  apStrategyPremium: string;
  apToneLabel: string;
  apToneFormal: string;
  apToneFriendly: string;
  apToneTechnical: string;
  apMarginLabel: string;
  apLeadTimeLabel: string;
  apSave: string;
  apSaving: string;
  apSaved: string;

  // RfqResponderPanel
  rrTitle: string;
  rrSubtitle: string;
  rrLoading: string;
  rrEmpty: string;
  rrAutoDraftBtn: string;
  rrAutoDrafting: string;
  rrUseSuggested: string;
  rrAccuracyAdjust: (pct: number) => string;
  rrFieldAmount: string;
  rrFieldDays: string;
  rrFieldNote: string;
  rrFieldNotePlaceholder: string;
  rrSubmitBtn: string;
  rrSubmitting: string;
  rrErrorAmount: string;
  rrSuccess: string;

  // QuoteAccuracyPanel
  qaTitle: string;
  qaSubtitle: string;
  qaLoading: string;
  qaEmpty: string;
  qaInsightDeviation: string;
  qaInsightWinThreshold: string;
  qaInsightSuggestion: string;
  qaConfidence: (pct: number) => string;
  qaApplyBtn: string;
}

const KO: QuotePanelsDict = {
  notifTooltip: '알림',
  notifTitle: '알림',
  notifMarkAllRead: '모두 읽음',
  notifEmpty: '새 알림이 없습니다',
  notifRelJustNow: '방금 전',
  notifRelMinutes: (n) => `${n}분 전`,
  notifRelHours: (n) => `${n}시간 전`,
  notifRelDays: (n) => `${n}일 전`,

  opTitle: '주문 우선순위',
  opSubtitle: '시급도가 높은 주문부터 처리하세요.',
  opLoading: '불러오는 중...',
  opEmpty: '현재 우선순위가 높은 주문이 없습니다.',
  opSeverityHigh: '높음',
  opSeverityMid: '중간',
  opSeverityLow: '낮음',
  opQuoteFirst: '먼저 응답',
  opSummary: '요약',
  opHeader: '🏆 수주 우선순위 AI',
  opSubtitleCount: (n) => `${n}건 검토 대기 → 수익성 · 납기 · 공정 적합도 분석`,
  opFieldHourlyRate: '시간당 단가 (KRW/hr)',
  opFieldMargin: '재료 마진 (0-1)',
  opFieldBacklog: '현재 백로그 (일)',
  opFieldCapacity: '가용 캐파 (일)',
  opErrorPro: 'Pro 플랜이 필요합니다.',
  opErrorGeneric: '분석 실패',
  opTopPick: '🏆 AI 추천',
  opTagPriority: '우선순위',
  opTagGoodFit: '적합',
  opTagConsider: '검토',
  opTagPass: '보류',
  opMarginEst: '예상 마진',
  opMarginShort: (pct) => `마진 ~${pct}%`,
  opReasons: '✅ 수주 이유',
  opRisks: '⚠️ 리스크',
  opSubmitThis: '→ 이 견적 제출하기',
  opRunBtn: '🏆 AI 우선순위 분석',
  opAnalyzing: '분석 중...',
  opRetry: '🔄 다시 분석',
  opClose: '닫기',

  aihTitle: 'AI 사용 이력',
  aihSubtitle: '파트너 AI 기능 실행 결과',
  aihLoading: '불러오는 중…',
  aihEmpty: '저장된 AI 이력이 없습니다.',
  aihAdoptedSuffix: '채택',
  aihColTime: '시각',
  aihColModel: '모델',
  aihColInput: '입력',
  aihColOutput: '출력',
  aihColStatus: '상태',
  aihFilterAll: '전체',
  aihFilterRfqResponder: 'RFQ 회신',
  aihFilterOrderPriority: 'AI 우선순위',
  aihFilterCapacityMatch: '캐파 매칭',
  aihFilterQuoteAccuracy: '견적 정확도',
  aihLoadFail: '불러오기 실패',
  aihConfirmDelete: '이 이력을 삭제할까요?',
  aihDeleteFail: '삭제에 실패했습니다.',
  aihDeleteBtn: '🗑 삭제',
  aihRelSeconds: (n) => `${n}초 전`,

  poTitle: '진행 주문',
  poSubtitle: '확정된 주문의 진행 상태',
  poLoading: '불러오는 중...',
  poEmpty: '담당 주문이 없습니다.',
  poStatus_pending: '대기',
  poStatus_in_progress: '진행 중',
  poStatus_shipped: '배송 중',
  poStatus_delivered: '납품 완료',
  poDueLabel: '납기',
  poQtyUnit: '개',
  poHeader: '📦 담당 주문 관리',
  poCount: (n) => `(${n}건)`,
  poFilterAll: '전체',
  poStatus_placed: '주문 접수',
  poStatus_production: '생산 중',
  poStatus_qc: '품질 검사',
  poErrorLoad: '주문 목록을 불러오지 못했습니다.',
  poErrorGeneric: '❌ 오류가 발생했습니다.',
  poUpdateSuccess: (name, status) => `✅ ${name} 상태가 "${status}"으로 업데이트됐습니다.`,
  poUpdateFail: '업데이트 실패',
  poBadgePaid: '결제완료',
  poEmptyFiltered: '해당 상태의 주문이 없습니다.',
  poOrderQty: (n) => `수량 ${n}개`,
  poOrderedOn: (date) => `주문일 ${date}`,
  poDueOn: (date) => `납기 예정 ${date}`,
  poBtnProcessing: '처리 중...',
  poBtnDeliveredDone: '✓ 납품 완료',
  poBtnPdf: '📄 PDF',
  poBtnTaxInvoice: '🧾 세금계산서',
  poNext_placed: '생산 시작',
  poNext_production: 'QC 시작',
  poNext_qc: '배송 시작',
  poNext_shipped: '납품 완료',

  psTitle: '내 실적',
  psSubtitle: '최근 견적 활동 요약',
  psLoading: '불러오는 중...',
  psMetricTotalQuotes: '총 견적 수',
  psMetricWinRate: '수주율',
  psMetricAvgResponse: '평균 응답',
  psMetricAvgAmount: '평균 견적가',
  psWindowLabel: (d) => `최근 ${d}일`,
  psHeader: '파트너 실적 통계',
  psFallbackCompany: '내 견적',
  psPeriodAll: '전체 기간',
  psMetricTotalRfq: '전체 RFQ',
  psMetricAccept: '수락률',
  psMetricResponse: '응답률',
  psMetricAvgAccept: '평균 수락금액',
  psSubAcceptBase: '수락 건 기준',
  psSubCountSuffix: '건',
  psSubAcceptRatio: (n, total) => `${n}/${total}건`,
  psDistributionTitle: 'RFQ 결과 분포',
  psLegendAccepted: '수락',
  psLegendInProgress: '응답중',
  psLegendRejected: '거절',
  psLegendPending: '대기',
  psLegendCount: (n) => `${n}건`,
  psCumulativeTitle: '💰 누적 수주 금액',
  psProcessTitle: '공정별 RFQ',
  psProcessUncategorised: '미분류',
  psMonthlyTitle: '월별 수락률 추이',
  psEmpty: '아직 RFQ 데이터가 없습니다.',
  psClose: '닫기',
  psUnitDash: '—',

  apTitle: 'AI 설정',
  apSubtitle: 'AI 견적 초안의 기본값을 설정합니다.',
  apStrategyLabel: '전략',
  apStrategyCompetitive: '경쟁형 (낮은 가격 우선)',
  apStrategyBalanced: '균형형',
  apStrategyPremium: '프리미엄형 (마진 우선)',
  apToneLabel: '톤',
  apToneFormal: '공식적',
  apToneFriendly: '친근함',
  apToneTechnical: '기술적',
  apMarginLabel: '목표 마진율 (%)',
  apLeadTimeLabel: '기본 납기 (일)',
  apSave: '저장',
  apSaving: '저장 중...',
  apSaved: '저장됨',

  rrTitle: 'AI 견적 응답',
  rrSubtitle: 'AI 가 초안을 만들어 빠르게 응답할 수 있습니다.',
  rrLoading: '불러오는 중...',
  rrEmpty: '응답할 RFQ를 선택해주세요.',
  rrAutoDraftBtn: '⚡ AI 초안 생성',
  rrAutoDrafting: '생성 중...',
  rrUseSuggested: '제안 적용',
  rrAccuracyAdjust: (pct) => `정확도 보정: ${pct >= 0 ? '+' : ''}${pct}%`,
  rrFieldAmount: '견적 금액 (원)',
  rrFieldDays: '납기 (영업일)',
  rrFieldNote: '메모',
  rrFieldNotePlaceholder: '추가 사항 (선택)',
  rrSubmitBtn: '견적 등록',
  rrSubmitting: '등록 중...',
  rrErrorAmount: '견적 금액을 입력해 주세요.',
  rrSuccess: '견적이 등록됐습니다.',

  qaTitle: '견적 정확도',
  qaSubtitle: '과거 수주/실패 데이터 기반 가격 인사이트',
  qaLoading: '분석 중...',
  qaEmpty: '분석할 데이터가 부족합니다.',
  qaInsightDeviation: '시장 평균 대비 편차',
  qaInsightWinThreshold: '수주 가능 임계가',
  qaInsightSuggestion: '추천 가격',
  qaConfidence: (pct) => `신뢰도 ${pct}%`,
  qaApplyBtn: '응답폼에 적용',
};

const EN: QuotePanelsDict = {
  notifTooltip: 'Notifications',
  notifTitle: 'Notifications',
  notifMarkAllRead: 'Mark all read',
  notifEmpty: 'No new notifications',
  notifRelJustNow: 'just now',
  notifRelMinutes: (n) => `${n}m ago`,
  notifRelHours: (n) => `${n}h ago`,
  notifRelDays: (n) => `${n}d ago`,

  opTitle: 'Order priority',
  opSubtitle: 'Handle high-urgency orders first.',
  opLoading: 'Loading…',
  opEmpty: 'No high-priority orders right now.',
  opSeverityHigh: 'High',
  opSeverityMid: 'Mid',
  opSeverityLow: 'Low',
  opQuoteFirst: 'Quote first',
  opSummary: 'Summary',
  opHeader: '🏆 Order priority AI',
  opSubtitleCount: (n) => `${n} pending — margin · deadline · process-fit analysis`,
  opFieldHourlyRate: 'Hourly rate (KRW/hr)',
  opFieldMargin: 'Material margin (0-1)',
  opFieldBacklog: 'Current backlog (days)',
  opFieldCapacity: 'Available capacity (days)',
  opErrorPro: 'Pro plan required.',
  opErrorGeneric: 'Analysis failed',
  opTopPick: '🏆 AI pick',
  opTagPriority: 'PRIORITY',
  opTagGoodFit: 'GOOD FIT',
  opTagConsider: 'CONSIDER',
  opTagPass: 'PASS',
  opMarginEst: 'Estimated margin',
  opMarginShort: (pct) => `margin ~${pct}%`,
  opReasons: '✅ Why win',
  opRisks: '⚠️ Risks',
  opSubmitThis: '→ Submit this quote',
  opRunBtn: '🏆 Run AI priority',
  opAnalyzing: 'Analysing…',
  opRetry: '🔄 Re-run',
  opClose: 'Close',

  aihTitle: 'AI usage history',
  aihSubtitle: 'Recent AI feature runs',
  aihLoading: 'Loading…',
  aihEmpty: 'No saved AI history yet.',
  aihAdoptedSuffix: 'adopted',
  aihColTime: 'Time',
  aihColModel: 'Model',
  aihColInput: 'Input',
  aihColOutput: 'Output',
  aihColStatus: 'Status',
  aihFilterAll: 'All',
  aihFilterRfqResponder: 'RFQ reply',
  aihFilterOrderPriority: 'AI priority',
  aihFilterCapacityMatch: 'Capacity match',
  aihFilterQuoteAccuracy: 'Quote accuracy',
  aihLoadFail: 'Failed to load',
  aihConfirmDelete: 'Delete this entry?',
  aihDeleteFail: 'Failed to delete.',
  aihDeleteBtn: '🗑 Delete',
  aihRelSeconds: (n) => `${n}s ago`,

  poTitle: 'Active orders',
  poSubtitle: 'Confirmed orders in progress',
  poLoading: 'Loading…',
  poEmpty: 'No assigned orders.',
  poStatus_pending: 'Pending',
  poStatus_in_progress: 'In progress',
  poStatus_shipped: 'Shipping',
  poStatus_delivered: 'Delivered',
  poDueLabel: 'Due',
  poQtyUnit: ' pcs',
  poHeader: '📦 Order management',
  poCount: (n) => `(${n})`,
  poFilterAll: 'All',
  poStatus_placed: 'Placed',
  poStatus_production: 'In production',
  poStatus_qc: 'Quality check',
  poErrorLoad: 'Could not load orders.',
  poErrorGeneric: '❌ Something went wrong.',
  poUpdateSuccess: (name, status) => `✅ ${name} moved to "${status}".`,
  poUpdateFail: 'Update failed',
  poBadgePaid: 'Paid',
  poEmptyFiltered: 'No orders in this status.',
  poOrderQty: (n) => `Qty ${n}`,
  poOrderedOn: (date) => `Ordered ${date}`,
  poDueOn: (date) => `Due ${date}`,
  poBtnProcessing: 'Processing…',
  poBtnDeliveredDone: '✓ Delivered',
  poBtnPdf: '📄 PDF',
  poBtnTaxInvoice: '🧾 Tax invoice',
  poNext_placed: 'Start production',
  poNext_production: 'Start QC',
  poNext_qc: 'Start shipping',
  poNext_shipped: 'Mark delivered',

  psTitle: 'My performance',
  psSubtitle: 'Recent quoting summary',
  psLoading: 'Loading…',
  psMetricTotalQuotes: 'Total quotes',
  psMetricWinRate: 'Win rate',
  psMetricAvgResponse: 'Avg response',
  psMetricAvgAmount: 'Avg quote',
  psWindowLabel: (d) => `last ${d}d`,
  psHeader: 'Partner performance',
  psFallbackCompany: 'My quotes',
  psPeriodAll: 'All time',
  psMetricTotalRfq: 'Total RFQs',
  psMetricAccept: 'Accept rate',
  psMetricResponse: 'Response rate',
  psMetricAvgAccept: 'Avg accepted',
  psSubAcceptBase: 'accepted only',
  psSubCountSuffix: '',
  psSubAcceptRatio: (n, total) => `${n}/${total}`,
  psDistributionTitle: 'RFQ outcomes',
  psLegendAccepted: 'Accepted',
  psLegendInProgress: 'Responding',
  psLegendRejected: 'Rejected',
  psLegendPending: 'Pending',
  psLegendCount: (n) => `${n}`,
  psCumulativeTitle: '💰 Cumulative won',
  psProcessTitle: 'RFQs by process',
  psProcessUncategorised: 'Uncategorised',
  psMonthlyTitle: 'Monthly accept rate',
  psEmpty: 'No RFQ data yet.',
  psClose: 'Close',
  psUnitDash: '—',

  apTitle: 'AI preferences',
  apSubtitle: 'Defaults for AI quote drafts.',
  apStrategyLabel: 'Strategy',
  apStrategyCompetitive: 'Competitive (lowest price)',
  apStrategyBalanced: 'Balanced',
  apStrategyPremium: 'Premium (margin priority)',
  apToneLabel: 'Tone',
  apToneFormal: 'Formal',
  apToneFriendly: 'Friendly',
  apToneTechnical: 'Technical',
  apMarginLabel: 'Target margin (%)',
  apLeadTimeLabel: 'Default lead time (days)',
  apSave: 'Save',
  apSaving: 'Saving…',
  apSaved: 'Saved',

  rrTitle: 'AI quote response',
  rrSubtitle: 'AI drafts a quote so you can respond quickly.',
  rrLoading: 'Loading…',
  rrEmpty: 'Select an RFQ to respond to.',
  rrAutoDraftBtn: '⚡ Generate AI draft',
  rrAutoDrafting: 'Generating…',
  rrUseSuggested: 'Apply suggestion',
  rrAccuracyAdjust: (pct) => `Accuracy adjustment: ${pct >= 0 ? '+' : ''}${pct}%`,
  rrFieldAmount: 'Quote (KRW)',
  rrFieldDays: 'Lead time (business days)',
  rrFieldNote: 'Note',
  rrFieldNotePlaceholder: 'Additional notes (optional)',
  rrSubmitBtn: 'Submit quote',
  rrSubmitting: 'Submitting…',
  rrErrorAmount: 'Please enter a quote amount.',
  rrSuccess: 'Quote submitted.',

  qaTitle: 'Quote accuracy',
  qaSubtitle: 'Price insights from past wins/losses',
  qaLoading: 'Analysing…',
  qaEmpty: 'Not enough data yet.',
  qaInsightDeviation: 'Deviation vs market average',
  qaInsightWinThreshold: 'Win-threshold price',
  qaInsightSuggestion: 'Suggested price',
  qaConfidence: (pct) => `${pct}% confidence`,
  qaApplyBtn: 'Apply to response form',
};

const JA: QuotePanelsDict = {
  ...EN,
  notifTooltip: '通知',
  notifTitle: '通知',
  notifMarkAllRead: 'すべて既読',
  notifEmpty: '新しい通知はありません',
  notifRelJustNow: 'たった今',
  notifRelMinutes: (n) => `${n}分前`,
  notifRelHours: (n) => `${n}時間前`,
  notifRelDays: (n) => `${n}日前`,
  opTitle: '注文の優先順位',
  opSubtitle: '緊急度の高い注文から対応してください。',
  opLoading: '読み込み中…',
  opEmpty: '優先順位の高い注文はありません。',
  opSeverityHigh: '高',
  opSeverityMid: '中',
  opSeverityLow: '低',
  opQuoteFirst: '先に見積もり',
  opSummary: '概要',
  opHeader: '🏆 受注優先順位 AI',
  opSubtitleCount: (n) => `${n}件 検討待ち → 収益性・納期・工程適合度分析`,
  opFieldHourlyRate: '時給単価 (KRW/hr)',
  opFieldMargin: '材料マージン (0-1)',
  opFieldBacklog: '現在のバックログ (日)',
  opFieldCapacity: '稼働可能日数',
  opErrorPro: 'Pro プランが必要です。',
  opErrorGeneric: '分析に失敗しました',
  opTopPick: '🏆 AI おすすめ',
  opTagPriority: '優先',
  opTagGoodFit: '適合',
  opTagConsider: '検討',
  opTagPass: '見送り',
  opMarginEst: '想定マージン',
  opMarginShort: (pct) => `マージン ~${pct}%`,
  opReasons: '✅ 受注理由',
  opRisks: '⚠️ リスク',
  opSubmitThis: '→ この見積で提出',
  opRunBtn: '🏆 AI 優先順位分析',
  opAnalyzing: '分析中…',
  opRetry: '🔄 再分析',
  opClose: '閉じる',
  aihTitle: 'AI 利用履歴',
  aihSubtitle: 'AI 機能の実行結果',
  aihLoading: '読み込み中…',
  aihEmpty: '保存された AI 履歴はありません。',
  aihAdoptedSuffix: '採用',
  aihColTime: '時刻',
  aihColModel: 'モデル',
  aihColInput: '入力',
  aihColOutput: '出力',
  aihColStatus: 'ステータス',
  aihFilterAll: 'すべて',
  aihFilterRfqResponder: 'RFQ 回答',
  aihFilterOrderPriority: 'AI 優先順位',
  aihFilterCapacityMatch: 'キャパマッチ',
  aihFilterQuoteAccuracy: '見積精度',
  aihLoadFail: '読み込み失敗',
  aihConfirmDelete: 'この履歴を削除しますか?',
  aihDeleteFail: '削除に失敗しました。',
  aihDeleteBtn: '🗑 削除',
  aihRelSeconds: (n) => `${n}秒前`,
  poTitle: '進行中の注文',
  poSubtitle: '確定済み注文の進行状況',
  poLoading: '読み込み中…',
  poEmpty: '担当注文はありません。',
  poStatus_pending: '待機',
  poStatus_in_progress: '進行中',
  poStatus_shipped: '配送中',
  poStatus_delivered: '納品完了',
  poDueLabel: '納期',
  poQtyUnit: '個',
  poHeader: '📦 注文管理',
  poCount: (n) => `(${n}件)`,
  poFilterAll: 'すべて',
  poStatus_placed: '注文受付',
  poStatus_production: '生産中',
  poStatus_qc: '品質検査',
  poErrorLoad: '注文一覧の取得に失敗しました。',
  poErrorGeneric: '❌ エラーが発生しました。',
  poUpdateSuccess: (name, status) => `✅ ${name} を「${status}」に更新しました。`,
  poUpdateFail: '更新失敗',
  poBadgePaid: '決済完了',
  poEmptyFiltered: '該当ステータスの注文はありません。',
  poOrderQty: (n) => `数量 ${n}個`,
  poOrderedOn: (date) => `注文日 ${date}`,
  poDueOn: (date) => `納期予定 ${date}`,
  poBtnProcessing: '処理中…',
  poBtnDeliveredDone: '✓ 納品完了',
  poBtnPdf: '📄 PDF',
  poBtnTaxInvoice: '🧾 税金計算書',
  poNext_placed: '生産開始',
  poNext_production: 'QC 開始',
  poNext_qc: '配送開始',
  poNext_shipped: '納品完了',
  psTitle: '実績',
  psSubtitle: '最近の見積もり活動サマリー',
  psLoading: '読み込み中…',
  psMetricTotalQuotes: '見積件数',
  psMetricWinRate: '受注率',
  psMetricAvgResponse: '平均応答',
  psMetricAvgAmount: '平均見積額',
  psWindowLabel: (d) => `直近 ${d}日`,
  apTitle: 'AI 設定',
  apSubtitle: 'AI 見積ドラフトのデフォルト値を設定します。',
  apStrategyLabel: '戦略',
  apStrategyCompetitive: '競争 (低価格優先)',
  apStrategyBalanced: 'バランス型',
  apStrategyPremium: 'プレミアム (マージン優先)',
  apToneLabel: 'トーン',
  apToneFormal: 'フォーマル',
  apToneFriendly: 'フレンドリー',
  apToneTechnical: '技術的',
  apMarginLabel: '目標マージン率 (%)',
  apLeadTimeLabel: '標準納期 (日)',
  apSave: '保存',
  apSaving: '保存中…',
  apSaved: '保存済み',
  rrTitle: 'AI 見積応答',
  rrSubtitle: 'AI がドラフトを作成し、迅速な応答を支援します。',
  rrLoading: '読み込み中…',
  rrEmpty: '応答する RFQ を選択してください。',
  rrAutoDraftBtn: '⚡ AI ドラフト生成',
  rrAutoDrafting: '生成中…',
  rrUseSuggested: '提案を適用',
  rrAccuracyAdjust: (pct) => `精度補正: ${pct >= 0 ? '+' : ''}${pct}%`,
  rrFieldAmount: '見積金額 (KRW)',
  rrFieldDays: '納期 (営業日)',
  rrFieldNote: 'メモ',
  rrFieldNotePlaceholder: '追加事項 (任意)',
  rrSubmitBtn: '見積登録',
  rrSubmitting: '登録中…',
  rrErrorAmount: '見積金額を入力してください。',
  rrSuccess: '見積もりが登録されました。',
  qaTitle: '見積精度',
  qaSubtitle: '過去の受注/失敗データに基づく価格インサイト',
  qaLoading: '分析中…',
  qaEmpty: '分析データが不足しています。',
  qaInsightDeviation: '市場平均との乖離',
  qaInsightWinThreshold: '受注可能閾値',
  qaInsightSuggestion: '推奨価格',
  qaConfidence: (pct) => `信頼度 ${pct}%`,
  qaApplyBtn: '応答フォームに適用',
};

const CN: QuotePanelsDict = {
  ...EN,
  notifTooltip: '通知',
  notifTitle: '通知',
  notifMarkAllRead: '全部已读',
  notifEmpty: '没有新通知',
  notifRelJustNow: '刚刚',
  notifRelMinutes: (n) => `${n} 分钟前`,
  notifRelHours: (n) => `${n} 小时前`,
  notifRelDays: (n) => `${n} 天前`,
  opTitle: '订单优先级',
  opSubtitle: '请优先处理紧急订单。',
  opLoading: '加载中…',
  opEmpty: '当前没有高优先级订单。',
  opSeverityHigh: '高',
  opSeverityMid: '中',
  opSeverityLow: '低',
  opQuoteFirst: '优先报价',
  opSummary: '摘要',
  opHeader: '🏆 中标优先级 AI',
  opSubtitleCount: (n) => `${n} 项待审 — 利润 · 交期 · 工艺契合分析`,
  opFieldHourlyRate: '时薪 (KRW/小时)',
  opFieldMargin: '材料毛利 (0-1)',
  opFieldBacklog: '当前积压 (天)',
  opFieldCapacity: '可用产能 (天)',
  opErrorPro: '需要 Pro 套餐。',
  opErrorGeneric: '分析失败',
  opTopPick: '🏆 AI 推荐',
  opTagPriority: '优先',
  opTagGoodFit: '匹配',
  opTagConsider: '考虑',
  opTagPass: '搁置',
  opMarginEst: '预估毛利',
  opMarginShort: (pct) => `毛利 ~${pct}%`,
  opReasons: '✅ 中标理由',
  opRisks: '⚠️ 风险',
  opSubmitThis: '→ 提交此报价',
  opRunBtn: '🏆 运行 AI 优先级',
  opAnalyzing: '分析中…',
  opRetry: '🔄 重新分析',
  opClose: '关闭',
  aihTitle: 'AI 使用记录',
  aihSubtitle: '合作伙伴 AI 功能运行结果',
  aihLoading: '加载中…',
  aihEmpty: '暂无 AI 历史记录。',
  aihAdoptedSuffix: '已采用',
  aihColTime: '时间',
  aihColModel: '模型',
  aihColInput: '输入',
  aihColOutput: '输出',
  aihColStatus: '状态',
  aihFilterAll: '全部',
  aihFilterRfqResponder: 'RFQ 回复',
  aihFilterOrderPriority: 'AI 优先级',
  aihFilterCapacityMatch: '产能匹配',
  aihFilterQuoteAccuracy: '报价精度',
  aihLoadFail: '加载失败',
  aihConfirmDelete: '删除此记录?',
  aihDeleteFail: '删除失败。',
  aihDeleteBtn: '🗑 删除',
  aihRelSeconds: (n) => `${n} 秒前`,
  poTitle: '进行中订单',
  poSubtitle: '已确认订单的进展',
  poLoading: '加载中…',
  poEmpty: '没有负责订单。',
  poStatus_pending: '待处理',
  poStatus_in_progress: '进行中',
  poStatus_shipped: '运输中',
  poStatus_delivered: '已交付',
  poDueLabel: '交期',
  poQtyUnit: ' 件',
  poHeader: '📦 订单管理',
  poCount: (n) => `(${n}件)`,
  poFilterAll: '全部',
  poStatus_placed: '订单已收',
  poStatus_production: '生产中',
  poStatus_qc: '质量检查',
  poErrorLoad: '加载订单列表失败。',
  poErrorGeneric: '❌ 发生错误。',
  poUpdateSuccess: (name, status) => `✅ 已将 ${name} 更新为"${status}"。`,
  poUpdateFail: '更新失败',
  poBadgePaid: '已支付',
  poEmptyFiltered: '该状态下没有订单。',
  poOrderQty: (n) => `数量 ${n} 件`,
  poOrderedOn: (date) => `下单日 ${date}`,
  poDueOn: (date) => `预计交期 ${date}`,
  poBtnProcessing: '处理中…',
  poBtnDeliveredDone: '✓ 已交付',
  poBtnPdf: '📄 PDF',
  poBtnTaxInvoice: '🧾 税务发票',
  poNext_placed: '开始生产',
  poNext_production: '开始 QC',
  poNext_qc: '开始运输',
  poNext_shipped: '标记交付',
  psTitle: '我的业绩',
  psSubtitle: '近期报价活动摘要',
  psLoading: '加载中…',
  psMetricTotalQuotes: '报价总数',
  psMetricWinRate: '中标率',
  psMetricAvgResponse: '平均响应',
  psMetricAvgAmount: '平均报价',
  psWindowLabel: (d) => `近 ${d} 天`,
  apTitle: 'AI 设置',
  apSubtitle: 'AI 报价草稿的默认设置。',
  apStrategyLabel: '策略',
  apStrategyCompetitive: '竞争 (低价优先)',
  apStrategyBalanced: '平衡',
  apStrategyPremium: '高端 (毛利优先)',
  apToneLabel: '语气',
  apToneFormal: '正式',
  apToneFriendly: '友好',
  apToneTechnical: '技术性',
  apMarginLabel: '目标毛利率 (%)',
  apLeadTimeLabel: '默认交期 (天)',
  apSave: '保存',
  apSaving: '保存中…',
  apSaved: '已保存',
  rrTitle: 'AI 报价响应',
  rrSubtitle: 'AI 起草报价，加快响应速度。',
  rrLoading: '加载中…',
  rrEmpty: '请选择要响应的 RFQ。',
  rrAutoDraftBtn: '⚡ 生成 AI 草稿',
  rrAutoDrafting: '生成中…',
  rrUseSuggested: '应用建议',
  rrAccuracyAdjust: (pct) => `精度调整: ${pct >= 0 ? '+' : ''}${pct}%`,
  rrFieldAmount: '报价金额 (KRW)',
  rrFieldDays: '交期 (工作日)',
  rrFieldNote: '备注',
  rrFieldNotePlaceholder: '附加备注 (可选)',
  rrSubmitBtn: '提交报价',
  rrSubmitting: '提交中…',
  rrErrorAmount: '请输入报价金额。',
  rrSuccess: '报价已提交。',
  qaTitle: '报价精准度',
  qaSubtitle: '基于历史中标/失败的价格洞察',
  qaLoading: '分析中…',
  qaEmpty: '数据不足。',
  qaInsightDeviation: '与市场均价偏差',
  qaInsightWinThreshold: '可中标阈值价',
  qaInsightSuggestion: '建议价格',
  qaConfidence: (pct) => `置信度 ${pct}%`,
  qaApplyBtn: '应用到响应表单',
};

const ES: QuotePanelsDict = {
  ...EN,
  notifTooltip: 'Notificaciones',
  notifTitle: 'Notificaciones',
  notifMarkAllRead: 'Marcar todo leído',
  notifEmpty: 'Sin notificaciones nuevas',
  notifRelJustNow: 'ahora',
  notifRelMinutes: (n) => `hace ${n}m`,
  notifRelHours: (n) => `hace ${n}h`,
  notifRelDays: (n) => `hace ${n}d`,
  opTitle: 'Prioridad de pedidos',
  opSubtitle: 'Atiende primero los pedidos urgentes.',
  opEmpty: 'No hay pedidos urgentes ahora.',
  opSeverityHigh: 'Alta',
  opSeverityMid: 'Media',
  opSeverityLow: 'Baja',
  opQuoteFirst: 'Cotizar primero',
  opSummary: 'Resumen',
  opHeader: '🏆 IA de prioridad',
  opSubtitleCount: (n) => `${n} en revisión — margen · plazo · proceso`,
  opFieldHourlyRate: 'Tarifa por hora (KRW/hr)',
  opFieldMargin: 'Margen material (0-1)',
  opFieldBacklog: 'Pendiente actual (días)',
  opFieldCapacity: 'Capacidad disponible (días)',
  opErrorPro: 'Se requiere plan Pro.',
  opErrorGeneric: 'Falló el análisis',
  opTopPick: '🏆 Recomendación IA',
  opTagPriority: 'PRIORIDAD',
  opTagGoodFit: 'BUEN AJUSTE',
  opTagConsider: 'CONSIDERAR',
  opTagPass: 'OMITIR',
  opMarginEst: 'Margen estimado',
  opMarginShort: (pct) => `margen ~${pct}%`,
  opReasons: '✅ Por qué ganar',
  opRisks: '⚠️ Riesgos',
  opSubmitThis: '→ Enviar esta cotización',
  opRunBtn: '🏆 Ejecutar IA',
  opAnalyzing: 'Analizando…',
  opRetry: '🔄 Re-analizar',
  opClose: 'Cerrar',
  aihTitle: 'Historial de IA',
  aihSubtitle: 'Ejecuciones recientes de funciones IA',
  aihEmpty: 'Sin historial de IA guardado.',
  aihAdoptedSuffix: 'adoptado',
  aihColTime: 'Hora',
  aihColModel: 'Modelo',
  aihColInput: 'Entrada',
  aihColOutput: 'Salida',
  aihColStatus: 'Estado',
  aihFilterAll: 'Todos',
  aihFilterRfqResponder: 'Respuesta RFQ',
  aihFilterOrderPriority: 'Prioridad IA',
  aihFilterCapacityMatch: 'Match capacidad',
  aihFilterQuoteAccuracy: 'Precisión cotiz.',
  aihLoadFail: 'Error al cargar',
  aihConfirmDelete: '¿Eliminar esta entrada?',
  aihDeleteFail: 'Error al eliminar.',
  aihDeleteBtn: '🗑 Eliminar',
  aihRelSeconds: (n) => `hace ${n}s`,
  poTitle: 'Pedidos activos',
  poSubtitle: 'Pedidos confirmados en curso',
  poEmpty: 'No tienes pedidos asignados.',
  poStatus_pending: 'Pendiente',
  poStatus_in_progress: 'En curso',
  poStatus_shipped: 'En envío',
  poStatus_delivered: 'Entregado',
  poDueLabel: 'Entrega',
  poQtyUnit: ' uds',
  poHeader: '📦 Gestión de pedidos',
  poCount: (n) => `(${n})`,
  poFilterAll: 'Todos',
  poStatus_placed: 'Recibido',
  poStatus_production: 'En producción',
  poStatus_qc: 'Control de calidad',
  poErrorLoad: 'No se pudo cargar la lista.',
  poErrorGeneric: '❌ Ocurrió un error.',
  poUpdateSuccess: (name, status) => `✅ ${name} pasó a "${status}".`,
  poUpdateFail: 'Error al actualizar',
  poBadgePaid: 'Pagado',
  poEmptyFiltered: 'Sin pedidos en este estado.',
  poOrderQty: (n) => `Cant. ${n}`,
  poOrderedOn: (date) => `Pedido ${date}`,
  poDueOn: (date) => `Entrega ${date}`,
  poBtnProcessing: 'Procesando…',
  poBtnDeliveredDone: '✓ Entregado',
  poBtnPdf: '📄 PDF',
  poBtnTaxInvoice: '🧾 Factura fiscal',
  poNext_placed: 'Iniciar producción',
  poNext_production: 'Iniciar QC',
  poNext_qc: 'Iniciar envío',
  poNext_shipped: 'Marcar entregado',
  psTitle: 'Mi desempeño',
  psSubtitle: 'Resumen reciente de cotizaciones',
  psMetricTotalQuotes: 'Total cotizaciones',
  psMetricWinRate: 'Tasa de éxito',
  psMetricAvgResponse: 'Respuesta media',
  psMetricAvgAmount: 'Importe medio',
  psWindowLabel: (d) => `últimos ${d}d`,
  apTitle: 'Preferencias de IA',
  apSubtitle: 'Valores por defecto para borradores de IA.',
  apStrategyLabel: 'Estrategia',
  apStrategyCompetitive: 'Competitiva (precio bajo)',
  apStrategyBalanced: 'Equilibrada',
  apStrategyPremium: 'Premium (margen alto)',
  apToneLabel: 'Tono',
  apToneFormal: 'Formal',
  apToneFriendly: 'Cercano',
  apToneTechnical: 'Técnico',
  apMarginLabel: 'Margen objetivo (%)',
  apLeadTimeLabel: 'Plazo por defecto (días)',
  apSave: 'Guardar',
  apSaving: 'Guardando…',
  apSaved: 'Guardado',
  rrTitle: 'Respuesta con IA',
  rrSubtitle: 'La IA prepara un borrador para responder rápido.',
  rrEmpty: 'Selecciona un RFQ para responder.',
  rrAutoDraftBtn: '⚡ Generar borrador IA',
  rrAutoDrafting: 'Generando…',
  rrUseSuggested: 'Aplicar sugerencia',
  rrAccuracyAdjust: (pct) => `Ajuste de precisión: ${pct >= 0 ? '+' : ''}${pct}%`,
  rrFieldAmount: 'Cotización (KRW)',
  rrFieldDays: 'Plazo (días hábiles)',
  rrFieldNote: 'Nota',
  rrFieldNotePlaceholder: 'Notas adicionales (opcional)',
  rrSubmitBtn: 'Enviar cotización',
  rrSubmitting: 'Enviando…',
  rrErrorAmount: 'Introduce el importe.',
  rrSuccess: 'Cotización enviada.',
  qaTitle: 'Precisión de cotizaciones',
  qaSubtitle: 'Insights de precios de ganados/perdidos',
  qaLoading: 'Analizando…',
  qaEmpty: 'Datos insuficientes.',
  qaInsightDeviation: 'Desviación vs media de mercado',
  qaInsightWinThreshold: 'Precio umbral de éxito',
  qaInsightSuggestion: 'Precio sugerido',
  qaConfidence: (pct) => `${pct}% de confianza`,
  qaApplyBtn: 'Aplicar al formulario',
};

const AR: QuotePanelsDict = {
  ...EN,
  notifTooltip: 'الإشعارات',
  notifTitle: 'الإشعارات',
  notifMarkAllRead: 'تعليم الكل كمقروء',
  notifEmpty: 'لا توجد إشعارات جديدة',
  notifRelJustNow: 'الآن',
  notifRelMinutes: (n) => `قبل ${n} د`,
  notifRelHours: (n) => `قبل ${n} س`,
  notifRelDays: (n) => `قبل ${n} ي`,
  opTitle: 'أولوية الطلبات',
  opSubtitle: 'تعامل مع الطلبات العاجلة أولًا.',
  opEmpty: 'لا توجد طلبات عاجلة حاليًا.',
  opSeverityHigh: 'مرتفع',
  opSeverityMid: 'متوسط',
  opSeverityLow: 'منخفض',
  opQuoteFirst: 'سعّر أولًا',
  opSummary: 'ملخص',
  opHeader: '🏆 ذكاء الأولوية',
  opSubtitleCount: (n) => `${n} قيد المراجعة — هامش · موعد · ملاءمة العملية`,
  opFieldHourlyRate: 'الأجر بالساعة (KRW/hr)',
  opFieldMargin: 'هامش المواد (0-1)',
  opFieldBacklog: 'الأعمال المتراكمة (أيام)',
  opFieldCapacity: 'الطاقة المتاحة (أيام)',
  opErrorPro: 'مطلوب اشتراك Pro.',
  opErrorGeneric: 'فشل التحليل',
  opTopPick: '🏆 توصية الذكاء الاصطناعي',
  opTagPriority: 'أولوية',
  opTagGoodFit: 'مناسب',
  opTagConsider: 'للنظر',
  opTagPass: 'تجاهل',
  opMarginEst: 'الهامش المتوقع',
  opMarginShort: (pct) => `هامش ~${pct}%`,
  opReasons: '✅ أسباب الفوز',
  opRisks: '⚠️ المخاطر',
  opSubmitThis: '→ تقديم هذا العرض',
  opRunBtn: '🏆 تشغيل الذكاء الاصطناعي',
  opAnalyzing: 'جارٍ التحليل…',
  opRetry: '🔄 إعادة التحليل',
  opClose: 'إغلاق',
  aihTitle: 'سجل الذكاء الاصطناعي',
  aihSubtitle: 'تنفيذات حديثة لميزات الذكاء الاصطناعي',
  aihEmpty: 'لا يوجد سجل ذكاء اصطناعي محفوظ.',
  aihAdoptedSuffix: 'مُعتمد',
  aihColTime: 'الوقت',
  aihColModel: 'النموذج',
  aihColInput: 'الإدخال',
  aihColOutput: 'الإخراج',
  aihColStatus: 'الحالة',
  aihFilterAll: 'الكل',
  aihFilterRfqResponder: 'رد RFQ',
  aihFilterOrderPriority: 'أولوية الذكاء',
  aihFilterCapacityMatch: 'مطابقة الطاقة',
  aihFilterQuoteAccuracy: 'دقة العرض',
  aihLoadFail: 'فشل التحميل',
  aihConfirmDelete: 'حذف هذا السجل؟',
  aihDeleteFail: 'فشل الحذف.',
  aihDeleteBtn: '🗑 حذف',
  aihRelSeconds: (n) => `قبل ${n} ث`,
  poTitle: 'الطلبات النشطة',
  poSubtitle: 'الطلبات المؤكدة قيد التنفيذ',
  poEmpty: 'لا توجد طلبات مُسندة.',
  poStatus_pending: 'بانتظار',
  poStatus_in_progress: 'قيد التنفيذ',
  poStatus_shipped: 'قيد الشحن',
  poStatus_delivered: 'تم التسليم',
  poDueLabel: 'الموعد',
  poQtyUnit: ' قطعة',
  poHeader: '📦 إدارة الطلبات',
  poCount: (n) => `(${n})`,
  poFilterAll: 'الكل',
  poStatus_placed: 'تم الاستلام',
  poStatus_production: 'قيد التصنيع',
  poStatus_qc: 'فحص الجودة',
  poErrorLoad: 'تعذّر تحميل قائمة الطلبات.',
  poErrorGeneric: '❌ حدث خطأ.',
  poUpdateSuccess: (name, status) => `✅ تم تحديث ${name} إلى "${status}".`,
  poUpdateFail: 'فشل التحديث',
  poBadgePaid: 'مدفوع',
  poEmptyFiltered: 'لا توجد طلبات في هذه الحالة.',
  poOrderQty: (n) => `الكمية ${n}`,
  poOrderedOn: (date) => `تاريخ الطلب ${date}`,
  poDueOn: (date) => `موعد التسليم ${date}`,
  poBtnProcessing: 'جارٍ المعالجة…',
  poBtnDeliveredDone: '✓ تم التسليم',
  poBtnPdf: '📄 PDF',
  poBtnTaxInvoice: '🧾 فاتورة ضريبية',
  poNext_placed: 'بدء التصنيع',
  poNext_production: 'بدء الفحص',
  poNext_qc: 'بدء الشحن',
  poNext_shipped: 'تأكيد التسليم',
  psTitle: 'أدائي',
  psSubtitle: 'ملخص نشاط التسعير',
  psMetricTotalQuotes: 'إجمالي العروض',
  psMetricWinRate: 'معدل الفوز',
  psMetricAvgResponse: 'متوسط الاستجابة',
  psMetricAvgAmount: 'متوسط العرض',
  psWindowLabel: (d) => `آخر ${d} يومًا`,
  apTitle: 'تفضيلات الذكاء الاصطناعي',
  apSubtitle: 'القيم الافتراضية لمسودات الذكاء الاصطناعي.',
  apStrategyLabel: 'الاستراتيجية',
  apStrategyCompetitive: 'تنافسية (أقل سعر)',
  apStrategyBalanced: 'متوازنة',
  apStrategyPremium: 'مميزة (هامش ربح)',
  apToneLabel: 'النبرة',
  apToneFormal: 'رسمية',
  apToneFriendly: 'ودية',
  apToneTechnical: 'تقنية',
  apMarginLabel: 'هامش الربح المستهدف (%)',
  apLeadTimeLabel: 'مدة التسليم الافتراضية (أيام)',
  apSave: 'حفظ',
  apSaving: 'جارٍ الحفظ…',
  apSaved: 'تم الحفظ',
  rrTitle: 'الرد بالذكاء الاصطناعي',
  rrSubtitle: 'يُعدّ الذكاء الاصطناعي مسودة لتسريع الرد.',
  rrEmpty: 'اختر طلب RFQ للرد عليه.',
  rrAutoDraftBtn: '⚡ توليد مسودة بالذكاء الاصطناعي',
  rrAutoDrafting: 'جارٍ التوليد…',
  rrUseSuggested: 'تطبيق الاقتراح',
  rrAccuracyAdjust: (pct) => `ضبط الدقة: ${pct >= 0 ? '+' : ''}${pct}%`,
  rrFieldAmount: 'العرض (KRW)',
  rrFieldDays: 'مدة التسليم (أيام عمل)',
  rrFieldNote: 'ملاحظة',
  rrFieldNotePlaceholder: 'ملاحظات إضافية (اختياري)',
  rrSubmitBtn: 'إرسال العرض',
  rrSubmitting: 'جارٍ الإرسال…',
  rrErrorAmount: 'أدخل قيمة العرض.',
  rrSuccess: 'تم إرسال العرض.',
  qaTitle: 'دقة العروض',
  qaSubtitle: 'رؤى الأسعار من الفوز/الخسارة',
  qaLoading: 'جارٍ التحليل…',
  qaEmpty: 'لا توجد بيانات كافية.',
  qaInsightDeviation: 'الانحراف عن متوسط السوق',
  qaInsightWinThreshold: 'سعر عتبة الفوز',
  qaInsightSuggestion: 'السعر المقترح',
  qaConfidence: (pct) => `الثقة ${pct}%`,
  qaApplyBtn: 'تطبيق في نموذج الرد',
};

export function quotePanelsDict(lang: PartnerLang): QuotePanelsDict {
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
