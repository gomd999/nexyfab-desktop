// Orders page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface OrdersDict {
  pageTitle: string;
  pageSubtitle: string;
  loading: string;
  emptyColumn: string;
  emptyTimeline: string;
  lateBadge: string;
  orderedSuffix: string;
  qtyUnit: string;
  dueDateLabel: string;

  metricOnTime: string;
  metricOnTimeSub: (n: number) => string;
  metricLeadTime: string;
  metricLeadTimeSub: string;
  metricResponse: string;
  metricResponseSub: (n: number) => string;
  metricQuality: string;
  metricQualitySub: (n: number) => string;
  metricCommunication: string;
  metricCommunicationSub: (n: number) => string;
  metricReorder: string;
  metricReorderSub: (days: number) => string;

  colProduction: string;
  colQc: string;
  colShipped: string;
  colDelivered: string;

  status_placed: string;
  status_production: string;
  status_qc: string;
  status_shipped: string;
  status_delivered: string;

  drawerCurrent: string;
  drawerAdvance: (next: string) => string;
  drawerAdvanceLoading: string;
  drawerSectionNotes: string;
  drawerSectionTimeline: string;
  drawerEventStatusChange: string;
  drawerPlaceholderNote: string;
  drawerPlaceholderShipment: string;
  drawerPlaceholderDelay: string;
  drawerBtnPost: string;
  drawerBtnNotify: string;
  drawerCloseLabel: string;

  timelineRelJustNow: string;
  timelineRelMinutes: (n: number) => string;
  timelineRelHours: (n: number) => string;
  timelineRelDays: (n: number) => string;

  errAdvance: string;
  errPost: string;
}

const KO: OrdersDict = {
  pageTitle: '주문 워크플로우',
  pageSubtitle: '진행 중 주문을 단계별로 관리하고, 사진·메모를 등록하면 고객에게 실시간 공유됩니다.',
  loading: '불러오는 중…',
  emptyColumn: '없음',
  emptyTimeline: '아직 이벤트가 없습니다.',
  lateBadge: '납기 초과',
  orderedSuffix: '주문',
  qtyUnit: '개',
  dueDateLabel: '납기',

  metricOnTime: '납기 준수율',
  metricOnTimeSub: (n) => `완료 ${n}건`,
  metricLeadTime: '평균 리드타임',
  metricLeadTimeSub: '주문→납품',
  metricResponse: '평균 응답속도',
  metricResponseSub: (n) => `${n}건 견적`,
  metricQuality: '품질 평점',
  metricQualitySub: (n) => `${n}건`,
  metricCommunication: '소통 평점',
  metricCommunicationSub: (n) => `${n}건`,
  metricReorder: '재주문률',
  metricReorderSub: (d) => `최근 ${d}일`,

  colProduction: '🏭 생산 중',
  colQc: '🔍 품질 검사',
  colShipped: '🚚 배송 중',
  colDelivered: '✅ 완료',

  status_placed: '주문 접수',
  status_production: '생산 중',
  status_qc: '품질 검사',
  status_shipped: '배송 중',
  status_delivered: '완료',

  drawerCurrent: '현재',
  drawerAdvance: (next) => `→ ${next}`,
  drawerAdvanceLoading: '처리 중…',
  drawerSectionNotes: '진행 메모',
  drawerSectionTimeline: '타임라인',
  drawerEventStatusChange: '상태 변경',
  drawerPlaceholderNote: '고객에게 공유할 진행 상황 (예: 가공 80% 완료)',
  drawerPlaceholderShipment: '운송장 번호 + 택배사 (예: 한진 123456789)',
  drawerPlaceholderDelay: '지연 사유 (예: 소재 수급 지연 +3일 예상)',
  drawerBtnPost: '등록',
  drawerBtnNotify: '알림',
  drawerCloseLabel: '닫기',

  timelineRelJustNow: '방금',
  timelineRelMinutes: (n) => `${n}분 전`,
  timelineRelHours: (n) => `${n}시간 전`,
  timelineRelDays: (n) => `${n}일 전`,

  errAdvance: '상태 변경에 실패했습니다.',
  errPost: '등록에 실패했습니다.',
};

const EN: OrdersDict = {
  pageTitle: 'Orders Workflow',
  pageSubtitle: 'Move active orders through stages — photos and notes are shared with the customer in real time.',
  loading: 'Loading…',
  emptyColumn: 'None',
  emptyTimeline: 'No events yet.',
  lateBadge: 'Past due',
  orderedSuffix: 'ordered',
  qtyUnit: ' pcs',
  dueDateLabel: 'Due',

  metricOnTime: 'On-time delivery',
  metricOnTimeSub: (n) => `${n} completed`,
  metricLeadTime: 'Avg lead time',
  metricLeadTimeSub: 'order → delivery',
  metricResponse: 'Avg response time',
  metricResponseSub: (n) => `${n} quotes`,
  metricQuality: 'Quality rating',
  metricQualitySub: (n) => `${n} reviews`,
  metricCommunication: 'Communication',
  metricCommunicationSub: (n) => `${n} reviews`,
  metricReorder: 'Reorder rate',
  metricReorderSub: (d) => `last ${d}d`,

  colProduction: '🏭 In production',
  colQc: '🔍 Quality check',
  colShipped: '🚚 Shipping',
  colDelivered: '✅ Delivered',

  status_placed: 'Order placed',
  status_production: 'In production',
  status_qc: 'Quality check',
  status_shipped: 'Shipping',
  status_delivered: 'Delivered',

  drawerCurrent: 'Current',
  drawerAdvance: (next) => `→ ${next}`,
  drawerAdvanceLoading: 'Processing…',
  drawerSectionNotes: 'Progress notes',
  drawerSectionTimeline: 'Timeline',
  drawerEventStatusChange: 'Status change',
  drawerPlaceholderNote: 'Share progress with the customer (e.g. 80% machined)',
  drawerPlaceholderShipment: 'Tracking number + carrier (e.g. UPS 1Z999)',
  drawerPlaceholderDelay: 'Delay reason (e.g. material shortage, +3 days)',
  drawerBtnPost: 'Post',
  drawerBtnNotify: 'Notify',
  drawerCloseLabel: 'Close',

  timelineRelJustNow: 'just now',
  timelineRelMinutes: (n) => `${n}m ago`,
  timelineRelHours: (n) => `${n}h ago`,
  timelineRelDays: (n) => `${n}d ago`,

  errAdvance: 'Could not change status.',
  errPost: 'Failed to post.',
};

const JA: OrdersDict = {
  pageTitle: '注文ワークフロー',
  pageSubtitle: '進行中の注文を段階別に管理。写真とメモは顧客にリアルタイム共有されます。',
  loading: '読み込み中…',
  emptyColumn: 'なし',
  emptyTimeline: 'まだイベントがありません。',
  lateBadge: '納期超過',
  orderedSuffix: '注文',
  qtyUnit: '個',
  dueDateLabel: '納期',

  metricOnTime: '納期遵守率',
  metricOnTimeSub: (n) => `完了 ${n}件`,
  metricLeadTime: '平均リードタイム',
  metricLeadTimeSub: '注文→納品',
  metricResponse: '平均応答速度',
  metricResponseSub: (n) => `${n}件の見積`,
  metricQuality: '品質評価',
  metricQualitySub: (n) => `${n}件`,
  metricCommunication: 'コミュニケーション',
  metricCommunicationSub: (n) => `${n}件`,
  metricReorder: '再注文率',
  metricReorderSub: (d) => `直近 ${d}日`,

  colProduction: '🏭 生産中',
  colQc: '🔍 品質検査',
  colShipped: '🚚 配送中',
  colDelivered: '✅ 完了',

  status_placed: '注文受付',
  status_production: '生産中',
  status_qc: '品質検査',
  status_shipped: '配送中',
  status_delivered: '完了',

  drawerCurrent: '現在',
  drawerAdvance: (next) => `→ ${next}`,
  drawerAdvanceLoading: '処理中…',
  drawerSectionNotes: '進捗メモ',
  drawerSectionTimeline: 'タイムライン',
  drawerEventStatusChange: 'ステータス変更',
  drawerPlaceholderNote: '顧客に共有する進捗 (例: 加工 80% 完了)',
  drawerPlaceholderShipment: '伝票番号 + 配送会社 (例: ヤマト 123456789)',
  drawerPlaceholderDelay: '遅延理由 (例: 素材調達遅延 +3日見込み)',
  drawerBtnPost: '登録',
  drawerBtnNotify: '通知',
  drawerCloseLabel: '閉じる',

  timelineRelJustNow: 'たった今',
  timelineRelMinutes: (n) => `${n}分前`,
  timelineRelHours: (n) => `${n}時間前`,
  timelineRelDays: (n) => `${n}日前`,

  errAdvance: 'ステータス変更に失敗しました。',
  errPost: '登録に失敗しました。',
};

const CN: OrdersDict = {
  pageTitle: '订单工作流',
  pageSubtitle: '按阶段管理进行中订单 — 照片和备注会实时共享给客户。',
  loading: '加载中…',
  emptyColumn: '无',
  emptyTimeline: '尚无事件。',
  lateBadge: '逾期',
  orderedSuffix: '下单',
  qtyUnit: '件',
  dueDateLabel: '交期',

  metricOnTime: '准时交付率',
  metricOnTimeSub: (n) => `已完成 ${n}单`,
  metricLeadTime: '平均交付周期',
  metricLeadTimeSub: '下单→交货',
  metricResponse: '平均响应速度',
  metricResponseSub: (n) => `${n}份报价`,
  metricQuality: '质量评分',
  metricQualitySub: (n) => `${n}条`,
  metricCommunication: '沟通评分',
  metricCommunicationSub: (n) => `${n}条`,
  metricReorder: '复购率',
  metricReorderSub: (d) => `近 ${d}天`,

  colProduction: '🏭 生产中',
  colQc: '🔍 质量检查',
  colShipped: '🚚 运输中',
  colDelivered: '✅ 已交付',

  status_placed: '订单已收',
  status_production: '生产中',
  status_qc: '质量检查',
  status_shipped: '运输中',
  status_delivered: '已交付',

  drawerCurrent: '当前',
  drawerAdvance: (next) => `→ ${next}`,
  drawerAdvanceLoading: '处理中…',
  drawerSectionNotes: '进度备注',
  drawerSectionTimeline: '时间线',
  drawerEventStatusChange: '状态变更',
  drawerPlaceholderNote: '与客户分享进度 (例如: 加工已完成 80%)',
  drawerPlaceholderShipment: '运单号 + 快递公司 (例如: 顺丰 123456789)',
  drawerPlaceholderDelay: '延迟原因 (例如: 原材料延迟 +3天)',
  drawerBtnPost: '提交',
  drawerBtnNotify: '通知',
  drawerCloseLabel: '关闭',

  timelineRelJustNow: '刚刚',
  timelineRelMinutes: (n) => `${n}分钟前`,
  timelineRelHours: (n) => `${n}小时前`,
  timelineRelDays: (n) => `${n}天前`,

  errAdvance: '状态变更失败。',
  errPost: '提交失败。',
};

const ES: OrdersDict = {
  pageTitle: 'Flujo de pedidos',
  pageSubtitle: 'Avanza los pedidos por etapas — las fotos y notas se comparten con el cliente en tiempo real.',
  loading: 'Cargando…',
  emptyColumn: 'Ninguno',
  emptyTimeline: 'Aún no hay eventos.',
  lateBadge: 'Atrasado',
  orderedSuffix: 'pedido',
  qtyUnit: ' uds',
  dueDateLabel: 'Entrega',

  metricOnTime: 'Entregas a tiempo',
  metricOnTimeSub: (n) => `${n} completados`,
  metricLeadTime: 'Tiempo medio',
  metricLeadTimeSub: 'pedido → entrega',
  metricResponse: 'Respuesta media',
  metricResponseSub: (n) => `${n} cotizaciones`,
  metricQuality: 'Calidad',
  metricQualitySub: (n) => `${n} reseñas`,
  metricCommunication: 'Comunicación',
  metricCommunicationSub: (n) => `${n} reseñas`,
  metricReorder: 'Tasa de recompra',
  metricReorderSub: (d) => `últimos ${d}d`,

  colProduction: '🏭 En producción',
  colQc: '🔍 Control de calidad',
  colShipped: '🚚 En envío',
  colDelivered: '✅ Entregado',

  status_placed: 'Pedido recibido',
  status_production: 'En producción',
  status_qc: 'Control de calidad',
  status_shipped: 'En envío',
  status_delivered: 'Entregado',

  drawerCurrent: 'Actual',
  drawerAdvance: (next) => `→ ${next}`,
  drawerAdvanceLoading: 'Procesando…',
  drawerSectionNotes: 'Notas de progreso',
  drawerSectionTimeline: 'Cronología',
  drawerEventStatusChange: 'Cambio de estado',
  drawerPlaceholderNote: 'Comparte el progreso con el cliente (p. ej. mecanizado al 80%)',
  drawerPlaceholderShipment: 'Nº de seguimiento + transportista (p. ej. DHL 123456789)',
  drawerPlaceholderDelay: 'Motivo del retraso (p. ej. retraso de materiales, +3 días)',
  drawerBtnPost: 'Publicar',
  drawerBtnNotify: 'Notificar',
  drawerCloseLabel: 'Cerrar',

  timelineRelJustNow: 'ahora mismo',
  timelineRelMinutes: (n) => `hace ${n}m`,
  timelineRelHours: (n) => `hace ${n}h`,
  timelineRelDays: (n) => `hace ${n}d`,

  errAdvance: 'No se pudo cambiar el estado.',
  errPost: 'Error al publicar.',
};

const AR: OrdersDict = {
  pageTitle: 'سير عمل الطلبات',
  pageSubtitle: 'انقل الطلبات بين المراحل — تُشارك الصور والملاحظات مع العميل لحظيًا.',
  loading: 'جارٍ التحميل…',
  emptyColumn: 'لا يوجد',
  emptyTimeline: 'لا توجد أحداث بعد.',
  lateBadge: 'متأخر',
  orderedSuffix: 'طلب',
  qtyUnit: ' قطعة',
  dueDateLabel: 'الاستحقاق',

  metricOnTime: 'نسبة التسليم في الموعد',
  metricOnTimeSub: (n) => `مكتمل ${n}`,
  metricLeadTime: 'متوسط زمن التسليم',
  metricLeadTimeSub: 'الطلب → التسليم',
  metricResponse: 'متوسط زمن الاستجابة',
  metricResponseSub: (n) => `${n} عرض`,
  metricQuality: 'تقييم الجودة',
  metricQualitySub: (n) => `${n} تقييم`,
  metricCommunication: 'التواصل',
  metricCommunicationSub: (n) => `${n} تقييم`,
  metricReorder: 'معدل الطلب المتكرر',
  metricReorderSub: (d) => `آخر ${d} يومًا`,

  colProduction: '🏭 قيد التصنيع',
  colQc: '🔍 فحص الجودة',
  colShipped: '🚚 قيد الشحن',
  colDelivered: '✅ مُسلَّم',

  status_placed: 'تم استلام الطلب',
  status_production: 'قيد التصنيع',
  status_qc: 'فحص الجودة',
  status_shipped: 'قيد الشحن',
  status_delivered: 'مُسلَّم',

  drawerCurrent: 'الحالي',
  drawerAdvance: (next) => `→ ${next}`,
  drawerAdvanceLoading: 'جارٍ المعالجة…',
  drawerSectionNotes: 'ملاحظات التقدم',
  drawerSectionTimeline: 'الجدول الزمني',
  drawerEventStatusChange: 'تغيير الحالة',
  drawerPlaceholderNote: 'شارك التقدم مع العميل (مثال: التصنيع 80%)',
  drawerPlaceholderShipment: 'رقم الشحنة + شركة الشحن (مثال: DHL 123456789)',
  drawerPlaceholderDelay: 'سبب التأخير (مثال: نقص المواد +3 أيام)',
  drawerBtnPost: 'نشر',
  drawerBtnNotify: 'إشعار',
  drawerCloseLabel: 'إغلاق',

  timelineRelJustNow: 'الآن',
  timelineRelMinutes: (n) => `قبل ${n} د`,
  timelineRelHours: (n) => `قبل ${n} س`,
  timelineRelDays: (n) => `قبل ${n} ي`,

  errAdvance: 'تعذّر تغيير الحالة.',
  errPost: 'فشل النشر.',
};

export function ordersDict(lang: PartnerLang): OrdersDict {
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
