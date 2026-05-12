/**
 * 6-language dictionary for /settings/billing.
 *
 * Round 30 stashed KR/EN inline; Round 31 splits into a dedicated module
 * and adds ja/zh/es/ar so the page reads cleanly and non-Korean visitors
 * see localized status banners + badges.
 *
 * Keep this file additive — new strings get added on every language at
 * once; missing strings fall through to English (last-touched, neutral).
 */

export type BillingLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface BillingStrings {
  pastDueTitle:  string;
  pastDueBody:   string;
  pastDueCta:    string;
  cancelTitle:   string;
  cancelBody:    (endDate: string) => string;
  // Status badges
  statusActive:        string;
  statusPastDue:       string;
  statusCancelPending: string;
  statusCancelled:     string;
}

export const billingDict: Record<BillingLang, BillingStrings> = {
  ko: {
    pastDueTitle: '결제 실패 — 카드 정보를 확인해주세요',
    pastDueBody: '마지막 결제가 거절되어 구독이 일시 중단 상태입니다. 결제 수단을 업데이트하지 않으면 며칠 후 자동 해지되어 Free 플랜으로 전환됩니다.',
    pastDueCta: '결제 수단 업데이트 →',
    cancelTitle: '구독 해지 예정',
    cancelBody: (d) => `${d}까지 Pro 기능을 사용하실 수 있으며, 그 이후 Free 플랜으로 자동 전환됩니다. 마음이 바뀌시면 언제든 재구독 가능합니다.`,
    statusActive: '활성',
    statusPastDue: '결제 실패 — 카드 확인 필요',
    statusCancelPending: '해지 예정',
    statusCancelled: '해지됨',
  },
  en: {
    pastDueTitle: 'Payment failed — please check your card',
    pastDueBody: 'Your last payment was declined and the subscription is on hold. Without an updated card, it will auto-cancel and revert to the Free plan within a few days.',
    pastDueCta: 'Update payment method →',
    cancelTitle: 'Subscription cancellation pending',
    cancelBody: (d) => `Pro features remain available until ${d}, after which your account will revert to the Free plan. You can resubscribe at any time before then.`,
    statusActive: 'Active',
    statusPastDue: 'Payment failed — update card',
    statusCancelPending: 'Cancellation pending',
    statusCancelled: 'Cancelled',
  },
  ja: {
    pastDueTitle: '決済失敗 — カード情報をご確認ください',
    pastDueBody: '前回の決済が拒否され、サブスクリプションは一時停止中です。お支払い方法を更新しない場合、数日後に自動キャンセルされFreeプランに戻ります。',
    pastDueCta: '支払い方法を更新 →',
    cancelTitle: 'サブスクリプション解約予定',
    cancelBody: (d) => `${d}までProの機能をご利用いただけます。その後Freeプランへ自動的に戻ります。お気持ちが変われば、いつでも再登録できます。`,
    statusActive: 'アクティブ',
    statusPastDue: '決済失敗 — カード更新',
    statusCancelPending: '解約予定',
    statusCancelled: '解約済み',
  },
  zh: {
    pastDueTitle: '付款失败 — 请检查您的卡',
    pastDueBody: '上次付款被拒绝，订阅暂时暂停。若未更新付款方式,将在几天后自动取消并恢复为 Free 方案。',
    pastDueCta: '更新付款方式 →',
    cancelTitle: '订阅取消待处理',
    cancelBody: (d) => `Pro 功能将持续至 ${d}，之后您的账户将自动恢复为 Free 方案。您可以随时重新订阅。`,
    statusActive: '活跃',
    statusPastDue: '付款失败 — 更新卡',
    statusCancelPending: '取消待处理',
    statusCancelled: '已取消',
  },
  es: {
    pastDueTitle: 'Pago fallido — verifique su tarjeta',
    pastDueBody: 'Su último pago fue rechazado y la suscripción está en pausa. Sin una tarjeta actualizada, se cancelará automáticamente y volverá al plan Free en unos días.',
    pastDueCta: 'Actualizar método de pago →',
    cancelTitle: 'Cancelación de suscripción pendiente',
    cancelBody: (d) => `Las funciones Pro estarán disponibles hasta el ${d}, tras lo cual su cuenta volverá al plan Free. Puede volver a suscribirse en cualquier momento.`,
    statusActive: 'Activa',
    statusPastDue: 'Pago fallido — actualizar tarjeta',
    statusCancelPending: 'Cancelación pendiente',
    statusCancelled: 'Cancelada',
  },
  ar: {
    pastDueTitle: 'فشل الدفع — يرجى التحقق من بطاقتك',
    pastDueBody: 'تم رفض دفعتك الأخيرة والاشتراك معلّق. بدون تحديث البطاقة، سيتم الإلغاء تلقائيًا والعودة إلى خطة Free خلال أيام.',
    pastDueCta: 'تحديث طريقة الدفع →',
    cancelTitle: 'إلغاء الاشتراك معلّق',
    cancelBody: (d) => `تبقى ميزات Pro متاحة حتى ${d}، وبعد ذلك سيعود حسابك إلى خطة Free. يمكنك إعادة الاشتراك في أي وقت.`,
    statusActive: 'نشط',
    statusPastDue: 'فشل الدفع — حدّث البطاقة',
    statusCancelPending: 'الإلغاء معلّق',
    statusCancelled: 'تم الإلغاء',
  },
};

const LANG_MAP: Record<string, BillingLang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export function billingT(lang: string): BillingStrings {
  return billingDict[LANG_MAP[lang] ?? 'en'];
}
