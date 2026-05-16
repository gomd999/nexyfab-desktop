// RMA / defects triage page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface RmaDict {
  pageTitle: string;
  pageSubtitle: string;
  chipActionable: (n: number) => string;
  chipInProgress: (n: number) => string;
  chipClosed: (n: number) => string;
  loading: string;
  emptyTitle: string;
  emptyHint: string;
  sectionActionable: string;
  sectionInProgress: string;
  sectionClosed: string;
  sectionActionableEmpty: string;
  sectionInProgressEmpty: string;
  sectionClosedEmpty: string;
  sectionCountSuffix: string;
  drawerOrderPrefix: string;
  drawerReceivedSuffix: string;
  drawerBuyerContent: string;
  drawerBuyerSubmitter: (email: string) => string;
  drawerAttachments: (n: number) => string;
  drawerRmaNumberLabel: string;
  drawerPartnerComment: string;
  drawerBuyerNote: string;
  drawerActionTitle: string;
  drawerBtnStartReview: string;
  drawerLabelRmaInstructions: string;
  drawerPlaceholderRmaInstructions: string;
  drawerBtnApprove: string;
  drawerLabelRejectReason: string;
  drawerPlaceholderRejectReason: string;
  drawerBtnReject: string;
  drawerFooterApproved: string;
  drawerFooterClosed: string;
  errNeedRmaInstructions: string;
  errNeedRejectReason: string;
  errProcess: string;
  closeLabel: string;

  status_reported: string;
  status_under_review: string;
  status_approved: string;
  status_rejected: string;
  status_resolved: string;
  status_disputed: string;

  severity_minor: string;
  severity_major: string;
  severity_critical: string;

  kind_wrong_part: string;
  kind_damaged: string;
  kind_out_of_spec: string;
  kind_missing_quantity: string;
  kind_late_delivery: string;
  kind_other: string;

  timelineRelJustNow: string;
  timelineRelMinutes: (n: number) => string;
  timelineRelHours: (n: number) => string;
  timelineRelDays: (n: number) => string;
}

const KO: RmaDict = {
  pageTitle: '⚠ 불량·RMA 트리아지',
  pageSubtitle: '구매자가 제기한 불량·교환 요청을 확인하고 처리합니다. 해결 완료된 건은 해결률 지표에 반영됩니다.',
  chipActionable: (n) => `처리 필요 ${n}`,
  chipInProgress: (n) => `진행 중 ${n}`,
  chipClosed: (n) => `종료 ${n}`,
  loading: '불러오는 중…',
  emptyTitle: '접수된 불량이 없습니다',
  emptyHint: '깔끔한 품질 유지 중 — 좋은 흐름 이어가세요.',
  sectionActionable: '처리 필요',
  sectionInProgress: '진행 중',
  sectionClosed: '종료',
  sectionActionableEmpty: '대기 중인 이슈 없음',
  sectionInProgressEmpty: 'RMA 발급 후 배송·처리 대기 중인 건 없음',
  sectionClosedEmpty: '과거 처리 기록 없음',
  sectionCountSuffix: '건',
  drawerOrderPrefix: '주문',
  drawerReceivedSuffix: '접수',
  drawerBuyerContent: '구매자 제출 내용',
  drawerBuyerSubmitter: (email) => `제출: ${email}`,
  drawerAttachments: (n) => `첨부 사진 ${n}장`,
  drawerRmaNumberLabel: 'RMA 번호',
  drawerPartnerComment: '공급사 코멘트',
  drawerBuyerNote: '구매자 마무리 메모',
  drawerActionTitle: '처리 액션',
  drawerBtnStartReview: '🔍 검토 시작 (under_review)',
  drawerLabelRmaInstructions: 'RMA 처리 안내 (인정 시 자동 RMA 번호 발급)',
  drawerPlaceholderRmaInstructions: '예: 착불 반품 후 3영업일 내 교체품 발송. 원송장 기재 필요.',
  drawerBtnApprove: '✅ 불량 인정 + RMA 발급',
  drawerLabelRejectReason: '반려 사유 (공급사 코멘트)',
  drawerPlaceholderRejectReason: '예: 제공된 드로잉상 공차 범위 내 측정값이라 규격 미달로 판단되지 않음.',
  drawerBtnReject: '❌ 반려',
  drawerFooterApproved: '교환·환불 처리를 진행한 뒤, 구매자가 수령을 확인하면 해결 완료로 자동 전이됩니다. 처리 지연 시 고객에게 진행 상황 메시지를 보내주세요.',
  drawerFooterClosed: '이 이슈는 종료되었습니다. 구매자가 이의를 제기하면 disputed 상태로 재개될 수 있습니다.',
  errNeedRmaInstructions: 'RMA 처리 안내를 입력해 주세요.',
  errNeedRejectReason: '반려 사유(공급사 코멘트)를 입력해 주세요.',
  errProcess: '처리에 실패했습니다.',
  closeLabel: '닫기',

  status_reported: '신규 접수',
  status_under_review: '검토 중',
  status_approved: '인정·RMA 발급',
  status_rejected: '반려',
  status_resolved: '해결 완료',
  status_disputed: '이의 제기',

  severity_minor: '경미',
  severity_major: '중대',
  severity_critical: '심각',

  kind_wrong_part: '잘못된 부품',
  kind_damaged: '파손',
  kind_out_of_spec: '규격 미달',
  kind_missing_quantity: '수량 부족',
  kind_late_delivery: '납기 지연',
  kind_other: '기타',

  timelineRelJustNow: '방금',
  timelineRelMinutes: (n) => `${n}분 전`,
  timelineRelHours: (n) => `${n}시간 전`,
  timelineRelDays: (n) => `${n}일 전`,
};

const EN: RmaDict = {
  pageTitle: '⚠ Defects & RMA Triage',
  pageSubtitle: 'Review buyer-reported defects and process exchanges. Resolved cases feed into your defect-resolution metric.',
  chipActionable: (n) => `Actionable ${n}`,
  chipInProgress: (n) => `In progress ${n}`,
  chipClosed: (n) => `Closed ${n}`,
  loading: 'Loading…',
  emptyTitle: 'No defects reported',
  emptyHint: 'Quality looks clean — keep it up.',
  sectionActionable: 'Actionable',
  sectionInProgress: 'In progress',
  sectionClosed: 'Closed',
  sectionActionableEmpty: 'No issues waiting.',
  sectionInProgressEmpty: 'No active RMAs awaiting shipment / processing.',
  sectionClosedEmpty: 'No closed records.',
  sectionCountSuffix: '',
  drawerOrderPrefix: 'Order',
  drawerReceivedSuffix: 'reported',
  drawerBuyerContent: 'Buyer submission',
  drawerBuyerSubmitter: (email) => `Submitted by ${email}`,
  drawerAttachments: (n) => `${n} attached photos`,
  drawerRmaNumberLabel: 'RMA number',
  drawerPartnerComment: 'Partner comment',
  drawerBuyerNote: 'Buyer closing note',
  drawerActionTitle: 'Triage actions',
  drawerBtnStartReview: '🔍 Start review (under_review)',
  drawerLabelRmaInstructions: 'RMA instructions (auto-assigned RMA # on approve)',
  drawerPlaceholderRmaInstructions: 'e.g. Return COD; replacement ships in 3 business days. Include original tracking.',
  drawerBtnApprove: '✅ Approve defect & issue RMA',
  drawerLabelRejectReason: 'Rejection reason (partner comment)',
  drawerPlaceholderRejectReason: 'e.g. Measured value falls within the tolerance band on the supplied drawing.',
  drawerBtnReject: '❌ Reject',
  drawerFooterApproved: 'Once you have processed the exchange/refund and the buyer confirms receipt, the case auto-transitions to "Resolved". Please post progress updates if there is any delay.',
  drawerFooterClosed: 'This case is closed. If the buyer disputes the outcome it may reopen as "disputed".',
  errNeedRmaInstructions: 'Please enter the RMA processing instructions.',
  errNeedRejectReason: 'Please enter a rejection reason.',
  errProcess: 'Could not process the request.',
  closeLabel: 'Close',

  status_reported: 'Reported',
  status_under_review: 'Under review',
  status_approved: 'Approved · RMA issued',
  status_rejected: 'Rejected',
  status_resolved: 'Resolved',
  status_disputed: 'Disputed',

  severity_minor: 'Minor',
  severity_major: 'Major',
  severity_critical: 'Critical',

  kind_wrong_part: 'Wrong part',
  kind_damaged: 'Damaged',
  kind_out_of_spec: 'Out of spec',
  kind_missing_quantity: 'Missing quantity',
  kind_late_delivery: 'Late delivery',
  kind_other: 'Other',

  timelineRelJustNow: 'just now',
  timelineRelMinutes: (n) => `${n}m ago`,
  timelineRelHours: (n) => `${n}h ago`,
  timelineRelDays: (n) => `${n}d ago`,
};

const JA: RmaDict = {
  pageTitle: '⚠ 不良・RMA トリアージ',
  pageSubtitle: '購入者が報告した不良・交換依頼を確認し処理します。解決した案件は解決率指標に反映されます。',
  chipActionable: (n) => `要対応 ${n}`,
  chipInProgress: (n) => `進行中 ${n}`,
  chipClosed: (n) => `終了 ${n}`,
  loading: '読み込み中…',
  emptyTitle: '報告された不良はありません',
  emptyHint: '品質は良好です — このまま維持しましょう。',
  sectionActionable: '要対応',
  sectionInProgress: '進行中',
  sectionClosed: '終了',
  sectionActionableEmpty: '待機中の案件はありません。',
  sectionInProgressEmpty: '対応中の RMA はありません。',
  sectionClosedEmpty: '過去の対応記録はありません。',
  sectionCountSuffix: '件',
  drawerOrderPrefix: '注文',
  drawerReceivedSuffix: '受付',
  drawerBuyerContent: '購入者の申告内容',
  drawerBuyerSubmitter: (email) => `送信元: ${email}`,
  drawerAttachments: (n) => `添付写真 ${n}枚`,
  drawerRmaNumberLabel: 'RMA 番号',
  drawerPartnerComment: 'パートナーコメント',
  drawerBuyerNote: '購入者の最終メモ',
  drawerActionTitle: '対応アクション',
  drawerBtnStartReview: '🔍 検討開始 (under_review)',
  drawerLabelRmaInstructions: 'RMA 対応案内 (承認時に RMA 番号自動発行)',
  drawerPlaceholderRmaInstructions: '例: 着払いで返送後、3 営業日以内に代替品を発送。元伝票番号記載。',
  drawerBtnApprove: '✅ 不良を承認 + RMA 発行',
  drawerLabelRejectReason: '却下理由 (パートナーコメント)',
  drawerPlaceholderRejectReason: '例: 提供図面の公差範囲内のため規格外と判断されない。',
  drawerBtnReject: '❌ 却下',
  drawerFooterApproved: '交換・返金処理後、購入者の受領確認で「解決完了」に自動遷移します。遅延時は進捗をメッセージしてください。',
  drawerFooterClosed: 'この案件は終了しています。購入者が異議を申し立てれば「disputed」状態で再開します。',
  errNeedRmaInstructions: 'RMA 対応案内を入力してください。',
  errNeedRejectReason: '却下理由(パートナーコメント)を入力してください。',
  errProcess: '処理に失敗しました。',
  closeLabel: '閉じる',

  status_reported: '新規受付',
  status_under_review: '検討中',
  status_approved: '承認・RMA 発行',
  status_rejected: '却下',
  status_resolved: '解決完了',
  status_disputed: '異議申立',

  severity_minor: '軽微',
  severity_major: '重大',
  severity_critical: '深刻',

  kind_wrong_part: '誤った部品',
  kind_damaged: '破損',
  kind_out_of_spec: '規格外',
  kind_missing_quantity: '数量不足',
  kind_late_delivery: '納期遅延',
  kind_other: 'その他',

  timelineRelJustNow: 'たった今',
  timelineRelMinutes: (n) => `${n}分前`,
  timelineRelHours: (n) => `${n}時間前`,
  timelineRelDays: (n) => `${n}日前`,
};

const CN: RmaDict = {
  pageTitle: '⚠ 不良 · RMA 处理',
  pageSubtitle: '查看并处理客户提出的不良/退换请求。已解决案件计入解决率指标。',
  chipActionable: (n) => `待处理 ${n}`,
  chipInProgress: (n) => `进行中 ${n}`,
  chipClosed: (n) => `已结案 ${n}`,
  loading: '加载中…',
  emptyTitle: '尚无不良反馈',
  emptyHint: '质量保持良好 — 请继续保持。',
  sectionActionable: '待处理',
  sectionInProgress: '进行中',
  sectionClosed: '已结案',
  sectionActionableEmpty: '没有待处理事项。',
  sectionInProgressEmpty: '没有进行中的 RMA。',
  sectionClosedEmpty: '没有结案记录。',
  sectionCountSuffix: '件',
  drawerOrderPrefix: '订单',
  drawerReceivedSuffix: '提交',
  drawerBuyerContent: '客户提交内容',
  drawerBuyerSubmitter: (email) => `提交人: ${email}`,
  drawerAttachments: (n) => `附件照片 ${n} 张`,
  drawerRmaNumberLabel: 'RMA 编号',
  drawerPartnerComment: '合作伙伴回复',
  drawerBuyerNote: '客户最终备注',
  drawerActionTitle: '处理操作',
  drawerBtnStartReview: '🔍 开始审核 (under_review)',
  drawerLabelRmaInstructions: 'RMA 处理指引 (确认时自动签发 RMA 编号)',
  drawerPlaceholderRmaInstructions: '例如: 货到付款退回，3 个工作日内发出替换品。请附原运单号。',
  drawerBtnApprove: '✅ 确认不良 + 签发 RMA',
  drawerLabelRejectReason: '驳回原因 (合作伙伴备注)',
  drawerPlaceholderRejectReason: '例如: 测量值落在图纸公差范围内，不符合规格异常判定。',
  drawerBtnReject: '❌ 驳回',
  drawerFooterApproved: '完成换货/退款并经客户确认收货后将自动转为「已解决」。如有延误请向客户更新进度。',
  drawerFooterClosed: '该案件已结案。客户若提出异议，可能以 disputed 状态重新开启。',
  errNeedRmaInstructions: '请填写 RMA 处理指引。',
  errNeedRejectReason: '请填写驳回原因。',
  errProcess: '处理失败。',
  closeLabel: '关闭',

  status_reported: '新接收',
  status_under_review: '审核中',
  status_approved: '已确认 · 签发 RMA',
  status_rejected: '已驳回',
  status_resolved: '已解决',
  status_disputed: '已申诉',

  severity_minor: '轻微',
  severity_major: '重大',
  severity_critical: '严重',

  kind_wrong_part: '错件',
  kind_damaged: '损坏',
  kind_out_of_spec: '规格不符',
  kind_missing_quantity: '数量不足',
  kind_late_delivery: '交期延误',
  kind_other: '其他',

  timelineRelJustNow: '刚刚',
  timelineRelMinutes: (n) => `${n} 分钟前`,
  timelineRelHours: (n) => `${n} 小时前`,
  timelineRelDays: (n) => `${n} 天前`,
};

const ES: RmaDict = {
  pageTitle: '⚠ Defectos y triaje de RMA',
  pageSubtitle: 'Revisa los defectos reportados por el comprador y procesa los cambios. Los casos resueltos alimentan tu métrica de resolución.',
  chipActionable: (n) => `Pendientes ${n}`,
  chipInProgress: (n) => `En curso ${n}`,
  chipClosed: (n) => `Cerrados ${n}`,
  loading: 'Cargando…',
  emptyTitle: 'No hay defectos reportados',
  emptyHint: 'La calidad se ve impecable — sigue así.',
  sectionActionable: 'Pendientes',
  sectionInProgress: 'En curso',
  sectionClosed: 'Cerrados',
  sectionActionableEmpty: 'No hay problemas en espera.',
  sectionInProgressEmpty: 'No hay RMAs activos esperando envío.',
  sectionClosedEmpty: 'No hay registros cerrados.',
  sectionCountSuffix: '',
  drawerOrderPrefix: 'Pedido',
  drawerReceivedSuffix: 'recibido',
  drawerBuyerContent: 'Información del comprador',
  drawerBuyerSubmitter: (email) => `Enviado por ${email}`,
  drawerAttachments: (n) => `${n} fotos adjuntas`,
  drawerRmaNumberLabel: 'Número de RMA',
  drawerPartnerComment: 'Comentario del socio',
  drawerBuyerNote: 'Nota final del comprador',
  drawerActionTitle: 'Acciones de triaje',
  drawerBtnStartReview: '🔍 Iniciar revisión (under_review)',
  drawerLabelRmaInstructions: 'Instrucciones RMA (RMA # se asigna al aprobar)',
  drawerPlaceholderRmaInstructions: 'p. ej. Devolución contra reembolso; envío de reemplazo en 3 días hábiles. Incluir número de envío original.',
  drawerBtnApprove: '✅ Aprobar defecto y emitir RMA',
  drawerLabelRejectReason: 'Motivo del rechazo (comentario del socio)',
  drawerPlaceholderRejectReason: 'p. ej. El valor medido está dentro del rango de tolerancia del plano.',
  drawerBtnReject: '❌ Rechazar',
  drawerFooterApproved: 'Cuando proceses el cambio/reembolso y el comprador confirme la recepción, el caso pasará a Resuelto automáticamente. Publica progresos si hay retrasos.',
  drawerFooterClosed: 'Este caso está cerrado. Si el comprador objeta, podría reabrirse como "disputed".',
  errNeedRmaInstructions: 'Introduce las instrucciones del RMA.',
  errNeedRejectReason: 'Introduce el motivo del rechazo.',
  errProcess: 'No se pudo procesar la solicitud.',
  closeLabel: 'Cerrar',

  status_reported: 'Reportado',
  status_under_review: 'En revisión',
  status_approved: 'Aprobado · RMA emitido',
  status_rejected: 'Rechazado',
  status_resolved: 'Resuelto',
  status_disputed: 'Disputado',

  severity_minor: 'Leve',
  severity_major: 'Mayor',
  severity_critical: 'Crítico',

  kind_wrong_part: 'Pieza incorrecta',
  kind_damaged: 'Dañado',
  kind_out_of_spec: 'Fuera de especificación',
  kind_missing_quantity: 'Cantidad faltante',
  kind_late_delivery: 'Entrega tardía',
  kind_other: 'Otro',

  timelineRelJustNow: 'ahora mismo',
  timelineRelMinutes: (n) => `hace ${n}m`,
  timelineRelHours: (n) => `hace ${n}h`,
  timelineRelDays: (n) => `hace ${n}d`,
};

const AR: RmaDict = {
  pageTitle: '⚠ فرز العيوب وإرجاع البضائع (RMA)',
  pageSubtitle: 'راجع العيوب التي أبلغ عنها المشتري وعالجها. تساهم الحالات المُغلقة في مؤشر معدل الحل.',
  chipActionable: (n) => `بانتظار الإجراء ${n}`,
  chipInProgress: (n) => `قيد التنفيذ ${n}`,
  chipClosed: (n) => `مغلقة ${n}`,
  loading: 'جارٍ التحميل…',
  emptyTitle: 'لا توجد عيوب مُبلَّغ عنها',
  emptyHint: 'الجودة ممتازة — استمر على هذا النحو.',
  sectionActionable: 'بانتظار الإجراء',
  sectionInProgress: 'قيد التنفيذ',
  sectionClosed: 'مغلقة',
  sectionActionableEmpty: 'لا توجد قضايا قيد الانتظار.',
  sectionInProgressEmpty: 'لا توجد عمليات RMA نشطة بانتظار الشحن/المعالجة.',
  sectionClosedEmpty: 'لا توجد سجلات مغلقة.',
  sectionCountSuffix: '',
  drawerOrderPrefix: 'الطلب',
  drawerReceivedSuffix: 'تم الاستلام',
  drawerBuyerContent: 'بيان المشتري',
  drawerBuyerSubmitter: (email) => `أُرسل من ${email}`,
  drawerAttachments: (n) => `${n} صور مرفقة`,
  drawerRmaNumberLabel: 'رقم RMA',
  drawerPartnerComment: 'تعليق الشريك',
  drawerBuyerNote: 'الملاحظة النهائية من المشتري',
  drawerActionTitle: 'إجراءات الفرز',
  drawerBtnStartReview: '🔍 بدء المراجعة (under_review)',
  drawerLabelRmaInstructions: 'تعليمات RMA (يُعطى رقم RMA تلقائيًا عند الموافقة)',
  drawerPlaceholderRmaInstructions: 'مثال: إرجاع بالدفع عند الاستلام، وإرسال بديل خلال 3 أيام عمل. مع رقم الشحن الأصلي.',
  drawerBtnApprove: '✅ الموافقة على العيب وإصدار RMA',
  drawerLabelRejectReason: 'سبب الرفض (تعليق الشريك)',
  drawerPlaceholderRejectReason: 'مثال: القياس يقع ضمن مدى تفاوت الرسم المقدَّم.',
  drawerBtnReject: '❌ رفض',
  drawerFooterApproved: 'بعد إتمام الاستبدال/الاسترداد وتأكيد المشتري للاستلام تتحول الحالة تلقائيًا إلى مكتملة. عند التأخير شارك التحديثات.',
  drawerFooterClosed: 'هذه الحالة مغلقة. إذا اعترض المشتري قد تُعاد بحالة "disputed".',
  errNeedRmaInstructions: 'يرجى إدخال تعليمات معالجة RMA.',
  errNeedRejectReason: 'يرجى إدخال سبب الرفض.',
  errProcess: 'تعذّر معالجة الطلب.',
  closeLabel: 'إغلاق',

  status_reported: 'تم الإبلاغ',
  status_under_review: 'قيد المراجعة',
  status_approved: 'موافق عليه · صدر RMA',
  status_rejected: 'مرفوض',
  status_resolved: 'تم الحل',
  status_disputed: 'متنازع عليه',

  severity_minor: 'طفيف',
  severity_major: 'كبير',
  severity_critical: 'حرج',

  kind_wrong_part: 'قطعة خاطئة',
  kind_damaged: 'تالف',
  kind_out_of_spec: 'خارج المواصفات',
  kind_missing_quantity: 'كمية ناقصة',
  kind_late_delivery: 'تأخير في التسليم',
  kind_other: 'أخرى',

  timelineRelJustNow: 'الآن',
  timelineRelMinutes: (n) => `قبل ${n} د`,
  timelineRelHours: (n) => `قبل ${n} س`,
  timelineRelDays: (n) => `قبل ${n} ي`,
};

export function rmaDict(lang: PartnerLang): RmaDict {
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
