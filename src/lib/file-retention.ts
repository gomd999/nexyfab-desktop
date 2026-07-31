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
  ja: {
    title: 'ファイル保管ポリシー',
    items: [
      `見積依頼なしでアップロードされたファイル: ${RETENTION_DAYS.quickQuote}日後に自動削除`,
      `見積依頼(RFQ)のみで契約未締結: ${RETENTION_DAYS.rfqOnly}日後に自動削除`,
      `契約完了後: ${RETENTION_DAYS.contractCompleted}日間保管後に削除`,
      '進行中の契約に紐づくファイル: 契約期間中は保管',
    ],
    footer: '重要なファイルは削除前に必ずローカルにバックアップしてください。',
  },
  zh: {
    title: '文件保留政策',
    items: [
      `未提交报价请求即上传的文件：${RETENTION_DAYS.quickQuote} 天后自动删除`,
      `仅有报价请求(RFQ)且未签约：${RETENTION_DAYS.rfqOnly} 天后自动删除`,
      `签约完成后：保留 ${RETENTION_DAYS.contractCompleted} 天后删除`,
      '与进行中合同关联的文件：在合同期内保留',
    ],
    footer: '重要文件请务必在删除前备份到本地。',
  },
  es: {
    title: 'Política de conservación de archivos',
    items: [
      `Archivos subidos sin solicitud de presupuesto: se eliminan automáticamente a los ${RETENTION_DAYS.quickQuote} días`,
      `Archivos con RFQ pero sin contrato: se eliminan automáticamente a los ${RETENTION_DAYS.rfqOnly} días`,
      `Archivos de contratos completados: se conservan ${RETENTION_DAYS.contractCompleted} días tras la finalización`,
      'Archivos vinculados a contratos activos: se conservan mientras dure el contrato',
    ],
    footer: 'Haga una copia local de los archivos importantes antes de que expire el plazo de conservación.',
  },
  ar: {
    title: 'سياسة الاحتفاظ بالملفات',
    items: [
      `الملفات المرفوعة دون طلب عرض سعر: تُحذف تلقائياً بعد ${RETENTION_DAYS.quickQuote} يوماً`,
      `الملفات التي لها طلب عرض سعر (RFQ) دون تعاقد: تُحذف تلقائياً بعد ${RETENTION_DAYS.rfqOnly} يوماً`,
      `ملفات العقود المكتملة: تُحفظ ${RETENTION_DAYS.contractCompleted} يوماً بعد الإتمام ثم تُحذف`,
      'الملفات المرتبطة بعقود جارية: تُحفظ طوال مدة العقد.',
    ],
    footer: 'يُرجى الاحتفاظ بنسخة محلية من الملفات المهمة قبل انتهاء مدة الحفظ.',
  },
} as const;
