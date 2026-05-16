// Incoming RFQ invitations page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface InvitationsDict {
  title: string;
  subtitle: string;
  loading: string;
  empty: string;
  emptyHint: string;
  guideTitle: string;
  guide1: string;
  guide2: string;
  guide3: string;
  guide4: string;
  guide5: string;
  antiPoach: string;
  viewAgreement: string;
  qty: string;
  deadlineLabel: string;
  priceLabel: string;
  daysLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  pricePlaceholder: string;
  daysPlaceholder: string;
  cancel: string;
  submitting: string;
  submitQuote: string;
  submitted: string;
  openForm: string;
  seeExisting: string;
  errPrice: string;
  errDays: string;
  status_recommended: string;
  status_contacted: string;
  status_responded: string;
  status_quote_drafting: string;
}

const KO: InvitationsDict = {
  title: '📥 들어온 견적 요청',
  subtitle: 'NexyFab 운영팀이 귀사를 추천한 RFQ입니다. 견적 작성 후 고객에게 즉시 전달됩니다.',
  loading: '불러오는 중…',
  empty: '현재 도착한 견적 요청이 없습니다.',
  emptyHint: '새 RFQ가 들어오면 이메일·카톡으로 알려드립니다.',
  guideTitle: '💡 NexyFab 파트너 매칭은 이렇게 진행됩니다',
  guide1: '고객이 3D 도면과 함께 RFQ를 등록',
  guide2: 'NexyFab 운영팀이 도면·재질·물량 보고 적합한 공장 선별',
  guide3: '귀사가 후보에 들면 이메일·카톡으로 알려 드림',
  guide4: '이 페이지에서 견적가·납기 입력 → 고객에게 즉시 전달',
  guide5: '고객이 수락하면 NexyFab 에스크로를 통해 안전 거래 (수수료 8%)',
  antiPoach: '⚠️ 파트너 약관에 따라 NexyFab 외부 채널로의 직접 거래는 24개월간 금지됩니다.',
  viewAgreement: '약관 보기',
  qty: '수량',
  deadlineLabel: '희망 납기',
  priceLabel: '견적가 (원, 부가세 별도)',
  daysLabel: '납기 (영업일)',
  noteLabel: '비고 (선택)',
  notePlaceholder: '재질 가정, 표면처리, 포장 조건 등',
  pricePlaceholder: '예: 850000',
  daysPlaceholder: '예: 14',
  cancel: '취소',
  submitting: '전송 중…',
  submitQuote: '✓ 견적 등록',
  submitted: '✅ 견적 등록 완료. 고객에게 알림이 발송됐습니다.',
  openForm: '💰 견적 작성 →',
  seeExisting: '이미 작성한 견적 보기 →',
  errPrice: '단가/총액(원)을 입력하세요',
  errDays: '납기(영업일) 입력 필요',
  status_recommended: '추천만 받음',
  status_contacted: '운영팀 컨택 중',
  status_responded: '응답 등록됨',
  status_quote_drafting: '견적 작성 중',
};

const EN: InvitationsDict = {
  title: '📥 Incoming RFQs',
  subtitle: 'These are RFQs where NexyFab ops recommended your factory. Quotes are forwarded to the buyer immediately.',
  loading: 'Loading…',
  empty: 'No incoming RFQs right now.',
  emptyHint: 'You will be notified by email/KakaoTalk when new RFQs arrive.',
  guideTitle: '💡 How NexyFab partner matching works',
  guide1: 'Buyer submits an RFQ with 3D drawings',
  guide2: 'NexyFab ops review the drawings, material, volume → shortlist factories',
  guide3: 'If your factory is shortlisted, we notify you by email/KakaoTalk',
  guide4: 'You enter price + lead time here → instantly forwarded to the buyer',
  guide5: 'Once the buyer accepts, settlement runs through NexyFab escrow (8% fee)',
  antiPoach: '⚠️ Per the partner agreement, direct off-platform deals with introduced buyers are prohibited for 24 months.',
  viewAgreement: 'View agreement',
  qty: 'Qty',
  deadlineLabel: 'Target delivery',
  priceLabel: 'Quote (KRW, ex-VAT)',
  daysLabel: 'Lead time (business days)',
  noteLabel: 'Note (optional)',
  notePlaceholder: 'Material assumptions, finish, packaging, etc.',
  pricePlaceholder: 'e.g. 850000',
  daysPlaceholder: 'e.g. 14',
  cancel: 'Cancel',
  submitting: 'Submitting…',
  submitQuote: '✓ Submit quote',
  submitted: '✅ Quote submitted. The buyer has been notified.',
  openForm: '💰 Write quote →',
  seeExisting: 'See submitted quotes →',
  errPrice: 'Enter unit/total price (KRW)',
  errDays: 'Lead time (business days) required',
  status_recommended: 'Recommended',
  status_contacted: 'Ops contacting',
  status_responded: 'Response logged',
  status_quote_drafting: 'Drafting quote',
};

const JA: InvitationsDict = {
  title: '📥 受け付けた見積もり依頼',
  subtitle: 'NexyFab 運営チームが貴社を推薦した RFQ です。回答後、顧客に即時連携されます。',
  loading: '読み込み中…',
  empty: '現在到着した見積もり依頼はありません。',
  emptyHint: '新規 RFQ が届くとメール/カカオで通知します。',
  guideTitle: '💡 NexyFab パートナーマッチングの流れ',
  guide1: '顧客が 3D 図面と共に RFQ を登録',
  guide2: 'NexyFab 運営が図面・素材・数量を確認し最適な工場を選定',
  guide3: '貴社が候補に入るとメール/カカオで通知',
  guide4: 'このページで見積額・納期を入力 → 顧客に即時送信',
  guide5: '顧客が受諾すると NexyFab エスクローを通じて安全取引 (手数料 8%)',
  antiPoach: '⚠️ パートナー規約により、NexyFab 外チャネルでの直接取引は 24 ヶ月間禁止されます。',
  viewAgreement: '規約を見る',
  qty: '数量',
  deadlineLabel: '希望納期',
  priceLabel: '見積額 (KRW、税抜)',
  daysLabel: '納期 (営業日)',
  noteLabel: '備考 (任意)',
  notePlaceholder: '素材の前提、表面処理、梱包条件など',
  pricePlaceholder: '例: 850000',
  daysPlaceholder: '例: 14',
  cancel: 'キャンセル',
  submitting: '送信中…',
  submitQuote: '✓ 見積もりを登録',
  submitted: '✅ 見積もり登録完了。顧客に通知が送られました。',
  openForm: '💰 見積もり作成 →',
  seeExisting: '提出済みの見積もりを見る →',
  errPrice: '単価/合計 (KRW) を入力してください',
  errDays: '納期 (営業日) を入力してください',
  status_recommended: '推薦のみ',
  status_contacted: '運営チーム連絡中',
  status_responded: '回答登録済み',
  status_quote_drafting: '見積もり作成中',
};

const CN: InvitationsDict = {
  title: '📥 收到的报价请求',
  subtitle: 'NexyFab 运营推荐了贵公司的 RFQ。提交报价后将立即转发给客户。',
  loading: '加载中…',
  empty: '当前没有收到的报价请求。',
  emptyHint: '有新 RFQ 时将通过邮件或 KakaoTalk 通知您。',
  guideTitle: '💡 NexyFab 合作伙伴匹配流程',
  guide1: '客户提交带有 3D 图纸的 RFQ',
  guide2: 'NexyFab 运营审核图纸/材料/数量并筛选合适工厂',
  guide3: '若贵公司入围，将通过邮件或 KakaoTalk 通知',
  guide4: '在此页面填写报价及交期 → 即时转发给客户',
  guide5: '客户接受后，将通过 NexyFab 托管完成安全交易 (手续费 8%)',
  antiPoach: '⚠️ 根据合作伙伴协议，禁止在 24 个月内通过 NexyFab 外渠道直接交易。',
  viewAgreement: '查看协议',
  qty: '数量',
  deadlineLabel: '期望交期',
  priceLabel: '报价 (KRW，不含税)',
  daysLabel: '交期 (工作日)',
  noteLabel: '备注 (可选)',
  notePlaceholder: '材料假设、表面处理、包装条件等',
  pricePlaceholder: '例: 850000',
  daysPlaceholder: '例: 14',
  cancel: '取消',
  submitting: '提交中…',
  submitQuote: '✓ 提交报价',
  submitted: '✅ 报价已提交，已通知客户。',
  openForm: '💰 撰写报价 →',
  seeExisting: '查看已提交报价 →',
  errPrice: '请输入单价/总额 (KRW)',
  errDays: '请输入交期 (工作日)',
  status_recommended: '已推荐',
  status_contacted: '运营联络中',
  status_responded: '已登记回应',
  status_quote_drafting: '报价撰写中',
};

const ES: InvitationsDict = {
  title: '📥 RFQ entrantes',
  subtitle: 'RFQ donde NexyFab ha recomendado tu fábrica. Las cotizaciones se reenvían al comprador al instante.',
  loading: 'Cargando…',
  empty: 'No hay RFQ entrantes ahora mismo.',
  emptyHint: 'Te avisaremos por correo/KakaoTalk cuando lleguen nuevos RFQ.',
  guideTitle: '💡 Cómo funciona el emparejamiento NexyFab',
  guide1: 'El comprador envía un RFQ con planos 3D',
  guide2: 'NexyFab analiza planos, material, volumen y preselecciona fábricas',
  guide3: 'Si tu fábrica entra en la lista, te avisaremos por correo/KakaoTalk',
  guide4: 'Introduces precio y plazo aquí → se reenvía al instante al comprador',
  guide5: 'Cuando el comprador acepta, la liquidación pasa por la custodia NexyFab (comisión 8%)',
  antiPoach: '⚠️ Según el acuerdo, los tratos directos fuera de NexyFab con compradores presentados están prohibidos durante 24 meses.',
  viewAgreement: 'Ver acuerdo',
  qty: 'Cant.',
  deadlineLabel: 'Entrega objetivo',
  priceLabel: 'Cotización (KRW, sin IVA)',
  daysLabel: 'Plazo (días hábiles)',
  noteLabel: 'Nota (opcional)',
  notePlaceholder: 'Material asumido, acabado, embalaje, etc.',
  pricePlaceholder: 'p. ej. 850000',
  daysPlaceholder: 'p. ej. 14',
  cancel: 'Cancelar',
  submitting: 'Enviando…',
  submitQuote: '✓ Enviar cotización',
  submitted: '✅ Cotización enviada. El comprador ha sido notificado.',
  openForm: '💰 Escribir cotización →',
  seeExisting: 'Ver cotizaciones enviadas →',
  errPrice: 'Introduce precio unitario/total (KRW)',
  errDays: 'Plazo (días hábiles) requerido',
  status_recommended: 'Recomendado',
  status_contacted: 'Ops contactando',
  status_responded: 'Respuesta registrada',
  status_quote_drafting: 'Redactando cotización',
};

const AR: InvitationsDict = {
  title: '📥 طلبات الأسعار الواردة',
  subtitle: 'طلبات أوصت بها NexyFab لمصنعك. تُحوَّل العروض إلى المشتري فور تقديمها.',
  loading: 'جارٍ التحميل…',
  empty: 'لا توجد طلبات أسعار واردة حاليًا.',
  emptyHint: 'سنخطرك عبر البريد الإلكتروني/KakaoTalk عند وصول طلبات جديدة.',
  guideTitle: '💡 كيف يعمل التوفيق في NexyFab',
  guide1: 'يقدّم المشتري طلب عرض سعر مع رسومات ثلاثية الأبعاد',
  guide2: 'يراجع فريق NexyFab الرسومات والخامة والكمية ويختار المصانع المناسبة',
  guide3: 'إذا اختير مصنعك، نخطرك عبر البريد الإلكتروني/KakaoTalk',
  guide4: 'تُدخل السعر ومدة التسليم هنا → يُحوَّل فورًا إلى المشتري',
  guide5: 'عند موافقة المشتري، تُتم التسوية عبر ضمان NexyFab (عمولة 8%)',
  antiPoach: '⚠️ وفقًا لاتفاقية الشراكة، يُحظر التعامل المباشر خارج المنصة مع المشترين المُحالين لمدة 24 شهرًا.',
  viewAgreement: 'عرض الاتفاقية',
  qty: 'الكمية',
  deadlineLabel: 'موعد التسليم المرغوب',
  priceLabel: 'العرض (KRW، بدون ضريبة)',
  daysLabel: 'المدة (أيام عمل)',
  noteLabel: 'ملاحظة (اختياري)',
  notePlaceholder: 'افتراضات الخامة، التشطيب، التغليف، إلخ.',
  pricePlaceholder: 'مثال: 850000',
  daysPlaceholder: 'مثال: 14',
  cancel: 'إلغاء',
  submitting: 'جارٍ الإرسال…',
  submitQuote: '✓ إرسال العرض',
  submitted: '✅ تم إرسال العرض وإخطار المشتري.',
  openForm: '💰 كتابة العرض ←',
  seeExisting: 'عرض العروض المُرسلة ←',
  errPrice: 'أدخل السعر الفردي/الإجمالي (KRW)',
  errDays: 'مدة التسليم (أيام عمل) مطلوبة',
  status_recommended: 'موصى به',
  status_contacted: 'الفريق على اتصال',
  status_responded: 'تم تسجيل الرد',
  status_quote_drafting: 'جارٍ صياغة العرض',
};

export function invitationsDict(lang: PartnerLang): InvitationsDict {
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
