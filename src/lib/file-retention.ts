// ─── File Retention Policy ──────────────────────────────────────────────────
// NexyFab STEP/CAD 파일 보관 정책
// 이 상수는 cron job과 UI 고지 텍스트 모두에서 참조됩니다.

/** Retention periods in days, by file status */
export const RETENTION_DAYS = {
  /** quick-quote 업로드 후 RFQ/계약 미연결 */
  quickQuote: 30,
  /** RFQ 생성했지만 계약 미체결 */
  rfqOnly: 90,
  /** 계약 완료(delivered/completed) 후 */
  contractCompleted: 180,
  /** 진행 중인 계약 — 삭제 안 함 */
  contractActive: Infinity,
} as const;

/** User-facing retention policy text (ko/en) */
export const RETENTION_NOTICE = {
  ko: {
    title: '파일 보관 정책',
    items: [
      `견적 요청 없이 업로드된 파일: ${RETENTION_DAYS.quickQuote}일 후 자동 삭제`,
      `견적 요청(RFQ)만 있고 계약 미체결: ${RETENTION_DAYS.rfqOnly}일 후 자동 삭제`,
      `계약 완료 후: ${RETENTION_DAYS.contractCompleted}일간 보관 후 삭제`,
      '진행 중인 계약에 연결된 파일: 계약 기간 동안 보관',
    ],
    footer: '중요한 파일은 삭제 전 반드시 로컬에 백업해 주세요.',
  },
  en: {
    title: 'File Retention Policy',
    items: [
      `Files uploaded without a quote request: auto-deleted after ${RETENTION_DAYS.quickQuote} days`,
      `Files with RFQ but no contract: auto-deleted after ${RETENTION_DAYS.rfqOnly} days`,
      `Files from completed contracts: retained for ${RETENTION_DAYS.contractCompleted} days after completion`,
      'Files linked to active contracts: retained for the duration of the contract',
    ],
    footer: 'Please back up important files locally before the retention period expires.',
  },
} as const;
